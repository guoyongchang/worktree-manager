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
import { Input } from "@/components/ui/input";
import { callBackend, getWindowLabel, setWindowTitle, isTauri, getSessionId, clearSessionId, startSharing, stopSharing, getShareState, getShareInfo, authenticate, updateSharePassword, getNgrokToken, setNgrokToken, startNgrokTunnel, stopNgrokTunnel, getConnectedClients, getLastSharePassword, kickClient } from "./lib/backend";
import type { ConnectedClient } from "./lib/backend";
import { getWebSocketManager } from "./lib/websocket";
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
  // Browser auth state (declared early so useWorkspace can depend on it)
  const [browserAuthenticated, setBrowserAuthenticated] = useState(isTauri());

  const workspace = useWorkspace(browserAuthenticated);
  const [selectedWorktree, setSelectedWorktree] = useState<WorktreeListItem | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('main');

  const terminal = useTerminal(selectedWorktree, workspace.mainWorkspace, workspace.currentWorkspace?.path);
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
  const [switchingWorktree, setSwitchingWorktree] = useState(false);
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

  // Share state
  const [shareActive, setShareActive] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareNgrokUrl, setShareNgrokUrl] = useState<string | null>(null);
  const [sharePassword, setSharePassword] = useState('');
  const [ngrokLoading, setNgrokLoading] = useState(false);
  const [showNgrokTokenDialog, setShowNgrokTokenDialog] = useState(false);
  const [ngrokTokenInput, setNgrokTokenInput] = useState('');
  const [savingNgrokToken, setSavingNgrokToken] = useState(false);

  // Connected clients tracking
  const [connectedClients, setConnectedClients] = useState<ConnectedClient[]>([]);

  const [browserLoginPassword, setBrowserLoginPassword] = useState('');
  const [browserLoginError, setBrowserLoginError] = useState<string | null>(null);
  const [browserLoggingIn, setBrowserLoggingIn] = useState(false);

  // Worktree lock state (for multi-window)
  const [lockedWorktrees, setLockedWorktrees] = useState<Record<string, string>>({});

  // Refresh worktree locks periodically
  const currentWorkspacePath = workspace.currentWorkspace?.path;
  const getLockedWorktreesFn = workspace.getLockedWorktrees;

  // Update locks only when content actually changes (avoids unnecessary re-renders)
  const updateLocksIfChanged = useCallback((locks: Record<string, string>) => {
    setLockedWorktrees(prev => {
      const next = JSON.stringify(locks);
      return next === JSON.stringify(prev) ? prev : locks;
    });
  }, []);

  const refreshLockedWorktrees = useCallback(async () => {
    if (!currentWorkspacePath) return;
    try {
      const locks = await getLockedWorktreesFn(currentWorkspacePath);
      updateLocksIfChanged(locks);
    } catch {
      // ignore
    }
  }, [currentWorkspacePath, getLockedWorktreesFn, updateLocksIfChanged]);

  useEffect(() => {
    if (!isTauri() && currentWorkspacePath) {
      const wsManager = getWebSocketManager();
      wsManager.subscribeLocks(currentWorkspacePath, updateLocksIfChanged);
      refreshLockedWorktrees();
      return () => { wsManager.unsubscribeLocks(); };
    } else {
      refreshLockedWorktrees();
      const interval = setInterval(refreshLockedWorktrees, 3000);
      return () => clearInterval(interval);
    }
  }, [refreshLockedWorktrees, currentWorkspacePath, updateLocksIfChanged]);

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
        const [locks, windowLabel] = await Promise.all([
          workspace.getLockedWorktrees(wsPath).catch(() => ({} as Record<string, string>)),
          getWindowLabel(),
        ]);
        const activeWorktree = workspace.worktrees.find(w => {
          if (w.is_archived) return false;
          const lockedBy = locks[w.name];
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
      refreshLockedWorktrees();
    } finally {
      setSwitchingWorktree(false);
    }
  }, [workspace, selectedWorktree, refreshLockedWorktrees]);

  // Reset terminal active tab when worktree changes
  useEffect(() => {
    terminal.resetActiveTab();
  }, [selectedWorktree?.path]);

  // Update window title based on workspace and worktree
  useEffect(() => {
    const wsName = workspace.currentWorkspace?.name;
    let title: string;
    if (!wsName) {
      title = 'Worktree Manager';
    } else {
      const wtName = selectedWorktree ? selectedWorktree.name : '主工作区';
      title = `${wsName} - ${wtName}`;
    }
    setWindowTitle(title);
  }, [workspace.currentWorkspace?.name, selectedWorktree]);

  // Workspace handlers
  const handleSwitchWorkspace = useCallback(async (path: string) => {
    const t0 = performance.now();
    console.log(`[app] handleSwitchWorkspace → ${path}`);
    // Clear UI state immediately — don't wait for unlock
    setShowWorkspaceMenu(false);
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
  }, [workspace, selectedWorktree]);

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

  // Share handlers
  const generatePassword = useCallback(() => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }, []);

  const handleStartShare = useCallback(async (port: number) => {
    try {
      const pwd = sharePassword || generatePassword();
      const url = await startSharing(port, pwd);
      setShareActive(true);
      setShareUrl(url);
      setSharePassword(pwd);
    } catch (e) {
      workspace.setError(String(e));
    }
  }, [workspace, generatePassword, sharePassword]);

  const handleStopShare = useCallback(async () => {
    try {
      await stopSharing();
      setShareActive(false);
      setShareUrl(null);
      setShareNgrokUrl(null);
      setConnectedClients([]);
    } catch (e) {
      workspace.setError(String(e));
    }
  }, [workspace]);

  const handleToggleNgrok = useCallback(async () => {
    if (ngrokLoading) return;
    setNgrokLoading(true);
    try {
      if (shareNgrokUrl) {
        await stopNgrokTunnel();
        setShareNgrokUrl(null);
      } else {
        // Check if ngrok token is configured
        const token = await getNgrokToken();
        if (!token) {
          setNgrokLoading(false);
          setShowNgrokTokenDialog(true);
          return;
        }
        const ngrokUrl = await startNgrokTunnel();
        setShareNgrokUrl(ngrokUrl);
      }
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setNgrokLoading(false);
    }
  }, [workspace, shareNgrokUrl, ngrokLoading]);

  const handleUpdateSharePassword = useCallback(async (newPassword: string) => {
    try {
      await updateSharePassword(newPassword);
      setSharePassword(newPassword);
    } catch (e) {
      workspace.setError(String(e));
    }
  }, [workspace]);

  const handleKickClient = useCallback(async (sessionId: string) => {
    try {
      await kickClient(sessionId);
      // Refresh connected clients list
      const clients = await getConnectedClients();
      setConnectedClients(clients);
    } catch (e) {
      workspace.setError(String(e));
    }
  }, [workspace]);

  const handleSaveNgrokToken = useCallback(async () => {
    if (!ngrokTokenInput.trim()) return;
    setSavingNgrokToken(true);
    try {
      await setNgrokToken(ngrokTokenInput.trim());
      setShowNgrokTokenDialog(false);
      setNgrokTokenInput('');
      // Try to start ngrok tunnel after saving token
      setNgrokLoading(true);
      const ngrokUrl = await startNgrokTunnel();
      setShareNgrokUrl(ngrokUrl);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setSavingNgrokToken(false);
      setNgrokLoading(false);
    }
  }, [workspace, ngrokTokenInput]);

  // Restore share state and load ngrok token on mount (Tauri only)
  useEffect(() => {
    if (isTauri()) {
      getShareState().then(state => {
        if (state.active && state.url) {
          setShareActive(true);
          setShareUrl(state.url);
          if (state.ngrok_url) {
            setShareNgrokUrl(state.ngrok_url);
          }
        }
      }).catch(() => {});
      // Load last password if available
      getLastSharePassword().then(pwd => {
        if (pwd) {
          setSharePassword(pwd);
        }
      }).catch(() => {});
    }
  }, []);

  // Poll connected clients when sharing is active (Tauri only)
  useEffect(() => {
    if (!isTauri() || !shareActive) {
      setConnectedClients([]);
      return;
    }
    // Fetch immediately, then poll every 5s
    const fetchClients = () => {
      getConnectedClients()
        .then(setConnectedClients)
        .catch(() => {});
    };
    fetchClients();
    const interval = setInterval(fetchClients, 5000);
    return () => clearInterval(interval);
  }, [shareActive]);

  // Browser: validate stored session on startup (avoids re-auth on refresh)
  useEffect(() => {
    if (isTauri()) return;
    const sid = getSessionId();
    if (!sid) return;
    // Try an authenticated call to check if session is still valid
    callBackend('list_workspaces')
      .then(() => setBrowserAuthenticated(true))
      .catch(() => {
        // Only clear if session hasn't been replaced by a fresh auth in the meantime
        if (getSessionId() === sid) {
          clearSessionId();
        }
      });
  }, []);

  // Browser: after authentication, bind to the shared workspace THEN load data
  useEffect(() => {
    if (!isTauri() && browserAuthenticated) {
      getShareInfo().then(async (info) => {
        await callBackend('set_window_workspace', { workspacePath: info.workspace_path });
        await workspace.loadWorkspaces();
        await workspace.loadData();
      }).catch(() => {});
    }
  }, [browserAuthenticated]);

  // Browser login handler
  const handleBrowserLogin = useCallback(async () => {
    if (!browserLoginPassword.trim()) return;
    setBrowserLoggingIn(true);
    setBrowserLoginError(null);
    try {
      await authenticate(browserLoginPassword.trim());
      setBrowserAuthenticated(true);
      setBrowserLoginPassword('');
    } catch (e) {
      setBrowserLoginError(String(e));
    } finally {
      setBrowserLoggingIn(false);
    }
  }, [browserLoginPassword]);

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

  // Browser mode: show login screen if not authenticated
  if (!isTauri() && !browserAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="w-80 space-y-4">
          <div className="text-center space-y-2">
            <h1 className="text-xl font-semibold">Worktree Manager</h1>
            <p className="text-sm text-slate-400">请输入访问密码</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleBrowserLogin(); }} className="space-y-3">
            <Input
              type="password"
              placeholder="密码"
              value={browserLoginPassword}
              onChange={(e) => setBrowserLoginPassword(e.target.value)}
              autoFocus
              className="bg-slate-800 border-slate-700"
            />
            {browserLoginError && (
              <p className="text-sm text-red-400">{browserLoginError}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={browserLoggingIn || !browserLoginPassword.trim()}
            >
              {browserLoggingIn ? '验证中...' : '进入'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

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
            scanResults={settingsScanResults}
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
          onOpenInNewWindow={isTauri() ? handleOpenInNewWindow : undefined}
          lockedWorktrees={lockedWorktrees}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(prev => !prev)}
          switchingWorkspace={switchingWorkspace}
          shareActive={shareActive}
          shareUrl={shareUrl}
          shareNgrokUrl={shareNgrokUrl}
          sharePassword={sharePassword}
          onStartShare={handleStartShare}
          onStopShare={handleStopShare}
          onUpdateSharePassword={handleUpdateSharePassword}
          ngrokLoading={ngrokLoading}
          onToggleNgrok={handleToggleNgrok}
          connectedClients={connectedClients}
          onKickClient={handleKickClient}
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
              switching={switchingWorktree}
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

        {isTauri() && (
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
        )}

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

      {/* Ngrok Token Dialog */}
      <Dialog open={showNgrokTokenDialog} onOpenChange={setShowNgrokTokenDialog}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>配置 Ngrok Token</DialogTitle>
            <DialogDescription>
              请输入您的 ngrok authtoken。您可以在 <a href="https://dashboard.ngrok.com/get-started/your-authtoken" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">ngrok 控制台</a> 获取。
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              type="text"
              placeholder="ngrok authtoken"
              value={ngrokTokenInput}
              onChange={(e) => setNgrokTokenInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNgrokToken(); }}
              className="font-mono text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowNgrokTokenDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSaveNgrokToken} disabled={savingNgrokToken || !ngrokTokenInput.trim()}>
              {savingNgrokToken ? '保存中...' : '保存并启动'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

export default App;
