import { useState, useEffect, useRef, type FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  FolderIcon,
  ArchiveIcon,
  WarningIcon,
  GitBranchIcon,
  TerminalIcon,
  ChevronDownIcon,
  RefreshIcon,
  PlusIcon,
  ExternalLinkIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  FolderOpenIcon,
  GithubIcon,
  EditorIcon,
} from './Icons';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Editor from '@monaco-editor/react';
import {
  clearLogs,
  getLogs,
  getUnreadErrorCount,
  markAsRead,
} from '@/lib/operationLog';
import type { LogEntry } from '@/lib/operationLog';
import { GitOperations } from './GitOperations';
import { IdePickerContextMenu, TerminalPickerPopover } from './ContextMenus';
import { EDITORS } from '../constants';
import { isTauri, openLink } from '@/lib/backend';
import type {
  WorktreeListItem,
  MainWorkspaceStatus,
  MainWorkspaceOccupation,
  ProjectStatus,
  EditorType,
} from '../types';

const StatusBadges: FC<{ project: ProjectStatus }> = ({ project }) => {
  const { t } = useTranslation();
  const badges: { label: string; variant: 'warning' | 'success' | 'default' | 'error' }[] = [];
  if (project.has_uncommitted) badges.push({ label: t('detail.uncommitted', { count: project.uncommitted_count }), variant: 'warning' });
  if (project.unpushed_commits > 0) badges.push({ label: t('detail.unpushedCommits', { count: project.unpushed_commits }), variant: 'warning' });
  if (project.ahead_of_base > 0) badges.push({ label: t('detail.notMergedToBase', { branch: project.base_branch, count: project.ahead_of_base }), variant: 'default' });
  if (project.ahead_of_test > 0) badges.push({ label: t('detail.notMergedToTest', { branch: project.test_branch, count: project.ahead_of_test }), variant: 'default' });
  if (project.behind_base > 0) badges.push({ label: t('detail.behind', { count: project.behind_base }), variant: 'default' });
  if (badges.length === 0) return <Badge variant="success">{t('detail.clean')}</Badge>;
  return (
    <div className="flex flex-wrap gap-1 justify-end">
      {badges.map((b, i) => (
        <Badge
          key={i}
          variant={b.variant === 'error' ? 'warning' : b.variant}
        >
          {b.label}
        </Badge>
      ))}
    </div>
  );
};

interface WorktreeDetailProps {
  selectedWorktree: WorktreeListItem | null;
  mainWorkspace: MainWorkspaceStatus | null;
  selectedEditor: EditorType;
  showEditorMenu: boolean;
  onShowEditorMenu: (show: boolean) => void;
  onSelectEditor: (editor: EditorType) => void;
  onOpenInEditor: (path: string, editor?: EditorType) => void;
  onOpenInTerminal: (path: string, terminal?: string) => void;
  onRevealInFinder: (path: string) => void;
  onSwitchBranch: (projectPath: string, branch: string) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete?: () => void;
  onAddProject?: () => void;
  onRemoveProject?: (name: string) => Promise<void>;
  onAddProjectToWorktree?: () => void;
  onRefresh?: () => void;
  onOpenTerminalPanel?: (path: string) => void;
  error: string | null;
  onClearError: () => void;
  restoring?: boolean;
  switching?: boolean;
  occupation?: MainWorkspaceOccupation | null;
  deploying?: boolean;
  exiting?: boolean;
  onDeployToMain?: (name: string) => Promise<any>;
  onExitOccupation?: (force?: boolean) => Promise<any>;
  onRefreshAfterDeploy?: () => void;
}

// --- IdeIconButton ---

interface IdeIconButtonProps {
  projectPath: string;
  projectName: string;
  editors: Array<{ id: string; name: string }>;
  defaultEditorId: string;
  onOpen: (path: string, editorId: string) => void;
}

