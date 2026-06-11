import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { addLog } from '@/lib/operationLog';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import {
  RefreshIcon,
  SyncIcon,
  GitMergeIcon,
  UploadIcon,
  WarningIcon,
  CloseIcon,
  TerminalIcon,
  DownloadIcon,
} from './Icons';
import { Pencil, HelpCircle } from 'lucide-react';
import {
  syncWithBaseBranch,
  pushToRemote,
  pullCurrentBranch,
  mergeToTestBranch,
  mergeToBaseBranch,
  getBranchDiffStats,
  checkRemoteBranchExists,
  fetchProjectRemote,
  getGitDiff,
  commitAll,
  generateCommitMessage,
  checkCommitAiApiKey,
  getCommitPrefixConfig,
  getGitUserGlobalConfig,
  setGitUserConfig,
  getSkipGitHooks,
  type BranchDiffStats,
} from '@/lib/backend';
import type { WorkspaceConfig } from '@/types';
import { renderCommitPrefix } from '@/lib/commit-prefix';
import { basename } from '@/lib/utils';

const AUTO_REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_STAGGER_MS = 15_000;
const AUTO_REFRESH_SLOTS = 4;

// Heuristic: detect merge conflict errors from git output
function isConflictError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('conflict') || lower.includes('merge_conflict') || lower.includes('fix conflicts');
}

function truncateConflictMessage(msg: string, maxFiles = 5): string {
  // Guard against invalid input
  if (maxFiles <= 0) return msg;
  // Git conflict output: "file1.ts\nfile2.ts\nfile3.ts..." with <<<<<<<, =======, >>>>>>> markers
  // Filter out empty lines and conflict markers (<<<<<<<, =======, >>>>>>>)
  const lines = msg.split('\n').filter(l => {
    const trimmed = l.trim();
    return trimmed.length > 0 && !trimmed.startsWith('<<<<<<<') && !trimmed.startsWith('=======') && !trimmed.startsWith('>>>>>>>');
  });
  if (lines.length <= maxFiles) {
    return `Conflict in ${lines.length} file${lines.length === 1 ? '' : 's'}: ${lines.join(', ')}.`;
  }
  const shown = lines.slice(0, maxFiles).join(', ');
  const remaining = lines.length - maxFiles;
  return `Conflict in ${lines.length} files: ${shown}, and ${remaining} more. Resolve in editor or terminal.`;
}

interface GitOperationsProps {
  projectPath: string;
  projectName: string;
  baseBranch: string;
  testBranch: string;
  currentBranch: string;
  worktreeDisplayName?: string;
  workspaceConfig?: WorkspaceConfig;
  onRefresh?: () => void;
  onSilentRefresh?: () => void;
  onOpenTerminal?: (path: string) => void;
  autoRefreshSlot?: number;
  onStatsChanged?: (stats: BranchDiffStats) => void;
}

export interface GitOperationsHandle {
  triggerSync: () => Promise<void>;
  triggerPull: () => Promise<void>;
  triggerRefresh: () => Promise<void>;
}

