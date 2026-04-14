import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExpandedSidebar } from './ExpandedSidebar';
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
  it('filters active worktrees by fuzzy display_name and name matches', () => {
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

    const searchInput = screen.getByPlaceholderText('sidebar.searchWorktrees');

    fireEvent.change(searchInput, { target: { value: 'shell' } });
    expect(screen.getByText('Alpha Shell')).toBeInTheDocument();
    expect(screen.queryByText('Gamma Workspace')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'fallback' } });
    expect(screen.getByText('Gamma Workspace')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Shell')).not.toBeInTheDocument();
  });

  it('shows a dedicated empty state when the search has no matches', () => {
    renderSidebar([
      makeWorktree({
        name: 'feature/alpha-shell',
        display_name: 'Alpha Shell',
      }),
    ]);

    fireEvent.change(screen.getByPlaceholderText('sidebar.searchWorktrees'), {
      target: { value: 'missing' },
    });

    expect(screen.getByText('sidebar.noSearchResults')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Shell')).not.toBeInTheDocument();
    expect(screen.queryByText('sidebar.noWorktrees')).not.toBeInTheDocument();
  });
});
