use std::collections::HashMap;
use tauri::Emitter;

use crate::config::load_global_config;
use crate::state::{
    LOCK_BROADCAST, TERMINAL_STATES, TERMINAL_STATE_BROADCAST, WINDOW_WORKSPACES, WORKTREE_LOCKS,
};
use crate::types::TerminalState;

// ==================== 多窗口管理 ====================

pub fn set_window_workspace_impl(window_label: &str, workspace_path: String) -> Result<(), String> {
    let global = load_global_config();
    if !global.workspaces.iter().any(|w| w.path == workspace_path) {
        return Err("Workspace not found".to_string());
    }

    let mut map = WINDOW_WORKSPACES.lock().unwrap();
    map.insert(window_label.to_string(), workspace_path);
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
    let map = WINDOW_WORKSPACES.lock().unwrap();
    map.values().cloned().collect()
}

pub fn unregister_window_impl(window_label: &str) {
    let label = window_label.to_string();
    {
        let mut map = WINDOW_WORKSPACES.lock().unwrap();
        map.remove(&label);
    }
    // 同时释放该窗口持有的所有 worktree 锁
    let affected_workspaces: Vec<String> = {
        let mut locks = WORKTREE_LOCKS.lock().unwrap();
        let affected: Vec<String> = locks
            .iter()
            .filter(|(_, v)| **v == label)
            .map(|((ws_path, _), _)| ws_path.clone())
            .collect();
        locks.retain(|_, v| *v != label);
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
        let mut locks = WORKTREE_LOCKS.lock().unwrap();
        let key = (workspace_path.clone(), worktree_name.clone());

        if let Some(existing_label) = locks.get(&key) {
            if *existing_label != label {
                return Err(format!("Worktree \"{}\" 已在其他窗口中打开", worktree_name));
            }
        }
        locks.insert(key, label);
    }
    broadcast_lock_state(&workspace_path);
    Ok(())
}

#[tauri::command]
pub(crate) fn lock_worktree(
    window: tauri::Window,
    workspace_path: String,
    worktree_name: String,
) -> Result<(), String> {
    lock_worktree_impl(window.label(), workspace_path, worktree_name)
}

/// 解锁当前窗口持有的指定 worktree
pub fn unlock_worktree_impl(window_label: &str, workspace_path: String, worktree_name: String) {
    let label = window_label.to_string();
    {
        let mut locks = WORKTREE_LOCKS.lock().unwrap();
        let key = (workspace_path.clone(), worktree_name);
        if let Some(existing_label) = locks.get(&key) {
            if *existing_label == label {
                locks.remove(&key);
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
) {
    unlock_worktree_impl(window.label(), workspace_path, worktree_name)
}

/// 获取指定 workspace 中所有被锁定的 worktree 列表 (worktree_name -> window_label)
#[tauri::command]
pub(crate) fn get_locked_worktrees(workspace_path: String) -> HashMap<String, String> {
    let locks = WORKTREE_LOCKS.lock().unwrap();
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
pub(crate) fn broadcast_terminal_state(
    app: tauri::AppHandle,
    workspace_path: String,
    worktree_name: String,
    activated_terminals: Vec<String>,
    active_terminal_tab: Option<String>,
    terminal_visible: bool,
    client_id: Option<String>,
) {
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
        }),
    );
}

#[tauri::command]
pub(crate) async fn open_workspace_window(
    app: tauri::AppHandle,
    workspace_path: String,
) -> Result<String, String> {
    let global = load_global_config();
    if !global.workspaces.iter().any(|w| w.path == workspace_path) {
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
            .map_err(|e| format!("Failed to create window: {}", e))?;

    // 注册窗口绑定
    {
        let mut map = WINDOW_WORKSPACES.lock().unwrap();
        map.insert(window_label.clone(), workspace_path);
    }

    Ok(window_label)
}

/// Broadcast the current lock state for a given workspace to all WebSocket clients.
/// `locks` must already be dropped before calling this to avoid deadlocks.
pub(crate) fn broadcast_lock_state(workspace_path: &str) {
    let lock_snapshot: HashMap<String, String> = {
        let locks = WORKTREE_LOCKS.lock().unwrap();
        locks
            .iter()
            .filter(|((wp, _), _)| *wp == workspace_path)
            .map(|((_, wt), lbl)| (wt.clone(), lbl.clone()))
            .collect()
    };
    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
        "workspacePath": workspace_path,
        "locks": lock_snapshot,
    })) {
        let _ = LOCK_BROADCAST.send(json_str);
    }
}

// ==================== DevTools ====================

#[tauri::command]
pub(crate) fn open_devtools(webview_window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    webview_window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = webview_window;
}