const IdeIconButton: FC<IdeIconButtonProps> = ({
  projectPath,
  projectName,
  editors,
  defaultEditorId,
  onOpen,
}) => {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const currentEditor = editors.find((e) => e.id === defaultEditorId);

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={() => onOpen(projectPath, defaultEditorId)}
        onMouseDown={(e) => {
          if (e.button !== 2) return;
          e.preventDefault();
          e.stopPropagation();
          setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        title={t('detail.openInEditorLabel', { editor: currentEditor?.name ?? defaultEditorId })}
        aria-label={t('detail.openInEditorProject', {
          editor: currentEditor?.name ?? defaultEditorId,
          name: projectName,
        })}
        className="h-7 w-7"
      >
        <EditorIcon editorId={defaultEditorId} className="w-4.5 h-4.5" />
      </Button>
      {anchorRect && (
        <IdePickerContextMenu
          anchorRect={anchorRect}
          editors={editors}
          onSelect={(editorId) => onOpen(projectPath, editorId)}
          onClose={() => setAnchorRect(null)}
        />
      )}
    </>
  );
};

// --- TerminalIconButton ---

interface TerminalIconButtonProps {
  projectPath: string;
  projectName: string;
  terminals: Array<{ id: string; name: string }>;
  onOpen: (path: string, terminalId?: string) => void;
}

const TerminalIconButton: FC<TerminalIconButtonProps> = ({
  projectPath,
  projectName,
  terminals,
  onOpen,
}) => {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        onClick={() => onOpen(projectPath)}
        onMouseDown={(e) => {
          if (e.button !== 2) return;
          e.preventDefault();
          e.stopPropagation();
          if (terminals.length > 1) {
            setAnchorRect(buttonRef.current?.getBoundingClientRect() ?? null);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        title={t('detail.openExternalTerminal')}
        aria-label={t('detail.openExternalTerminalProject', { name: projectName })}
        className="h-7 w-7"
      >
        <TerminalIcon className="w-4.5 h-4.5" />
      </Button>
      {anchorRect && (
        <TerminalPickerPopover
          anchorRect={anchorRect}
          terminals={terminals}
          onSelect={(terminalId) => onOpen(projectPath, terminalId)}
          onClose={() => setAnchorRect(null)}
        />
      )}
    </>
  );
};

// --- LogsDialog ---

const LogsDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPaths: string[];
  title: string;
}> = ({ open, onOpenChange, projectPaths, title }) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (open) {
      const allLogs = projectPaths
        .flatMap((path) => getLogs(path))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      setLogs(allLogs);
      projectPaths.forEach((path) => markAsRead(path));
    }
  }, [open, projectPaths]);

  const content =
    logs.length === 0
      ? t('logs.empty')
      : logs
          .map((entry) => {
            const time = entry.timestamp.toLocaleTimeString('en-US', { hour12: false });
            const level = `[${entry.level.toUpperCase()}]`.padEnd(9);
            const op = entry.operation.padEnd(12);
            const line = `[${time}] ${level} ${op} ${entry.message}`;
            return entry.detail
              ? `${line}\n${' '.repeat(32)}${entry.detail.replace(/\n/g, `\n${' '.repeat(32)}`)}`
              : line;
          })
          .join('\n');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-slate-700/50">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium">
              {title}
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-slate-400 hover:text-red-400"
              onClick={() => {
                projectPaths.forEach((path) => clearLogs(path));
                setLogs([]);
                onOpenChange(false);
              }}
            >
              {t('logs.clear')}
            </Button>
          </div>
        </DialogHeader>
        <div style={{ height: '60vh' }}>
          <Editor
            value={content}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              wordWrap: 'on',
              fontSize: 12,
              scrollBeyondLastLine: false,
              lineNumbers: 'off',
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

function getProjectStatus(project: ProjectStatus): 'success' | 'warning' | 'info' | 'sync' {
  if (project.has_uncommitted) return 'warning';
  if (project.is_merged_to_test) return 'success';
  if (project.behind_base > 0) return 'sync';
  return 'success';
}

const statusBorderColor: Record<ReturnType<typeof getProjectStatus>, string> = {
  success: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  info: 'border-l-blue-500',
  sync: 'border-l-blue-400',
};

/** Convert a git remote URL (SSH or HTTPS) to a web-browsable URL. */
function gitUrlToWebUrl(remoteUrl: string): string | null {
  if (!remoteUrl) return null;
  let url = remoteUrl.trim();
  // SSH: git@github.com:user/repo.git → https://github.com/user/repo
  const sshMatch = url.match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
  // HTTPS: https://github.com/user/repo.git → https://github.com/user/repo
  if (url.startsWith('http')) {
    url = url.replace(/\.git$/, '');
    return url;
  }
  return null;
}


