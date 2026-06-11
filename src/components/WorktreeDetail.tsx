import { useState, useEffect, useRef, useMemo, type FC, useCallback } from 'react';
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
  TerminalAppIcon,
  ChevronDownIcon,
  RefreshIcon,
  SyncIcon,
  PlusIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  FolderOpenIcon,
  EditorIcon,
  FileIcon,
  SettingsIcon,
  DownloadIcon,
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
  markAsRead,
} from '@/lib/operationLog';
import type { LogEntry } from '@/lib/operationLog';
import { GitOperations, type GitOperationsHandle } from './GitOperations';
import { useToast } from './Toast';
import { EDITORS } from '../constants';
import { isTauri, getVaultStatus, type BranchDiffStats } from '@/lib/backend';
import type {
  WorktreeListItem,
  MainWorkspaceStatus,
  MainWorkspaceOccupation,
  ProjectStatus,
  ProjectConfig,
  WorkspaceConfig,
  EditorType,
  VaultStatus,
  TagDefinition,
} from '../types';
import { ProjectEditModal } from './ProjectEditModal';

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
  onSilentRefresh?: () => void;
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
  workspaceConfig?: WorkspaceConfig | null;
  onSaveConfig?: (config: WorkspaceConfig) => Promise<void>;
}

// --- IdeIconButton ---

interface IdeIconButtonProps {
  projectPath: string;
  projectName: string;
  editors: Array<{ id: string; name: string }>;
  defaultEditorId: string;
  onOpen: (path: string, editorId: string) => void;
  onDefaultEditorChange?: () => void;
}

