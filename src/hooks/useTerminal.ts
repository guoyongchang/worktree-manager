import { useState, useEffect, useCallback, useRef } from 'react';
import i18next from 'i18next';
import type { TerminalTab, MainWorkspaceStatus, WorktreeListItem } from '../types';
import { TERMINAL } from '../constants';
import { callBackend, isTauri, broadcastTerminalState as broadcastTerminalStateBackend, getTerminalState } from '../lib/backend';
import { getWebSocketManager } from '../lib/websocket';
import { listen } from '@tauri-apps/api/event';

export interface UseTerminalReturn {
  terminalVisible: boolean;
  terminalHeight: number;
  isResizing: boolean;
  activatedTerminals: Set<string>;
  mountedTerminals: Set<string>;
  activeTerminalTab: string | null;
  terminalTabs: TerminalTab[];
  setTerminalVisible: (visible: boolean) => void;
  setTerminalHeight: (height: number) => void;
  setIsResizing: (resizing: boolean) => void;
  handleTerminalTabClick: (path: string) => void;
  handleCloseTerminalTab: (path: string) => void;
  handleCloseOtherTerminalTabs: (keepPath: string) => void;
  handleCloseAllTerminalTabs: () => void;
  handleDuplicateTerminal: (path: string) => void;
  handleToggleTerminal: () => void;
  cleanupTerminalsForPath: (pathPrefix: string) => void;
}

