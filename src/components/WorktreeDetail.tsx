import { useState, type FC } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  FolderIcon,
  ArchiveIcon,
  WarningIcon,
  StatusDot,
  GitBranchIcon,
  TerminalIcon,
  ChevronDownIcon,
  RefreshIcon,
  PlusIcon,
} from './Icons';
import { EDITORS } from '../constants';
import type {
  WorktreeListItem,
  MainWorkspaceStatus,
  ProjectStatus,
  EditorType,
} from '../types';

interface WorktreeDetailProps {
  selectedWorktree: WorktreeListItem | null;
  mainWorkspace: MainWorkspaceStatus | null;
  selectedEditor: EditorType;
  showEditorMenu: boolean;
  onShowEditorMenu: (show: boolean) => void;
  onSelectEditor: (editor: EditorType) => void;
  onOpenInEditor: (path: string, editor?: EditorType) => void;
  onOpenInTerminal: (path: string) => void;
  onSwitchBranch: (projectPath: string, branch: string) => void;
  onArchive: () => void;
  onRestore: () => void;
  onAddProject?: () => void;
  error: string | null;
  onClearError: () => void;
}

function getProjectStatus(project: ProjectStatus): 'success' | 'warning' | 'info' | 'sync' {
  if (project.has_uncommitted) return 'warning';
  if (project.is_merged_to_test) return 'success';
  if (project.behind_base > 0) return 'sync';
  return 'success';
}

function getStatusText(project: ProjectStatus): string {
  const parts: string[] = [];
  if (project.has_uncommitted) parts.push(`${project.uncommitted_count} 未提交`);
  if (project.is_merged_to_test) parts.push(`已合并 ${project.test_branch}`);
  if (project.behind_base > 0) parts.push(`落后 ${project.behind_base}`);
  if (project.ahead_of_base > 0) parts.push(`领先 ${project.ahead_of_base}`);
  return parts.length === 0 ? "干净" : parts.join(" · ");
}

