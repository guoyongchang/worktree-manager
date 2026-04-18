import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  WorktreeSidebar,
  WorktreeDetail,
  TerminalPanel,
  SettingsView,
  WelcomeView,
  CreateWorktreeModal,
  AddWorkspaceModal,
  CreateWorkspaceModal,
  AddProjectModal,
  AddProjectToWorktreeModal,
  ArchiveConfirmationModal,
  WorktreeContextMenu,
  TerminalTabContextMenu,
  RefreshIcon,
  ToastProvider,
  GlobalDialogs,
  MobileWorktreeList,
  MobileWorktreeDetail,
} from "./components";
import { useAppShellState } from "./hooks/useAppShellState";
import { Input } from "@/components/ui/input";
import { isTauri } from "./lib/backend";
import "./index.css";

// Disable browser-like behaviors (only in Tauri desktop mode)
if (typeof window !== 'undefined' && isTauri()) {
  document.body.classList.add('tauri');
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.metaKey && e.key === 'r') || (e.ctrlKey && e.key === 'r')) {
      e.preventDefault();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault();
    }
  });
} else if (typeof window !== 'undefined') {
  document.body.classList.add('browser');
}

function App() {
  const { t } = useTranslation();
  const {
    browserAuth,
    workspace,
    shareWorkspaceName,
    viewMode,
    setViewMode,
    isMobileWeb,
    sidebarCollapsed,
    setSidebarCollapsed,
    mobileView,
    setMobileView,
    terminalFullscreen,
    setTerminalFullscreen,
    showShortcutHelp,
    setShowShortcutHelp,
    terminalTabMenu,
    setTerminalTabMenu,
    modals,
    share,
    locks,
    mainOccupation,
    setSelectedWorktree,
    terminalHook,
    actions,
    updater,
    wsConnected,
    wasKicked,
    setWasKicked,
    voice,
    openSettings,
    handleSaveConfig,
    handleTerminalTabContextMenu,
  } = useAppShellState(t);

  // Browser mode: kicked screen
  if (!isTauri() && wasKicked) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="w-80 space-y-4 text-center">
          <div className="w-12 h-12 mx-auto bg-red-900/30 rounded-full flex items-center justify-center">
            <span className="text-red-400 text-xl">!</span>
          </div>
          <h1 className="text-xl font-semibold">{t('app.kickedTitle')}</h1>
          <p className="text-sm text-slate-400">{t('app.kickedDesc')}</p>
          <Button
            className="w-full"
            onClick={() => { setWasKicked(false); window.location.reload(); }}
          >
            {t('app.kickedReconnect')}
          </Button>
        </div>
      </div>
    );
  }

  // Browser mode: login screen
  if (!isTauri() && !browserAuth.browserAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="w-80 space-y-4">
          <div className="text-center space-y-2">
            <div className="w-10 h-10 mx-auto bg-blue-900/30 rounded-lg flex items-center justify-center mb-3">
              <RefreshIcon className="w-5 h-5 text-blue-400" />
            </div>
            <h1 className="text-xl font-semibold">Worktree Manager</h1>
            {shareWorkspaceName && (
              <p className="text-sm text-blue-400">{t('app.loginWorkspaceName', { name: shareWorkspaceName })}</p>
            )}
            <p className="text-sm text-slate-400">{t('app.loginPasswordLabel')}</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); browserAuth.handleBrowserLogin(); }} className="space-y-3">
            <Input
              type="password"
              placeholder={t('app.loginPasswordInput')}
              value={browserAuth.browserLoginPassword}
              onChange={(e) => browserAuth.setBrowserLoginPassword(e.target.value)}
              autoFocus
              className="bg-slate-800 border-slate-700"
            />
            {browserAuth.browserLoginError && (
              <p className="text-sm text-red-400">{browserAuth.browserLoginError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={browserAuth.browserLoggingIn || !browserAuth.browserLoginPassword.trim()}
            >
              {browserAuth.browserLoggingIn ? t('app.loginVerifying') : t('app.loginEnter')}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // No workspace welcome
  if (!workspace.loading && workspace.workspaces.length === 0) {
    return (
      <>
        <WelcomeView
          onAddWorkspace={() => modals.setModal('showAddWorkspaceModal', true)}
          onCreateWorkspace={() => modals.setModal('showCreateWorkspaceModal', true)}
        />
        <AddWorkspaceModal
          open={modals.showAddWorkspaceModal}
          onOpenChange={(v) => modals.setModal('showAddWorkspaceModal', v)}
          name={actions.newWorkspaceName}
          onNameChange={actions.setNewWorkspaceName}
          path={actions.newWorkspacePath}
          onPathChange={actions.setNewWorkspacePath}
          onSubmit={actions.handleAddWorkspace}
          loading={actions.addingWorkspace}
        />
        <CreateWorkspaceModal
          open={modals.showCreateWorkspaceModal}
          onOpenChange={(v) => modals.setModal('showCreateWorkspaceModal', v)}
          name={actions.createWorkspaceName}
          onNameChange={actions.setCreateWorkspaceName}
          path={actions.createWorkspacePath}
          onPathChange={actions.setCreateWorkspacePath}
          onSubmit={actions.handleCreateWorkspace}
          loading={actions.creatingWorkspace}
        />
      </>
    );
  }

  return (
    <ToastProvider>
      <>
        {/* Loading overlay */}
        {workspace.loading && (
          <div className="fixed inset-0 z-50 bg-slate-900 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <RefreshIcon className="w-5 h-5 animate-spin text-slate-400" />
              <span className="text-slate-400">{t('common.loading')}</span>
            </div>
          </div>
        )}

        {/* Browser mode: WebSocket disconnected overlay */}
        {!isTauri() && browserAuth.browserAuthenticated && !wsConnected && (
          <div className="fixed top-0 left-0 right-0 z-40 bg-yellow-900/90 text-yellow-200 text-xs py-1.5 px-4 text-center flex items-center justify-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            {t('app.wsDisconnected')}
          </div>
        )}

        {/* ==================== Desktop Layout ==================== */}
        {!isMobileWeb && (
          <>
            {/* Settings View (desktop) */}
            <div
              className="h-screen bg-slate-900 text-slate-100 p-6 overflow-y-auto"
              style={{ display: viewMode === 'settings' && workspace.config ? 'block' : 'none' }}
            >
              {workspace.config && (
                <SettingsView
                  workspaceConfig={workspace.config}
                  configPath={workspace.configPath}
                  error={workspace.error}
                  onBack={() => setViewMode('main')}
                  onSaveConfig={handleSaveConfig}
                  onClearError={() => workspace.setError(null)}
                  onCheckUpdate={() => updater.openCheckerDialog()}
                  checkingUpdate={updater.state === 'checking'}
                  workspaces={workspace.workspaces}
                  currentWorkspace={workspace.currentWorkspace}
                  onRemoveWorkspace={workspace.removeWorkspace}
                />
              )}
            </div>

            {/* Main View (desktop) */}
            <div
              className="h-screen bg-slate-900 text-slate-100 flex overflow-hidden"
              style={{ display: viewMode === 'main' ? 'flex' : 'none' }}
            >
              {!terminalFullscreen && (
                <WorktreeSidebar
                  workspaces={workspace.workspaces}
                  currentWorkspace={workspace.currentWorkspace}
                  showWorkspaceMenu={modals.showWorkspaceMenu}
                  onShowWorkspaceMenu={(v) => modals.setModal('showWorkspaceMenu', v)}
                  onSwitchWorkspace={actions.handleSwitchWorkspace}
                  onAddWorkspace={() => modals.setModal('showAddWorkspaceModal', true)}
                  mainWorkspace={workspace.mainWorkspace}
                  worktrees={workspace.worktrees}
                  selectedWorktree={actions.selectedWorktree}
                  onSelectWorktree={actions.handleSelectWorktree}
                  showArchived={modals.showArchived}
                  onToggleArchived={() => modals.toggleModal('showArchived')}
                  onContextMenu={actions.handleContextMenu}
                  onRefresh={workspace.loadData}
                  refreshing={workspace.refreshing}
                  onOpenSettings={openSettings}
                  onOpenCreateModal={actions.openCreateModal}
                  updaterState={updater.state}
                  onCheckUpdate={() => updater.openCheckerDialog()}
                  onOpenInNewWindow={isTauri() ? actions.handleOpenInNewWindow : undefined}
                  lockedWorktrees={locks.lockedWorktrees}
                  collapsed={sidebarCollapsed}
                  onToggleCollapsed={() => setSidebarCollapsed(prev => !prev)}
                  switchingWorkspace={actions.switchingWorkspace}
                  shareActive={share.shareActive}
                  shareUrls={share.shareUrls}
                  shareNgrokUrl={share.shareNgrokUrl}
                  sharePassword={share.sharePassword}
                  onStartShare={share.handleStartShare}
                  onStopShare={share.handleStopShare}
                  onUpdateSharePassword={share.handleUpdateSharePassword}
                  ngrokLoading={share.ngrokLoading}
                  onToggleNgrok={share.handleToggleNgrok}
                  connectedClients={share.connectedClients}
                  onKickClient={share.handleKickClient}
                  hasLastConfig={share.hasLastConfig}
                  onQuickShare={share.handleQuickShare}
                  hasNgrokToken={share.hasNgrokToken}
                  occupation={mainOccupation.occupation}
                />
              )}

              <div className="flex-1 min-w-0 flex flex-col bg-slate-900">
                {!terminalFullscreen && (
                  <div className="flex-1 p-6 overflow-y-auto min-h-0">
                    <WorktreeDetail
                      selectedWorktree={actions.selectedWorktree}
                      mainWorkspace={workspace.mainWorkspace}
                      selectedEditor={actions.selectedEditor}
                      showEditorMenu={modals.showEditorMenu}
                      onShowEditorMenu={(v) => modals.setModal('showEditorMenu', v)}
                      onSelectEditor={actions.setSelectedEditor}
                      onOpenInEditor={actions.handleOpenInEditor}
                      onOpenInTerminal={workspace.openInTerminal}
                      onRevealInFinder={workspace.revealInFinder}
                      onSwitchBranch={workspace.switchBranch}
                      onArchive={() => actions.selectedWorktree && actions.openArchiveModal(actions.selectedWorktree)}
                      onRestore={actions.handleRestoreWorktree}
                      restoring={actions.restoringWorktree}
                      switching={actions.switchingWorktree}
                      onDelete={actions.selectedWorktree?.is_archived ? () => actions.setDeleteConfirmWorktree(actions.selectedWorktree) : undefined}
                      onAddProject={() => modals.setModal('showAddProjectModal', true)}
                      onRemoveProject={!actions.selectedWorktree ? actions.handleRemoveProject : undefined}
                      onAddProjectToWorktree={() => modals.setModal('showAddProjectToWorktreeModal', true)}
                      error={workspace.error}
                      onClearError={() => workspace.setError(null)}
                      onRefresh={workspace.loadData}
                      onOpenTerminalPanel={terminalHook.handleTerminalTabClick}
                      occupation={mainOccupation.occupation}
                      deploying={mainOccupation.deploying}
                      exiting={mainOccupation.exiting}
                      onDeployToMain={isTauri() ? mainOccupation.deployToMain : undefined}
                      onExitOccupation={mainOccupation.exitOccupation}
                      onRefreshAfterDeploy={() => { setSelectedWorktree(null); workspace.loadData(); }}
                    />
                  </div>
                )}

                <TerminalPanel
                  visible={terminalHook.terminalVisible}
                  height={terminalHook.terminalHeight}
                  onStartResize={() => terminalHook.setIsResizing(true)}
                  terminalTabs={terminalHook.terminalTabs}
                  activatedTerminals={terminalHook.activatedTerminals}
                  mountedTerminals={terminalHook.mountedTerminals}
                  activeTerminalTab={terminalHook.activeTerminalTab}
                  onTabClick={terminalHook.handleTerminalTabClick}
                  onTabContextMenu={handleTerminalTabContextMenu}
                  onCloseTab={terminalHook.handleCloseTerminalTab}
                  onCloseAllTabs={terminalHook.handleCloseAllTerminalTabs}
                  onToggle={terminalHook.handleToggleTerminal}
                  onCollapse={() => terminalHook.setTerminalVisible(false)}
                  isFullscreen={terminalFullscreen}
                  onToggleFullscreen={() => {
                    const next = !terminalFullscreen;
                    setTerminalFullscreen(next);
                    if (next && !terminalHook.terminalVisible) {
                      terminalHook.handleToggleTerminal();
                    }
                  }}
                  voiceStatus={voice.voiceStatus}
                  voiceError={voice.voiceError}
                  isKeyHeld={voice.isKeyHeld}
                  analyserNode={voice.analyserNode}
                  onToggleVoice={voice.toggleVoice}
                  onStartRecording={voice.startRecording}
                  onStopRecording={voice.stopRecording}
                  staging={voice.staging}
                  clientId={terminalHook.clientId}
                />

              </div>
            </div>
          </>
        )}

        {/* ==================== Mobile Layout ==================== */}
        {isMobileWeb && (
          <div className="h-screen bg-slate-900 text-slate-100 flex flex-col overflow-hidden">
            {/* Mobile content area */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {/* List view */}
              {mobileView === 'list' && (
                <MobileWorktreeList
                  workspaces={workspace.workspaces}
                  currentWorkspace={workspace.currentWorkspace}
                  worktrees={workspace.worktrees}
                  mainWorkspace={workspace.mainWorkspace}
                  selectedWorktree={actions.selectedWorktree}
                  onSelectWorktree={(wt) => {
                    actions.handleSelectWorktree(wt);
                    setMobileView('detail');
                  }}
                  onRefresh={workspace.loadData}
                  lockedWorktrees={locks.lockedWorktrees}
                  shareActive={share.shareActive}
                  onOpenCreateModal={actions.openCreateModal}
                />
              )}

              {/* Detail view (with embedded Projects/Terminals tabs) */}
              {mobileView === 'detail' && (
                <MobileWorktreeDetail
                  selectedWorktree={actions.selectedWorktree}
                  mainWorkspace={workspace.mainWorkspace}
                  onBack={() => setMobileView('list')}
                  onSwitchBranch={workspace.switchBranch}
                  onArchive={() => actions.selectedWorktree && actions.openArchiveModal(actions.selectedWorktree)}
                  onRestore={actions.handleRestoreWorktree}
                  onDelete={actions.selectedWorktree?.is_archived ? () => actions.setDeleteConfirmWorktree(actions.selectedWorktree) : undefined}
                  onOpenInEditor={actions.handleOpenInEditor}
                  onRevealInFinder={workspace.revealInFinder}
                  onOpenTerminalPanel={terminalHook.handleTerminalTabClick}
                  onAddProjectToWorktree={() => modals.setModal('showAddProjectToWorktreeModal', true)}
                  onRefresh={workspace.loadData}
                  selectedEditor={actions.selectedEditor}
                  error={workspace.error}
                  onClearError={() => workspace.setError(null)}
                  restoring={actions.restoringWorktree}
                  occupation={mainOccupation.occupation}
                  deploying={mainOccupation.deploying}
                  exiting={mainOccupation.exiting}
                  onDeployToMain={mainOccupation.deployToMain}
                  onExitOccupation={mainOccupation.exitOccupation}
                  onRefreshAfterDeploy={() => { actions.handleSelectWorktree(null as any); workspace.loadData(); }}
                  terminalTabs={terminalHook.terminalTabs}
                  activatedTerminals={terminalHook.activatedTerminals}
                  mountedTerminals={terminalHook.mountedTerminals}
                  activeTerminalTab={terminalHook.activeTerminalTab}
                  onTerminalTabClick={terminalHook.handleTerminalTabClick}
                  onTerminalTabContextMenu={handleTerminalTabContextMenu}
                  onCloseTerminalTab={terminalHook.handleCloseTerminalTab}
                  onCloseAllTerminalTabs={terminalHook.handleCloseAllTerminalTabs}
                  clientId={terminalHook.clientId}
                  voiceStatus={voice.voiceStatus}
                  voiceError={voice.voiceError}
                  isKeyHeld={voice.isKeyHeld}
                  analyserNode={voice.analyserNode}
                  onToggleVoice={voice.toggleVoice}
                  onStartRecording={voice.startRecording}
                  onStopRecording={voice.stopRecording}
                  staging={voice.staging}
                />
              )}

            </div>
          </div>
        )}

        {/* Modals */}
        <CreateWorktreeModal
          open={modals.showCreateModal && !!workspace.config}
          onOpenChange={(v) => modals.setModal('showCreateModal', v)}
          config={workspace.config}
          worktreeName={actions.newWorktreeName}
          onWorktreeNameChange={actions.setNewWorktreeName}
          folderAlias={actions.folderAlias}
          onFolderAliasChange={actions.setFolderAlias}
          useFolderAlias={actions.useFolderAlias}
          onUseFolderAliasChange={actions.setUseFolderAlias}
          selectedProjects={actions.selectedProjects}
          onToggleProject={actions.toggleProjectSelection}
          onUpdateBaseBranch={actions.updateProjectBaseBranch}
          onSubmit={actions.handleCreateWorktree}
          creating={actions.creating}
        />

        {isTauri() && (
          <AddWorkspaceModal
            open={modals.showAddWorkspaceModal}
            onOpenChange={(v) => modals.setModal('showAddWorkspaceModal', v)}
            name={actions.newWorkspaceName}
            onNameChange={actions.setNewWorkspaceName}
            path={actions.newWorkspacePath}
            onPathChange={actions.setNewWorkspacePath}
            onSubmit={actions.handleAddWorkspace}
            loading={actions.addingWorkspace}
          />
        )}

        <AddProjectModal
          open={modals.showAddProjectModal}
          onOpenChange={(v) => modals.setModal('showAddProjectModal', v)}
          onSubmit={actions.handleAddProject}
          loading={actions.cloningProject}
          scanLinkedFolders={workspace.scanLinkedFolders}
          workspacePath={workspace.currentWorkspace?.path}
          onUpdateLinkedFolders={actions.handleUpdateLinkedFolders}
          onSuccess={workspace.loadData}
        />

        <AddProjectToWorktreeModal
          open={modals.showAddProjectToWorktreeModal}
          onOpenChange={(v) => modals.setModal('showAddProjectToWorktreeModal', v)}
          config={workspace.config}
          worktree={actions.selectedWorktree}
          onSubmit={actions.handleAddProjectToWorktree}
          adding={actions.addingProjectToWorktree}
        />

        {/* Context Menus */}
        {actions.contextMenu && (
          <WorktreeContextMenu
            x={actions.contextMenu.x}
            y={actions.contextMenu.y}
            onClose={() => actions.setContextMenu(null)}
            onArchive={() => actions.openArchiveModal(actions.contextMenu!.worktree)}
          />
        )}

        {terminalTabMenu && (
          <TerminalTabContextMenu
            x={terminalTabMenu.x}
            y={terminalTabMenu.y}
            onClose={() => setTerminalTabMenu(null)}
            onDuplicate={() => {
              terminalHook.handleDuplicateTerminal(terminalTabMenu.path);
              setTerminalTabMenu(null);
            }}
            onCloseTab={() => {
              terminalHook.handleCloseTerminalTab(terminalTabMenu.path);
              setTerminalTabMenu(null);
            }}
            onCloseOtherTabs={() => {
              terminalHook.handleCloseOtherTerminalTabs(terminalTabMenu.path);
              setTerminalTabMenu(null);
            }}
            onCloseAllTabs={() => {
              terminalHook.handleCloseAllTerminalTabs();
              setTerminalTabMenu(null);
            }}
          />
        )}

        {/* Archive Confirmation Modal */}
        {actions.archiveModal && (
          <ArchiveConfirmationModal
            archiveModal={actions.archiveModal}
            onClose={() => actions.setArchiveModal(null)}
            onConfirmIssue={actions.confirmArchiveIssue}
            onArchive={actions.handleArchiveWorktree}
            areAllIssuesConfirmed={actions.allArchiveIssuesConfirmed}
            archiving={actions.archiving}
          />
        )}

        <GlobalDialogs
          updater={updater}
          share={share}
          showShortcutHelp={showShortcutHelp}
          onSetShowShortcutHelp={setShowShortcutHelp}
          onOpenSettings={openSettings}
          deleteConfirmWorktree={actions.deleteConfirmWorktree}
          onSetDeleteConfirmWorktree={actions.setDeleteConfirmWorktree}
          onDeleteArchivedWorktree={actions.handleDeleteArchivedWorktree}
          deletingArchived={actions.deletingArchived}
        />

      </>
    </ToastProvider >
  );
}

export default App;
