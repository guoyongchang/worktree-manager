import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorktreeDetail } from './WorktreeDetail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/backend', () => ({
  isTauri: () => false,
  openLink: vi.fn(),
}));

vi.mock('./GitOperations', () => ({
  GitOperations: () => <div data-testid="git-operations" />,
}));

vi.mock('./ChangedFilesPanel', () => ({
  ChangedFilesPanel: () => <div data-testid="changed-files-panel" />,
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
});
