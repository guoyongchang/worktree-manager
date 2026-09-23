import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitOperations } from './GitOperations';

const backend = vi.hoisted(() => ({
  syncWithBaseBranch: vi.fn(),
  pushToRemote: vi.fn(),
  pullCurrentBranch: vi.fn(),
  mergeToTestBranch: vi.fn(),
  mergeToBaseBranch: vi.fn(),
  getBranchDiffStats: vi.fn(),
  checkRemoteBranchExists: vi.fn(),
  fetchProjectRemote: vi.fn(),
  getGitDiff: vi.fn(),
  commitAll: vi.fn(),
  generateCommitMessage: vi.fn(),
  checkCommitAiApiKey: vi.fn(),
  getCommitAiEnabled: vi.fn(),
  getCommitPrefixConfig: vi.fn(),
  getGitUserGlobalConfig: vi.fn(),
  getSkipGitHooks: vi.fn(),
  setGitUserConfig: vi.fn(),
  isTauri: vi.fn(() => false),
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
    backend.getCommitAiEnabled.mockResolvedValue(true);
    backend.checkCommitAiApiKey.mockResolvedValue(false);
    backend.getCommitPrefixConfig.mockResolvedValue({
      templates: ['[{{worktree-name}}]'],
      enabled: true,
      default_index: 0,
    });
    backend.getGitDiff.mockResolvedValue('diff --git a/file b/file');
    backend.generateCommitMessage.mockResolvedValue('fix(test): generated');
    backend.getSkipGitHooks.mockResolvedValue(false);
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
          projectName="project-a"
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
    expect(backend.getBranchDiffStats).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(backend.getBranchDiffStats).toHaveBeenCalledTimes(2);
    expect(backend.fetchProjectRemote).not.toHaveBeenCalled();
  });

  it('skips remote branch checks for non-git project status', async () => {
    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree"
          projectName="workspace-root"
          baseBranch="main"
          testBranch="test"
          currentBranch="unknown"
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(backend.getBranchDiffStats).toHaveBeenCalledTimes(1);
    expect(backend.checkRemoteBranchExists).not.toHaveBeenCalled();
  });

  it('auto-refresh does not call setLoading when onSilentRefresh is provided', async () => {
    const onSilentRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <GitOperations
        projectPath="/test"
        projectName="test"
        baseBranch="main"
        testBranch="test"
        currentBranch="feature"
        autoRefreshSlot={0}
        onSilentRefresh={onSilentRefresh}
      />
    );
    // Advance past AUTO_REFRESH_INTERVAL_MS (60000ms)
    await act(async () => {
      vi.advanceTimersByTime(61000);
      await Promise.resolve();
    });
    expect(onSilentRefresh).toHaveBeenCalled();
  });

  it('skips AI commit generation when commit AI is disabled', async () => {
    backend.getBranchDiffStats.mockResolvedValue({
      ahead: 0,
      behind: 0,
      ahead_of_test: 0,
      changed_files: 1,
      insertions: 2,
      deletions: 1,
      files: [],
    });
    backend.getCommitAiEnabled.mockResolvedValue(false);
    backend.checkCommitAiApiKey.mockResolvedValue(true);

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/project-a"
          projectName="project-a"
          baseBranch="main"
          testBranch="test"
          currentBranch="feature/demo"
        />
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const commitAndPush = screen.getByText('git.commitAndPush');
    await act(async () => {
      fireEvent.click(commitAndPush);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(backend.getCommitAiEnabled).toHaveBeenCalled();
    expect(backend.checkCommitAiApiKey).not.toHaveBeenCalled();
    expect(backend.getGitDiff).not.toHaveBeenCalled();
    expect(backend.generateCommitMessage).not.toHaveBeenCalled();
  });

  it('shows sync progress and does not refresh every remote', async () => {
    let resolveSync: (value: string) => void = () => {};
    backend.syncWithBaseBranch.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveSync = resolve;
      }),
    );
    const onSilentRefresh = vi.fn();

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/javascmapi"
          projectName="javascmapi"
          baseBranch="uat"
          testBranch="test"
          currentBranch="ERP-25666"
          onSilentRefresh={onSilentRefresh}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('git.syncBranch'));
      await Promise.resolve();
    });

    expect(screen.getByText('git.syncing')).toBeInTheDocument();
    expect(screen.getByText('git.opFetch')).toBeInTheDocument();
    expect(screen.getByText('0s')).toBeInTheDocument();
    expect(document.querySelector('[style*="width: 10%"]')).toBeTruthy();
    expect(onSilentRefresh).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(document.querySelector('[style*="width: 20%"]')).toBeTruthy();

    await act(async () => {
      resolveSync('Successfully synced with uat');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[style*="width: 100%"]')).toBeTruthy();
    expect(onSilentRefresh).toHaveBeenCalledTimes(1);
    expect(backend.syncWithBaseBranch).toHaveBeenCalledTimes(1);
  });

  it('skips auto-refresh while a git action is in flight', async () => {
    backend.syncWithBaseBranch.mockImplementation(() => new Promise(() => {}));
    const onSilentRefresh = vi.fn();

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/project-a"
          projectName="project-a"
          baseBranch="main"
          testBranch="test"
          currentBranch="feature/demo"
          autoRefreshSlot={0}
          onSilentRefresh={onSilentRefresh}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('git.syncBranch'));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
      await Promise.resolve();
    });

    expect(onSilentRefresh).not.toHaveBeenCalled();
  });

  it('resets the progress bar when a new action starts after completion', async () => {
    let resolveSync: (value: string) => void = () => {};
    backend.syncWithBaseBranch.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveSync = resolve;
      }),
    );
    backend.pullCurrentBranch.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/project-a"
          projectName="project-a"
          baseBranch="main"
          testBranch="test"
          currentBranch="feature/demo"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('git.syncBranch'));
      await Promise.resolve();
    });

    await act(async () => {
      resolveSync('Successfully synced with main');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[style*="width: 100%"]')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('git.pull'));
      await Promise.resolve();
    });

    expect(document.querySelector('[style*="width: 10%"]')).toBeTruthy();
    expect(document.querySelector('[style*="width: 100%"]')).toBeFalsy();
    expect(screen.getByText('0s')).toBeInTheDocument();
  });
});
