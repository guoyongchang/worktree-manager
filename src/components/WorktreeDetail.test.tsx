import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;

import { WorktreeDetail } from './WorktreeDetail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.matched !== undefined && opts?.total !== undefined
        ? `${key}:${opts.matched}/${opts.total}`
        : opts?.query !== undefined
          ? `${key}:${opts.query}`
          : key,
  }),
}));

vi.mock('@/lib/backend', () => ({
  isTauri: () => false,
  getPlatform: () => 'mac',
  openLink: vi.fn(),
}));

vi.mock('./GitOperations', () => ({
  GitOperations: () => <div data-testid="git-operations" />,
}));

vi.mock('./ChangedFilesPanel', () => ({
  ChangedFilesPanel: () => <div data-testid="changed-files-panel" />,
}));

vi.mock('./Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('WorktreeDetail', () => {
  it('hides the changed files review tab and does not navigate when clicking uncommitted changes', () => {
    render(
      <WorktreeDetail
        selectedWorktree={{
          name: 'feature/remove-share',
          path: '/tmp/worktrees/feature-remove-share',
          is_archived: false,
          projects: [
            {
              name: 'frontend',
              path: '/tmp/worktrees/feature-remove-share/projects/frontend',
              current_branch: 'feature/remove-share',
              base_branch: 'main',
              test_branch: 'test',
              has_uncommitted: true,
              uncommitted_count: 3,
              is_merged_to_test: false,
              is_merged_to_base: false,
              ahead_of_base: 1,
              behind_base: 0,
              ahead_of_test: 1,
              unpushed_commits: 0,
              remote_url: '',
            },
          ],
        }}
        mainWorkspace={null}
        selectedEditor="vscode"
        showEditorMenu={false}
        onShowEditorMenu={vi.fn()}
        onSelectEditor={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onRevealInFinder={vi.fn()}
        onSwitchBranch={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        onClearError={vi.fn()}
        error={null}
      />
    );

    expect(screen.queryByText('detail.changedFilesReview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('changed-files-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('detail.uncommitted'));

    expect(screen.queryByTestId('changed-files-panel')).not.toBeInTheDocument();
  });

  it('filters main workspace projects by name, branch, and tag (including auto-expanding collapsed tag groups)', () => {
    localStorage.setItem('main_workspace_collapsed_tags', JSON.stringify(['tag-fin']));
    render(
      <WorktreeDetail
        selectedWorktree={null}
        mainWorkspace={{
          name: 'clp',
          path: '/ws/clp',
          projects: [
            {
              name: 'erp.finance.java.api',
              path: '/ws/clp/projects/erp.finance.java.api',
              current_branch: 'uat',
              base_branch: 'uat',
              test_branch: 'test',
              has_uncommitted: false,
              uncommitted_count: 0,
              is_merged_to_test: true,
              is_merged_to_base: true,
              ahead_of_base: 0,
              behind_base: 0,
              ahead_of_test: 0,
              unpushed_commits: 0,
              linked_folders: [],
            },
            {
              name: 'bpm.engine',
              path: '/ws/clp/projects/bpm.engine',
              current_branch: 'feature/workflow',
              base_branch: 'main',
              test_branch: 'test',
              has_uncommitted: false,
              uncommitted_count: 0,
              is_merged_to_test: true,
              is_merged_to_base: true,
              ahead_of_base: 0,
              behind_base: 0,
              ahead_of_test: 0,
              unpushed_commits: 0,
              linked_folders: [],
            },
          ],
        }}
        workspaceConfig={{
          name: 'clp',
          worktrees_dir: 'worktrees',
          projects: [
            { name: 'erp.finance.java.api', base_branch: 'uat', test_branch: 'test', merge_strategy: 'merge', linked_folders: [], tags: ['tag-fin'] },
            { name: 'bpm.engine', base_branch: 'main', test_branch: 'test', merge_strategy: 'merge', linked_folders: [] },
          ],
          linked_workspace_items: [],
          archived_worktrees: [],
          tags: [{ id: 'tag-fin', name: '财务模块', color: '#3b82f6' }],
        }}
        selectedEditor="vscode"
        showEditorMenu={false}
        onShowEditorMenu={vi.fn()}
        onSelectEditor={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onRevealInFinder={vi.fn()}
        onSwitchBranch={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        onClearError={vi.fn()}
        error={null}
      />,
    );

    const searchInput = screen.getByPlaceholderText('detail.searchProjects');

    // Collapsed tag group hides erp.finance.java.api initially, but searching auto-expands it
    expect(screen.queryByText('erp.finance.java.api')).not.toBeInTheDocument();

    // Search by project name substring
    fireEvent.change(searchInput, { target: { value: 'finance' } });
    expect(screen.getByText('detail.searchProjectsCount:1/2')).toBeInTheDocument();
    expect(screen.getByText('finance')).toBeInTheDocument();
    expect(screen.queryByText('bpm.engine')).not.toBeInTheDocument();

    // Search by current branch
    fireEvent.change(searchInput, { target: { value: 'workflow' } });
    expect(screen.getByText('detail.searchProjectsCount:1/2')).toBeInTheDocument();
    expect(screen.getByText('bpm.engine')).toBeInTheDocument();

    // Search by tag pinyin
    fireEvent.change(searchInput, { target: { value: 'caiwu' } });
    expect(screen.getByText('detail.searchProjectsCount:1/2')).toBeInTheDocument();
    expect(screen.getByText('erp.finance.java.api')).toBeInTheDocument();

    // Multi-keyword cross-field search (tag pinyin + project name)
    fireEvent.change(searchInput, { target: { value: 'caiwu api' } });
    expect(screen.getByText('detail.searchProjectsCount:1/2')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.queryByText('bpm.engine')).not.toBeInTheDocument();
    fireEvent.change(searchInput, { target: { value: 'caiwu bpm' } });
    expect(screen.getByText('detail.noProjectsMatch:caiwu bpm')).toBeInTheDocument();

    // Empty match state and clear button
    fireEvent.change(searchInput, { target: { value: 'does-not-exist' } });
    expect(screen.getByText('detail.noProjectsMatch:does-not-exist')).toBeInTheDocument();
    fireEvent.click(screen.getByText('detail.clearSearch'));
    expect(searchInput).toHaveValue('');

    // Escape clears active search
    fireEvent.change(searchInput, { target: { value: 'bpm' } });
    expect(searchInput).toHaveValue('bpm');
    fireEvent.keyDown(searchInput, { key: 'Escape' });
    expect(searchInput).toHaveValue('');
    localStorage.removeItem('main_workspace_collapsed_tags');
  });

  it('disables restore and delete buttons when archived worktree is being deleted in background', () => {
    render(
      <WorktreeDetail
        selectedWorktree={{
          name: 'archived-wt',
          path: '/tmp/worktrees/archived-wt',
          is_archived: true,
          projects: [],
        }}
        mainWorkspace={null}
        selectedEditor="vscode"
        showEditorMenu={false}
        onShowEditorMenu={vi.fn()}
        onSelectEditor={vi.fn()}
        onOpenInEditor={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onRevealInFinder={vi.fn()}
        onSwitchBranch={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
        deletingArchived={true}
        onClearError={vi.fn()}
        error={null}
      />,
    );

    expect(screen.getByRole('button', { name: 'detail.restore' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'detail.deleting' })).toBeDisabled();
  });
});
