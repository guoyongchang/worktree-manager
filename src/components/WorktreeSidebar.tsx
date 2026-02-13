import { useState, useEffect, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  ShareIcon,
  StopIcon,
  CopyIcon,
  CheckCircleIcon,
} from './Icons';
import type {
  WorkspaceRef,
  WorktreeListItem,
  MainWorkspaceStatus,
} from '../types';
import type { UpdaterState } from '../hooks/useUpdater';
import type { ConnectedClient } from '../lib/backend';
import { callBackend, getAppVersion, getWindowLabel, isMainWindow as checkIsMainWindow, isTauri } from '../lib/backend';

// ==================== ShareBar ====================

const ShareBar: FC<{
  active: boolean;
  url: string | null;
  ngrokUrl: string | null;
  password: string;
  ngrokAvailable: boolean;
  ngrokLoading: boolean;
  connectedClients?: ConnectedClient[];
  onToggleNgrok?: () => void;
  onStart?: (port: number) => void;
  onStop?: () => void;
  onUpdatePassword?: (password: string) => void;
}> = ({ active, url, ngrokUrl, password, ngrokAvailable, ngrokLoading, connectedClients = [], onToggleNgrok, onStart, onStop, onUpdatePassword }) => {
  const [showPassword, setShowPassword] = useState(false);
  const [editingPassword, setEditingPassword] = useState('');
  const [passwordDirty, setPasswordDirty] = useState(false);
  const [passwordConfirmed, setPasswordConfirmed] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [sharePort, setSharePort] = useState<number>(0);
  const [portError, setPortError] = useState<string | null>(null);

  // Sync editing password when prop changes (e.g., on share start)
  useEffect(() => {
    setEditingPassword(password);
    setPasswordDirty(false);
    setPasswordConfirmed(false);
  }, [password]);

  const handlePasswordChange = (value: string) => {
    setEditingPassword(value);
    setPasswordDirty(value !== password);
    setPasswordConfirmed(false);
  };

  const handleConfirmPassword = () => {
    if (!editingPassword.trim() || !passwordDirty) return;
    onUpdatePassword?.(editingPassword.trim());
    setPasswordDirty(false);
    setPasswordConfirmed(true);
    setTimeout(() => setPasswordConfirmed(false), 2000);
  };

  const generateRandomPort = () => {
    return 49152 + Math.floor(Math.random() * (65535 - 49152));
  };

  const handleOpenShareDialog = async () => {
    // Get last port or generate random
    const { getLastSharePort } = await import('../lib/backend');
    const lastPort = await getLastSharePort();
    setSharePort(lastPort || generateRandomPort());
    setPortError(null);
    setShowShareDialog(true);
  };

  const handleStartShare = () => {
    // Validate port
    if (sharePort < 1024 || sharePort > 65535) {
      setPortError('端口必须在 1024-65535 之间');
      return;
    }
    setShowShareDialog(false);
    onStart?.(sharePort);
  };

  if (!active) {
    return (
      <>
        <div className="px-3 py-2 border-t border-slate-700/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenShareDialog}
            className="w-full justify-center gap-2 h-8 text-slate-400 hover:text-slate-200"
          >
            <ShareIcon className="w-3.5 h-3.5" />
            <span className="text-xs">分享</span>
          </Button>
        </div>

        {/* Share Configuration Dialog */}
        <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
          <DialogContent className="max-w-[400px]">
            <DialogHeader>
              <DialogTitle>分享设置</DialogTitle>
              <DialogDescription>
                配置分享端口，局域网内的其他设备可以通过此端口访问
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">端口</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={sharePort}
                    onChange={(e) => {
                      setSharePort(parseInt(e.target.value) || 0);
                      setPortError(null);
                    }}
                    min={1024}
                    max={65535}
                    className="flex-1"
                  />
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setSharePort(generateRandomPort())}
                    title="随机生成端口"
                  >
                    🎲
                  </Button>
                </div>
                {portError && (
                  <p className="text-sm text-red-400 mt-1">{portError}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  推荐使用 49152-65535 范围内的端口
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowShareDialog(false)}>
                取消
              </Button>
              <Button onClick={handleStartShare}>
                开始分享
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="px-3 py-2 border-t border-slate-700/50 space-y-1.5">
      {/* ngrok row */}
      {ngrokAvailable && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-slate-500 shrink-0">NGROK:</span>
          {ngrokUrl ? (
            <>
              <span className="flex-1 text-xs text-blue-400 truncate min-w-0 select-all" title={ngrokUrl}>
                {ngrokUrl.replace(/^https?:\/\//, '')}
              </span>
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => navigator.clipboard.writeText(ngrokUrl)}
                      className="h-5 w-5 shrink-0"
                    >
                      <CopyIcon className="w-2.5 h-2.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">复制外网链接</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={onToggleNgrok}
            disabled={ngrokLoading}
            className={`relative inline-flex h-4 w-7 items-center rounded-full shrink-0 transition-colors ${
              ngrokLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'
            } ${ngrokUrl ? 'bg-blue-500' : 'bg-slate-600'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
              ngrokUrl ? 'translate-x-3.5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
      )}
      {/* LAN URL row */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-bold px-1 py-0.5 rounded shrink-0 bg-slate-600/30 text-slate-500">
          LAN
        </span>
        <span className="flex-1 text-xs text-emerald-400 truncate min-w-0 select-all" title={url || ''}>
          {url || '...'}
        </span>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => url && navigator.clipboard.writeText(url)}
                className="h-5 w-5 shrink-0"
              >
                <CopyIcon className="w-2.5 h-2.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">复制链接</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onStop}
                className="h-5 w-5 shrink-0 text-red-400 hover:text-red-300"
              >
                <StopIcon className="w-2.5 h-2.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">停止分享</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {/* Password row */}
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0 relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={editingPassword}
            onChange={(e) => handlePasswordChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmPassword(); }}
            onClick={() => setShowPassword(true)}
            onBlur={() => setShowPassword(false)}
            className="w-full bg-transparent text-xs text-slate-300 outline-none font-mono tracking-wider py-0.5 px-1 rounded hover:bg-slate-700/30 focus:bg-slate-700/40 transition-colors"
            spellCheck={false}
          />
        </div>
        {passwordDirty ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleConfirmPassword}
            className="h-5 w-5 shrink-0 text-emerald-400 hover:text-emerald-300"
            title="确认密码更新"
          >
            <CheckCircleIcon className="w-3 h-3" />
          </Button>
        ) : passwordConfirmed ? (
          <span className="h-5 w-5 flex items-center justify-center shrink-0 text-emerald-400">
            <CheckCircleIcon className="w-3 h-3" />
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => url && navigator.clipboard.writeText(editingPassword)}
            className="h-5 w-5 shrink-0"
            title="复制密码"
          >
            <CopyIcon className="w-2.5 h-2.5" />
          </Button>
        )}
      </div>
      {/* Connected clients */}
      {connectedClients.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-[10px] font-medium text-slate-500">
            客户端 ({connectedClients.length})
          </span>
          <div className="max-h-[60px] overflow-y-auto space-y-0">
            {connectedClients.map(c => (
              <div key={c.session_id} className="flex items-center gap-1.5 py-px px-1 rounded hover:bg-slate-700/20 group" title={`${c.ip}\n${c.user_agent}\n认证: ${c.authenticated_at}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.ws_connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                <span className="text-[11px] text-slate-400 truncate flex-1 font-mono">{c.ip}</span>
                {c.ws_connected && (
                  <span className="text-[9px] text-blue-400/70 shrink-0">WS</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== WorktreeSidebar ====================

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
  shareActive?: boolean;
  shareUrl?: string | null;
  shareNgrokUrl?: string | null;
  sharePassword?: string;
  onStartShare?: (port: number) => void;
  onStopShare?: () => void;
  onUpdateSharePassword?: (password: string) => void;
  ngrokAvailable?: boolean;
  ngrokLoading?: boolean;
  onToggleNgrok?: () => void;
  connectedClients?: ConnectedClient[];
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
  shareActive = false,
  shareUrl,
  shareNgrokUrl,
  sharePassword = '',
  onStartShare,
  onStopShare,
  onUpdateSharePassword,
  ngrokAvailable = false,
  ngrokLoading = false,
  onToggleNgrok,
  connectedClients = [],
}) => {
  const _isTauri = isTauri();

  // 网页端只显示被锁定的 worktree（正在被桌面端使用的）
  // 桌面端显示所有活动的 worktree
  const activeWorktrees = worktrees.filter(w => {
    if (w.is_archived) return false;
    if (_isTauri) return true; // 桌面端显示所有
    // 网页端只显示被锁定的
    return lockedWorktrees[w.name];
  });
  const archivedWorktrees = worktrees.filter(w => w.is_archived);

  const [appVersion, setAppVersion] = useState('');
  const [switchConfirmPath, setSwitchConfirmPath] = useState<string | null>(null);
  const [isMainWin, setIsMainWin] = useState(true);
  const [currentWindowLabel, setCurrentWindowLabel] = useState('main');

  const isDev = import.meta.env.DEV;

  useEffect(() => {
    checkIsMainWindow().then(setIsMainWin);
    getWindowLabel().then(setCurrentWindowLabel);
  }, []);

  useEffect(() => {
    if (isMainWin && !isDev) {
      getAppVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
    }
  }, [isMainWin, isDev]);

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
      await callBackend('open_log_dir');
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
              // 网页端允许选择被锁定的工作区（远程查看模式）
              const canSelect = !isLockedByOther || !_isTauri;
              return (
                <Tooltip key={wt.name}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => canSelect && onSelectWorktree(wt)}
                      className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors shrink-0 ${
                        isLockedByOther && _isTauri
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
            {_isTauri && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onOpenSettings} className="h-7 w-7">
                    <SettingsIcon className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">设置</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>
    );
  }

  // ==================== Expanded Sidebar ====================
  return (
    <div className="w-72 bg-slate-800/50 border-r border-slate-700/50 flex flex-col shrink-0">
      {/* Workspace Selector + Settings */}
      <div className="p-3 border-b border-slate-700/50">
        <div className="flex items-center gap-1.5">
          {_isTauri ? (
            <DropdownMenu open={showWorkspaceMenu} onOpenChange={onShowWorkspaceMenu}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  className="flex-1 justify-between min-w-0"
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
          ) : (
            <div className="flex-1 flex items-center gap-2 min-w-0 px-3 py-2 bg-slate-700/30 rounded-md">
              <WorkspaceIcon className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="font-medium text-sm truncate">{currentWorkspace?.name || 'Workspace'}</span>
            </div>
          )}
          {_isTauri && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onOpenSettings}
                    className="h-9 w-9 shrink-0"
                  >
                    <SettingsIcon className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">设置</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
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
            {_isTauri && (
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
            )}
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
            // 网页端允许选择被锁定的工作区（远程查看模式）
            const canSelect = !isLockedByOther || !_isTauri;
            return (
            <div
              key={wt.name}
              className={`px-4 py-2.5 transition-colors border-l-2 ${
                isLockedByOther && _isTauri
                  ? "border-transparent opacity-50 cursor-not-allowed"
                  : selectedWorktree?.name === wt.name
                    ? "bg-slate-700/30 border-blue-500 cursor-pointer"
                    : "border-transparent hover:bg-slate-700/20 cursor-pointer"
              }`}
              onClick={() => canSelect && onSelectWorktree(wt)}
              onContextMenu={(e) => canSelect && onContextMenu(e, wt)}
            >
              <div className="flex items-center gap-2.5">
                <FolderIcon className={`w-4 h-4 ${isLockedByOther ? 'text-slate-500' : 'text-blue-400'}`} />
                <span className="font-medium text-sm truncate flex-1">{wt.name}</span>
                {isLockedByOther && (
                  <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded shrink-0">已占用</span>
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

      {/* Share Bar (Tauri only) */}
      {_isTauri && (
        <ShareBar
          active={shareActive}
          url={shareUrl || null}
          ngrokUrl={shareNgrokUrl || null}
          password={sharePassword}
          ngrokAvailable={ngrokAvailable}
          ngrokLoading={ngrokLoading}
          connectedClients={connectedClients}
          onToggleNgrok={onToggleNgrok}
          onStart={onStartShare}
          onStop={onStopShare}
          onUpdatePassword={onUpdateSharePassword}
        />
      )}

      {/* Bottom Bar */}
      <div className="px-3 py-2.5 border-t border-slate-700/50 flex items-center justify-between">
        {isMainWin ? (
          isDev ? (
            <button
              onClick={() => { callBackend('open_devtools').catch(() => {}); }}
              className="text-xs text-amber-500/70 hover:text-amber-400 transition-colors cursor-pointer font-mono"
              title="打开 DevTools"
            >
              DEV
            </button>
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
          {_isTauri && (
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
            </TooltipProvider>
          )}
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
