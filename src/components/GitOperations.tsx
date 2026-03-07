import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import {
  RefreshIcon,
  SyncIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  UploadIcon,
  WarningIcon,
  CloseIcon,
  TerminalIcon,
} from './Icons';
import {
  syncWithBaseBranch,
  pushToRemote,
  mergeToTestBranch,
  mergeToBaseBranch,
  getBranchDiffStats,
  checkRemoteBranchExists,
  fetchProjectRemote,
  getGitDiff,
  commitAll,
  generateCommitMessage,
  type BranchDiffStats,
} from '@/lib/backend';
import { CreatePRModal } from './CreatePRModal';

// Heuristic: detect merge conflict errors from git output
function isConflictError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('conflict') || lower.includes('merge_conflict') || lower.includes('fix conflicts');
}

interface GitOperationsProps {
  projectPath: string;
  baseBranch: string;
  testBranch: string;
  currentBranch: string;
  onRefresh?: () => void;
  onOpenTerminal?: (path: string) => void;
}

export const GitOperations: FC<GitOperationsProps> = ({
  projectPath,
  baseBranch,
  testBranch,
  currentBranch,
  onRefresh,
  onOpenTerminal,
}) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<BranchDiffStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingSyncing, setFetchingSyncing] = useState(false);
  const [activeAction, setActiveAction] = useState<'sync' | 'push' | 'mergeTest' | 'mergeBase' | null>(null);
  const [showPRModal, setShowPRModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorPersistent, setErrorPersistent] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [testBranchExists, setTestBranchExists] = useState<boolean | null>(null);
  const [baseBranchExists, setBaseBranchExists] = useState<boolean | null>(null);
  const [dismissing, setDismissing] = useState<'error' | 'success' | null>(null);
  const [showMergeBaseConfirm, setShowMergeBaseConfirm] = useState(false);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [committing, setCommitting] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setErrorMsg = useCallback((msg: string | null, persistent = false) => {
    clearTimeout(errorTimerRef.current);
    setDismissing(null);
    setError(msg);
    setErrorPersistent(persistent);
    if (msg && !persistent) {
      errorTimerRef.current = setTimeout(() => {
        setDismissing('error');
        setTimeout(() => { setError(null); setDismissing(null); setErrorPersistent(false); }, 200);
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

  const dismissError = useCallback(() => {
    clearTimeout(errorTimerRef.current);
    setError(null);
    setDismissing(null);
    setErrorPersistent(false);
  }, []);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorPersistent(false);
    try {
      setStats(await getBranchDiffStats(projectPath, baseBranch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath, baseBranch]);

  const checkBranches = useCallback(async () => {
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
  }, [projectPath, testBranch, baseBranch]);

  const loadLocalState = useCallback(async () => {
    await Promise.all([loadStats(), checkBranches()]);
  }, [loadStats, checkBranches]);

  const syncRemoteState = useCallback(async () => {
    setFetchingSyncing(true);
    try {
      await fetchProjectRemote(projectPath);
      await loadLocalState();
    } catch (err) {
      console.error('Remote sync failed:', err);
    } finally {
      setFetchingSyncing(false);
    }
  }, [projectPath, loadLocalState]);

  useEffect(() => {
    loadLocalState();

    return () => {
      clearTimeout(errorTimerRef.current);
      clearTimeout(successTimerRef.current);
    };
  }, [loadLocalState]);

  const runGitAction = async (
    action: typeof activeAction,
    operation: () => Promise<string>,
  ) => {
    setActiveAction(action);
    setErrorMsg(null);
    setSuccessWithAutoDismiss(null);
    try {
      setSuccessWithAutoDismiss(await operation());
      await loadStats();
      onRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Conflict errors are persistent (no auto-dismiss)
      setErrorMsg(msg, isConflictError(msg));
    } finally {
      setActiveAction(null);
    }
  };

  const handleRefresh = async () => {
    await syncRemoteState();
    onRefresh?.();
  };

  const handleMergeBaseClick = () => {
    setShowMergeBaseConfirm(true);
  };

  const confirmMergeBase = () => {
    setShowMergeBaseConfirm(false);
    runGitAction('mergeBase', () => mergeToBaseBranch(projectPath, baseBranch));
  };

  const handleCommitClick = async () => {
    setShowCommitDialog(true);
    setCommitMessage('');
    setGeneratingMessage(true);
    try {
      const diff = await getGitDiff(projectPath);
      const msg = await generateCommitMessage(diff);
      setCommitMessage(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No changes')) {
        setShowCommitDialog(false);
        setErrorMsg(t('git.noChanges'));
      } else {
        setCommitMessage('');
        setErrorMsg(msg);
      }
    } finally {
      setGeneratingMessage(false);
    }
  };

  const handleRegenerateMessage = async () => {
    setGeneratingMessage(true);
    try {
      const diff = await getGitDiff(projectPath);
      const msg = await generateCommitMessage(diff);
      setCommitMessage(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingMessage(false);
    }
  };

  const handleConfirmCommit = async (withPush: boolean) => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      await commitAll(projectPath, commitMessage.trim());
      setShowCommitDialog(false);
      if (withPush) {
        try {
          await pushToRemote(projectPath);
          setSuccessWithAutoDismiss(t('git.commitAndPushSuccess'));
        } catch (pushErr) {
          setSuccessWithAutoDismiss(t('git.commitSuccess'));
          setErrorMsg(pushErr instanceof Error ? pushErr.message : String(pushErr));
        }
      } else {
        setSuccessWithAutoDismiss(t('git.commitSuccess'));
      }
      await loadStats();
      onRefresh?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  };

  // Smart Commit & Push: if uncommitted changes → commit dialog, else just push
  const handleCommitAndPush = async () => {
    if (stats && stats.changed_files > 0) {
      // Has uncommitted changes → show commit dialog (will auto-push after commit)
      handleCommitClick();
    } else {
      // No uncommitted changes → just push
      runGitAction('push', () => pushToRemote(projectPath));
    }
  };

  const actionsDisabled = fetchingSyncing || activeAction !== null;

  return (
    <div className="space-y-3">
      {error && (
        <div
          className={`p-2 rounded text-xs transition-opacity duration-200 ${errorPersistent
            ? 'bg-red-900/50 border border-red-700/60'
            : 'bg-red-900/40 border border-red-800/50 cursor-pointer'
            } ${dismissing === 'error' ? 'opacity-0' : 'opacity-100'}`}
          onClick={errorPersistent ? undefined : dismissError}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-red-300 flex-1 whitespace-pre-wrap break-all">{error}</span>
            <button
              onClick={(e) => { e.stopPropagation(); dismissError(); }}
              className="shrink-0 p-0.5 rounded hover:bg-red-800/50 transition-colors"
            >
              <CloseIcon className="w-3 h-3 text-red-400" />
            </button>
          </div>
          {errorPersistent && onOpenTerminal && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenTerminal(projectPath);
              }}
              className="mt-1.5 flex items-center gap-1.5 text-red-300 hover:text-red-200 transition-colors text-xs bg-red-800/30 hover:bg-red-800/50 rounded px-2 py-1"
            >
              <TerminalIcon className="w-3 h-3" />
              <span>{t('git.openTerminalToResolve')}</span>
            </button>
          )}
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
          disabled={loading || fetchingSyncing}
          className="h-6 px-2"
        >
          <RefreshIcon className={`w-3 h-3 ${(loading || fetchingSyncing) ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
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
            onClick={handleCommitAndPush}
            disabled={loading || actionsDisabled || committing}
            className="text-xs min-w-0"
          >
            <UploadIcon className="w-3 h-3 mr-1 shrink-0" />
            <span className="truncate">
              {committing
                ? t('git.committing')
                : activeAction === 'push'
                  ? t('git.pushing')
                  : stats && stats.changed_files > 0
                    ? t('git.commitAndPush')
                    : t('git.pushLabel')}
            </span>
          </Button>
        </div>

        <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
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
            onClick={handleMergeBaseClick}
            disabled={loading || baseBranchExists === false || actionsDisabled}
            className="text-xs min-w-0 border-orange-800/40 hover:bg-orange-900/20 hover:border-orange-700/50"
            title={baseBranchExists === false ? t('git.remoteBranchNotExists', { branch: baseBranch }) : ''}
          >
            <GitMergeIcon className="w-3 h-3 mr-1 shrink-0 text-orange-400" />
            <span className="truncate text-orange-300">{activeAction === 'mergeBase' ? t('git.merging') : t('git.mergeToBranch', { branch: baseBranch })}</span>
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

      {/* Merge to Base confirmation dialog */}
      <Dialog open={showMergeBaseConfirm} onOpenChange={setShowMergeBaseConfirm}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t('git.mergeBaseConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('git.mergeBaseConfirmDesc', { current: currentBranch, base: baseBranch, count: stats?.ahead ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowMergeBaseConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={confirmMergeBase}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {t('git.confirmMergeBase')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Commit dialog */}
      <Dialog open={showCommitDialog} onOpenChange={setShowCommitDialog}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t('git.commitMessage')}</DialogTitle>
            <DialogDescription>
              {generatingMessage ? t('git.generating') : t('git.commitAll')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder={generatingMessage ? t('git.generating') : ''}
              disabled={generatingMessage}
              className="w-full h-24 bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 resize-none focus:border-blue-500 focus:outline-none"
            />
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerateMessage}
                disabled={generatingMessage}
                className="text-xs"
              >
                <RefreshIcon className={`w-3 h-3 mr-1 ${generatingMessage ? 'animate-spin' : ''}`} />
                {t('git.regenerate')}
              </Button>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowCommitDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleConfirmCommit(false)}
              disabled={!commitMessage.trim() || committing || generatingMessage}
            >
              {t('git.commitOnly')}
            </Button>
            <Button
              onClick={() => handleConfirmCommit(true)}
              disabled={!commitMessage.trim() || committing || generatingMessage}
            >
              {committing ? t('git.committing') : t('git.commitAndPush')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
