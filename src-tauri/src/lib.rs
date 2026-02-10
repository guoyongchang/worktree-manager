use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use std::fs;
use std::sync::Mutex;
use std::time::Duration;
use once_cell::sync::Lazy;
use wait_timeout::ChildExt;
use log;

mod git_ops;
mod pty_manager;

use git_ops::{get_worktree_info, get_branch_status, BranchStatus};
use pty_manager::PtyManager;

// PTY Manager 全局实例
static PTY_MANAGER: Lazy<Mutex<PtyManager>> = Lazy::new(|| Mutex::new(PtyManager::new()));

// Git command timeout (30 seconds)
const GIT_COMMAND_TIMEOUT_SECS: u64 = 30;

fn run_git_command_with_timeout(args: &[&str], cwd: &str) -> Result<std::process::Output, String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn git command: {}", e))?;

    let timeout = Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS);
    match child.wait_timeout(timeout) {
        Ok(Some(status)) => {
            let stdout = child.stdout.take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            let stderr = child.stderr.take()
                .map(|mut s| {
                    let mut buf = Vec::new();
                    std::io::Read::read_to_end(&mut s, &mut buf).ok();
                    buf
                })
                .unwrap_or_default();
            Ok(std::process::Output { status, stdout, stderr })
        }
        Ok(None) => {
            let _ = child.kill();
            Err(format!("Git command timed out after {} seconds", GIT_COMMAND_TIMEOUT_SECS))
        }
        Err(e) => Err(format!("Failed to wait for git command: {}", e)),
    }
}

// ==================== 配置结构 ====================

// 全局配置：存储在 ~/.config/worktree-manager/global.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlobalConfig {
    pub workspaces: Vec<WorkspaceRef>,
    pub current_workspace: Option<String>,  // 当前选中的 workspace 路径
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceRef {
    pub name: String,
    pub path: String,
}

impl Default for GlobalConfig {
    fn default() -> Self {
        Self {
            workspaces: vec![],
            current_workspace: None,
        }
    }
}

// Workspace 配置：存储在 {workspace_root}/.worktree-manager.json
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceConfig {
    pub name: String,
    pub worktrees_dir: String,  // 相对路径，如 "worktrees"
    pub projects: Vec<ProjectConfig>,
    #[serde(default = "default_linked_workspace_items")]
    pub linked_workspace_items: Vec<String>,  // 要链接到每个 worktree 的全局文件/文件夹
}

fn default_linked_workspace_items() -> Vec<String> {
    vec![
        ".claude".to_string(),
        "CLAUDE.md".to_string(),
        "AGENTS.md".to_string(),
        "requirement-docs".to_string(),
    ]
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectConfig {
    pub name: String,
    pub base_branch: String,
    pub test_branch: String,
    pub merge_strategy: String,
    #[serde(default)]
    pub linked_folders: Vec<String>,  // 要链接的文件夹列表
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            name: "New Workspace".to_string(),
            worktrees_dir: "worktrees".to_string(),
            projects: vec![],
            linked_workspace_items: default_linked_workspace_items(),
        }
    }
}

// ==================== 配置路径 ====================

/// Normalize path separators for the current platform.
/// On Windows, replaces forward slashes with backslashes.
fn normalize_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.replace('/', "\\")
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_string()
    }
}

fn get_global_config_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            return PathBuf::from(appdata).join("worktree-manager").join("global.json");
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            return PathBuf::from(userprofile).join(".config").join("worktree-manager").join("global.json");
        }
        PathBuf::from(".").join("worktree-manager").join("global.json")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join(".config").join("worktree-manager").join("global.json")
    }
}

fn get_workspace_config_path(workspace_path: &str) -> PathBuf {
    PathBuf::from(workspace_path).join(".worktree-manager.json")
}

// ==================== 全局配置缓存 ====================

static GLOBAL_CONFIG_CACHE: Lazy<Mutex<Option<GlobalConfig>>> = Lazy::new(|| Mutex::new(None));
static WORKSPACE_CONFIG_CACHE: Lazy<Mutex<Option<(String, WorkspaceConfig)>>> = Lazy::new(|| Mutex::new(None));

// ==================== 全局配置加载/保存 ====================

fn load_global_config() -> GlobalConfig {
    {
        let cache = GLOBAL_CONFIG_CACHE.lock().unwrap();
        if let Some(ref config) = *cache {
            return config.clone();
        }
    }

    let config_path = get_global_config_path();
    let config = if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(content) => {
                match serde_json::from_str::<GlobalConfig>(&content) {
                    Ok(cfg) => cfg,
                    Err(e) => {
                        log::warn!("Failed to parse global config at {:?}: {}", config_path, e);
                        GlobalConfig::default()
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to read global config at {:?}: {}", config_path, e);
                GlobalConfig::default()
            }
        }
    } else {
        let default_config = GlobalConfig::default();
        let _ = save_global_config_internal(&default_config);
        default_config
    };

    {
        let mut cache = GLOBAL_CONFIG_CACHE.lock().unwrap();
        *cache = Some(config.clone());
    }

    config
}

