use std::fs;
use std::path::PathBuf;

use crate::config::{
    get_window_workspace_config, get_window_workspace_path, get_workspace_config_path,
    load_global_config, save_global_config_internal, save_workspace_config_internal,
};
use crate::state::{WINDOW_WORKSPACES, WORKSPACE_CONFIG_CACHE};
use crate::types::{default_linked_workspace_items, WorkspaceConfig, WorkspaceRef};
use crate::utils::normalize_path;

// ==================== Tauri 命令：Workspace 管理 ====================

#[tauri::command]
pub(crate) fn list_workspaces() -> Vec<WorkspaceRef> {
    let global = load_global_config();
    global.workspaces
}

pub fn get_current_workspace_impl(window_label: &str) -> Option<WorkspaceRef> {
    let global = load_global_config();
    let current_path = get_window_workspace_path(window_label)?;
    global
        .workspaces
        .iter()
        .find(|w| w.path == current_path)
        .cloned()
}

#[tauri::command]
pub(crate) fn get_current_workspace(window: tauri::Window) -> Option<WorkspaceRef> {
    get_current_workspace_impl(window.label())
}

pub fn switch_workspace_impl(window_label: &str, path: String) -> Result<(), String> {
    let mut global = load_global_config();

    let previous = global.current_workspace.clone().unwrap_or_else(|| "<none>".to_string());
    log::info!(
        "[workspace] Switching workspace: from='{}' to='{}' (window={})",
        previous, path, window_label
    );

    // 验证 workspace 存在
    if !global.workspaces.iter().any(|w| w.path == path) {
        log::error!("[workspace] Workspace not found: {}", path);
        return Err("Workspace not found".to_string());
    }

    global.current_workspace = Some(path.clone());
    save_global_config_internal(&global)?;

    // 绑定窗口 workspace
    {
        let mut map = WINDOW_WORKSPACES.lock().unwrap();
        map.insert(window_label.to_string(), path.clone());
    }

    // 清除 workspace 配置缓存
    {
        let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        *cache = None;
    }

    log::info!("[workspace] Successfully switched to workspace '{}'", path);
    Ok(())
}

#[tauri::command]
pub(crate) fn switch_workspace(window: tauri::Window, path: String) -> Result<(), String> {
    switch_workspace_impl(window.label(), path)
}

#[tauri::command]
pub(crate) fn add_workspace(name: String, path: String) -> Result<(), String> {
    log::info!("[workspace] Adding workspace: name='{}', path='{}'", name, path);
    let mut global = load_global_config();

    // 检查是否已存在
    if global.workspaces.iter().any(|w| w.path == path) {
        log::warn!("[workspace] Workspace already exists at path: {}", path);
        return Err("Workspace with this path already exists".to_string());
    }

    // 检查路径是否存在
    let workspace_path = PathBuf::from(&path);
    if !workspace_path.exists() {
        log::error!("[workspace] Path does not exist: {}", path);
        return Err("Path does not exist".to_string());
    }

    // 添加到列表
    global.workspaces.push(WorkspaceRef {
        name: name.clone(),
        path: path.clone(),
    });

    // 如果是第一个或者当前没有选中的，则设为当前
    if global.current_workspace.is_none() {
        log::info!("[workspace] Setting as current workspace (first workspace)");
        global.current_workspace = Some(path.clone());
    }

    save_global_config_internal(&global)?;

    // 如果 workspace 目录下没有配置文件，创建默认配置
    let ws_config_path = get_workspace_config_path(&path);
    if !ws_config_path.exists() {
        log::info!("[workspace] Creating default workspace config at {:?}", ws_config_path);
        let mut default_ws_config = WorkspaceConfig::default();
        default_ws_config.name = name.clone();
        save_workspace_config_internal(&path, &default_ws_config)?;
    }

    log::info!("[workspace] Successfully added workspace '{}' at '{}'", name, path);
    Ok(())
}

#[tauri::command]
pub(crate) fn remove_workspace(path: String) -> Result<(), String> {
    log::info!("[workspace] Removing workspace at path: '{}'", path);
    let mut global = load_global_config();

    let count_before = global.workspaces.len();
    // 移除
    global.workspaces.retain(|w| w.path != path);
    let removed = count_before - global.workspaces.len();

    if removed == 0 {
        log::warn!("[workspace] No workspace found at path: {}", path);
    }

    // 如果删除的是当前选中的，切换到第一个
    if global.current_workspace.as_ref() == Some(&path) {
        let new_current = global.workspaces.first().map(|w| w.path.clone());
        log::info!(
            "[workspace] Removed current workspace, switching to: {}",
            new_current.as_deref().unwrap_or("<none>")
        );
        global.current_workspace = new_current;
    }

    save_global_config_internal(&global)?;

    log::info!("[workspace] Successfully removed workspace '{}'", path);
    Ok(())
}

