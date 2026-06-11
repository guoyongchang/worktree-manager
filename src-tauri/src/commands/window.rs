use std::collections::HashMap;
use tauri::Emitter;

use crate::config::{load_global_config, load_occupation_state};
use crate::state::{
    APP_HANDLE, LOCK_BROADCAST, TERMINAL_STATES, TERMINAL_STATE_BROADCAST, WINDOW_WORKSPACES,
    WORKTREE_LOCKS,
};
use crate::types::TerminalState;

// ==================== 多窗口管理 ====================

pub fn set_window_workspace_impl(window_label: &str, workspace_path: String) -> Result<(), String> {
    let global = load_global_config();
    if !global.workspaces.iter().any(|w| w.path == workspace_path) {
        log::warn!(
            "[window] Workspace not found for binding: label={}, path={}",
            window_label,
            workspace_path
        );
        return Err("Workspace not found".to_string());
    }

    let mut map = WINDOW_WORKSPACES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    map.insert(window_label.to_string(), workspace_path.clone());
    log::info!(
        "[window] Window '{}' bound to workspace '{}'",
        window_label,
        workspace_path
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn set_window_workspace(
    window: tauri::Window,
    workspace_path: String,
) -> Result<(), String> {
    set_window_workspace_impl(window.label(), workspace_path)
}

#[tauri::command]
pub(crate) fn get_opened_workspaces() -> Vec<String> {
    let map = WINDOW_WORKSPACES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    map.values().cloned().collect()
}

pub fn unregister_window_impl(window_label: &str) {
    log::info!("[window] Unregistering window '{}'", window_label);
    let label = window_label.to_string();
    {
        let mut map = WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.remove(&label);
    }
    // 同时释放该窗口持有的所有 worktree 锁（包括带 cell_id 的格式 "label:cell_id"）
    let prefix = format!("{}:", window_label);
    let affected_workspaces: Vec<String> = {
        let mut locks = WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let lock_count = locks
            .iter()
            .filter(|(_, v)| **v == label || v.starts_with(&prefix))
            .count();
        let affected: Vec<String> = locks
            .iter()
            .filter(|(_, v)| **v == label || v.starts_with(&prefix))
            .map(|((ws_path, _), _)| ws_path.clone())
            .collect();
        locks.retain(|_, v| *v != label && !v.starts_with(&prefix));
        log::info!(
            "[window] Window '{}' unregistered, released {} locks",
            window_label,
            lock_count
        );
        affected
    };
    for ws_path in affected_workspaces {
        broadcast_lock_state(&ws_path);
    }
}

#[tauri::command]
pub(crate) fn unregister_window(window: tauri::Window) {
    unregister_window_impl(window.label())
}

/// 锁定 worktree 到当前窗口，如果该 worktree 已被其他窗口锁定则返回错误
pub fn lock_worktree_impl(
    window_label: &str,
    workspace_path: String,
    worktree_name: String,
) -> Result<(), String> {
    let label = window_label.to_string();
    {
        let mut locks = WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let key = (workspace_path.clone(), worktree_name.clone());

        if let Some(existing_label) = locks.get(&key) {
            if *existing_label != label {
                log::warn!(
                    "[window] Lock conflict: wt={} already locked by '{}', requested by '{}'",
                    worktree_name,
                    existing_label,
                    label
                );
                return Err(format!("Worktree \"{}\" 已在其他窗口中打开", worktree_name));
            }
        }
        locks.insert(key, label);
    }
    log::info!(
        "[window] Worktree locked: ws={}, wt={}, by={}",
        workspace_path,
        worktree_name,
        window_label
    );
    broadcast_lock_state(&workspace_path);
    Ok(())
}

#[tauri::command]
pub(crate) fn lock_worktree(
    window: tauri::Window,
    workspace_path: String,
    worktree_name: String,
    cell_id: Option<String>,
) -> Result<(), String> {
    let label = match cell_id {
        Some(id) => format!("{}:{}", window.label(), id),
        None => window.label().to_string(),
    };
    lock_worktree_impl(&label, workspace_path, worktree_name)
}

/// 解锁当前窗口持有的指定 worktree
pub fn unlock_worktree_impl(window_label: &str, workspace_path: String, worktree_name: String) {
    let label = window_label.to_string();
    {
        let mut locks = WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let key = (workspace_path.clone(), worktree_name.clone());
        if let Some(existing_label) = locks.get(&key) {
            if *existing_label == label {
                locks.remove(&key);
                log::info!(
                    "[window] Worktree unlocked: ws={}, wt={}, by={}",
                    workspace_path,
                    worktree_name,
                    window_label
                );
            }
        }
    }
    broadcast_lock_state(&workspace_path);
}

#[tauri::command]
pub(crate) fn unlock_worktree(
    window: tauri::Window,
    workspace_path: String,
    worktree_name: String,
    cell_id: Option<String>,
) {
    let label = match cell_id {
        Some(id) => format!("{}:{}", window.label(), id),
        None => window.label().to_string(),
    };
    unlock_worktree_impl(&label, workspace_path, worktree_name)
}

/// 获取指定 workspace 中所有被锁定的 worktree 列表 (worktree_name -> window_label)
#[tauri::command]
pub(crate) fn get_locked_worktrees(workspace_path: String) -> HashMap<String, String> {
    let locks = WORKTREE_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks
        .iter()
        .filter(|((ws_path, _), _)| *ws_path == workspace_path)
        .map(|((_, wt_name), label)| (wt_name.clone(), label.clone()))
        .collect()
}

/// 获取缓存的终端状态（用于客户端首次打开 worktree 时同步）
pub(crate) fn get_terminal_state_inner(
    workspace_path: String,
    worktree_name: String,
) -> Option<TerminalState> {
    let key = (workspace_path, worktree_name);
    TERMINAL_STATES
        .lock()
        .ok()
        .and_then(|states| states.get(&key).cloned())
}

#[tauri::command]
pub(crate) fn get_terminal_state(
    workspace_path: String,
    worktree_name: String,
) -> Option<TerminalState> {
    get_terminal_state_inner(workspace_path, worktree_name)
}

/// 广播终端状态变化（用于桌面端同步到网页端）
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn broadcast_terminal_state(
    app: tauri::AppHandle,
    workspace_path: String,
    worktree_name: String,
    activated_terminals: Vec<String>,
    active_terminal_tab: Option<String>,
    terminal_visible: bool,
    client_id: Option<String>,
    session_id: Option<String>,
) {
    log::debug!(
        "[window] Broadcasting terminal state: ws={}, wt={}",
        workspace_path,
        worktree_name
    );
    let key = (workspace_path.clone(), worktree_name.clone());

    // 更新缓存
    if let Ok(mut states) = TERMINAL_STATES.lock() {
        states.insert(
            key,
            TerminalState {
                activated_terminals: activated_terminals.clone(),
                active_terminal_tab: active_terminal_tab.clone(),
                terminal_visible,
                client_id: client_id.clone(),
                session_id: session_id.clone(),
            },
        );
    }

    // 广播给所有连接的客户端（WebSocket）
    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
        "workspacePath": workspace_path,
        "worktreeName": worktree_name,
        "activatedTerminals": activated_terminals,
        "activeTerminalTab": active_terminal_tab,
        "terminalVisible": terminal_visible,
        "clientId": client_id,
        "sessionId": session_id,
    })) {
        let _ = TERMINAL_STATE_BROADCAST.send(json_str);
    }

    // 同时通过 Tauri 事件发送给所有桌面端窗口
    let _ = app.emit(
        "terminal-state-update",
        serde_json::json!({
            "workspacePath": workspace_path,
            "worktreeName": worktree_name,
            "activatedTerminals": activated_terminals,
            "activeTerminalTab": active_terminal_tab,
            "terminalVisible": terminal_visible,
            "clientId": client_id,
            "sessionId": session_id,
        }),
    );
}

