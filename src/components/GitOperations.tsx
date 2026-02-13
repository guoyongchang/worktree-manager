import { useState, useEffect, type FC } from 'react';
import { Button } from '@/components/ui/button';
import {
  RefreshIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestIcon,
} from './Icons';
import {
  syncWithBaseBranch,
  mergeToTestBranch,
  getBranchDiffStats,
  createPullRequest,
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
  const [merging, setMerging] = useState(false);
  const [creatingPR, setCreatingPR] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

  useEffect(() => {
    loadStats();
  }, [projectPath, baseBranch]);

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

  const handleMerge = async () => {
    setMerging(true);
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
      setMerging(false);
    }
  };

  const handleCreatePR = async () => {
    const title = window.prompt(`创建 PR 标题 (${currentBranch} -> ${baseBranch}):`);
    if (!title) return;

    const body = window.prompt('PR 描述 (可选):') || '';

    setCreatingPR(true);
    setError(null);
    setSuccess(null);
    try {
      const prUrl = await createPullRequest(projectPath, baseBranch, title, body);
      setSuccess(`PR 创建成功: ${prUrl}`);
      onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingPR(false);
    }
  };

  const handleRefresh = async () => {
    await loadStats();
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

      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSync}
          disabled={syncing || loading}
          className="flex-1 text-xs"
        >
          <GitBranchIcon className="w-3 h-3 mr-1" />
          {syncing ? '同步中...' : `同步 ${baseBranch}`}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleMerge}
          disabled={merging || loading}
          className="flex-1 text-xs"
        >
          <GitMergeIcon className="w-3 h-3 mr-1" />
          {merging ? '合并中...' : `合并到 ${testBranch}`}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleCreatePR}
          disabled={creatingPR || loading}
          className="flex-1 text-xs"
        >
          <GitPullRequestIcon className="w-3 h-3 mr-1" />
          {creatingPR ? '创建中...' : '创建 PR'}
        </Button>
      </div>
    </div>
  );
};
