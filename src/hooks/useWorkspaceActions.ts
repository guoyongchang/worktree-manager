import { useState, useCallback } from 'react';
import type { UseWorkspaceReturn } from './useWorkspace';
import type { UseModalsReturn } from './useModals';
// Only need the cleanup function from terminal hook, not the full return type
import type { UseWorktreeLocksReturn } from './useWorktreeLocks';
import type {
  WorktreeListItem,
  WorkspaceConfig,
  ContextMenuState,
  ArchiveModalState,
  CreateProjectRequest,
  EditorType,
} from '../types';
import { isTauri, getWindowLabel } from '../lib/backend';

export interface UseWorkspaceActionsReturn {
  // Selected worktree
  selectedWorktree: WorktreeListItem | null;
  hasUserSelected: boolean;
  handleSelectWorktree: (worktree: WorktreeListItem | null) => Promise<void>;
  setSelectedWorktree: (wt: WorktreeListItem | null) => void;
  setHasUserSelected: (v: boolean) => void;

  // Loading states
  switchingWorkspace: boolean;
  switchingWorktree: boolean;
  addingWorkspace: boolean;
  creatingWorkspace: boolean;
  archiving: boolean;
  deletingArchived: boolean;
  restoringWorktree: boolean;
  cloningProject: boolean;
  creating: boolean;
  addingProjectToWorktree: boolean;

  // Workspace handlers
  handleSwitchWorkspace: (path: string) => Promise<void>;
  handleAddWorkspace: () => Promise<void>;
  handleCreateWorkspace: () => Promise<void>;

  // Create worktree
  newWorktreeName: string;
  setNewWorktreeName: (v: string) => void;
  selectedProjects: Map<string, string>;
  toggleProjectSelection: (name: string, baseBranch: string) => void;
  updateProjectBaseBranch: (name: string, baseBranch: string) => void;
  openCreateModal: () => void;
  handleCreateWorktree: () => Promise<void>;

  // Add/create workspace form
  newWorkspaceName: string;
  setNewWorkspaceName: (v: string) => void;
  newWorkspacePath: string;
  setNewWorkspacePath: (v: string) => void;
  createWorkspaceName: string;
  setCreateWorkspaceName: (v: string) => void;
  createWorkspacePath: string;
  setCreateWorkspacePath: (v: string) => void;

  // Add project
  handleAddProject: (project: {
    name: string;
    repo_url: string;
    base_branch: string;
    test_branch: string;
    merge_strategy: string;
    linked_folders: string[];
  }) => Promise<void>;
  handleUpdateLinkedFolders: (projectName: string, folders: string[]) => Promise<void>;
  handleAddProjectToWorktree: (projectName: string, baseBranch: string) => Promise<void>;

  // Archive / Delete / Restore
  contextMenu: ContextMenuState | null;
  setContextMenu: (v: ContextMenuState | null) => void;
  handleContextMenu: (e: React.MouseEvent, worktree: WorktreeListItem) => void;
  archiveModal: ArchiveModalState | null;
  setArchiveModal: (v: ArchiveModalState | null) => void;
  openArchiveModal: (worktree: WorktreeListItem) => Promise<void>;
  confirmArchiveIssue: (issueKey: string) => void;
  allArchiveIssuesConfirmed: boolean;
  handleArchiveWorktree: () => Promise<void>;
  deleteConfirmWorktree: WorktreeListItem | null;
  setDeleteConfirmWorktree: (v: WorktreeListItem | null) => void;
  handleDeleteArchivedWorktree: () => Promise<void>;
  handleRestoreWorktree: () => Promise<void>;

  // Editor
  selectedEditor: EditorType;
  setSelectedEditor: (v: EditorType) => void;
  handleOpenInEditor: (path: string, editor?: EditorType) => void;

  // Other
  handleOpenInNewWindow: (workspacePath: string) => Promise<void>;

  // Auto-select logic
  tryAutoSelect: (
    worktrees: WorktreeListItem[],
    wsPath: string,
    pendingAutoSelectWorktree: string | null,
    setPendingAutoSelectWorktree: (v: string | null) => void,
    isMobileWeb: boolean,
  ) => Promise<void>;
}