const IdeIconButton: FC<IdeIconButtonProps> = ({
  projectPath,
  projectName,
  editors,
  defaultEditorId,
  onOpen,
  onDefaultEditorChange,
}) => {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [showEditorMenu, setShowEditorMenu] = useState(false);
  const currentEditor = editors.find((e) => e.id === defaultEditorId);

  const handleSetDefaultEditor = (editorId: string) => {
    try {
      const prefs = JSON.parse(localStorage.getItem('project_preferred_editors') || '{}');
      prefs[projectName] = editorId;
      localStorage.setItem('project_preferred_editors', JSON.stringify(prefs));
      onDefaultEditorChange?.();
    } catch { /* ignore */ }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center">
            <Button
              ref={buttonRef}
              variant="ghost"
              size="icon"
              onClick={() => onOpen(projectPath, defaultEditorId)}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={t('detail.openInEditorProject', {
                editor: currentEditor?.name ?? defaultEditorId,
                name: projectName,
              })}
              className="h-7 w-7"
            >
              <EditorIcon editorId={defaultEditorId} className="w-4.5 h-4.5" />
            </Button>
            {editors.length > 0 && (
              <DropdownMenu open={showEditorMenu} onOpenChange={setShowEditorMenu}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-l-none px-1"
                  >
                    <ChevronDownIcon className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {editors.map(editor => (
                    <div
                      key={editor.id}
                      className="flex items-center rounded-sm text-sm hover:bg-[var(--color-bg-elevated)] transition-colors"
                    >
                      {/* Radio: set as default, does NOT open IDE */}
                      <button
                        className="px-2 py-1.5 flex items-center justify-center hover:bg-[var(--color-bg-elevated)] transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetDefaultEditor(editor.id);
                        }}
                      >
                        <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          editor.id === defaultEditorId
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                            : 'border-[var(--color-text-muted)]'
                        }`}>
                          {editor.id === defaultEditorId && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                      </button>
                      {/* Divider */}
                      <div className="w-px h-5 bg-[var(--color-border)]" />
                      {/* Editor name: open IDE, does NOT set as default */}
                      <button
                        className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2 hover:bg-[var(--color-bg-elevated)] transition-colors rounded-r-sm"
                        onClick={() => {
                          onOpen(projectPath, editor.id);
                          setShowEditorMenu(false);
                        }}
                      >
                        <EditorIcon editorId={editor.id} className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{editor.name}</span>
                      </button>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('detail.openInEditorLabel', { editor: currentEditor?.name ?? defaultEditorId })}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  const defaultTerminalId = useMemo(() => {
    try { return (JSON.parse(localStorage.getItem('tool_paths') || '{}') as Record<string, string>).terminal; }
    catch { return undefined; }
  }, []);

  const handleSetDefaultTerminal = (terminalId: string) => {
    try {
      const toolPaths = JSON.parse(localStorage.getItem('tool_paths') || '{}');
      toolPaths.terminal = terminalId;
      localStorage.setItem('tool_paths', JSON.stringify(toolPaths));
    } catch { /* ignore */ }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center">
            <Button
              ref={buttonRef}
              variant="ghost"
              size="icon"
              onClick={() => onOpen(projectPath)}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={t('detail.openExternalTerminalProject', { name: projectName })}
              className="h-7 w-7"
            >
              <TerminalAppIcon terminalId={defaultTerminalId ?? ''} className="w-4.5 h-4.5" />
            </Button>
            {terminals.length > 0 && (
              <DropdownMenu open={showTerminalMenu} onOpenChange={setShowTerminalMenu}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-l-none px-1"
                  >
                    <ChevronDownIcon className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {terminals.map(terminal => (
                    <div
                      key={terminal.id}
                      className="flex items-center rounded-sm text-sm hover:bg-[var(--color-bg-elevated)] transition-colors"
                    >
                      {/* Radio: set as default, does NOT open terminal */}
                      <button
                        className="px-2 py-1.5 flex items-center justify-center hover:bg-[var(--color-bg-elevated)] transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetDefaultTerminal(terminal.id);
                        }}
                      >
                        <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          terminal.id === defaultTerminalId
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                            : 'border-[var(--color-text-muted)]'
                        }`}>
                          {terminal.id === defaultTerminalId && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                      </button>
                      {/* Divider */}
                      <div className="w-px h-5 bg-[var(--color-border)]" />
                      {/* Terminal name: open terminal, does NOT set as default */}
                      <button
                        className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2 hover:bg-[var(--color-bg-elevated)] transition-colors rounded-r-sm"
                        onClick={() => {
                          onOpen(projectPath, terminal.id);
                          setShowTerminalMenu(false);
                        }}
                      >
                        <TerminalAppIcon terminalId={terminal.id} className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{terminal.name}</span>
                      </button>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('detail.openExternalTerminal')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// --- TerminalSplitButton (top-level action bar) ---

const TerminalSplitButton: FC<{
  path: string;
  terminals: Array<{ id: string; name: string }>;
  onOpen: (path: string, terminalId?: string) => void;
}> = ({ path, terminals, onOpen }) => {
  const { t } = useTranslation();
  const [showTerminalMenu, setShowTerminalMenu] = useState(false);
  const defaultTerminalId = useMemo(() => {
    try { return (JSON.parse(localStorage.getItem('tool_paths') || '{}') as Record<string, string>).terminal; }
    catch { return undefined; }
  }, []);

  const handleSetDefaultTerminal = (terminalId: string) => {
    try {
      const toolPaths = JSON.parse(localStorage.getItem('tool_paths') || '{}');
      toolPaths.terminal = terminalId;
      localStorage.setItem('tool_paths', JSON.stringify(toolPaths));
    } catch { /* ignore */ }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center">
            <Button
              variant="secondary"
              className={`px-2.5 gap-1.5${terminals.length > 0 ? ' rounded-r-none border-r-0' : ''}`}
              onClick={() => onOpen(path)}
            >
              <TerminalAppIcon terminalId={defaultTerminalId ?? ''} className="w-5 h-5" />
            </Button>
            {terminals.length > 0 && (
              <DropdownMenu open={showTerminalMenu} onOpenChange={setShowTerminalMenu}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    className="px-1.5 rounded-l-none"
                  >
                    <ChevronDownIcon className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {terminals.map(terminal => (
                    <div
                      key={terminal.id}
                      className="flex items-center rounded-sm text-sm hover:bg-[var(--color-bg-elevated)] transition-colors"
                    >
                      {/* Radio: set as default, does NOT open terminal */}
                      <button
                        className="px-2 py-1.5 flex items-center justify-center hover:bg-[var(--color-bg-elevated)] transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetDefaultTerminal(terminal.id);
                        }}
                      >
                        <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          terminal.id === defaultTerminalId
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                            : 'border-[var(--color-text-muted)]'
                        }`}>
                          {terminal.id === defaultTerminalId && (
                            <div className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </div>
                      </button>
                      {/* Divider */}
                      <div className="w-px h-5 bg-[var(--color-border)]" />
                      {/* Terminal name: open terminal, does NOT set as default */}
                      <button
                        className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2 hover:bg-[var(--color-bg-elevated)] transition-colors rounded-r-sm"
                        onClick={() => {
                          onOpen(path, terminal.id);
                          setShowTerminalMenu(false);
                        }}
                      >
                        <TerminalAppIcon terminalId={terminal.id} className="w-4 h-4 shrink-0" />
                        <span className="flex-1 truncate">{terminal.name}</span>
                      </button>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('detail.externalTerminal')}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// --- LogsDialog ---

export const LogsDialog: FC<{
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
        <DialogHeader className="px-4 py-3 pr-12 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium">
              {title}
            </DialogTitle>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-[var(--color-text-secondary)] hover:text-[var(--color-error)] hover:bg-transparent"
                    onClick={() => {
                      projectPaths.forEach((path) => clearLogs(path));
                      setLogs([]);
                      onOpenChange(false);
                    }}
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('logs.clear')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
  success: 'border-l-[var(--color-success)]',
  warning: 'border-l-[var(--color-warning)]',
  info: 'border-l-[var(--color-accent)]',
  sync: 'border-l-[var(--color-accent)]',
};

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
            className="text-[var(--color-text-muted)] text-sm mt-1 select-text hover:text-[var(--color-text-secondary)] transition-colors flex items-center gap-1.5 max-w-full group"
          >
            <span className="truncate block">{path}</span>
            {copied ? (
              <CheckIcon className="w-3 h-3 text-[var(--color-success)] shrink-0" />
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
              <CheckIcon className="w-3.5 h-3.5 text-[var(--color-success)] shrink-0" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[var(--color-text-secondary)]" />
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
  onSilentRefresh,
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
  workspaceConfig,
  onSaveConfig,
}) => {
  const { t } = useTranslation();
  // Refs to GitOperations instances for batch triggering (sync/pull/refresh all)
  const gitOpsRefs = useRef<Map<string, GitOperationsHandle>>(new Map());

  // Live stats from GitOperations, keyed by project path
  const [projectStats, setProjectStats] = useState<Record<string, BranchDiffStats>>({});
  const handleStatsChanged = useCallback((path: string, stats: BranchDiffStats) => {
    setProjectStats(prev => {
      const existing = prev[path];
      if (existing && existing.ahead === stats.ahead && existing.behind === stats.behind && existing.changed_files === stats.changed_files && existing.unpushed_commits === stats.unpushed_commits && existing.ahead_of_test === stats.ahead_of_test) return prev;
      return { ...prev, [path]: stats };
    });
  }, []);

  // Project edit modal state
  const [editingProject, setEditingProject] = useState<ProjectConfig | null>(null);

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

  // Bump version to force getProjectEditor re-computation after localStorage change
  const [editorPrefsVersion, setEditorPrefsVersion] = useState(0);
  const handleEditorPrefsChange = useCallback(() => setEditorPrefsVersion(v => v + 1), []);

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
  }, [selectedEditor, detectedEditors, editorPrefsVersion]);

  const [switchingBranch, setSwitchingBranch] = useState<string[]>([]);
  const [worktreeAction, setWorktreeAction] = useState<'syncAll' | 'pullAll' | 'refreshAll' | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [removingProject, setRemovingProject] = useState<string | null>(null);
  const [confirmRemoveProject, setConfirmRemoveProject] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  // Track actual content width for responsive grid (accounts for sidebar)
  const [contentWidth, setContentWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const contentRef = useCallback((el: HTMLDivElement | null) => {
    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    // Initial measurement
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setContentWidth(rect.width);
    // Observe for subsequent changes
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContentWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);
  // Safety net: disconnect ResizeObserver on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mainWorkspace) {
      getVaultStatus().then(setVaultStatus).catch(() => setVaultStatus(null));
    }
  }, [mainWorkspace]);

  // Tag grouping for main workspace
  const tagGroups = useMemo(() => {
    const tags = workspaceConfig?.tags ?? [];
    const projects = mainWorkspace?.projects ?? [];
    if (tags.length === 0) return null; // No tags = flat view

    const groups: Array<{ tag: TagDefinition | null; projects: typeof projects }> = [];

    for (const tag of tags) {
      const tagProjects = projects.filter(p => {
        const projectConfig = workspaceConfig?.projects.find(pc => pc.name === p.name);
        return (projectConfig?.tags ?? []).includes(tag.id);
      });
      if (tagProjects.length > 0) {
        groups.push({ tag, projects: tagProjects });
      }
    }

    // Untagged group
    const taggedProjectNames = new Set(
      tags.flatMap(tag =>
        (workspaceConfig?.projects ?? [])
          .filter(pc => (pc.tags ?? []).includes(tag.id))
          .map(pc => pc.name)
      )
    );
    const untagged = projects.filter(p => !taggedProjectNames.has(p.name));
    if (untagged.length > 0) {
      groups.push({ tag: null, projects: untagged });
    }

    return groups;
  }, [workspaceConfig, mainWorkspace]);

  const COLLAPSED_TAGS_KEY = 'main_workspace_collapsed_tags';
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_TAGS_KEY) || '[]'));
    } catch { return new Set(); }
  });
  const toggleCollapse = useCallback((tagId: string) => {
    setCollapsedTags(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      localStorage.setItem(COLLAPSED_TAGS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

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

  const { toast } = useToast();

  // Determine which tab should be highlighted: highlight the branch with the most projects (plurality wins)
  const wsProjects = mainWorkspace?.projects ?? [];
  const { activeBranchTab, branchCounts } = useMemo(() => {
    const counts = { base: 0, test: 0, head: 0 };
    for (const p of wsProjects) {
      if (p.current_branch === 'HEAD') counts.head++;
      else if (p.current_branch === p.base_branch) counts.base++;
      else if (p.current_branch === p.test_branch) counts.test++;
    }
    const sorted = (['base', 'test', 'head'] as const)
      .map(t => ({ tab: t, count: counts[t] }))
      .sort((a, b) => b.count - a.count);
    const active = (sorted[0].count > 0 && sorted[0].count > sorted[1].count) ? sorted[0].tab : null;
    return { activeBranchTab: active as 'base' | 'test' | 'head' | null, branchCounts: counts };
  }, [wsProjects]);

  // Batch switch all projects to BASE/TEST/HEAD (concurrent)
  const switchAllProjects = useCallback(async (target: 'base' | 'test' | 'head') => {
    const projs = mainWorkspace?.projects ?? [];
    if (projs.length === 0) return;

    const targets = projs
      .map(proj => {
        let targetBranch: string;
        if (target === 'base') {
          targetBranch = proj.base_branch;
        } else if (target === 'test') {
          if (!proj.test_branch) {
            toast('warning', t('detail.projectNoTestBranch', { name: proj.name }));
            return null;
          }
          targetBranch = proj.test_branch;
        } else {
          targetBranch = 'HEAD';
        }
        if (proj.current_branch === targetBranch) return null;
        return { proj, targetBranch };
      })
      .filter(Boolean) as { proj: typeof projs[0]; targetBranch: string }[];

    setSwitchingBranch(targets.map(t => t.proj.name));

    await Promise.all(
      targets.map(async ({ proj, targetBranch }) => {
        try {
          await onSwitchBranch(proj.path, targetBranch);
        } catch (e: any) {
          toast('error', t('detail.switchBranchFailed', { name: proj.name, branch: targetBranch, error: String(e?.message || e) }));
        }
      })
    );

    setSwitchingBranch([]);
    onRefresh?.();
  }, [mainWorkspace?.projects, onSwitchBranch, toast, t, onRefresh]);

  // Batch actions for main workspace (sync/pull/refresh via GitOperations refs)
  const [mainAction, setMainAction] = useState<'sync' | 'pull' | 'refresh' | null>(null);

  const getMainGitOps = () => {
    const projects = mainWorkspace?.projects ?? [];
    return projects
      .map(p => gitOpsRefs.current.get(p.path))
      .filter(Boolean) as GitOperationsHandle[];
  };

  const handleSyncAllBase = async () => {
    const ops = getMainGitOps();
    if (ops.length === 0) return;
    setMainAction('sync');
    try {
      await Promise.allSettled(ops.map(op => op.triggerSync()));
    } finally {
      setMainAction(null);
    }
  };

  const handlePullAllMain = async () => {
    const ops = getMainGitOps();
    if (ops.length === 0) return;
    setMainAction('pull');
    try {
      await Promise.allSettled(ops.map(op => op.triggerPull()));
    } finally {
      setMainAction(null);
    }
  };

  const handleRefreshAllMain = async () => {
    const ops = getMainGitOps();
    if (ops.length === 0) return;
    setMainAction('refresh');
    try {
      await Promise.allSettled(ops.map(op => op.triggerRefresh()));
    } finally {
      setMainAction(null);
    }
  };

  const handleWorktreeSyncAll = async () => {
    if (!selectedWorktree) return;
    setWorktreeAction('syncAll');
    try {
      const ops = selectedWorktree.projects
        .map(p => gitOpsRefs.current.get(p.path))
        .filter(Boolean) as GitOperationsHandle[];
      await Promise.allSettled(ops.map(op => op.triggerSync()));
    } finally {
      setWorktreeAction(null);
    }
  };

  const handleWorktreePullAll = async () => {
    if (!selectedWorktree) return;
    setWorktreeAction('pullAll');
    try {
      const ops = selectedWorktree.projects
        .map(p => gitOpsRefs.current.get(p.path))
        .filter(Boolean) as GitOperationsHandle[];
      await Promise.allSettled(ops.map(op => op.triggerPull()));
    } finally {
      setWorktreeAction(null);
    }
  };

  const handleWorktreeRefreshAll = async () => {
    if (!selectedWorktree) return;
    setWorktreeAction('refreshAll');
    try {
      const ops = selectedWorktree.projects
        .map(p => gitOpsRefs.current.get(p.path))
        .filter(Boolean) as GitOperationsHandle[];
      await Promise.allSettled(ops.map(op => op.triggerRefresh()));
    } finally {
      setWorktreeAction(null);
    }
  };

  if (!selectedWorktree && !mainWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20">
        <FolderIcon className="w-12 h-12 text-[var(--color-border)] mb-4" />
        <p className="text-[var(--color-text-muted)] text-sm">{t('detail.selectWorktree')}</p>
        <p className="text-[var(--color-text-muted)] text-xs mt-1">{t('detail.selectWorktreeHint')}</p>
      </div>
    );
  }

  // Show loading overlay when switching
  if (switching) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <RefreshIcon className="w-8 h-8 text-[var(--color-accent)] animate-spin" />
          <div className="text-[var(--color-text-secondary)] text-sm">{t('detail.switching')}</div>
        </div>
      </div>
    );
  }

  // Main Workspace View
  if (!selectedWorktree && mainWorkspace) {
    return (
      <div ref={contentRef}>
        {error && (
          <div className="mb-4 p-4 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg">
            <div className="text-[var(--color-error)] text-sm select-text">{error}</div>
            <Button variant="link" size="sm" onClick={onClearError} className="text-[var(--color-error)] hover:text-[var(--color-error)] mt-1 p-0 h-auto">{t('common.close')}</Button>
          </div>
        )}
        {occupation && (
          <div className="mb-4 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 p-3 flex items-center justify-between">
            <span className="text-sm text-[var(--color-accent)] select-text">
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
          <div className="mb-4 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-4 space-y-3">
            <div className="text-sm text-[var(--color-text-primary)] font-medium">{t('deploy.confirmExit')}</div>
            <div className="text-xs text-[var(--color-text-secondary)]">{t('deploy.confirmExitDesc')}</div>
            {exitError && (
              <div className="text-xs text-[var(--color-error)] bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded p-2">{exitError}</div>
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
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)] truncate">{t('detail.mainWorkspace', { name: mainWorkspace.name })}</h2>
            <PathDisplay path={mainWorkspace.path} />
          </div>
          {isTauri() && (
            <div className="flex gap-2 items-center shrink-0 ml-3">
              <div className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-hidden">
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
                        disabled={mainAction !== null}
                        onClick={handleSyncAllBase}
                      >
                        {mainAction === 'sync' ? <SyncIcon className="w-3.5 h-3.5 animate-spin" /> : <SyncIcon className="w-3.5 h-3.5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('detail.syncAllBaseTip')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 border-l border-[var(--color-border)]"
                        disabled={mainAction !== null}
                        onClick={handlePullAllMain}
                      >
                        {mainAction === 'pull' ? <SyncIcon className="w-3.5 h-3.5 animate-spin" /> : <DownloadIcon className="w-3.5 h-3.5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('detail.pullAllTip')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50 border-l border-[var(--color-border)]"
                        disabled={mainAction !== null}
                        onClick={handleRefreshAllMain}
                      >
                        {mainAction === 'refresh' ? <RefreshIcon className="w-3.5 h-3.5 animate-spin" /> : <RefreshIcon className="w-3.5 h-3.5" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('detail.refreshAllTip')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {(['base', 'test', 'head'] as const).map((tab) => (
                  <TooltipProvider key={tab} delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${activeBranchTab === tab && branchCounts[tab] > 0 ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)]'} ${tab !== 'head' ? 'border-l border-[var(--color-border)]' : ''}`}
                          disabled={switchingBranch.length > 0}
                          onClick={() => switchAllProjects(tab)}
                        >
                          {tab.toUpperCase()}{branchCounts[tab] > 0 && <span className="ml-1 opacity-70">({branchCounts[tab]})</span>}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {t(tab === 'base' ? 'detail.switchAllToBaseTip' : tab === 'test' ? 'detail.switchAllToTestTip' : 'detail.switchAllToHeadTip')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
              {onAddProject && (
                <Button onClick={onAddProject} variant="default">
                  <PlusIcon className="w-4 h-4 mr-1.5" />
                  {t('detail.addProject')}
                </Button>
              )}
              <div className="inline-flex rounded-md">
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="rounded-r-none border-r border-[var(--color-accent)]/50 px-2.5"
                        onClick={() => onOpenInEditor(mainWorkspace.path)}
                      >
                        <EditorIcon editorId={selectedEditor} className="w-5 h-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{selectedEditorName}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
                        className="flex items-center rounded-sm text-sm hover:bg-[var(--color-bg-elevated)] transition-colors"
                      >
                        {/* Radio: set as default, does NOT open IDE */}
                        <button
                          className="px-2 py-1.5 flex items-center justify-center hover:bg-[var(--color-bg-elevated)] transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEditor(editor.id);
                          }}
                        >
                          <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            editor.id === selectedEditor
                              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                              : 'border-[var(--color-text-muted)]'
                          }`}>
                            {editor.id === selectedEditor && (
                              <div className="w-1.5 h-1.5 rounded-full bg-white" />
                            )}
                          </div>
                        </button>
                        {/* Divider */}
                        <div className="w-px h-5 bg-[var(--color-border)]" />
                        {/* Editor name: open IDE, does NOT set as default */}
                        <button
                          className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2 hover:bg-[var(--color-bg-elevated)] transition-colors rounded-r-sm"
                          onClick={() => {
                            onOpenInEditor(mainWorkspace.path, editor.id);
                            onShowEditorMenu(false);
                          }}
                        >
                          <EditorIcon editorId={editor.id} className="w-4 h-4 shrink-0" />
                          <span className="flex-1 truncate">{editor.name}</span>
                        </button>
                      </div>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onRevealInFinder(mainWorkspace.path)}>
                      <FolderIcon className="w-4 h-4 mr-1.5 text-[var(--color-text-secondary)]" />
                      {t('detail.openInFolder')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <TerminalSplitButton path={mainWorkspace.path} terminals={detectedTerminals} onOpen={onOpenInTerminal} />
            </div>
          )}
        </div>

        {/* Vault mounted items */}
        {vaultStatus?.connected && vaultStatus.synced_items.length > 0 && (
          <div className="mb-4 rounded-lg bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-3">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                {t('detail.vaultMounted', 'Vault 已挂载')}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                ({vaultStatus.synced_items.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {vaultStatus.synced_items.map((item) => (
                <span
                  key={item.name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-bg-elevated)] text-xs text-[var(--color-text-secondary)]"
                  title={item.item_type === 'directory' ? t('detail.folder', '文件夹') : t('detail.file', '文件')}
                >
                  {item.item_type === 'directory'
                    ? <FolderIcon className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                    : <FileIcon className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                  }
                  {item.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <>
            {occupation ? (
              /* Deployed state: show only deployed projects in worktree-style cards */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {mainWorkspace.projects
                  .filter(proj => occupation.original_branches[proj.name])
                  .map(proj => {
                    const projectPath = proj.path;
                    const liveStats = projectStats[proj.path];
                    const projAsStatus = liveStats ? {
                      name: proj.name,
                      path: proj.path,
                      current_branch: proj.current_branch,
                      base_branch: proj.base_branch,
                      test_branch: proj.test_branch,
                      has_uncommitted: liveStats.changed_files > 0,
                      uncommitted_count: liveStats.changed_files,
                      is_merged_to_test: false,
                      is_merged_to_base: proj.is_merged_to_base,
                      ahead_of_base: liveStats.ahead,
                      behind_base: liveStats.behind,
                      ahead_of_test: liveStats.ahead_of_test,
                      unpushed_commits: liveStats.unpushed_commits,
                      remote_url: '',
                    } : {
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
                      <div key={proj.name} className={`bg-[var(--color-bg-surface)] border border-[var(--color-border)] border-l-2 ${statusBorderColor[status]} rounded-lg p-4 group hover:border-t-[var(--color-border)] hover:border-r-[var(--color-border)] hover:border-b-[var(--color-border)] hover:shadow-md hover:shadow-black/10 hover:-translate-y-px transition-all duration-150`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="font-medium text-[var(--color-text-primary)]">{proj.name}</div>
                              <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)] text-sm mt-0.5">
                                <GitBranchIcon className="w-3.5 h-3.5" />
                                <span className="select-text">{proj.current_branch}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <StatusBadges project={projAsStatus} />
                              <div className="text-xs text-[var(--color-text-muted)] mt-0.5 select-text">{t('detail.branchInfo', { base: proj.base_branch, test: proj.test_branch })}</div>
                            </div>
                            {isTauri() && (
                              <div className="flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                                <IdeIconButton
                                  projectPath={projectPath}
                                  projectName={proj.name}
                                  editors={detectedEditors}
                                  defaultEditorId={getProjectEditor(proj.name)}
                                  onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
                                  onDefaultEditorChange={handleEditorPrefsChange}
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
                        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                          <GitOperations
                            ref={(handle) => {
                              if (handle) gitOpsRefs.current.set(projectPath, handle);
                              else gitOpsRefs.current.delete(projectPath);
                            }}
                            projectPath={projectPath}
                            projectName={proj.name}
                            baseBranch={proj.base_branch}
                            testBranch={proj.test_branch}
                            currentBranch={proj.current_branch}
                            onRefresh={onRefresh}
                            onOpenTerminal={onOpenTerminalPanel}
                            onStatsChanged={(stats) => handleStatsChanged(projectPath, stats)}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              /* Normal state: show all projects in grid layout */
              (() => {
                const renderProjectCard = (proj: typeof mainWorkspace.projects[0]) => {
                  const projectPath = proj.path;
                  const isSwitching = switchingBranch.includes(proj.name);

                  const handleSwitchBranch = async (branch: string) => {
                    setSwitchingBranch([proj.name]);
                    try {
                      await onSwitchBranch(projectPath, branch);
                    } finally {
                      setSwitchingBranch([]);
                    }
                  };

                  return (
                    <div key={proj.name} className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg p-4 group hover:border-[var(--color-border)] hover:shadow-md hover:shadow-black/10 hover:-translate-y-px transition-all duration-150">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center min-w-0">
                          <span className="font-medium text-[var(--color-text-primary)]">{proj.name}</span>
                          {(() => {
                            const pc = workspaceConfig?.projects.find(p => p.name === proj.name);
                            const projectTags = (pc?.tags ?? [])
                              .map(tid => (workspaceConfig?.tags ?? []).find(tg => tg.id === tid))
                              .filter(Boolean) as TagDefinition[];
                            return projectTags.length > 0 ? (
                              <div className="flex gap-1 ml-2 flex-wrap">
                                {projectTags.map(tag => (
                                  <span
                                    key={tag.id}
                                    className="px-1.5 py-0.5 rounded-full text-[10px] leading-tight"
                                    style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
                                  >
                                    {tag.name}
                                  </span>
                                ))}
                              </div>
                            ) : null;
                          })()}
                        </div>
                        <div className="flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                          {workspaceConfig && onSaveConfig && (
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => {
                                      const projectConfig = workspaceConfig.projects.find(p => p.name === proj.name);
                                      if (projectConfig) setEditingProject(projectConfig);
                                    }}
                                    className="p-1 hover:bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                                  >
                                    <SettingsIcon className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">{t('detail.projectSettings')}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {isTauri() && (
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => onRevealInFinder(projectPath)}
                                    className="p-1 hover:bg-[var(--color-bg-elevated)] rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                                    aria-label={t('detail.openInFinderProject', { name: proj.name })}
                                  >
                                    <FolderIcon className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">{t('detail.openInFinderLabel')}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {isTauri() && (
                            <IdeIconButton
                              projectPath={projectPath}
                              projectName={proj.name}
                              editors={detectedEditors}
                              defaultEditorId={getProjectEditor(proj.name)}
                              onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
                              onDefaultEditorChange={handleEditorPrefsChange}
                            />
                          )}
                          {isTauri() && (
                            <TerminalIconButton
                              projectPath={projectPath}
                              projectName={proj.name}
                              terminals={detectedTerminals}
                              onOpen={(path, terminalId) => onOpenInTerminal(path, terminalId)}
                            />
                          )}
                          {onRemoveProject && (
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => setConfirmRemoveProject(proj.name)}
                                    className="p-1 hover:bg-[var(--color-error)]/20 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
                                    aria-label={t('detail.removeProjectLabel', { name: proj.name })}
                                  >
                                    <TrashIcon className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">{t('detail.removeProject', 'Remove from workspace')}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {proj.has_uncommitted && <WarningIcon className="w-4 h-4 text-[var(--color-warning)]" />}
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)] text-sm">
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
                            {proj.current_branch === proj.base_branch && <CheckIcon className="w-3 h-3 mr-1 text-[var(--color-success)]" />}
                            BASE
                          </Button>
                          <Button
                            variant={proj.current_branch === proj.test_branch ? 'default' : 'ghost'}
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={isSwitching || proj.current_branch === proj.test_branch}
                            onClick={() => handleSwitchBranch(proj.test_branch)}
                          >
                            {proj.current_branch === proj.test_branch && <CheckIcon className="w-3 h-3 mr-1 text-[var(--color-success)]" />}
                            TEST
                          </Button>
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  disabled={isSwitching}
                                  onClick={() => handleSwitchBranch('HEAD')}
                                >
                                  HEAD
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{t('detail.switchToHead')}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                      {/* Status badges — use live stats when available */}
                      <div className="mt-2">
                        {(() => {
                          const liveStats = projectStats[proj.path];
                          const liveProj = liveStats ? {
                            name: proj.name,
                            path: proj.path,
                            current_branch: proj.current_branch,
                            base_branch: proj.base_branch,
                            test_branch: proj.test_branch,
                            has_uncommitted: liveStats.changed_files > 0,
                            uncommitted_count: liveStats.changed_files,
                            is_merged_to_test: false,
                            is_merged_to_base: proj.is_merged_to_base,
                            ahead_of_base: liveStats.ahead,
                            behind_base: liveStats.behind,
                            ahead_of_test: liveStats.ahead_of_test,
                            unpushed_commits: liveStats.unpushed_commits,
                            remote_url: '',
                          } : {
                            name: proj.name,
                            path: proj.path,
                            current_branch: proj.current_branch,
                            base_branch: proj.base_branch,
                            test_branch: proj.test_branch,
                            has_uncommitted: proj.has_uncommitted,
                            uncommitted_count: proj.uncommitted_count,
                            is_merged_to_test: false,
                            is_merged_to_base: proj.is_merged_to_base,
                            ahead_of_base: proj.ahead_of_base,
                            behind_base: proj.behind_base,
                            ahead_of_test: proj.ahead_of_test,
                            unpushed_commits: proj.unpushed_commits,
                            remote_url: '',
                          };
                          return <StatusBadges project={liveProj} />;
                        })()}
                      </div>
                      {/* Git operations */}
                      <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                        <GitOperations
                          ref={(handle) => {
                            if (handle) gitOpsRefs.current.set(proj.path, handle);
                            else gitOpsRefs.current.delete(proj.path);
                          }}
                          projectPath={proj.path}
                          projectName={proj.name}
                          baseBranch={proj.base_branch}
                          testBranch={proj.test_branch}
                          currentBranch={proj.current_branch}
                          onRefresh={onRefresh}
                          onOpenTerminal={onOpenTerminalPanel}
                          onStatsChanged={(stats) => handleStatsChanged(proj.path, stats)}
                        />
                      </div>
                      {proj.linked_folders && proj.linked_folders.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                          <div className="text-xs text-[var(--color-text-muted)] mb-1">{t('detail.linkedFolders')}</div>
                          <div className="flex flex-wrap gap-1">
                            {proj.linked_folders.map((folder, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-1.5 py-0.5 bg-[var(--color-bg-elevated)] rounded text-xs text-[var(--color-text-secondary)] select-text"
                              >
                                {folder}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Remove confirmation */}
                      {confirmRemoveProject === proj.name && (
                        <div className="mt-2 p-2.5 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg">
                          <p className="text-sm text-[var(--color-error)] mb-2">{t('detail.confirmRemoveProject', { name: proj.name })}</p>
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
                };

                const projectGrid = (projects: typeof mainWorkspace.projects) => (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: contentWidth >= 900 ? 'repeat(2, 1fr)' : '1fr',
                    gap: '0.75rem',
                  }}>
                    {projects.map(renderProjectCard)}
                  </div>
                );

                return tagGroups ? (
                  // Grouped view
                  <div className="space-y-4">
                    {tagGroups.map(({ tag, projects: groupProjects }) => {
                      const tagId = tag?.id ?? '__untagged__';
                      const isCollapsed = collapsedTags.has(tagId);

                      return (
                        <div key={tagId}>
                          {/* Group header */}
                          <div
                            className="flex items-center gap-2 mb-2 cursor-pointer select-none"
                            onClick={() => toggleCollapse(tagId)}
                          >
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {isCollapsed ? '\u25B6' : '\u25BC'}
                            </span>
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tag?.color ?? 'var(--color-text-muted)' }}
                            />
                            <span className="text-sm font-medium text-[var(--color-text-primary)]">
                              {tag?.name ?? t('tags.untagged')}
                            </span>
                            <span className="text-xs text-[var(--color-text-muted)]">
                              ({groupProjects.length})
                            </span>
                          </div>

                          {/* Project cards grid */}
                          {!isCollapsed && projectGrid(groupProjects)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // Flat view (no tags defined)
                  projectGrid(mainWorkspace.projects)
                );
              })()
            )}

          </>

        {editingProject && workspaceConfig && onSaveConfig && (
          <ProjectEditModal
            open={!!editingProject}
            onOpenChange={(open) => { if (!open) setEditingProject(null); }}
            project={editingProject}
            workspacePath={mainWorkspace?.path ?? ''}
            workspaceConfig={workspaceConfig}
            onSave={async (updatedProject, updatedConfig) => {
              try {
                const newConfig = {
                  ...updatedConfig,
                  projects: updatedConfig.projects.map(p =>
                    p.name === updatedProject.name ? updatedProject : p
                  ),
                };
                await onSaveConfig(newConfig);
                onSilentRefresh?.();
                setEditingProject(null);
              } catch (e: unknown) {
                toast('error', e instanceof Error ? e.message : String(e));
              }
            }}
          />
        )}
      </div>
    );
  }

  // Worktree View
  if (selectedWorktree) {
    return (
      <div ref={contentRef}>
        {error && (
          <div className="mb-4 p-4 bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 rounded-lg">
            <div className="text-[var(--color-error)] text-sm select-text">{error}</div>
            <Button variant="link" size="sm" onClick={onClearError} className="text-[var(--color-error)] hover:text-[var(--color-error)] mt-1 p-0 h-auto">{t('common.close')}</Button>
          </div>
        )}
        <div className="flex items-center justify-between mb-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {selectedWorktree.is_archived ? <ArchiveIcon className="w-5 h-5 text-[var(--color-text-muted)]" /> : <FolderIcon className="w-5 h-5 text-[var(--color-accent)]" />}
              <CopyableTitle text={selectedWorktree.display_name || selectedWorktree.name} className="text-xl font-semibold text-[var(--color-text-primary)]" />
            </div>
            <PathDisplay path={selectedWorktree.path} />
          </div>
          <div className="flex gap-2 items-center shrink-0 ml-3">
            {selectedWorktree.is_archived ? (
              <>
                <Button variant="default" className="bg-[var(--color-success)] hover:bg-[var(--color-success)]" onClick={onRestore} disabled={restoring}>
                  {restoring ? t('detail.restoring') : t('detail.restore')}
                </Button>
                {onDelete && (
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] hover:border-[var(--color-text-muted)]"
                  >{t('detail.delete')}</Button>
                )}
              </>
            ) : (
              <>
                {isTauri() && (
                  <>
                    <div className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] overflow-hidden">
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-surface)] transition-colors disabled:opacity-50"
                              disabled={worktreeAction !== null}
                              onClick={handleWorktreeSyncAll}
                            >
                              {worktreeAction === 'syncAll'
                                ? <SyncIcon className="w-3.5 h-3.5 animate-spin" />
                                : <SyncIcon className="w-3.5 h-3.5" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{t('detail.syncAllTip')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-surface)] transition-colors disabled:opacity-50 border-l border-[var(--color-border)]"
                              disabled={worktreeAction !== null}
                              onClick={handleWorktreePullAll}
                            >
                              {worktreeAction === 'pullAll'
                                ? <SyncIcon className="w-3.5 h-3.5 animate-spin" />
                                : <DownloadIcon className="w-3.5 h-3.5" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{t('detail.pullAllTip')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className="px-2 py-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-surface)] transition-colors disabled:opacity-50 border-l border-[var(--color-border)]"
                              disabled={worktreeAction !== null}
                              onClick={handleWorktreeRefreshAll}
                            >
                              {worktreeAction === 'refreshAll'
                                ? <RefreshIcon className="w-3.5 h-3.5 animate-spin" />
                                : <RefreshIcon className="w-3.5 h-3.5" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{t('detail.refreshAllTip')}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="inline-flex rounded-md">
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              className="rounded-r-none border-r border-[var(--color-accent)]/50 px-2.5"
                              onClick={() => onOpenInEditor(selectedWorktree.path)}
                            >
                              <EditorIcon editorId={selectedEditor} className="w-5 h-5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">{selectedEditorName}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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
                              className="flex items-center rounded-sm text-sm hover:bg-[var(--color-bg-elevated)] transition-colors"
                            >
                              {/* Radio: set as default, does NOT open IDE */}
                              <button
                                className="px-2 py-1.5 flex items-center justify-center hover:bg-[var(--color-bg-elevated)] transition-colors"
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onSelectEditor(editor.id);
                                }}
                              >
                                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                  editor.id === selectedEditor
                                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                                    : 'border-[var(--color-text-muted)]'
                                }`}>
                                  {editor.id === selectedEditor && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                  )}
                                </div>
                              </button>
                              {/* Divider */}
                              <div className="w-px h-5 bg-[var(--color-border)]" />
                              {/* Editor name: open IDE, does NOT set as default */}
                              <button
                                className="flex-1 min-w-0 text-left px-2 py-1.5 flex items-center gap-2 hover:bg-[var(--color-bg-elevated)] transition-colors rounded-r-sm"
                                onClick={() => {
                                  onOpenInEditor(selectedWorktree.path, editor.id);
                                  onShowEditorMenu(false);
                                }}
                              >
                                <EditorIcon editorId={editor.id} className="w-4 h-4 shrink-0" />
                                <span className="flex-1 truncate">{editor.name}</span>
                              </button>
                            </div>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onRevealInFinder(selectedWorktree.path)}>
                            <FolderIcon className="w-4 h-4 mr-1.5 text-[var(--color-text-secondary)]" />
                            {t('detail.openInFolder')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <TerminalSplitButton path={selectedWorktree.path} terminals={detectedTerminals} onOpen={onOpenInTerminal} />
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

        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 max-w-sm w-full mx-4 shadow-xl">
              <h3 className="text-sm font-medium mb-2">{t('detail.deleteConfirmTitle', 'Delete Worktree?')}</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-4">
                {t('detail.deleteConfirmDesc', 'This will permanently remove the worktree. This action cannot be undone.')}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-surface)]"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    onDelete?.();
                  }}
                  className="px-3 py-1.5 text-xs rounded bg-[var(--color-error)] text-white hover:bg-[var(--color-error)]/90"
                >
                  {t('detail.deleteConfirmBtn', 'Delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: contentWidth >= 900 ? 'repeat(2, 1fr)' : '1fr', gap: '0.75rem' }}>
            {selectedWorktree.projects.map((proj, index) => {
              const liveStats = projectStats[proj.path];
              const liveProj = liveStats ? {
                ...proj,
                ahead_of_base: liveStats.ahead,
                behind_base: liveStats.behind,
                has_uncommitted: liveStats.changed_files > 0,
                uncommitted_count: liveStats.changed_files,
                unpushed_commits: liveStats.unpushed_commits,
                ahead_of_test: liveStats.ahead_of_test,
              } : proj;
              return (
              <div key={proj.name} className={`bg-[var(--color-bg-surface)] border border-[var(--color-border)] border-l-2 ${statusBorderColor[getProjectStatus(liveProj)]} rounded-lg p-4 group hover:border-t-[var(--color-border)] hover:border-r-[var(--color-border)] hover:border-b-[var(--color-border)] hover:shadow-md hover:shadow-black/10 hover:-translate-y-px transition-all duration-150`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium text-[var(--color-text-primary)]">{proj.name}</div>
                      <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)] text-sm mt-0.5">
                        <GitBranchIcon className="w-3.5 h-3.5" />
                        <span className="select-text">{proj.current_branch}</span>
                        {(() => {
                          const targetBranch = selectedWorktree.display_name || selectedWorktree.name;
                          if (proj.current_branch === targetBranch) return null;
                          return (
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={async () => {
                                    setSwitchingBranch([proj.name]);
                                    try {
                                      await onSwitchBranch(proj.path, targetBranch);
                                    } catch (e: any) {
                                      toast('error', t('detail.switchBranchFailed', { name: proj.name, branch: targetBranch, error: String(e?.message || e) }));
                                    } finally {
                                      setSwitchingBranch([]);
                                    }
                                  }}
                                  disabled={switchingBranch.length > 0}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
                                >
                                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
                                  {t('detail.returnToBranchShort')}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">{t('detail.returnToBranch', { branch: targetBranch })}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          );
                        })()}
                        {switchingBranch.includes(proj.name) && <RefreshIcon className="w-3 h-3 animate-spin ml-1" />}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <StatusBadges project={liveProj} />
                    </div>
                    {isTauri() && (
                      <div className="flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                        <IdeIconButton
                          projectPath={proj.path}
                          projectName={proj.name}
                          editors={detectedEditors}
                          defaultEditorId={getProjectEditor(proj.name)}
                          onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
                          onDefaultEditorChange={handleEditorPrefsChange}
                        />
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onRevealInFinder(proj.path)}
                                className="h-7 w-7"
                              >
                                <FolderOpenIcon className="w-4.5 h-4.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{t('detail.revealInFinder')}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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
                <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                  <GitOperations
                    ref={(handle) => {
                      if (handle) gitOpsRefs.current.set(proj.path, handle);
                      else gitOpsRefs.current.delete(proj.path);
                    }}
                    projectPath={proj.path}
                    projectName={proj.name}
                    baseBranch={proj.base_branch}
                    testBranch={proj.test_branch}
                    currentBranch={proj.current_branch}
                    worktreeDisplayName={selectedWorktree.display_name || selectedWorktree.name}
                    onRefresh={onRefresh}
                    onSilentRefresh={onSilentRefresh}
                    onOpenTerminal={onOpenTerminalPanel}
                    autoRefreshSlot={selectedWorktree.is_archived ? undefined : index}
                    onStatsChanged={(stats) => handleStatsChanged(proj.path, stats)}
                  />
                </div>
              </div>
              );
            })}
            {isTauri() && !selectedWorktree.is_archived && onAddProjectToWorktree && (
              <button
                onClick={onAddProjectToWorktree}
                className="w-full p-3 rounded-lg border border-dashed border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors flex items-center justify-center gap-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
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
