import { useState, useEffect, useCallback, useRef } from "react";
import type { TFunction } from "i18next";

import {
  useWorkspace,
  useTerminal,
  useUpdater,
  useShareFeature,
  useBrowserAuth,
  useWorktreeLocks,
  useModals,
  useWorkspaceActions,
  useMainOccupation,
} from "./index";
import { useVoiceInput } from "./useVoiceInput";
import { callBackend, isTauri, setWindowTitle, getShareInfo, clearSessionId } from "../lib/backend";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getWebSocketManager } from "../lib/websocket";
import type { ViewMode, TerminalTabMenuState, WorkspaceConfig, WorktreeListItem } from "../types";

export interface UseAppShellStateReturn {
  browserAuth: ReturnType<typeof useBrowserAuth>;
  workspace: ReturnType<typeof useWorkspace>;
  shareWorkspaceName: string | null;
  viewMode: ViewMode;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  isMobileWeb: boolean;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  mobileView: "list" | "detail";
  setMobileView: React.Dispatch<React.SetStateAction<"list" | "detail">>;
  terminalFullscreen: boolean;
  setTerminalFullscreen: React.Dispatch<React.SetStateAction<boolean>>;
  showShortcutHelp: boolean;
  setShowShortcutHelp: React.Dispatch<React.SetStateAction<boolean>>;
  terminalTabMenu: TerminalTabMenuState | null;
  setTerminalTabMenu: React.Dispatch<React.SetStateAction<TerminalTabMenuState | null>>;
  modals: ReturnType<typeof useModals>;
  share: ReturnType<typeof useShareFeature>;
  locks: ReturnType<typeof useWorktreeLocks>;
  mainOccupation: ReturnType<typeof useMainOccupation>;
  selectedWorktree: WorktreeListItem | null;
  setSelectedWorktree: React.Dispatch<React.SetStateAction<WorktreeListItem | null>>;
  terminalHook: ReturnType<typeof useTerminal>;
  actions: ReturnType<typeof useWorkspaceActions>;
  updater: ReturnType<typeof useUpdater>;
  wsConnected: boolean;
  wasKicked: boolean;
  setWasKicked: React.Dispatch<React.SetStateAction<boolean>>;
  voice: ReturnType<typeof useVoiceInput>;
  openSettings: () => void;
  handleSaveConfig: (config: WorkspaceConfig) => Promise<void>;
  handleTerminalTabContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
}