fn save_global_config_internal(config: &GlobalConfig) -> Result<(), String> {
    let config_path = get_global_config_path();

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    {
        let mut cache = GLOBAL_CONFIG_CACHE.lock().unwrap();
        *cache = Some(config.clone());
    }

    Ok(())
}

// ==================== Workspace 配置加载/保存 ====================

fn load_workspace_config(workspace_path: &str) -> WorkspaceConfig {
    {
        let cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        if let Some((ref cached_path, ref config)) = *cache {
            if cached_path == workspace_path {
                return config.clone();
            }
        }
    }

    let config_path = get_workspace_config_path(workspace_path);
    let config = if config_path.exists() {
        match fs::read_to_string(&config_path) {
            Ok(content) => {
                match serde_json::from_str::<WorkspaceConfig>(&content) {
                    Ok(cfg) => cfg,
                    Err(e) => {
                        log::warn!("Failed to parse workspace config at {:?}: {}", config_path, e);
                        WorkspaceConfig::default()
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to read workspace config at {:?}: {}", config_path, e);
                WorkspaceConfig::default()
            }
        }
    } else {
        let default_config = WorkspaceConfig::default();
        let _ = save_workspace_config_internal(workspace_path, &default_config);
        default_config
    };

    {
        let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        *cache = Some((workspace_path.to_string(), config.clone()));
    }

    config
}

fn save_workspace_config_internal(workspace_path: &str, config: &WorkspaceConfig) -> Result<(), String> {
    let config_path = get_workspace_config_path(workspace_path);

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    {
        let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        *cache = Some((workspace_path.to_string(), config.clone()));
    }

    Ok(())
}

// ==================== 获取当前 Workspace ====================

fn get_current_workspace_path() -> Option<String> {
    let global = load_global_config();
    global.current_workspace
}

fn get_current_workspace_config() -> Option<(String, WorkspaceConfig)> {
    let workspace_path = get_current_workspace_path()?;
    let config = load_workspace_config(&workspace_path);
    Some((workspace_path, config))
}

// ==================== 数据结构 ====================

#[derive(Debug, Serialize)]
pub struct WorktreeListItem {
    pub name: String,
    pub path: String,
    pub is_archived: bool,
    pub projects: Vec<ProjectStatus>,
}

#[derive(Debug, Serialize)]
pub struct ProjectStatus {
    pub name: String,
    pub path: String,
    pub current_branch: String,
    pub base_branch: String,
    pub test_branch: String,
    pub has_uncommitted: bool,
    pub uncommitted_count: usize,
    pub is_merged_to_test: bool,
    pub ahead_of_base: usize,
    pub behind_base: usize,
}

#[derive(Debug, Serialize)]
pub struct MainWorkspaceStatus {
    pub path: String,
    pub name: String,
    pub projects: Vec<MainProjectStatus>,
}

#[derive(Debug, Serialize)]
pub struct MainProjectStatus {
    pub name: String,
    pub current_branch: String,
    pub has_uncommitted: bool,
    pub base_branch: String,
    pub test_branch: String,
    pub linked_folders: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWorktreeRequest {
    pub name: String,
    pub projects: Vec<CreateProjectRequest>,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub base_branch: String,
}

// ==================== Tauri 命令：Workspace 管理 ====================

#[tauri::command]
fn list_workspaces() -> Vec<WorkspaceRef> {
    let global = load_global_config();
    global.workspaces
}

#[tauri::command]
fn get_current_workspace() -> Option<WorkspaceRef> {
    let global = load_global_config();
    let current_path = global.current_workspace?;
    global.workspaces.iter()
        .find(|w| w.path == current_path)
        .cloned()
}

#[tauri::command]
fn switch_workspace(path: String) -> Result<(), String> {
    let mut global = load_global_config();

    // 验证 workspace 存在
    if !global.workspaces.iter().any(|w| w.path == path) {
        return Err("Workspace not found".to_string());
    }

    global.current_workspace = Some(path.clone());
    save_global_config_internal(&global)?;

    // 清除 workspace 配置缓存
    {
        let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        *cache = None;
    }

    Ok(())
}

#[tauri::command]
fn add_workspace(name: String, path: String) -> Result<(), String> {
    let mut global = load_global_config();

    // 检查是否已存在
    if global.workspaces.iter().any(|w| w.path == path) {
        return Err("Workspace with this path already exists".to_string());
    }

    // 检查路径是否存在
    let workspace_path = PathBuf::from(&path);
    if !workspace_path.exists() {
        return Err("Path does not exist".to_string());
    }

    // 添加到列表
    global.workspaces.push(WorkspaceRef {
        name: name.clone(),
        path: path.clone(),
    });

    // 如果是第一个或者当前没有选中的，则设为当前
    if global.current_workspace.is_none() {
        global.current_workspace = Some(path.clone());
    }

    save_global_config_internal(&global)?;

    // 如果 workspace 目录下没有配置文件，创建默认配置
    let ws_config_path = get_workspace_config_path(&path);
    if !ws_config_path.exists() {
        let mut default_ws_config = WorkspaceConfig::default();
        default_ws_config.name = name;
        save_workspace_config_internal(&path, &default_ws_config)?;
    }

    Ok(())
}

#[tauri::command]
fn remove_workspace(path: String) -> Result<(), String> {
    let mut global = load_global_config();

    // 移除
    global.workspaces.retain(|w| w.path != path);

    // 如果删除的是当前选中的，切换到第一个
    if global.current_workspace.as_ref() == Some(&path) {
        global.current_workspace = global.workspaces.first().map(|w| w.path.clone());
    }

    save_global_config_internal(&global)?;

    Ok(())
}

#[tauri::command]
fn create_workspace(name: String, path: String) -> Result<(), String> {
    let workspace_path = PathBuf::from(&path);

    // 创建目录结构
    fs::create_dir_all(workspace_path.join("projects"))
        .map_err(|e| format!("Failed to create workspace directory: {}", e))?;
    fs::create_dir_all(workspace_path.join("worktrees"))
        .map_err(|e| format!("Failed to create worktrees directory: {}", e))?;

    // 创建 workspace 配置
    let ws_config = WorkspaceConfig {
        name: name.clone(),
        worktrees_dir: "worktrees".to_string(),
        projects: vec![],
        linked_workspace_items: default_linked_workspace_items(),
    };
    save_workspace_config_internal(&path, &ws_config)?;

    // 添加到全局配置
    add_workspace(name, path)?;

    Ok(())
}

// ==================== Tauri 命令：Workspace 配置 ====================

#[tauri::command]
fn get_workspace_config() -> Result<WorkspaceConfig, String> {
    let (_, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;
    Ok(config)
}

#[tauri::command]
fn save_workspace_config(config: WorkspaceConfig) -> Result<(), String> {
    let workspace_path = get_current_workspace_path()
        .ok_or("No workspace selected")?;
    save_workspace_config_internal(&workspace_path, &config)
}

#[tauri::command]
fn get_config_path_info() -> String {
    if let Some(workspace_path) = get_current_workspace_path() {
        normalize_path(&get_workspace_config_path(&workspace_path).to_string_lossy())
    } else {
        normalize_path(&get_global_config_path().to_string_lossy())
    }
}

// ==================== Tauri 命令：Worktree 操作 ====================

#[tauri::command]
fn list_worktrees(include_archived: bool) -> Result<Vec<WorktreeListItem>, String> {
    let (workspace_path, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let worktrees_path = PathBuf::from(&workspace_path).join(&config.worktrees_dir);

    if !worktrees_path.exists() {
        return Ok(vec![]);
    }

    scan_worktrees_dir(&worktrees_path, &config, include_archived)
}

fn scan_worktrees_dir(dir: &PathBuf, config: &WorkspaceConfig, include_archived: bool) -> Result<Vec<WorktreeListItem>, String> {
    let mut result = vec![];

    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if name.starts_with('.') {
            continue;
        }

        let is_archived = name.ends_with(".archive");

        if is_archived && !include_archived {
            continue;
        }

        let projects_path = path.join("projects");
        let mut projects = vec![];

        if !projects_path.exists() || !projects_path.is_dir() {
            continue;
        }

        if let Ok(proj_entries) = std::fs::read_dir(&projects_path) {
            for proj_entry in proj_entries.flatten() {
                let proj_path = proj_entry.path();
                if !proj_path.is_dir() {
                    continue;
                }

                let proj_name = proj_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                let proj_config = config.projects.iter()
                    .find(|p| p.name == proj_name)
                    .cloned()
                    .unwrap_or(ProjectConfig {
                        name: proj_name.clone(),
                        base_branch: "uat".to_string(),
                        test_branch: "test".to_string(),
                        merge_strategy: "merge".to_string(),
                        linked_folders: vec![],
                    });

                let info = get_worktree_info(&proj_path);

                projects.push(ProjectStatus {
                    name: proj_name,
                    path: normalize_path(&proj_path.to_string_lossy()),
                    current_branch: info.current_branch,
                    base_branch: proj_config.base_branch,
                    test_branch: proj_config.test_branch,
                    has_uncommitted: info.uncommitted_count > 0,
                    uncommitted_count: info.uncommitted_count,
                    is_merged_to_test: info.is_merged_to_test,
                    ahead_of_base: info.ahead_of_base,
                    behind_base: info.behind_base,
                });
            }
        }

        result.push(WorktreeListItem {
            name,
            path: normalize_path(&path.to_string_lossy()),
            is_archived,
            projects,
        });
    }

    Ok(result)
}

#[tauri::command]
fn get_main_workspace_status() -> Result<MainWorkspaceStatus, String> {
    let (workspace_path, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let root_path = PathBuf::from(&workspace_path);
    let projects_path = root_path.join("projects");

    let mut projects = vec![];

    for proj_config in &config.projects {
        let proj_path = projects_path.join(&proj_config.name);
        if !proj_path.exists() {
            continue;
        }

        let info = get_worktree_info(&proj_path);

        projects.push(MainProjectStatus {
            name: proj_config.name.clone(),
            current_branch: info.current_branch,
            has_uncommitted: info.uncommitted_count > 0,
            base_branch: proj_config.base_branch.clone(),
            test_branch: proj_config.test_branch.clone(),
            linked_folders: proj_config.linked_folders.clone(),
        });
    }

    Ok(MainWorkspaceStatus {
        path: normalize_path(&root_path.to_string_lossy()),
        name: config.name.clone(),
        projects,
    })
}

#[tauri::command]
fn create_worktree(request: CreateWorktreeRequest) -> Result<String, String> {
    let (workspace_path, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&request.name);

    log::info!("Creating worktree '{}'", request.name);

    // Create worktree directory
    std::fs::create_dir_all(worktree_path.join("projects"))
        .map_err(|e| format!("Failed to create worktree directory: {}", e))?;

    // Create symlinks for workspace-level items
    for name in &config.linked_workspace_items {
        let src = root.join(name);
        let dst = worktree_path.join(name);
        if src.exists() && !dst.exists() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(&src, &dst).ok();
        }
    }

    // Create worktrees for each project
    for proj_req in &request.projects {
        let proj_config = config.projects.iter()
            .find(|p| p.name == proj_req.name)
            .cloned()
            .unwrap_or(ProjectConfig {
                name: proj_req.name.clone(),
                base_branch: proj_req.base_branch.clone(),
                test_branch: "test".to_string(),
                merge_strategy: "merge".to_string(),
                linked_folders: vec![],
            });

        let main_proj_path = root.join("projects").join(&proj_req.name);
        let wt_proj_path = worktree_path.join("projects").join(&proj_req.name);

        // Fetch origin first (with timeout)
        run_git_command_with_timeout(
            &["fetch", "origin"],
            main_proj_path.to_str().unwrap(),
        )?;

        // Check if branch already exists
        let branch_check = Command::new("git")
            .args(["-C", main_proj_path.to_str().unwrap(), "branch", "--list", &request.name])
            .output();

        let branch_exists = branch_check
            .as_ref()
            .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
            .unwrap_or(false);

        // Create worktree: use existing branch or create new one
        let output = if branch_exists {
            log::info!("Branch '{}' already exists, using it for project {}", request.name, proj_req.name);
            Command::new("git")
                .args([
                    "-C", main_proj_path.to_str().unwrap(),
                    "worktree", "add",
                    wt_proj_path.to_str().unwrap(),
                    &request.name,
                ])
                .output()
                .map_err(|e| format!("Failed to create worktree: {}", e))?
        } else {
            log::info!("Creating new branch '{}' for project {} from origin/{}", request.name, proj_req.name, proj_req.base_branch);
            Command::new("git")
                .args([
                    "-C", main_proj_path.to_str().unwrap(),
                    "worktree", "add",
                    wt_proj_path.to_str().unwrap(),
                    "-b", &request.name,
                    &format!("origin/{}", proj_req.base_branch),
                ])
                .output()
                .map_err(|e| format!("Failed to create worktree: {}", e))?
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Failed to create worktree for {}: {}", proj_req.name, stderr));
        }

        // Link configured folders
        for folder_name in &proj_config.linked_folders {
            let main_folder = main_proj_path.join(folder_name);
            let wt_folder = wt_proj_path.join(folder_name);

            if main_folder.exists() && !wt_folder.exists() {
                #[cfg(unix)]
                std::os::unix::fs::symlink(&main_folder, &wt_folder).ok();

                // Remove from git index if it's tracked
                Command::new("git")
                    .args(["-C", wt_proj_path.to_str().unwrap(), "rm", "--cached", "-r", folder_name])
                    .output()
                    .ok();
            }
        }
    }

    log::info!("Successfully created worktree '{}'", request.name);
    Ok(normalize_path(&worktree_path.to_string_lossy()))
}

#[tauri::command]
fn archive_worktree(name: String) -> Result<(), String> {
    let (workspace_path, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&name);

    let archive_name = format!("{}.archive", name);
    let archive_path = root.join(&config.worktrees_dir).join(&archive_name);

    if !worktree_path.exists() {
        return Err("Worktree does not exist".to_string());
    }

    log::info!("Archiving worktree '{}'", name);

    // Close all PTY sessions associated with this worktree
    {
        let worktree_path_str = worktree_path.to_string_lossy().to_string();
        if let Ok(mut manager) = PTY_MANAGER.lock() {
            let closed = manager.close_sessions_by_path_prefix(&worktree_path_str);
            if !closed.is_empty() {
                log::info!("Closed {} PTY sessions for archived worktree: {:?}", closed.len(), closed);
            }
        }
    }

    // Remove git worktrees first
    let projects_path = worktree_path.join("projects");
    if projects_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_path) {
            for entry in entries.flatten() {
                let proj_path = entry.path();
                let proj_name = proj_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                let main_proj_path = root.join("projects").join(proj_name);

                Command::new("git")
                    .args([
                        "-C", main_proj_path.to_str().unwrap(),
                        "worktree", "remove", proj_path.to_str().unwrap(), "--force"
                    ])
                    .output()
                    .ok();
            }
        }
    }

    std::fs::rename(&worktree_path, &archive_path)
        .map_err(|e| format!("Failed to archive worktree: {}", e))?;

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct WorktreeArchiveStatus {
    pub name: String,
    pub can_archive: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub projects: Vec<BranchStatus>,
}

#[tauri::command]
fn check_worktree_status(name: String) -> Result<WorktreeArchiveStatus, String> {
    let (workspace_path, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&name);

    if !worktree_path.exists() {
        return Err("Worktree does not exist".to_string());
    }

    let mut status = WorktreeArchiveStatus {
        name: name.clone(),
        can_archive: true,
        warnings: vec![],
        errors: vec![],
        projects: vec![],
    };

    let projects_path = worktree_path.join("projects");
    if !projects_path.exists() {
        return Ok(status);
    }

    if let Ok(entries) = std::fs::read_dir(&projects_path) {
        for entry in entries.flatten() {
            let proj_path = entry.path();
            if !proj_path.is_dir() {
                continue;
            }

            let proj_name = proj_path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let branch_status = get_branch_status(&proj_path, &proj_name);

            if branch_status.has_uncommitted {
                status.errors.push(format!(
                    "{}: {} 个未提交的更改",
                    proj_name, branch_status.uncommitted_count
                ));
                status.can_archive = false;
            }

            if !branch_status.is_pushed {
                if branch_status.unpushed_commits > 0 {
                    status.errors.push(format!(
                        "{}: {} 个未推送的提交",
                        proj_name, branch_status.unpushed_commits
                    ));
                    status.can_archive = false;
                } else {
                    status.warnings.push(format!(
                        "{}: 分支未推送到远端",
                        proj_name
                    ));
                }
            }

            if !branch_status.has_merge_request && branch_status.is_pushed {
                status.warnings.push(format!(
                    "{}: 请确认是否已创建 Merge Request",
                    proj_name
                ));
            }

            status.projects.push(branch_status);
        }
    }

    Ok(status)
}

#[tauri::command]
fn restore_worktree(name: String) -> Result<(), String> {
    let (workspace_path, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let archive_path = root.join(&config.worktrees_dir).join(&name);

    let restored_name = name.strip_suffix(".archive").unwrap_or(&name);
    let worktree_path = root.join(&config.worktrees_dir).join(restored_name);

    if !archive_path.exists() {
        return Err("Archived worktree does not exist".to_string());
    }

    log::info!("Restoring worktree '{}' from archive", restored_name);

    // If target directory already exists, remove it first
    if worktree_path.exists() {
        log::warn!("Target directory already exists, removing: {:?}", worktree_path);
        fs::remove_dir_all(&worktree_path)
            .map_err(|e| format!("Failed to remove existing directory: {}", e))?;
    }

    // Rename archive directory to restored path
    std::fs::rename(&archive_path, &worktree_path)
        .map_err(|e| format!("Failed to restore worktree: {}", e))?;

    // Re-register git worktrees for each project
    let projects_path = worktree_path.join("projects");
    if projects_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_path) {
            for entry in entries.flatten() {
                let proj_path = entry.path();
                if !proj_path.is_dir() {
                    continue;
                }

                let proj_name = proj_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                let main_proj_path = root.join("projects").join(&proj_name);
                if !main_proj_path.exists() {
                    log::warn!("Main project path does not exist for {}, skipping", proj_name);
                    continue;
                }

                // Remove the old project directory content (it was archived without git worktree registration)
                // We need to remove it and re-add via git worktree add
                let wt_proj_path = projects_path.join(&proj_name);

                // Check if branch exists
                let branch_name = restored_name;
                let branch_check = Command::new("git")
                    .args(["-C", main_proj_path.to_str().unwrap(), "branch", "--list", branch_name])
                    .output();

                let branch_exists = branch_check
                    .as_ref()
                    .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
                    .unwrap_or(false);

                // Remove the directory so git worktree add can recreate it
                if wt_proj_path.exists() {
                    fs::remove_dir_all(&wt_proj_path).ok();
                }

                // Prune stale worktrees first
                Command::new("git")
                    .args(["-C", main_proj_path.to_str().unwrap(), "worktree", "prune"])
                    .output()
                    .ok();

                // Re-add worktree
                let output = if branch_exists {
                    log::info!("Re-adding worktree for {} with existing branch {}", proj_name, branch_name);
                    Command::new("git")
                        .args([
                            "-C", main_proj_path.to_str().unwrap(),
                            "worktree", "add",
                            wt_proj_path.to_str().unwrap(),
                            branch_name,
                        ])
                        .output()
                } else {
                    // Find appropriate base branch from project config
                    let base_branch = config.projects.iter()
                        .find(|p| p.name == proj_name)
                        .map(|p| p.base_branch.clone())
                        .unwrap_or_else(|| "uat".to_string());

                    log::info!("Re-adding worktree for {} with new branch {} from origin/{}", proj_name, branch_name, base_branch);
                    Command::new("git")
                        .args([
                            "-C", main_proj_path.to_str().unwrap(),
                            "worktree", "add",
                            wt_proj_path.to_str().unwrap(),
                            "-b", branch_name,
                            &format!("origin/{}", base_branch),
                        ])
                        .output()
                };

                match output {
                    Ok(o) if o.status.success() => {
                        log::info!("Successfully re-added worktree for {}", proj_name);
                    }
                    Ok(o) => {
                        let stderr = String::from_utf8_lossy(&o.stderr);
                        log::error!("Failed to re-add worktree for {}: {}", proj_name, stderr);
                    }
                    Err(e) => {
                        log::error!("Failed to execute git worktree add for {}: {}", proj_name, e);
                    }
                }

                // Restore project-level symlinks (linked_folders)
                let proj_config = config.projects.iter().find(|p| p.name == proj_name);
                if let Some(pc) = proj_config {
                    for folder_name in &pc.linked_folders {
                        let main_folder = main_proj_path.join(folder_name);
                        let wt_folder = wt_proj_path.join(folder_name);

                        if main_folder.exists() && !wt_folder.exists() {
                            #[cfg(unix)]
                            std::os::unix::fs::symlink(&main_folder, &wt_folder).ok();
                        }
                    }
                }
            }
        }
    }

    // Restore workspace-level symlinks
    for item_name in &config.linked_workspace_items {
        let src = root.join(item_name);
        let dst = worktree_path.join(item_name);
        if src.exists() && !dst.exists() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(&src, &dst).ok();
        }
    }

    log::info!("Successfully restored worktree '{}'", restored_name);
    Ok(())
}

#[tauri::command]
fn delete_archived_worktree(name: String) -> Result<(), String> {
    let (workspace_path, config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let archive_path = root.join(&config.worktrees_dir).join(&name);

    // Validate it's an archived worktree
    if !name.ends_with(".archive") {
        return Err("Can only delete archived worktrees".to_string());
    }

    if !archive_path.exists() {
        return Err("Archived worktree does not exist".to_string());
    }

    let branch_name = name.strip_suffix(".archive").unwrap_or(&name);
    log::info!("Deleting archived worktree '{}' (branch: {})", name, branch_name);

    // Close any related PTY sessions
    {
        let archive_path_str = archive_path.to_string_lossy().to_string();
        if let Ok(mut manager) = PTY_MANAGER.lock() {
            let closed = manager.close_sessions_by_path_prefix(&archive_path_str);
            if !closed.is_empty() {
                log::info!("Closed {} PTY sessions for deleted worktree", closed.len());
            }
        }
    }

    // Delete associated local branches for each project
    let projects_path = root.join("projects");
    if projects_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_path) {
            for entry in entries.flatten() {
                let proj_path = entry.path();
                if !proj_path.is_dir() {
                    continue;
                }

                // Try to delete the branch (it may not exist in all projects)
                let output = Command::new("git")
                    .args(["-C", proj_path.to_str().unwrap(), "branch", "-D", branch_name])
                    .output();

                match output {
                    Ok(o) if o.status.success() => {
                        let proj_name = proj_path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("");
                        log::info!("Deleted branch '{}' from project '{}'", branch_name, proj_name);
                    }
                    _ => {} // Branch might not exist in this project, that's fine
                }
            }
        }
    }

    // Remove the directory
    fs::remove_dir_all(&archive_path)
        .map_err(|e| format!("Failed to delete archived worktree: {}", e))?;

    log::info!("Successfully deleted archived worktree '{}'", name);
    Ok(())
}

