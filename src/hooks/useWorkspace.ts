import { useState, useEffect, useCallback, useRef } from 'react';
import { callBackend, isTauri } from '../lib/backend';
import type {
  WorkspaceRef,
  WorkspaceConfig,
  WorktreeListItem,
  MainWorkspaceStatus,
  CreateProjectRequest,
  WorktreeArchiveStatus,
  EditorType,
  ScannedFolder,
  AddProjectToWorktreeRequest,
} from '../types';

export interface UseWorkspaceReturn {
  workspaces: WorkspaceRef[];
  currentWorkspace: WorkspaceRef | null;
  config: WorkspaceConfig | null;
  worktrees: WorktreeListItem[];
  mainWorkspace: MainWorkspaceStatus | null;
  configPath: string;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  loadWorkspaces: () => Promise<void>;
  loadData: () => Promise<void>;
  switchWorkspace: (path: string) => Promise<void>;
  addWorkspace: (name: string, path: string) => Promise<void>;
  createWorkspace: (name: string, path: string) => Promise<void>;
  removeWorkspace: (path: string) => Promise<void>;
  createWorktree: (name: string, projects: CreateProjectRequest[]) => Promise<void>;
  cloneProject: (project: {
    name: string;
    repo_url: string;
    base_branch: string;
    test_branch: string;
    merge_strategy: string;
    linked_folders: string[];
  }) => Promise<void>;
  archiveWorktree: (name: string) => Promise<void>;
  restoreWorktree: (name: string) => Promise<void>;
  deleteArchivedWorktree: (name: string) => Promise<void>;
  checkWorktreeStatus: (name: string) => Promise<WorktreeArchiveStatus>;
  openInEditor: (path: string, editor: EditorType) => Promise<void>;
  openInTerminal: (path: string) => Promise<void>;
  revealInFinder: (path: string) => Promise<void>;
  switchBranch: (projectPath: string, branch: string) => Promise<void>;
  saveConfig: (config: WorkspaceConfig) => Promise<void>;
  scanLinkedFolders: (projectPath: string) => Promise<ScannedFolder[]>;
  addProjectToWorktree: (request: AddProjectToWorktreeRequest) => Promise<void>;
  openWorkspaceInNewWindow: (workspacePath: string) => Promise<void>;
  lockWorktree: (workspacePath: string, worktreeName: string) => Promise<void>;
  unlockWorktree: (workspacePath: string, worktreeName: string) => Promise<void>;
  getLockedWorktrees: (workspacePath: string) => Promise<Record<string, string>>;
}

