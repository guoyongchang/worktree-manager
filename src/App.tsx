import { useState, useEffect, useCallback, useRef } from "react";
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
} from "./components";
import { useWorkspace, useTerminal, useUpdater, useShareFeature, useBrowserAuth, useWorktreeLocks, useModals, useWorkspaceActions } from "./hooks";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { Input } from "@/components/ui/input";
import { callBackend, isTauri, setWindowTitle, getShareInfo, clearSessionId } from "./lib/backend";
import { getWebSocketManager } from "./lib/websocket";
import type {
  ViewMode,
  TerminalTabMenuState,
} from "./types";
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
  const browserAuth = useBrowserAuth();
  const workspace = useWorkspace(browserAuth.browserAuthenticated);

  const [shareWorkspaceName, setShareWorkspaceName] = useState<string | null>(null);
  const [pendingAutoSelectWorktree, setPendingAutoSelectWorktree] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri()) return;
    getShareInfo()
      .then((info) => {
        if (info.workspace_name) setShareWorkspaceName(info.workspace_name);
        if (info.current_worktree) setPendingAutoSelectWorktree(info.current_worktree);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri() && browserAuth.browserAuthenticated) {
      getShareInfo().then(async (info) => {
        if (info.current_worktree) setPendingAutoSelectWorktree(info.current_worktree);
        await callBackend('set_window_workspace', { workspacePath: info.workspace_path });
        await workspace.loadWorkspaces();
        await workspace.loadData();
      }).catch(() => {});
    }
  }, [browserAuth.browserAuthenticated]);

  const [viewMode, setViewMode] = useState<ViewMode>('main');
  const [isMobileWeb, setIsMobileWeb] = useState(() => !isTauri() && window.matchMedia('(max-width: 639px)').matches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobileWeb);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [terminalTabMenu, setTerminalTabMenu] = useState<TerminalTabMenuState | null>(null);
  const modals = useModals();
  const share = useShareFeature(workspace.setError);
  const locks = useWorktreeLocks(workspace.currentWorkspace?.path, workspace.getLockedWorktrees);
  const [selectedWorktree, setSelectedWorktree] = useState<import('./types').WorktreeListItem | null>(null);
  const terminalHook = useTerminal(selectedWorktree, workspace.mainWorkspace, workspace.currentWorkspace?.path);
  const actions = useWorkspaceActions(workspace, modals, terminalHook.cleanupTerminalsForPath, locks, isMobileWeb, selectedWorktree, setSelectedWorktree);
  const updater = useUpdater();
  const [wsConnected, setWsConnected] = useState(true);
  const [wasKicked, setWasKicked] = useState(false);

  useEffect(() => {
    if (isTauri() || !browserAuth.browserAuthenticated) return;
    const wsManager = getWebSocketManager();
    const unsubConn = wsManager.onConnectionStateChange(setWsConnected);
    const unsubKicked = wsManager.onKicked(() => {
      setWasKicked(true);
      clearSessionId();
      wsManager.disconnect();
    });
    return () => { unsubConn(); unsubKicked(); };
  }, [browserAuth.browserAuthenticated]);

  const voice = useVoiceInput(useCallback((text: string) => {
    const activeTab = terminalHook.activeTerminalTab;
    if (activeTab) {
      const sessionId = `pty-${activeTab.replace(/\//g, '-')}`;
      callBackend('pty_write', { sessionId, data: text });
    }
  }, [terminalHook.activeTerminalTab]));

  const voiceMountedRef = useRef(false);
  useEffect(() => {
    if (voiceMountedRef.current) {
      voice.stopVoice();
    } else {
      voiceMountedRef.current = true;
    }
  }, [actions.selectedWorktree, terminalHook.activeTerminalTab]);

  useEffect(() => { // Responsive detection
    if (isTauri()) return;
    const mql = window.matchMedia('(max-width: 639px)');
    const handler = (e: MediaQueryListEvent) => {
      setIsMobileWeb(e.matches);
      if (e.matches) setSidebarCollapsed(true);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => { // Auto-select worktree on first load
    if (!actions.hasUserSelected && !actions.selectedWorktree && workspace.worktrees.length > 0 && workspace.currentWorkspace) {
      actions.tryAutoSelect(
        workspace.worktrees,
        workspace.currentWorkspace.path,
        pendingAutoSelectWorktree,
        setPendingAutoSelectWorktree,
        isMobileWeb,
      );
    }
    if (actions.selectedWorktree) {
      const updated = workspace.worktrees.find(w => w.name === actions.selectedWorktree!.name);
      if (updated && JSON.stringify(updated) !== JSON.stringify(actions.selectedWorktree)) {
        actions.setSelectedWorktree(updated);
      }
    }
  }, [workspace.worktrees, actions.selectedWorktree, actions.hasUserSelected, workspace.currentWorkspace]);

  useEffect(() => { // Update window title
    const wsName = workspace.currentWorkspace?.name;
    let title: string;
    if (!wsName) {
      title = 'Worktree Manager';
    } else {
      const wtName = actions.selectedWorktree ? actions.selectedWorktree.name : t('app.mainWorkspace');
      title = `${wsName} - ${wtName}`;
    }
    setWindowTitle(title);
  }, [workspace.currentWorkspace?.name, actions.selectedWorktree]);

  const handleTerminalTabContextMenu = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTerminalTabMenu({ x: e.clientX, y: e.clientY, path, name });
  }, []);

  const openSettings = useCallback(() => {
    setViewMode('settings');
  }, []);

  const handleSaveConfig = useCallback(async (config: import('./types').WorkspaceConfig) => {
    try {
      await workspace.saveConfig(config);
      setViewMode('main');
    } catch (e) {
      workspace.setError(String(e));
    }
  }, [workspace]);

  useEffect(() => { // Global keyboard shortcuts
    function handleKeyDown(e: KeyboardEvent): void {
      const hasOpenDialog = document.querySelector('[role="dialog"][data-state="open"]');
      if (e.key === 'Escape') {
        if (hasOpenDialog) return;
        if (viewMode === 'settings') {
          setViewMode('main');
          return;
        }
        if (terminalFullscreen) {
          setTerminalFullscreen(false);
          return;
        }
        actions.setContextMenu(null);
        actions.setArchiveModal(null);
        modals.setModal('showEditorMenu', false);
        modals.setModal('showWorkspaceMenu', false);
        setTerminalTabMenu(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && isTauri()) {
        e.preventDefault();
        if (viewMode === 'main' && workspace.config) {
          actions.openCreateModal();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',' && isTauri()) {
        e.preventDefault();
        if (viewMode === 'main') openSettings();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        if (viewMode === 'settings') setViewMode('main');
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        if (viewMode === 'main') setSidebarCollapsed(prev => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
      }
    }
    function handleClick(): void {
      setTerminalTabMenu(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClick);
    };
  }, [viewMode, workspace.config, actions, openSettings, terminalFullscreen, modals]);

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

      {/* Settings View */}
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
            onCheckUpdate={() => updater.checkForUpdates(false)}
            checkingUpdate={updater.state === 'checking'}
            workspaces={workspace.workspaces}
            currentWorkspace={workspace.currentWorkspace}
            onRemoveWorkspace={workspace.removeWorkspace}
          />
        )}
      </div>

      {/* Main View */}
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
          onOpenSettings={openSettings}
          onOpenCreateModal={actions.openCreateModal}
          updaterState={updater.state}
          onCheckUpdate={() => updater.checkForUpdates(false)}
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
          shareWmsUrl={share.shareWmsUrl}
          wmsConnected={share.wmsConnected}
          wmsReconnecting={share.wmsReconnecting}
          wmsReconnectAttempt={share.wmsReconnectAttempt}
          wmsNextRetrySecs={share.wmsNextRetrySecs}
          wmsLoading={share.wmsLoading}
          onToggleWms={share.handleToggleWms}
          onWmsManualReconnect={share.handleWmsManualReconnect}
          connectedClients={share.connectedClients}
          onKickClient={share.handleKickClient}
          hasLastConfig={share.hasLastConfig}
          onQuickShare={share.handleQuickShare}
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
              onAddProjectToWorktree={() => modals.setModal('showAddProjectToWorktreeModal', true)}
              error={workspace.error}
              onClearError={() => workspace.setError(null)}
              onRefresh={workspace.loadData}
              onOpenTerminalPanel={terminalHook.handleTerminalTabClick}
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
          />
        </div>

        {/* Modals */}
        <CreateWorktreeModal
          open={modals.showCreateModal && !!workspace.config}
          onOpenChange={(v) => modals.setModal('showCreateModal', v)}
          config={workspace.config}
          worktreeName={actions.newWorktreeName}
          onWorktreeNameChange={actions.setNewWorktreeName}
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

      </div>

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
    </ToastProvider>
  );
}

export default App;
