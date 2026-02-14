import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { Button } from '@/components/ui/button';
import {
  RefreshIcon,
  SyncIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  UploadIcon,
  WarningIcon,
} from './Icons';
import {
  syncWithBaseBranch,
  pushToRemote,
  mergeToTestBranch,
  mergeToBaseBranch,
  getBranchDiffStats,
  checkRemoteBranchExists,
  fetchProjectRemote,
  type BranchDiffStats,
} from '@/lib/backend';
import { CreatePRModal } from './CreatePRModal';

interface GitOperationsProps {
  projectPath: string;
  baseBranch: string;
  testBranch: string;
  currentBranch: string;
  onRefresh?: () => void;
}

export const GitOperations: FC<GitOperationsProps> = ({
  projectPath,
  baseBranch,
  testBranch,
  currentBranch,
  onRefresh,
}) => {
  const [stats, setStats] = useState<BranchDiffStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingSyncing, setFetchingSyncing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [mergingToTest, setMergingToTest] = useState(false);
  const [mergingToBase, setMergingToBase] = useState(false);
  const [showPRModal, setShowPRModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testBranchExists, setTestBranchExists] = useState<boolean | null>(null);
  const [baseBranchExists, setBaseBranchExists] = useState<boolean | null>(null);
  const [dismissing, setDismissing] = useState<'error' | 'success' | null>(null);
  const mountedRef = useRef(true);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setErrorWithAutoDismiss = useCallback((msg: string | null) => {
    clearTimeout(errorTimerRef.current);
    setDismissing(null);
    setError(msg);
    if (msg) {
      errorTimerRef.current = setTimeout(() => {
        setDismissing('error');
        setTimeout(() => { setError(null); setDismissing(null); }, 200);
      }, 5000);
    }
  }, []);

  const setSuccessWithAutoDismiss = useCallback((msg: string | null) => {
    clearTimeout(successTimerRef.current);
    setDismissing(null);
    setSuccess(msg);
    if (msg) {
      successTimerRef.current = setTimeout(() => {
        setDismissing('success');
        setTimeout(() => { setSuccess(null); setDismissing(null); }, 200);
      }, 3000);
    }
  }, []);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const diffStats = await getBranchDiffStats(projectPath, baseBranch);
      if (mountedRef.current) setStats(diffStats);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const checkBranches = async () => {
    try {
      const [testExists, baseExists] = await Promise.all([
        checkRemoteBranchExists(projectPath, testBranch),
        checkRemoteBranchExists(projectPath, baseBranch),
      ]);
      if (mountedRef.current) {
        setTestBranchExists(testExists);
        setBaseBranchExists(baseExists);
      }
    } catch (err) {
      console.error('Failed to check branches:', err);
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    // Phase 1: Instant local data (milliseconds)
    const rafId = requestAnimationFrame(() => {
      loadStats();
      checkBranches();

      // Phase 2: Background fetch from remote (3-6s), then refresh branch state
      setFetchingSyncing(true);
      fetchProjectRemote(projectPath)
        .then(() => {
          if (mountedRef.current) {
            // Re-check branches with updated remote-tracking refs
            return Promise.all([checkBranches(), loadStats()]);
          }
        })
        .catch((err) => {
          console.error('Background fetch failed:', err);
        })
        .finally(() => {
          if (mountedRef.current) setFetchingSyncing(false);
        });
    });

    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafId);
      clearTimeout(errorTimerRef.current);
      clearTimeout(successTimerRef.current);
    };
  }, [projectPath, baseBranch, testBranch]);

  const handleSync = async () => {
    setSyncing(true);
    setErrorWithAutoDismiss(null);
    setSuccessWithAutoDismiss(null);
    try {
      const result = await syncWithBaseBranch(projectPath, baseBranch);
      setSuccessWithAutoDismiss(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setErrorWithAutoDismiss(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setErrorWithAutoDismiss(null);
    setSuccessWithAutoDismiss(null);
    try {
      const result = await pushToRemote(projectPath);
      setSuccessWithAutoDismiss(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setErrorWithAutoDismiss(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  };

  const handleMergeToTest = async () => {
    setMergingToTest(true);
    setErrorWithAutoDismiss(null);
    setSuccessWithAutoDismiss(null);
    try {
      const result = await mergeToTestBranch(projectPath, testBranch);
      setSuccessWithAutoDismiss(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setErrorWithAutoDismiss(err instanceof Error ? err.message : String(err));
    } finally {
      setMergingToTest(false);
    }
  };

  const handleMergeToBase = async () => {
    setMergingToBase(true);
    setErrorWithAutoDismiss(null);
    setSuccessWithAutoDismiss(null);
    try {
      const result = await mergeToBaseBranch(projectPath, baseBranch);
      setSuccessWithAutoDismiss(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setErrorWithAutoDismiss(err instanceof Error ? err.message : String(err));
    } finally {
      setMergingToBase(false);
    }
  };

  const handleCreatePR = () => {
    setShowPRModal(true);
  };

  const handleRefresh = async () => {
    await loadStats();
    await checkBranches();
    onRefresh?.();
  };

  const actionsDisabled = fetchingSyncing;

  return (
    <div className="space-y-3">
      {error && (
        <div className={`p-2 bg-red-900/30 border border-red-800/50 rounded text-red-300 text-xs transition-opacity duration-200 ${dismissing === 'error' ? 'opacity-0' : 'opacity-100'}`}>
          {error}
        </div>
      )}
      {success && (
        <div className={`p-2 bg-green-900/30 border border-green-800/50 rounded text-green-300 text-xs transition-opacity duration-200 ${dismissing === 'success' ? 'opacity-0' : 'opacity-100'}`}>
          {success}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {loading ? (
            <span className="flex items-center gap-1">
              <RefreshIcon className="w-3 h-3 animate-spin" />
              加载中...
            </span>
          ) : stats ? (
            <div className="flex gap-3">
              <span>领先 {stats.ahead} 提交</span>
              <span>落后 {stats.behind} 提交</span>
              <span>{stats.changed_files} 个变更文件</span>
            </div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="h-6 px-2"
        >
          <RefreshIcon className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2" title="同步操作">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSync}
            disabled={syncing || loading || baseBranchExists === false || actionsDisabled}
            className="flex-1 text-xs"
            title={baseBranchExists === false ? `远程分支 ${baseBranch} 不存在` : ''}
          >
            <SyncIcon className="w-3 h-3 mr-1" />
            {syncing ? '同步中...' : `同步 ${baseBranch}`}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handlePush}
            disabled={pushing || loading || actionsDisabled}
            className="flex-1 text-xs"
          >
            <UploadIcon className="w-3 h-3 mr-1" />
            {pushing ? '推送中...' : '推送'}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleCreatePR}
            disabled={loading || baseBranchExists === false || actionsDisabled}
            className="flex-1 text-xs"
            title={baseBranchExists === false ? `远程分支 ${baseBranch} 不存在` : ''}
          >
            <GitPullRequestIcon className="w-3 h-3 mr-1" />
            创建 PR/MR
          </Button>
        </div>

        <div className="flex gap-2" title="合并操作">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleMergeToTest}
            disabled={mergingToTest || loading || testBranchExists === false || actionsDisabled}
            className="flex-1 text-xs"
            title={testBranchExists === false ? `远程分支 ${testBranch} 不存在` : ''}
          >
            <GitMergeIcon className="w-3 h-3 mr-1" />
            {mergingToTest ? '合并中...' : `合并到 ${testBranch}`}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleMergeToBase}
            disabled={mergingToBase || loading || baseBranchExists === false || actionsDisabled}
            className="flex-1 text-xs"
            title={baseBranchExists === false ? `远程分支 ${baseBranch} 不存在` : ''}
          >
            <GitMergeIcon className="w-3 h-3 mr-1" />
            {mergingToBase ? '合并中...' : `合并到 ${baseBranch}`}
          </Button>
        </div>
      </div>

      {fetchingSyncing && (
        <div className="flex items-center gap-2 text-xs text-blue-400/80">
          <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full animate-progress-indeterminate animate-gradient" />
          </div>
          <span className="whitespace-nowrap">同步远程仓库中...</span>
        </div>
      )}

      {(testBranchExists === false || baseBranchExists === false) && (
        <div className="text-xs text-amber-400/80 flex items-center gap-1">
          <WarningIcon className="w-3.5 h-3.5 text-amber-500" />
          <span>
            {testBranchExists === false && `远程分支 ${testBranch} 不存在`}
            {testBranchExists === false && baseBranchExists === false && '，'}
            {baseBranchExists === false && `远程分支 ${baseBranch} 不存在`}
          </span>
        </div>
      )}

      <CreatePRModal
        open={showPRModal}
        onOpenChange={setShowPRModal}
        projectPath={projectPath}
        baseBranch={baseBranch}
        currentBranch={currentBranch}
        onSuccess={onRefresh}
      />
    </div>
  );
};