export function useAppShellState(t: TFunction): UseAppShellStateReturn {
  const browserAuth = useBrowserAuth();
  const workspace = useWorkspace(browserAuth.browserAuthenticated);

  const [shareWorkspaceName, setShareWorkspaceName] = useState<string | null>(null);
  const [pendingAutoSelectWorktree, setPendingAutoSelectWorktree] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("main");
  const [isMobileWeb, setIsMobileWeb] = useState(
    () => !isTauri() && window.matchMedia("(max-width: 639px)").matches,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobileWeb);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [terminalTabMenu, setTerminalTabMenu] = useState<TerminalTabMenuState | null>(null);
  const [selectedWorktree, setSelectedWorktree] = useState<WorktreeListItem | null>(null);
  const [wsConnected, setWsConnected] = useState(true);
  const [wasKicked, setWasKicked] = useState(false);

  const modals = useModals();
  const share = useShareFeature(workspace.setError);
  const locks = useWorktreeLocks(workspace.currentWorkspace?.path, workspace.getLockedWorktrees);
  const mainOccupation = useMainOccupation(workspace.currentWorkspace?.path);
  const terminalHook = useTerminal(selectedWorktree, workspace.mainWorkspace, workspace.currentWorkspace?.path);
  const actions = useWorkspaceActions(
    workspace,
    modals,
    terminalHook.cleanupTerminalsForPath,
    locks,
    isMobileWeb,
    selectedWorktree,
    setSelectedWorktree,
  );
  const updater = useUpdater();

  useEffect(() => {
    if (isTauri()) return;
    getShareInfo()
      .then((info) => {
        if (info.workspace_name) setShareWorkspaceName(info.workspace_name);
        if (info.current_worktree) setPendingAutoSelectWorktree(info.current_worktree);
      })
      .catch(() => {});
  }, []);

  // Browser-mode initialisation: runs once when auth succeeds.
  // IMPORTANT: depend only on stable refs (useCallback-wrapped) to avoid
  // infinite re-trigger (the `workspace` object is recreated every render).
  const { loadWorkspaces, loadData } = workspace;
  useEffect(() => {
    if (!isTauri() && browserAuth.browserAuthenticated) {
      getShareInfo()
        .then(async (info) => {
          if (info.current_worktree) setPendingAutoSelectWorktree(info.current_worktree);
          await callBackend("set_window_workspace", { workspacePath: info.workspace_path });
          await loadWorkspaces();
          await loadData();
        })
        .catch(() => {});
    }
  }, [browserAuth.browserAuthenticated, loadWorkspaces, loadData]);

  useEffect(() => {
    if (isTauri() || !browserAuth.browserAuthenticated) return;
    const wsManager = getWebSocketManager();
    const unsubConn = wsManager.onConnectionStateChange(setWsConnected);
    const unsubKicked = wsManager.onKicked(() => {
      setWasKicked(true);
      clearSessionId();
      wsManager.disconnect();
    });
    return () => {
      unsubConn();
      unsubKicked();
    };
  }, [browserAuth.browserAuthenticated]);

  const voice = useVoiceInput(
    useCallback(
      (text: string) => {
        const activeTab = terminalHook.activeTerminalTab;
        if (activeTab) {
          const windowLabel = isTauri() ? getCurrentWindow().label : "browser";
          const sessionId = `pty-${windowLabel}-${activeTab.replace(/[/#]/g, "-")}`;
          callBackend("pty_write", { sessionId, data: text });
        }
      },
      [terminalHook.activeTerminalTab],
    ),
  );

  const voiceMountedRef = useRef(false);
  useEffect(() => {
    if (voiceMountedRef.current) {
      voice.stopVoice();
    } else {
      voiceMountedRef.current = true;
    }
  }, [actions.selectedWorktree, terminalHook.activeTerminalTab, voice]);

  useEffect(() => {
    if (isTauri()) return;
    const mql = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => {
      setIsMobileWeb(e.matches);
      if (e.matches) setSidebarCollapsed(true);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (
      !actions.hasUserSelected &&
      !actions.selectedWorktree &&
      workspace.worktrees.length > 0 &&
      workspace.currentWorkspace
    ) {
      actions.tryAutoSelect(
        workspace.worktrees,
        workspace.currentWorkspace.path,
        pendingAutoSelectWorktree,
        setPendingAutoSelectWorktree,
        isMobileWeb,
      );
    }
    if (actions.selectedWorktree) {
      const updated = workspace.worktrees.find((w) => w.name === actions.selectedWorktree!.name);
      if (updated && JSON.stringify(updated) !== JSON.stringify(actions.selectedWorktree)) {
        actions.setSelectedWorktree(updated);
      }
    }
  }, [
    actions,
    isMobileWeb,
    pendingAutoSelectWorktree,
    workspace.currentWorkspace,
    workspace.worktrees,
  ]);

  useEffect(() => {
    const wsName = workspace.currentWorkspace?.name;
    const title = !wsName
      ? "Worktree Manager"
      : `${wsName} - ${actions.selectedWorktree ? actions.selectedWorktree.name : t("app.mainWorkspace")}`;
    setWindowTitle(title);
  }, [actions.selectedWorktree, t, workspace.currentWorkspace?.name]);

  const handleTerminalTabContextMenu = useCallback(
    (e: React.MouseEvent, path: string, name: string) => {
      e.preventDefault();
      e.stopPropagation();
      setTerminalTabMenu({ x: e.clientX, y: e.clientY, path, name });
    },
    [],
  );

  const openSettings = useCallback(() => {
    setViewMode("settings");
  }, []);

  const { saveConfig, setError } = workspace;
  const handleSaveConfig = useCallback(
    async (config: WorkspaceConfig) => {
      try {
        await saveConfig(config);
        setViewMode("main");
      } catch (e) {
        setError(String(e));
      }
    },
    [saveConfig, setError],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const hasOpenDialog = document.querySelector('[role="dialog"][data-state="open"]');
      if (e.key === "Escape") {
        if (hasOpenDialog) return;
        if (viewMode === "settings") {
          setViewMode("main");
          return;
        }
        if (terminalFullscreen) {
          setTerminalFullscreen(false);
          return;
        }
        actions.setContextMenu(null);
        actions.setArchiveModal(null);
        modals.setModal("showEditorMenu", false);
        modals.setModal("showWorkspaceMenu", false);
        setTerminalTabMenu(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && isTauri()) {
        e.preventDefault();
        if (viewMode === "main" && workspace.config) {
          actions.openCreateModal();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "," && isTauri()) {
        e.preventDefault();
        if (viewMode === "main") openSettings();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "[") {
        e.preventDefault();
        if (viewMode === "settings") setViewMode("main");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        if (viewMode === "main") setSidebarCollapsed((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShowShortcutHelp((prev) => !prev);
      }
    }
    function handleClick(): void {
      setTerminalTabMenu(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleClick);
    };
  }, [actions, modals, openSettings, terminalFullscreen, viewMode, workspace.config]);

  return {
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
    selectedWorktree,
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
  };
}

