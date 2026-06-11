import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExpandedSidebar, highlightWorktreeName, matchWorktreeName } from './ExpandedSidebar';
import type { MainWorkspaceStatus, WorktreeListItem, WorkspaceRef } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'sidebar.projects' && typeof options?.count === 'number') {
        return `${options.count} projects`;
      }

      if (key === 'sidebar.active' && typeof options?.count === 'number') {
        return `Active (${options.count})`;
      }

      return key;
    },
  }),
}));

const { backendMock } = vi.hoisted(() => ({
  backendMock: {
  callBackend: vi.fn(),
  getAppVersion: vi.fn().mockResolvedValue('0.1.2'),
  isMainWindow: vi.fn().mockResolvedValue(true),
  openLink: vi.fn(),
  },
}));

vi.mock('../../lib/backend', () => backendMock);
vi.mock('@/lib/backend', () => backendMock);

vi.mock('./ShareBar', () => ({
  ShareBar: () => <div data-testid="share-bar" />,
}));

const workspaces: WorkspaceRef[] = [
  { name: 'Main Workspace', path: '/workspace' },
];

const mainWorkspace: MainWorkspaceStatus = {
  name: 'Main Workspace',
  path: '/workspace',
  projects: [],
};

function makeWorktree(overrides: Partial<WorktreeListItem>): WorktreeListItem {
  return {
    name: 'feature/default',
    path: '/workspace/worktrees/default',
    is_archived: false,
    projects: [],
    ...overrides,
  };
}

function renderSidebar(activeWorktrees: WorktreeListItem[]) {
  const props: React.ComponentProps<typeof ExpandedSidebar> = {
    activeWorktrees,
    archivedWorktrees: [],
    collapsed: false,
    connectedClients: [],
    currentWindowLabel: 'main',
    currentWorkspace: workspaces[0],
    hasLastConfig: false,
    hasNgrokToken: false,
    isTauri: true,
    lockedWorktrees: {},
    longPressFiredRef: { current: false },
    mainWorkspace,
    ngrokLoading: false,
    occupation: null,
    onAddWorkspace: vi.fn(),
    onCheckUpdate: vi.fn(),
    onContextMenu: vi.fn(),
    onKickClient: vi.fn(),
    onOpenCreateModal: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onOpenSettings: vi.fn(),
    onQuickShare: vi.fn(),
    onRefresh: vi.fn(),
    onSelectWorktree: vi.fn(),
    onShowWorkspaceMenu: vi.fn(),
    onSortOrderChange: vi.fn(),
    onStartShare: vi.fn(),
    onStopShare: vi.fn(),
    onSwitchWorkspace: vi.fn(),
    onToggleArchived: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onToggleNgrok: vi.fn(),
    onTouchEnd: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchStart: vi.fn(),
    onUpdateSharePassword: vi.fn(),
    batchArchiveModalOpen: false,
    onToggleBatchArchiveModal: vi.fn(),
    onBatchRestore: vi.fn(),
    onBatchDelete: vi.fn(),
    refreshing: false,
    selectedWorktree: null,
    setSidebarWidth: vi.fn(),
    shareActive: false,
    shareNgrokUrl: null,
    sharePassword: '',
    shareUrls: [],
    showArchived: false,
    showWorkspaceMenu: false,
    sidebarWidth: 288,
    switchingWorkspace: false,
    updaterState: 'idle',
    workspaces,
  };

  return render(<ExpandedSidebar {...props} />);
}

describe('ExpandedSidebar worktree search', () => {
  it('shows all active worktrees when there is no query (highlight-instead-of-filter)', async () => {
    vi.useFakeTimers();
    renderSidebar([
      makeWorktree({
        name: 'feature/alpha-shell',
        display_name: 'Alpha Shell',
      }),
      makeWorktree({
        name: 'bugfix/fallback-match',
        display_name: 'Gamma Workspace',
        path: '/workspace/worktrees/fallback',
      }),
    ]);

    // Both items are visible without any search query
    expect(screen.getByText('Alpha Shell')).toBeInTheDocument();
    expect(screen.getByText('Gamma Workspace')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows all worktrees even when query does not match (highlight-instead-of-filter)', async () => {
    vi.useFakeTimers();
    renderSidebar([
      makeWorktree({
        name: 'feature/alpha-shell',
        display_name: 'Alpha Shell',
      }),
    ]);

    const searchInput = screen.getByPlaceholderText('sidebar.searchWorktrees');
    fireEvent.change(searchInput, { target: { value: 'missing' } });

    // Advance debounce timer
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // Item still visible — no filtering, only highlighting
    expect(screen.getByText('Alpha Shell')).toBeInTheDocument();
    // No "noSearchResults" empty state
    expect(screen.queryByText('sidebar.noSearchResults')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows noWorktrees empty state when activeWorktrees is empty', () => {
    renderSidebar([]);
    expect(screen.getByText('sidebar.noWorktrees')).toBeInTheDocument();
  });
});

describe('matchWorktreeName', () => {
  it('returns matched=false for empty query', () => {
    expect(matchWorktreeName('feature-foo', '')).toEqual({ matched: false });
  });

  it('matches English substring', () => {
    const result = matchWorktreeName('feature-foo', 'foo');
    expect(result).toMatchObject({ matched: true, type: 'substring', index: 8, length: 3 });
  });

  it('matches case-insensitively', () => {
    const result = matchWorktreeName('FeatureFoo', 'feature');
    expect(result).toMatchObject({ matched: true, type: 'substring' });
  });

  it('returns matched=false when no match', () => {
    expect(matchWorktreeName('feature-foo', 'xyz')).toEqual({ matched: false });
  });
});

describe('highlightWorktreeName', () => {
  it('returns plain string when not matched', () => {
    const node = highlightWorktreeName('feature-foo', { matched: false });
    expect(node).toBe('feature-foo');
  });
});