#[tauri::command]
pub(crate) fn create_workspace(name: String, path: String) -> Result<(), String> {
    log::info!("[workspace] Creating new workspace: name='{}', path='{}'", name, path);
    let workspace_path = PathBuf::from(&path);

    // 创建目录结构
    log::info!("[workspace] Creating directory structure at {}", path);
    fs::create_dir_all(workspace_path.join("projects"))
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;
    fs::create_dir_all(workspace_path.join("worktrees"))
        .map_err(|e| format!("Failed to create worktrees directory: {}", e))?;

    // 创建 workspace 配置
    log::info!("[workspace] Saving workspace config");
    let ws_config = WorkspaceConfig {
        name: name.clone(),
        worktrees_dir: "worktrees".to_string(),
        projects: vec![],
        linked_workspace_items: default_linked_workspace_items(),
    };
    save_workspace_config_internal(&path, &ws_config)?;

    // 添加到全局配置
    add_workspace(name.clone(), path.clone())?;

    log::info!("[workspace] Successfully created workspace '{}' at '{}'", name, path);
    Ok(())
}

// ==================== Tauri 命令：Workspace 配置 ====================

pub fn get_workspace_config_impl(window_label: &str) -> Result<WorkspaceConfig, String> {
    let (_, config) = get_window_workspace_config(window_label).ok_or("No workspace selected")?;
    Ok(config)
}

#[tauri::command]
pub(crate) fn get_workspace_config(window: tauri::Window) -> Result<WorkspaceConfig, String> {
    get_workspace_config_impl(window.label())
}

pub fn save_workspace_config_impl(
    window_label: &str,
    config: WorkspaceConfig,
) -> Result<(), String> {
    let workspace_path = get_window_workspace_path(window_label).ok_or("No workspace selected")?;
    save_workspace_config_internal(&workspace_path, &config)
}

#[tauri::command]
pub(crate) fn save_workspace_config(
    window: tauri::Window,
    config: WorkspaceConfig,
) -> Result<(), String> {
    save_workspace_config_impl(window.label(), config)
}

pub fn get_config_path_info_impl(window_label: &str) -> String {
    if let Some(workspace_path) = get_window_workspace_path(window_label) {
        normalize_path(&get_workspace_config_path(&workspace_path).to_string_lossy())
    } else {
        normalize_path(&crate::config::get_global_config_path().to_string_lossy())
    }
}

#[tauri::command]
pub(crate) fn get_config_path_info(window: tauri::Window) -> String {
    get_config_path_info_impl(window.label())
}

// ==================== HTTP Server 共享接口 ====================

pub fn add_workspace_internal(name: &str, path: &str) -> Result<(), String> {
    let mut global = load_global_config();
    if global.workspaces.iter().any(|w| w.path == path) {
        return Err("Workspace with this path already exists".to_string());
    }
    let workspace_path = PathBuf::from(path);
    if !workspace_path.exists() {
        return Err("Path does not exist".to_string());
    }
    global.workspaces.push(WorkspaceRef {
        name: name.to_string(),
        path: path.to_string(),
    });
    if global.current_workspace.is_none() {
        global.current_workspace = Some(path.to_string());
    }
    save_global_config_internal(&global)?;
    let ws_config_path = get_workspace_config_path(path);
    if !ws_config_path.exists() {
        let mut default_ws_config = WorkspaceConfig::default();
        default_ws_config.name = name.to_string();
        save_workspace_config_internal(path, &default_ws_config)?;
    }
    Ok(())
}

pub fn remove_workspace_internal(path: &str) -> Result<(), String> {
    let mut global = load_global_config();
    global.workspaces.retain(|w| w.path != path);
    if global.current_workspace.as_ref().map(|s| s.as_str()) == Some(path) {
        global.current_workspace = global.workspaces.first().map(|w| w.path.clone());
    }
    save_global_config_internal(&global)?;
    Ok(())
}

pub fn create_workspace_internal(name: &str, path: &str) -> Result<(), String> {
    let workspace_path = PathBuf::from(path);
    fs::create_dir_all(workspace_path.join("projects"))
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;
    fs::create_dir_all(workspace_path.join("worktrees"))
        .map_err(|e| format!("Failed to create worktrees directory: {}", e))?;
    let ws_config = WorkspaceConfig {
        name: name.to_string(),
        worktrees_dir: "worktrees".to_string(),
        projects: vec![],
        linked_workspace_items: default_linked_workspace_items(),
    };
    save_workspace_config_internal(path, &ws_config)?;
    add_workspace_internal(name, path)?;
    Ok(())
}
