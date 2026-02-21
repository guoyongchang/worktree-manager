import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
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
  ToastProvider,
} from "./components";
import { useWorkspace, useTerminal, useUpdater, useShareFeature, useBrowserAuth, useWorktreeLocks, useModals } from "./hooks";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { Input } from "@/components/ui/input";
import { callBackend, getWindowLabel, isTauri, setWindowTitle, getShareInfo } from "./lib/backend";
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

// Disable browser-like behaviors (only in Tauri desktop mode)
if (typeof window !== 'undefined' && isTauri()) {
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
  const { t } = useTranslation();
  // Browser auth (declared early so useWorkspace can depend on it)
  const browserAuth = useBrowserAuth();

  const workspace = useWorkspace(browserAuth.browserAuthenticated);

  // Browser: after authentication, bind to the shared workspace THEN load data
  useEffect(() => {
    if (!isTauri() && browserAuth.browserAuthenticated) {
      getShareInfo().then(async (info) => {
        await callBackend('set_window_workspace', { workspacePath: info.workspace_path });
        await workspace.loadWorkspaces();
        await workspace.loadData();
      }).catch(() => {});
    }
  }, [browserAuth.browserAuthenticated]);

  const [selectedWorktree, setSelectedWorktree] = useState<WorktreeListItem | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('main');

  const terminal = useTerminal(selectedWorktree, workspace.mainWorkspace, workspace.currentWorkspace?.path);
  const updater = useUpdater();

  // Voice input: transcribed text is written to the active terminal
  const voice = useVoiceInput(useCallback((text: string) => {
    const activeTab = terminal.activeTerminalTab;
    if (activeTab) {
      const sessionId = `pty-${activeTab.replace(/\//g, '-')}`;
      callBackend('pty_write', { sessionId, data: text });
    }
  }, [terminal.activeTerminalTab]));

  // Auto-close voice input when switching worktree or terminal tab
  const voiceMountedRef = useRef(false);
  useEffect(() => {
    if (voiceMountedRef.current) {
      voice.stopVoice();
    } else {
      voiceMountedRef.current = true;
    }
  }, [selectedWorktree, terminal.activeTerminalTab]);

  // Custom hooks for extracted state
  const modals = useModals();
  const share = useShareFeature(workspace.setError);
  const locks = useWorktreeLocks(workspace.currentWorkspace?.path, workspace.getLockedWorktrees);

  // Non-modal UI states that remain in App
  const [addingProjectToWorktree, setAddingProjectToWorktree] = useState(false);
  const isMobileWeb = !isTauri() && window.innerWidth < 640;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobileWeb);

  // Loading states for async operations
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [switchingWorktree, setSwitchingWorktree] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deletingArchived, setDeletingArchived] = useState(false);
  const [restoringWorktree, setRestoringWorktree] = useState(false);

  // Terminal fullscreen state
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);

  // Shortcut help dialog
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

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

  // Scan state (for SettingsView) — per-project scan results
  const [scanningProject, setScanningProject] = useState<string | null>(null);
  const [scanResultsMap, setScanResultsMap] = useState<Record<string, ScannedFolder[]>>({});

  // Set initial selected worktree when data loads (only on first load)
  useEffect(() => {
    if (!hasUserSelected && !selectedWorktree && workspace.worktrees.length > 0 && workspace.currentWorkspace) {
      const wsPath = workspace.currentWorkspace.path;
      // Find first active worktree that is not locked by another window
      const tryAutoSelect = async () => {
        const t0 = performance.now();
        // 网页端：不自动选择和锁定，等待用户手动选择
        if (!isTauri()) {
          return;
        }

        // 桌面端：自动选择第一个未被锁定的工作区
        // Run both IPC calls in parallel
        const [lockedMap, windowLabel] = await Promise.all([
          workspace.getLockedWorktrees(wsPath).catch(() => ({} as Record<string, string>)),
          getWindowLabel(),
        ]);
        const activeWorktree = workspace.worktrees.find(w => {
          if (w.is_archived) return false;
          const lockedBy = lockedMap[w.name];
          return !lockedBy || lockedBy === windowLabel;
        });
        if (activeWorktree) {
          try {
            await workspace.lockWorktree(wsPath, activeWorktree.name);
            setSelectedWorktree(activeWorktree);
            console.log(`[app] autoSelect "${activeWorktree.name}": ${(performance.now() - t0).toFixed(1)}ms`);
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

    setSwitchingWorktree(true);
    try {
      // 网页端：直接查看，不需要锁定（因为已经被桌面端锁定了）
      if (!isTauri()) {
        setHasUserSelected(true);
        setSelectedWorktree(worktree);
        // 移动端选中后自动收起侧边栏
        if (window.innerWidth < 640) {
          setSidebarCollapsed(true);
        }
        return;
      }

      // 桌面端：需要锁定/解锁逻辑
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
      locks.refreshLockedWorktrees();
    } finally {
      setSwitchingWorktree(false);
    }
  }, [workspace, selectedWorktree, locks.refreshLockedWorktrees]);

  // Update window title based on workspace and worktree
  useEffect(() => {
    const wsName = workspace.currentWorkspace?.name;
    let title: string;
    if (!wsName) {
      title = 'Worktree Manager';
    } else {
      const wtName = selectedWorktree ? selectedWorktree.name : t('app.mainWorkspace');
      title = `${wsName} - ${wtName}`;
    }
    setWindowTitle(title);
  }, [workspace.currentWorkspace?.name, selectedWorktree]);

  // Workspace handlers
  const handleSwitchWorkspace = useCallback(async (path: string) => {
    const t0 = performance.now();
    console.log(`[app] handleSwitchWorkspace → ${path}`);
    // Clear UI state immediately — don't wait for unlock
    modals.setModal('showWorkspaceMenu', false);
    setSelectedWorktree(null);
    setHasUserSelected(false);
    setSwitchingWorkspace(true);
    // Fire-and-forget unlock (don't block the switch)
    if (selectedWorktree && workspace.currentWorkspace) {
      workspace.unlockWorktree(workspace.currentWorkspace.path, selectedWorktree.name).catch(() => {});
    }
    try {
      await workspace.switchWorkspace(path);
    } finally {
      setSwitchingWorkspace(false);
      console.log(`[app] handleSwitchWorkspace done: ${(performance.now() - t0).toFixed(1)}ms`);
    }
  }, [workspace, selectedWorktree, modals]);

  const handleAddWorkspace = useCallback(async () => {
    if (!newWorkspaceName.trim() || !newWorkspacePath.trim()) return;
    setAddingWorkspace(true);
    try {
      await workspace.addWorkspace(newWorkspaceName.trim(), newWorkspacePath.trim());
      modals.setModal('showAddWorkspaceModal', false);
      setNewWorkspaceName("");
      setNewWorkspacePath("");
    } finally {
      setAddingWorkspace(false);
    }
  }, [workspace, newWorkspaceName, newWorkspacePath, modals]);

  const handleCreateWorkspace = useCallback(async () => {
    if (!createWorkspaceName.trim() || !createWorkspacePath.trim()) return;
    setCreatingWorkspace(true);
    try {
      const fullPath = `${createWorkspacePath.trim()}/${createWorkspaceName.trim()}`;
      await workspace.createWorkspace(createWorkspaceName.trim(), fullPath);
      modals.setModal('showCreateWorkspaceModal', false);
      setCreateWorkspaceName("");
      setCreateWorkspacePath("");
    } finally {
      setCreatingWorkspace(false);
    }
  }, [workspace, createWorkspaceName, createWorkspacePath, modals]);

  // Create worktree handlers
  const openCreateModal = useCallback(() => {
    setNewWorktreeName("");
    setSelectedProjects(new Map());
    modals.setModal('showCreateModal', true);
  }, [modals]);

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
      modals.setModal('showCreateModal', false);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [workspace, newWorktreeName, selectedProjects, modals]);

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
      const updatedConfig = {
        ...editingConfig,
        projects: editingConfig.projects.map(p =>
          p.name === projectName ? { ...p, linked_folders: folders } : p
        ),
      };
      setEditingConfig(updatedConfig);
      await workspace.saveConfig(updatedConfig);
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
      modals.setModal('showAddProjectToWorktreeModal', false);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setAddingProjectToWorktree(false);
    }
  }, [workspace, selectedWorktree, modals]);

  // Scan project folders (for SettingsView)
  const handleScanProject = useCallback(async (projectName: string) => {
    if (!workspace.currentWorkspace) return;
    setScanningProject(projectName);
    setScanResultsMap(prev => ({ ...prev, [projectName]: [] }));
    try {
      const projectPath = `${workspace.currentWorkspace.path}/projects/${projectName}`;
      const results = await workspace.scanLinkedFolders(projectPath);
      setScanResultsMap(prev => ({ ...prev, [projectName]: results }));
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

  const allArchiveIssuesConfirmed = (() => {
    if (!archiveModal?.status) return false;
    const { projects } = archiveModal.status;
    const allIssueKeys: string[] = [];

    for (const proj of projects) {
      if (proj.has_uncommitted && proj.uncommitted_count > 0) {
        allIssueKeys.push(`proj-uncommitted-${proj.project_name}`);
      }
      if (proj.unpushed_commits > 0) {
        allIssueKeys.push(`proj-unpushed-${proj.project_name}`);
      }
    }

    return allIssueKeys.length === 0 || allIssueKeys.every(key => archiveModal.confirmedIssues.has(key));
  })();

  const handleArchiveWorktree = useCallback(async () => {
    if (!archiveModal) return;
    setArchiving(true);
    try {
      // Clean up mounted terminals before archiving (backend closes PTY, frontend must unmount)
      const wtPath = archiveModal.worktree.path;
      if (wtPath) terminal.cleanupTerminalsForPath(wtPath);
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
  }, [workspace, archiveModal, selectedWorktree, terminal]);

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
      // Skip global ESC when a Radix Dialog is open (let it close the dialog first)
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
        setContextMenu(null);
        setArchiveModal(null);
        modals.setModal('showEditorMenu', false);
        modals.setModal('showWorkspaceMenu', false);
        setTerminalTabMenu(null);
      }
      // Cmd/Ctrl+N: Open create worktree modal (Tauri only)
      if ((e.metaKey || e.ctrlKey) && e.key === 'n' && isTauri()) {
        e.preventDefault();
        if (viewMode === 'main' && workspace.config) {
          openCreateModal();
        }
      }
      // Cmd/Ctrl+,: Open settings (Tauri only)
      if ((e.metaKey || e.ctrlKey) && e.key === ',' && isTauri()) {
        e.preventDefault();
        if (viewMode === 'main') {
          openSettings();
        }
      }
      // Cmd/Ctrl+[: Navigate back (settings -> main)
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        if (viewMode === 'settings') {
          setViewMode('main');
        }
      }
      // Cmd/Ctrl+B: Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        if (viewMode === 'main') {
          setSidebarCollapsed(prev => !prev);
        }
      }
      // Cmd/Ctrl+/: Show shortcut help
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
  }, [viewMode, workspace.config, openCreateModal, openSettings, terminalFullscreen, modals]);

  // Browser mode: show login screen if not authenticated
  if (!isTauri() && !browserAuth.browserAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="w-80 space-y-4">
          <div className="text-center space-y-2">
            <h1 className="text-xl font-semibold">Worktree Manager</h1>
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

  // No workspace - show welcome view (only after loading completes)
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
          name={newWorkspaceName}
          onNameChange={setNewWorkspaceName}
          path={newWorkspacePath}
          onPathChange={setNewWorkspacePath}
          onSubmit={handleAddWorkspace}
          loading={addingWorkspace}
        />
        <CreateWorkspaceModal
          open={modals.showCreateWorkspaceModal}
          onOpenChange={(v) => modals.setModal('showCreateWorkspaceModal', v)}
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
    <ToastProvider>
    <>
      {/* Loading overlay — keeps main UI mounted to avoid unmount/remount storm */}
      {workspace.loading && (
        <div className="fixed inset-0 z-50 bg-slate-900 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <RefreshIcon className="w-5 h-5 animate-spin text-slate-400" />
            <span className="text-slate-400">{t('common.loading')}</span>
          </div>
        </div>
      )}

      {/* Settings View */}
      <div
        className="h-screen bg-slate-900 text-slate-100 p-6 overflow-y-auto"
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
            scanResultsMap={scanResultsMap}
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
          onSwitchWorkspace={handleSwitchWorkspace}
          onAddWorkspace={() => modals.setModal('showAddWorkspaceModal', true)}
          mainWorkspace={workspace.mainWorkspace}
          worktrees={workspace.worktrees}
          selectedWorktree={selectedWorktree}
          onSelectWorktree={handleSelectWorktree}
          showArchived={modals.showArchived}
          onToggleArchived={() => modals.toggleModal('showArchived')}
          onContextMenu={handleContextMenu}
          onRefresh={workspace.loadData}
          onOpenSettings={openSettings}
          onOpenCreateModal={openCreateModal}
          updaterState={updater.state}
          onCheckUpdate={() => updater.checkForUpdates(false)}
          onOpenInNewWindow={isTauri() ? handleOpenInNewWindow : undefined}
          lockedWorktrees={locks.lockedWorktrees}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(prev => !prev)}
          switchingWorkspace={switchingWorkspace}
          shareActive={share.shareActive}
          shareUrl={share.shareUrl}
          shareNgrokUrl={share.shareNgrokUrl}
          sharePassword={share.sharePassword}
          onStartShare={share.handleStartShare}
          onStopShare={share.handleStopShare}
          onUpdateSharePassword={share.handleUpdateSharePassword}
          ngrokLoading={share.ngrokLoading}
          onToggleNgrok={share.handleToggleNgrok}
          connectedClients={share.connectedClients}
          onKickClient={share.handleKickClient}
        />
        )}

        <div className="flex-1 min-w-0 flex flex-col bg-slate-900">
          {!terminalFullscreen && (
          <div className="flex-1 p-6 overflow-y-auto min-h-0">
            <WorktreeDetail
              selectedWorktree={selectedWorktree}
              mainWorkspace={workspace.mainWorkspace}
              selectedEditor={selectedEditor}
              showEditorMenu={modals.showEditorMenu}
              onShowEditorMenu={(v) => modals.setModal('showEditorMenu', v)}
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
              switching={switchingWorktree}
              onDelete={selectedWorktree?.is_archived ? () => setDeleteConfirmWorktree(selectedWorktree) : undefined}
              onAddProject={() => modals.setModal('showAddProjectModal', true)}
              onAddProjectToWorktree={() => modals.setModal('showAddProjectToWorktreeModal', true)}
              error={workspace.error}
              onClearError={() => workspace.setError(null)}
              onRefresh={workspace.loadData}
            />
          </div>
          )}

          <TerminalPanel
            visible={terminal.terminalVisible}
            height={terminal.terminalHeight}
            onStartResize={() => terminal.setIsResizing(true)}
            terminalTabs={terminal.terminalTabs}
            activatedTerminals={terminal.activatedTerminals}
            mountedTerminals={terminal.mountedTerminals}
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
          worktreeName={newWorktreeName}
          onWorktreeNameChange={setNewWorktreeName}
          selectedProjects={selectedProjects}
          onToggleProject={toggleProjectSelection}
          onUpdateBaseBranch={updateProjectBaseBranch}
          onSubmit={handleCreateWorktree}
          creating={creating}
        />

        {isTauri() && (
          <AddWorkspaceModal
            open={modals.showAddWorkspaceModal}
            onOpenChange={(v) => modals.setModal('showAddWorkspaceModal', v)}
            name={newWorkspaceName}
            onNameChange={setNewWorkspaceName}
            path={newWorkspacePath}
            onPathChange={setNewWorkspacePath}
            onSubmit={handleAddWorkspace}
            loading={addingWorkspace}
          />
        )}

        <AddProjectModal
          open={modals.showAddProjectModal}
          onOpenChange={(v) => modals.setModal('showAddProjectModal', v)}
          onSubmit={handleAddProject}
          loading={cloningProject}
          scanLinkedFolders={workspace.scanLinkedFolders}
          workspacePath={workspace.currentWorkspace?.path}
          onUpdateLinkedFolders={handleUpdateLinkedFolders}
        />

        <AddProjectToWorktreeModal
          open={modals.showAddProjectToWorktreeModal}
          onOpenChange={(v) => modals.setModal('showAddProjectToWorktreeModal', v)}
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
            areAllIssuesConfirmed={allArchiveIssuesConfirmed}
            archiving={archiving}
          />
        )}

        {/* Delete Archived Worktree Confirmation */}
        <Dialog open={!!deleteConfirmWorktree} onOpenChange={(open) => !open && setDeleteConfirmWorktree(null)}>
          <DialogContent className="max-w-[400px]">
            <DialogHeader>
              <DialogTitle>{t('app.deleteArchivedTitle')}</DialogTitle>
              <DialogDescription>
                {t('app.deleteArchivedDesc', { name: deleteConfirmWorktree?.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeleteConfirmWorktree(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleDeleteArchivedWorktree} disabled={deletingArchived}>
                {deletingArchived ? t('app.deleting') : t('app.confirmDelete')}
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

      {/* Shortcut Help Dialog */}
      <Dialog open={showShortcutHelp} onOpenChange={setShowShortcutHelp}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('app.shortcutsTitle')}</DialogTitle>
            <DialogDescription>{t('app.shortcutsDesc')}</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {[
              { keys: isTauri() ? '⌘ N' : 'Ctrl N', desc: t('app.shortcutNewWorktree') },
              { keys: isTauri() ? '⌘ ,' : 'Ctrl ,', desc: t('app.shortcutOpenSettings') },
              { keys: isTauri() ? '⌘ B' : 'Ctrl B', desc: t('app.shortcutToggleSidebar') },
              { keys: isTauri() ? '⌘ [' : 'Ctrl [', desc: t('app.shortcutBack') },
              { keys: isTauri() ? '⌘ /' : 'Ctrl /', desc: t('app.shortcutHelp') },
              { keys: 'Alt V', desc: t('app.shortcutVoice') },
              { keys: 'Escape', desc: t('app.shortcutEscape') },
            ].map(({ keys, desc }) => (
              <div key={keys} className="flex items-center justify-between py-1.5 px-1">
                <span className="text-sm text-slate-300">{desc}</span>
                <div className="flex gap-1">
                  {keys.split(' ').map((k) => (
                    <kbd key={k} className="px-2 py-0.5 bg-slate-700 border border-slate-600 rounded text-xs font-mono text-slate-300">{k}</kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ngrok Token Dialog */}
      <Dialog open={share.showNgrokTokenDialog} onOpenChange={share.setShowNgrokTokenDialog}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('app.ngrokTokenTitle')}</DialogTitle>
            <DialogDescription>
              {t('app.ngrokTokenDescPlain')}{' '}
              <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{t('settings.ngrokGetToken')}</a>
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              type="text"
              placeholder="ngrok authtoken"
              value={share.ngrokTokenInput}
              onChange={(e) => share.setNgrokTokenInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') share.handleSaveNgrokToken(); }}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => share.setShowNgrokTokenDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={share.handleSaveNgrokToken} disabled={share.savingNgrokToken || !share.ngrokTokenInput.trim()}>
              {share.savingNgrokToken ? t('app.savingToken') : t('app.saveAndStart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
    </ToastProvider>
  );
}

export default App;