export const GitOperations = forwardRef<GitOperationsHandle, GitOperationsProps>(({
  projectPath,
  projectName,
  baseBranch,
  testBranch,
  currentBranch,
  worktreeDisplayName,
  workspaceConfig,
  onRefresh,
  onSilentRefresh,
  onOpenTerminal,
  autoRefreshSlot,
  onStatsChanged,
}, ref) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<BranchDiffStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingSyncing, setFetchingSyncing] = useState(false);
  const [activeAction, setActiveAction] = useState<'sync' | 'pull' | 'push' | 'mergeTest' | 'mergeBase' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorPersistent, setErrorPersistent] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [testBranchExists, setTestBranchExists] = useState<boolean | null>(null);
  const [baseBranchExists, setBaseBranchExists] = useState<boolean | null>(null);
  const [dismissing, setDismissing] = useState<'error' | 'success' | null>(null);
  const [showMergeBaseConfirm, setShowMergeBaseConfirm] = useState(false);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [prefixConfig, setPrefixConfig] = useState<{ templates: string[]; enabled: boolean; default_index: number }>({
    templates: ['[{{worktree-name}}]'],
    enabled: true,
    default_index: 0,
  });
  const [selectedPrefixIndex, setSelectedPrefixIndex] = useState(0);
  const [prefix, setPrefix] = useState('');
  const [content, setContent] = useState('');
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchingSyncingRef = useRef(fetchingSyncing);
  const activeActionRef = useRef(activeAction);
  const autoRefreshInFlightRef = useRef(false);
  const loadStatsVersionRef = useRef(0);
  const onStatsChangedRef = useRef(onStatsChanged);
  const onSilentRefreshRef = useRef(onSilentRefresh);

  useEffect(() => {
    onStatsChangedRef.current = onStatsChanged;
  }, [onStatsChanged]);

  useEffect(() => {
    onSilentRefreshRef.current = onSilentRefresh;
  }, [onSilentRefresh]);

  useEffect(() => {
    fetchingSyncingRef.current = fetchingSyncing;
  }, [fetchingSyncing]);

  useEffect(() => {
    activeActionRef.current = activeAction;
  }, [activeAction]);

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

  const loadStats = useCallback(async (silent?: boolean) => {
    const version = ++loadStatsVersionRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
      setErrorPersistent(false);
    }
    try {
      const result = await getBranchDiffStats(projectPath, baseBranch, testBranch);
      if (version !== loadStatsVersionRef.current) {
        console.log('[GitOps] loadStats: discarded stale result (v' + version + ', current v' + loadStatsVersionRef.current + ')');
        return;
      }
      console.log('[GitOps] diff stats:', { projectPath, baseBranch, testBranch, result });
      setStats(result);
      onStatsChangedRef.current?.(result);
    } catch (err) {
      if (version !== loadStatsVersionRef.current) return;
      if (!silent) {
        setError(err instanceof Error ? err.message : String(err));
      } else {
        console.warn('[auto-refresh] loadStats failed silently:', err);
      }
    } finally {
      if (version === loadStatsVersionRef.current && !silent) setLoading(false);
    }
  }, [projectPath, baseBranch, testBranch]);

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

  useEffect(() => {
    if (autoRefreshSlot == null) return;

    const normalizedSlot = ((autoRefreshSlot % AUTO_REFRESH_SLOTS) + AUTO_REFRESH_SLOTS) % AUTO_REFRESH_SLOTS;
    const staggerDelay = normalizedSlot * AUTO_REFRESH_STAGGER_MS;
    const initialDelay = staggerDelay === 0 ? AUTO_REFRESH_INTERVAL_MS : staggerDelay;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const runAutoRefresh = async () => {
      if (document.visibilityState === 'hidden') return;
      if (autoRefreshInFlightRef.current || fetchingSyncingRef.current || activeActionRef.current) return;

      autoRefreshInFlightRef.current = true;
      try {
        await Promise.all([
          onSilentRefreshRef.current?.(),
          loadStats(true),
        ]);
      } finally {
        autoRefreshInFlightRef.current = false;
      }
    };

    const timeoutId = setTimeout(() => {
      void runAutoRefresh();
      intervalId = setInterval(() => {
        void runAutoRefresh();
      }, AUTO_REFRESH_INTERVAL_MS);
    }, initialDelay);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [autoRefreshSlot, loadStats]);

  const runGitAction = async (
    action: typeof activeAction,
    operation: () => Promise<string>,
  ) => {
    setActiveAction(action);
    setErrorMsg(null);
    setSuccessWithAutoDismiss(null);
    const actionName = action ?? 'unknown';
    addLog(projectPath, { level: 'info', operation: actionName, message: `Starting ${actionName}...` });
    try {
      const result = await operation();
      setSuccessWithAutoDismiss(result);
      addLog(projectPath, { level: 'success', operation: actionName, message: result || `${actionName} completed` });
      await loadStats();
      onRefresh?.();
      onSilentRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(projectPath, { level: 'error', operation: actionName, message: msg, detail: msg });
      // Conflict errors are persistent (no auto-dismiss)
      setErrorMsg(msg, isConflictError(msg));
    } finally {
      setActiveAction(null);
    }
  };

  useImperativeHandle(ref, () => ({
    triggerSync: () => runGitAction('sync', () => syncWithBaseBranch(projectPath, baseBranch)),
    triggerPull: () => runGitAction('pull', () => pullCurrentBranch(projectPath)),
    triggerRefresh: () => handleRefresh(),
  }));

  const handleRefresh = async () => {
    try {
      await syncRemoteState();
      addLog(projectPath, { level: 'success', operation: 'refresh', message: 'Remote state synced' });
      onRefresh?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(projectPath, { level: 'error', operation: 'refresh', message: msg, detail: msg });
      throw err;
    }
  };

  const handleMergeBaseClick = () => {
    setShowMergeBaseConfirm(true);
  };

  const confirmMergeBase = () => {
    setShowMergeBaseConfirm(false);
    runGitAction('mergeBase', () => mergeToBaseBranch(projectPath, baseBranch));
  };

  const computePrefix = useCallback((
    config: { templates: string[]; enabled: boolean },
    prefixIndex: number,
  ): string => {
    if (!config.enabled || config.templates.length === 0) return '';
    if (prefixIndex >= config.templates.length) return ''; // "无" option
    const template = config.templates[prefixIndex] ?? '';
    if (!template) return '';
    const repoName = basename(projectPath);
    return renderCommitPrefix(template, {
      worktreeName: worktreeDisplayName || repoName,
      projectName,
      branchName: currentBranch,
      repoName,
    });
  }, [projectPath, projectName, currentBranch, worktreeDisplayName]);

  // stripPrefix removed - now prefix and content are separate states

  const handleCommitClick = async () => {
    setShowCommitDialog(true);
    setPrefix('');
    setContent('');
    setGeneratingMessage(true);
    try {
      // Check API key first - if no key, skip all AI generation
      const hasKey = await checkCommitAiApiKey();

      let config: { templates: string[]; enabled: boolean; default_index: number };
      try {
        config = await getCommitPrefixConfig();
        setPrefixConfig(config);
        console.log('[commit] got prefix config:', config);
      } catch {
        config = { templates: ['[{{worktree-name}}]'], enabled: true, default_index: 0 };
        setPrefixConfig(config);
        console.log('[commit] fallback prefix config');
      }

      const projectConfig = workspaceConfig?.projects.find((p: { name: string }) => p.name === projectName);
      console.log('[commit] projectConfig:', projectConfig);
      // 优先使用 project 的 commit_prefix_index，如果没有则使用全局 default_index
      let prefixIndex = projectConfig?.commit_prefix_index;
      console.log('[commit] raw prefixIndex from project:', prefixIndex);
      if (prefixIndex == null) {
        prefixIndex = config.default_index;
      }
      if (prefixIndex < 0 || prefixIndex > config.templates.length) prefixIndex = 0;
      console.log('[commit] final prefixIndex:', prefixIndex, 'templates.length:', config.templates.length, 'default_index:', config.default_index);
      setSelectedPrefixIndex(prefixIndex);

      const computedPrefix = computePrefix(config, prefixIndex);
      console.log('[commit] computedPrefix:', computedPrefix);
      setPrefix(computedPrefix);

      if (hasKey) {
        const diff = await getGitDiff(projectPath);
        const msg = await generateCommitMessage(diff);
        setContent(msg);
      }
      // If no key, leave content empty with placeholder - no error thrown
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No changes')) {
        setShowCommitDialog(false);
        setErrorMsg(t('git.noChanges'));
      } else {
        setPrefix('');
        setContent('');
        setErrorMsg(msg);
      }
    } finally {
      setGeneratingMessage(false);
    }
  };

  const handleRegenerateMessage = async () => {
    setGeneratingMessage(true);
    try {
      const hasKey = await checkCommitAiApiKey();
      if (!hasKey) {
        // No API key - nothing to regenerate, just clear generating state
        return;
      }
      const diff = await getGitDiff(projectPath);
      const msg = await generateCommitMessage(diff);
      setContent(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingMessage(false);
    }
  };

  const handlePrefixChange = (index: number) => {
    const newIndex = index;
    setSelectedPrefixIndex(newIndex);
    const newPrefix = computePrefix(prefixConfig, newIndex);
    setPrefix(newPrefix);
  };

  const handlePrefixToContent = () => {
    if (!prefix) return;
    const newContent = prefix + (content ? ' ' + content : '');
    setContent(newContent.trimStart());
    setPrefix('');
    // 切换到"无"选项（索引 = 模板数量，超出范围表示无前缀）
    setSelectedPrefixIndex(prefixConfig.templates.length);
  };

  const handleConfirmCommit = async (withPush: boolean) => {
    const fullMessage = (prefix + content).trim();
    if (!fullMessage) return;
    setCommitting(true);
    try {
      const projectConfig = workspaceConfig?.projects.find((p: { name: string }) => p.name === projectName);
      const globalConfig = await getGitUserGlobalConfig();
      const resolvedName = projectConfig?.git_user_name || globalConfig.name;
      const resolvedEmail = projectConfig?.git_user_email || globalConfig.email;
      if (resolvedName || resolvedEmail) {
        await setGitUserConfig(projectPath, { name: resolvedName, email: resolvedEmail });
      }
      const skipHooks = await getSkipGitHooks();
      await commitAll(projectPath, fullMessage, resolvedName, resolvedEmail, skipHooks);
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
      onSilentRefresh?.();
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
            ? 'bg-[var(--color-error)]/10 border border-[var(--color-error)]/30'
            : 'bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 cursor-pointer'
            } ${dismissing === 'error' ? 'opacity-0' : 'opacity-100'}`}
          onClick={errorPersistent ? undefined : dismissError}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--color-error)] flex-1 whitespace-pre-wrap break-all">
              {isConflictError(error) ? truncateConflictMessage(error) : error}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); dismissError(); }}
              className="shrink-0 p-0.5 rounded hover:bg-[var(--color-error)]/30 transition-colors"
            >
              <CloseIcon className="w-3 h-3 text-[var(--color-error)]" />
            </button>
          </div>
          {errorPersistent && onOpenTerminal && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenTerminal(projectPath);
              }}
              className="mt-1.5 flex items-center gap-1.5 text-[var(--color-error)] hover:text-[var(--color-error)] transition-colors text-xs bg-[var(--color-error)]/20 hover:bg-[var(--color-error)]/30 rounded px-2 py-2 min-h-[44px]"
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
          <CloseIcon className="w-3 h-3 shrink-0 text-[var(--color-success)]" />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--color-text-secondary)]">
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
        <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
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
            onClick={() => runGitAction('pull', () => pullCurrentBranch(projectPath))}
            disabled={loading || actionsDisabled}
            className="text-xs min-w-0"
          >
            <DownloadIcon className="w-3 h-3 mr-1 shrink-0" />
            <span className="truncate">{activeAction === 'pull' ? t('git.pulling') : t('git.pull')}</span>
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

        <TooltipProvider delayDuration={300}>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
          {(() => {
            const mergeTestTip = testBranchExists === false ? t('git.remoteBranchNotExists', { branch: testBranch }) : (stats?.ahead_of_test ?? 0) >= 100 ? t('git.tooManyCommitsToMerge', { branch: testBranch, count: stats?.ahead_of_test ?? 0 }) : '';
            const mergeTestBtn = (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => runGitAction('mergeTest', () => mergeToTestBranch(projectPath, testBranch))}
                disabled={loading || testBranchExists === false || actionsDisabled || (stats?.ahead_of_test ?? 0) >= 100}
                className="text-xs min-w-0 w-full"
              >
                <GitMergeIcon className="w-3 h-3 mr-1 shrink-0" />
                <span className="truncate">{activeAction === 'mergeTest' ? t('git.merging') : t('git.mergeToBranch', { branch: testBranch })}</span>
              </Button>
            );
            return mergeTestTip ? (
              <Tooltip>
                <TooltipTrigger asChild><span>{mergeTestBtn}</span></TooltipTrigger>
                <TooltipContent side="bottom"><p>{mergeTestTip}</p></TooltipContent>
              </Tooltip>
            ) : mergeTestBtn;
          })()}

          {(() => {
            const mergeBaseTip = baseBranchExists === false ? t('git.remoteBranchNotExists', { branch: baseBranch }) : (stats?.ahead ?? 0) >= 100 ? t('git.tooManyCommitsToMerge', { branch: baseBranch, count: stats?.ahead ?? 0 }) : '';
            const mergeBaseBtn = (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleMergeBaseClick}
                disabled={loading || baseBranchExists === false || actionsDisabled || (stats?.ahead ?? 0) >= 100}
                className="text-xs min-w-0 w-full border-orange-800/40 hover:bg-orange-900/20 hover:border-orange-700/50"
              >
                <GitMergeIcon className="w-3 h-3 mr-1 shrink-0 text-orange-400" />
                <span className="truncate text-orange-300">{activeAction === 'mergeBase' ? t('git.merging') : t('git.mergeToBranch', { branch: baseBranch })}</span>
              </Button>
            );
            return mergeBaseTip ? (
              <Tooltip>
                <TooltipTrigger asChild><span>{mergeBaseBtn}</span></TooltipTrigger>
                <TooltipContent side="bottom"><p>{mergeBaseTip}</p></TooltipContent>
              </Tooltip>
            ) : mergeBaseBtn;
          })()}

        </div>
        </TooltipProvider>
      </div>

      {fetchingSyncing && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-accent)]/80">
          <div className="flex-1 h-1 bg-[var(--color-bg-elevated)] rounded-full overflow-hidden">
            <div className="h-full rounded-full animate-progress-indeterminate animate-gradient" />
          </div>
          <span className="whitespace-nowrap">{t('git.syncRemote')}</span>
        </div>
      )}

      {(testBranchExists === false || baseBranchExists === false) && (
        <div className="text-xs text-[var(--color-warning)]/80 flex items-center gap-1">
          <WarningIcon className="w-3.5 h-3.5 text-[var(--color-warning)]" />
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
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{t('git.commitMessage')}</DialogTitle>
            <DialogDescription>
              {generatingMessage ? t('git.generating') : t('git.commitAll')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Content area with prefix block + textarea */}
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden focus-within:border-[var(--color-accent)]">
              {/* Prefix block */}
              {prefixConfig.enabled && prefix && (
                <div
                  onClick={handlePrefixToContent}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-accent)]/10 border-b border-[var(--color-border)]/50 text-xs text-blue-300 cursor-pointer hover:bg-[var(--color-accent)]/15 transition-colors select-none"
                  title={t('git.clickPrefixToEdit', '点击将前缀转换为可编辑内容')}
                >
                  <Pencil className="w-3 h-3 text-[var(--color-accent)]/70 shrink-0" />
                  <span className="font-mono truncate">{prefix}</span>
                </div>
              )}
              {/* Content textarea */}
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                }}
                placeholder={generatingMessage ? t('git.generating') : t('git.commitMessagePlaceholder', '输入 commit 内容...')}
                disabled={generatingMessage}
                className="w-full bg-transparent p-3 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] resize-none focus:outline-none"
                rows={4}
              />
            </div>

            {/* Preview of full message */}
            {(prefix || content) && (
              <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-base)]/50 rounded px-2 py-1.5 border border-[var(--color-border)]/30">
                <span className="text-[var(--color-text-secondary)]">{t('git.preview', '预览')}:</span>{' '}
                <span className="text-[var(--color-text-secondary)] font-mono">{(prefix + content) || t('git.emptyMessage', '(空)')}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* Prefix selector + tooltip group */}
              {prefixConfig.enabled && prefixConfig.templates.length > 0 && (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  {/* Desktop: horizontal pills */}
                  <div className="hidden min-[480px]:flex gap-1 flex-wrap">
                    {prefixConfig.templates.map((tpl, i) => (
                      <button
                        key={i}
                        onClick={() => handlePrefixChange(i)}
                        className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                          selectedPrefixIndex === i
                            ? 'bg-[var(--color-accent)] text-white'
                            : 'bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]'
                        }`}
                      >
                        {tpl}
                      </button>
                    ))}
                    <button
                      onClick={handlePrefixToContent}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                        selectedPrefixIndex === prefixConfig.templates.length
                          ? 'bg-[var(--color-accent)]/80 text-white'
                          : 'bg-[var(--color-bg-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-elevated)]'
                      }`}
                    >
                      {t('git.noPrefix')}
                    </button>
                  </div>

                  {/* Mobile: native dropdown */}
                  <select
                    className="min-[480px]:hidden w-full h-8 text-xs border rounded px-2"
                    value={selectedPrefixIndex}
                    onChange={(e) => handlePrefixChange(Number(e.target.value))}
                    disabled={generatingMessage}
                  >
                    {prefixConfig.templates.map((tpl, i) => <option key={i} value={i}>{tpl}</option>)}
                    <option value={prefixConfig.templates.length}>{t('git.noPrefix')}</option>
                  </select>

                  {/* Prefix help tooltip */}
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center shrink-0">
                          <HelpCircle className="w-3 h-3 text-[var(--color-text-muted)] cursor-help" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p>{t('git.prefixTip', 'Click prefix to edit as text. A prefix like [feat] or [fix] is prepended to your commit message.')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerateMessage}
                disabled={generatingMessage}
                className="text-xs shrink-0"
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
              disabled={!(prefix + content).trim() || committing || generatingMessage}
            >
              {t('git.commitOnly')}
            </Button>
            <Button
              onClick={() => handleConfirmCommit(true)}
              disabled={!(prefix + content).trim() || committing || generatingMessage}
            >
              {committing ? t('git.committing') : t('git.commitAndPush')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
});

GitOperations.displayName = 'GitOperations';