export function useWorkspace(ready = true): UseWorkspaceReturn {
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<WorkspaceRef | null>(null);
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeListItem[]>([]);
  const [mainWorkspace, setMainWorkspace] = useState<MainWorkspaceStatus | null>(null);
  const [configPath, setConfigPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const loadVersion = useRef(0);

  // 初始化时注册窗口 workspace 绑定（从 URL 参数获取）
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const workspacePath = params.get('workspace');
    if (workspacePath) {
      callBackend('set_window_workspace', { workspacePath }).catch((e) => {
        console.error('Failed to set window workspace:', e);
      });
    }

    // 窗口关闭时的清理由 Rust 层 on_window_event 处理，
    // 不在前端注册 onCloseRequested 以避免阻塞窗口关闭
  }, [ready]);

  const loadWorkspaces = useCallback(async () => {
    try {
      const [wsList, current] = await Promise.all([
        callBackend<WorkspaceRef[]>("list_workspaces"),
        callBackend<WorkspaceRef | null>("get_current_workspace"),
      ]);
      setWorkspaces(wsList);
      setCurrentWorkspace(current);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadData = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const [cfg, wts, main, path] = await Promise.all([
        callBackend<WorkspaceConfig>("get_workspace_config"),
        callBackend<WorktreeListItem[]>("list_worktrees", { includeArchived: true }),
        callBackend<MainWorkspaceStatus>("get_main_workspace_status"),
        callBackend<string>("get_config_path_info"),
      ]);
      // Discard stale results if a newer load has started
      if (version !== loadVersion.current) return;
      setConfig(cfg);
      setWorktrees(wts);
      setMainWorkspace(main);
      setConfigPath(path);
    } catch (e) {
      if (version !== loadVersion.current) return;
      setError(String(e));
    } finally {
      if (version === loadVersion.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    loadWorkspaces().then(() => loadData());
  }, [ready, loadWorkspaces, loadData]);

  const switchWorkspace = useCallback(async (path: string) => {
    // Bump version to cancel any in-flight loadData
    ++loadVersion.current;
    // Immediately show loading and clear stale data
    setLoading(true);
    setConfig(null);
    setWorktrees([]);
    setMainWorkspace(null);
    setError(null);
    try {
      await callBackend("switch_workspace", { path });
      await loadWorkspaces();
      await loadData();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }, [loadWorkspaces, loadData]);

  const addWorkspace = useCallback(async (name: string, path: string) => {
    try {
      await callBackend("add_workspace", { name, path });
      await loadWorkspaces();
      await loadData();
    } catch (e) {
      setError(String(e));
    }
  }, [loadWorkspaces, loadData]);

  const createWorkspace = useCallback(async (name: string, path: string) => {
    try {
      await callBackend("create_workspace", { name, path });
      await loadWorkspaces();
      await loadData();
    } catch (e) {
      setError(String(e));
    }
  }, [loadWorkspaces, loadData]);

  const removeWorkspace = useCallback(async (path: string) => {
    try {
      await callBackend("remove_workspace", { path });
      await loadWorkspaces();
      await loadData();
    } catch (e) {
      setError(String(e));
    }
  }, [loadWorkspaces, loadData]);

  const createWorktree = useCallback(async (name: string, projects: CreateProjectRequest[]) => {
    await callBackend("create_worktree", { request: { name, projects } });
    await loadData();
  }, [loadData]);

  const cloneProject = useCallback(async (project: {
    name: string;
    repo_url: string;
    base_branch: string;
    test_branch: string;
    merge_strategy: string;
    linked_folders: string[];
  }) => {
    await callBackend("clone_project", { request: project });
    await loadData();
  }, [loadData]);

  const archiveWorktree = useCallback(async (name: string) => {
    await callBackend("archive_worktree", { name });
    await loadData();
  }, [loadData]);

  const restoreWorktree = useCallback(async (name: string) => {
    try {
      await callBackend("restore_worktree", { name });
      await loadData();
    } catch (e) {
      setError(String(e));
    }
  }, [loadData]);

  const deleteArchivedWorktree = useCallback(async (name: string) => {
    try {
      await callBackend("delete_archived_worktree", { name });
      await loadData();
    } catch (e) {
      setError(String(e));
    }
  }, [loadData]);

  const checkWorktreeStatus = useCallback(async (name: string): Promise<WorktreeArchiveStatus> => {
    return callBackend<WorktreeArchiveStatus>("check_worktree_status", { name });
  }, []);

  const openInEditor = useCallback(async (path: string, editor: EditorType) => {
    try {
      await callBackend("open_in_editor", { request: { path, editor } });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const openInTerminal = useCallback(async (path: string) => {
    try {
      await callBackend("open_in_terminal", { path });
    } catch (e) {
      console.error("Failed to open in Terminal:", e);
    }
  }, []);

  const revealInFinder = useCallback(async (path: string) => {
    try {
      await callBackend("reveal_in_finder", { path });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const switchBranch = useCallback(async (projectPath: string, branch: string) => {
    try {
      await callBackend("switch_branch", { request: { project_path: projectPath, branch } });
      await loadData();
    } catch (e) {
      setError(String(e));
    }
  }, [loadData]);

  const saveConfig = useCallback(async (newConfig: WorkspaceConfig) => {
    await callBackend("save_workspace_config", { config: newConfig });
    setConfig(newConfig);
    await loadData();
  }, [loadData]);

  const scanLinkedFolders = useCallback(async (projectPath: string): Promise<ScannedFolder[]> => {
    return callBackend<ScannedFolder[]>("scan_linked_folders", { projectPath });
  }, []);

  const addProjectToWorktree = useCallback(async (request: AddProjectToWorktreeRequest): Promise<void> => {
    await callBackend("add_project_to_worktree", { request });
    await loadData();
  }, [loadData]);

  const openWorkspaceInNewWindow = useCallback(async (workspacePath: string) => {
    const result = await callBackend<string>("open_workspace_window", { workspacePath });
    if (!isTauri() && result) {
      window.open(result, '_blank');
    }
  }, []);

  const lockWorktree = useCallback(async (workspacePath: string, worktreeName: string): Promise<void> => {
    await callBackend("lock_worktree", { workspacePath, worktreeName });
  }, []);

  const unlockWorktree = useCallback(async (workspacePath: string, worktreeName: string): Promise<void> => {
    await callBackend("unlock_worktree", { workspacePath, worktreeName });
  }, []);

  const getLockedWorktrees = useCallback(async (workspacePath: string): Promise<Record<string, string>> => {
    return callBackend<Record<string, string>>("get_locked_worktrees", { workspacePath });
  }, []);

  return {
    workspaces,
    currentWorkspace,
    config,
    worktrees,
    mainWorkspace,
    configPath,
    loading,
    error,
    setError,
    loadWorkspaces,
    loadData,
    switchWorkspace,
    addWorkspace,
    createWorkspace,
    removeWorkspace,
    createWorktree,
    cloneProject,
    archiveWorktree,
    restoreWorktree,
    deleteArchivedWorktree,
    checkWorktreeStatus,
    openInEditor,
    openInTerminal,
    revealInFinder,
    switchBranch,
    saveConfig,
    scanLinkedFolders,
    addProjectToWorktree,
    openWorkspaceInNewWindow,
    lockWorktree,
    unlockWorktree,
    getLockedWorktrees,
  };
}
