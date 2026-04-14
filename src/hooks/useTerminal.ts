import { useState, useEffect, useCallback, useRef } from 'react';
import i18next from 'i18next';
import type { TerminalTab, MainWorkspaceStatus, WorktreeListItem } from '../types';
import { TERMINAL, clampTerminalHeight } from '../constants';
import { callBackend, closePtySessionsByPath, isTauri, broadcastTerminalState as broadcastTerminalStateBackend, getTerminalState } from '../lib/backend';
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
  cleanupTerminalsForPath: (pathPrefix: string) => Promise<void>;
  clientId: string;
}

/** Close a single PTY session by path */
function closePtySession(path: string): void {
  const sessionId = `pty-${path.replace(/[/#]/g, '-')}`;
  callBackend('pty_close', { sessionId }).catch(() => { });
}

export function useTerminal(
  selectedWorktree: WorktreeListItem | null,
  mainWorkspace: MainWorkspaceStatus | null,
  workspacePathParam?: string
): UseTerminalReturn {
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeightState] = useState<number>(() => {
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : TERMINAL.MAX_HEIGHT;
    return clampTerminalHeight(TERMINAL.DEFAULT_HEIGHT, viewportHeight);
  });
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

  // Unique client ID for self-echo filtering
  const clientIdRef = useRef(
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  );
  const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBroadcastTime = useRef<number>(0);

  const currentWorkspaceRoot = selectedWorktree?.path || mainWorkspace?.path || '';
  const _isTauri = isTauri();


  const workspacePath = workspacePathParam || '';
  const worktreeName = selectedWorktree?.name || '';

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

  const activatedTerminalsRef = useRef(activatedTerminals);
  activatedTerminalsRef.current = activatedTerminals;
  const activeTerminalTabRef = useRef(activeTerminalTab);
  activeTerminalTabRef.current = activeTerminalTab;
  const terminalVisibleRef = useRef(terminalVisible);
  terminalVisibleRef.current = terminalVisible;

  const setTerminalHeight = useCallback((next: number | ((prev: number) => number)) => {
    setTerminalHeightState((prev) => {
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : TERMINAL.MAX_HEIGHT;
      const resolved = typeof next === 'function' ? next(prev) : next;
      return clampTerminalHeight(resolved, viewportHeight);
    });
  }, []);

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

  const scheduleBroadcast = useCallback(() => {
    if (!workspacePath || !worktreeName) return;

    const doBroadcast = () => {
      const tabs = Array.from(activatedTerminalsRef.current);
      const active = activeTerminalTabRef.current;
      const visible = terminalVisibleRef.current;
      const clientId = clientIdRef.current;

      if (import.meta.env.DEV) {
        console.log('[useTerminal] broadcast:', 'tabs:', tabs, 'active:', active);
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

  // Save/restore terminal state on workspace root change
  useEffect(() => {
    const prev = prevWorkspaceRoot.current;

    if (prev && prev !== currentWorkspaceRoot) {
      const currentTab = activeTerminalTabRef.current;
      if (currentTab) {
        activeTabPerWorkspace.current.set(prev, currentTab);
      }
      activatedPerWorkspace.current.set(prev, new Set(activatedTerminalsRef.current));
      visiblePerWorkspace.current.set(prev, terminalVisibleRef.current);
    }

    if (currentWorkspaceRoot && currentWorkspaceRoot !== prev) {
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

      // Fetch authoritative state from backend cache
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

        // Update local map for fast restore
        activatedPerWorkspace.current.set(wsRoot, cachedActivated);
        if (cached.active_terminal_tab) {
          activeTabPerWorkspace.current.set(wsRoot, cached.active_terminal_tab);
        }
        visiblePerWorkspace.current.set(wsRoot, cached.terminal_visible);
      }).catch(() => { });
    }

    prevWorkspaceRoot.current = currentWorkspaceRoot;
  }, [currentWorkspaceRoot, workspacePath, worktreeName]);

  // Shared handler for incoming terminal state messages
  const handleTerminalStateMessage = useCallback((msg: {
    workspacePath?: string;
    worktreeName?: string;
    activatedTerminals: string[];
    activeTerminalTab: string | null;
    terminalVisible: boolean;
    clientId?: string;
  }) => {
    // Self-echo filter
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

  // Terminal state sync subscription
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

  // Terminal resize drag (mouse + touch)
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY;
      setTerminalHeight(newHeight);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const newHeight = window.innerHeight - e.touches[0].clientY;
      setTerminalHeight(newHeight);
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

  useEffect(() => {
    const handleWindowResize = () => {
      setTerminalHeight((prev) => prev);
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [setTerminalHeight]);

  const handleTerminalTabClick = useCallback((projectPath: string) => {
    if (!terminalVisibleRef.current) setTerminalVisible(true);
    setActiveTerminalTab(projectPath);
    if (!activatedTerminalsRef.current.has(projectPath)) {
      setActivatedTerminals(prev => new Set(prev).add(projectPath));
    }

    terminalVisibleRef.current = true;
    activeTerminalTabRef.current = projectPath;
    if (!activatedTerminalsRef.current.has(projectPath)) {
      activatedTerminalsRef.current = new Set(activatedTerminalsRef.current).add(projectPath);
    }

    scheduleBroadcast();
    // Trigger terminal resize
    setTerminalHeight(prev => prev - TERMINAL.RESIZE_TRIGGER_OFFSET);
    setTimeout(() => {
      setTerminalHeight(prev => prev + TERMINAL.RESIZE_TRIGGER_OFFSET);
    }, TERMINAL.RESIZE_DELAY_MS);
  }, [scheduleBroadcast]);

  const handleCloseTerminalTab = useCallback((path: string) => {
    const newActivated = new Set(activatedTerminalsRef.current);
    newActivated.delete(path);
    setActivatedTerminals(newActivated);

    // Unmount terminal and close PTY
    setMountedTerminals(prev => { const next = new Set(prev); next.delete(path); return next; });
    closePtySession(path);

    let newActiveTab = activeTerminalTabRef.current;
    if (activeTerminalTabRef.current === path) {
      const tabs = terminalTabsRef.current;
      const closedIndex = tabs.findIndex(t => t.path === path);
      const activatedArr = tabs.filter(t => newActivated.has(t.path));
      if (activatedArr.length > 0) {
        const after = activatedArr.find(t => tabs.indexOf(t) > closedIndex);
        const before = [...activatedArr].reverse().find(t => tabs.indexOf(t) < closedIndex);
        newActiveTab = (after || before)?.path ?? activatedArr[0].path;
      } else {
        newActiveTab = null;
      }
      setActiveTerminalTab(newActiveTab);
    }

    activatedTerminalsRef.current = newActivated;
    activeTerminalTabRef.current = newActiveTab;
    scheduleBroadcast();
  }, [scheduleBroadcast]);

  const handleCloseOtherTerminalTabs = useCallback((keepPath: string) => {
    const toClose = Array.from(activatedTerminalsRef.current).filter(p => p !== keepPath);
    if (toClose.length === 0) return;

    const newActivated = new Set([keepPath]);
    setActivatedTerminals(newActivated);

    setMountedTerminals(prev => {
      const next = new Set(prev);
      for (const p of toClose) next.delete(p);
      return next;
    });
    for (const p of toClose) closePtySession(p);

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
    for (const p of toClose) closePtySession(p);

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
    activatedTerminalsRef.current = newActivated;
    activeTerminalTabRef.current = duplicatePath;
    scheduleBroadcast();
  }, [scheduleBroadcast]);

  const handleToggleTerminal = useCallback(() => {
    const newVisible = !terminalVisibleRef.current;
    setTerminalVisible(newVisible);
    terminalVisibleRef.current = newVisible;

    // Opening terminal with no active tab: auto-activate workspace root
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

  // Remove all terminals matching a path prefix (e.g. worktree archive)
  const cleanupTerminalsForPath = useCallback(async (pathPrefix: string) => {
    const matches = (p: string) => p.startsWith(pathPrefix) || p.split('#')[0].startsWith(pathPrefix);

    try {
      await closePtySessionsByPath(pathPrefix);
    } catch {
      // Ignore PTY cleanup failures and still clear local UI state.
    }

    setMountedTerminals(prev => {
      const next = new Set(prev);
      for (const p of prev) if (matches(p)) next.delete(p);
      return next.size === prev.size ? prev : next;
    });

    const newActivated = new Set(activatedTerminalsRef.current);
    for (const p of activatedTerminalsRef.current) {
      if (matches(p)) newActivated.delete(p);
    }
    setActivatedTerminals(newActivated);
    activatedTerminalsRef.current = newActivated;

    const nextActive =
      activeTerminalTabRef.current && matches(activeTerminalTabRef.current)
        ? Array.from(newActivated)[0] ?? null
        : activeTerminalTabRef.current;
    if (nextActive !== activeTerminalTabRef.current) {
      setActiveTerminalTab(nextActive);
      activeTerminalTabRef.current = nextActive;
    }

    if (newActivated.size === 0 && terminalVisibleRef.current) {
      setTerminalVisible(false);
      terminalVisibleRef.current = false;
    }

    for (const [key, set] of activatedPerWorkspace.current) {
      if (matches(key)) {
        activatedPerWorkspace.current.delete(key);
        activeTabPerWorkspace.current.delete(key);
      } else {
        for (const p of set) if (matches(p)) set.delete(p);
      }
    }
    scheduleBroadcast();
  }, [scheduleBroadcast]);

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
    clientId: clientIdRef.current,
  };
}
