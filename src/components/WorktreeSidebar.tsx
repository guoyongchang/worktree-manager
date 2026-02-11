import { useState, useEffect, type FC } from 'react';
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
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  ChevronIcon,
  WarningIcon,
  ChevronDownIcon,
  WorkspaceIcon,
  LogIcon,
  ExternalLinkIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
} from './Icons';
import type {
  WorkspaceRef,
  WorktreeListItem,
  MainWorkspaceStatus,
} from '../types';
import type { UpdaterState } from '../hooks/useUpdater';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface WorktreeSidebarProps {
  workspaces: WorkspaceRef[];
  currentWorkspace: WorkspaceRef | null;
  showWorkspaceMenu: boolean;
  onShowWorkspaceMenu: (show: boolean) => void;
  onSwitchWorkspace: (path: string) => void;
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
  updaterState: UpdaterState;
  onCheckUpdate: () => void;
  onOpenInNewWindow?: (workspacePath: string) => void;
  lockedWorktrees?: Record<string, string>;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  switchingWorkspace?: boolean;
}

export const WorktreeSidebar: FC<WorktreeSidebarProps> = ({
  workspaces,
  currentWorkspace,
  showWorkspaceMenu,
  onShowWorkspaceMenu,
  onSwitchWorkspace,
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
  updaterState,
  onCheckUpdate,
  onOpenInNewWindow,
  lockedWorktrees = {},
  collapsed = false,
  onToggleCollapsed,
  switchingWorkspace = false,
}) => {
  const activeWorktrees = worktrees.filter(w => !w.is_archived);
  const archivedWorktrees = worktrees.filter(w => w.is_archived);

  const [appVersion, setAppVersion] = useState('');
  const [switchConfirmPath, setSwitchConfirmPath] = useState<string | null>(null);
  const currentWindow = getCurrentWindow();
  const isMainWindow = currentWindow.label === 'main';
  const currentWindowLabel = currentWindow.label;

  const isDev = import.meta.env.DEV;

  useEffect(() => {
    if (isMainWindow && !isDev) {
      getVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
    }
  }, [isMainWindow, isDev]);

  const handleSwitchClick = (wsPath: string) => {
    if (currentWorkspace?.path === wsPath) return; // Already current
    setSwitchConfirmPath(wsPath);
    onShowWorkspaceMenu(false);
  };

  const confirmSwitch = () => {
    if (switchConfirmPath) {
      onSwitchWorkspace(switchConfirmPath);
      setSwitchConfirmPath(null);
    }
  };

  const switchTargetName = switchConfirmPath
    ? workspaces.find(ws => ws.path === switchConfirmPath)?.name || ''
    : '';

  const handleOpenLogDir = async () => {
    try {
      await invoke('open_log_dir');
    } catch (e) {
      console.error('Failed to open log dir:', e);
    }
  };

  const hasUpdate = updaterState === 'notification' || updaterState === 'downloading' || updaterState === 'success';

  // ==================== Collapsed Sidebar ====================
  if (collapsed) {
    return (
      <div className="w-12 bg-slate-800/50 border-r border-slate-700/50 flex flex-col items-center py-2 shrink-0">
        {/* Expand button */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapsed}
                className="h-8 w-8 mb-2"
              >
                <SidebarExpandIcon className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">展开侧边栏</TooltipContent>
          </Tooltip>

          {/* Workspace icon */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onShowWorkspaceMenu(!showWorkspaceMenu)}
                className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-slate-700/50 transition-colors mb-1"
              >
                <WorkspaceIcon className="w-4 h-4 text-blue-400" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{currentWorkspace?.name || 'Workspace'}</TooltipContent>
          </Tooltip>

          <div className="w-6 h-px bg-slate-700/50 my-1.5" />

          {/* Main workspace */}
          {mainWorkspace && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSelectWorktree(null)}
                  className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors mb-0.5 ${
                    !selectedWorktree ? 'bg-slate-700/50' : 'hover:bg-slate-700/30'
                  }`}
                >
                  <FolderIcon className="w-4 h-4 text-slate-400" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">主工作区</TooltipContent>
            </Tooltip>
          )}

          {/* Worktree icons */}
          <div className="flex-1 overflow-y-auto flex flex-col items-center gap-0.5 w-full px-1">
            {activeWorktrees.map(wt => {
              const lockedBy = lockedWorktrees[wt.name];
              const isLockedByOther = lockedBy && lockedBy !== currentWindowLabel;
              return (
                <Tooltip key={wt.name}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => !isLockedByOther && onSelectWorktree(wt)}
                      className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${
                        isLockedByOther
                          ? 'opacity-30 cursor-not-allowed'
                          : selectedWorktree?.name === wt.name
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'hover:bg-slate-700/30 text-blue-400'
                      }`}
                    >
                      <FolderIcon className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {wt.name}{isLockedByOther ? ' (已占用)' : ''}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {/* Bottom icons */}
          <div className="flex flex-col items-center gap-0.5 mt-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-7 w-7">
                  <SettingsIcon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">设置</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
    );
  }

  // ==================== Expanded Sidebar ====================
  return (
    <div className="w-72 bg-slate-800/50 border-r border-slate-700/50 flex flex-col shrink-0">
      {/* Workspace Selector */}
      <div className="p-3 border-b border-slate-700/50">
        <DropdownMenu open={showWorkspaceMenu} onOpenChange={onShowWorkspaceMenu}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              className="w-full justify-between min-w-0"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <WorkspaceIcon className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="font-medium text-sm truncate">{currentWorkspace?.name || '选择 Workspace'}</span>
              </div>
              <ChevronDownIcon className="w-4 h-4 text-slate-400 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]" align="start">
            {workspaces.map(ws => {
              const isCurrent = currentWorkspace?.path === ws.path;
              return (
                <div
                  key={ws.path}
                  className={`flex items-stretch rounded-sm text-sm ${
                    isCurrent ? 'bg-slate-700/50' : 'hover:bg-slate-700/40'
                  }`}
                >
                  {/* Left: click to switch in current window */}
                  <button
                    className={`flex-1 min-w-0 text-left px-2 py-1.5 rounded-l-sm transition-colors ${
                      isCurrent ? 'cursor-default' : 'cursor-pointer hover:bg-slate-700/60'
                    }`}
                    onClick={() => handleSwitchClick(ws.path)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate font-medium">{ws.name}</span>
                      {isCurrent && (
                        <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1 py-px rounded shrink-0">当前</span>
                      )}
                    </div>
                  </button>
                  {/* Right: open in new window */}
                  {onOpenInNewWindow && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenInNewWindow(ws.path); onShowWorkspaceMenu(false); }}
                      className="px-2 flex items-center text-slate-500 hover:text-blue-400 hover:bg-slate-600/40 rounded-r-sm transition-colors shrink-0 border-l border-slate-700/50"
                      title="在新窗口打开"
                      aria-label={`在新窗口打开 ${ws.name}`}
                    >
                      <ExternalLinkIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            <DropdownMenuSeparator />
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-slate-700/40 transition-colors text-slate-300"
              onClick={() => { onAddWorkspace(); onShowWorkspaceMenu(false); }}
            >
              <PlusIcon className="w-4 h-4" />
              <span>添加 Workspace</span>
            </button>
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
            {onToggleCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapsed}
                title="收起侧边栏"
                aria-label="收起侧边栏"
                className="h-8 w-8"
              >
                <SidebarCollapseIcon className="w-4 h-4" />
              </Button>
            )}
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
          <div className="text-slate-500 text-xs mt-1 truncate pl-6 select-text">{mainWorkspace.path}</div>
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
          activeWorktrees.map(wt => {
            const lockedBy = lockedWorktrees[wt.name];
            const isLockedByOther = lockedBy && lockedBy !== currentWindowLabel;
            return (
            <div
              key={wt.name}
              className={`px-4 py-2.5 transition-colors border-l-2 ${
                isLockedByOther
                  ? "border-transparent opacity-40 cursor-not-allowed"
                  : selectedWorktree?.name === wt.name
                    ? "bg-slate-700/30 border-blue-500 cursor-pointer"
                    : "border-transparent hover:bg-slate-700/20 cursor-pointer"
              }`}
              onClick={() => !isLockedByOther && onSelectWorktree(wt)}
              onContextMenu={(e) => !isLockedByOther && onContextMenu(e, wt)}
            >
              <div className="flex items-center gap-2.5">
                <FolderIcon className={`w-4 h-4 ${isLockedByOther ? 'text-slate-500' : 'text-blue-400'}`} />
                <span className="font-medium text-sm truncate flex-1">{wt.name}</span>
                {isLockedByOther && (
                  <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">已占用</span>
                )}
                {wt.projects.some(p => p.has_uncommitted) && !isLockedByOther && (
                  <WarningIcon className="w-3.5 h-3.5 text-amber-500" />
                )}
              </div>
              <div className="text-slate-500 text-xs mt-0.5 pl-6">{wt.projects.length} 个项目</div>
            </div>
            );
          })
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

      {/* Bottom Bar */}
      <div className="px-3 py-2.5 border-t border-slate-700/50 flex items-center justify-between">
        {isMainWindow ? (
          isDev ? (
            <span className="text-xs text-slate-500">v0.0.1-dev</span>
          ) : (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onCheckUpdate}
                    className="relative text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                  >
                    v{appVersion}
                    {hasUpdate && (
                      <span className="absolute -top-1 -right-2.5 w-2 h-2 bg-red-500 rounded-full" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {hasUpdate ? '有新版本可用，点击更新' : '检查更新'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        ) : (
          <div />
        )}
        <div className="flex items-center gap-0.5">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleOpenLogDir}
                  className="h-7 w-7"
                >
                  <LogIcon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">日志文件夹</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onOpenSettings}
                  className="h-7 w-7"
                >
                  <SettingsIcon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">设置</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Switch Workspace Confirmation Dialog */}
      <Dialog open={!!switchConfirmPath} onOpenChange={(open) => !open && setSwitchConfirmPath(null)}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>切换工作区</DialogTitle>
            <DialogDescription>
              确定要切换到工作区 "{switchTargetName}" 吗？当前工作区的 Worktree 选择状态将被重置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSwitchConfirmPath(null)}>
              取消
            </Button>
            <Button onClick={confirmSwitch} disabled={switchingWorkspace}>
              {switchingWorkspace ? "切换中..." : "确认切换"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
