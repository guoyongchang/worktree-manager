import { useState, useEffect, useCallback, useRef } from 'react';
import type { TerminalTab, MainWorkspaceStatus, WorktreeListItem } from '../types';
import { TERMINAL } from '../constants';
import { isTauri, broadcastTerminalState as broadcastTerminalStateBackend } from '../lib/backend';
import { getWebSocketManager } from '../lib/websocket';
import { listen } from '@tauri-apps/api/event';

export interface UseTerminalReturn {
  terminalVisible: boolean;
  terminalHeight: number;
  isResizing: boolean;
  activatedTerminals: Set<string>;
  activeTerminalTab: string | null;
  terminalTabs: TerminalTab[];
  setTerminalVisible: (visible: boolean) => void;
  setTerminalHeight: (height: number) => void;
  setIsResizing: (resizing: boolean) => void;
  handleTerminalTabClick: (path: string) => void;
  handleCloseTerminalTab: (path: string) => void;
  handleDuplicateTerminal: (path: string) => void;
  handleToggleTerminal: () => void;
  resetActiveTab: () => void;
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

  // Remember active tab & activated terminals per workspace root, so switching back restores them
  const activeTabPerWorkspace = useRef<Map<string, string>>(new Map());
  const activatedPerWorkspace = useRef<Map<string, Set<string>>>(new Map());
  const prevWorkspaceRoot = useRef<string>('');

  // Prevent broadcast loops: track if receiving external updates
  const isReceivingUpdate = useRef(false);
  // Debounce timer for broadcast rate limiting
  const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last broadcast timestamp for rate limiting
  const lastBroadcastTime = useRef<number>(0);
  // Message sequence number for deduplication
  const messageSequence = useRef<number>(0);
  // Last received sequence number to detect duplicates
  const lastReceivedSequence = useRef<number>(-1);

  const currentWorkspaceRoot = selectedWorktree?.path || mainWorkspace?.path || '';
  const _isTauri = isTauri();

