import { useState, useEffect, useCallback } from "react";
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
  ArchiveConfirmationModal,
  WorktreeContextMenu,
  TerminalTabContextMenu,
  RefreshIcon,
  UpdateNotificationDialog,
  DownloadProgressDialog,
  UpdateSuccessDialog,
  UpdateErrorDialog,
  UpToDateToast,
} from "./components";
import { useWorkspace, useTerminal, useUpdater } from "./hooks";
import type {
  WorktreeListItem,
  ViewMode,
  EditorType,
  WorkspaceConfig,
  ProjectConfig,
  ContextMenuState,
  TerminalTabMenuState,
  ArchiveModalState,
  CreateProjectRequest,
} from "./types";
import "./index.css";

// Disable browser-like behaviors
if (typeof window !== 'undefined') {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.metaKey && e.key === 'r') || (e.ctrlKey && e.key === 'r')) {
      e.preventDefault();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
      e.preventDefault();
    }
  });
}

function App() {
  const workspace = useWorkspace();
  const [selectedWorktree, setSelectedWorktree] = useState<WorktreeListItem | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('main');

  const terminal = useTerminal(selectedWorktree, workspace.mainWorkspace);
  const updater = useUpdater();

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddWorkspaceModal, setShowAddWorkspaceModal] = useState(false);
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showEditorMenu, setShowEditorMenu] = useState(false);

  // Create modal state
  const [newWorktreeName, setNewWorktreeName] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<Map<string, string>>(new Map());
  const [creating, setCreating] = useState(false);

  // Add/Create workspace modal state
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspacePath, setNewWorkspacePath] = useState("");
  const [createWorkspaceName, setCreateWorkspaceName] = useState("");
  const [createWorkspacePath, setCreateWorkspacePath] = useState("");

  // Add project state
  const [cloningProject, setCloningProject] = useState(false);

  // Context menu states
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [terminalTabMenu, setTerminalTabMenu] = useState<TerminalTabMenuState | null>(null);

  // Archive modal state
  const [archiveModal, setArchiveModal] = useState<ArchiveModalState | null>(null);

  // Settings state
  const [editingConfig, setEditingConfig] = useState<WorkspaceConfig | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor selection
  const [selectedEditor, setSelectedEditor] = useState<EditorType>('vscode');

  // Track if user has manually selected (including main workspace)
  const [hasUserSelected, setHasUserSelected] = useState(false);

  // Set initial selected worktree when data loads (only on first load)
  useEffect(() => {
    if (!hasUserSelected && !selectedWorktree && workspace.worktrees.length > 0) {
      const activeWorktree = workspace.worktrees.find(w => !w.is_archived);
      if (activeWorktree) {
        setSelectedWorktree(activeWorktree);
      }
    }
  }, [workspace.worktrees, selectedWorktree, hasUserSelected]);

  // Wrap setSelectedWorktree to track user selection
  const handleSelectWorktree = useCallback((worktree: WorktreeListItem | null) => {
    setHasUserSelected(true);
    setSelectedWorktree(worktree);
  }, []);

  // Reset terminal active tab when worktree changes
  useEffect(() => {
    terminal.resetActiveTab();
  }, [selectedWorktree?.path]);

  // Workspace handlers
  const handleSwitchWorkspace = useCallback(async (path: string) => {
    await workspace.switchWorkspace(path);
    setShowWorkspaceMenu(false);
    setSelectedWorktree(null);
    setHasUserSelected(false); // Reset so auto-selection works on new workspace
  }, [workspace]);

  const handleAddWorkspace = useCallback(async () => {
    if (!newWorkspaceName.trim() || !newWorkspacePath.trim()) return;
    await workspace.addWorkspace(newWorkspaceName.trim(), newWorkspacePath.trim());
    setShowAddWorkspaceModal(false);
    setNewWorkspaceName("");
    setNewWorkspacePath("");
  }, [workspace, newWorkspaceName, newWorkspacePath]);

  const handleCreateWorkspace = useCallback(async () => {
    if (!createWorkspaceName.trim() || !createWorkspacePath.trim()) return;
    const fullPath = `${createWorkspacePath.trim()}/${createWorkspaceName.trim()}`;
    await workspace.createWorkspace(createWorkspaceName.trim(), fullPath);
    setShowCreateWorkspaceModal(false);
    setCreateWorkspaceName("");
    setCreateWorkspacePath("");
  }, [workspace, createWorkspaceName, createWorkspacePath]);

  // Create worktree handlers
  const openCreateModal = useCallback(() => {
    setNewWorktreeName("");
    setSelectedProjects(new Map());
    setShowCreateModal(true);
  }, []);

  const toggleProjectSelection = useCallback((name: string, baseBranch: string) => {
    setSelectedProjects(prev => {
      const next = new Map(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.set(name, baseBranch);
      }
      return next;
    });
  }, []);

  const updateProjectBaseBranch = useCallback((name: string, baseBranch: string) => {
    setSelectedProjects(prev => {
      const next = new Map(prev);
      next.set(name, baseBranch);
      return next;
    });
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    if (!newWorktreeName.trim() || selectedProjects.size === 0) return;

    setCreating(true);
    try {
      const projects: CreateProjectRequest[] = Array.from(selectedProjects.entries()).map(
        ([name, base_branch]) => ({ name, base_branch })
      );
      await workspace.createWorktree(newWorktreeName.trim(), projects);
      setShowCreateModal(false);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [workspace, newWorktreeName, selectedProjects]);

  // Add project handlers
  const handleAddProject = useCallback(async (project: {
    name: string;
    repo_url: string;
    base_branch: string;
    test_branch: string;
    merge_strategy: string;
    linked_folders: string[];
  }) => {
    setCloningProject(true);
    try {
      await workspace.cloneProject(project);
      setShowAddProjectModal(false);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setCloningProject(false);
    }
  }, [workspace]);

  // Archive handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, worktree: WorktreeListItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, worktree });
  }, []);

  const openArchiveModal = useCallback(async (worktree: WorktreeListItem) => {
    setContextMenu(null);
    setArchiveModal({ worktree, status: null, loading: true, confirmedIssues: new Set() });

    try {
      const status = await workspace.checkWorktreeStatus(worktree.name);
      setArchiveModal({ worktree, status, loading: false, confirmedIssues: new Set() });
    } catch (e) {
      workspace.setError(String(e));
      setArchiveModal(null);
    }
  }, [workspace]);

  const confirmArchiveIssue = useCallback((issueKey: string) => {
    if (!archiveModal) return;
    const newConfirmed = new Set(archiveModal.confirmedIssues);
    newConfirmed.add(issueKey);
    setArchiveModal({ ...archiveModal, confirmedIssues: newConfirmed });
  }, [archiveModal]);

  const areAllIssuesConfirmed = useCallback((): boolean => {
    if (!archiveModal?.status) return false;
    const { projects } = archiveModal.status;
    const allIssueKeys: string[] = [];

    projects.forEach((proj) => {
      if (proj.has_uncommitted && proj.uncommitted_count > 0) {
        allIssueKeys.push(`proj-uncommitted-${proj.project_name}`);
      }
      if (proj.unpushed_commits > 0) {
        allIssueKeys.push(`proj-unpushed-${proj.project_name}`);
      }
    });

    if (allIssueKeys.length === 0) return true;
    return allIssueKeys.every(key => archiveModal.confirmedIssues.has(key));
  }, [archiveModal]);

  const handleArchiveWorktree = useCallback(async () => {
    if (!archiveModal) return;
    try {
      await workspace.archiveWorktree(archiveModal.worktree.name);
      if (selectedWorktree?.name === archiveModal.worktree.name) {
        setSelectedWorktree(null);
      }
      setArchiveModal(null);
    } catch (e) {
      workspace.setError(String(e));
    }
  }, [workspace, archiveModal, selectedWorktree]);

  // Terminal tab context menu
  const handleTerminalTabContextMenu = useCallback((e: React.MouseEvent, path: string, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTerminalTabMenu({ x: e.clientX, y: e.clientY, path, name });
  }, []);

  // Settings handlers
  const openSettings = useCallback(() => {
    setEditingConfig(workspace.config ? JSON.parse(JSON.stringify(workspace.config)) : null);
    setViewMode('settings');
  }, [workspace.config]);

  const handleSaveConfig = useCallback(async () => {
    if (!editingConfig) return;
    setSaving(true);
    try {
      await workspace.saveConfig(editingConfig);
      setViewMode('main');
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [workspace, editingConfig]);

  const updateEditingConfigField = useCallback((field: 'name' | 'worktrees_dir', value: string) => {
    if (!editingConfig) return;
    setEditingConfig({ ...editingConfig, [field]: value });
  }, [editingConfig]);

  const updateEditingProject = useCallback((index: number, field: keyof ProjectConfig, value: string | boolean) => {
    if (!editingConfig) return;
    const newProjects = [...editingConfig.projects];
    newProjects[index] = { ...newProjects[index], [field]: value };
    setEditingConfig({ ...editingConfig, projects: newProjects });
  }, [editingConfig]);

  const addNewProject = useCallback(() => {
    if (!editingConfig) return;
    setEditingConfig({
      ...editingConfig,
      projects: [
        ...editingConfig.projects,
        { name: "", base_branch: "uat", test_branch: "test", merge_strategy: "merge", linked_folders: [] }
      ]
    });
  }, [editingConfig]);

  const removeProject = useCallback((index: number) => {
    if (!editingConfig) return;
    const newProjects = editingConfig.projects.filter((_, i) => i !== index);
    setEditingConfig({ ...editingConfig, projects: newProjects });
  }, [editingConfig]);

  const addLinkedItem = useCallback((item: string) => {
    if (!editingConfig) return;
    setEditingConfig({
      ...editingConfig,
      linked_workspace_items: [...editingConfig.linked_workspace_items, item]
    });
  }, [editingConfig]);

  const removeLinkedItem = useCallback((index: number) => {
    if (!editingConfig) return;
    const newItems = editingConfig.linked_workspace_items.filter((_, i) => i !== index);
    setEditingConfig({ ...editingConfig, linked_workspace_items: newItems });
  }, [editingConfig]);

  // Editor handlers
  const handleOpenInEditor = useCallback((path: string, editor?: EditorType) => {
    workspace.openInEditor(path, editor || selectedEditor);
  }, [workspace, selectedEditor]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setArchiveModal(null);
        setShowEditorMenu(false);
        setShowWorkspaceMenu(false);
        setTerminalTabMenu(null);
      }
      // Cmd/Ctrl+N: Open create worktree modal
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        if (viewMode === 'main' && workspace.config) {
          openCreateModal();
        }
      }
      // Cmd/Ctrl+,: Open settings
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        if (viewMode === 'main') {
          openSettings();
        }
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
  }, [viewMode, workspace.config, openCreateModal, openSettings]);

  // Loading state
  if (workspace.loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <RefreshIcon className="w-5 h-5 animate-spin text-slate-400" />
          <span className="text-slate-400">加载中...</span>
        </div>
      </div>
    );
  }

  // No workspace - show welcome view
  if (workspace.workspaces.length === 0) {
    return (
      <>
        <WelcomeView
          onAddWorkspace={() => setShowAddWorkspaceModal(true)}
          onCreateWorkspace={() => setShowCreateWorkspaceModal(true)}
        />
        <AddWorkspaceModal
          open={showAddWorkspaceModal}
          onOpenChange={setShowAddWorkspaceModal}
          name={newWorkspaceName}
          onNameChange={setNewWorkspaceName}
          path={newWorkspacePath}
          onPathChange={setNewWorkspacePath}
          onSubmit={handleAddWorkspace}
        />
        <CreateWorkspaceModal
          open={showCreateWorkspaceModal}
          onOpenChange={setShowCreateWorkspaceModal}
          name={createWorkspaceName}
          onNameChange={setCreateWorkspaceName}
          path={createWorkspacePath}
          onPathChange={setCreateWorkspacePath}
          onSubmit={handleCreateWorkspace}
        />
      </>
    );
  }

  return (
    <>
      {/* Settings View */}
      <div
        className="min-h-screen bg-slate-900 text-slate-100 p-6 overflow-y-auto"
        style={{ display: viewMode === 'settings' && editingConfig ? 'block' : 'none' }}
      >
        {editingConfig && (
          <SettingsView
            config={editingConfig}
            configPath={workspace.configPath}
            error={workspace.error}
            saving={saving}
            onBack={() => setViewMode('main')}
            onSave={handleSaveConfig}
            onUpdateField={updateEditingConfigField}
            onUpdateProject={updateEditingProject}
            onAddProject={addNewProject}
            onRemoveProject={removeProject}
            onAddLinkedItem={addLinkedItem}
            onRemoveLinkedItem={removeLinkedItem}
            onClearError={() => workspace.setError(null)}
            onCheckUpdate={() => updater.checkForUpdates(false)}
            checkingUpdate={updater.state === 'checking'}
          />
        )}
      </div>

      {/* Main View */}
      <div
        className="min-h-screen bg-slate-900 text-slate-100 flex"
        style={{ display: viewMode === 'main' ? 'flex' : 'none' }}
      >
        <WorktreeSidebar
          workspaces={workspace.workspaces}
          currentWorkspace={workspace.currentWorkspace}
          showWorkspaceMenu={showWorkspaceMenu}
          onShowWorkspaceMenu={setShowWorkspaceMenu}
          onSwitchWorkspace={handleSwitchWorkspace}
          onRemoveWorkspace={workspace.removeWorkspace}
          onAddWorkspace={() => { setShowWorkspaceMenu(false); setShowAddWorkspaceModal(true); }}
          mainWorkspace={workspace.mainWorkspace}
          worktrees={workspace.worktrees}
          selectedWorktree={selectedWorktree}
          onSelectWorktree={handleSelectWorktree}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived(prev => !prev)}
          onContextMenu={handleContextMenu}
          onRefresh={workspace.loadData}
          onOpenSettings={openSettings}
          onOpenCreateModal={openCreateModal}
        />

        <div className="flex-1 flex flex-col bg-slate-900">
          <div className="flex-1 p-6 overflow-y-auto min-h-0">
            <WorktreeDetail
              selectedWorktree={selectedWorktree}
              mainWorkspace={workspace.mainWorkspace}
              selectedEditor={selectedEditor}
              showEditorMenu={showEditorMenu}
              onShowEditorMenu={setShowEditorMenu}
              onSelectEditor={setSelectedEditor}
              onOpenInEditor={handleOpenInEditor}
              onOpenInTerminal={workspace.openInTerminal}
              onSwitchBranch={workspace.switchBranch}
              onArchive={() => selectedWorktree && openArchiveModal(selectedWorktree)}
              onRestore={() => selectedWorktree && workspace.restoreWorktree(selectedWorktree.name)}
              onAddProject={() => setShowAddProjectModal(true)}
              error={workspace.error}
              onClearError={() => workspace.setError(null)}
            />
          </div>

          <TerminalPanel
            visible={terminal.terminalVisible}
            height={terminal.terminalHeight}
            onStartResize={() => terminal.setIsResizing(true)}
            terminalTabs={terminal.terminalTabs}
            activatedTerminals={terminal.activatedTerminals}
            activeTerminalTab={terminal.activeTerminalTab}
            onTabClick={terminal.handleTerminalTabClick}
            onTabContextMenu={handleTerminalTabContextMenu}
            onCloseTab={terminal.handleCloseTerminalTab}
            onToggle={terminal.handleToggleTerminal}
            onCollapse={() => terminal.setTerminalVisible(false)}
          />
        </div>

        {/* Modals */}
        <CreateWorktreeModal
          open={showCreateModal && !!workspace.config}
          onOpenChange={setShowCreateModal}
          config={workspace.config}
          worktreeName={newWorktreeName}
          onWorktreeNameChange={setNewWorktreeName}
          selectedProjects={selectedProjects}
          onToggleProject={toggleProjectSelection}
          onUpdateBaseBranch={updateProjectBaseBranch}
          onSubmit={handleCreateWorktree}
          creating={creating}
        />

        <AddWorkspaceModal
          open={showAddWorkspaceModal}
          onOpenChange={setShowAddWorkspaceModal}
          name={newWorkspaceName}
          onNameChange={setNewWorkspaceName}
          path={newWorkspacePath}
          onPathChange={setNewWorkspacePath}
          onSubmit={handleAddWorkspace}
        />

        <AddProjectModal
          open={showAddProjectModal}
          onOpenChange={setShowAddProjectModal}
          onSubmit={handleAddProject}
          loading={cloningProject}
        />

        {/* Context Menus */}
        {contextMenu && (
          <WorktreeContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onArchive={() => openArchiveModal(contextMenu.worktree)}
          />
        )}

        {terminalTabMenu && (
          <TerminalTabContextMenu
            x={terminalTabMenu.x}
            y={terminalTabMenu.y}
            onClose={() => setTerminalTabMenu(null)}
            onDuplicate={() => {
              terminal.handleDuplicateTerminal(terminalTabMenu.path);
              setTerminalTabMenu(null);
            }}
          />
        )}

        {/* Archive Confirmation Modal */}
        {archiveModal && (
          <ArchiveConfirmationModal
            archiveModal={archiveModal}
            onClose={() => setArchiveModal(null)}
            onConfirmIssue={confirmArchiveIssue}
            onArchive={handleArchiveWorktree}
            areAllIssuesConfirmed={areAllIssuesConfirmed()}
          />
        )}
      </div>

      {/* Updater Dialogs */}
      {updater.updateInfo && (
        <UpdateNotificationDialog
          open={updater.state === 'notification'}
          onOpenChange={(open) => !open && updater.dismiss()}
          updateInfo={updater.updateInfo}
          onUpdate={updater.startDownload}
          onLater={updater.dismiss}
        />
      )}

      <DownloadProgressDialog
        open={updater.state === 'downloading'}
        onOpenChange={() => {}}
        progress={updater.downloadProgress}
        onCancel={updater.dismiss}
      />

      {updater.updateInfo && (
        <UpdateSuccessDialog
          open={updater.state === 'success'}
          onOpenChange={(open) => !open && updater.dismiss()}
          version={updater.updateInfo.version}
          onRestart={updater.restartApp}
          onLater={updater.dismiss}
        />
      )}

      <UpdateErrorDialog
        open={updater.state === 'error'}
        onOpenChange={(open) => !open && updater.dismiss()}
        error={updater.errorMessage}
        onRetry={updater.retry}
        onClose={updater.dismiss}
      />

      <UpToDateToast show={updater.showUpToDateToast} />
    </>
  );
}

export default App;
