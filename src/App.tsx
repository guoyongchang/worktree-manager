import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  WelcomeView,
  AddWorkspaceModal,
  CreateWorktreeModal,
  AddProjectToWorktreeModal,
  ArchiveConfirmationModal,
  CrashReportModal,
  WorktreeContextMenu,
  TerminalTabContextMenu,
  RefreshIcon,
  ToastProvider,
  GlobalDialogs,
  MobileWorktreeList,
  MobileWorktreeDetail,
  WorkspaceGrid,
  WorkspaceCell,
} from "./components";
import { useAppShellState } from "./hooks/useAppShellState";
import { Input } from "@/components/ui/input";
import { isTauri, callBackend } from "./lib/backend";
import type { CrashReport } from "./types";
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
    // DEV: Open native WebView devtools on F12 if enabled in settings
    if (e.key === 'F12') {
      const devConsoleEnabled = localStorage.getItem('dev-console-enabled') === 'true';
      if (devConsoleEnabled) {
        e.preventDefault();
        callBackend('open_devtools').catch(() => {});
      }
    }
  }, true);
} else if (typeof window !== 'undefined') {
  document.body.classList.add('browser');
}

function App() {
  const { t } = useTranslation();
  const [crashReport, setCrashReport] = useState<CrashReport | null>(null);
  // In Tauri desktop or web non-mobile, cells handle their own state.
  // App shell only needs workspace list for routing. Mobile needs full state.
  const shellMode = isTauri() || !window.matchMedia("(max-width: 639px)").matches;
  const {
    browserAuth,
    workspace,
    shareWorkspaceName,
    isMobileWeb,
    mobileView,
    setMobileView,
    showShortcutHelp,
    setShowShortcutHelp,
    terminalTabMenu,
    setTerminalTabMenu,
    modals,
    share,
    locks,
    mainOccupation,
    terminalHook,
    actions,
    updater,
    wsConnected,
    wasKicked,
    setWasKicked,
    voice,
    openSettings,
    handleTerminalTabContextMenu,
  } = useAppShellState(t, undefined, shellMode);

  useEffect(() => {
    let cancelled = false;

    callBackend<CrashReport | null>('get_crash_report')
      .then((report) => {
        if (!cancelled && report) {
          setCrashReport(report);
        }
      })
      .catch((err) => {
        console.warn('[crash-report] failed to load crash report:', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Browser mode: kicked screen
  if (!isTauri() && wasKicked) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] flex items-center justify-center">
        <div className="w-80 space-y-4 text-center">
          <div className="w-12 h-12 mx-auto bg-[var(--color-error)]/10 rounded-full flex items-center justify-center">
            <span className="text-[var(--color-error)] text-xl">!</span>
          </div>
          <h1 className="text-xl font-semibold">{t('app.kickedTitle')}</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">{t('app.kickedDesc')}</p>
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
      <div className="min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] flex items-center justify-center">
        <div className="w-80 space-y-4">
          <div className="text-center space-y-2">
            <div className="w-10 h-10 mx-auto bg-[var(--color-accent)]/20 rounded-lg flex items-center justify-center mb-3">
              <RefreshIcon className="w-5 h-5 text-[var(--color-accent)]" />
            </div>
            <h1 className="text-xl font-semibold">Worktree Manager</h1>
            {shareWorkspaceName && (
              <p className="text-sm text-[var(--color-accent)]">{t('app.loginWorkspaceName', { name: shareWorkspaceName })}</p>
            )}
            <p className="text-sm text-[var(--color-text-secondary)]">{t('app.loginPasswordLabel')}</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); browserAuth.handleBrowserLogin(); }} className="space-y-3">
            <Input
              type="password"
              placeholder={t('app.loginPasswordInput')}
              value={browserAuth.browserLoginPassword}
              onChange={(e) => browserAuth.setBrowserLoginPassword(e.target.value)}
              autoFocus
              className="bg-[var(--color-bg-surface)] border-[var(--color-border)]"
            />
            {browserAuth.browserLoginError && (
              <p className="text-sm text-[var(--color-error)]">{browserAuth.browserLoginError}</p>
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
          onCreateWorkspace={() => modals.setModal('showAddWorkspaceModal', true)}
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
          createName={actions.createWorkspaceName}
          onCreateNameChange={actions.setCreateWorkspaceName}
          createPath={actions.createWorkspacePath}
          onCreatePathChange={actions.setCreateWorkspacePath}
          onCreateSubmit={actions.handleCreateWorkspace}
          createLoading={actions.creatingWorkspace}
        />
        {crashReport && (
          <CrashReportModal
            report={crashReport}
            onClose={() => setCrashReport(null)}
          />
        )}
      </>
    );
  }

  return (
    <ToastProvider>
      <>
        {/* Loading overlay */}
        {workspace.loading && (
          <div className="fixed inset-0 z-50 bg-[var(--color-bg-base)] flex items-center justify-center">
            <div className="flex items-center gap-3">
              <RefreshIcon className="w-5 h-5 animate-spin text-[var(--color-text-secondary)]" />
              <span className="text-[var(--color-text-secondary)]">{t('common.loading')}</span>
            </div>
          </div>
        )}

        {/* Browser mode: WebSocket disconnected overlay */}
        {!isTauri() && browserAuth.browserAuthenticated && !wsConnected && (
          <div className="fixed top-0 left-0 right-0 z-40 bg-[var(--color-warning)]/10 text-[var(--color-warning)] text-xs py-1.5 px-4 text-center flex items-center justify-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse" />
            {t('app.wsDisconnected')}
          </div>
        )}

        {/* Desktop Layout */}
        {!isMobileWeb && isTauri() && workspace.currentWorkspace && (
          <WorkspaceGrid currentWorkspacePath={workspace.currentWorkspace.path} />
        )}

        {/* Web Browser Layout (single cell, no grid) */}
        {!isMobileWeb && !isTauri() && workspace.currentWorkspace && (
          <div className="h-screen">
            <WorkspaceCell
              initialWorkspacePath={workspace.currentWorkspace.path}
              closable={false}
            />
          </div>
        )}

        {/* ==================== Mobile Layout ==================== */}
        {isMobileWeb && (
          <div className="bg-[var(--color-bg-base)] text-[var(--color-text-primary)] flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
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
                  voiceWarning={voice.voiceWarning}
                  isKeyHeld={voice.isKeyHeld}
                  analyserNode={voice.analyserNode}
                  onToggleVoice={voice.toggleVoice}
                  onStopRecording={voice.stopRecording}
                  staging={voice.staging}
                />
              )}

            </div>
          </div>
        )}

        {/* Mobile-only Modals (desktop/web modals are inside WorkspaceCell) */}
        {isMobileWeb && (
          <>
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
              syncBeforeCreate={actions.syncBeforeCreate}
              onSyncBeforeCreateChange={actions.setSyncBeforeCreate}
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
                onTerminateProcess={actions.terminateArchiveLockProcess}
                onArchive={actions.handleArchiveWorktree}
                areAllIssuesConfirmed={actions.allArchiveIssuesConfirmed}
                archiving={actions.archiving}
                terminatingProcessPid={actions.terminatingArchiveLockPid}
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
        )}

        {crashReport && (
          <CrashReportModal
            report={crashReport}
            onClose={() => setCrashReport(null)}
          />
        )}
      </>
    </ToastProvider >
  );
}

export default App;