#[tauri::command]
pub(crate) async fn open_workspace_window(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<String, String> {
    log::info!(
        "[window] Opening new workspace window for: {}",
        workspace_path
    );
    let global = load_global_config();
    if !global.workspaces.iter().any(|w| w.path == workspace_path) {
        log::warn!(
            "[window] Workspace not found when opening window: {}",
            workspace_path
        );
        return Err("Workspace not found".to_string());
    }

    let ws_name = global
        .workspaces
        .iter()
        .find(|w| w.path == workspace_path)
        .map(|w| w.name.clone())
        .unwrap_or_else(|| "Worktree Manager".to_string());

    let window_label = format!(
        "workspace-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let url = format!(
        "index.html?workspace={}",
        urlencoding::encode(&workspace_path)
    );

    let _webview =
        tauri::WebviewWindowBuilder::new(&app, &window_label, tauri::WebviewUrl::App(url.into()))
            .title(format!("Worktree Manager - {}", ws_name))
            .inner_size(1300.0, 900.0)
            .min_inner_size(900.0, 500.0)
            .build()
            .map_err(|e| {
                log::error!("[window] Failed to create window: {}", e);
                format!("Failed to create window: {}", e)
            })?;

    // 注册窗口绑定
    {
        let mut map = WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.insert(window_label.clone(), workspace_path.clone());
    }

    log::info!(
        "[window] Created window '{}' for workspace '{}'",
        window_label,
        workspace_path
    );
    Ok(window_label)
}

/// Broadcast the current lock state for a given workspace to all WebSocket clients.
/// `locks` must already be dropped before calling this to avoid deadlocks.
pub(crate) fn broadcast_lock_state(workspace_path: &str) {
    let lock_snapshot: HashMap<String, String> = {
        let locks = WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        locks
            .iter()
            .filter(|((wp, _), _)| *wp == workspace_path)
            .map(|((_, wt), lbl)| (wt.clone(), lbl.clone()))
            .collect()
    };
    log::debug!(
        "[window] Broadcasting lock state for ws={}, locks={}",
        workspace_path,
        lock_snapshot.len()
    );
    let occupation = load_occupation_state(workspace_path);
    let payload = serde_json::json!({
        "workspacePath": workspace_path,
        "locks": lock_snapshot,
        "occupation": occupation,
    });

    if let Ok(json_str) = serde_json::to_string(&payload) {
        let _ = LOCK_BROADCAST.send(json_str);
    }

    if let Some(app_handle) = APP_HANDLE.lock().ok().and_then(|handle| handle.clone()) {
        let _ = app_handle.emit("lock-state-update", payload);
    }
}

// ==================== DevTools ====================

#[tauri::command]
pub(crate) fn open_devtools(webview_window: tauri::WebviewWindow) {
    #[cfg(any(debug_assertions, feature = "devtools"))]
    webview_window.open_devtools();
    #[cfg(not(any(debug_assertions, feature = "devtools")))]
    {
        log::warn!("[window] DevTools requested but this build was compiled without devtools");
        let _ = webview_window;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{GLOBAL_CONFIG_CACHE, TERMINAL_STATES};
    use crate::types::{GlobalConfig, TerminalState, WorkspaceRef};
    use serial_test::serial;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::Duration;

    struct NamedTestLock {
        path: PathBuf,
    }

    impl NamedTestLock {
        fn acquire() -> Self {
            let path = std::env::temp_dir().join("worktree-manager-command-test-global-lock");
            loop {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(e) => panic!("failed to acquire test lock at {:?}: {}", path, e),
                }
            }
        }
    }

    impl Drop for NamedTestLock {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    struct WindowCommandStateGuard {
        _lock: NamedTestLock,
        previous_global: Option<GlobalConfig>,
        previous_windows: HashMap<String, String>,
        previous_locks: HashMap<(String, String), String>,
        previous_terminal_states: HashMap<(String, String), TerminalState>,
    }

    impl WindowCommandStateGuard {
        fn with_global_config(config: GlobalConfig) -> Self {
            let lock = NamedTestLock::acquire();
            let previous_global = {
                let mut cache = GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };
            let previous_windows = {
                let mut windows = WINDOW_WORKSPACES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *windows)
            };
            let previous_locks = {
                let mut locks = WORKTREE_LOCKS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *locks)
            };
            let previous_terminal_states = {
                let mut states = TERMINAL_STATES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *states)
            };
            Self {
                _lock: lock,
                previous_global,
                previous_windows,
                previous_locks,
                previous_terminal_states,
            }
        }
    }

    impl Drop for WindowCommandStateGuard {
        fn drop(&mut self) {
            let mut states = TERMINAL_STATES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *states = std::mem::take(&mut self.previous_terminal_states);
            drop(states);

            let mut locks = WORKTREE_LOCKS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *locks = std::mem::take(&mut self.previous_locks);
            drop(locks);

            let mut windows = WINDOW_WORKSPACES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *windows = std::mem::take(&mut self.previous_windows);
            drop(windows);

            let mut cache = GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous_global.take();
        }
    }

    fn global_with_workspace(path: &str) -> GlobalConfig {
        GlobalConfig {
            workspaces: vec![WorkspaceRef {
                name: "Window Test".to_string(),
                path: path.to_string(),
            }],
            current_workspace: Some(path.to_string()),
            ..GlobalConfig::default()
        }
    }

    fn temp_workspace_path() -> (tempfile::TempDir, String) {
        let temp = tempfile::tempdir().expect("create workspace");
        let path = temp.path().to_string_lossy().to_string();
        (temp, path)
    }

    #[serial]
    #[test]
    fn set_unregister_and_query_window_workspace_mapping() {
        let (_temp, workspace_path) = temp_workspace_path();
        let _guard =
            WindowCommandStateGuard::with_global_config(global_with_workspace(&workspace_path));

        set_window_workspace_impl("window-a", workspace_path.clone()).expect("bind window");
        let opened = get_opened_workspaces();
        unregister_window_impl("window-a");

        assert_eq!(opened, vec![workspace_path]);
        assert!(get_opened_workspaces().is_empty());
    }

    #[serial]
    #[test]
    fn set_window_workspace_rejects_unknown_workspace_without_binding() {
        let _guard = WindowCommandStateGuard::with_global_config(GlobalConfig::default());

        let err = set_window_workspace_impl("window-a", "/missing/workspace".to_string())
            .expect_err("unknown workspace should fail");

        assert_eq!(err, "Workspace not found");
        assert!(get_opened_workspaces().is_empty());
    }

    #[serial]
    #[test]
    fn lock_worktree_allows_same_owner_and_blocks_other_owner() {
        let (_temp, workspace_path) = temp_workspace_path();
        let _guard =
            WindowCommandStateGuard::with_global_config(global_with_workspace(&workspace_path));

        lock_worktree_impl("window-a", workspace_path.clone(), "feature-a".to_string())
            .expect("first lock");
        lock_worktree_impl("window-a", workspace_path.clone(), "feature-a".to_string())
            .expect("same owner can refresh lock");
        let err = lock_worktree_impl("window-b", workspace_path.clone(), "feature-a".to_string())
            .expect_err("other owner should conflict");
        let locked = get_locked_worktrees(workspace_path);

        assert!(err.contains("feature-a"), "unexpected error: {err}");
        assert_eq!(locked.get("feature-a"), Some(&"window-a".to_string()));
        assert_eq!(locked.len(), 1);
    }

    #[serial]
    #[test]
    fn unlock_worktree_only_removes_lock_for_current_owner() {
        let (_temp, workspace_path) = temp_workspace_path();
        let _guard =
            WindowCommandStateGuard::with_global_config(global_with_workspace(&workspace_path));

        lock_worktree_impl("owner", workspace_path.clone(), "feature-a".to_string())
            .expect("lock worktree");
        unlock_worktree_impl("other", workspace_path.clone(), "feature-a".to_string());
        let still_locked = get_locked_worktrees(workspace_path.clone());
        unlock_worktree_impl("owner", workspace_path.clone(), "feature-a".to_string());
        let unlocked = get_locked_worktrees(workspace_path);

        assert_eq!(still_locked.get("feature-a"), Some(&"owner".to_string()));
        assert!(unlocked.is_empty());
    }

    #[serial]
    #[test]
    fn unregister_window_releases_plain_and_cell_locks_for_that_window_only() {
        let (_temp, workspace_path) = temp_workspace_path();
        let _guard =
            WindowCommandStateGuard::with_global_config(global_with_workspace(&workspace_path));

        lock_worktree_impl("window-a", workspace_path.clone(), "feature-a".to_string())
            .expect("plain lock");
        lock_worktree_impl(
            "window-a:cell-1",
            workspace_path.clone(),
            "feature-b".to_string(),
        )
        .expect("cell lock");
        lock_worktree_impl("window-b", workspace_path.clone(), "feature-c".to_string())
            .expect("other window lock");

        unregister_window_impl("window-a");
        let locked = get_locked_worktrees(workspace_path);

        assert!(!locked.contains_key("feature-a"));
        assert!(!locked.contains_key("feature-b"));
        assert_eq!(locked.get("feature-c"), Some(&"window-b".to_string()));
    }

    #[serial]
    #[test]
    fn lock_keys_are_isolated_by_workspace_and_worktree_name() {
        let (_temp_a, workspace_a) = temp_workspace_path();
        let (_temp_b, workspace_b) = temp_workspace_path();
        let config = GlobalConfig {
            workspaces: vec![
                WorkspaceRef {
                    name: "A".to_string(),
                    path: workspace_a.clone(),
                },
                WorkspaceRef {
                    name: "B".to_string(),
                    path: workspace_b.clone(),
                },
            ],
            ..GlobalConfig::default()
        };
        let _guard = WindowCommandStateGuard::with_global_config(config);

        lock_worktree_impl("window-a", workspace_a.clone(), "feature".to_string())
            .expect("lock workspace a");
        lock_worktree_impl("window-b", workspace_b.clone(), "feature".to_string())
            .expect("same worktree name in different workspace is isolated");
        lock_worktree_impl("window-c", workspace_a.clone(), "other".to_string())
            .expect("different worktree in same workspace is isolated");

        let locked_a = get_locked_worktrees(workspace_a);
        let locked_b = get_locked_worktrees(workspace_b);

        assert_eq!(locked_a.get("feature"), Some(&"window-a".to_string()));
        assert_eq!(locked_a.get("other"), Some(&"window-c".to_string()));
        assert_eq!(locked_b.get("feature"), Some(&"window-b".to_string()));
    }

    #[serial]
    #[test]
    fn terminal_state_cache_round_trips_by_workspace_and_worktree_key() {
        let (_temp, workspace_path) = temp_workspace_path();
        let _guard =
            WindowCommandStateGuard::with_global_config(global_with_workspace(&workspace_path));

        TERMINAL_STATES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                (workspace_path.clone(), "feature-a".to_string()),
                TerminalState {
                    activated_terminals: vec!["shell".to_string()],
                    active_terminal_tab: Some("shell".to_string()),
                    terminal_visible: true,
                    client_id: Some("client-1".to_string()),
                    session_id: Some("pty-1".to_string()),
                },
            );

        let found = get_terminal_state(workspace_path.clone(), "feature-a".to_string())
            .expect("cached terminal state");
        let missing = get_terminal_state(workspace_path, "feature-b".to_string());

        assert_eq!(found.activated_terminals, vec!["shell"]);
        assert_eq!(found.active_terminal_tab.as_deref(), Some("shell"));
        assert!(found.terminal_visible);
        assert_eq!(found.client_id.as_deref(), Some("client-1"));
        assert_eq!(found.session_id.as_deref(), Some("pty-1"));
        assert!(missing.is_none());
    }
}

