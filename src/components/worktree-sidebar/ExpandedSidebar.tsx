import { useEffect, useMemo, useRef, useState, type FC, type MutableRefObject, type TouchEvent } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { pinyin } from 'pinyin-pro';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';

import { openLink } from '@/lib/backend';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { GitBranch } from 'lucide-react';
import type { WorktreeSidebarProps } from './types';
import { ShareBar } from './ShareBar';
import { SortableWorktreeItem } from './SortableWorktreeItem';
import { BatchArchiveModal } from '../BatchArchiveModal';

// --- Search utilities ---

type MatchResult =
  | { matched: false }
  | { matched: true; type: 'substring'; index: number; length: number }
  | { matched: true; type: 'pinyin' };

export function matchWorktreeName(name: string, query: string): MatchResult {
  if (!query) return { matched: false };
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // 1. English substring
  const idx = lowerName.indexOf(lowerQuery);
  if (idx !== -1) {
    return { matched: true, type: 'substring', index: idx, length: lowerQuery.length };
  }

  // 2. Full pinyin
  try {
    const fullPy = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase();
    if (fullPy.includes(lowerQuery)) {
      return { matched: true, type: 'pinyin' };
    }
    // 3. Initials
    const initials = pinyin(name, { pattern: 'initial', type: 'array' }).join('').toLowerCase();
    if (initials.includes(lowerQuery)) {
      return { matched: true, type: 'pinyin' };
    }
  } catch {
    // pinyin conversion failed for non-Chinese text, skip
  }

  return { matched: false };
}

export function highlightWorktreeName(name: string, result: MatchResult): ReactNode {
  if (!result.matched) return name;
  if (result.type === 'pinyin') {
    return (
      <span className="text-[var(--color-warning)] bg-[var(--color-warning)]/30 rounded-sm px-px">{name}</span>
    );
  }
  // substring
  const { index, length } = result;
  return (
    <>
      {name.slice(0, index)}
      <span className="text-[var(--color-warning)] bg-[var(--color-warning)]/30 rounded-sm px-px">
        {name.slice(index, index + length)}
      </span>
      {name.slice(index + length)}
    </>
  );
}

interface ExpandedSidebarProps extends Omit<WorktreeSidebarProps, 'worktrees'> {
  activeWorktrees: WorktreeListItem[];
  archivedWorktrees: WorktreeListItem[];
  currentWindowLabel: string;
  isPrimary?: boolean;
  isTauri: boolean;
  longPressFiredRef: MutableRefObject<boolean>;
  onSortOrderChange: (newOrder: string[]) => void;
  onTouchStart: (e: TouchEvent, worktree: WorktreeListItem) => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  batchArchiveModalOpen: boolean;
  onToggleBatchArchiveModal: () => void;
  onBatchRestore: (names: string[]) => Promise<void>;
  onBatchDelete: (names: string[]) => Promise<void>;
}

