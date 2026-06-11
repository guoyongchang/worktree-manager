use std::fs;
use std::path::PathBuf;

use crate::config::{
    get_window_workspace_config, get_window_workspace_path, get_workspace_config_path,
    load_global_config, save_global_config_internal, save_workspace_config_internal,
};
use crate::state::{WINDOW_WORKSPACES, WORKSPACE_CONFIG_CACHE};
use crate::types::{
    default_linked_workspace_items, default_uat_branch, WorkspaceConfig, WorkspaceRef,
};
use crate::utils::normalize_path;

// ==================== Tauri 命令：Workspace 管理 ====================

#[tauri::command]
pub(crate) fn list_workspaces() -> Vec<WorkspaceRef> {
    let global = load_global_config();
    global
        .workspaces
        .into_iter()
        .map(|mut w| {
            w.path = normalize_path(&w.path);
            w
        })
        .collect()
}

pub fn get_current_workspace_impl(window_label: &str) -> Option<WorkspaceRef> {
    let global = load_global_config();
    let current_path = get_window_workspace_path(window_label)?;
    global
        .workspaces
        .iter()
        .find(|w| w.path == current_path)
        .cloned()
        .map(|mut w| {
            w.path = normalize_path(&w.path);
            w
        })
}

#[tauri::command]
pub(crate) fn get_current_workspace(
    window: tauri::Window,
    workspace_path: Option<String>,
) -> Option<WorkspaceRef> {
    if let Some(path) = workspace_path {
        let global = load_global_config();
        global
            .workspaces
            .iter()
            .find(|w| w.path == path)
            .cloned()
            .map(|mut w| {
                w.path = normalize_path(&w.path);
                w
            })
    } else {
        get_current_workspace_impl(window.label())
    }
}

pub fn switch_workspace_impl(window_label: &str, path: String) -> Result<(), String> {
    let path = normalize_path(&path);
    let mut global = load_global_config();

    let previous = global
        .current_workspace
        .clone()
        .unwrap_or_else(|| "<none>".to_string());
    log::info!(
        "[workspace] Switching workspace: from='{}' to='{}' (window={})",
        previous,
        path,
        window_label
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
        let mut map = WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        map.insert(window_label.to_string(), path.clone());
    }

    // 清除 workspace 配置缓存
    {
        let mut cache = WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cache = None;
    }

    log::info!("[workspace] Successfully switched to workspace '{}'", path);
    Ok(())
}

#[tauri::command]
pub(crate) fn switch_workspace(
    window: tauri::Window,
    path: String,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if workspace_path.is_some() {
        // Non-primary cell: verify workspace exists but don't bind to window
        let global = load_global_config();
        if !global.workspaces.iter().any(|w| w.path == path) {
            return Err("Workspace not found".to_string());
        }
        // Clear config cache so fresh data is loaded
        let mut cache = WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cache = None;
        Ok(())
    } else {
        switch_workspace_impl(window.label(), path)
    }
}

