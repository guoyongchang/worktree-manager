import { useState, type FC } from 'react';
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
} from './Icons';
import { Badge } from '@/components/ui/badge';
import { GitOperations } from './GitOperations';
import { EDITORS } from '../constants';
import { isTauri } from '@/lib/backend';
import type {
  WorktreeListItem,
  MainWorkspaceStatus,
  ProjectStatus,
  EditorType,
} from '../types';

const StatusBadges: FC<{ project: ProjectStatus }> = ({ project }) => {
  const { t } = useTranslation();
  const badges: { label: string; variant: 'warning' | 'success' | 'default' }[] = [];
  if (project.has_uncommitted) badges.push({ label: t('detail.uncommitted', { count: project.uncommitted_count }), variant: 'warning' });
  if (project.is_merged_to_test) badges.push({ label: t('detail.mergedTo', { branch: project.test_branch }), variant: 'success' });
  if (project.behind_base > 0) badges.push({ label: t('detail.behind', { count: project.behind_base }), variant: 'default' });
  if (project.ahead_of_base > 0) badges.push({ label: t('detail.ahead', { count: project.ahead_of_base }), variant: 'default' });
  if (badges.length === 0) return <Badge variant="success">{t('detail.clean')}</Badge>;
  return (
    <div className="flex flex-wrap gap-1 justify-end">
      {badges.map((b, i) => <Badge key={i} variant={b.variant}>{b.label}</Badge>)}
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
  onOpenInTerminal: (path: string) => void;
  onRevealInFinder: (path: string) => void;
  onSwitchBranch: (projectPath: string, branch: string) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete?: () => void;
  onAddProject?: () => void;
  onAddProjectToWorktree?: () => void;
  onRefresh?: () => void;
  error: string | null;
  onClearError: () => void;
  restoring?: boolean;
  switching?: boolean;
}

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
  onAddProjectToWorktree,
  onRefresh,
  error,
  onClearError,
  restoring = false,
  switching = false,
}) => {
  const { t } = useTranslation();
  const selectedEditorName = EDITORS.find(e => e.id === selectedEditor)?.name || 'VS Code';
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);

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
        <div className="flex items-center justify-between mb-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-slate-100 truncate">{t('detail.mainWorkspace', { name: mainWorkspace.name })}</h2>
            <PathDisplay path={mainWorkspace.path} />
          </div>
          {isTauri() && (
          <div className="flex gap-2 items-center shrink-0 ml-3">
            {onAddProject && (
              <Button onClick={onAddProject} variant="default">
                <PlusIcon className="w-4 h-4 mr-1.5" />
                {t('detail.addProject')}
              </Button>
            )}
            <div className="inline-flex rounded-md">
              <Button
                className="rounded-r-none border-r border-blue-700/50"
                onClick={() => onOpenInEditor(mainWorkspace.path)}
              >
                {selectedEditorName}
              </Button>
              <DropdownMenu open={showEditorMenu} onOpenChange={onShowEditorMenu}>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none px-2 min-w-0">
                    <ChevronDownIcon className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {EDITORS.map(editor => (
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mainWorkspace.projects.map(proj => {
            const projectPath = `${mainWorkspace.path}/projects/${proj.name}`;
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
                    {proj.has_uncommitted && <WarningIcon className="w-4 h-4 text-amber-500" />}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                    <GitBranchIcon className="w-3.5 h-3.5" />
                    <span className="select-text">{proj.current_branch}</span>
                    {isSwitching && <RefreshIcon className="w-3 h-3 animate-spin ml-1" />}
                  </div>
                  <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          disabled={isSwitching}
                        >
                          {t('detail.switchBranch')}
                          <ChevronDownIcon className="w-3 h-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleSwitchBranch(proj.base_branch)}
                          disabled={proj.current_branch === proj.base_branch}
                        >
                          <GitBranchIcon className="w-3.5 h-3.5 mr-2" />
                          <span>{t('detail.baseBranchPrefix', { branch: proj.base_branch })}</span>
                          {proj.current_branch === proj.base_branch && (
                            <CheckIcon className="w-3 h-3 ml-2 text-green-400" />
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleSwitchBranch(proj.test_branch)}
                          disabled={proj.current_branch === proj.test_branch}
                        >
                          <GitBranchIcon className="w-3.5 h-3.5 mr-2" />
                          <span>{t('detail.testBranchPrefix', { branch: proj.test_branch })}</span>
                          {proj.current_branch === proj.test_branch && (
                            <CheckIcon className="w-3 h-3 ml-2 text-green-400" />
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
              </div>
            );
          })}
        </div>
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
              <h2 className="text-xl font-semibold text-slate-100 truncate">{selectedWorktree.name}</h2>
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
                <div className="inline-flex rounded-md">
                  <Button
                    className="rounded-r-none border-r border-blue-700/50"
                    onClick={() => onOpenInEditor(selectedWorktree.path)}
                  >
                    {selectedEditorName}
                  </Button>
                  <DropdownMenu open={showEditorMenu} onOpenChange={onShowEditorMenu}>
                    <DropdownMenuTrigger asChild>
                      <Button className="rounded-l-none px-2 min-w-0">
                        <ChevronDownIcon className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {EDITORS.map(editor => (
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
                <Button variant="warning" onClick={onArchive}>{t('detail.archive')}</Button>
                </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {selectedWorktree.projects.map(proj => (
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenInEditor(proj.path)}
                      title={t('detail.openInEditorLabel', { editor: selectedEditorName })}
                      aria-label={t('detail.openInEditorProject', { editor: selectedEditorName, name: proj.name })}
                      className="h-7 w-7"
                    >
                      <FolderIcon className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenInTerminal(proj.path)}
                      title={t('detail.openExternalTerminal')}
                      aria-label={t('detail.openExternalTerminalProject', { name: proj.name })}
                      className="h-7 w-7"
                    >
                      <TerminalIcon className="w-3.5 h-3.5" />
                    </Button>
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