const PathDisplay: FC<{ path: string }> = ({ path }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="text-slate-500 text-sm mt-1 select-text hover:text-slate-400 transition-colors flex items-center gap-1.5 max-w-full group"
          >
            <span className="truncate block">{path}</span>
            {copied ? (
              <CheckIcon className="w-3 h-3 text-green-400 shrink-0" />
            ) : (
              <CopyIcon className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start">
          <p className="max-w-md break-all">{path}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const CopyableTitle: FC<{ text: string; className?: string }> = ({ text, className }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className={`group flex items-center gap-1.5 min-w-0 max-w-full hover:text-white transition-colors ${className || ''}`}
          >
            <span className="truncate">{text}</span>
            {copied ? (
              <CheckIcon className="w-3.5 h-3.5 text-green-400 shrink-0" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-slate-400" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {copied ? t('common.copied', 'Copied!') : t('common.clickToCopy', 'Click to copy')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const WorktreeDetail: FC<WorktreeDetailProps> = ({
  selectedWorktree,
  mainWorkspace,
  selectedEditor,
  showEditorMenu,
  onShowEditorMenu,
  onSelectEditor,
  onOpenInEditor,
  onOpenInTerminal,
  onRevealInFinder,
  onSwitchBranch,
  onArchive,
  onRestore,
  onDelete,
  onAddProject,
  onRemoveProject,
  onAddProjectToWorktree,
  onRefresh,
  onOpenTerminalPanel,
  error,
  onClearError,
  restoring = false,
  switching = false,
  occupation,
  deploying = false,
  exiting = false,
  onDeployToMain,
  onExitOccupation,
  onRefreshAfterDeploy,
}) => {
  const { t } = useTranslation();
  // Dynamic editor list from system detection (auto-detected on startup)
  const readDetectedEditors = useCallback((): Array<{ id: string; name: string }> => {
    try {
      const stored = localStorage.getItem('detected_editors');
      const hiddenIds: string[] = JSON.parse(localStorage.getItem('hidden_editors') || '[]');
      if (stored) {
        const parsed = JSON.parse(stored) as Array<{ id: string; name: string }>;
        const visible = parsed.filter(e => !hiddenIds.includes(e.id));
        if (visible.length > 0) return visible;
      }
    } catch { /* ignore */ }
    return EDITORS; // fallback to hardcoded list
  }, []);

  const [detectedEditors, setDetectedEditors] = useState(readDetectedEditors);

  useEffect(() => {
    const handleDetected = () => setDetectedEditors(readDetectedEditors());
    window.addEventListener('editors-detected', handleDetected);
    return () => window.removeEventListener('editors-detected', handleDetected);
  }, [readDetectedEditors]);

  const readDetectedTerminals = useCallback((): Array<{ id: string; name: string }> => {
    try {
      const stored = localStorage.getItem('detected_terminals');
      if (stored) return JSON.parse(stored) as Array<{ id: string; name: string }>;
    } catch { /* ignore */ }
    return [];
  }, []);

  const [detectedTerminals, setDetectedTerminals] = useState(readDetectedTerminals);

  useEffect(() => {
    const handleDetected = () => setDetectedTerminals(readDetectedTerminals());
    window.addEventListener('terminals-detected', handleDetected);
    return () => window.removeEventListener('terminals-detected', handleDetected);
  }, [readDetectedTerminals]);

  const selectedEditorName = detectedEditors.find((e: { id: string; name: string }) => e.id === selectedEditor)?.name || selectedEditor;

  // Per-project IDE preference: returns project-specific editor or global default
  // Falls back to first visible editor if the preferred one is no longer available
  const getProjectEditor = useCallback((projName: string): string => {
    try {
      const prefs: Record<string, string> = JSON.parse(localStorage.getItem('project_preferred_editors') || '{}');
      if (prefs[projName]) {
        // Validate: is this editor still in the visible list?
        if (detectedEditors.some(e => e.id === prefs[projName])) {
          return prefs[projName];
        }
      }
    } catch { /* ignore */ }
    // Fallback: global selected editor if still visible, otherwise first in list
    if (detectedEditors.some(e => e.id === selectedEditor)) return selectedEditor;
    return detectedEditors[0]?.id || selectedEditor;
  }, [selectedEditor, detectedEditors]);

  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [removingProject, setRemovingProject] = useState<string | null>(null);
  const [confirmRemoveProject, setConfirmRemoveProject] = useState<string | null>(null);
  const [showWorktreeLogs, setShowWorktreeLogs] = useState(false);
  const [showMainLogs, setShowMainLogs] = useState(false);

  const handleDeploy = useCallback(async (name: string) => {
    try {
      await onDeployToMain?.(name);
      onRefreshAfterDeploy?.();
    } catch (_e: any) {
      // Error surfaces via the error prop from parent
    }
  }, [onDeployToMain, onRefreshAfterDeploy]);

  const handleExitOccupation = useCallback(async (force?: boolean) => {
    try {
      setExitError(null);
      await onExitOccupation?.(force);
      setShowExitConfirm(false);
      onRefreshAfterDeploy?.();
    } catch (e: any) {
      setExitError(String(e?.message || e));
    }
  }, [onExitOccupation, onRefreshAfterDeploy]);

  if (!selectedWorktree && !mainWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20">
        <FolderIcon className="w-12 h-12 text-slate-700 mb-4" />
        <p className="text-slate-500 text-sm">{t('detail.selectWorktree')}</p>
        <p className="text-slate-600 text-xs mt-1">{t('detail.selectWorktreeHint')}</p>
      </div>
    );
  }

  // Show loading overlay when switching
  if (switching) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <RefreshIcon className="w-8 h-8 text-blue-400 animate-spin" />
          <div className="text-slate-400 text-sm">{t('detail.switching')}</div>
        </div>
      </div>
    );
  }

  // Main Workspace View
  if (!selectedWorktree && mainWorkspace) {
    return (
      <div>
        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800/50 rounded-lg">
            <div className="text-red-300 text-sm select-text">{error}</div>
            <Button variant="link" size="sm" onClick={onClearError} className="text-red-400 hover:text-red-200 mt-1 p-0 h-auto">{t('common.close')}</Button>
          </div>
        )}
        {occupation && (
          <div className="mb-4 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 flex items-center justify-between">
            <span className="text-sm text-blue-300 select-text">
              {t('deploy.occupiedBanner', { name: occupation.worktree_name })}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setExitError(null); setShowExitConfirm(true); }}
              disabled={exiting}
            >
              {exiting ? t('deploy.exiting') : t('deploy.exitOccupation')}
            </Button>
          </div>
        )}
        {showExitConfirm && (
          <div className="mb-4 rounded-lg bg-slate-800 border border-slate-600 p-4 space-y-3">
            <div className="text-sm text-slate-200 font-medium">{t('deploy.confirmExit')}</div>
            <div className="text-xs text-slate-400">{t('deploy.confirmExitDesc')}</div>
            {exitError && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded p-2">{exitError}</div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowExitConfirm(false)}>{t('common.cancel')}</Button>
              <Button size="sm" variant="default" onClick={() => handleExitOccupation(false)} disabled={exiting}>
                {exiting ? t('deploy.exiting') : t('deploy.exitOccupation')}
              </Button>
              {exitError && (
                <Button size="sm" variant="destructive" onClick={() => handleExitOccupation(true)} disabled={exiting}>
                  {t('deploy.forceExit')}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mb-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-slate-100 truncate">{t('detail.mainWorkspace', { name: mainWorkspace.name })}</h2>
            <PathDisplay path={mainWorkspace.path} />
          </div>
          {isTauri() && (
            <div className="flex gap-2 items-center shrink-0 ml-3">
              {(() => {
                const count = (mainWorkspace.projects ?? []).reduce(
                  (acc, p) => acc + getUnreadErrorCount(p.path),
                  0,
                );
                return (
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => setShowMainLogs(true)}
                    >
                      {t('logs.button')}
                    </Button>
                    {count > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                        {count > 9 ? '9+' : count}
                      </span>
                    )}
                  </div>
                );
              })()}
              <LogsDialog
                open={showMainLogs}
                onOpenChange={setShowMainLogs}
                projectPaths={(mainWorkspace.projects ?? []).map((p) => p.path)}
                title={t('logs.title', { name: mainWorkspace.name })}
              />
              {onAddProject && (
                <Button onClick={onAddProject} variant="default">
                  <PlusIcon className="w-4 h-4 mr-1.5" />
                  {t('detail.addProject')}
                </Button>
              )}
              <div className="inline-flex rounded-md">
                <Button
                  className="rounded-r-none border-r border-blue-700/50 px-2.5"
                  onClick={() => onOpenInEditor(mainWorkspace.path)}
                  title={selectedEditorName}
                >
                  <EditorIcon editorId={selectedEditor} className="w-5 h-5" />
                </Button>
                <DropdownMenu open={showEditorMenu} onOpenChange={onShowEditorMenu}>
                  <DropdownMenuTrigger asChild>
                    <Button className="rounded-l-none px-2 min-w-0">
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {detectedEditors.map(editor => (
                      <div
                        key={editor.id}
                        className="flex items-stretch rounded-sm text-sm"
                      >
                        <button
                          className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-l-sm hover:bg-slate-700/60 transition-colors flex items-center gap-1.5"
                          onClick={() => {
                            onSelectEditor(editor.id);
                            onShowEditorMenu(false);
                          }}
                        >
                          <EditorIcon editorId={editor.id} className="w-4 h-4" />
                          {editor.name}
                          {editor.id === selectedEditor && (
                            <CheckIcon className="w-3 h-3 text-green-400" />
                          )}
                        </button>
                        <button
                          className="px-2 flex items-center text-slate-500 hover:text-blue-400 hover:bg-slate-600/40 rounded-r-sm transition-colors shrink-0 border-l border-slate-700/50"
                          title={t('detail.openWithEditor', { editor: editor.name })}
                          onClick={() => {
                            onOpenInEditor(mainWorkspace.path, editor.id);
                            onShowEditorMenu(false);
                          }}
                        >
                          <ExternalLinkIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onRevealInFinder(mainWorkspace.path)}>
                      <FolderIcon className="w-4 h-4 mr-1.5 text-slate-400" />
                      {t('detail.openInFolder')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button variant="secondary" onClick={() => onOpenInTerminal(mainWorkspace.path)}>{t('detail.externalTerminal')}</Button>
            </div>
          )}
        </div>

        <>
            {occupation ? (
              /* Deployed state: show only deployed projects in worktree-style cards */
              <div className="space-y-2">
                {mainWorkspace.projects
                  .filter(proj => occupation.original_branches[proj.name])
                  .map(proj => {
                    const projectPath = proj.path;
                    const projAsStatus = {
                      name: proj.name,
                      path: proj.path,
                      current_branch: proj.current_branch,
                      base_branch: proj.base_branch,
                      test_branch: proj.test_branch,
                      has_uncommitted: proj.has_uncommitted,
                      uncommitted_count: proj.uncommitted_count,
                      is_merged_to_test: proj.is_merged_to_test,
                      is_merged_to_base: proj.is_merged_to_base,
                      ahead_of_base: proj.ahead_of_base,
                      behind_base: proj.behind_base,
                      ahead_of_test: proj.ahead_of_test,
                      unpushed_commits: proj.unpushed_commits,
                      remote_url: '',
                    };
                    const status = getProjectStatus(projAsStatus);
                    return (
                      <div key={proj.name} className={`bg-slate-800/50 border border-slate-700/50 border-l-2 ${statusBorderColor[status]} rounded-lg p-4 group hover:border-t-slate-600 hover:border-r-slate-600 hover:border-b-slate-600 hover:shadow-md hover:shadow-black/10 hover:-translate-y-px transition-all duration-150`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="font-medium text-slate-200">{proj.name}</div>
                              <div className="flex items-center gap-1.5 text-slate-400 text-sm mt-0.5">
                                <GitBranchIcon className="w-3.5 h-3.5" />
                                <span className="select-text">{proj.current_branch}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <StatusBadges project={projAsStatus} />
                              <div className="text-xs text-slate-500 mt-0.5 select-text">{t('detail.branchInfo', { base: proj.base_branch, test: proj.test_branch })}</div>
                            </div>
                            {isTauri() && (
                              <div className="flex items-center gap-1 text-slate-500 hover:text-slate-200">
                                <IdeIconButton
                                  projectPath={projectPath}
                                  projectName={proj.name}
                                  editors={detectedEditors}
                                  defaultEditorId={getProjectEditor(proj.name)}
                                  onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
                                />
                                <TerminalIconButton
                                  projectPath={projectPath}
                                  projectName={proj.name}
                                  terminals={detectedTerminals}
                                  onOpen={(path, terminalId) => onOpenInTerminal(path, terminalId)}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-slate-700/50">
                          <GitOperations
                            projectPath={projectPath}
                            baseBranch={proj.base_branch}
                            testBranch={proj.test_branch}
                            currentBranch={proj.current_branch}
                            onRefresh={onRefresh}
                            onOpenTerminal={onOpenTerminalPanel}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              /* Normal state: show all projects in grid layout */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {mainWorkspace.projects.map(proj => {
                  const projectPath = proj.path;
                  const isSwitching = switchingBranch === proj.name;

                  const handleSwitchBranch = async (branch: string) => {
                    setSwitchingBranch(proj.name);
                    try {
                      await onSwitchBranch(projectPath, branch);
                    } finally {
                      setSwitchingBranch(null);
                    }
                  };

                  return (
                    <div key={proj.name} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 group hover:border-slate-600 hover:shadow-md hover:shadow-black/10 hover:-translate-y-px transition-all duration-150">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-200">{proj.name}</span>
                        <div className="flex items-center gap-1 text-slate-500 hover:text-slate-200">
                          {isTauri() && (
                            <button
                              onClick={() => onRevealInFinder(projectPath)}
                              className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200 transition-colors"
                              title={t('detail.openInFinderLabel')}
                              aria-label={t('detail.openInFinderProject', { name: proj.name })}
                            >
                              <FolderIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isTauri() && (
                            <IdeIconButton
                              projectPath={projectPath}
                              projectName={proj.name}
                              editors={detectedEditors}
                              defaultEditorId={getProjectEditor(proj.name)}
                              onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
                            />
                          )}
                          {onRemoveProject && (
                            <button
                              onClick={() => setConfirmRemoveProject(proj.name)}
                              className="p-1 hover:bg-red-600/20 rounded text-slate-500 hover:text-red-400 transition-colors"
                              title={t('detail.removeProject', 'Remove from workspace')}
                              aria-label={t('detail.removeProjectLabel', { name: proj.name })}
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {proj.has_uncommitted && <WarningIcon className="w-4 h-4 text-amber-500" />}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                          <GitBranchIcon className="w-3.5 h-3.5" />
                          <span className="select-text">{proj.current_branch}</span>
                          {isSwitching && <RefreshIcon className="w-3 h-3 animate-spin ml-1" />}
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <Button
                            variant={proj.current_branch === proj.base_branch ? 'default' : 'ghost'}
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={isSwitching || proj.current_branch === proj.base_branch}
                            onClick={() => handleSwitchBranch(proj.base_branch)}
                          >
                            {proj.current_branch === proj.base_branch && <CheckIcon className="w-3 h-3 mr-1 text-green-400" />}
                            BASE
                          </Button>
                          <Button
                            variant={proj.current_branch === proj.test_branch ? 'default' : 'ghost'}
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={isSwitching || proj.current_branch === proj.test_branch}
                            onClick={() => handleSwitchBranch(proj.test_branch)}
                          >
                            {proj.current_branch === proj.test_branch && <CheckIcon className="w-3 h-3 mr-1 text-green-400" />}
                            TEST
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={isSwitching}
                            onClick={() => handleSwitchBranch('HEAD')}
                            title={t('detail.switchToHead')}
                          >
                            HEAD
                          </Button>
                        </div>
                      </div>
                      {/* Status badges — hide 'not merged to test' for main workspace */}
                      <div className="mt-2">
                        <StatusBadges project={{
                          name: proj.name,
                          path: proj.path,
                          current_branch: proj.current_branch,
                          base_branch: proj.base_branch,
                          test_branch: proj.test_branch,
                          has_uncommitted: proj.has_uncommitted,
                          uncommitted_count: proj.uncommitted_count,
                          is_merged_to_test: true,
                          is_merged_to_base: proj.is_merged_to_base,
                          ahead_of_base: proj.ahead_of_base,
                          behind_base: proj.behind_base,
                          ahead_of_test: 0,
                          unpushed_commits: proj.unpushed_commits,
                          remote_url: '',
                        }} />
                      </div>
                      {/* Git operations */}
                      <div className="mt-3 pt-3 border-t border-slate-700/50">
                        <GitOperations
                          projectPath={proj.path}
                          baseBranch={proj.base_branch}
                          testBranch={proj.test_branch}
                          currentBranch={proj.current_branch}
                          onRefresh={onRefresh}
                          onOpenTerminal={onOpenTerminalPanel}
                        />
                      </div>
                      {proj.linked_folders && proj.linked_folders.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-700/50">
                          <div className="text-xs text-slate-500 mb-1">{t('detail.linkedFolders')}</div>
                          <div className="flex flex-wrap gap-1">
                            {proj.linked_folders.map((folder, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-1.5 py-0.5 bg-slate-700/50 rounded text-xs text-slate-400 select-text"
                              >
                                {folder}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Remove confirmation */}
                      {confirmRemoveProject === proj.name && (
                        <div className="mt-2 p-2.5 bg-red-900/20 border border-red-800/40 rounded-lg">
                          <p className="text-sm text-red-300 mb-2">{t('detail.confirmRemoveProject', { name: proj.name })}</p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setConfirmRemoveProject(null)}
                            >
                              {t('common.cancel', 'Cancel')}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={removingProject === proj.name}
                              onClick={async () => {
                                setRemovingProject(proj.name);
                                await onRemoveProject?.(proj.name);
                                setRemovingProject(null);
                                setConfirmRemoveProject(null);
                              }}
                            >
                              {removingProject === proj.name
                                ? t('detail.removing', 'Removing...')
                                : t('detail.confirmRemove', 'Remove')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </>
      </div>
    );
  }

  // Worktree View
  if (selectedWorktree) {
    return (
      <div>
        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800/50 rounded-lg">
            <div className="text-red-300 text-sm select-text">{error}</div>
            <Button variant="link" size="sm" onClick={onClearError} className="text-red-400 hover:text-red-200 mt-1 p-0 h-auto">{t('common.close')}</Button>
          </div>
        )}
        <div className="flex items-center justify-between mb-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {selectedWorktree.is_archived ? <ArchiveIcon className="w-5 h-5 text-slate-500" /> : <FolderIcon className="w-5 h-5 text-blue-400" />}
              <CopyableTitle text={selectedWorktree.display_name || selectedWorktree.name} className="text-xl font-semibold text-slate-100" />
            </div>
            <PathDisplay path={selectedWorktree.path} />
          </div>
          <div className="flex gap-2 items-center shrink-0 ml-3">
            {selectedWorktree.is_archived ? (
              <>
                <Button variant="default" className="bg-emerald-600 hover:bg-emerald-500" onClick={onRestore} disabled={restoring}>
                  {restoring ? t('detail.restoring') : t('detail.restore')}
                </Button>
                {onDelete && (
                  <Button variant="destructive" onClick={onDelete}>{t('detail.delete')}</Button>
                )}
              </>
            ) : (
              <>
                {isTauri() && (
                  <>
                    {(() => {
                      const count = (selectedWorktree.projects ?? []).reduce(
                        (acc, p) => acc + getUnreadErrorCount(p.path),
                        0,
                      );
                      return (
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={() => setShowWorktreeLogs(true)}
                          >
                            {t('logs.button')}
                          </Button>
                          {count > 0 && (
                            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
                              {count > 9 ? '9+' : count}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <LogsDialog
                      open={showWorktreeLogs}
                      onOpenChange={setShowWorktreeLogs}
                      projectPaths={(selectedWorktree.projects ?? []).map((p) => p.path)}
                      title={t('logs.title', { name: selectedWorktree.display_name || selectedWorktree.name })}
                    />
                    <div className="inline-flex rounded-md">
                      <Button
                        className="rounded-r-none border-r border-blue-700/50 px-2.5"
                        onClick={() => onOpenInEditor(selectedWorktree.path)}
                        title={selectedEditorName}
                      >
                        <EditorIcon editorId={selectedEditor} className="w-5 h-5" />
                      </Button>
                      <DropdownMenu open={showEditorMenu} onOpenChange={onShowEditorMenu}>
                        <DropdownMenuTrigger asChild>
                          <Button className="rounded-l-none px-2 min-w-0">
                            <ChevronDownIcon className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {detectedEditors.map(editor => (
                            <div
                              key={editor.id}
                              className="flex items-stretch rounded-sm text-sm"
                            >
                              <button
                                className="flex-1 min-w-0 text-left px-2 py-1.5 rounded-l-sm hover:bg-slate-700/60 transition-colors flex items-center gap-1.5"
                                onClick={() => {
                                  onSelectEditor(editor.id);
                                  onShowEditorMenu(false);
                                }}
                              >
                                <EditorIcon editorId={editor.id} className="w-4 h-4" />
                                {editor.name}
                                {editor.id === selectedEditor && (
                                  <CheckIcon className="w-3 h-3 text-green-400" />
                                )}
                              </button>
                              <button
                                className="px-2 flex items-center text-slate-500 hover:text-blue-400 hover:bg-slate-600/40 rounded-r-sm transition-colors shrink-0 border-l border-slate-700/50"
                                title={t('detail.openWithEditor', { editor: editor.name })}
                                onClick={() => {
                                  onOpenInEditor(selectedWorktree.path, editor.id);
                                  onShowEditorMenu(false);
                                }}
                              >
                                <ExternalLinkIcon className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onRevealInFinder(selectedWorktree.path)}>
                            <FolderIcon className="w-4 h-4 mr-1.5 text-slate-400" />
                            {t('detail.openInFolder')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <Button variant="secondary" onClick={() => onOpenInTerminal(selectedWorktree.path)}>{t('detail.externalTerminal')}</Button>
                    {onDeployToMain && !occupation && (
                      <Button
                        variant="secondary"
                        onClick={() => handleDeploy(selectedWorktree.name)}
                        disabled={deploying}
                      >
                        {deploying ? t('deploy.deploying') : t('deploy.deployToMain')}
                      </Button>
                    )}
                    <Button variant="warning" onClick={onArchive}>{t('detail.archive')}</Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="space-y-2">
            {selectedWorktree.projects.map((proj, index) => (
              <div key={proj.name} className={`bg-slate-800/50 border border-slate-700/50 border-l-2 ${statusBorderColor[getProjectStatus(proj)]} rounded-lg p-4 group hover:border-t-slate-600 hover:border-r-slate-600 hover:border-b-slate-600 hover:shadow-md hover:shadow-black/10 hover:-translate-y-px transition-all duration-150`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium text-slate-200">{proj.name}</div>
                      <div className="flex items-center gap-1.5 text-slate-400 text-sm mt-0.5">
                        <GitBranchIcon className="w-3.5 h-3.5" />
                        <span className="select-text">{proj.current_branch}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <StatusBadges project={proj} />
                      <div className="text-xs text-slate-500 mt-0.5 select-text">{t('detail.branchInfo', { base: proj.base_branch, test: proj.test_branch })}</div>
                    </div>
                    {isTauri() && (
                      <div className="flex items-center gap-1 text-slate-500 hover:text-slate-200">
                        <IdeIconButton
                          projectPath={proj.path}
                          projectName={proj.name}
                          editors={detectedEditors}
                          defaultEditorId={getProjectEditor(proj.name)}
                          onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRevealInFinder(proj.path)}
                          title={t('detail.revealInFinder')}
                          className="h-7 w-7"
                        >
                          <FolderOpenIcon className="w-4.5 h-4.5" />
                        </Button>
                        {(() => {
                          const webUrl = gitUrlToWebUrl(proj.remote_url);
                          return webUrl ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openLink(webUrl)}
                              title={t('detail.openRemoteRepo', 'Open in Browser')}
                              className="h-7 w-7"
                            >
                              <GithubIcon className="w-4.5 h-4.5" />
                            </Button>
                          ) : null;
                        })()}
                        <TerminalIconButton
                          projectPath={proj.path}
                          projectName={proj.name}
                          terminals={detectedTerminals}
                          onOpen={(path, terminalId) => onOpenInTerminal(path, terminalId)}
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <GitOperations
                    projectPath={proj.path}
                    baseBranch={proj.base_branch}
                    testBranch={proj.test_branch}
                    currentBranch={proj.current_branch}
                    onRefresh={onRefresh}
                    onOpenTerminal={onOpenTerminalPanel}
                    autoRefreshSlot={selectedWorktree.is_archived ? undefined : index}
                  />
                </div>
              </div>
            ))}
            {isTauri() && !selectedWorktree.is_archived && onAddProjectToWorktree && (
              <button
                onClick={onAddProjectToWorktree}
                className="w-full p-3 rounded-lg border border-dashed border-slate-700 hover:border-slate-500 hover:bg-slate-800/30 transition-colors flex items-center justify-center gap-2 text-slate-500 hover:text-slate-300"
              >
                <PlusIcon className="w-4 h-4" />
                <span className="text-sm">{t('detail.addProject')}</span>
              </button>
            )}
          </div>
      </div>
    );
  }

  return null;
};