#[tauri::command]
pub(crate) fn add_workspace(name: String, path: String) -> Result<(), String> {
    let path = normalize_path(&path);
    log::info!(
        "[workspace] Adding workspace: name='{}', path='{}'",
        name,
        path
    );
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

    // 自动创建 projects/ 目录（如果不存在）
    let projects_dir = workspace_path.join("projects");
    if !projects_dir.exists() {
        fs::create_dir_all(&projects_dir)
            .map_err(|e| format!("Failed to create projects directory: {}", e))?;
        log::info!(
            "[workspace] Auto-created projects/ directory at {:?}",
            projects_dir
        );
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
        log::info!(
            "[workspace] Creating default workspace config at {:?}",
            ws_config_path
        );
        let default_ws_config = WorkspaceConfig {
            name: name.clone(),
            ..WorkspaceConfig::default()
        };
        save_workspace_config_internal(&path, &default_ws_config)?;
    }

    log::info!(
        "[workspace] Successfully added workspace '{}' at '{}'",
        name,
        path
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn remove_workspace(path: String) -> Result<(), String> {
    let path = normalize_path(&path);
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
    let path = normalize_path(&path);
    log::info!(
        "[workspace] Creating new workspace: name='{}', path='{}'",
        name,
        path
    );
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
        vault_linked_workspace_items: vec![],
        uat_branch: default_uat_branch(),
        archived_worktrees: vec![],
        worktree_colors: std::collections::HashMap::new(),
        tags: vec![],
    };
    save_workspace_config_internal(&path, &ws_config)?;

    // 添加到全局配置
    add_workspace(name.clone(), path.clone())?;

    log::info!(
        "[workspace] Successfully created workspace '{}' at '{}'",
        name,
        path
    );
    Ok(())
}

// ==================== Tauri 命令：Workspace 配置 ====================

pub fn get_workspace_config_impl(window_label: &str) -> Result<WorkspaceConfig, String> {
    let (_, config) = get_window_workspace_config(window_label).ok_or("No workspace selected")?;
    Ok(config)
}

#[tauri::command]
pub(crate) fn get_workspace_config(
    window: tauri::Window,
    workspace_path: Option<String>,
) -> Result<WorkspaceConfig, String> {
    if let Some(path) = workspace_path {
        Ok(crate::config::load_workspace_config(&path))
    } else {
        get_workspace_config_impl(window.label())
    }
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
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(path) = workspace_path {
        save_workspace_config_internal(&path, &config)
    } else {
        save_workspace_config_impl(window.label(), config)
    }
}

#[tauri::command]
pub(crate) fn load_workspace_config_by_path(path: String) -> Result<WorkspaceConfig, String> {
    Ok(crate::config::load_workspace_config(&path))
}

#[tauri::command]
pub(crate) fn save_workspace_config_by_path(
    path: String,
    config: WorkspaceConfig,
) -> Result<(), String> {
    save_workspace_config_internal(&path, &config)
}

pub fn get_config_path_info_impl(window_label: &str) -> String {
    if let Some(workspace_path) = get_window_workspace_path(window_label) {
        normalize_path(&get_workspace_config_path(&workspace_path).to_string_lossy())
    } else {
        normalize_path(&crate::config::get_global_config_path().to_string_lossy())
    }
}

#[tauri::command]
pub(crate) fn get_config_path_info(
    window: tauri::Window,
    workspace_path: Option<String>,
) -> String {
    if let Some(path) = workspace_path {
        normalize_path(&get_workspace_config_path(&path).to_string_lossy())
    } else {
        get_config_path_info_impl(window.label())
    }
}

// ==================== HTTP Server 共享接口 ====================

pub fn add_workspace_internal(name: &str, path: &str) -> Result<(), String> {
    let path = normalize_path(path);
    let path = path.as_str();
    let mut global = load_global_config();
    if global.workspaces.iter().any(|w| w.path == path) {
        return Err("Workspace with this path already exists".to_string());
    }
    let workspace_path = PathBuf::from(path);
    if !workspace_path.exists() {
        return Err("Path does not exist".to_string());
    }

    // 自动创建 projects/ 目录（如果不存在）
    let projects_dir = workspace_path.join("projects");
    if !projects_dir.exists() {
        fs::create_dir_all(&projects_dir)
            .map_err(|e| format!("Failed to create projects directory: {}", e))?;
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
        let default_ws_config = WorkspaceConfig {
            name: name.to_string(),
            ..WorkspaceConfig::default()
        };
        save_workspace_config_internal(path, &default_ws_config)?;
    }
    Ok(())
}

pub fn remove_workspace_internal(path: &str) -> Result<(), String> {
    let path = normalize_path(path);
    let path = path.as_str();
    let mut global = load_global_config();
    global.workspaces.retain(|w| w.path != path);
    if global.current_workspace.as_deref() == Some(path) {
        global.current_workspace = global.workspaces.first().map(|w| w.path.clone());
    }
    save_global_config_internal(&global)?;
    Ok(())
}

pub fn create_workspace_internal(name: &str, path: &str) -> Result<(), String> {
    let path = normalize_path(path);
    let path = path.as_str();
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
        vault_linked_workspace_items: vec![],
        uat_branch: default_uat_branch(),
        archived_worktrees: vec![],
        worktree_colors: std::collections::HashMap::new(),
        tags: vec![],
    };
    save_workspace_config_internal(path, &ws_config)?;
    add_workspace_internal(name, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{GLOBAL_CONFIG_CACHE, WINDOW_WORKSPACES, WORKSPACE_CONFIG_CACHE};
    use crate::types::{GlobalConfig, ProjectConfig, WorkspaceConfig, WorkspaceRef};
    use serial_test::serial;
    use std::path::{Path, PathBuf};
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

    struct WorkspaceCommandStateGuard {
        _lock: NamedTestLock,
        previous_global: Option<GlobalConfig>,
        previous_workspace_cache: Option<(String, WorkspaceConfig)>,
        previous_home: Option<String>,
        #[cfg(target_os = "windows")]
        previous_appdata: Option<String>,
        #[cfg(target_os = "windows")]
        previous_userprofile: Option<String>,
        window_labels: Vec<String>,
        _temp_home: tempfile::TempDir,
    }

    impl WorkspaceCommandStateGuard {
        fn with_global_config(config: GlobalConfig) -> Self {
            let lock = NamedTestLock::acquire();
            let temp_home = tempfile::tempdir().expect("create temp config home");
            let previous_home = std::env::var("HOME").ok();
            #[cfg(target_os = "windows")]
            let previous_appdata = std::env::var("APPDATA").ok();
            #[cfg(target_os = "windows")]
            let previous_userprofile = std::env::var("USERPROFILE").ok();

            set_config_root(temp_home.path());
            let previous_global = replace_global_cache(Some(config));
            let previous_workspace_cache = replace_workspace_cache(None);

            Self {
                _lock: lock,
                previous_global,
                previous_workspace_cache,
                previous_home,
                #[cfg(target_os = "windows")]
                previous_appdata,
                #[cfg(target_os = "windows")]
                previous_userprofile,
                window_labels: Vec::new(),
                _temp_home: temp_home,
            }
        }

        fn track_window(&mut self, label: &str) {
            self.window_labels.push(label.to_string());
        }
    }

    impl Drop for WorkspaceCommandStateGuard {
        fn drop(&mut self) {
            let mut windows = WINDOW_WORKSPACES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for label in &self.window_labels {
                windows.remove(label);
            }
            drop(windows);

            let _ = replace_workspace_cache(self.previous_workspace_cache.take());
            let _ = replace_global_cache(self.previous_global.take());
            restore_env_var("HOME", &self.previous_home);
            #[cfg(target_os = "windows")]
            {
                restore_env_var("APPDATA", &self.previous_appdata);
                restore_env_var("USERPROFILE", &self.previous_userprofile);
            }
        }
    }

    fn replace_global_cache(config: Option<GlobalConfig>) -> Option<GlobalConfig> {
        let mut cache = GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::replace(&mut *cache, config)
    }

    fn replace_workspace_cache(
        config: Option<(String, WorkspaceConfig)>,
    ) -> Option<(String, WorkspaceConfig)> {
        let mut cache = WORKSPACE_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::replace(&mut *cache, config)
    }

    fn set_config_root(path: &Path) {
        #[cfg(target_os = "windows")]
        {
            std::env::set_var("APPDATA", path);
            std::env::remove_var("USERPROFILE");
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::env::set_var("HOME", path);
        }
    }

    fn restore_env_var(key: &str, value: &Option<String>) {
        match value {
            Some(previous) => std::env::set_var(key, previous),
            None => std::env::remove_var(key),
        }
    }

    fn unique_label(name: &str) -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("workspace-test-{}-{}-{nanos}", std::process::id(), name)
    }

    fn workspace_ref(name: &str, path: &Path) -> WorkspaceRef {
        WorkspaceRef {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
        }
    }

    #[serial]
    #[test]
    fn add_workspace_internal_creates_projects_dir_config_and_global_entry() {
        let _guard = WorkspaceCommandStateGuard::with_global_config(GlobalConfig::default());
        let config_path = crate::config::get_global_config_path();
        let workspace = tempfile::tempdir().expect("create workspace");
        let workspace_path = workspace.path().to_string_lossy().to_string();

        add_workspace_internal("Demo", &workspace_path).expect("add workspace");
        let global: GlobalConfig = serde_json::from_str(
            &std::fs::read_to_string(config_path).expect("read saved global config"),
        )
        .expect("parse saved global config");
        let config = crate::config::load_workspace_config(&workspace_path);

        assert!(workspace.path().join("projects").is_dir());
        assert_eq!(global.workspaces.len(), 1);
        assert_eq!(global.workspaces[0].name, "Demo");
        assert_eq!(global.workspaces[0].path, workspace_path);
        assert_eq!(
            global.current_workspace.as_deref(),
            Some(workspace_path.as_str())
        );
        assert_eq!(config.name, "Demo");
    }

    #[serial]
    #[test]
    fn add_workspace_internal_rejects_missing_path_and_duplicate_path() {
        let _guard = WorkspaceCommandStateGuard::with_global_config(GlobalConfig::default());
        let workspace = tempfile::tempdir().expect("create workspace");
        let missing = workspace.path().join("missing");
        let existing = workspace.path().to_string_lossy().to_string();

        let missing_err = add_workspace_internal("Missing", &missing.to_string_lossy())
            .expect_err("missing path");
        add_workspace_internal("First", &existing).expect("add first workspace");
        let duplicate_err =
            add_workspace_internal("Duplicate", &existing).expect_err("duplicate path");

        assert_eq!(missing_err, "Path does not exist");
        assert_eq!(duplicate_err, "Workspace with this path already exists");
    }

    #[serial]
    #[test]
    fn remove_workspace_internal_removes_current_and_selects_next_workspace() {
        let first = tempfile::tempdir().expect("create first workspace");
        let second = tempfile::tempdir().expect("create second workspace");
        let first_ref = workspace_ref("First", first.path());
        let second_ref = workspace_ref("Second", second.path());
        let config = GlobalConfig {
            workspaces: vec![first_ref.clone(), second_ref.clone()],
            current_workspace: Some(first_ref.path.clone()),
            ..GlobalConfig::default()
        };
        let _guard = WorkspaceCommandStateGuard::with_global_config(config);
        let config_path = crate::config::get_global_config_path();

        remove_workspace_internal(&first_ref.path).expect("remove current workspace");
        let global: GlobalConfig = serde_json::from_str(
            &std::fs::read_to_string(config_path).expect("read saved global config"),
        )
        .expect("parse saved global config");

        assert_eq!(global.workspaces.len(), 1);
        assert_eq!(global.workspaces[0].path, second_ref.path);
        assert_eq!(
            global.current_workspace.as_deref(),
            Some(second_ref.path.as_str())
        );
    }

    #[serial]
    #[test]
    fn workspace_config_impl_round_trips_for_bound_window() {
        let mut guard = WorkspaceCommandStateGuard::with_global_config(GlobalConfig::default());
        let workspace = tempfile::tempdir().expect("create workspace");
        let workspace_path = workspace.path().to_string_lossy().to_string();
        let label = unique_label("round-trip");
        WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(label.clone(), workspace_path.clone());
        guard.track_window(&label);
        let config = WorkspaceConfig {
            name: "Configured Workspace".to_string(),
            worktrees_dir: "trees".to_string(),
            projects: vec![ProjectConfig {
                name: "api".to_string(),
                base_branch: "main".to_string(),
                test_branch: "uat".to_string(),
                merge_strategy: "merge".to_string(),
                linked_folders: vec!["target".to_string()],
                commit_prefix_index: Some(0),
                git_user_name: Some("Tester".to_string()),
                git_user_email: Some("tester@example.com".to_string()),
                tags: vec!["backend".to_string()],
            }],
            archived_worktrees: vec!["old".to_string()],
            ..WorkspaceConfig::default()
        };

        save_workspace_config_impl(&label, config.clone()).expect("save workspace config");
        let _ = replace_workspace_cache(None);
        let loaded = get_workspace_config_impl(&label).expect("load workspace config");

        assert_eq!(loaded.name, "Configured Workspace");
        assert_eq!(loaded.worktrees_dir, "trees");
        assert_eq!(loaded.projects[0].name, "api");
        assert_eq!(loaded.projects[0].linked_folders, vec!["target"]);
        assert_eq!(loaded.archived_worktrees, vec!["old"]);
    }

    #[serial]
    #[test]
    fn switch_workspace_impl_binds_window_and_rejects_unknown_workspace() {
        let mut guard = WorkspaceCommandStateGuard::with_global_config(GlobalConfig::default());
        let config_path = crate::config::get_global_config_path();
        let workspace = tempfile::tempdir().expect("create workspace");
        let workspace_ref = workspace_ref("Switch", workspace.path());
        let _ = replace_global_cache(Some(GlobalConfig {
            workspaces: vec![workspace_ref.clone()],
            current_workspace: None,
            ..GlobalConfig::default()
        }));
        let label = unique_label("switch");
        guard.track_window(&label);

        switch_workspace_impl(&label, workspace_ref.path.clone()).expect("switch workspace");
        let bound = WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&label)
            .cloned()
            .expect("window binding");
        let saved: GlobalConfig = serde_json::from_str(
            &std::fs::read_to_string(config_path).expect("read saved global config"),
        )
        .expect("parse saved global config");
        let missing_err =
            switch_workspace_impl(&label, "/definitely/missing".to_string()).unwrap_err();

        assert_eq!(bound, workspace_ref.path);
        assert_eq!(
            saved.current_workspace.as_deref(),
            Some(workspace_ref.path.as_str())
        );
        assert_eq!(missing_err, "Workspace not found");
    }

    #[serial]
    #[test]
    fn get_config_path_info_uses_bound_workspace_before_global_config_path() {
        let mut guard = WorkspaceCommandStateGuard::with_global_config(GlobalConfig::default());
        let workspace = tempfile::tempdir().expect("create workspace");
        let workspace_path = workspace.path().to_string_lossy().to_string();
        let label = unique_label("path-info");
        WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(label.clone(), workspace_path.clone());
        guard.track_window(&label);

        let bound_path = get_config_path_info_impl(&label);
        let fallback_path = get_config_path_info_impl("unbound-window-label");

        assert_eq!(
            bound_path,
            normalize_path(
                &crate::config::get_workspace_config_path(&workspace_path).to_string_lossy()
            )
        );
        assert_eq!(
            fallback_path,
            normalize_path(&crate::config::get_global_config_path().to_string_lossy())
        );
    }
}

