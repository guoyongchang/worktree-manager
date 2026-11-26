import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitOperations, type GitOperationsHandle } from './GitOperations';
import { resetGitActionQueuesForTest } from '@/lib/gitActionQueue';

const backend = vi.hoisted(() => ({
  syncWithBaseBranch: vi.fn(),
  pushToRemote: vi.fn(),
  pullCurrentBranch: vi.fn(),
  mergeToTestBranch: vi.fn(),
  mergeToBaseBranch: vi.fn(),
  getBranchDiffStats: vi.fn(),
  checkRemoteBranchExists: vi.fn(),
  fetchProjectRemote: vi.fn(),
  cancelGitOperation: vi.fn(),
  getGitDiff: vi.fn(),
  commitAll: vi.fn(),
  generateCommitMessage: vi.fn(),
  checkCommitAiApiKey: vi.fn(),
  getCommitAiEnabled: vi.fn(),
  getCommitPrefixConfig: vi.fn(),
  getGitUserGlobalConfig: vi.fn(),
  getSkipGitHooks: vi.fn(),
  readIpcTimeoutSeconds: vi.fn(() => 60),
  setGitUserConfig: vi.fn(),
  isTauri: vi.fn(() => false),
}));

const tauriEvent = vi.hoisted(() => {
  let progressListener: ((event: { payload: { path: string; target: string; currentBranch: string; step: string } }) => void) | null = null;
  return {
    listen: vi.fn(async (_eventName: string, handler: (event: { payload: { path: string; target: string; currentBranch: string; step: string } }) => void) => {
      progressListener = handler;
      return () => {
        progressListener = null;
      };
    }),
    emitProgress(payload: { path: string; target: string; currentBranch: string; step: string }) {
      progressListener?.({ payload });
    },
    reset() {
      progressListener = null;
    },
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriEvent.listen,
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
    backend.cancelGitOperation.mockResolvedValue(undefined);
    backend.getCommitAiEnabled.mockResolvedValue(true);
    backend.getCommitPrefixConfig.mockResolvedValue({
      templates: ['[{{worktree-name}}]'],
      enabled: true,
      default_index: 0,
    });
    backend.getGitDiff.mockResolvedValue('diff --git a/file b/file');
    backend.generateCommitMessage.mockResolvedValue('fix(test): generated');
    backend.getSkipGitHooks.mockResolvedValue(false);
    backend.readIpcTimeoutSeconds.mockReturnValue(60);
    backend.isTauri.mockReturnValue(false);
    tauriEvent.reset();
  });

  afterEach(() => {
    resetGitActionQueuesForTest();
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
          autoRefreshSlot={1}
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
      await vi.advanceTimersByTimeAsync(16_000);
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

  it('disables merge to uat and merge to test when on test, uat, or custom test branch', async () => {
    const cases = [
      { currentBranch: 'test', baseBranch: 'uat', testBranch: 'test' },
      { currentBranch: 'uat', baseBranch: 'uat', testBranch: 'test' },
      { currentBranch: 'sit', baseBranch: 'uat', testBranch: 'sit' },
    ];
    for (const c of cases) {
      const { unmount } = render(
        <GitOperations
          projectPath="/tmp/worktree/api"
          projectName="api"
          baseBranch={c.baseBranch}
          testBranch={c.testBranch}
          currentBranch={c.currentBranch}
        />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const mergeButtons = screen.getAllByRole('button', { name: 'git.mergeToBranch' });
      expect(mergeButtons).toHaveLength(2);
      for (const btn of mergeButtons) {
        expect(btn).toBeDisabled();
      }
      unmount();
    }

    // Feature branch should keep both merge buttons enabled
    render(
      <GitOperations
        projectPath="/tmp/worktree/api"
        projectName="api"
        baseBranch="uat"
        testBranch="test"
        currentBranch="feat/billing-1"
      />
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const featureMergeButtons = screen.getAllByRole('button', { name: 'git.mergeToBranch' });
    expect(featureMergeButtons).toHaveLength(2);
    for (const btn of featureMergeButtons) {
      expect(btn).toBeEnabled();
    }
  });

  it('locks all git action buttons until operation and parent refresh fully finish, and queues imperative calls', async () => {
    let resolveMergeTest: (value: string) => void = () => {};
    let resolveParentRefresh: () => void = () => {};
    backend.mergeToTestBranch.mockImplementation(
      () => new Promise<string>((resolve) => { resolveMergeTest = resolve; }),
    );
    backend.pullCurrentBranch.mockResolvedValue('Successfully pulled');
    const onSilentRefresh = vi.fn(
      () => new Promise<void>((resolve) => { resolveParentRefresh = resolve; }),
    );
    const ref: { current: GitOperationsHandle | null } = { current: null };

    await act(async () => {
      render(
        <GitOperations
          ref={ref}
          projectPath="/tmp/worktree/queued-api"
          projectName="queued-api"
          baseBranch="uat"
          testBranch="test"
          currentBranch="feat/queue-1"
          onSilentRefresh={onSilentRefresh}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Start merge to test
    const mergeButtons = screen.getAllByRole('button', { name: 'git.mergeToBranch' });
    await act(async () => {
      fireEvent.click(mergeButtons[0]);
      await Promise.resolve();
    });

    // Merge to base, pull, sync, push, and refresh are ALL disabled while merge to test runs.
    expect(mergeButtons[1]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'git.pull' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'git.syncBranch' })).toBeDisabled();

    // Imperative triggerPull queues behind mergeToTest instead of running concurrently.
    const queuedPullPromise = ref.current!.triggerPull();
    expect(backend.pullCurrentBranch).not.toHaveBeenCalled();

    // Backend merge finishes, but parent silent refresh (branch state refresh) is STILL pending -> stays locked!
    await act(async () => {
      resolveMergeTest('成功将 feat/queue-1 合并到 test');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onSilentRefresh).toHaveBeenCalledTimes(1);
    expect(backend.pullCurrentBranch).not.toHaveBeenCalled();
    expect(mergeButtons[1]).toBeDisabled();

    // Once parent refresh resolves, mergeTest releases and queued pull runs next.
    await act(async () => {
      resolveParentRefresh();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(backend.pullCurrentBranch).toHaveBeenCalledTimes(1);

    // Complete pull's post-op refresh.
    await act(async () => {
      resolveParentRefresh();
      await queuedPullPromise;
    });
    expect(screen.getByRole('button', { name: 'git.pull' })).toBeEnabled();
  });

  it('shows inline cancel button while running and unlocks once backend aborts', async () => {
    let rejectOp: (err: Error) => void = () => {};
    backend.pullCurrentBranch.mockImplementation(
      () => new Promise<string>((_, reject) => { rejectOp = reject; }),
    );

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/slow-api"
          projectName="slow-api"
          baseBranch="uat"
          testBranch="test"
          currentBranch="feat/slow"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'git.pull' }));
      await Promise.resolve();
    });

    // Inline cancel button is visible immediately.
    expect(screen.getByRole('button', { name: 'git.cancelOperation' })).toBeInTheDocument();

    // Clicking Cancel invokes cancelGitOperation and shows cancelling status until backend returns.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'git.cancelOperation' }));
      await Promise.resolve();
    });
    expect(backend.cancelGitOperation).toHaveBeenCalledWith('/tmp/worktree/slow-api');
    expect(screen.getByText('git.opCancelling')).toBeInTheDocument();

    // Backend aborts and returns "已取消" -> unlocks cleanly.
    await act(async () => {
      rejectOp(new Error('已取消'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'git.pull' })).toBeEnabled();
  });

  it('auto-cancels and unlocks UI at the default 60s command timeout', async () => {
    backend.mergeToTestBranch.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/hung-api"
          projectName="hung-api"
          baseBranch="uat"
          testBranch="test"
          currentBranch="feat/hung"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const mergeButtons = screen.getAllByRole('button', { name: 'git.mergeToBranch' });
    await act(async () => {
      fireEvent.click(mergeButtons[0]);
      await Promise.resolve();
    });
    expect(mergeButtons[1]).toBeDisabled();

    // Advance to the default 60s command timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_400);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(backend.cancelGitOperation).toHaveBeenCalledWith('/tmp/worktree/hung-api');
    expect(screen.getByText('git.operationTimedOut')).toBeInTheDocument();
    expect(mergeButtons[1]).toBeEnabled();
  });

  it('respects a larger configured command timeout directly without multipliers', async () => {
    backend.readIpcTimeoutSeconds.mockReturnValue(180);
    backend.pullCurrentBranch.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/custom-timeout-api"
          projectName="custom-timeout-api"
          baseBranch="uat"
          testBranch="test"
          currentBranch="feat/custom-timeout"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'git.pull' }));
      await Promise.resolve();
    });

    // Still running past the old 60s default because user configured 180s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(179_000);
    });
    expect(backend.cancelGitOperation).not.toHaveBeenCalled();

    // Auto-cancels once the configured 180s command timeout is reached.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_400);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(backend.cancelGitOperation).toHaveBeenCalledWith('/tmp/worktree/custom-timeout-api');
    expect(screen.getByText('git.operationTimedOut')).toBeInTheDocument();
  });

  it('gives each git-progress step its own full command timeout budget in desktop mode', async () => {
    backend.isTauri.mockReturnValue(true);
    backend.mergeToTestBranch.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      render(
        <GitOperations
          projectPath="/tmp/worktree/multistep-api"
          projectName="multistep-api"
          baseBranch="uat"
          testBranch="test"
          currentBranch="feat/multistep"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const mergeButtons = screen.getAllByRole('button', { name: 'git.mergeToBranch' });
    await act(async () => {
      fireEvent.click(mergeButtons[0]);
      await Promise.resolve();
    });

    // Step 1 ("fetch") runs for 45s (under 60s).
    await act(async () => {
      tauriEvent.emitProgress({
        path: '/tmp/worktree/multistep-api',
        target: 'test',
        currentBranch: 'feat/multistep',
        step: 'fetch',
      });
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(backend.cancelGitOperation).not.toHaveBeenCalled();

    // Advances to step 2 ("push") -> per-step timer resets; 30s into push (75s total) stays alive.
    await act(async () => {
      tauriEvent.emitProgress({
        path: '/tmp/worktree/multistep-api',
        target: 'test',
        currentBranch: 'feat/multistep',
        step: 'push',
      });
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(backend.cancelGitOperation).not.toHaveBeenCalled();

    // Stalling another 30.4s on "push" hits the 60s per-command limit and cancels.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_400);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(backend.cancelGitOperation).toHaveBeenCalledWith('/tmp/worktree/multistep-api');
    expect(screen.getByText('git.operationTimedOut')).toBeInTheDocument();
  });
});