// ==================== Tauri 命令：Git 操作 ====================

#[derive(Debug, Deserialize)]
pub struct SwitchBranchRequest {
    pub project_path: String,
    pub branch: String,
}

#[tauri::command]
fn switch_branch(request: SwitchBranchRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.project_path);

    if !path.exists() {
        return Err(format!("Project path does not exist: {}", request.project_path));
    }

    // First, fetch to ensure we have latest refs
    let fetch_output = Command::new("git")
        .args(["fetch", "origin"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to fetch: {}", e))?;

    if !fetch_output.status.success() {
        // Fetch failure is not critical, continue with checkout
        log::warn!("git fetch failed, continuing with checkout");
    }

    // Checkout the branch
    let checkout_output = Command::new("git")
        .args(["checkout", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to checkout: {}", e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        return Err(format!("Failed to checkout {}: {}", request.branch, stderr));
    }

    // Pull latest changes
    let pull_output = Command::new("git")
        .args(["pull", "origin", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to pull: {}", e))?;

    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        log::warn!("git pull failed: {}", stderr);
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct CloneProjectRequest {
    pub name: String,
    pub repo_url: String,
    pub base_branch: String,
    pub test_branch: String,
    pub merge_strategy: String,
    pub linked_folders: Vec<String>,
}

#[tauri::command]
fn clone_project(request: CloneProjectRequest) -> Result<(), String> {
    let (workspace_path, mut config) = get_current_workspace_config()
        .ok_or("No workspace selected")?;

    let projects_path = PathBuf::from(&workspace_path).join("projects");
    let target_path = projects_path.join(&request.name);

    // Check if project already exists
    if target_path.exists() {
        return Err(format!("Project '{}' already exists", request.name));
    }

    // Parse repo URL and convert to git-compatible format
    let git_url = parse_repo_url(&request.repo_url)?;

    // Clone the repository
    let clone_output = Command::new("git")
        .args(["clone", &git_url, target_path.to_str().unwrap()])
        .output()
        .map_err(|e| format!("Failed to clone repository: {}", e))?;

    if !clone_output.status.success() {
        let stderr = String::from_utf8_lossy(&clone_output.stderr);
        return Err(format!("Git clone failed: {}", stderr));
    }

    // Checkout base branch if not already on it
    let checkout_output = Command::new("git")
        .args(["checkout", &request.base_branch])
        .current_dir(&target_path)
        .output()
        .map_err(|e| format!("Failed to checkout base branch: {}", e))?;

    if !checkout_output.status.success() {
        log::warn!("Could not checkout base branch '{}', using default branch", request.base_branch);
    }

    // Add project to config
    config.projects.push(ProjectConfig {
        name: request.name.clone(),
        base_branch: request.base_branch,
        test_branch: request.test_branch,
        merge_strategy: request.merge_strategy,
        linked_folders: request.linked_folders,
    });

    save_workspace_config_internal(&workspace_path, &config)?;

    Ok(())
}

// Parse different repo URL formats
fn parse_repo_url(url: &str) -> Result<String, String> {
    let url = url.trim();

    // GitHub shorthand: gh:owner/repo or owner/repo
    if url.starts_with("gh:") || (!url.contains("://") && !url.starts_with("git@")) {
        let repo = url.strip_prefix("gh:").unwrap_or(url);
        return Ok(format!("https://github.com/{}.git", repo));
    }

    // SSH format: git@github.com:owner/repo.git
    if url.starts_with("git@") {
        return Ok(url.to_string());
    }

    // HTTPS format: https://github.com/owner/repo.git
    if url.starts_with("https://") || url.starts_with("http://") {
        return Ok(url.to_string());
    }

    Err(format!("Invalid repository URL format: {}", url))
}

// ==================== Tauri 命令：工具 ====================

#[tauri::command]
fn open_in_terminal(path: String) -> Result<(), String> {
    let normalized = normalize_path(&path);

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", &normalized])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        // Try Windows Terminal first, then fallback to cmd
        let wt_result = Command::new("wt")
            .args(["-d", &normalized])
            .spawn();

        if wt_result.is_err() {
            Command::new("cmd")
                .args(["/c", "start", "cmd", "/k", &format!("cd /d {}", normalized)])
                .spawn()
                .map_err(|e| format!("Failed to open terminal: {}", e))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
        let mut opened = false;
        for term in &terminals {
            let result = if *term == "gnome-terminal" {
                Command::new(term)
                    .args(["--working-directory", &normalized])
                    .spawn()
            } else {
                Command::new(term)
                    .current_dir(&normalized)
                    .spawn()
            };
            if result.is_ok() {
                opened = true;
                break;
            }
        }
        if !opened {
            return Err("No terminal emulator found".to_string());
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct OpenEditorRequest {
    pub path: String,
    pub editor: String,
}

#[tauri::command]
fn open_in_editor(request: OpenEditorRequest) -> Result<(), String> {
    let path = &request.path;

    // On macOS, try `open -a` first since CLI commands may not be in PATH
    // when the app is launched from Finder
    #[cfg(target_os = "macos")]
    {
        let app_name = match request.editor.as_str() {
            "vscode" => "Visual Studio Code",
            "cursor" => "Cursor",
            "idea" => "IntelliJ IDEA",
            _ => "Visual Studio Code",
        };

        // Try `open -a "App Name" path` first
        let result = Command::new("open")
            .args(["-a", app_name, path])
            .spawn();

        if result.is_ok() {
            return Ok(());
        }

        // Fallback: try CLI command directly (in case user has it in PATH)
        let cmd = match request.editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "idea" => "idea",
            _ => "code",
        };

        Command::new(cmd)
            .arg(path)
            .spawn()
            .map_err(|_| format!("无法打开 {}，请确认已安装该编辑器", app_name))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let cmd = match request.editor.as_str() {
            "vscode" => "code",
            "cursor" => "cursor",
            "idea" => "idea",
            _ => "code",
        };

        Command::new(cmd)
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开编辑器 {}: {}", cmd, e))?;
    }

    Ok(())
}


// ==================== PTY 终端命令 ====================

#[tauri::command]
fn open_log_dir() -> Result<(), String> {
    let home = std::env::var("HOME")
        .map_err(|_| "无法获取用户目录".to_string())?;
    let log_dir = PathBuf::from(&home).join("Library/Logs/com.guo.worktree-manager");

    if !log_dir.exists() {
        return Err("日志目录不存在".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(log_dir.to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| format!("无法打开日志目录: {}", e))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new("xdg-open")
            .arg(log_dir.to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| format!("无法打开日志目录: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn pty_create(session_id: String, cwd: String, cols: u16, rows: u16) -> Result<(), String> {
    let mut manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.create_session(&session_id, &cwd, cols, rows)
}

#[tauri::command]
fn pty_write(session_id: String, data: String) -> Result<(), String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.write_to_session(&session_id, &data)
}

#[tauri::command]
fn pty_read(session_id: String) -> Result<String, String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.read_from_session(&session_id)
}

#[tauri::command]
fn pty_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.resize_session(&session_id, cols, rows)
}

#[tauri::command]
fn pty_close(session_id: String) -> Result<(), String> {
    let mut manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    manager.close_session(&session_id)
}

#[tauri::command]
fn pty_exists(session_id: String) -> Result<bool, String> {
    let manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(manager.has_session(&session_id))
}

#[tauri::command]
fn pty_close_by_path(path_prefix: String) -> Result<Vec<String>, String> {
    let mut manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(manager.close_sessions_by_path_prefix(&path_prefix))
}

// ==================== Tauri 入口 ====================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // Workspace 管理
            list_workspaces,
            get_current_workspace,
            switch_workspace,
            add_workspace,
            remove_workspace,
            create_workspace,
            // Workspace 配置
            get_workspace_config,
            save_workspace_config,
            get_config_path_info,
            // Worktree 操作
            list_worktrees,
            get_main_workspace_status,
            create_worktree,
            archive_worktree,
            restore_worktree,
            delete_archived_worktree,
            check_worktree_status,
            // Git 操作
            switch_branch,
            clone_project,
            // 工具
            open_in_terminal,
            open_in_editor,
            open_log_dir,
            // PTY 终端
            pty_create,
            pty_write,
            pty_read,
            pty_resize,
            pty_close,
            pty_exists,
            pty_close_by_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
