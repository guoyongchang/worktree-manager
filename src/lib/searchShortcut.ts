export type AdaptiveSearchTarget = 'terminal' | 'sidebar' | 'main-projects' | 'expand-sidebar';

export interface FindShortcutEventLike {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
}

export function isFindShortcut(e: FindShortcutEventLike): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f';
}

export function isBlockingFindShortcut(
  activeEl: Element | null,
  extraModalOpen = false,
): boolean {
  if (extraModalOpen) return true;
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [aria-modal="true"]')) {
    return true;
  }
  if (activeEl?.closest?.('.monaco-editor')) {
    return true;
  }
  return false;
}

export interface AdaptiveSearchContext {
  root: HTMLElement;
  activeEl: Element | null;
  terminalVisible: boolean;
  hasActiveTerminal: boolean;
  terminalFullscreen: false | 'vertical' | 'full';
  sidebarCollapsed: boolean;
  isMainWorkspace: boolean;
}

function hasSearchInput(root: HTMLElement, kind: 'main-projects' | 'sidebar'): boolean {
  return root.querySelector<HTMLInputElement>(`input[data-search-input="${kind}"]`) !== null;
}

export function resolveAdaptiveSearchTarget(
  ctx: AdaptiveSearchContext,
): AdaptiveSearchTarget | null {
  const {
    root,
    activeEl,
    terminalVisible,
    hasActiveTerminal,
    terminalFullscreen,
    sidebarCollapsed,
    isMainWorkspace,
  } = ctx;

  const canSearchTerminal = terminalVisible && hasActiveTerminal;
  const inRoot = !!(activeEl && root.contains(activeEl));
  const inTerminal = inRoot && !!activeEl.closest('[data-search-scope="terminal"]');
  const inSidebar = inRoot && !!activeEl.closest('[data-search-scope="sidebar"]');

  // 1. Focus inside terminal panel -> always search terminal when active
  if (inTerminal && canSearchTerminal) {
    return 'terminal';
  }

  // 2. Full-screen terminal hides both sidebar and detail pane
  if (terminalFullscreen === 'full') {
    return canSearchTerminal ? 'terminal' : null;
  }

  // 3. Focus inside expanded sidebar -> search worktrees in sidebar
  if (inSidebar && !sidebarCollapsed && hasSearchInput(root, 'sidebar')) {
    return 'sidebar';
  }

  // 4. Vertical fullscreen hides detail pane while keeping sidebar + terminal
  if (terminalFullscreen === 'vertical') {
    if (canSearchTerminal) return 'terminal';
    if (!sidebarCollapsed && hasSearchInput(root, 'sidebar')) return 'sidebar';
    return null;
  }

  // 5. Main workspace view -> prefer main project search, fallback to sidebar / terminal
  if (isMainWorkspace) {
    if (hasSearchInput(root, 'main-projects')) {
      return 'main-projects';
    }
    if (!sidebarCollapsed && hasSearchInput(root, 'sidebar')) {
      return 'sidebar';
    }
    if (canSearchTerminal) {
      return 'terminal';
    }
    if (sidebarCollapsed) {
      return 'expand-sidebar';
    }
    return null;
  }

  // 6. Worktree detail view -> prefer sidebar worktree search, fallback to terminal or expand sidebar
  if (!sidebarCollapsed && hasSearchInput(root, 'sidebar')) {
    return 'sidebar';
  }
  if (canSearchTerminal) {
    return 'terminal';
  }
  if (sidebarCollapsed) {
    return 'expand-sidebar';
  }
  return null;
}

export function focusSearchInput(
  root: HTMLElement,
  kind: 'main-projects' | 'sidebar',
): boolean {
  const input = root.querySelector<HTMLInputElement>(`input[data-search-input="${kind}"]`);
  if (!input) return false;
  input.focus();
  input.select();
  if (typeof input.scrollIntoView === 'function') {
    input.scrollIntoView({ block: 'nearest' });
  }
  return true;
}
