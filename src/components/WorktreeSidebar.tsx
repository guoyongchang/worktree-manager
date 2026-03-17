import { useEffect, useState, type FC } from 'react';

import { getWindowLabel, isTauri } from '../lib/backend';
import { CollapsedSidebar } from './worktree-sidebar/CollapsedSidebar';
import { ExpandedSidebar } from './worktree-sidebar/ExpandedSidebar';
import type { WorktreeSidebarProps } from './worktree-sidebar/types';
import { useLongPressContextMenu } from './worktree-sidebar/useLongPressContextMenu';

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
  shareUrls = [],
  shareNgrokUrl,
  sharePassword = '',
  onStartShare,
  onStopShare,
  onUpdateSharePassword,
  ngrokLoading = false,
  onToggleNgrok,
  shareWmsUrl,
  wmsConnected = true,
  wmsReconnecting = false,
  wmsReconnectAttempt = 0,
  wmsNextRetrySecs = 0,
  wmsLoading = false,
  onToggleWms,
  onWmsManualReconnect,
  connectedClients = [],
  onKickClient,
  hasLastConfig = false,
  onQuickShare,
  occupation,
  hasNgrokToken = false,
  wmsUserName,
  refreshing = false,
}) => {
  const _isTauri = isTauri();
  const activeWorktrees = worktrees.filter((worktree) => {
    if (worktree.is_archived) return false;
    return _isTauri ? true : !!lockedWorktrees[worktree.name];
  });
  const archivedWorktrees = worktrees.filter((worktree) => worktree.is_archived);
  const { longPressFiredRef, handleTouchStart, handleTouchEnd, handleTouchMove } = useLongPressContextMenu(onContextMenu);
  const [currentWindowLabel, setCurrentWindowLabel] = useState('main');

  useEffect(() => {
    getWindowLabel().then(setCurrentWindowLabel);
  }, []);
  if (collapsed) {
    return (
      <CollapsedSidebar
        activeWorktrees={activeWorktrees}
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
      activeWorktrees={activeWorktrees}
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
      onToggleWms={onToggleWms}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchStart={handleTouchStart}
      onUpdateSharePassword={onUpdateSharePassword}
      onWmsManualReconnect={onWmsManualReconnect}
      refreshing={refreshing}
      selectedWorktree={selectedWorktree}
      shareActive={shareActive}
      shareNgrokUrl={shareNgrokUrl}
      sharePassword={sharePassword}
      shareUrls={shareUrls}
      shareWmsUrl={shareWmsUrl}
      showArchived={showArchived}
      showWorkspaceMenu={showWorkspaceMenu}
      switchingWorkspace={switchingWorkspace}
      updaterState={updaterState}
      wmsConnected={wmsConnected}
      wmsLoading={wmsLoading}
      wmsNextRetrySecs={wmsNextRetrySecs}
      wmsReconnectAttempt={wmsReconnectAttempt}
      wmsReconnecting={wmsReconnecting}
      wmsUserName={wmsUserName}
      workspaces={workspaces}
    />
  );
};
