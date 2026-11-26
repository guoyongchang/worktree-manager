import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { addLog } from '@/lib/operationLog';
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
  AddProjectSelection,
  AddProjectsResult,
  AddingProjectProgress,
  BackgroundDeleteState,
  BackgroundDeleteNotice,
} from '../types';
import { isTauri, getWindowLabel, removeProjectFromConfig, callBackend, syncAllProjectsToBase } from '../lib/backend';
import { recordWorkspaceSwitch } from '../lib/timeSaved';

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
  addingProjectProgress: AddingProjectProgress | null;

  // Workspace handlers
  handleSwitchWorkspace: (path: string) => Promise<void>;
  handleAddWorkspace: () => Promise<void>;
  handleCreateWorkspace: () => Promise<void>;

  // Create worktree
  newWorktreeName: string;
  setNewWorktreeName: (v: string) => void;
  folderAlias: string;
  setFolderAlias: (v: string) => void;
  useFolderAlias: boolean;
  setUseFolderAlias: (v: boolean) => void;
  selectedProjects: Map<string, string>;
  toggleProjectSelection: (name: string, baseBranch: string) => void;
  updateProjectBaseBranch: (name: string, baseBranch: string) => void;
  syncBeforeCreate: boolean;
  setSyncBeforeCreate: (v: boolean) => void;
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
  handleAddProjectToWorktree: (projects: AddProjectSelection[]) => Promise<AddProjectsResult>;
  handleRemoveProject: (name: string) => Promise<void>;

  // Archive / Delete / Restore
  contextMenu: ContextMenuState | null;
  setContextMenu: (v: ContextMenuState | null) => void;
  handleContextMenu: (e: React.MouseEvent, worktree: WorktreeListItem) => void;
  archiveModal: ArchiveModalState | null;
  setArchiveModal: (v: ArchiveModalState | null) => void;
  openArchiveModal: (worktree: WorktreeListItem) => Promise<void>;
  confirmArchiveIssue: (issueKey: string) => void;
  terminateArchiveLockProcess: (pid: number) => Promise<void>;
  terminatingArchiveLockPid: number | null;
  allArchiveIssuesConfirmed: boolean;
  handleArchiveWorktree: () => Promise<void>;
  deleteConfirmWorktree: WorktreeListItem | null;
  setDeleteConfirmWorktree: (v: WorktreeListItem | null) => void;
  handleDeleteArchivedWorktree: () => Promise<void>;
  handleBackgroundDeleteArchivedWorktree: () => void;
  handleRestoreWorktree: () => Promise<void>;

  // Batch archive & background delete
  batchArchiveModalOpen: boolean;
  setBatchArchiveModalOpen: (v: boolean) => void;
  handleBatchRestore: (names: string[]) => Promise<void>;
  handleBatchDelete: (names: string[]) => Promise<void>;
  handleBatchBackgroundDelete: (names: string[]) => void;
  backgroundDeleteState: BackgroundDeleteState;
  backgroundDeleteNotice: BackgroundDeleteNotice | null;
  deletingWorktreeNames: Set<string>;
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
  cleanupTerminalsForPath: (pathPrefix: string) => Promise<void>,
  locks: UseWorktreeLocksReturn,
  isMobileWeb: boolean,
  selectedWorktree: WorktreeListItem | null,
  setSelectedWorktree: (wt: WorktreeListItem | null) => void,
): UseWorkspaceActionsReturn {
  const { t: tFn } = useTranslation();
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
  const [addingProjectProgress, setAddingProjectProgress] = useState<AddingProjectProgress | null>(null);
  // Create worktree form state
  const [newWorktreeName, setNewWorktreeName] = useState('');
  const [folderAlias, setFolderAlias] = useState('');
  const [useFolderAlias, setUseFolderAlias] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Map<string, string>>(new Map());
  const [syncBeforeCreate, setSyncBeforeCreate] = useState(true);

  // Add/create workspace form state
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspacePath, setNewWorkspacePath] = useState('');
  const [createWorkspaceName, setCreateWorkspaceName] = useState('');
  const [createWorkspacePath, setCreateWorkspacePath] = useState('');

  // Context menu / archive states
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [archiveModal, setArchiveModal] = useState<ArchiveModalState | null>(null);
  const [terminatingArchiveLockPid, setTerminatingArchiveLockPid] = useState<number | null>(null);
  const [deleteConfirmWorktree, setDeleteConfirmWorktree] = useState<WorktreeListItem | null>(null);
  const [batchArchiveModalOpen, setBatchArchiveModalOpen] = useState(false);
  const [backgroundDeleteState, setBackgroundDeleteState] = useState<BackgroundDeleteState>({
    active: false,
    items: [],
  });
  const [backgroundDeleteNotice, setBackgroundDeleteNotice] = useState<BackgroundDeleteNotice | null>(null);

  // Refs for background delete queue safety across workspace switches / unmount
  const unmountedRef = useRef(false);
  const currentWorkspacePathRef = useRef(workspace.currentWorkspace?.path ?? '');
  currentWorkspacePathRef.current = workspace.currentWorkspace?.path ?? '';
  const selectedWorktreeRef = useRef(selectedWorktree);
  selectedWorktreeRef.current = selectedWorktree;
  const worktreesRef = useRef(workspace.worktrees);
  worktreesRef.current = workspace.worktrees;
  const backgroundDeleteStateRef = useRef(backgroundDeleteState);
  backgroundDeleteStateRef.current = backgroundDeleteState;
  const deleteQueueRef = useRef<Array<{ name: string; displayName: string; path?: string; workspacePath: string }>>([]);
  const deleteWorkerRunningRef = useRef(false);
  const deleteWorkerPromiseRef = useRef<Promise<void> | null>(null);
  const deleteBatchResultsRef = useRef<{ done: number; failed: Array<{ displayName: string; error: string }> }>({
    done: 0,
    failed: [],
  });
  const deleteNoticeIdRef = useRef(0);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const deletingWorktreeNames = useMemo(() => {
    const wsPath = workspace.currentWorkspace?.path ?? '';
    return new Set(
      backgroundDeleteState.items
        .filter(
          (it) =>
            (it.status === 'pending' || it.status === 'deleting') &&
            (!wsPath || !it.workspacePath || it.workspacePath === wsPath),
        )
        .map((it) => it.name),
    );
  }, [backgroundDeleteState.items, workspace.currentWorkspace?.path]);
  // Editor selection — prefer user's saved preference, fallback to first detected (non-hidden) editor
  const [selectedEditor, setSelectedEditor] = useState<EditorType>(() => {
    const saved = localStorage.getItem('preferred_editor') as EditorType | null;
    if (saved) {
      // Verify saved editor still exists in detected list and isn't hidden
      try {
        const detected: Array<{ id: string }> = JSON.parse(localStorage.getItem('detected_editors') || '[]');
        const hidden: string[] = JSON.parse(localStorage.getItem('hidden_editors') || '[]');
        if (detected.some(e => e.id === saved && !hidden.includes(e.id))) {
          return saved;
        }
        // Saved editor not available — pick first visible detected one
        const first = detected.find(e => !hidden.includes(e.id));
        if (first) return first.id as EditorType;
      } catch { /* ignore */ }
      return saved; // parsing failed, trust the saved value
    }
    // No saved preference — pick first detected non-hidden editor
    try {
      const detected: Array<{ id: string }> = JSON.parse(localStorage.getItem('detected_editors') || '[]');
      const hidden: string[] = JSON.parse(localStorage.getItem('hidden_editors') || '[]');
      const first = detected.find(e => !hidden.includes(e.id));
      if (first) return first.id as EditorType;
    } catch { /* ignore */ }
    return 'vscode'; // ultimate fallback
  });

  // Auto-detect tools on mount only if no editors/terminals cached yet
  // Skip in browser sharing mode — detect_tools is localhost-only
  useEffect(() => {
    if (!isTauri()) return;
    const existingEditors = localStorage.getItem('detected_editors');
    const existingTerminals = localStorage.getItem('detected_terminals');
    const existingTerminalIcons = localStorage.getItem('terminal_icons');
    if (existingEditors && existingTerminals && existingTerminalIcons) {
      try {
        const parsed = JSON.parse(existingEditors);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Editors, terminals, and terminal icons all cached — just notify components
          window.dispatchEvent(new Event('editors-detected'));
          window.dispatchEvent(new Event('terminals-detected'));
          return;
        }
      } catch { /* ignore */ }
    }
    // Missing editors, terminals, or terminal icons — run detection
    callBackend('detect_tools').then((tools: any) => {
      if (tools?.editors) {
        const editorIcons: Record<string, string> = {};
        const editorList: Array<{ id: string; name: string; icon?: string }> = [];
        const toolPaths = JSON.parse(localStorage.getItem('tool_paths') || '{}');
        for (const editor of tools.editors) {
          if (editor.icon) editorIcons[editor.id] = editor.icon;
          editorList.push({ id: editor.id, name: editor.name, icon: editor.icon });
          const key = `editor_${editor.id}`;
          if (!toolPaths[key]) toolPaths[key] = editor.path;
        }
        localStorage.setItem('editor_icons', JSON.stringify(editorIcons));
        localStorage.setItem('detected_editors', JSON.stringify(editorList));
        localStorage.setItem('tool_paths', JSON.stringify(toolPaths));
        // Auto-select first detected editor if current selection is not available
        const hiddenIds: string[] = JSON.parse(localStorage.getItem('hidden_editors') || '[]');
        const visibleEditors = editorList.filter(e => !hiddenIds.includes(e.id));
        if (visibleEditors.length > 0) {
          setSelectedEditor(prev => {
            if (!visibleEditors.some(e => e.id === prev)) {
              const newDefault = visibleEditors[0].id as EditorType;
              localStorage.setItem('preferred_editor', newDefault);
              return newDefault;
            }
            return prev;
          });
        }
        window.dispatchEvent(new Event('editors-detected'));
      }
      if (tools?.terminals) {
        const terminalIcons: Record<string, string> = {};
        const terminalList: Array<{ id: string; name: string }> = [];
        for (const term of tools.terminals) {
          if (term.icon) terminalIcons[term.id] = term.icon;
          terminalList.push({ id: term.id, name: term.name });
        }
        localStorage.setItem('terminal_icons', JSON.stringify(terminalIcons));
        localStorage.setItem('detected_terminals', JSON.stringify(terminalList));
        window.dispatchEvent(new Event('terminals-detected'));
      }
    }).catch(() => { /* ignore detect errors */ });
  }, []);

  // Select worktree with lock handling
  const handleSelectWorktree = useCallback(async (worktree: WorktreeListItem | null) => {
    const wsPath = workspace.currentWorkspace?.path;
    if (!wsPath) return;

    setSwitchingWorktree(true);
    const currentName = selectedWorktree?.name ?? null;
    const nextName = worktree?.name ?? null;
    const projectCount = worktree
      ? worktree.projects.length
      : (workspace.config?.projects.length ?? 0);
    try {
      if (currentName !== nextName) recordWorkspaceSwitch(projectCount);
      if (!isTauri()) {
        setHasUserSelected(true);
        setSelectedWorktree(worktree);
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
    setFolderAlias('');
    setUseFolderAlias(false);
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
      // Sync selected projects to base branch before creating worktree
      if (syncBeforeCreate && workspace.mainWorkspace) {
        const selectedNames = new Set(selectedProjects.keys());
        const projectPaths = workspace.mainWorkspace.projects
          .filter(p => selectedNames.has(p.name))
          .map(p => p.path);
        if (projectPaths.length > 0) {
          const results = await syncAllProjectsToBase(projectPaths);
          const failed = results.filter(r => r.status === 'failed');
          if (failed.length > 0) {
            const failedNames = failed.map(r => `${r.project_name}: ${r.message}`).join('\n');
            workspace.setError(tFn('createWorktree.syncFailed', '同步 Base 失败，请手动处理后重试：\n{{details}}', { details: failedNames }));
            setCreating(false);
            return;
          }
        }
      }

      const projects: CreateProjectRequest[] = Array.from(selectedProjects.entries()).map(
        ([name, base_branch]) => ({ name, base_branch })
      );
      const effectiveFolderAlias = useFolderAlias && folderAlias.trim() ? folderAlias.trim() : undefined;
      await workspace.createWorktree(newWorktreeName.trim(), projects, effectiveFolderAlias);
      modals.setModal('showCreateModal', false);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [workspace, newWorktreeName, selectedProjects, modals, useFolderAlias, folderAlias, syncBeforeCreate, tFn]);

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

  const handleAddProjectToWorktree = useCallback(async (projects: AddProjectSelection[]): Promise<AddProjectsResult> => {
    if (!selectedWorktree || projects.length === 0) {
      return { succeeded: [], failed: [] };
    }
    setAddingProjectToWorktree(true);
    const succeeded: string[] = [];
    const failed: Array<{ projectName: string; error: string }> = [];
    try {
      for (let i = 0; i < projects.length; i++) {
        const { projectName, baseBranch } = projects[i];
        setAddingProjectProgress({
          current: i + 1,
          total: projects.length,
          currentProject: projectName,
        });
        try {
          await workspace.addProjectToWorktree(
            {
              worktree_name: selectedWorktree.name,
              project_name: projectName,
              base_branch: baseBranch,
            },
            { reload: false },
          );
          succeeded.push(projectName);
        } catch (e) {
          failed.push({ projectName, error: String(e) });
        }
      }

      if (succeeded.length > 0) {
        await workspace.loadData();
      }

      if (failed.length === 0) {
        modals.setModal('showAddProjectToWorktreeModal', false);
      } else {
        workspace.setError(
          failed.map((f) => `${f.projectName}: ${f.error}`).join('\n'),
        );
      }
      return { succeeded, failed };
    } finally {
      setAddingProjectProgress(null);
      setAddingProjectToWorktree(false);
    }
  }, [workspace, selectedWorktree, modals]);

  // Remove project from config
  const handleRemoveProject = useCallback(async (name: string) => {
    try {
      await removeProjectFromConfig(name);
      await workspace.loadData();
    } catch (e) {
      const msg = String(e);
      const refMatch = msg.match(/referenced by worktree\(s\): (.+)/);
      if (refMatch) {
        workspace.setError(tFn('detail.removeProjectReferenced', { name, worktrees: refMatch[1] }));
      } else {
        workspace.setError(msg);
      }
    }
  }, [workspace, tFn]);

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

  const terminateArchiveLockProcess = useCallback(async (pid: number) => {
    if (!archiveModal) return;
    setTerminatingArchiveLockPid(pid);
    try {
      const process = archiveModal.status?.locked_processes.find((item) => item.pid === pid);
      if (!process) return;
      await workspace.terminateWorktreeLockingProcess(
        archiveModal.worktree.name,
        process.pid,
        process.process_start_time,
      );
      const status = await workspace.checkWorktreeStatus(archiveModal.worktree.name);
      setArchiveModal({
        ...archiveModal,
        status,
        loading: false,
        confirmedIssues: archiveModal.confirmedIssues,
      });
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setTerminatingArchiveLockPid(null);
    }
  }, [archiveModal, workspace]);

  const allArchiveIssuesConfirmed = (() => {
    if (!archiveModal?.status) return false;
    // Only real lock holders block archiving. A failed or partial lock check
    // (lock_check_error) is diagnostic: the backend still runs the authoritative
    // rename probe when archiving, so it must not disable the confirm button.
    if (archiveModal.status.locked_processes.length > 0) {
      return false;
    }
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
      if (wtPath) await cleanupTerminalsForPath(wtPath);
      await workspace.archiveWorktree(archiveModal.worktree.name);
      if (selectedWorktree?.name === archiveModal.worktree.name) {
        setSelectedWorktree(null);
      }
      setArchiveModal(null);
    } catch (e) {
      setArchiveModal((prev) => (prev ? { ...prev, archiveError: String(e) } : null));
    } finally {
      setArchiving(false);
    }
  }, [workspace, archiveModal, selectedWorktree, cleanupTerminalsForPath]);

  const runDeleteQueue = useCallback(async () => {
    if (deleteWorkerRunningRef.current) return;
    deleteWorkerRunningRef.current = true;
    try {
      while (deleteQueueRef.current.length > 0) {
        const next = deleteQueueRef.current.shift()!;
        if (!unmountedRef.current) {
          setBackgroundDeleteState((prev) => ({
            ...prev,
            active: true,
            items: prev.items.map((it) =>
              it.name === next.name &&
              it.workspacePath === next.workspacePath &&
              it.status === 'pending'
                ? { ...it, status: 'deleting' }
                : it,
            ),
          }));
        }
        try {
          if (next.path) {
            await cleanupTerminalsForPath(next.path).catch(() => {});
          }
          await workspace.deleteArchivedWorktree(next.name, {
            reload: false,
            throwOnError: true,
            workspacePath: next.workspacePath || undefined,
          });
          deleteBatchResultsRef.current.done += 1;
          if (!unmountedRef.current) {
            setBackgroundDeleteState((prev) => ({
              ...prev,
              items: prev.items.map((it) =>
                it.name === next.name &&
                it.workspacePath === next.workspacePath &&
                it.status === 'deleting'
                  ? { ...it, status: 'done' }
                  : it,
              ),
            }));
            if (!next.workspacePath || currentWorkspacePathRef.current === next.workspacePath) {
              await workspace.loadData({ silent: true });
            }
          }
        } catch (e) {
          const errMsg = String(e);
          deleteBatchResultsRef.current.failed.push({
            displayName: next.displayName,
            error: errMsg,
          });
          if (!unmountedRef.current) {
            setBackgroundDeleteState((prev) => ({
              ...prev,
              items: prev.items.map((it) =>
                it.name === next.name &&
                it.workspacePath === next.workspacePath &&
                it.status === 'deleting'
                  ? { ...it, status: 'failed', error: errMsg }
                  : it,
              ),
            }));
          }
        }
      }
    } finally {
      deleteWorkerRunningRef.current = false;
      deleteWorkerPromiseRef.current = null;
      if (!unmountedRef.current) {
        setBackgroundDeleteState((prev) => ({ ...prev, active: false }));
        const { done, failed } = deleteBatchResultsRef.current;
        if (failed.length === 0 && done > 0) {
          setBackgroundDeleteNotice({
            id: ++deleteNoticeIdRef.current,
            type: 'success',
            message: tFn('batchArchive.bgDeleteSuccess', { count: done }),
          });
        } else if (failed.length > 0) {
          const details = failed.map((f) => `${f.displayName}: ${f.error}`).join('; ');
          setBackgroundDeleteNotice({
            id: ++deleteNoticeIdRef.current,
            type: 'error',
            message:
              done > 0
                ? tFn('batchArchive.bgDeletePartialFailed', {
                    succeeded: done,
                    failed: failed.length,
                    details,
                  })
                : tFn('batchArchive.bgDeleteAllFailed', {
                    failed: failed.length,
                    details,
                  }),
          });
        }
      }
    }
  }, [workspace, cleanupTerminalsForPath, tFn]);

  const enqueueArchivedDeletes = useCallback(
    (
      targets: Array<{ name: string; displayName?: string; path?: string }>,
      options?: { showStartToast?: boolean; closeBatchModal?: boolean },
    ): Promise<void> => {
      const wsPath = currentWorkspacePathRef.current;
      const inFlightKeys = new Set(
        backgroundDeleteStateRef.current.items
          .filter((it) => it.status === 'pending' || it.status === 'deleting')
          .map((it) => `${it.workspacePath}::${it.name}`),
      );
      for (const queued of deleteQueueRef.current) {
        inFlightKeys.add(`${queued.workspacePath}::${queued.name}`);
      }

      const newItems = targets
        .filter((t) => !inFlightKeys.has(`${wsPath}::${t.name}`))
        .map((t) => ({
          name: t.name,
          displayName: t.displayName || t.name,
          path: t.path,
          workspacePath: wsPath,
        }));

      if (options?.closeBatchModal) {
        setBatchArchiveModalOpen(false);
      }

      if (newItems.length === 0) {
        return deleteWorkerPromiseRef.current ?? Promise.resolve();
      }

      // Clear selection immediately if the currently selected worktree is queued for deletion
      const selectedName = selectedWorktreeRef.current?.name;
      if (selectedName && newItems.some((it) => it.name === selectedName)) {
        setSelectedWorktree(null);
      }

      const isFreshBatch = !deleteWorkerRunningRef.current;
      if (isFreshBatch) {
        deleteBatchResultsRef.current = { done: 0, failed: [] };
      }

      deleteQueueRef.current.push(...newItems);
      const stateEntries = newItems.map((it) => ({
        name: it.name,
        displayName: it.displayName,
        workspacePath: it.workspacePath,
        status: 'pending' as const,
      }));
      setBackgroundDeleteState((prev) => ({
        active: true,
        items: isFreshBatch ? stateEntries : [...prev.items, ...stateEntries],
      }));

      if (options?.showStartToast) {
        setBackgroundDeleteNotice({
          id: ++deleteNoticeIdRef.current,
          type: 'info',
          message: tFn('batchArchive.bgDeleteStarted', { count: newItems.length }),
        });
      }

      if (!deleteWorkerPromiseRef.current) {
        deleteWorkerPromiseRef.current = runDeleteQueue();
      }
      return deleteWorkerPromiseRef.current;
    },
    [runDeleteQueue, setSelectedWorktree, tFn],
  );

  const handleDeleteArchivedWorktree = useCallback(async () => {
    if (!deleteConfirmWorktree) return;
    setDeletingArchived(true);
    try {
      if (deleteConfirmWorktree.path) {
        await cleanupTerminalsForPath(deleteConfirmWorktree.path);
      }
      await workspace.deleteArchivedWorktree(deleteConfirmWorktree.name, {
        throwOnError: true,
      });
      if (selectedWorktree?.name === deleteConfirmWorktree.name) {
        setSelectedWorktree(null);
      }
      setDeleteConfirmWorktree(null);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setDeletingArchived(false);
    }
  }, [workspace, deleteConfirmWorktree, selectedWorktree, cleanupTerminalsForPath, setSelectedWorktree]);

  const handleBackgroundDeleteArchivedWorktree = useCallback(() => {
    if (!deleteConfirmWorktree) return;
    const target = deleteConfirmWorktree;
    setDeleteConfirmWorktree(null);
    void enqueueArchivedDeletes(
      [{ name: target.name, displayName: target.display_name || target.name, path: target.path }],
      { showStartToast: true },
    );
  }, [deleteConfirmWorktree, enqueueArchivedDeletes]);

  const handleRestoreWorktree = useCallback(async () => {
    if (!selectedWorktree) return;
    if (deletingWorktreeNames.has(selectedWorktree.name)) return;
    setRestoringWorktree(true);
    try {
      await workspace.restoreWorktree(selectedWorktree.name);
    } catch (e) {
      workspace.setError(String(e));
    } finally {
      setRestoringWorktree(false);
    }
  }, [workspace, selectedWorktree, deletingWorktreeNames]);

  // Batch archive operations
  const handleBatchRestore = useCallback(async (names: string[]) => {
    const restorable = names.filter((name) => !deletingWorktreeNames.has(name));
    if (restorable.length === 0) return;
    setRestoringWorktree(true);
    try {
      for (const name of restorable) {
        try {
          await workspace.restoreWorktree(name);
        } catch (e) {
          workspace.setError(`${name}: ${String(e)}`);
        }
      }
      setBatchArchiveModalOpen(false);
    } finally {
      setRestoringWorktree(false);
    }
  }, [workspace, deletingWorktreeNames]);

  const resolveArchivedTargets = useCallback((names: string[]) => {
    const wtByName = new Map(worktreesRef.current.map((w) => [w.name, w]));
    return names.map((name) => {
      const wt = wtByName.get(name);
      return {
        name,
        displayName: wt?.display_name || name,
        path: wt?.path,
      };
    });
  }, []);

  const handleBatchDelete = useCallback(async (names: string[]) => {
    if (names.length === 0) return;
    setDeletingArchived(true);
    try {
      await enqueueArchivedDeletes(resolveArchivedTargets(names), {
        closeBatchModal: false,
        showStartToast: false,
      });
      if (!unmountedRef.current && deleteBatchResultsRef.current.failed.length === 0) {
        setBatchArchiveModalOpen(false);
      }
    } finally {
      if (!unmountedRef.current) {
        setDeletingArchived(false);
      }
    }
  }, [enqueueArchivedDeletes, resolveArchivedTargets]);

  const handleBatchBackgroundDelete = useCallback((names: string[]) => {
    if (names.length === 0) return;
    void enqueueArchivedDeletes(resolveArchivedTargets(names), {
      closeBatchModal: true,
      showStartToast: true,
    });
  }, [enqueueArchivedDeletes, resolveArchivedTargets]);
  // Editor
  const handleOpenInEditor = useCallback((path: string, editor?: EditorType) => {
    const editorId = editor || selectedEditor;
    addLog(path, { level: 'info', operation: 'open_ide', message: `Opened in ${editorId}` });
    workspace.openInEditor(path, editorId);
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
    // Primary cell lock label is "windowLabel:0"; also accept legacy bare windowLabel
    const myLockLabel = `${windowLabel}:0`;
    const activeWorktree = worktrees.find(w => {
      if (w.is_archived) return false;
      const lockedBy = lockedMap[w.name];
      return !lockedBy || lockedBy === myLockLabel || lockedBy === windowLabel;
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
    addingProjectProgress,

    handleSwitchWorkspace,
    handleAddWorkspace,
    handleCreateWorkspace,

    newWorktreeName,
    setNewWorktreeName,
    folderAlias,
    setFolderAlias,
    useFolderAlias,
    setUseFolderAlias,
    selectedProjects,
    toggleProjectSelection,
    updateProjectBaseBranch,
    syncBeforeCreate,
    setSyncBeforeCreate,
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
    handleRemoveProject,

    contextMenu,
    setContextMenu,
    handleContextMenu,
    archiveModal,
    setArchiveModal,
    openArchiveModal,
    confirmArchiveIssue,
    terminateArchiveLockProcess,
    terminatingArchiveLockPid,
    allArchiveIssuesConfirmed,
    handleArchiveWorktree,
    deleteConfirmWorktree,
    setDeleteConfirmWorktree,
    handleDeleteArchivedWorktree,
    handleBackgroundDeleteArchivedWorktree,
    handleRestoreWorktree,

    batchArchiveModalOpen,
    setBatchArchiveModalOpen,
    handleBatchRestore,
    handleBatchDelete,
    handleBatchBackgroundDelete,
    backgroundDeleteState,
    backgroundDeleteNotice,
    deletingWorktreeNames,
    selectedEditor,
    setSelectedEditor,
    handleOpenInEditor,

    handleOpenInNewWindow,
    tryAutoSelect,
  };
}
