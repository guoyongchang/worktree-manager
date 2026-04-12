import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitOperations } from './GitOperations';

const backend = vi.hoisted(() => ({
  syncWithBaseBranch: vi.fn(),
  pushToRemote: vi.fn(),
  mergeToTestBranch: vi.fn(),
  mergeToBaseBranch: vi.fn(),
  getBranchDiffStats: vi.fn(),
  checkRemoteBranchExists: vi.fn(),
  fetchProjectRemote: vi.fn(),
  getGitDiff: vi.fn(),
  commitAll: vi.fn(),
  generateCommitMessage: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/lib/backend', () => backend);

vi.mock('./CreatePRModal', () => ({
  CreatePRModal: () => null,
}));

describe('GitOperations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backend.getBranchDiffStats.mockResolvedValue({
      changed_files: 0,
      insertions: 0,
      deletions: 0,
      files: [],
    });
    backend.checkRemoteBranchExists.mockResolvedValue(true);
    backend.fetchProjectRemote.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('auto-refreshes a worktree project on a staggered schedule', async () => {
    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/project-a"
          baseBranch="main"
          testBranch="test"
          currentBranch="feature/demo"
          autoRefreshSlot={1}
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(backend.getBranchDiffStats).toHaveBeenCalledTimes(1);
    expect(backend.checkRemoteBranchExists).toHaveBeenCalledTimes(2);
    expect(backend.fetchProjectRemote).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(backend.fetchProjectRemote).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(backend.fetchProjectRemote).toHaveBeenCalledTimes(1);
  });
});
