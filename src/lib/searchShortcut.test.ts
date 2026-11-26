import { describe, expect, it } from 'vitest';
import {
  focusSearchInput,
  isBlockingFindShortcut,
  isFindShortcut,
  resolveAdaptiveSearchTarget,
} from './searchShortcut';
import { matchAnyTerm, matchText, splitSearchTerms } from './searchMatch';

function createWorkspaceDom(opts: {
  includeMainSearch?: boolean;
  includeSidebarSearch?: boolean;
  includeTerminal?: boolean;
} = {}) {
  const {
    includeMainSearch = true,
    includeSidebarSearch = true,
    includeTerminal = true,
  } = opts;

  const root = document.createElement('div');
  root.setAttribute('data-workspace-cell', '0-0');

  let sidebarInput: HTMLInputElement | null = null;
  let sidebarButton: HTMLButtonElement | null = null;
  if (includeSidebarSearch) {
    const sidebar = document.createElement('div');
    sidebar.setAttribute('data-search-scope', 'sidebar');
    sidebarInput = document.createElement('input');
    sidebarInput.setAttribute('data-search-input', 'sidebar');
    sidebarButton = document.createElement('button');
    sidebar.append(sidebarInput, sidebarButton);
    root.appendChild(sidebar);
  }

  let mainInput: HTMLInputElement | null = null;
  const detail = document.createElement('div');
  const detailButton = document.createElement('button');
  detail.appendChild(detailButton);
  if (includeMainSearch) {
    mainInput = document.createElement('input');
    mainInput.setAttribute('data-search-input', 'main-projects');
    detail.appendChild(mainInput);
  }
  root.appendChild(detail);

  let terminalInput: HTMLTextAreaElement | null = null;
  if (includeTerminal) {
    const terminal = document.createElement('div');
    terminal.setAttribute('data-search-scope', 'terminal');
    terminalInput = document.createElement('textarea');
    terminal.appendChild(terminalInput);
    root.appendChild(terminal);
  }

  document.body.innerHTML = '';
  document.body.appendChild(root);

  return { root, sidebarInput, sidebarButton, mainInput, detailButton, terminalInput };
}

describe('isFindShortcut', () => {
  it('matches Ctrl+F and Cmd+F case-insensitively and rejects extra modifiers', () => {
    expect(isFindShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'f' })).toBe(true);
    expect(isFindShortcut({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'F' })).toBe(true);
    expect(isFindShortcut({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'F' })).toBe(false);
    expect(isFindShortcut({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: 'f' })).toBe(false);
    expect(isFindShortcut({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: 'f' })).toBe(false);
  });
});

describe('isBlockingFindShortcut', () => {
  it('blocks when dialog, extra modal, or Monaco editor is active', () => {
    document.body.innerHTML = '';
    expect(isBlockingFindShortcut(document.body, false)).toBe(false);
    expect(isBlockingFindShortcut(document.body, true)).toBe(true);

    const monaco = document.createElement('div');
    monaco.className = 'monaco-editor';
    const editorInput = document.createElement('textarea');
    monaco.appendChild(editorInput);
    document.body.appendChild(monaco);
    expect(isBlockingFindShortcut(editorInput, false)).toBe(true);

    document.body.innerHTML = '<div role="dialog"></div>';
    expect(isBlockingFindShortcut(document.body, false)).toBe(true);
    document.body.innerHTML = '';
  });
});

describe('resolveAdaptiveSearchTarget', () => {
  it('prefers terminal search when focus is inside terminal panel or terminal is fullscreen', () => {
    const { root, terminalInput, detailButton } = createWorkspaceDom();

    expect(
      resolveAdaptiveSearchTarget({
        root,
        activeEl: terminalInput,
        terminalVisible: true,
        hasActiveTerminal: true,
        terminalFullscreen: false,
        sidebarCollapsed: false,
        isMainWorkspace: true,
      }),
    ).toBe('terminal');

    expect(
      resolveAdaptiveSearchTarget({
        root,
        activeEl: detailButton,
        terminalVisible: true,
        hasActiveTerminal: true,
        terminalFullscreen: 'full',
        sidebarCollapsed: false,
        isMainWorkspace: true,
      }),
    ).toBe('terminal');
  });

  it('prefers main workspace project search in main workspace, but routes to sidebar when focus is in sidebar', () => {
    const { root, sidebarButton, detailButton } = createWorkspaceDom();

    expect(
      resolveAdaptiveSearchTarget({
        root,
        activeEl: detailButton,
        terminalVisible: true,
        hasActiveTerminal: true,
        terminalFullscreen: false,
        sidebarCollapsed: false,
        isMainWorkspace: true,
      }),
    ).toBe('main-projects');

    expect(
      resolveAdaptiveSearchTarget({
        root,
        activeEl: sidebarButton,
        terminalVisible: true,
        hasActiveTerminal: true,
        terminalFullscreen: false,
        sidebarCollapsed: false,
        isMainWorkspace: true,
      }),
    ).toBe('sidebar');
  });

  it('routes to sidebar in worktree view, falling back to terminal or expanding collapsed sidebar', () => {
    const { root, detailButton } = createWorkspaceDom({ includeMainSearch: false });

    expect(
      resolveAdaptiveSearchTarget({
        root,
        activeEl: detailButton,
        terminalVisible: true,
        hasActiveTerminal: true,
        terminalFullscreen: false,
        sidebarCollapsed: false,
        isMainWorkspace: false,
      }),
    ).toBe('sidebar');

    expect(
      resolveAdaptiveSearchTarget({
        root,
        activeEl: detailButton,
        terminalVisible: true,
        hasActiveTerminal: true,
        terminalFullscreen: false,
        sidebarCollapsed: true,
        isMainWorkspace: false,
      }),
    ).toBe('terminal');

    expect(
      resolveAdaptiveSearchTarget({
        root,
        activeEl: detailButton,
        terminalVisible: false,
        hasActiveTerminal: false,
        terminalFullscreen: false,
        sidebarCollapsed: true,
        isMainWorkspace: false,
      }),
    ).toBe('expand-sidebar');
  });

  it('focusSearchInput focuses and selects the requested input', () => {
    const { root, mainInput } = createWorkspaceDom();
    mainInput!.value = 'finance';
    expect(focusSearchInput(root, 'main-projects')).toBe(true);
    expect(document.activeElement).toBe(mainInput);
  });
});

describe('multi-keyword searchMatch', () => {
  it('matches all space-separated keywords (AND) and returns merged highlight ranges', () => {
    expect(splitSearchTerms('  erp   api  ')).toEqual(['erp', 'api']);

    const hit = matchText('erp.finance.java.api', 'finance api');
    expect(hit.matched).toBe(true);
    if (hit.matched && hit.type === 'substring') {
      expect(hit.ranges).toEqual([
        { index: 4, length: 7 },
        { index: 17, length: 3 },
      ]);
    }

    expect(matchText('erp.finance.java.api', 'finance missing')).toEqual({ matched: false });

    const crossField = matchAnyTerm('erp.finance.java.api', ['财务', 'api']);
    expect(crossField).toMatchObject({ matched: true, type: 'substring', index: 17, length: 3 });
  });
});
