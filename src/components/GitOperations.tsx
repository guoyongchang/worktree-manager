import { useState, useEffect, useRef, useCallback, type FC } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
import { Pencil, Star } from 'lucide-react';
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
  checkDashscopeApiKey,
  getCommitPrefixConfig,
  setCommitPrefixConfig,
  getGitUserGlobalConfig,
  setGitUserConfig,
  type BranchDiffStats,
} from '@/lib/backend';
import type { WorkspaceConfig } from '@/types';
import { renderCommitPrefix } from '@/lib/commit-prefix';
import { CreatePRModal } from './CreatePRModal';

const AUTO_REFRESH_INTERVAL_MS = 60_000;
const AUTO_REFRESH_STAGGER_MS = 15_000;
const AUTO_REFRESH_SLOTS = 4;

// Heuristic: detect merge conflict errors from git output
function isConflictError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('conflict') || lower.includes('merge_conflict') || lower.includes('fix conflicts');
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
  onOpenTerminal?: (path: string) => void;
  autoRefreshSlot?: number;
}

export const GitOperations: FC<GitOperationsProps> = ({
  projectPath,
  projectName,
  baseBranch,
  testBranch,
  currentBranch,
  worktreeDisplayName,
  workspaceConfig,
  onRefresh,
  onOpenTerminal,
  autoRefreshSlot,
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
        await syncRemoteState();
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
  }, [autoRefreshSlot, syncRemoteState]);

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(projectPath, { level: 'error', operation: actionName, message: msg, detail: msg });
      // Conflict errors are persistent (no auto-dismiss)
      setErrorMsg(msg, isConflictError(msg));
    } finally {
      setActiveAction(null);
    }
  };

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
    const repoName = projectPath.split('/').pop() || '';
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
      let config: { templates: string[]; enabled: boolean; default_index: number };
      try {
        config = await getCommitPrefixConfig();
        setPrefixConfig(config);
      } catch {
        config = { templates: ['[{{worktree-name}}]'], enabled: true, default_index: 0 };
        setPrefixConfig(config);
      }

      const projectConfig = workspaceConfig?.projects.find((p: { name: string }) => p.name === projectName);
      // 优先使用 project 的 commit_prefix_index，如果没有则使用全局 default_index
      let prefixIndex = projectConfig?.commit_prefix_index;
      if (prefixIndex === undefined) {
        prefixIndex = config.default_index;
      }
      if (prefixIndex < 0 || prefixIndex > config.templates.length) prefixIndex = 0;
      setSelectedPrefixIndex(prefixIndex);

      const computedPrefix = computePrefix(config, prefixIndex);
      setPrefix(computedPrefix);

      const hasKey = await checkDashscopeApiKey();
      if (hasKey) {
        const diff = await getGitDiff(projectPath);
        const msg = await generateCommitMessage(diff);
        setContent(msg);
      } else {
        setContent('');
      }
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
      const hasKey = await checkDashscopeApiKey();
      if (!hasKey) return;
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
      await commitAll(projectPath, fullMessage, resolvedName, resolvedEmail);
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
        <DialogContent className="max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{t('git.commitMessage')}</DialogTitle>
            <DialogDescription>
              {generatingMessage ? t('git.generating') : t('git.commitAll')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {/* Content area with prefix block + textarea */}
            <div className="bg-slate-800 border border-slate-600 rounded-lg overflow-hidden focus-within:border-blue-500">
              {/* Prefix block */}
              {prefixConfig.enabled && prefix && (
                <div
                  onClick={handlePrefixToContent}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 border-b border-slate-600/50 text-xs text-blue-300 cursor-pointer hover:bg-blue-500/15 transition-colors select-none"
                  title={t('git.clickPrefixToEdit', '点击将前缀转换为可编辑内容')}
                >
                  <Pencil className="w-3 h-3 text-blue-400/70 shrink-0" />
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
                className="w-full bg-transparent p-3 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none"
                rows={4}
              />
            </div>

            {/* Preview of full message */}
            {(prefix || content) && (
              <div className="text-xs text-slate-500 bg-slate-900/50 rounded px-2 py-1.5 border border-slate-700/30">
                <span className="text-slate-400">{t('git.preview', '预览')}:</span>{' '}
                <span className="text-slate-300 font-mono">{(prefix + content) || t('git.emptyMessage', '(空)')}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              {/* Prefix template selector */}
              {prefixConfig.enabled && prefixConfig.templates.length > 0 && (
                <Select
                  value={String(selectedPrefixIndex)}
                  onValueChange={(v) => handlePrefixChange(Number(v))}
                  disabled={generatingMessage}
                >
                  <SelectTrigger className="w-48 truncate text-xs h-8">
                    <SelectValue placeholder={t('git.selectPrefix')} />
                  </SelectTrigger>
                  <SelectContent className="prefix-select-dropdown"
                  >
                    <style>{`
                      .prefix-select-dropdown [data-radix-select-viewport] [role="option"] {
                        padding-right: 0.5rem !important;
                      }
                      .prefix-select-dropdown [data-radix-select-viewport] [role="option"] .absolute.right-2 {
                        display: none !important;
                      }
                    `}</style>
                    {prefixConfig.templates.map((tmpl, idx) => {
                      const label = renderCommitPrefix(tmpl, {
                        worktreeName: worktreeDisplayName || projectPath.split('/').pop() || '',
                        projectName,
                        branchName: currentBranch,
                        repoName: projectPath.split('/').pop() || '',
                      }) || t('git.emptyPrefix', '(空模板)');
                      const isDefault = idx === prefixConfig.default_index;
                      return (
                        <SelectItem key={idx} value={String(idx)} className="text-xs"
                        >
                          <span className="flex items-center w-full gap-2"
                          >
                            <button
                              type="button"
                              className="p-0.5 rounded hover:bg-slate-700/50 pointer-events-auto"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const newConfig = { ...prefixConfig, default_index: idx };
                                setPrefixConfig(newConfig);
                                setCommitPrefixConfig({
                                  templates: prefixConfig.templates,
                                  enabled: prefixConfig.enabled,
                                  default_index: idx,
                                }).catch(() => {});
                              }}
                            >
                              <Star
                                className={`w-3 h-3 ${isDefault ? 'fill-amber-400 text-amber-400' : 'text-slate-500 hover:text-amber-400'}`}
                              />
                            </button>
                            <span className="truncate">{label}</span>
                          </span>
                        </SelectItem>
                      );
                    })}
                    <SelectItem value={String(prefixConfig.templates.length)} className="text-xs"
                    >
                      <span className="flex items-center w-full gap-2"
                      >
                        <button
                          type="button"
                          className="p-0.5 rounded hover:bg-slate-700/50 pointer-events-auto"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const noPrefixIdx = prefixConfig.templates.length;
                            const newConfig = { ...prefixConfig, default_index: noPrefixIdx };
                            setPrefixConfig(newConfig);
                            setCommitPrefixConfig({
                              templates: prefixConfig.templates,
                              enabled: prefixConfig.enabled,
                              default_index: noPrefixIdx,
                            }).catch(() => {});
                          }}
                        >
                          <Star
                            className={`w-3 h-3 ${prefixConfig.default_index === prefixConfig.templates.length ? 'fill-amber-400 text-amber-400' : 'text-slate-500 hover:text-amber-400'}`}
                          />
                        </button>
                        <span>{t('git.noPrefix', '无')}</span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}

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