#[cfg(test)]
mod coverage_completion_tests {
    use super::*;
    use crate::state::{APP_HANDLE, GLOBAL_CONFIG_CACHE, TERMINAL_STATES};
    use crate::types::{GlobalConfig, TerminalState, WorkspaceRef};
    use serial_test::serial;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::time::Duration;

    struct NamedTestLock {
        path: PathBuf,
    }

    impl NamedTestLock {
        fn acquire() -> Self {
            let path = std::env::temp_dir().join("worktree-manager-command-test-global-lock");
            loop {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(err) => panic!("failed to acquire test lock {:?}: {}", path, err),
                }
            }
        }
    }

    impl Drop for NamedTestLock {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    struct StateGuard {
        _lock: NamedTestLock,
        previous_global: Option<GlobalConfig>,
        previous_windows: HashMap<String, String>,
        previous_locks: HashMap<(String, String), String>,
        previous_terminal_states: HashMap<(String, String), TerminalState>,
        previous_app_handle: Option<tauri::AppHandle>,
    }

    impl StateGuard {
        fn with_workspaces(paths: &[String]) -> Self {
            let lock = NamedTestLock::acquire();
            let config = GlobalConfig {
                workspaces: paths
                    .iter()
                    .enumerate()
                    .map(|(index, path)| WorkspaceRef {
                        name: format!("Workspace {index}"),
                        path: path.clone(),
                    })
                    .collect(),
                current_workspace: paths.first().cloned(),
                ..GlobalConfig::default()
            };
            let previous_global = {
                let mut cache = GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };
            let previous_windows = {
                let mut windows = WINDOW_WORKSPACES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *windows)
            };
            let previous_locks = {
                let mut locks = WORKTREE_LOCKS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *locks)
            };
            let previous_terminal_states = {
                let mut states = TERMINAL_STATES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *states)
            };
            let previous_app_handle = APP_HANDLE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take();

            Self {
                _lock: lock,
                previous_global,
                previous_windows,
                previous_locks,
                previous_terminal_states,
                previous_app_handle,
            }
        }
    }

    impl Drop for StateGuard {
        fn drop(&mut self) {
            *APP_HANDLE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = self.previous_app_handle.take();

            let mut states = TERMINAL_STATES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *states = std::mem::take(&mut self.previous_terminal_states);
            drop(states);

            let mut locks = WORKTREE_LOCKS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *locks = std::mem::take(&mut self.previous_locks);
            drop(locks);

            let mut windows = WINDOW_WORKSPACES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *windows = std::mem::take(&mut self.previous_windows);
            drop(windows);

            let mut cache = GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous_global.take();
        }
    }

    fn temp_workspace_path() -> (tempfile::TempDir, String) {
        let temp = tempfile::tempdir().expect("create workspace");
        let path = temp.path().to_string_lossy().to_string();
        (temp, path)
    }

    #[serial]
    #[test]
    fn unregister_window_without_matching_locks_preserves_other_state() {
        let (_temp_a, workspace_a) = temp_workspace_path();
        let (_temp_b, workspace_b) = temp_workspace_path();
        let _guard = StateGuard::with_workspaces(&[workspace_a.clone(), workspace_b.clone()]);
        WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert("window-b".to_string(), workspace_b.clone());
        WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                (workspace_b.clone(), "feature-b".to_string()),
                "window-b".to_string(),
            );

        unregister_window_impl("window-a");

        assert_eq!(get_opened_workspaces(), vec![workspace_b.clone()]);
        assert_eq!(
            get_locked_worktrees(workspace_b).get("feature-b"),
            Some(&"window-b".to_string())
        );
    }

    #[serial]
    #[test]
    fn broadcast_lock_state_sends_workspace_specific_snapshot() {
        let (_temp_a, workspace_a) = temp_workspace_path();
        let (_temp_b, workspace_b) = temp_workspace_path();
        let _guard = StateGuard::with_workspaces(&[workspace_a.clone(), workspace_b.clone()]);
        WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .extend([
                (
                    (workspace_a.clone(), "feature-a".to_string()),
                    "window-a".to_string(),
                ),
                (
                    (workspace_b.clone(), "feature-b".to_string()),
                    "window-b".to_string(),
                ),
            ]);
        let mut receiver = LOCK_BROADCAST.subscribe();

        broadcast_lock_state(&workspace_a);
        let payload: serde_json::Value = serde_json::from_str(
            &receiver
                .try_recv()
                .expect("lock broadcast should contain one payload"),
        )
        .expect("lock payload json");

        assert_eq!(payload["workspacePath"], workspace_a);
        assert_eq!(payload["locks"]["feature-a"], "window-a");
        assert!(payload["locks"].get("feature-b").is_none());
        assert!(payload["occupation"].is_null());
    }

    #[serial]
    #[test]
    fn lock_unlock_transitions_broadcast_each_state_change() {
        let (_temp, workspace_path) = temp_workspace_path();
        let _guard = StateGuard::with_workspaces(std::slice::from_ref(&workspace_path));
        let mut receiver = LOCK_BROADCAST.subscribe();

        lock_worktree_impl("window-a", workspace_path.clone(), "feature-a".to_string())
            .expect("lock feature");
        let locked_payload: serde_json::Value =
            serde_json::from_str(&receiver.try_recv().expect("lock broadcast after lock"))
                .expect("lock json");
        assert_eq!(locked_payload["locks"]["feature-a"], "window-a");

        unlock_worktree_impl("window-a", workspace_path, "feature-a".to_string());
        let unlocked_payload: serde_json::Value =
            serde_json::from_str(&receiver.try_recv().expect("lock broadcast after unlock"))
                .expect("unlock json");
        assert_eq!(
            unlocked_payload["locks"]
                .as_object()
                .expect("locks object")
                .len(),
            0
        );
    }

    #[serial]
    #[test]
    fn window_workspace_map_matrix_isolated_by_labels_and_paths() {
        let (_temp_a, workspace_a) = temp_workspace_path();
        let (_temp_b, workspace_b) = temp_workspace_path();
        let (_temp_c, workspace_c) = temp_workspace_path();
        let _guard = StateGuard::with_workspaces(&[
            workspace_a.clone(),
            workspace_b.clone(),
            workspace_c.clone(),
        ]);

        set_window_workspace_impl("main", workspace_a.clone()).expect("bind main");
        set_window_workspace_impl("secondary", workspace_b.clone()).expect("bind secondary");
        set_window_workspace_impl("detached", workspace_c.clone()).expect("bind detached");
        set_window_workspace_impl("secondary", workspace_c.clone()).expect("rebind secondary");

        let opened = get_opened_workspaces();
        assert!(opened.contains(&workspace_a));
        assert!(opened.contains(&workspace_c));
        assert!(!opened.contains(&workspace_b));
        assert_eq!(opened.len(), 3);

        let map = WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(map.get("main"), Some(&workspace_a));
        assert_eq!(map.get("secondary"), Some(&workspace_c));
        assert_eq!(map.get("detached"), Some(&workspace_c));
        assert_eq!(map.len(), 3);
    }

    #[serial]
    #[test]
    fn worktree_lock_matrix_keeps_workspace_worktree_and_owner_boundaries() {
        let (_temp_a, workspace_a) = temp_workspace_path();
        let (_temp_b, workspace_b) = temp_workspace_path();
        let _guard = StateGuard::with_workspaces(&[workspace_a.clone(), workspace_b.clone()]);
        let lock_cases = [
            ("window-a", workspace_a.clone(), "feature-alpha", true),
            ("window-a", workspace_a.clone(), "feature-alpha", true),
            ("window-b", workspace_a.clone(), "feature-alpha", false),
            ("window-b", workspace_a.clone(), "feature-beta", true),
            ("window-c", workspace_b.clone(), "feature-alpha", true),
            ("window-c:cell-1", workspace_b.clone(), "feature-cell", true),
            (
                "window-c:cell-2",
                workspace_b.clone(),
                "feature-cell",
                false,
            ),
            ("window-d", workspace_a.clone(), "feature-delta", true),
        ];

        for (owner, workspace, worktree, should_succeed) in lock_cases {
            let result = lock_worktree_impl(owner, workspace, worktree.to_string());

            assert_eq!(result.is_ok(), should_succeed, "{owner}:{worktree}");
        }

        let locked_a = get_locked_worktrees(workspace_a.clone());
        assert_eq!(locked_a.get("feature-alpha"), Some(&"window-a".to_string()));
        assert_eq!(locked_a.get("feature-beta"), Some(&"window-b".to_string()));
        assert_eq!(locked_a.get("feature-delta"), Some(&"window-d".to_string()));
        assert_eq!(locked_a.len(), 3);

        let locked_b = get_locked_worktrees(workspace_b.clone());
        assert_eq!(locked_b.get("feature-alpha"), Some(&"window-c".to_string()));
        assert_eq!(
            locked_b.get("feature-cell"),
            Some(&"window-c:cell-1".to_string())
        );
        assert_eq!(locked_b.len(), 2);

        unlock_worktree_impl("window-x", workspace_a.clone(), "feature-alpha".to_string());
        assert_eq!(
            get_locked_worktrees(workspace_a.clone()).get("feature-alpha"),
            Some(&"window-a".to_string())
        );
        unlock_worktree_impl("window-a", workspace_a.clone(), "feature-alpha".to_string());
        assert!(!get_locked_worktrees(workspace_a).contains_key("feature-alpha"));
    }

    #[serial]
    #[test]
    fn unregister_window_matrix_removes_plain_and_cell_locks_only_for_matching_window() {
        let (_temp_a, workspace_a) = temp_workspace_path();
        let (_temp_b, workspace_b) = temp_workspace_path();
        let _guard = StateGuard::with_workspaces(&[workspace_a.clone(), workspace_b.clone()]);
        WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .extend([
                ("window-a".to_string(), workspace_a.clone()),
                ("window-b".to_string(), workspace_b.clone()),
                ("window-c".to_string(), workspace_b.clone()),
            ]);
        WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .extend([
                (
                    (workspace_a.clone(), "feature-a".to_string()),
                    "window-a".to_string(),
                ),
                (
                    (workspace_a.clone(), "feature-a-cell".to_string()),
                    "window-a:cell-1".to_string(),
                ),
                (
                    (workspace_b.clone(), "feature-b".to_string()),
                    "window-b".to_string(),
                ),
                (
                    (workspace_b.clone(), "feature-c".to_string()),
                    "window-c:cell-9".to_string(),
                ),
            ]);
        let mut receiver = LOCK_BROADCAST.subscribe();

        unregister_window_impl("window-a");

        let opened = get_opened_workspaces();
        assert!(!opened.contains(&workspace_a));
        assert!(opened.contains(&workspace_b));
        assert_eq!(opened.len(), 2);
        let locked_a = get_locked_worktrees(workspace_a.clone());
        let locked_b = get_locked_worktrees(workspace_b.clone());
        assert!(locked_a.is_empty());
        assert_eq!(locked_b.get("feature-b"), Some(&"window-b".to_string()));
        assert_eq!(
            locked_b.get("feature-c"),
            Some(&"window-c:cell-9".to_string())
        );

        let payload: serde_json::Value =
            serde_json::from_str(&receiver.try_recv().expect("workspace a broadcast"))
                .expect("broadcast json");
        assert_eq!(payload["workspacePath"], workspace_a);
        assert_eq!(payload["locks"].as_object().expect("locks object").len(), 0);
    }

    #[serial]
    #[test]
    fn terminal_state_matrix_round_trips_distinct_tabs_clients_and_sessions() {
        let (_temp_a, workspace_a) = temp_workspace_path();
        let (_temp_b, workspace_b) = temp_workspace_path();
        let _guard = StateGuard::with_workspaces(&[workspace_a.clone(), workspace_b.clone()]);
        let state_cases = [
            (
                workspace_a.clone(),
                "feature-a",
                vec!["shell".to_string()],
                Some("shell".to_string()),
                true,
                Some("client-a".to_string()),
                Some("pty-a".to_string()),
            ),
            (
                workspace_a.clone(),
                "feature-b",
                vec!["shell".to_string(), "logs".to_string()],
                Some("logs".to_string()),
                false,
                Some("client-b".to_string()),
                Some("pty-b".to_string()),
            ),
            (
                workspace_b.clone(),
                "feature-a",
                Vec::new(),
                None,
                false,
                None,
                None,
            ),
        ];

        for (
            workspace,
            worktree,
            activated_terminals,
            active_terminal_tab,
            terminal_visible,
            client_id,
            session_id,
        ) in state_cases
        {
            TERMINAL_STATES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(
                    (workspace.clone(), worktree.to_string()),
                    TerminalState {
                        activated_terminals: activated_terminals.clone(),
                        active_terminal_tab: active_terminal_tab.clone(),
                        terminal_visible,
                        client_id: client_id.clone(),
                        session_id: session_id.clone(),
                    },
                );

            let found = get_terminal_state_inner(workspace, worktree.to_string())
                .expect("terminal state should round trip");

            assert_eq!(found.activated_terminals, activated_terminals);
            assert_eq!(found.active_terminal_tab, active_terminal_tab);
            assert_eq!(found.terminal_visible, terminal_visible);
            assert_eq!(found.client_id, client_id);
            assert_eq!(found.session_id, session_id);
        }

        assert!(get_terminal_state_inner(workspace_b, "missing".to_string()).is_none());
    }
}
