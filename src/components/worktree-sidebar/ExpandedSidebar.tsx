import { useEffect, useMemo, useState, type FC, type MutableRefObject, type TouchEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { openLink } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { callBackend, getAppVersion, isMainWindow as checkIsMainWindow } from '../../lib/backend';
import type { WorktreeListItem } from '../../types';
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronIcon,
  ExternalLinkIcon,
  FolderIcon,
  GithubIcon,
  LogIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  SidebarCollapseIcon,
  WarningIcon,
  WorkspaceIcon,
} from '../Icons';
import type { WorktreeSidebarProps } from './types';
import { ShareBar } from './ShareBar';

interface ExpandedSidebarProps extends Omit<WorktreeSidebarProps, 'worktrees'> {
  activeWorktrees: WorktreeListItem[];
  archivedWorktrees: WorktreeListItem[];
  currentWindowLabel: string;
  isTauri: boolean;
  longPressFiredRef: MutableRefObject<boolean>;
  onTouchStart: (e: TouchEvent, worktree: WorktreeListItem) => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
}

export const ExpandedSidebar: FC<ExpandedSidebarProps> = ({
  activeWorktrees,
  archivedWorktrees,
  currentWindowLabel,
  currentWorkspace,
  hasLastConfig = false,
  hasNgrokToken = false,
  isTauri,
  lockedWorktrees = {},
  longPressFiredRef,
  mainWorkspace,
  ngrokLoading = false,
  occupation,
  onAddWorkspace,
  onCheckUpdate,
  onContextMenu,
  onKickClient,
  onOpenCreateModal,
  onOpenInNewWindow,
  onOpenSettings,
  onQuickShare,
  onRefresh,
  onSelectWorktree,
  onShowWorkspaceMenu,
  onStartShare,
  onStopShare,
  onSwitchWorkspace,
  onToggleArchived,
  onToggleCollapsed,
  onToggleNgrok,
  onToggleWms,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onUpdateSharePassword,
  onWmsManualReconnect,
  refreshing = false,
  selectedWorktree,
  shareActive = false,
  shareNgrokUrl,
  sharePassword = '',
  shareUrls = [],
  shareWmsUrl,
  showArchived,
  showWorkspaceMenu,
  sidebarWidth,
  setSidebarWidth,
  switchingWorkspace = false,
  updaterState,
  wmsConnected = true,
  wmsLoading = false,
  wmsNextRetrySecs = 0,
  wmsReconnectAttempt = 0,
  wmsReconnecting = false,
  wmsUserName,
  workspaces,
  connectedClients = [],
}) => {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const [isMainWin, setIsMainWin] = useState(true);
  const [switchConfirmPath, setSwitchConfirmPath] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isDev = import.meta.env.DEV;

  useEffect(() => {
    checkIsMainWindow().then(setIsMainWin);
  }, []);

  useEffect(() => {
    if (isMainWin && !isDev) {
      getAppVersion().then(setAppVersion).catch(() => setAppVersion('unknown'));
    }
  }, [isMainWin, isDev]);

  // Sidebar width drag resize
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      const clampedWidth = Math.max(200, Math.min(500, newWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, setSidebarWidth]);

  const handleSwitchClick = (workspacePath: string) => {
    if (currentWorkspace?.path === workspacePath) return;
    setSwitchConfirmPath(workspacePath);
    onShowWorkspaceMenu(false);
  };

  const confirmSwitch = () => {
    if (!switchConfirmPath) return;
    onSwitchWorkspace(switchConfirmPath);
    setSwitchConfirmPath(null);
  };

  const handleOpenLogDir = async () => {
    try {
      await callBackend('open_log_dir');
    } catch (error) {
      console.error('Failed to open log dir:', error);
    }
  };

  const switchTargetName = switchConfirmPath
    ? workspaces.find((workspace) => workspace.path === switchConfirmPath)?.name || ''
    : '';
  const hasUpdate = updaterState === 'notification' || updaterState === 'downloading' || updaterState === 'success';

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40 sm:hidden"
        onClick={onToggleCollapsed}
      />
      <div
        style={{ width: `${sidebarWidth}px` }}
        className="bg-slate-800/50 border-r border-slate-700/50 flex flex-col shrink-0 relative max-sm:fixed max-sm:inset-y-0 max-sm:left-0 max-sm:z-50 max-sm:w-[85vw] max-sm:max-w-[320px] max-sm:bg-slate-800"
      >
        <div className="p-3 border-b border-slate-700/50">
          <div className="flex items-center gap-1.5">
            {isTauri ? (
              <WorkspaceSwitcher
                currentWorkspacePath={currentWorkspace?.path ?? null}
                currentWorkspaceName={currentWorkspace?.name || t('sidebar.selectWorkspace')}
                onAddWorkspace={() => { onAddWorkspace(); onShowWorkspaceMenu(false); }}
                onOpenInNewWindow={onOpenInNewWindow}
                onShowWorkspaceMenu={onShowWorkspaceMenu}
                onSwitchClick={handleSwitchClick}
                showWorkspaceMenu={showWorkspaceMenu}
                workspaces={workspaces}
              />
            ) : (
              <div className="flex-1 flex items-center gap-2 min-w-0 px-3 py-2 bg-slate-700/30 rounded-md">
                <WorkspaceIcon className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="font-medium text-sm truncate">{currentWorkspace?.name || 'Workspace'}</span>
              </div>
            )}
            {isTauri && (
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
                  <TooltipContent side="bottom">{t('sidebar.settings')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {isTauri && (
            <div className="flex items-center gap-1.5 mt-2 px-0.5">
              <svg className="w-3 h-3 text-slate-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <span className={`text-[11px] truncate ${wmsUserName ? 'text-slate-400' : 'text-slate-600'}`} title={wmsUserName || undefined}>
                {wmsUserName || t('app.wmsNotLoggedIn', 'Not logged in')}
              </span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-b border-slate-700/50">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-slate-100">Worktrees</h1>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={onRefresh}
                title={t('sidebar.refresh')}
                aria-label={t('sidebar.refreshWorktrees')}
                className="h-8 w-8"
              >
                <RefreshIcon className={`w-4 h-4${refreshing ? ' animate-spin' : ''}`} />
              </Button>
              {onToggleCollapsed && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleCollapsed}
                  title={t('share.collapseSidebar')}
                  aria-label={t('share.collapseSidebar')}
                  className="h-8 w-8"
                >
                  <SidebarCollapseIcon className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {mainWorkspace && (
          <MainWorkspaceCard
            occupation={occupation}
            onOpenCreateModal={onOpenCreateModal}
            onSelectMain={() => onSelectWorktree(null)}
            path={mainWorkspace.path}
            selected={!selectedWorktree}
            showCreateButton={isTauri}
          />
        )}

        <WorktreeList
          activeWorktrees={activeWorktrees}
          archivedWorktrees={archivedWorktrees}
          currentWindowLabel={currentWindowLabel}
          isTauri={isTauri}
          lockedWorktrees={lockedWorktrees}
          longPressFiredRef={longPressFiredRef}
          occupation={occupation}
          onContextMenu={onContextMenu}
          onSelectWorktree={onSelectWorktree}
          onToggleArchived={onToggleArchived}
          onTouchEnd={onTouchEnd}
          onTouchMove={onTouchMove}
          onTouchStart={onTouchStart}
          selectedWorktree={selectedWorktree}
          showArchived={showArchived}
        />

        {isTauri && isMainWin && (
          <ShareBar
            active={shareActive}
            urls={shareUrls}
            ngrokUrl={shareNgrokUrl || null}
            wmsUrl={shareWmsUrl || null}
            wmsConnected={wmsConnected}
            wmsReconnecting={wmsReconnecting}
            wmsReconnectAttempt={wmsReconnectAttempt}
            wmsNextRetrySecs={wmsNextRetrySecs}
            password={sharePassword}
            ngrokLoading={ngrokLoading}
            wmsLoading={wmsLoading}
            connectedClients={connectedClients}
            onToggleNgrok={onToggleNgrok}
            onToggleWms={onToggleWms}
            onWmsManualReconnect={onWmsManualReconnect}
            onStart={onStartShare}
            onStop={onStopShare}
            onUpdatePassword={onUpdateSharePassword}
            onKickClient={onKickClient}
            hasLastConfig={hasLastConfig}
            onQuickShare={onQuickShare}
            hasNgrokToken={hasNgrokToken}
          />
        )}

        <SidebarBottomBar
          appVersion={appVersion}
          hasUpdate={hasUpdate}
          isDev={isDev}
          isMainWin={isMainWin}
          isTauri={isTauri}
          onCheckUpdate={onCheckUpdate}
          onOpenLogDir={handleOpenLogDir}
        />

        {/* Drag handle for resizing - hidden on mobile */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors max-sm:hidden ${isDragging ? 'bg-blue-500/50' : ''}`}
          aria-label={t('sidebar.resizeWidth', 'Resize sidebar width')}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-12 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
            <svg className="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>
        </div>

        <Dialog open={!!switchConfirmPath} onOpenChange={(open) => !open && setSwitchConfirmPath(null)}>
          <DialogContent className="max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t('sidebar.switchWorkspace')}</DialogTitle>
              <DialogDescription>
                {t('sidebar.switchWorkspaceConfirm', { name: switchTargetName })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setSwitchConfirmPath(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={confirmSwitch} disabled={switchingWorkspace}>
                {switchingWorkspace ? t('sidebar.switching') : t('sidebar.confirmSwitch')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
};

const WorkspaceSwitcher: FC<{
  currentWorkspaceName: string;
  currentWorkspacePath: string | null;
  onAddWorkspace: () => void;
  onOpenInNewWindow?: (workspacePath: string) => void;
  onShowWorkspaceMenu: (show: boolean) => void;
  onSwitchClick: (workspacePath: string) => void;
  showWorkspaceMenu: boolean;
  workspaces: WorktreeSidebarProps['workspaces'];
}> = ({
  currentWorkspaceName,
  currentWorkspacePath,
  onAddWorkspace,
  onOpenInNewWindow,
  onShowWorkspaceMenu,
  onSwitchClick,
  showWorkspaceMenu,
  workspaces,
}) => {
  const { t } = useTranslation();

  return (
    <DropdownMenu open={showWorkspaceMenu} onOpenChange={onShowWorkspaceMenu}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          className="flex-1 justify-between min-w-0"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <WorkspaceIcon className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="font-medium text-sm truncate">{currentWorkspaceName}</span>
          </div>
          <ChevronDownIcon className="w-4 h-4 text-slate-400 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]" align="start">
        {workspaces.map((workspace) => {
          const isCurrent = currentWorkspacePath === workspace.path;
          return (
            <div
              key={workspace.path}
              className={`flex items-stretch rounded-sm text-sm ${isCurrent ? 'bg-slate-700/50' : 'hover:bg-slate-700/40'}`}
            >
              <button
                className={`flex-1 min-w-0 text-left px-2.5 py-2 rounded-l-sm transition-colors ${isCurrent ? 'cursor-default' : 'cursor-pointer hover:bg-slate-700/60'}`}
                onClick={() => onSwitchClick(workspace.path)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate font-medium">{workspace.name}</span>
                  {isCurrent && (
                    <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1 py-px rounded shrink-0">{t('sidebar.current')}</span>
                  )}
                </div>
              </button>
              {onOpenInNewWindow && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenInNewWindow(workspace.path);
                    onShowWorkspaceMenu(false);
                  }}
                  className="px-2 flex items-center text-slate-500 hover:text-blue-400 hover:bg-slate-600/40 rounded-r-sm transition-colors shrink-0 border-l border-slate-700/50"
                  title={t('sidebar.openInNewWindow')}
                  aria-label={`${t('sidebar.openInNewWindow')} ${workspace.name}`}
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
          onClick={onAddWorkspace}
        >
          <PlusIcon className="w-4 h-4" />
          <span>{t('sidebar.addWorkspace')}</span>
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MainWorkspaceCard: FC<{
  occupation: WorktreeSidebarProps['occupation'];
  onOpenCreateModal: () => void;
  onSelectMain: () => void;
  path: string;
  selected: boolean;
  showCreateButton: boolean;
}> = ({ occupation, onOpenCreateModal, onSelectMain, path, selected, showCreateButton }) => {
  const { t } = useTranslation();

  return (
    <div
      className={`px-4 py-3 border-b border-slate-700/50 cursor-pointer transition-all duration-150 border-l-2 ${selected ? 'bg-slate-700/30 border-l-blue-500' : 'border-l-transparent hover:bg-slate-700/20'}`}
      onClick={onSelectMain}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <FolderIcon className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="font-medium text-sm shrink-0">{t('sidebar.main')}</span>
          {occupation && (
            <div className="sidebar-marquee-container min-w-0 flex-1">
              <span className="sidebar-marquee-text text-xs text-blue-400">({occupation.worktree_name})</span>
            </div>
          )}
        </div>
        {showCreateButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onOpenCreateModal();
            }}
            title={t('sidebar.newWorktree')}
            aria-label={t('sidebar.newWorktree')}
            className="h-7 w-7"
          >
            <PlusIcon className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="text-slate-500 text-xs mt-1 truncate pl-6 select-text">{path}</div>
    </div>
  );
};

const WorktreeList: FC<{
  activeWorktrees: WorktreeListItem[];
  archivedWorktrees: WorktreeListItem[];
  currentWindowLabel: string;
  isTauri: boolean;
  lockedWorktrees: Record<string, string>;
  longPressFiredRef: MutableRefObject<boolean>;
  occupation: WorktreeSidebarProps['occupation'];
  onContextMenu: WorktreeSidebarProps['onContextMenu'];
  onSelectWorktree: WorktreeSidebarProps['onSelectWorktree'];
  onToggleArchived: WorktreeSidebarProps['onToggleArchived'];
  onTouchEnd: () => void;
  onTouchMove: () => void;
  onTouchStart: (e: TouchEvent, worktree: WorktreeListItem) => void;
  selectedWorktree: WorktreeSidebarProps['selectedWorktree'];
  showArchived: boolean;
}> = ({
  activeWorktrees,
  archivedWorktrees,
  currentWindowLabel,
  isTauri,
  lockedWorktrees,
  longPressFiredRef,
  occupation,
  onContextMenu,
  onSelectWorktree,
  onToggleArchived,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  selectedWorktree,
  showArchived,
}) => {
  const { t } = useTranslation();

  // Sort active worktrees by display_name (or name) alphabetically
  const sortedActiveWorktrees = useMemo(() => {
    return [...activeWorktrees].sort((a, b) => {
      const nameA = a.display_name || a.name;
      const nameB = b.display_name || b.name;
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
  }, [activeWorktrees]);

  // Sort archived worktrees by display_name (or name) alphabetically
  const sortedArchivedWorktrees = useMemo(() => {
    return [...archivedWorktrees].sort((a, b) => {
      const nameA = a.display_name || a.name;
      const nameB = b.display_name || b.name;
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
  }, [archivedWorktrees]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2">
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
          {t('sidebar.active')} ({activeWorktrees.length})
        </span>
      </div>
      {sortedActiveWorktrees.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <div className="flex justify-center mb-3">
            <FolderIcon className="w-10 h-10 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">{t('sidebar.noWorktrees')}</p>
          <p className="text-slate-600 text-xs mt-1">{t('sidebar.noWorktreesHint')}</p>
        </div>
      ) : (
        sortedActiveWorktrees.map((worktree) => {
          const lockedBy = lockedWorktrees[worktree.name];
          const isLockedByOther = lockedBy && lockedBy !== currentWindowLabel;
          const isDeployed = worktree.name === occupation?.worktree_name;
          const canSelect = (!isLockedByOther || !isTauri) && !isDeployed;

          return (
            <div
              key={worktree.name}
              className={`px-4 py-2.5 transition-all duration-150 border-l-2 ${isDeployed
                ? 'border-transparent opacity-50 cursor-not-allowed'
                : isLockedByOther && isTauri
                  ? 'border-transparent opacity-50 cursor-not-allowed'
                  : selectedWorktree?.name === worktree.name
                    ? 'bg-slate-700/30 border-blue-500 cursor-pointer'
                    : 'border-transparent hover:bg-slate-700/20 cursor-pointer'
                }`}
              onClick={() => {
                if (longPressFiredRef.current) return;
                if (canSelect) onSelectWorktree(worktree);
              }}
              onContextMenu={(e) => canSelect && onContextMenu(e, worktree)}
              onTouchStart={(e) => canSelect && onTouchStart(e, worktree)}
              onTouchEnd={onTouchEnd}
              onTouchMove={onTouchMove}
            >
              <div className="flex items-center gap-2.5">
                <FolderIcon className={`w-4 h-4 ${isLockedByOther || isDeployed ? 'text-slate-500' : 'text-blue-400'}`} />
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-medium text-sm line-clamp-2 break-words flex-1">{worktree.display_name || worktree.name}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">{worktree.display_name ? `${worktree.display_name} (${worktree.name})` : worktree.name}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {isDeployed && (
                  <StatusBadge label={t('deploy.deployed')} tooltip={t('deploy.deployedTooltip')} tone="blue" />
                )}
                {isLockedByOther && !isDeployed && (
                  <StatusBadge label={t('sidebar.occupied')} tooltip={t('sidebar.occupiedTooltip')} tone="amber" />
                )}
                {worktree.projects.some(project => project.has_uncommitted) && !isLockedByOther && !isDeployed && (() => {
                  const tip = worktree.projects
                    .filter(project => project.has_uncommitted)
                    .map(project => t('sidebar.uncommittedTip', { name: project.name, count: project.uncommitted_count }))
                    .join('\n');
                  return (
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="shrink-0"><WarningIcon className="w-3.5 h-3.5 text-amber-500" /></span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="whitespace-pre">{tip}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })()}
              </div>
              <div className="text-slate-500 text-xs mt-0.5 pl-6">{t('sidebar.projects', { count: worktree.projects.length })}</div>
            </div>
          );
        })
      )}

      <div
        className="px-4 py-2 cursor-pointer hover:bg-slate-700/30 flex items-center justify-between transition-colors group"
        onClick={onToggleArchived}
      >
        <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider group-hover:text-slate-400 transition-colors">
          {t('sidebar.archive')} ({archivedWorktrees.length})
        </span>
        <ChevronIcon expanded={showArchived} className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-400 transition-colors" />
      </div>

      {showArchived && sortedArchivedWorktrees.map((worktree) => (
        <div
          key={worktree.name}
          className={`px-4 py-2.5 cursor-pointer transition-colors opacity-60 ${selectedWorktree?.name === worktree.name ? 'bg-slate-700/30' : 'hover:bg-slate-700/20'}`}
          onClick={() => onSelectWorktree(worktree)}
        >
          <div className="flex items-center gap-2.5">
            <ArchiveIcon className="w-4 h-4 text-slate-500" />
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-medium text-sm line-clamp-2 break-words flex-1">{worktree.display_name || worktree.name}</span>
                </TooltipTrigger>
                <TooltipContent side="right">{worktree.display_name ? `${worktree.display_name} (${worktree.name})` : worktree.name}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      ))}
    </div>
  );
};

const StatusBadge: FC<{
  label: string;
  tooltip: string;
  tone: 'amber' | 'blue';
}> = ({ label, tooltip, tone }) => {
  const toneClass = tone === 'blue'
    ? 'text-blue-400/80 bg-blue-900/20 border border-blue-800/30'
    : 'text-amber-400/80 bg-amber-900/20 border border-amber-800/30';

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 cursor-help ${toneClass}`}>{label}</span>
        </TooltipTrigger>
        <TooltipContent side="right">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const SidebarBottomBar: FC<{
  appVersion: string;
  hasUpdate: boolean;
  isDev: boolean;
  isMainWin: boolean;
  isTauri: boolean;
  onCheckUpdate: () => void;
  onOpenLogDir: () => void;
}> = ({ appVersion, hasUpdate, isDev, isMainWin, isTauri, onCheckUpdate, onOpenLogDir }) => {
  const { t } = useTranslation();

  return (
    <div className="px-3 h-8 border-t border-slate-700/50 flex items-center justify-between shrink-0">
      {isMainWin ? (
        isDev ? (
          <button
            onClick={() => { callBackend('open_devtools').catch(() => { }); }}
            className="text-xs text-amber-500/70 hover:text-amber-400 transition-colors cursor-pointer font-mono"
            title={t('sidebar.openDevTools')}
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
                {hasUpdate ? t('sidebar.hasUpdateAvailable') : t('settings.checkUpdate')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      ) : (
        <div />
      )}

      <div className="flex items-center gap-1">
        {isTauri && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onOpenLogDir}
                  className="h-7 w-7"
                >
                  <LogIcon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('sidebar.logFolder')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openLink('https://github.com/guoyongchang/worktree-manager')}
                className="h-7 w-7"
              >
                <GithubIcon className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">GitHub</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};
