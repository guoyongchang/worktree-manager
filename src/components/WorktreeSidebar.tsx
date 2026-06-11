import { useCallback, useEffect, useMemo, useState, type FC } from 'react';

import { getWindowLabel, isTauri } from '../lib/backend';
import { CollapsedSidebar } from './worktree-sidebar/CollapsedSidebar';
import { ExpandedSidebar } from './worktree-sidebar/ExpandedSidebar';
import type { WorktreeSidebarProps } from './worktree-sidebar/types';
import { useLongPressContextMenu } from './worktree-sidebar/useLongPressContextMenu';

function readSavedOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* corrupted data */ }
  return [];
}

export const WorktreeSidebar: FC<WorktreeSidebarProps> = ({
  cellId = '0-0',
  isPrimary = true,
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
  shareUrls = [],
  shareNgrokUrl,
  sharePassword = '',
  onStartShare,
  onStopShare,
  onUpdateSharePassword,
  ngrokLoading = false,
  onToggleNgrok,
  connectedClients = [],
  onKickClient,
  hasLastConfig = false,
  onQuickShare,
  occupation,
  hasNgrokToken = false,
  refreshing = false,
  batchArchiveModalOpen,
  onToggleBatchArchiveModal,
  onBatchRestore,
  onBatchDelete,
}) => {
  const _isTauri = isTauri();
  const activeWorktrees = useMemo(() => worktrees.filter((worktree) => !worktree.is_archived), [worktrees]);
  const archivedWorktrees = useMemo(() => worktrees.filter((worktree) => worktree.is_archived), [worktrees]);
  const { longPressFiredRef, handleTouchStart, handleTouchEnd, handleTouchMove } = useLongPressContextMenu(onContextMenu);
  const [currentWindowLabel, setCurrentWindowLabel] = useState('main:0');

  // Sort order persistence
  const workspacePath = currentWorkspace?.path ?? '';
  const storageKey = workspacePath ? `worktree-sort-order:${workspacePath}` : '';

  const [savedOrder, setSavedOrder] = useState<string[]>(() => {
    if (!storageKey) return [];
    return readSavedOrder(storageKey);
  });

  // Re-read localStorage when workspace changes
  useEffect(() => {
    if (!storageKey) {
      setSavedOrder([]);
      return;
    }
    setSavedOrder(readSavedOrder(storageKey));
  }, [storageKey]);

  const updateSortOrder = useCallback(
    (newOrder: string[]) => {
      setSavedOrder(newOrder);
      if (storageKey) {
        localStorage.setItem(storageKey, JSON.stringify(newOrder));
      }
    },
    [storageKey],
  );

  const sortedActiveWorktrees = useMemo(() => {
    const orderMap = new Map(savedOrder.map((name, idx) => [name, idx]));
    return [...activeWorktrees].sort((a, b) => {
      const idxA = orderMap.get(a.name);
      const idxB = orderMap.get(b.name);
      if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
      if (idxA !== undefined) return -1;
      if (idxB !== undefined) return 1;
      const nameA = a.display_name || a.name;
      const nameB = b.display_name || b.name;
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });
  }, [activeWorktrees, savedOrder]);

  const [sidebarWidth, setSidebarWidth] = useState<number>(288); // Default 288px (w-72)

  // Restore width from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-width');
    if (saved) {
      const width = Number(saved);
      if (width >= 200 && width <= 500) {
        setSidebarWidth(width);
      }
    }
  }, []);

  // Persist width to localStorage
  useEffect(() => {
    localStorage.setItem('sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    getWindowLabel().then(label => setCurrentWindowLabel(`${label}:${cellId}`));
  }, [cellId]);
  if (collapsed) {
    return (
      <CollapsedSidebar
        activeWorktrees={sortedActiveWorktrees}
        currentWorkspace={currentWorkspace}
        currentWindowLabel={currentWindowLabel}
        isTauri={_isTauri}
        lockedWorktrees={lockedWorktrees}
        mainWorkspaceExists={!!mainWorkspace}
        onOpenSettings={onOpenSettings}
        onSelectWorktree={onSelectWorktree}
        onShowWorkspaceMenu={onShowWorkspaceMenu}
        onToggleCollapsed={onToggleCollapsed}
        selectedWorktree={selectedWorktree}
        showWorkspaceMenu={showWorkspaceMenu}
      />
    );
  }

  return (
    <ExpandedSidebar
      isPrimary={isPrimary}
      activeWorktrees={sortedActiveWorktrees}
      onSortOrderChange={updateSortOrder}
      archivedWorktrees={archivedWorktrees}
      connectedClients={connectedClients}
      collapsed={collapsed}
      currentWindowLabel={currentWindowLabel}
      currentWorkspace={currentWorkspace}
      hasLastConfig={hasLastConfig}
      hasNgrokToken={hasNgrokToken}
      isTauri={_isTauri}
      lockedWorktrees={lockedWorktrees}
      longPressFiredRef={longPressFiredRef}
      mainWorkspace={mainWorkspace}
      ngrokLoading={ngrokLoading}
      occupation={occupation}
      onAddWorkspace={onAddWorkspace}
      onCheckUpdate={onCheckUpdate}
      onContextMenu={onContextMenu}
      onKickClient={onKickClient}
      onOpenCreateModal={onOpenCreateModal}
      onOpenInNewWindow={onOpenInNewWindow}
      onOpenSettings={onOpenSettings}
      onQuickShare={onQuickShare}
      onRefresh={onRefresh}
      onSelectWorktree={onSelectWorktree}
      onShowWorkspaceMenu={onShowWorkspaceMenu}
      onStartShare={onStartShare}
      onStopShare={onStopShare}
      onSwitchWorkspace={onSwitchWorkspace}
      onToggleArchived={onToggleArchived}
      onToggleCollapsed={onToggleCollapsed}
      onToggleNgrok={onToggleNgrok}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
      onUpdateSharePassword={onUpdateSharePassword}
      refreshing={refreshing}
      selectedWorktree={selectedWorktree}
      shareActive={shareActive}
      shareNgrokUrl={shareNgrokUrl}
      sharePassword={sharePassword}
      shareUrls={shareUrls}
      showArchived={showArchived}
      showWorkspaceMenu={showWorkspaceMenu}
      sidebarWidth={sidebarWidth}
      setSidebarWidth={setSidebarWidth}
      switchingWorkspace={switchingWorkspace}
      updaterState={updaterState}
      workspaces={workspaces}
      batchArchiveModalOpen={batchArchiveModalOpen}
      onToggleBatchArchiveModal={onToggleBatchArchiveModal}
      onBatchRestore={onBatchRestore}
      onBatchDelete={onBatchDelete}
    />
  );
};
