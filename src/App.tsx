import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  ScannedFolder,
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
  const [showAddProjectToWorktreeModal, setShowAddProjectToWorktreeModal] = useState(false);
  const [addingProjectToWorktree, setAddingProjectToWorktree] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showEditorMenu, setShowEditorMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Loading states for async operations
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deletingArchived, setDeletingArchived] = useState(false);
  const [restoringWorktree, setRestoringWorktree] = useState(false);

  // Terminal fullscreen state
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);

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

  // Delete archived worktree confirmation
  const [deleteConfirmWorktree, setDeleteConfirmWorktree] = useState<WorktreeListItem | null>(null);

  // Settings state
  const [editingConfig, setEditingConfig] = useState<WorkspaceConfig | null>(null);
  const [saving, setSaving] = useState(false);

  // Editor selection
  const [selectedEditor, setSelectedEditor] = useState<EditorType>('vscode');

  // Track if user has manually selected (including main workspace)
  const [hasUserSelected, setHasUserSelected] = useState(false);

  // Scan state (for SettingsView)
  const [scanningProject, setScanningProject] = useState<string | null>(null);
  const [settingsScanResults, setSettingsScanResults] = useState<ScannedFolder[]>([]);

  // Worktree lock state (for multi-window)
  const [lockedWorktrees, setLockedWorktrees] = useState<Record<string, string>>({});

  // Refresh worktree locks periodically
  const refreshLockedWorktrees = useCallback(async () => {
    if (!workspace.currentWorkspace) return;
    try {
      const locks = await workspace.getLockedWorktrees(workspace.currentWorkspace.path);
      setLockedWorktrees(locks);
    } catch {
      // ignore
    }
  }, [workspace]);

  useEffect(() => {
    refreshLockedWorktrees();
    const interval = setInterval(refreshLockedWorktrees, 2000);
    return () => clearInterval(interval);
  }, [refreshLockedWorktrees]);

  // Set initial selected worktree when data loads (only on first load)
  useEffect(() => {
    if (!hasUserSelected && !selectedWorktree && workspace.worktrees.length > 0 && workspace.currentWorkspace) {
      const wsPath = workspace.currentWorkspace.path;
      // Find first active worktree that is not locked by another window
      const tryAutoSelect = async () => {
        const locks: Record<string, string> = await workspace.getLockedWorktrees(wsPath).catch(() => ({} as Record<string, string>));
        const windowLabel = (await import('@tauri-apps/api/window')).getCurrentWindow().label;
        const activeWorktree = workspace.worktrees.find(w => {
          if (w.is_archived) return false;
          const lockedBy = locks[w.name];
          return !lockedBy || lockedBy === windowLabel;
        });
        if (activeWorktree) {
          try {
            await workspace.lockWorktree(wsPath, activeWorktree.name);
            setSelectedWorktree(activeWorktree);
          } catch {
            // If lock fails, still select main workspace (null)
            setSelectedWorktree(null);
          }
        }
      };
      tryAutoSelect();
    }
    // Also update the selected worktree data when worktrees refresh
    if (selectedWorktree) {
      const updated = workspace.worktrees.find(w => w.name === selectedWorktree.name);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedWorktree)) {
        setSelectedWorktree(updated);
      }
    }
  }, [workspace.worktrees, selectedWorktree, hasUserSelected, workspace.currentWorkspace]);

  // Wrap setSelectedWorktree to track user selection and lock worktree
  const handleSelectWorktree = useCallback(async (worktree: WorktreeListItem | null) => {
    const wsPath = workspace.currentWorkspace?.path;
    if (!wsPath) return;

    // Unlock previous worktree
    if (selectedWorktree) {
      try {
        await workspace.unlockWorktree(wsPath, selectedWorktree.name);
      } catch {
        // ignore unlock errors
      }
    }

    // Lock new worktree
    if (worktree) {
      try {
        await workspace.lockWorktree(wsPath, worktree.name);
      } catch (e) {
        workspace.setError(String(e));
        return; // Don't select if lock fails
      }
    }

    setHasUserSelected(true);
    setSelectedWorktree(worktree);
    refreshLockedWorktrees();
  }, [workspace, selectedWorktree, refreshLockedWorktrees]);

  // Reset terminal active tab when worktree changes
  useEffect(() => {
    terminal.resetActiveTab();
  }, [selectedWorktree?.path]);

  // Workspace handlers
  const handleSwitchWorkspace = useCallback(async (path: string) => {
    setSwitchingWorkspace(true);
    try {
      await workspace.switchWorkspace(path);
      setShowWorkspaceMenu(false);
      setSelectedWorktree(null);
      setHasUserSelected(false);
    } finally {
      setSwitchingWorkspace(false);
    }
  }, [workspace]);

  const handleAddWorkspace = useCallback(async () => {
    if (!newWorkspaceName.trim() || !newWorkspacePath.trim()) return;
    setAddingWorkspace(true);
    try {
      await workspace.addWorkspace(newWorkspaceName.trim(), newWorkspacePath.trim());
      setShowAddWorkspaceModal(false);
      setNewWorkspaceName("");
      setNewWorkspacePath("");
    } finally {
      setAddingWorkspace(false);
    }
  }, [workspace, newWorkspaceName, newWorkspacePath]);

  const handleCreateWorkspace = useCallback(async () => {
    if (!createWorkspaceName.trim() || !createWorkspacePath.trim()) return;
    setCreatingWorkspace(true);
    try {
      const fullPath = `${createWorkspacePath.trim()}/${createWorkspaceName.trim()}`;
      await workspace.createWorkspace(createWorkspaceName.trim(), fullPath);
      setShowCreateWorkspaceModal(false);
      setCreateWorkspaceName("");
      setCreateWorkspacePath("");
    } finally {
      setCreatingWorkspace(false);
    }
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
      // Don't close modal here — let AddProjectModal handle the scan phase
    } catch (e) {
      workspace.setError(String(e));
      throw e; // Re-throw so AddProjectModal knows clone failed
    } finally {
      setCloningProject(false);
    }
  }, [workspace]);

  // Update linked folders for a project (used after scanning)
  const handleUpdateLinkedFolders = useCallback(async (projectName: string, folders: string[]) => {
    if (!editingConfig && workspace.config) {
      // Direct update from AddProjectModal
      const updatedConfig = JSON.parse(JSON.stringify(workspace.config)) as WorkspaceConfig;
      const project = updatedConfig.projects.find(p => p.name === projectName);
      if (project) {
        project.linked_folders = folders;
        await workspace.saveConfig(updatedConfig);
      }
    } else if (editingConfig) {
      // From SettingsView context
      const project = editingConfig.projects.find(p => p.name === projectName);
      if (project) {
        project.linked_folders = folders;
        setEditingConfig({ ...editingConfig });
        await workspace.saveConfig(editingConfig);
      }
    }
  }, [workspace, editingConfig]);

  // Add project to existing worktree handler
  const handleAddProjectToWorktree = useCallback(async (projectName: string, baseBranch: string) => {
    if (!selectedWorktree) return;
    setAddingProjectToWorktree(true);
    try {
      await workspace.addProjectToWorktree({
        worktree_name: selectedWorktree.name,
        project_name: projectName,
        base_branch: baseBranch,
      });
      setShowAddProjectToWorktreeModal(false);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setAddingProjectToWorktree(false);
    }
  }, [workspace, selectedWorktree]);

  // Scan project folders (for SettingsView)
  const handleScanProject = useCallback(async (projectName: string) => {
    if (!workspace.currentWorkspace) return;
    setScanningProject(projectName);
    setSettingsScanResults([]);
    try {
      const projectPath = `${workspace.currentWorkspace.path}/projects/${projectName}`;
      const results = await workspace.scanLinkedFolders(projectPath);
      setSettingsScanResults(results);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setScanningProject(null);
    }
  }, [workspace]);

  // Open workspace in new window
  const handleOpenInNewWindow = useCallback(async (workspacePath: string) => {
    try {
      await workspace.openWorkspaceInNewWindow(workspacePath);
    } catch (e) {
      workspace.setError(String(e));
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
    setArchiving(true);
    try {
      await workspace.archiveWorktree(archiveModal.worktree.name);
      if (selectedWorktree?.name === archiveModal.worktree.name) {
        setSelectedWorktree(null);
      }
      setArchiveModal(null);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setArchiving(false);
    }
  }, [workspace, archiveModal, selectedWorktree]);

  const handleDeleteArchivedWorktree = useCallback(async () => {
    if (!deleteConfirmWorktree) return;
    setDeletingArchived(true);
    try {
      await workspace.deleteArchivedWorktree(deleteConfirmWorktree.name);
      if (selectedWorktree?.name === deleteConfirmWorktree.name) {
        setSelectedWorktree(null);
      }
      setDeleteConfirmWorktree(null);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setDeletingArchived(false);
    }
  }, [workspace, deleteConfirmWorktree, selectedWorktree]);

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

  const updateEditingProject = useCallback((index: number, field: keyof ProjectConfig, value: string | boolean | string[]) => {
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
        if (terminalFullscreen) {
          setTerminalFullscreen(false);
          return;
        }
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
      // Cmd/Ctrl+B: Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        if (viewMode === 'main') {
          setSidebarCollapsed(prev => !prev);
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
  }, [viewMode, workspace.config, openCreateModal, openSettings, terminalFullscreen]);

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
          loading={addingWorkspace}
        />
        <CreateWorkspaceModal
          open={showCreateWorkspaceModal}
          onOpenChange={setShowCreateWorkspaceModal}
          name={createWorkspaceName}
          onNameChange={setCreateWorkspaceName}
          path={createWorkspacePath}
          onPathChange={setCreateWorkspacePath}
          onSubmit={handleCreateWorkspace}
          loading={creatingWorkspace}
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
            onScanProject={handleScanProject}
            scanningProject={scanningProject}
            scanResults={settingsScanResults}
            workspaces={workspace.workspaces}
            currentWorkspace={workspace.currentWorkspace}
            onRemoveWorkspace={workspace.removeWorkspace}
          />
        )}
      </div>

      {/* Main View */}
      <div
        className="min-h-screen bg-slate-900 text-slate-100 flex"
        style={{ display: viewMode === 'main' ? 'flex' : 'none' }}
      >
        {!terminalFullscreen && (
          <WorktreeSidebar
          workspaces={workspace.workspaces}
          currentWorkspace={workspace.currentWorkspace}
          showWorkspaceMenu={showWorkspaceMenu}
          onShowWorkspaceMenu={setShowWorkspaceMenu}
          onSwitchWorkspace={handleSwitchWorkspace}
          onAddWorkspace={() => setShowAddWorkspaceModal(true)}
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
          updaterState={updater.state}
          onCheckUpdate={() => updater.checkForUpdates(false)}
          onOpenInNewWindow={handleOpenInNewWindow}
          lockedWorktrees={lockedWorktrees}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(prev => !prev)}
          switchingWorkspace={switchingWorkspace}
        />
        )}

        <div className="flex-1 flex flex-col bg-slate-900">
          {!terminalFullscreen && (
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
              onRevealInFinder={workspace.revealInFinder}
              onSwitchBranch={workspace.switchBranch}
              onArchive={() => selectedWorktree && openArchiveModal(selectedWorktree)}
              onRestore={async () => {
                if (!selectedWorktree) return;
                setRestoringWorktree(true);
                try {
                  await workspace.restoreWorktree(selectedWorktree.name);
                } catch (e) {
                  workspace.setError(String(e));
                } finally {
                  setRestoringWorktree(false);
                }
              }}
              restoring={restoringWorktree}
              onDelete={selectedWorktree?.is_archived ? () => setDeleteConfirmWorktree(selectedWorktree) : undefined}
              onAddProject={() => setShowAddProjectModal(true)}
              onAddProjectToWorktree={() => setShowAddProjectToWorktreeModal(true)}
              error={workspace.error}
              onClearError={() => workspace.setError(null)}
            />
          </div>
          )}

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
            isFullscreen={terminalFullscreen}
            onToggleFullscreen={() => {
              const next = !terminalFullscreen;
              setTerminalFullscreen(next);
              if (next && !terminal.terminalVisible) {
                terminal.handleToggleTerminal();
              }
            }}
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
          loading={addingWorkspace}
        />

        <AddProjectModal
          open={showAddProjectModal}
          onOpenChange={setShowAddProjectModal}
          onSubmit={handleAddProject}
          loading={cloningProject}
          scanLinkedFolders={workspace.scanLinkedFolders}
          workspacePath={workspace.currentWorkspace?.path}
          onUpdateLinkedFolders={handleUpdateLinkedFolders}
        />

        <AddProjectToWorktreeModal
          open={showAddProjectToWorktreeModal}
          onOpenChange={setShowAddProjectToWorktreeModal}
          config={workspace.config}
          worktree={selectedWorktree}
          onSubmit={handleAddProjectToWorktree}
          adding={addingProjectToWorktree}
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
            archiving={archiving}
          />
        )}

        {/* Delete Archived Worktree Confirmation */}
        <Dialog open={!!deleteConfirmWorktree} onOpenChange={(open) => !open && setDeleteConfirmWorktree(null)}>
          <DialogContent className="max-w-[400px]">
            <DialogHeader>
              <DialogTitle>删除归档 Worktree</DialogTitle>
              <DialogDescription>
                确定要永久删除归档 "{deleteConfirmWorktree?.name}" 吗？此操作将同时删除关联的本地分支和所有文件，且无法恢复。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeleteConfirmWorktree(null)}>
                取消
              </Button>
              <Button variant="destructive" onClick={handleDeleteArchivedWorktree} disabled={deletingArchived}>
                {deletingArchived ? "删除中..." : "确认删除"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