export function useTerminal(
  selectedWorktree: WorktreeListItem | null,
  mainWorkspace: MainWorkspaceStatus | null,
  workspacePathParam?: string
): UseTerminalReturn {
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState<number>(TERMINAL.DEFAULT_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const [activatedTerminals, setActivatedTerminals] = useState<Set<string>>(new Set());
  const [activeTerminalTab, setActiveTerminalTab] = useState<string | null>(null);
  // Global set of all ever-activated terminals — controls Terminal component mounting.
  // Only shrinks when a tab is explicitly closed. Survives worktree switches so PTY sessions stay alive.
  const [mountedTerminals, setMountedTerminals] = useState<Set<string>>(new Set());

  // Remember active tab, activated terminals & visibility per workspace root, so switching back restores them
  const activeTabPerWorkspace = useRef<Map<string, string>>(new Map());
  const activatedPerWorkspace = useRef<Map<string, Set<string>>>(new Map());
  const visiblePerWorkspace = useRef<Map<string, boolean>>(new Map());
  const prevWorkspaceRoot = useRef<string>('');

  // Unique client ID for self-echo filtering — replaces all workaround refs
  const clientIdRef = useRef(
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  );
  // Rate limiting
  const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBroadcastTime = useRef<number>(0);

  const currentWorkspaceRoot = selectedWorktree?.path || mainWorkspace?.path || '';
  const _isTauri = isTauri();

  // Get workspace path for broadcasting (needed for both desktop and web)
  const workspacePath = workspacePathParam || '';
  const worktreeName = selectedWorktree?.name || '';

  // Accumulate new activatedTerminals into mountedTerminals (never auto-remove)
  useEffect(() => {
    setMountedTerminals(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const t of activatedTerminals) {
        if (!next.has(t)) { next.add(t); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [activatedTerminals]);

  // Refs for current state — allows stable callbacks without state dependencies
  const activatedTerminalsRef = useRef(activatedTerminals);
  activatedTerminalsRef.current = activatedTerminals;
  const activeTerminalTabRef = useRef(activeTerminalTab);
  activeTerminalTabRef.current = activeTerminalTab;
  const terminalVisibleRef = useRef(terminalVisible);
  terminalVisibleRef.current = terminalVisible;

  const currentProjects: Array<{ name: string; path: string }> = selectedWorktree?.projects ||
    (mainWorkspace ? mainWorkspace.projects.map(p => ({
      name: p.name,
      path: `${mainWorkspace.path}/projects/${p.name}`
    })) : []);

  const baseTabs: TerminalTab[] = currentWorkspaceRoot ? [
    { name: i18next.t('terminal.workspace'), path: currentWorkspaceRoot, isRoot: true, isDuplicate: false },
    ...currentProjects.map(p => ({
      name: p.name,
      path: p.path,
      isRoot: false,
      isDuplicate: false
    }))
  ] : [];

  const duplicatedTabs: TerminalTab[] = Array.from(activatedTerminals)
    .filter(path => path.includes('#'))
    .map(path => {
      const basePath = path.split('#')[0];
      const baseTab = baseTabs.find(t => t.path === basePath);
      const count = Array.from(activatedTerminals).filter(p => p.startsWith(basePath + '#')).length;
      return {
        name: baseTab ? `${baseTab.name} (${count + 1})` : path.split('/').pop() || 'Terminal',
        path,
        isRoot: false,
        isDuplicate: true
      };
    });

  const terminalTabs = [...baseTabs, ...duplicatedTabs];
  const terminalTabsRef = useRef(terminalTabs);
  terminalTabsRef.current = terminalTabs;

  // Explicit broadcast function — reads from refs (synchronously updated)
  const scheduleBroadcast = useCallback(() => {
    if (!workspacePath || !worktreeName) return;

    const doBroadcast = () => {
      const tabs = Array.from(activatedTerminalsRef.current);
      const active = activeTerminalTabRef.current;
      const visible = terminalVisibleRef.current;
      const clientId = clientIdRef.current;

      if (import.meta.env.DEV) {
        console.log('[useTerminal] Broadcasting terminal state:',
          'tabs:', tabs, 'active:', active);
      }

      if (_isTauri) {
        broadcastTerminalStateBackend(
          workspacePath, worktreeName, tabs, active, visible, clientId
        ).catch(err => {
          console.error('[useTerminal] Failed to broadcast terminal state:', err);
        });
      } else {
        getWebSocketManager().broadcastTerminalState(
          workspacePath, worktreeName, tabs, active, visible, clientId
        );
      }
      lastBroadcastTime.current = Date.now();
    };

    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);

    const elapsed = Date.now() - lastBroadcastTime.current;
    if (elapsed >= TERMINAL.BROADCAST_RATE_LIMIT_MS) {
      doBroadcast();
    } else {
      broadcastTimerRef.current = setTimeout(doBroadcast,
        TERMINAL.BROADCAST_RATE_LIMIT_MS - elapsed);
    }
  }, [workspacePath, worktreeName, _isTauri]);

  // Save/restore terminal state when workspace root changes
  useEffect(() => {
    const prev = prevWorkspaceRoot.current;

    if (prev && prev !== currentWorkspaceRoot) {
      // Save current state for the previous workspace
      const currentTab = activeTerminalTabRef.current;
      if (currentTab) {
        activeTabPerWorkspace.current.set(prev, currentTab);
      }
      activatedPerWorkspace.current.set(prev, new Set(activatedTerminalsRef.current));
      visiblePerWorkspace.current.set(prev, terminalVisibleRef.current);
    }

    if (currentWorkspaceRoot && currentWorkspaceRoot !== prev) {
      // Fast restore from local map (or empty) to avoid blank flash
      const savedActivated = activatedPerWorkspace.current.get(currentWorkspaceRoot);
      const savedTab = activeTabPerWorkspace.current.get(currentWorkspaceRoot);
      const savedVisible = visiblePerWorkspace.current.get(currentWorkspaceRoot);

      const restoredActivated = savedActivated || new Set<string>();
      const restoredTab = (savedTab && savedActivated?.has(savedTab)) ? savedTab : null;
      const restoredVisible = savedVisible ?? false;

      setActivatedTerminals(restoredActivated);
      setTerminalVisible(restoredVisible);
      setActiveTerminalTab(restoredTab);

      activatedTerminalsRef.current = restoredActivated;
      activeTerminalTabRef.current = restoredTab;
      terminalVisibleRef.current = restoredVisible;

      // Always fetch authoritative state from backend cache.
      // Do NOT broadcast here — only user actions (open/close/toggle) trigger broadcasts.
      const wsRoot = currentWorkspaceRoot;
      getTerminalState(workspacePath, worktreeName).then((cached) => {
        if (!cached || prevWorkspaceRoot.current !== wsRoot) return;

        const cachedActivated = new Set(cached.activated_terminals);
        const localActivated = activatedTerminalsRef.current;
        const changed =
          cachedActivated.size !== localActivated.size ||
          !Array.from(cachedActivated).every(t => localActivated.has(t)) ||
          cached.active_terminal_tab !== activeTerminalTabRef.current ||
          cached.terminal_visible !== terminalVisibleRef.current;

        if (!changed) return;

        setActivatedTerminals(cachedActivated);
        setActiveTerminalTab(cached.active_terminal_tab);
        setTerminalVisible(cached.terminal_visible);

        activatedTerminalsRef.current = cachedActivated;
        activeTerminalTabRef.current = cached.active_terminal_tab;
        terminalVisibleRef.current = cached.terminal_visible;

        // Update local map for fast restore on next switch
        activatedPerWorkspace.current.set(wsRoot, cachedActivated);
        if (cached.active_terminal_tab) {
          activeTabPerWorkspace.current.set(wsRoot, cached.active_terminal_tab);
        }
        visiblePerWorkspace.current.set(wsRoot, cached.terminal_visible);
      }).catch(() => {});
    }

    prevWorkspaceRoot.current = currentWorkspaceRoot;
  }, [currentWorkspaceRoot, workspacePath, worktreeName]);

  // Shared handler for incoming terminal state messages (used by both Tauri and WebSocket)
  const handleTerminalStateMessage = useCallback((msg: {
    workspacePath?: string;
    worktreeName?: string;
    activatedTerminals: string[];
    activeTerminalTab: string | null;
    terminalVisible: boolean;
    clientId?: string;
  }) => {
    // Self-echo filtering: ignore messages from this client
    if (msg.clientId && msg.clientId === clientIdRef.current) return;

    const currentActivated = activatedTerminalsRef.current;
    const newActivatedTerminals = new Set(msg.activatedTerminals);
    const activatedChanged =
      newActivatedTerminals.size !== currentActivated.size ||
      !Array.from(newActivatedTerminals).every(t => currentActivated.has(t));

    if (activatedChanged ||
        msg.activeTerminalTab !== activeTerminalTabRef.current ||
        msg.terminalVisible !== terminalVisibleRef.current) {
      setActivatedTerminals(newActivatedTerminals);
      setActiveTerminalTab(msg.activeTerminalTab);
      setTerminalVisible(msg.terminalVisible);
    }
  }, []);

  // Terminal state synchronization: both desktop and web subscribe
  useEffect(() => {
    if (!selectedWorktree || !workspacePath || !worktreeName) return;

    let unsubscribe: (() => void) | undefined;

    if (_isTauri) {
      const unlisten = listen<{
        workspacePath: string;
        worktreeName: string;
        activatedTerminals: string[];
        activeTerminalTab: string | null;
        terminalVisible: boolean;
        clientId?: string;
      }>('terminal-state-update', (event) => {
        if (event.payload.workspacePath && event.payload.worktreeName &&
            (event.payload.workspacePath !== workspacePath || event.payload.worktreeName !== worktreeName)) {
          return;
        }
        handleTerminalStateMessage(event.payload);
      });

      unsubscribe = () => { unlisten.then(fn => fn()); };
    } else {
      const wsManager = getWebSocketManager();
      unsubscribe = wsManager.subscribeTerminalState(
        workspacePath,
        worktreeName,
        (msg) => {
          if (msg.workspacePath && msg.worktreeName &&
              (msg.workspacePath !== workspacePath || msg.worktreeName !== worktreeName)) {
            return;
          }
          handleTerminalStateMessage(msg);
        },
      );
    }

    return unsubscribe;
  }, [selectedWorktree, workspacePath, worktreeName, _isTauri, handleTerminalStateMessage]);

  // Handle terminal resize drag (mouse + touch)
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY;
      setTerminalHeight(Math.max(TERMINAL.MIN_HEIGHT, Math.min(TERMINAL.MAX_HEIGHT, newHeight)));
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const newHeight = window.innerHeight - e.touches[0].clientY;
      setTerminalHeight(Math.max(TERMINAL.MIN_HEIGHT, Math.min(TERMINAL.MAX_HEIGHT, newHeight)));
    };

    const handleEnd = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleEnd);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleTerminalTabClick = useCallback((projectPath: string) => {
    // Update state (async)
    if (!terminalVisibleRef.current) setTerminalVisible(true);
    setActiveTerminalTab(projectPath);
    if (!activatedTerminalsRef.current.has(projectPath)) {
      setActivatedTerminals(prev => new Set(prev).add(projectPath));
    }

    // Update refs synchronously for broadcast
    terminalVisibleRef.current = true;
    activeTerminalTabRef.current = projectPath;
    if (!activatedTerminalsRef.current.has(projectPath)) {
      activatedTerminalsRef.current = new Set(activatedTerminalsRef.current).add(projectPath);
    }

    scheduleBroadcast();

    // Trigger terminal resize by temporarily adjusting height
    setTerminalHeight(prev => prev - TERMINAL.RESIZE_TRIGGER_OFFSET);
    setTimeout(() => {
      setTerminalHeight(prev => prev + TERMINAL.RESIZE_TRIGGER_OFFSET);
    }, TERMINAL.RESIZE_DELAY_MS);
  }, [scheduleBroadcast]);

  const handleCloseTerminalTab = useCallback((path: string) => {
    const newActivated = new Set(activatedTerminalsRef.current);
    newActivated.delete(path);

    setActivatedTerminals(newActivated);
    // Remove from mountedTerminals so the Terminal component unmounts
    setMountedTerminals(prev => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });

    // Explicitly close PTY session (Terminal component no longer does this on unmount)
    const sessionId = `pty-${path.replace(/[\/#]/g, '-')}`;
    callBackend('pty_close', { sessionId }).catch(() => {});

    let newActiveTab = activeTerminalTabRef.current;
    if (activeTerminalTabRef.current === path) {
      // Select adjacent tab: prefer next, then previous, based on tab order
      const tabs = terminalTabsRef.current;
      const closedIndex = tabs.findIndex(t => t.path === path);
      const activatedArr = tabs.filter(t => newActivated.has(t.path));
      if (activatedArr.length > 0) {
        // Find the nearest activated tab after the closed index, otherwise before
        const after = activatedArr.find(t => tabs.indexOf(t) > closedIndex);
        const before = [...activatedArr].reverse().find(t => tabs.indexOf(t) < closedIndex);
        newActiveTab = (after || before)?.path ?? activatedArr[0].path;
      } else {
        newActiveTab = null;
      }
      setActiveTerminalTab(newActiveTab);
    }

    // Update refs synchronously for broadcast
    activatedTerminalsRef.current = newActivated;
    activeTerminalTabRef.current = newActiveTab;

    scheduleBroadcast();
  }, [scheduleBroadcast]);

  const handleCloseOtherTerminalTabs = useCallback((keepPath: string) => {
    const toClose = Array.from(activatedTerminalsRef.current).filter(p => p !== keepPath);
    if (toClose.length === 0) return;

    const newActivated = new Set([keepPath]);
    setActivatedTerminals(newActivated);

    // Remove closed terminals from mountedTerminals and close their PTY sessions
    setMountedTerminals(prev => {
      const next = new Set(prev);
      for (const p of toClose) next.delete(p);
      return next;
    });
    for (const p of toClose) {
      const sessionId = `pty-${p.replace(/[\/#]/g, '-')}`;
      callBackend('pty_close', { sessionId }).catch(() => {});
    }

    setActiveTerminalTab(keepPath);

    activatedTerminalsRef.current = newActivated;
    activeTerminalTabRef.current = keepPath;

    scheduleBroadcast();
  }, [scheduleBroadcast]);

  const handleCloseAllTerminalTabs = useCallback(() => {
    const toClose = Array.from(activatedTerminalsRef.current);
    if (toClose.length === 0) return;

    const newActivated = new Set<string>();
    setActivatedTerminals(newActivated);

    setMountedTerminals(prev => {
      const next = new Set(prev);
      for (const p of toClose) next.delete(p);
      return next;
    });
    for (const p of toClose) {
      const sessionId = `pty-${p.replace(/[\/#]/g, '-')}`;
      callBackend('pty_close', { sessionId }).catch(() => {});
    }

    setActiveTerminalTab(null);

    activatedTerminalsRef.current = newActivated;
    activeTerminalTabRef.current = null;

    scheduleBroadcast();
  }, [scheduleBroadcast]);

  const handleDuplicateTerminal = useCallback((path: string) => {
    const duplicatePath = `${path}#${Date.now()}`;
    const newActivated = new Set(activatedTerminalsRef.current).add(duplicatePath);

    setActivatedTerminals(newActivated);
    setActiveTerminalTab(duplicatePath);

    // Update refs synchronously for broadcast
    activatedTerminalsRef.current = newActivated;
    activeTerminalTabRef.current = duplicatePath;

    scheduleBroadcast();
  }, [scheduleBroadcast]);

  const handleToggleTerminal = useCallback(() => {
    const newVisible = !terminalVisibleRef.current;
    setTerminalVisible(newVisible);

    // Update ref synchronously
    terminalVisibleRef.current = newVisible;

    // If opening terminal and no active tab, activate the workspace root terminal
    if (newVisible && !activeTerminalTabRef.current && currentWorkspaceRoot) {
      setActiveTerminalTab(currentWorkspaceRoot);
      if (!activatedTerminalsRef.current.has(currentWorkspaceRoot)) {
        const newActivated = new Set(activatedTerminalsRef.current).add(currentWorkspaceRoot);
        setActivatedTerminals(newActivated);
        activatedTerminalsRef.current = newActivated;
      }
      activeTerminalTabRef.current = currentWorkspaceRoot;
    }

    scheduleBroadcast();
  }, [currentWorkspaceRoot, scheduleBroadcast]);

  // Remove all terminals matching a path prefix (e.g. when archiving a worktree).
  // PTY sessions are cleaned up by the backend (close_sessions_by_path_prefix).
  // This only clears frontend state (mounted/activated terminals).
  const cleanupTerminalsForPath = useCallback((pathPrefix: string) => {
    const matches = (p: string) => p.startsWith(pathPrefix) || p.split('#')[0].startsWith(pathPrefix);
    setMountedTerminals(prev => {
      const next = new Set(prev);
      for (const p of prev) if (matches(p)) next.delete(p);
      return next.size === prev.size ? prev : next;
    });
    setActivatedTerminals(prev => {
      const next = new Set(prev);
      for (const p of prev) if (matches(p)) next.delete(p);
      return next.size === prev.size ? prev : next;
    });
    // Also clean saved per-workspace state
    for (const [key, set] of activatedPerWorkspace.current) {
      if (matches(key)) {
        activatedPerWorkspace.current.delete(key);
        activeTabPerWorkspace.current.delete(key);
      } else {
        for (const p of set) if (matches(p)) set.delete(p);
      }
    }
  }, []);

  return {
    terminalVisible,
    terminalHeight,
    isResizing,
    activatedTerminals,
    mountedTerminals,
    activeTerminalTab,
    terminalTabs,
    setTerminalVisible,
    setTerminalHeight,
    setIsResizing,
    handleTerminalTabClick,
    handleCloseTerminalTab,
    handleCloseOtherTerminalTabs,
    handleCloseAllTerminalTabs,
    handleDuplicateTerminal,
    handleToggleTerminal,
    cleanupTerminalsForPath,
  };
}