export const ExpandedSidebar: FC<ExpandedSidebarProps> = ({
  activeWorktrees,
  archivedWorktrees,
  currentWindowLabel,
  currentWorkspace,
  hasLastConfig = false,
  hasNgrokToken = false,
  isPrimary = true,
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
  onSortOrderChange,
  onStartShare,
  onStopShare,
  onSwitchWorkspace,
  onToggleArchived,
  onToggleCollapsed,
  onToggleNgrok,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  onUpdateSharePassword,
  refreshing = false,
  selectedWorktree,
  shareActive = false,
  shareNgrokUrl,
  sharePassword = '',
  shareUrls = [],
  showArchived,
  showWorkspaceMenu,
  sidebarWidth,
  setSidebarWidth,
  switchingWorkspace = false,
  updaterState,
  workspaces,
  connectedClients = [],
  batchArchiveModalOpen,
  onToggleBatchArchiveModal,
  onBatchRestore,
  onBatchDelete,
}) => {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState('');
  const [isMainWin, setIsMainWin] = useState(true);
  const [switchConfirmPath, setSwitchConfirmPath] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);

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
      if (!dragStartRef.current) return;
      const delta = e.clientX - dragStartRef.current.x;
      const newWidth = dragStartRef.current.width + delta;
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
        ref={sidebarRef}
        style={{ width: `${sidebarWidth}px` }}
        className="bg-[var(--color-bg-surface)] border-r border-[var(--color-border)] flex flex-col shrink-0 relative max-sm:fixed max-sm:inset-y-0 max-sm:left-0 max-sm:z-50 max-sm:w-[85vw] max-sm:max-w-[320px] max-sm:bg-[var(--color-bg-surface)]"
      >
        <div className="p-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-1.5">
            {isPrimary ? (
              isTauri ? (
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
                <div className="flex-1 flex items-center gap-2 min-w-0 px-3 py-2 bg-[var(--color-bg-elevated)] rounded-md">
                  <WorkspaceIcon className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
                  <span className="font-medium text-sm truncate">{currentWorkspace?.name || 'Workspace'}</span>
                </div>
              )
            ) : (
              <div className="flex-1 flex items-center gap-2 min-w-0 px-3 py-2 bg-[var(--color-bg-elevated)] rounded-md">
                <WorkspaceIcon className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                <span className="font-medium text-sm truncate text-[var(--color-text-secondary)]">{currentWorkspace?.name || 'Workspace'}</span>
              </div>
            )}
            {isTauri && isPrimary && (
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
        </div>

        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold text-[var(--color-text-primary)]">Worktrees</h1>
            <div className="flex items-center gap-1">
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={onRefresh}
                      aria-label={t('sidebar.refreshWorktrees')}
                      className="h-8 w-8"
                    >
                      <RefreshIcon className={`w-4 h-4${refreshing ? ' animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t('sidebar.refresh')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {onToggleCollapsed && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={onToggleCollapsed}
                        aria-label={t('share.collapseSidebar')}
                        className="h-8 w-8"
                      >
                        <SidebarCollapseIcon className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('share.collapseSidebar')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </div>

        {mainWorkspace && (
          <MainWorkspaceCard
            occupation={occupation}
            onSelectMain={() => onSelectWorktree(null)}
            selected={!selectedWorktree}
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
          onOpenCreateModal={onOpenCreateModal}
          onSelectWorktree={onSelectWorktree}
          onSortOrderChange={onSortOrderChange}
          onToggleArchived={onToggleArchived}
          onToggleBatchArchiveModal={onToggleBatchArchiveModal}
          onTouchEnd={onTouchEnd}
          onTouchMove={onTouchMove}
          onTouchStart={onTouchStart}
          selectedWorktree={selectedWorktree}
          showArchived={showArchived}
        />

        {isTauri && isMainWin && isPrimary && (
          <ShareBar
            active={shareActive}
            urls={shareUrls}
            ngrokUrl={shareNgrokUrl || null}
            password={sharePassword}
            ngrokLoading={ngrokLoading}
            connectedClients={connectedClients}
            onToggleNgrok={onToggleNgrok}
            onStart={onStartShare}
            onStop={onStopShare}
            onUpdatePassword={onUpdateSharePassword}
            onKickClient={onKickClient}
            hasLastConfig={hasLastConfig}
            onQuickShare={onQuickShare}
            hasNgrokToken={hasNgrokToken}
          />
        )}

        {isPrimary ? (
          <SidebarBottomBar
            appVersion={appVersion}
            hasUpdate={hasUpdate}
            isDev={isDev}
            isMainWin={isMainWin}
            isTauri={isTauri}
            onCheckUpdate={onCheckUpdate}
            onOpenLogDir={handleOpenLogDir}
          />
        ) : (
          <div className="h-8 border-t border-[var(--color-border)] shrink-0" />
        )}

        {/* Drag handle for resizing - hidden on mobile */}
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            dragStartRef.current = { x: e.clientX, width: sidebarWidth };
            setIsDragging(true);
          }}
          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent)]/50 transition-colors max-sm:hidden ${isDragging ? 'bg-[var(--color-accent)]/50' : ''}`}
          aria-label={t('sidebar.resizeWidth', 'Resize sidebar width')}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-12 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
            <svg className="w-3 h-3 text-[var(--color-text-secondary)]" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>
        </div>

        <BatchArchiveModal
          open={batchArchiveModalOpen}
          archivedWorktrees={archivedWorktrees}
          onClose={onToggleBatchArchiveModal}
          onRestore={onBatchRestore}
          onDelete={onBatchDelete}
        />

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
            <WorkspaceIcon className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
            <span className="font-medium text-sm truncate">{currentWorkspaceName}</span>
          </div>
          <ChevronDownIcon className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]" align="start">
        {workspaces.map((workspace) => {
          const isCurrent = currentWorkspacePath === workspace.path;
          return (
            <div
              key={workspace.path}
              className={`flex items-stretch rounded-sm text-sm ${isCurrent ? 'bg-[var(--color-bg-elevated)]' : 'hover:bg-[var(--color-bg-elevated)]'}`}
            >
              <button
                className={`flex-1 min-w-0 text-left px-2.5 py-2 rounded-l-sm transition-colors ${isCurrent ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--color-bg-elevated)]'}`}
                onClick={() => onSwitchClick(workspace.path)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate font-medium">{workspace.name}</span>
                  {isCurrent && (
                    <span className="text-[10px] text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1 py-px rounded shrink-0">{t('sidebar.current')}</span>
                  )}
                </div>
              </button>
              {onOpenInNewWindow && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInNewWindow(workspace.path);
                          onShowWorkspaceMenu(false);
                        }}
                        className="px-2 flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-[var(--color-bg-elevated)] rounded-r-sm transition-colors shrink-0 border-l border-[var(--color-border)]"
                        aria-label={`${t('sidebar.openInNewWindow')} ${workspace.name}`}
                      >
                        <ExternalLinkIcon className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{t('sidebar.openInNewWindow')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          );
        })}
        <DropdownMenuSeparator />
        <button
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm hover:bg-[var(--color-bg-elevated)] transition-colors text-[var(--color-text-secondary)]"
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
  onSelectMain: () => void;
  selected: boolean;
}> = ({ occupation, onSelectMain, selected }) => {
  const { t } = useTranslation();

  return (
    <div
      className={`px-4 py-3 border-b border-[var(--color-border)] cursor-pointer transition-all duration-150 border-l-2 ${selected ? 'bg-[var(--color-bg-elevated)] border-l-[var(--color-accent)]' : 'border-l-transparent hover:bg-[var(--color-bg-elevated)]'}`}
      onClick={onSelectMain}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <FolderIcon className="w-4 h-4 text-[var(--color-text-secondary)] shrink-0" />
          <span className="font-medium text-sm shrink-0">{t('sidebar.main')}</span>
          {occupation && (
            <div className="sidebar-marquee-container min-w-0 flex-1">
              <span className="sidebar-marquee-text text-xs text-[var(--color-accent)]">({occupation.worktree_name})</span>
            </div>
          )}
        </div>
      </div>
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
  onOpenCreateModal: () => void;
  onSelectWorktree: WorktreeSidebarProps['onSelectWorktree'];
  onSortOrderChange: (newOrder: string[]) => void;
  onToggleArchived: WorktreeSidebarProps['onToggleArchived'];
  onToggleBatchArchiveModal: () => void;
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
  onOpenCreateModal,
  onSelectWorktree,
  onSortOrderChange,
  onToggleArchived,
  onToggleBatchArchiveModal,
  onTouchEnd,
  onTouchMove,
  onTouchStart,
  selectedWorktree,
  showArchived,
}) => {
  const { t } = useTranslation();
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(activeSearchQuery.trim()), 100);
    return () => clearTimeout(timer);
  }, [activeSearchQuery]);

  // activeWorktrees is pre-sorted by WorktreeSidebar (user drag-order or alphabetical fallback)

  const worktreesWithMatch = useMemo(() => {
    return activeWorktrees.map((wt) => {
      const displayName = wt.display_name || wt.name;
      const result = matchWorktreeName(displayName, debouncedQuery);
      return { wt, matchResult: result };
    });
  }, [debouncedQuery, activeWorktrees]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeWorktree = activeId ? activeWorktrees.find(w => w.name === activeId) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const names = activeWorktrees.map(w => w.name);
    const oldIndex = names.indexOf(active.id as string);
    const newIndex = names.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(names, oldIndex, newIndex);
    onSortOrderChange(newOrder);
  };

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
        <div className="flex items-center justify-between">
          <span className="shrink-0 text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            {t('sidebar.active')} ({activeWorktrees.length})
          </span>
          <Input
            value={activeSearchQuery}
            onChange={(event) => setActiveSearchQuery(event.target.value)}
            placeholder={t('sidebar.searchWorktrees')}
            aria-label={t('sidebar.searchWorktrees')}
            className="h-7 w-[160px] text-xs"
          />
        </div>
      </div>
      {activeWorktrees.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <div className="flex justify-center mb-3">
            <FolderIcon className="w-10 h-10 text-[var(--color-text-muted)]" />
          </div>
          <p className="text-[var(--color-text-muted)] text-sm">{t('sidebar.noWorktrees')}</p>
          <p className="text-[var(--color-text-muted)] text-xs mt-1">{t('sidebar.noWorktreesHint')}</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={activeWorktrees.map(w => w.name)}
            strategy={verticalListSortingStrategy}
          >
            {worktreesWithMatch.map(({ wt: worktree, matchResult }) => {
              const lockedBy = lockedWorktrees[worktree.name];
              const isLockedByOther = lockedBy && lockedBy !== currentWindowLabel;
              const isLockedBySameWindow = isLockedByOther && lockedBy.split(':')[0] === currentWindowLabel.split(':')[0];
              const isDeployed = worktree.name === occupation?.worktree_name;
              const canSelect = (!isLockedByOther || !isTauri) && !isDeployed;

              return (
                <SortableWorktreeItem key={worktree.name} id={worktree.name}>
                  <div
                    className={`pl-1 pr-3 py-2.5 transition-all duration-150 border-l-2 ${isDeployed
                      ? 'border-transparent opacity-50 cursor-not-allowed'
                      : isLockedByOther && isTauri
                        ? 'border-transparent opacity-50 cursor-not-allowed'
                        : selectedWorktree?.name === worktree.name
                          ? 'bg-[var(--color-bg-elevated)] border-[var(--color-accent)] cursor-pointer'
                          : 'border-transparent hover:bg-[var(--color-bg-elevated)] cursor-pointer'
                      }`}
                    onClick={() => {
                      if (longPressFiredRef.current) return;
                      if (canSelect) onSelectWorktree(worktree);
                    }}
                    onContextMenu={(e) => canSelect && onContextMenu(e, worktree)}
                    onTouchStart={(e) => !activeId && canSelect && onTouchStart(e, worktree)}
                    onTouchEnd={() => !activeId && onTouchEnd()}
                    onTouchMove={() => !activeId && onTouchMove()}
                  >
                    <div className="flex items-center gap-2.5">
                      <GitBranch className={`w-4 h-4 ${isLockedByOther || isDeployed ? 'text-[var(--color-text-muted)]' :
                        worktree.color === 'red' ? 'text-red-400' :
                        worktree.color === 'orange' ? 'text-orange-400' :
                        worktree.color === 'yellow' ? 'text-yellow-400' :
                        worktree.color === 'green' ? 'text-emerald-400' :
                        worktree.color === 'purple' ? 'text-purple-400' :
                        'text-[var(--color-accent)]'
                      }`} />
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="font-medium text-sm truncate flex-1">{highlightWorktreeName(worktree.display_name || worktree.name, matchResult)}</span>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <div>{worktree.display_name ? `${worktree.display_name} (${worktree.name})` : worktree.name}</div>
                            <div className="text-[var(--color-text-muted)] text-xs mt-0.5">{t('sidebar.projects', { count: worktree.projects.length })}</div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {isDeployed && (
                        <StatusBadge label={t('deploy.deployed')} tooltip={t('deploy.deployedTooltip')} tone="blue" />
                      )}
                      {isLockedByOther && !isDeployed && (
                        <StatusBadge
                          label={t(isLockedBySameWindow ? 'sidebar.occupiedByCell' : 'sidebar.occupied')}
                          tooltip={t(isLockedBySameWindow ? 'sidebar.occupiedByCellTooltip' : 'sidebar.occupiedTooltip')}
                          tone="amber"
                        />
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
                  </div>
                </SortableWorktreeItem>
              );
            })}
          </SortableContext>
          <DragOverlay>
            {activeWorktree ? (
              <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md px-4 py-2.5 shadow-xl opacity-70">
                <div className="flex items-center gap-2.5">
                  <GitBranch className="w-4 h-4 text-[var(--color-accent)]" />
                  <span className="font-medium text-sm">{activeWorktree.display_name || activeWorktree.name}</span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {isTauri && (
        <div
          className="mx-3 my-2 py-1.5 rounded-md border border-dashed border-[var(--color-accent)]/40 flex items-center justify-center gap-1.5 cursor-pointer hover:bg-[var(--color-accent)]/10 hover:border-[var(--color-accent)] transition-colors text-[var(--color-accent)]/70 hover:text-[var(--color-accent)]"
          onClick={onOpenCreateModal}
        >
          <PlusIcon className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{t('sidebar.newWorktree')}</span>
        </div>
      )}

      <div
        className="px-4 py-2 cursor-pointer hover:bg-[var(--color-bg-elevated)] flex items-center justify-between transition-colors group"
        onClick={onToggleArchived}
      >
        <span className="text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider group-hover:text-[var(--color-text-secondary)] transition-colors">
          {t('sidebar.archive')} ({archivedWorktrees.length})
        </span>
        <div className="flex items-center gap-1">
          {showArchived && archivedWorktrees.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleBatchArchiveModal();
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
            >
              {t('sidebar.manageArchive')}
            </button>
          )}
          <ChevronIcon expanded={showArchived} className="w-3.5 h-3.5 text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)] transition-colors" />
        </div>
      </div>

      {showArchived && sortedArchivedWorktrees.map((worktree) => (
        <div
          key={worktree.name}
          className={`px-3 py-2.5 cursor-pointer transition-colors opacity-60 ${selectedWorktree?.name === worktree.name ? 'bg-[var(--color-bg-elevated)]' : 'hover:bg-[var(--color-bg-elevated)]'}`}
          onClick={() => onSelectWorktree(worktree)}
        >
          <div className="flex items-center gap-2.5">
            <ArchiveIcon className="w-4 h-4 text-[var(--color-text-muted)]" />
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
  tone: 'amber' | 'blue' | 'green' | 'gray';
}> = ({ label, tooltip, tone }) => {
  const toneClasses: Record<typeof tone, string> = {
    blue: 'text-[var(--color-accent)]/80 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20',
    amber: 'text-[var(--color-warning)]/80 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20',
    green: 'text-emerald-400 bg-emerald-900/30 border border-emerald-800/30',
    gray: 'text-gray-400 bg-gray-800/50 border border-gray-700/30',
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`text-[10px] px-1 py-0 rounded-sm shrink-0 cursor-help ${toneClasses[tone]}`}>{label}</span>
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
  const [devConsoleEnabled, setDevConsoleEnabled] = useState(() => localStorage.getItem('dev-console-enabled') === 'true');

  useEffect(() => {
    const handler = () => {
      setDevConsoleEnabled(localStorage.getItem('dev-console-enabled') === 'true');
    };
    window.addEventListener('storage', handler);
    window.addEventListener('dev-console-enabled-changed', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('dev-console-enabled-changed', handler);
    };
  }, []);

  return (
    <div className="px-3 h-8 border-t border-[var(--color-border)] flex items-center justify-between shrink-0">
      {isMainWin ? (
        isDev ? (
          <button
            onClick={() => { callBackend('open_devtools').catch(() => { /* ignore */ }); }}
            className="text-xs text-[var(--color-warning)]/70 hover:text-[var(--color-warning)] transition-colors cursor-pointer font-mono"
            title={t('sidebar.openDevTools')}
          >
            DEV
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onCheckUpdate}
                    className="relative text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
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
            {devConsoleEnabled && (
              <button
                onClick={() => { callBackend('open_devtools').catch(() => { /* ignore */ }); }}
                className="text-[10px] text-[var(--color-warning)]/70 hover:text-[var(--color-warning)] transition-colors cursor-pointer font-mono"
                title={t('sidebar.openDevTools')}
              >
                DevTools
              </button>
            )}
          </div>
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