#[cfg(test)]
mod coverage_completion_tests {
    use super::*;
    use crate::state::{GLOBAL_CONFIG_CACHE, WINDOW_WORKSPACES, WORKSPACE_CONFIG_CACHE};
    use crate::types::{GlobalConfig, WorkspaceConfig, WorkspaceRef};
    use serial_test::serial;
    use std::path::{Path, PathBuf};
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
        previous_workspace_cache: Option<(String, WorkspaceConfig)>,
        previous_windows: std::collections::HashMap<String, String>,
        previous_home: Option<String>,
        #[cfg(target_os = "windows")]
        previous_appdata: Option<String>,
        #[cfg(target_os = "windows")]
        previous_userprofile: Option<String>,
        _temp_home: tempfile::TempDir,
    }

    impl StateGuard {
        fn with_global(config: GlobalConfig) -> Self {
            let lock = NamedTestLock::acquire();
            let temp_home = tempfile::tempdir().expect("create temp workspace config home");
            let previous_home = std::env::var("HOME").ok();
            #[cfg(target_os = "windows")]
            let previous_appdata = std::env::var("APPDATA").ok();
            #[cfg(target_os = "windows")]
            let previous_userprofile = std::env::var("USERPROFILE").ok();
            set_config_root(temp_home.path());

            let previous_global = {
                let mut cache = GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };
            let previous_workspace_cache = {
                let mut cache = WORKSPACE_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *cache)
            };
            let previous_windows = {
                let mut windows = WINDOW_WORKSPACES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *windows)
            };

            Self {
                _lock: lock,
                previous_global,
                previous_workspace_cache,
                previous_windows,
                previous_home,
                #[cfg(target_os = "windows")]
                previous_appdata,
                #[cfg(target_os = "windows")]
                previous_userprofile,
                _temp_home: temp_home,
            }
        }
    }

    impl Drop for StateGuard {
        fn drop(&mut self) {
            let mut windows = WINDOW_WORKSPACES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *windows = std::mem::take(&mut self.previous_windows);
            drop(windows);

            let mut workspace_cache = WORKSPACE_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *workspace_cache = self.previous_workspace_cache.take();
            drop(workspace_cache);

            let mut global_cache = GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *global_cache = self.previous_global.take();

            restore_env_var("HOME", &self.previous_home);
            #[cfg(target_os = "windows")]
            {
                restore_env_var("APPDATA", &self.previous_appdata);
                restore_env_var("USERPROFILE", &self.previous_userprofile);
            }
        }
    }

    fn set_config_root(path: &Path) {
        #[cfg(target_os = "windows")]
        {
            std::env::set_var("APPDATA", path);
            std::env::remove_var("USERPROFILE");
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::env::set_var("HOME", path);
        }
    }

    fn restore_env_var(key: &str, value: &Option<String>) {
        match value {
            Some(previous) => std::env::set_var(key, previous),
            None => std::env::remove_var(key),
        }
    }

    fn workspace_ref(name: &str, path: &Path) -> WorkspaceRef {
        WorkspaceRef {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
        }
    }

    #[serial]
    #[test]
    fn workspace_commands_create_list_update_switch_and_delete_round_trip() {
        let _guard = StateGuard::with_global(GlobalConfig::default());
        let temp = tempfile::tempdir().expect("create parent directory");
        let workspace_path = temp
            .path()
            .join("created-workspace")
            .to_string_lossy()
            .to_string();

        create_workspace("Created".to_string(), workspace_path.clone()).expect("create workspace");
        let listed = list_workspaces();
        let loaded = load_workspace_config_by_path(workspace_path.clone()).expect("load config");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Created");
        assert_eq!(listed[0].path, normalize_path(&workspace_path));
        assert!(PathBuf::from(&workspace_path).join("projects").is_dir());
        assert!(PathBuf::from(&workspace_path).join("worktrees").is_dir());
        assert_eq!(loaded.name, "Created");

        let updated = WorkspaceConfig {
            name: "Updated".to_string(),
            worktrees_dir: "trees".to_string(),
            ..WorkspaceConfig::default()
        };
        save_workspace_config_by_path(workspace_path.clone(), updated).expect("save config");
        let reloaded = load_workspace_config_by_path(workspace_path.clone()).expect("reload");
        assert_eq!(reloaded.name, "Updated");
        assert_eq!(reloaded.worktrees_dir, "trees");

        switch_workspace_impl("workspace-extra-window", workspace_path.clone())
            .expect("switch workspace");
        assert_eq!(
            get_current_workspace_impl("workspace-extra-window")
                .expect("current workspace")
                .name,
            "Created"
        );

        remove_workspace(workspace_path.clone()).expect("remove workspace");
        assert!(list_workspaces().is_empty());
        assert!(get_current_workspace_impl("workspace-extra-window").is_none());
    }

    #[serial]
    #[test]
    fn workspace_path_resolution_errors_are_specific() {
        let _guard = StateGuard::with_global(GlobalConfig::default());
        let missing = tempfile::tempdir()
            .expect("create parent")
            .path()
            .join("missing")
            .to_string_lossy()
            .to_string();

        assert_eq!(
            get_workspace_config_impl("unbound-window").unwrap_err(),
            "No workspace selected"
        );
        assert_eq!(
            save_workspace_config_impl("unbound-window", WorkspaceConfig::default()).unwrap_err(),
            "No workspace selected"
        );
        assert_eq!(
            add_workspace("Missing".to_string(), missing).unwrap_err(),
            "Path does not exist"
        );
        assert_eq!(
            switch_workspace_impl("unbound-window", "/not/registered".to_string()).unwrap_err(),
            "Workspace not found"
        );
    }

    #[serial]
    #[test]
    fn current_workspace_impl_uses_bound_window_before_global_fallback() {
        let first = tempfile::tempdir().expect("create first workspace");
        let second = tempfile::tempdir().expect("create second workspace");
        let first_ref = workspace_ref("First", first.path());
        let second_ref = workspace_ref("Second", second.path());
        let _guard = StateGuard::with_global(GlobalConfig {
            workspaces: vec![first_ref.clone(), second_ref.clone()],
            current_workspace: Some(first_ref.path.clone()),
            ..GlobalConfig::default()
        });

        WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert("bound-window".to_string(), second_ref.path.clone());

        let bound = get_current_workspace_impl("bound-window").expect("bound workspace");
        let fallback = get_current_workspace_impl("unbound-window").expect("fallback workspace");

        assert_eq!(bound.name, "Second");
        assert_eq!(bound.path, normalize_path(&second_ref.path));
        assert_eq!(fallback.name, "First");
        assert_eq!(fallback.path, normalize_path(&first_ref.path));
    }
}
