import { useState, useEffect, type FC } from 'react';
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
  createPullRequest,
  checkRemoteBranchExists,
  type BranchDiffStats,
} from '@/lib/backend';

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
  const [syncing, setSyncing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [mergingToTest, setMergingToTest] = useState(false);
  const [mergingToBase, setMergingToBase] = useState(false);
  const [creatingPR, setCreatingPR] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testBranchExists, setTestBranchExists] = useState<boolean | null>(null);
  const [baseBranchExists, setBaseBranchExists] = useState<boolean | null>(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const diffStats = await getBranchDiffStats(projectPath, baseBranch);
      setStats(diffStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const checkBranches = async () => {
    try {
      const [testExists, baseExists] = await Promise.all([
        checkRemoteBranchExists(projectPath, testBranch),
        checkRemoteBranchExists(projectPath, baseBranch),
      ]);
      setTestBranchExists(testExists);
      setBaseBranchExists(baseExists);
    } catch (err) {
      console.error('Failed to check branches:', err);
    }
  };

  useEffect(() => {
    loadStats();
    checkBranches();
  }, [projectPath, baseBranch, testBranch]);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await syncWithBaseBranch(projectPath, baseBranch);
      setSuccess(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await pushToRemote(projectPath);
      setSuccess(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  };

  const handleMergeToTest = async () => {
    setMergingToTest(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await mergeToTestBranch(projectPath, testBranch);
      setSuccess(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMergingToTest(false);
    }
  };

  const handleMergeToBase = async () => {
    setMergingToBase(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await mergeToBaseBranch(projectPath, baseBranch);
      setSuccess(result);
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMergingToBase(false);
    }
  };

  const handleCreatePR = async () => {
    const title = window.prompt(`创建 PR/MR 标题 (${currentBranch} -> ${baseBranch}):`);
    if (!title) return;

    const body = window.prompt('PR/MR 描述 (可选):') || '';

    setCreatingPR(true);
    setError(null);
    setSuccess(null);
    try {
      const prUrl = await createPullRequest(projectPath, baseBranch, title, body);
      setSuccess(`PR/MR 创建成功: ${prUrl}`);
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingPR(false);
    }
  };

  const handleRefresh = async () => {
    await loadStats();
    await checkBranches();
    onRefresh?.();
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="p-2 bg-red-900/30 border border-red-800/50 rounded text-red-300 text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="p-2 bg-green-900/30 border border-green-800/50 rounded text-green-300 text-xs">
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
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSync}
            disabled={syncing || loading || baseBranchExists === false}
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
            disabled={pushing || loading}
            className="flex-1 text-xs"
          >
            <UploadIcon className="w-3 h-3 mr-1" />
            {pushing ? '推送中...' : '推送'}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleCreatePR}
            disabled={creatingPR || loading || baseBranchExists === false}
            className="flex-1 text-xs"
            title={baseBranchExists === false ? `远程分支 ${baseBranch} 不存在` : ''}
          >
            <GitPullRequestIcon className="w-3 h-3 mr-1" />
            {creatingPR ? '创建中...' : '创建 PR/MR'}
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleMergeToTest}
            disabled={mergingToTest || loading || testBranchExists === false}
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
            disabled={mergingToBase || loading || baseBranchExists === false}
            className="flex-1 text-xs"
            title={baseBranchExists === false ? `远程分支 ${baseBranch} 不存在` : ''}
          >
            <GitMergeIcon className="w-3 h-3 mr-1" />
            {mergingToBase ? '合并中...' : `合并到 ${baseBranch}`}
          </Button>
        </div>
      </div>

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
    </div>
  );
};
