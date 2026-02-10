import { useState, useEffect, useCallback, useRef } from 'react';
import type { TerminalTab, MainWorkspaceStatus, WorktreeListItem } from '../types';
import { TERMINAL } from '../constants';

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
  clearActivatedTerminals: () => void;
}

export function useTerminal(
  selectedWorktree: WorktreeListItem | null,
  mainWorkspace: MainWorkspaceStatus | null
): UseTerminalReturn {
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState<number>(TERMINAL.DEFAULT_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const [activatedTerminals, setActivatedTerminals] = useState<Set<string>>(new Set());
  const [activeTerminalTab, setActiveTerminalTab] = useState<string | null>(null);

  // Remember active tab per workspace root, so switching back restores it
  const activeTabPerWorkspace = useRef<Map<string, string>>(new Map());
  const prevWorkspaceRoot = useRef<string>('');

  const currentWorkspaceRoot = selectedWorktree?.path || mainWorkspace?.path || '';

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

  // Save/restore active tab when workspace root changes
  useEffect(() => {
    const prev = prevWorkspaceRoot.current;

    if (prev && prev !== currentWorkspaceRoot && activeTerminalTab) {
      // Save current active tab for the previous workspace
      activeTabPerWorkspace.current.set(prev, activeTerminalTab);
    }

    if (currentWorkspaceRoot && currentWorkspaceRoot !== prev) {
      // Restore saved active tab for the new workspace (if any)
      const savedTab = activeTabPerWorkspace.current.get(currentWorkspaceRoot);
      if (savedTab && activatedTerminals.has(savedTab)) {
        setActiveTerminalTab(savedTab);
      } else {
        setActiveTerminalTab(null);
      }
    }

    prevWorkspaceRoot.current = currentWorkspaceRoot;
  }, [currentWorkspaceRoot]);

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

  const clearActivatedTerminals = useCallback(() => {
    setActivatedTerminals(new Set());
    setActiveTerminalTab(null);
    activeTabPerWorkspace.current.clear();
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
    clearActivatedTerminals,
  };
}
