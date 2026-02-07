import { useState, type FC } from 'react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  FolderIcon,
  ArchiveIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  ChevronIcon,
  WarningIcon,
  TrashIcon,
  ChevronDownIcon,
  WorkspaceIcon,
} from './Icons';
import type {
  WorkspaceRef,
  WorktreeListItem,
  MainWorkspaceStatus,
} from '../types';

interface WorktreeSidebarProps {
  workspaces: WorkspaceRef[];
  currentWorkspace: WorkspaceRef | null;
  showWorkspaceMenu: boolean;
  onShowWorkspaceMenu: (show: boolean) => void;
  onSwitchWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  onAddWorkspace: () => void;
  mainWorkspace: MainWorkspaceStatus | null;
  worktrees: WorktreeListItem[];
  selectedWorktree: WorktreeListItem | null;
  onSelectWorktree: (worktree: WorktreeListItem | null) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onContextMenu: (e: React.MouseEvent, worktree: WorktreeListItem) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenCreateModal: () => void;
}

export const WorktreeSidebar: FC<WorktreeSidebarProps> = ({
  workspaces,
  currentWorkspace,
  showWorkspaceMenu,
  onShowWorkspaceMenu,
  onSwitchWorkspace,
  onRemoveWorkspace,
  onAddWorkspace,
  mainWorkspace,
  worktrees,
  selectedWorktree,
  onSelectWorktree,
  showArchived,
  onToggleArchived,
  onContextMenu,
  onRefresh,
  onOpenSettings,
  onOpenCreateModal,
}) => {
  const activeWorktrees = worktrees.filter(w => !w.is_archived);
  const archivedWorktrees = worktrees.filter(w => w.is_archived);

  const [removeConfirmWorkspace, setRemoveConfirmWorkspace] = useState<WorkspaceRef | null>(null);

  const handleRemoveWorkspace = (ws: WorkspaceRef, e: React.MouseEvent) => {
    e.stopPropagation();
    setRemoveConfirmWorkspace(ws);
  };

  const confirmRemoveWorkspace = () => {
    if (removeConfirmWorkspace) {
      onRemoveWorkspace(removeConfirmWorkspace.path);
      setRemoveConfirmWorkspace(null);
    }
  };

  return (
    <div className="w-72 bg-slate-800/50 border-r border-slate-700/50 flex flex-col">
      {/* Workspace Selector */}
      <div className="p-3 border-b border-slate-700/50">
        <DropdownMenu open={showWorkspaceMenu} onOpenChange={onShowWorkspaceMenu}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              className="w-full justify-between"
            >
              <div className="flex items-center gap-2">
                <WorkspaceIcon className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-sm">{currentWorkspace?.name || '选择 Workspace'}</span>
              </div>
              <ChevronDownIcon className="w-4 h-4 text-slate-400" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[calc(100%-1.5rem)]" align="start">
            {workspaces.map(ws => (
              <DropdownMenuItem
                key={ws.path}
                className={`flex items-center justify-between ${
                  currentWorkspace?.path === ws.path ? 'bg-slate-700/50' : ''
                }`}
                onClick={() => onSwitchWorkspace(ws.path)}
              >
                <div className="flex-1">
                  <div className="text-sm font-medium">{ws.name}</div>
                  <div className="text-xs text-slate-500 truncate">{ws.path}</div>
                </div>
                {workspaces.length > 1 && (
                  <button
                    onClick={(e) => handleRemoveWorkspace(ws, e)}
                    className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                    title="移除"
                    aria-label={`移除工作区 ${ws.name}`}
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onAddWorkspace}>
              <PlusIcon className="w-4 h-4" />
              <span className="text-sm">添加 Workspace</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-slate-100">Worktrees</h1>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              title="刷新"
              aria-label="刷新 Worktree 列表"
              className="h-8 w-8"
            >
              <RefreshIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenSettings}
              title="设置"
              aria-label="打开设置"
              className="h-8 w-8"
            >
              <SettingsIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Workspace */}
      {mainWorkspace && (
        <div
          className={`px-4 py-3 border-b border-slate-700/50 cursor-pointer transition-colors ${
            !selectedWorktree ? "bg-slate-700/30" : "hover:bg-slate-700/20"
          }`}
          onClick={() => onSelectWorktree(null)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FolderIcon className="w-4 h-4 text-slate-400" />
              <span className="font-medium text-sm">主工作区</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onOpenCreateModal(); }}
              title="新建 Worktree"
              aria-label="新建 Worktree"
              className="h-7 w-7"
            >
              <PlusIcon className="w-4 h-4" />
            </Button>
          </div>
          <div className="text-slate-500 text-xs mt-1 truncate pl-6">{mainWorkspace.path}</div>
        </div>
      )}

      {/* Worktree List */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2">
          <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            活动 ({activeWorktrees.length})
          </span>
        </div>
        {activeWorktrees.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="flex justify-center mb-3">
              <FolderIcon className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-slate-500 text-sm">暂无 Worktree</p>
            <p className="text-slate-600 text-xs mt-1">点击上方 + 按钮创建</p>
          </div>
        ) : (
          activeWorktrees.map(wt => (
            <div
              key={wt.name}
              className={`px-4 py-2.5 cursor-pointer transition-colors border-l-2 ${
                selectedWorktree?.name === wt.name
                  ? "bg-slate-700/30 border-blue-500"
                  : "border-transparent hover:bg-slate-700/20"
              }`}
              onClick={() => onSelectWorktree(wt)}
              onContextMenu={(e) => onContextMenu(e, wt)}
            >
              <div className="flex items-center gap-2.5">
                <FolderIcon className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-sm truncate flex-1">{wt.name}</span>
                {wt.projects.some(p => p.has_uncommitted) && (
                  <WarningIcon className="w-3.5 h-3.5 text-amber-500" />
                )}
              </div>
              <div className="text-slate-500 text-xs mt-0.5 pl-6">{wt.projects.length} 个项目</div>
            </div>
          ))
        )}

        <div
          className="px-4 py-2 cursor-pointer hover:bg-slate-700/20 flex items-center justify-between transition-colors"
          onClick={onToggleArchived}
        >
          <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            归档 ({archivedWorktrees.length})
          </span>
          <ChevronIcon expanded={showArchived} className="w-3.5 h-3.5 text-slate-500" />
        </div>

        {showArchived && archivedWorktrees.map(wt => (
          <div
            key={wt.name}
            className={`px-4 py-2.5 cursor-pointer transition-colors opacity-60 ${
              selectedWorktree?.name === wt.name ? "bg-slate-700/30" : "hover:bg-slate-700/20"
            }`}
            onClick={() => onSelectWorktree(wt)}
          >
            <div className="flex items-center gap-2.5">
              <ArchiveIcon className="w-4 h-4 text-slate-500" />
              <span className="font-medium text-sm truncate">{wt.name}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Remove Workspace Confirmation Dialog */}
      <Dialog open={!!removeConfirmWorkspace} onOpenChange={(open) => !open && setRemoveConfirmWorkspace(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>移除工作区</DialogTitle>
            <DialogDescription>
              确定要移除工作区 "{removeConfirmWorkspace?.name}" 吗？此操作仅从列表中移除，不会删除实际文件。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoveConfirmWorkspace(null)}>
              取消
            </Button>
            <Button variant="warning" onClick={confirmRemoveWorkspace}>
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