  // Get workspace path for broadcasting (needed for both desktop and web)
  const workspacePath = workspacePathParam || '';
  const worktreeName = selectedWorktree?.name || '';

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
    { name: '工作区', path: currentWorkspaceRoot, isRoot: true, isDuplicate: false },
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
    }

    if (currentWorkspaceRoot && currentWorkspaceRoot !== prev) {
      // Restore state for the new workspace (or reset to empty)
      const savedActivated = activatedPerWorkspace.current.get(currentWorkspaceRoot);
      const savedTab = activeTabPerWorkspace.current.get(currentWorkspaceRoot);

      setActivatedTerminals(savedActivated || new Set());
      if (savedTab && savedActivated?.has(savedTab)) {
        setActiveTerminalTab(savedTab);
      } else {
        setActiveTerminalTab(null);
      }
    }

    prevWorkspaceRoot.current = currentWorkspaceRoot;
  }, [currentWorkspaceRoot]);

  // Shared handler for incoming terminal state messages (used by both Tauri and WebSocket)
  // Uses refs for current state to keep callback stable (no state dependencies)
  const handleTerminalStateMessage = useCallback((msg: {
    workspacePath?: string;
    worktreeName?: string;
    activatedTerminals: string[];
    activeTerminalTab: string | null;
    terminalVisible: boolean;
    sequence?: number;
  }) => {
    const sequence = msg.sequence;
    if (sequence !== undefined && sequence <= lastReceivedSequence.current) {
      return;
    }

    if (sequence !== undefined) {
      lastReceivedSequence.current = sequence;
    }

    isReceivingUpdate.current = true;

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

    setTimeout(() => {
      isReceivingUpdate.current = false;
    }, TERMINAL.BROADCAST_DEBOUNCE_MS);
  }, []);

  // Terminal state synchronization: both desktop and web subscribe and broadcast
  // handleTerminalStateMessage is now stable (no state deps), so this effect only re-runs
  // when workspace/worktree identity changes — no more cascade re-subscriptions
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
        sequence?: number;
      }>('terminal-state-update', (event) => {
        // Filter by workspace/worktree identity here (since callback no longer has these deps)
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
        (msg) => handleTerminalStateMessage(msg as any),
      );
    }

    return unsubscribe;
  }, [selectedWorktree, workspacePath, worktreeName, _isTauri, handleTerminalStateMessage]);

  // Track whether the user has interacted with terminal state (skip initial broadcasts)
  const hasUserInteracted = useRef(false);

  // Broadcast terminal state changes (both desktop and web) with rate limiting
  useEffect(() => {
    // If receiving external update, don't broadcast (avoid loop)
    if (isReceivingUpdate.current) return;

    if (!selectedWorktree || !workspacePath || !worktreeName) return;

    // Skip broadcasting empty/initial state — nothing useful to sync
    if (activatedTerminals.size === 0 && activeTerminalTab === null && !terminalVisible) return;

    // Skip the very first state change to avoid broadcasting during initialization
    if (!hasUserInteracted.current) {
      hasUserInteracted.current = true;
      return;
    }

    // Rate limiting: prevent broadcasts more frequent than BROADCAST_RATE_LIMIT_MS
    const now = Date.now();
    const timeSinceLastBroadcast = now - lastBroadcastTime.current;

    const doBroadcast = () => {
      if (import.meta.env.DEV) {
        console.log('[useTerminal] Broadcasting terminal state:',
          'tabs:', Array.from(activatedTerminals), 'active:', activeTerminalTab);
      }

      // Increment sequence number for message deduplication
      messageSequence.current += 1;
      const sequence = messageSequence.current;

      // Bidirectional sync: both PC and Web broadcast terminal state changes
      if (_isTauri) {
        broadcastTerminalStateBackend(
          workspacePath,
          worktreeName,
          Array.from(activatedTerminals),
          activeTerminalTab,
          terminalVisible
        ).catch(err => {
          console.error('[useTerminal] Failed to broadcast terminal state:', err);
        });
      } else {
        const wsManager = getWebSocketManager();
        wsManager.broadcastTerminalState(
          workspacePath,
          worktreeName,
          Array.from(activatedTerminals),
          activeTerminalTab,
          terminalVisible,
          sequence
        );
      }

      lastBroadcastTime.current = Date.now();
    };

    // Clear any pending broadcast timer
    if (broadcastTimerRef.current) {
      clearTimeout(broadcastTimerRef.current);
    }

    // If enough time has passed, broadcast immediately
    if (timeSinceLastBroadcast >= TERMINAL.BROADCAST_RATE_LIMIT_MS) {
      doBroadcast();
    } else {
      // Otherwise, schedule broadcast after rate limit period
      const delay = TERMINAL.BROADCAST_RATE_LIMIT_MS - timeSinceLastBroadcast;
      broadcastTimerRef.current = setTimeout(doBroadcast, delay);
    }

    // Cleanup function
    return () => {
      if (broadcastTimerRef.current) {
        clearTimeout(broadcastTimerRef.current);
        broadcastTimerRef.current = null;
      }
    };
  }, [_isTauri, selectedWorktree, workspacePath, worktreeName, activatedTerminals, activeTerminalTab, terminalVisible]);

  // Handle terminal resize drag
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newHeight = window.innerHeight - e.clientY;
      setTerminalHeight(Math.max(TERMINAL.MIN_HEIGHT, Math.min(TERMINAL.MAX_HEIGHT, newHeight)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleTerminalTabClick = useCallback((projectPath: string) => {
    if (!terminalVisible) {
      setTerminalVisible(true);
    }
    setActiveTerminalTab(projectPath);
    if (!activatedTerminals.has(projectPath)) {
      setActivatedTerminals(prev => new Set(prev).add(projectPath));
    }

    // Trigger terminal resize by temporarily adjusting height
    // This ensures the CLI resets properly when switching terminals
    setTerminalHeight(prev => prev - TERMINAL.RESIZE_TRIGGER_OFFSET);
    setTimeout(() => {
      setTerminalHeight(prev => prev + TERMINAL.RESIZE_TRIGGER_OFFSET);
    }, TERMINAL.RESIZE_DELAY_MS);
  }, [terminalVisible, activatedTerminals]);

  const handleCloseTerminalTab = useCallback((path: string) => {
    setActivatedTerminals(prev => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    if (activeTerminalTab === path) {
      const remaining = Array.from(activatedTerminals).filter(p => p !== path);
      setActiveTerminalTab(remaining.length > 0 ? remaining[0] : null);
    }
  }, [activeTerminalTab, activatedTerminals]);

  const handleDuplicateTerminal = useCallback((path: string) => {
    const duplicatePath = `${path}#${Date.now()}`;
    setActivatedTerminals(prev => new Set(prev).add(duplicatePath));
    setActiveTerminalTab(duplicatePath);
  }, []);

  const handleToggleTerminal = useCallback(() => {
    const newVisible = !terminalVisible;
    setTerminalVisible(newVisible);

    // If opening terminal and no active tab, activate the workspace root terminal
    if (newVisible && !activeTerminalTab && currentWorkspaceRoot) {
      setActiveTerminalTab(currentWorkspaceRoot);
      if (!activatedTerminals.has(currentWorkspaceRoot)) {
        setActivatedTerminals(prev => new Set(prev).add(currentWorkspaceRoot));
      }
    }
  }, [terminalVisible, activeTerminalTab, currentWorkspaceRoot, activatedTerminals]);

  const resetActiveTab = useCallback(() => {
    // No-op: we now handle tab switching in the useEffect above
    // This is kept for API compatibility
  }, []);

  return {
    terminalVisible,
    terminalHeight,
    isResizing,
    activatedTerminals,
    activeTerminalTab,
    terminalTabs,
    setTerminalVisible,
    setTerminalHeight,
    setIsResizing,
    handleTerminalTabClick,
    handleCloseTerminalTab,
    handleDuplicateTerminal,
    handleToggleTerminal,
    resetActiveTab,
  };
}
