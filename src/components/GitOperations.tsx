import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  RefreshIcon,
  SyncIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  UploadIcon,
  WarningIcon,
  CloseIcon,
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
  const { t } = useTranslation();
  const [stats, setStats] = useState<BranchDiffStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingSyncing, setFetchingSyncing] = useState(false);
  const [activeAction, setActiveAction] = useState<'sync' | 'push' | 'mergeTest' | 'mergeBase' | null>(null);
  const [showPRModal, setShowPRModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testBranchExists, setTestBranchExists] = useState<boolean | null>(null);
  const [baseBranchExists, setBaseBranchExists] = useState<boolean | null>(null);
  const [dismissing, setDismissing] = useState<'error' | 'success' | null>(null);
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
      }, 8000);
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
      }, 5000);
    }
  }, []);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await getBranchDiffStats(projectPath, baseBranch));
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
    let cancelled = false;

    // Phase 1: Instant local data (milliseconds)
    const rafId = requestAnimationFrame(() => {
      loadStats();
      checkBranches();

      // Phase 2: Background fetch from remote (3-6s), then refresh branch state
      setFetchingSyncing(true);
      fetchProjectRemote(projectPath)
        .then(() => {
          if (!cancelled) return Promise.all([checkBranches(), loadStats()]);
        })
        .catch((err) => {
          console.error('Background fetch failed:', err);
        })
        .finally(() => {
          if (!cancelled) setFetchingSyncing(false);
        });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(errorTimerRef.current);
      clearTimeout(successTimerRef.current);
    };
  }, [projectPath, baseBranch, testBranch]);

  const runGitAction = async (
    action: typeof activeAction,
    operation: () => Promise<string>,
  ) => {
    setActiveAction(action);
    setErrorWithAutoDismiss(null);
    setSuccessWithAutoDismiss(null);
    try {
      setSuccessWithAutoDismiss(await operation());
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setErrorWithAutoDismiss(err instanceof Error ? err.message : String(err));
    } finally {
      setActiveAction(null);
    }
  };

  const handleRefresh = async () => {
    await loadStats();
    await checkBranches();
    onRefresh?.();
  };

  const actionsDisabled = fetchingSyncing || activeAction !== null;

  return (
    <div className="space-y-3">
      {error && (
        <div
          className={`p-2 bg-red-900/40 border border-red-800/50 rounded text-red-300 text-xs transition-opacity duration-200 cursor-pointer flex items-center justify-between gap-2 ${dismissing === 'error' ? 'opacity-0' : 'opacity-100'}`}
          onClick={() => { clearTimeout(errorTimerRef.current); setError(null); setDismissing(null); }}
        >
          <span>{error}</span>
          <CloseIcon className="w-3 h-3 shrink-0 text-red-400" />
        </div>
      )}
      {success && (
        <div
          className={`p-2 bg-green-900/40 border border-green-800/50 rounded text-green-300 text-xs transition-opacity duration-200 cursor-pointer flex items-center justify-between gap-2 ${dismissing === 'success' ? 'opacity-0' : 'opacity-100'}`}
          onClick={() => { clearTimeout(successTimerRef.current); setSuccess(null); setDismissing(null); }}
        >
          <span>{success}</span>
          <CloseIcon className="w-3 h-3 shrink-0 text-green-400" />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {loading ? (
            <span className="flex items-center gap-1">
              <RefreshIcon className="w-3 h-3 animate-spin" />
              {t('common.loading')}
            </span>
          ) : stats ? (
            <div className="flex gap-3">
              <span>{t('git.aheadCommits', { count: stats.ahead })}</span>
              <span>{t('git.behindCommits', { count: stats.behind })}</span>
              <span>{t('git.changedFiles', { count: stats.changed_files })}</span>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runGitAction('sync', () => syncWithBaseBranch(projectPath, baseBranch))}
            disabled={loading || baseBranchExists === false || actionsDisabled}
            className="text-xs min-w-0"
            title={baseBranchExists === false ? t('git.remoteBranchNotExists', { branch: baseBranch }) : ''}
          >
            <SyncIcon className="w-3 h-3 mr-1 shrink-0" />
            <span className="truncate">{activeAction === 'sync' ? t('git.syncing') : t('git.syncBranch', { branch: baseBranch })}</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => runGitAction('push', () => pushToRemote(projectPath))}
            disabled={loading || actionsDisabled}
            className="text-xs min-w-0"
          >
            <UploadIcon className="w-3 h-3 mr-1 shrink-0" />
            <span className="truncate">{activeAction === 'push' ? t('git.pushing') : t('git.pushLabel')}</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPRModal(true)}
            disabled={loading || baseBranchExists === false || actionsDisabled}
            className="text-xs min-w-0"
            title={baseBranchExists === false ? t('git.remoteBranchNotExists', { branch: baseBranch }) : ''}
          >
            <GitPullRequestIcon className="w-3 h-3 mr-1 shrink-0" />
            <span className="truncate">{t('git.createPR')}</span>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runGitAction('mergeTest', () => mergeToTestBranch(projectPath, testBranch))}
            disabled={loading || testBranchExists === false || actionsDisabled}
            className="text-xs min-w-0"
            title={testBranchExists === false ? t('git.remoteBranchNotExists', { branch: testBranch }) : ''}
          >
            <GitMergeIcon className="w-3 h-3 mr-1 shrink-0" />
            <span className="truncate">{activeAction === 'mergeTest' ? t('git.merging') : t('git.mergeToBranch', { branch: testBranch })}</span>
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => runGitAction('mergeBase', () => mergeToBaseBranch(projectPath, baseBranch))}
            disabled={loading || baseBranchExists === false || actionsDisabled}
            className="text-xs min-w-0"
            title={baseBranchExists === false ? t('git.remoteBranchNotExists', { branch: baseBranch }) : ''}
          >
            <GitMergeIcon className="w-3 h-3 mr-1 shrink-0" />
            <span className="truncate">{activeAction === 'mergeBase' ? t('git.merging') : t('git.mergeToBranch', { branch: baseBranch })}</span>
          </Button>
        </div>
      </div>

      {fetchingSyncing && (
        <div className="flex items-center gap-2 text-xs text-blue-400/80">
          <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full animate-progress-indeterminate animate-gradient" />
          </div>
          <span className="whitespace-nowrap">{t('git.syncRemote')}</span>
        </div>
      )}

      {(testBranchExists === false || baseBranchExists === false) && (
        <div className="text-xs text-amber-400/80 flex items-center gap-1">
          <WarningIcon className="w-3.5 h-3.5 text-amber-500" />
          <span>
            {testBranchExists === false && t('git.remoteBranchNotExists', { branch: testBranch })}
            {testBranchExists === false && baseBranchExists === false && ', '}
            {baseBranchExists === false && t('git.remoteBranchNotExists', { branch: baseBranch })}
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
