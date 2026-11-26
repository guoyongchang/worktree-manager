import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddProjectToWorktreeModal } from './AddProjectToWorktreeModal';
import type { WorkspaceConfig, WorktreeListItem } from '../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined
        ? `${key}:${opts.count}`
        : opts?.details !== undefined
          ? `${key}:${opts.details}`
          : key,
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

const config: WorkspaceConfig = {
  name: 'clp',
  worktrees_dir: 'worktrees',
  projects: [
    { name: 'already-in', base_branch: 'uat', test_branch: 'test', merge_strategy: 'merge', linked_folders: [] },
    { name: 'erp.css.net', base_branch: 'uat', test_branch: 'test', merge_strategy: 'merge', linked_folders: [] },
    { name: 'erp.finance.web.react', base_branch: 'main', test_branch: 'test', merge_strategy: 'merge', linked_folders: [] },
    { name: 'bpm.engine', base_branch: 'master', test_branch: 'test', merge_strategy: 'merge', linked_folders: [] },
  ],
  linked_workspace_items: [],
  archived_worktrees: [],
};

const worktree: WorktreeListItem = {
  name: 'perp-101',
  path: '/ws/worktrees/perp-101',
  is_archived: false,
  projects: [
    {
      name: 'already-in',
      path: '/ws/worktrees/perp-101/projects/already-in',
      current_branch: 'perp-101',
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
      remote_url: '',
    },
  ],
};

describe('AddProjectToWorktreeModal multi-select', () => {
  it('allows selecting multiple available projects and submits all selected items', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ succeeded: ['erp.css.net', 'bpm.engine'], failed: [] });

    render(
      <AddProjectToWorktreeModal
        open={true}
        onOpenChange={vi.fn()}
        config={config}
        worktree={worktree}
        onSubmit={onSubmit}
        adding={false}
      />,
    );

    expect(screen.queryByText('already-in')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('erp.css.net'));
    fireEvent.click(screen.getByText('bpm.engine'));

    const submitBtn = screen.getByRole('button', { name: 'addProjectToWorktree.addProjectsCount:2' });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith([
        { projectName: 'erp.css.net', baseBranch: 'uat' },
        { projectName: 'bpm.engine', baseBranch: 'master' },
      ]);
    });
  });

  it('supports select-all and keeps only failed projects selected after partial failure', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      succeeded: ['erp.css.net', 'bpm.engine'],
      failed: [{ projectName: 'erp.finance.web.react', error: 'branch conflict' }],
    });

    render(
      <AddProjectToWorktreeModal
        open={true}
        onOpenChange={vi.fn()}
        config={config}
        worktree={worktree}
        onSubmit={onSubmit}
        adding={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'addProjectToWorktree.selectAll' }));
    const submitBtn = screen.getByRole('button', { name: 'addProjectToWorktree.addProjectsCount:3' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/erp\.finance\.web\.react: branch conflict/)).toBeInTheDocument();
    });

    // Only the failed project remains checked for easy retry
    expect(screen.getByRole('checkbox', { name: 'erp.finance.web.react' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'erp.css.net' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'bpm.engine' })).not.toBeChecked();
  });
});