export function useWorkspaceActions(
  workspace: UseWorkspaceReturn,
  modals: UseModalsReturn,
  cleanupTerminalsForPath: (pathPrefix: string) => void,
  locks: UseWorktreeLocksReturn,
  isMobileWeb: boolean,
  selectedWorktree: WorktreeListItem | null,
  setSelectedWorktree: (wt: WorktreeListItem | null) => void,
): UseWorkspaceActionsReturn {
  const [hasUserSelected, setHasUserSelected] = useState(false);

  // Loading states
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [switchingWorktree, setSwitchingWorktree] = useState(false);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deletingArchived, setDeletingArchived] = useState(false);
  const [restoringWorktree, setRestoringWorktree] = useState(false);
  const [cloningProject, setCloningProject] = useState(false);
  const [creating, setCreating] = useState(false);
  const [addingProjectToWorktree, setAddingProjectToWorktree] = useState(false);

  // Create worktree form state
  const [newWorktreeName, setNewWorktreeName] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<Map<string, string>>(new Map());

  // Add/create workspace form state
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspacePath, setNewWorkspacePath] = useState('');
  const [createWorkspaceName, setCreateWorkspaceName] = useState('');
  const [createWorkspacePath, setCreateWorkspacePath] = useState('');

  // Context menu / archive states
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [archiveModal, setArchiveModal] = useState<ArchiveModalState | null>(null);
  const [deleteConfirmWorktree, setDeleteConfirmWorktree] = useState<WorktreeListItem | null>(null);

  // Editor selection
  const [selectedEditor, setSelectedEditor] = useState<EditorType>('vscode');

  // Select worktree with lock handling
  const handleSelectWorktree = useCallback(async (worktree: WorktreeListItem | null) => {
    const wsPath = workspace.currentWorkspace?.path;
    if (!wsPath) return;

    setSwitchingWorktree(true);
    try {
      if (!isTauri()) {
        setHasUserSelected(true);
        setSelectedWorktree(worktree);
        if (isMobileWeb) {
          // Handled by caller (setSidebarCollapsed)
        }
        return;
      }

      if (selectedWorktree) {
        try {
          await workspace.unlockWorktree(wsPath, selectedWorktree.name);
        } catch {
          // ignore
        }
      }

      if (worktree) {
        try {
          await workspace.lockWorktree(wsPath, worktree.name);
        } catch (e) {
          workspace.setError(String(e));
          return;
        }
      }

      setHasUserSelected(true);
      setSelectedWorktree(worktree);
      locks.refreshLockedWorktrees();
    } finally {
      setSwitchingWorktree(false);
    }
  }, [workspace, selectedWorktree, locks, isMobileWeb]);

  // Workspace handlers
  const handleSwitchWorkspace = useCallback(async (path: string) => {
    modals.setModal('showWorkspaceMenu', false);
    setSelectedWorktree(null);
    setHasUserSelected(false);
    setSwitchingWorkspace(true);
    if (selectedWorktree && workspace.currentWorkspace) {
      workspace.unlockWorktree(workspace.currentWorkspace.path, selectedWorktree.name).catch(() => {});
    }
    try {
      await workspace.switchWorkspace(path);
    } finally {
      setSwitchingWorkspace(false);
    }
  }, [workspace, selectedWorktree, modals]);

  const handleAddWorkspace = useCallback(async () => {
    if (!newWorkspaceName.trim() || !newWorkspacePath.trim()) return;
    setAddingWorkspace(true);
    try {
      await workspace.addWorkspace(newWorkspaceName.trim(), newWorkspacePath.trim());
      modals.setModal('showAddWorkspaceModal', false);
      setNewWorkspaceName('');
      setNewWorkspacePath('');
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
      setCreateWorkspaceName('');
      setCreateWorkspacePath('');
    } finally {
      setCreatingWorkspace(false);
    }
  }, [workspace, createWorkspaceName, createWorkspacePath, modals]);

  // Create worktree
  const openCreateModal = useCallback(() => {
    setNewWorktreeName('');
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

  // Add project
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
    } catch (e) {
      workspace.setError(String(e));
      throw e;
    } finally {
      setCloningProject(false);
    }
  }, [workspace]);

  const handleUpdateLinkedFolders = useCallback(async (projectName: string, folders: string[]) => {
    if (workspace.config) {
      const updatedConfig = JSON.parse(JSON.stringify(workspace.config)) as WorkspaceConfig;
      const project = updatedConfig.projects.find(p => p.name === projectName);
      if (project) {
        project.linked_folders = folders;
        await workspace.saveConfig(updatedConfig);
      }
    }
  }, [workspace]);

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

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent, worktree: WorktreeListItem) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, worktree });
  }, []);

  // Archive
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
      const wtPath = archiveModal.worktree.path;
      if (wtPath) cleanupTerminalsForPath(wtPath);
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
  }, [workspace, archiveModal, selectedWorktree, cleanupTerminalsForPath]);

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

  const handleRestoreWorktree = useCallback(async () => {
    if (!selectedWorktree) return;
    setRestoringWorktree(true);
    try {
      await workspace.restoreWorktree(selectedWorktree.name);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setRestoringWorktree(false);
    }
  }, [workspace, selectedWorktree]);

  // Editor
  const handleOpenInEditor = useCallback((path: string, editor?: EditorType) => {
    workspace.openInEditor(path, editor || selectedEditor);
  }, [workspace, selectedEditor]);

  // Other
  const handleOpenInNewWindow = useCallback(async (workspacePath: string) => {
    try {
      await workspace.openWorkspaceInNewWindow(workspacePath);
    } catch (e) {
      workspace.setError(String(e));
    }
  }, [workspace]);

  // Auto-select logic (called from useEffect in App)
  const tryAutoSelect = useCallback(async (
    worktrees: WorktreeListItem[],
    wsPath: string,
    pendingAutoSelectWorktree: string | null,
    setPendingAutoSelectWorktree: (v: string | null) => void,
    _isMobileWeb: boolean,
  ) => {
    if (!isTauri()) {
      if (pendingAutoSelectWorktree) {
        const target = worktrees.find(w => w.name === pendingAutoSelectWorktree);
        if (target) {
          setSelectedWorktree(target);
          setHasUserSelected(true);
          setPendingAutoSelectWorktree(null);
        }
      }
      return;
    }

    const [lockedMap, windowLabel] = await Promise.all([
      workspace.getLockedWorktrees(wsPath).catch(() => ({} as Record<string, string>)),
      getWindowLabel(),
    ]);
    const activeWorktree = worktrees.find(w => {
      if (w.is_archived) return false;
      const lockedBy = lockedMap[w.name];
      return !lockedBy || lockedBy === windowLabel;
    });
    if (activeWorktree) {
      try {
        await workspace.lockWorktree(wsPath, activeWorktree.name);
        setSelectedWorktree(activeWorktree);
      } catch {
        setSelectedWorktree(null);
      }
    }
  }, [workspace]);

  return {
    selectedWorktree,
    hasUserSelected,
    handleSelectWorktree,
    setSelectedWorktree,
    setHasUserSelected,

    switchingWorkspace,
    switchingWorktree,
    addingWorkspace,
    creatingWorkspace,
    archiving,
    deletingArchived,
    restoringWorktree,
    cloningProject,
    creating,
    addingProjectToWorktree,

    handleSwitchWorkspace,
    handleAddWorkspace,
    handleCreateWorkspace,

    newWorktreeName,
    setNewWorktreeName,
    selectedProjects,
    toggleProjectSelection,
    updateProjectBaseBranch,
    openCreateModal,
    handleCreateWorktree,

    newWorkspaceName,
    setNewWorkspaceName,
    newWorkspacePath,
    setNewWorkspacePath,
    createWorkspaceName,
    setCreateWorkspaceName,
    createWorkspacePath,
    setCreateWorkspacePath,

    handleAddProject,
    handleUpdateLinkedFolders,
    handleAddProjectToWorktree,

    contextMenu,
    setContextMenu,
    handleContextMenu,
    archiveModal,
    setArchiveModal,
    openArchiveModal,
    confirmArchiveIssue,
    allArchiveIssuesConfirmed,
    handleArchiveWorktree,
    deleteConfirmWorktree,
    setDeleteConfirmWorktree,
    handleDeleteArchivedWorktree,
    handleRestoreWorktree,

    selectedEditor,
    setSelectedEditor,
    handleOpenInEditor,

    handleOpenInNewWindow,
    tryAutoSelect,
  };
}