export const WorktreeDetail: FC<WorktreeDetailProps> = ({
  selectedWorktree,
  mainWorkspace,
  selectedEditor,
  showEditorMenu,
  onShowEditorMenu,
  onSelectEditor,
  onOpenInEditor,
  onOpenInTerminal,
  onSwitchBranch,
  onArchive,
  onRestore,
  onAddProject,
  error,
  onClearError,
}) => {
  const selectedEditorName = EDITORS.find(e => e.id === selectedEditor)?.name || 'VS Code';
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);

  if (!selectedWorktree && !mainWorkspace) {
    return (
      <div className="text-slate-500 text-center py-20">选择一个 Worktree 查看详情</div>
    );
  }

  // Main Workspace View
  if (!selectedWorktree && mainWorkspace) {
    return (
      <div>
        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800/50 rounded-lg">
            <div className="text-red-300 text-sm">{error}</div>
            <button onClick={onClearError} className="text-red-400 hover:text-red-200 text-xs mt-2 underline">关闭</button>
          </div>
        )}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">主工作区 - {mainWorkspace.name}</h2>
            <p className="text-slate-500 text-sm mt-1">{mainWorkspace.path}</p>
          </div>
          <div className="flex gap-2 items-center">
            {onAddProject && (
              <Button onClick={onAddProject} variant="default">
                <PlusIcon className="w-4 h-4 mr-1.5" />
                添加项目
              </Button>
            )}
            <DropdownMenu open={showEditorMenu} onOpenChange={onShowEditorMenu}>
              <DropdownMenuTrigger asChild>
                <Button>
                  {selectedEditorName}
                  <ChevronDownIcon className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {EDITORS.map(editor => (
                  <DropdownMenuItem
                    key={editor.id}
                    onClick={() => {
                      onSelectEditor(editor.id);
                      onOpenInEditor(mainWorkspace.path, editor.id);
                      onShowEditorMenu(false);
                    }}
                  >
                    {editor.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" onClick={() => onOpenInTerminal(mainWorkspace.path)}>外部终端</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
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
              <div key={proj.name} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 group hover:border-slate-600 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">{proj.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onOpenInEditor(projectPath)}
                      className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                      title={`在 ${selectedEditorName} 中打开`}
                      aria-label={`在 ${selectedEditorName} 中打开 ${proj.name}`}
                    >
                      <FolderIcon className="w-3.5 h-3.5" />
                    </button>
                    {proj.has_uncommitted && <WarningIcon className="w-4 h-4 text-amber-500" />}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5 text-slate-400 text-sm">
                    <GitBranchIcon className="w-3.5 h-3.5" />
                    <span>{proj.current_branch}</span>
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
                          切换分支
                          <ChevronDownIcon className="w-3 h-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleSwitchBranch(proj.base_branch)}
                          disabled={proj.current_branch === proj.base_branch}
                        >
                          <GitBranchIcon className="w-3.5 h-3.5 mr-2" />
                          <span>BASE: {proj.base_branch}</span>
                          {proj.current_branch === proj.base_branch && (
                            <span className="ml-2 text-xs text-green-400">✓</span>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleSwitchBranch(proj.test_branch)}
                          disabled={proj.current_branch === proj.test_branch}
                        >
                          <GitBranchIcon className="w-3.5 h-3.5 mr-2" />
                          <span>TEST: {proj.test_branch}</span>
                          {proj.current_branch === proj.test_branch && (
                            <span className="ml-2 text-xs text-green-400">✓</span>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
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
            <div className="text-red-300 text-sm">{error}</div>
            <button onClick={onClearError} className="text-red-400 hover:text-red-200 text-xs mt-2 underline">关闭</button>
          </div>
        )}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              {selectedWorktree.is_archived ? <ArchiveIcon className="w-5 h-5 text-slate-500" /> : <FolderIcon className="w-5 h-5 text-blue-400" />}
              <h2 className="text-xl font-semibold text-slate-100">{selectedWorktree.name}</h2>
            </div>
            <p className="text-slate-500 text-sm mt-1">{selectedWorktree.path}</p>
          </div>
          <div className="flex gap-2 items-center">
            {selectedWorktree.is_archived ? (
              <Button variant="default" className="bg-emerald-600 hover:bg-emerald-500" onClick={onRestore}>恢复</Button>
            ) : (
              <>
                <DropdownMenu open={showEditorMenu} onOpenChange={onShowEditorMenu}>
                  <DropdownMenuTrigger asChild>
                    <Button>
                      {selectedEditorName}
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {EDITORS.map(editor => (
                      <DropdownMenuItem
                        key={editor.id}
                        onClick={() => {
                          onSelectEditor(editor.id);
                          onOpenInEditor(selectedWorktree.path, editor.id);
                          onShowEditorMenu(false);
                        }}
                      >
                        {editor.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="secondary" onClick={() => onOpenInTerminal(selectedWorktree.path)}>外部终端</Button>
                <Button variant="warning" onClick={onArchive}>归档</Button>
              </>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {selectedWorktree.projects.map(proj => (
            <div key={proj.name} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 group hover:border-slate-600 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <StatusDot status={getProjectStatus(proj)} />
                  <div>
                    <div className="font-medium text-slate-200">{proj.name}</div>
                    <div className="flex items-center gap-1.5 text-slate-400 text-sm mt-0.5">
                      <GitBranchIcon className="w-3.5 h-3.5" />
                      <span>{proj.current_branch}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm text-slate-300">{getStatusText(proj)}</div>
                    <div className="text-xs text-slate-500 mt-0.5">base: {proj.base_branch} · test: {proj.test_branch}</div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenInEditor(proj.path)}
                      title={`在 ${selectedEditorName} 中打开`}
                      aria-label={`在 ${selectedEditorName} 中打开 ${proj.name}`}
                      className="h-8 w-8"
                    >
                      <FolderIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenInTerminal(proj.path)}
                      title="在外部终端打开"
                      aria-label={`在外部终端打开 ${proj.name}`}
                      className="h-8 w-8"
                    >
                      <TerminalIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
};
