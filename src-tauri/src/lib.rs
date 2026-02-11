use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::fs;
use std::sync::Mutex;
use std::time::Duration;
use once_cell::sync::Lazy;
use wait_timeout::ChildExt;
use log;

mod git_ops;
mod pty_manager;
pub mod http_server;

use git_ops::{get_worktree_info, get_branch_status, BranchStatus};
use pty_manager::PtyManager;

// PTY Manager 全局实例
pub static PTY_MANAGER: Lazy<Mutex<PtyManager>> = Lazy::new(|| Mutex::new(PtyManager::new()));

// 多窗口 workspace 绑定：window_label -> workspace_path
pub static WINDOW_WORKSPACES: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// 多窗口 worktree 锁定：(workspace_path, worktree_name) -> window_label
// 同一 worktree 只能被一个窗口独占选中
pub static WORKTREE_LOCKS: Lazy<Mutex<HashMap<(String, String), String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// ==================== 分享状态 ====================

pub struct ShareState {
    pub active: bool,
    pub workspace_path: Option<String>,
    pub port: u16,
    pub password: Option<String>,
    pub shutdown_tx: Option<tokio::sync::watch::Sender<bool>>,
}

impl Default for ShareState {
    fn default() -> Self {
        Self {
            active: false,
            workspace_path: None,
            port: 0,
            password: None,
            shutdown_tx: None,
        }
    }
}

pub static SHARE_STATE: Lazy<Mutex<ShareState>> = Lazy::new(|| Mutex::new(ShareState::default()));

// 已认证的 session 集合
pub static AUTHENTICATED_SESSIONS: Lazy<Mutex<std::collections::HashSet<String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashSet::new()));

pub static TOKIO_RT: Lazy<tokio::runtime::Runtime> = Lazy::new(|| {
    tokio::runtime::Runtime::new().expect("Failed to create tokio runtime for sharing")
});

// Broadcast channel for lock state changes (WebSocket push)
pub static LOCK_BROADCAST: Lazy<tokio::sync::broadcast::Sender<String>> = Lazy::new(|| {
    let (tx, _) = tokio::sync::broadcast::channel(64);
    tx
});

#[derive(Debug, Serialize, Clone)]
pub struct ShareStateInfo {
    pub active: bool,
    pub url: Option<String>,
    pub workspace_path: Option<String>,
}

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

pub fn load_global_config() -> GlobalConfig {
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

/// 获取窗口绑定的 workspace 路径，优先从 WINDOW_WORKSPACES 获取，
/// 回退到 global config 的 current_workspace
fn get_window_workspace_path(window_label: &str) -> Option<String> {
    // 先查窗口绑定
    {
        let map = WINDOW_WORKSPACES.lock().unwrap();
        if let Some(path) = map.get(window_label) {
            return Some(path.clone());
        }
    }
    // 回退到全局
    let global = load_global_config();
    global.current_workspace
}

fn get_window_workspace_config(window_label: &str) -> Option<(String, WorkspaceConfig)> {
    let workspace_path = get_window_workspace_path(window_label)?;
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

// ==================== 智能软链接扫描 ====================

#[derive(Debug, Serialize, Clone)]
pub struct ScannedFolder {
    pub relative_path: String,   // e.g. "packages/web/node_modules"
    pub display_name: String,    // e.g. "node_modules"
    pub size_bytes: u64,
    pub size_display: String,    // e.g. "256.3 MB"
    pub is_recommended: bool,    // 推荐预选
}

const KNOWN_LINKABLE_FOLDERS: &[&str] = &[
    // JS/Node
    "node_modules", ".next", ".nuxt", ".yarn", ".pnpm-store",
    // Python
    "venv", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache",
    // Rust
    "target",
    // Go
    "vendor",
    // Java/Kotlin
    ".gradle", ".m2", "build",
    // General
    "dist", ".cache", ".parcel-cache", ".turbo",
];

const RECOMMENDED_LINKABLE_FOLDERS: &[&str] = &[
    "node_modules", ".next", ".nuxt", ".pnpm-store",
    "venv", ".venv", "target", ".gradle",
];

const SKIP_DIRS: &[&str] = &[".git", ".svn", ".hg"];

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn calculate_dir_size(path: &Path) -> u64 {
    let mut total: u64 = 0;

    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();

        // Skip symlinks
        if entry_path.is_symlink() {
            continue;
        }

        if entry_path.is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        } else if entry_path.is_dir() {
            total += calculate_dir_size(&entry_path);
        }
    }

    total
}

fn scan_dir_for_linkable_folders(
    base: &Path,
    current: &Path,
    results: &mut Vec<ScannedFolder>,
) {
    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();

        // Skip symlinks
        if entry_path.is_symlink() {
            continue;
        }

        // Skip non-directories
        if !entry_path.is_dir() {
            continue;
        }

        let dir_name = match entry_path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // Check if it's a known linkable folder
        if KNOWN_LINKABLE_FOLDERS.contains(&dir_name.as_str()) {
            let size_bytes = calculate_dir_size(&entry_path);
            let relative_path = entry_path
                .strip_prefix(base)
                .unwrap_or(&entry_path)
                .to_string_lossy()
                .to_string();

            results.push(ScannedFolder {
                relative_path,
                display_name: dir_name.clone(),
                size_bytes,
                size_display: format_size(size_bytes),
                is_recommended: RECOMMENDED_LINKABLE_FOLDERS.contains(&dir_name.as_str()),
            });
            continue; // Don't recurse into matched folders
        }

        // Skip configured skip dirs
        if SKIP_DIRS.contains(&dir_name.as_str()) {
            continue;
        }

        // Skip other hidden directories (those starting with '.' but not in KNOWN list)
        if dir_name.starts_with('.') {
            continue;
        }

        // Recurse into other directories
        scan_dir_for_linkable_folders(base, &entry_path, results);
    }
}

#[tauri::command]
async fn scan_linked_folders(project_path: String) -> Result<Vec<ScannedFolder>, String> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", project_path));
    }

    let mut results = Vec::new();
    scan_dir_for_linkable_folders(&path, &path, &mut results);

    // Sort: recommended first, then by size descending
    results.sort_by(|a, b| {
        b.is_recommended
            .cmp(&a.is_recommended)
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    Ok(results)
}

// ==================== Worktree 操作数据结构 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWorktreeRequest {
    pub name: String,
    pub projects: Vec<CreateProjectRequest>,
}

#[derive(Debug, Serialize, Deserialize)]
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

pub fn get_current_workspace_impl(window_label: &str) -> Option<WorkspaceRef> {
    let global = load_global_config();
    let current_path = get_window_workspace_path(window_label)?;
    global.workspaces.iter()
        .find(|w| w.path == current_path)
        .cloned()
}

#[tauri::command]
fn get_current_workspace(window: tauri::Window) -> Option<WorkspaceRef> {
    get_current_workspace_impl(window.label())
}

pub fn switch_workspace_impl(window_label: &str, path: String) -> Result<(), String> {
    let mut global = load_global_config();

    // 验证 workspace 存在
    if !global.workspaces.iter().any(|w| w.path == path) {
        return Err("Workspace not found".to_string());
    }

    global.current_workspace = Some(path.clone());
    save_global_config_internal(&global)?;

    // 绑定窗口 workspace
    {
        let mut map = WINDOW_WORKSPACES.lock().unwrap();
        map.insert(window_label.to_string(), path);
    }

    // 清除 workspace 配置缓存
    {
        let mut cache = WORKSPACE_CONFIG_CACHE.lock().unwrap();
        *cache = None;
    }

    Ok(())
}

#[tauri::command]
fn switch_workspace(window: tauri::Window, path: String) -> Result<(), String> {
    switch_workspace_impl(window.label(), path)
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

pub fn get_workspace_config_impl(window_label: &str) -> Result<WorkspaceConfig, String> {
    let (_, config) = get_window_workspace_config(window_label)
        .ok_or("No workspace selected")?;
    Ok(config)
}

#[tauri::command]
fn get_workspace_config(window: tauri::Window) -> Result<WorkspaceConfig, String> {
    get_workspace_config_impl(window.label())
}

pub fn save_workspace_config_impl(window_label: &str, config: WorkspaceConfig) -> Result<(), String> {
    let workspace_path = get_window_workspace_path(window_label)
        .ok_or("No workspace selected")?;
    save_workspace_config_internal(&workspace_path, &config)
}

#[tauri::command]
fn save_workspace_config(window: tauri::Window, config: WorkspaceConfig) -> Result<(), String> {
    save_workspace_config_impl(window.label(), config)
}

pub fn get_config_path_info_impl(window_label: &str) -> String {
    if let Some(workspace_path) = get_window_workspace_path(window_label) {
        normalize_path(&get_workspace_config_path(&workspace_path).to_string_lossy())
    } else {
        normalize_path(&get_global_config_path().to_string_lossy())
    }
}

#[tauri::command]
fn get_config_path_info(window: tauri::Window) -> String {
    get_config_path_info_impl(window.label())
}

// ==================== Tauri 命令：Worktree 操作 ====================

pub fn list_worktrees_impl(window_label: &str, include_archived: bool) -> Result<Vec<WorktreeListItem>, String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
        .ok_or("No workspace selected")?;

    let worktrees_path = PathBuf::from(&workspace_path).join(&config.worktrees_dir);

    if !worktrees_path.exists() {
        return Ok(vec![]);
    }

    scan_worktrees_dir(&worktrees_path, &config, include_archived)
}

#[tauri::command]
fn list_worktrees(window: tauri::Window, include_archived: bool) -> Result<Vec<WorktreeListItem>, String> {
    list_worktrees_impl(window.label(), include_archived)
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

pub fn get_main_workspace_status_impl(window_label: &str) -> Result<MainWorkspaceStatus, String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
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
fn get_main_workspace_status(window: tauri::Window) -> Result<MainWorkspaceStatus, String> {
    get_main_workspace_status_impl(window.label())
}

pub fn create_worktree_impl(window_label: &str, request: CreateWorktreeRequest) -> Result<String, String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
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
fn create_worktree(window: tauri::Window, request: CreateWorktreeRequest) -> Result<String, String> {
    create_worktree_impl(window.label(), request)
}

pub fn archive_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
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

#[tauri::command]
fn archive_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    archive_worktree_impl(window.label(), name)
}

#[derive(Debug, Serialize)]
pub struct WorktreeArchiveStatus {
    pub name: String,
    pub can_archive: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub projects: Vec<BranchStatus>,
}

pub fn check_worktree_status_impl(window_label: &str, name: String) -> Result<WorktreeArchiveStatus, String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
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
fn check_worktree_status(window: tauri::Window, name: String) -> Result<WorktreeArchiveStatus, String> {
    check_worktree_status_impl(window.label(), name)
}

pub fn restore_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
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
fn restore_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    restore_worktree_impl(window.label(), name)
}

pub fn delete_archived_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
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

#[tauri::command]
fn delete_archived_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    delete_archived_worktree_impl(window.label(), name)
}

// ==================== Tauri 命令：向已有 Worktree 添加项目 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct AddProjectToWorktreeRequest {
    pub worktree_name: String,
    pub project_name: String,
    pub base_branch: String,
}

pub fn add_project_to_worktree_impl(window_label: &str, request: AddProjectToWorktreeRequest) -> Result<(), String> {
    let (workspace_path, config) = get_window_workspace_config(window_label)
        .ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&request.worktree_name);

    if !worktree_path.exists() {
        return Err(format!("Worktree '{}' does not exist", request.worktree_name));
    }

    let main_proj_path = root.join("projects").join(&request.project_name);
    if !main_proj_path.exists() {
        return Err(format!("Project '{}' does not exist in main workspace", request.project_name));
    }

    let wt_proj_path = worktree_path.join("projects").join(&request.project_name);
    if wt_proj_path.exists() {
        return Err(format!("Project '{}' already exists in worktree '{}'", request.project_name, request.worktree_name));
    }

    // Ensure the projects directory exists in the worktree
    let projects_dir = worktree_path.join("projects");
    if !projects_dir.exists() {
        std::fs::create_dir_all(&projects_dir)
            .map_err(|e| format!("Failed to create projects directory: {}", e))?;
    }

    let proj_config = config.projects.iter()
        .find(|p| p.name == request.project_name)
        .cloned()
        .unwrap_or(ProjectConfig {
            name: request.project_name.clone(),
            base_branch: request.base_branch.clone(),
            test_branch: "test".to_string(),
            merge_strategy: "merge".to_string(),
            linked_folders: vec![],
        });

    log::info!("Adding project '{}' to worktree '{}'", request.project_name, request.worktree_name);

    // Fetch origin first
    run_git_command_with_timeout(
        &["fetch", "origin"],
        main_proj_path.to_str().unwrap(),
    )?;

    // Check if branch already exists
    let branch_check = Command::new("git")
        .args(["-C", main_proj_path.to_str().unwrap(), "branch", "--list", &request.worktree_name])
        .output();

    let branch_exists = branch_check
        .as_ref()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    // Create worktree: use existing branch or create new one
    let output = if branch_exists {
        log::info!("Branch '{}' already exists, using it for project {}", request.worktree_name, request.project_name);
        Command::new("git")
            .args([
                "-C", main_proj_path.to_str().unwrap(),
                "worktree", "add",
                wt_proj_path.to_str().unwrap(),
                &request.worktree_name,
            ])
            .output()
            .map_err(|e| format!("Failed to create worktree: {}", e))?
    } else {
        log::info!("Creating new branch '{}' for project {} from origin/{}", request.worktree_name, request.project_name, request.base_branch);
        Command::new("git")
            .args([
                "-C", main_proj_path.to_str().unwrap(),
                "worktree", "add",
                wt_proj_path.to_str().unwrap(),
                "-b", &request.worktree_name,
                &format!("origin/{}", request.base_branch),
            ])
            .output()
            .map_err(|e| format!("Failed to create worktree: {}", e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to add project {} to worktree: {}", request.project_name, stderr));
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

    log::info!("Successfully added project '{}' to worktree '{}'", request.project_name, request.worktree_name);
    Ok(())
}

#[tauri::command]
fn add_project_to_worktree(window: tauri::Window, request: AddProjectToWorktreeRequest) -> Result<(), String> {
    add_project_to_worktree_impl(window.label(), request)
}

// ==================== Tauri 命令：Git 操作 ====================

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct CloneProjectRequest {
    pub name: String,
    pub repo_url: String,
    pub base_branch: String,
    pub test_branch: String,
    pub merge_strategy: String,
    pub linked_folders: Vec<String>,
}

pub fn clone_project_impl(window_label: &str, request: CloneProjectRequest) -> Result<(), String> {
    let (workspace_path, mut config) = get_window_workspace_config(window_label)
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

#[tauri::command]
fn clone_project(window: tauri::Window, request: CloneProjectRequest) -> Result<(), String> {
    clone_project_impl(window.label(), request)
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

#[derive(Debug, Serialize, Deserialize)]
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


#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let normalized = normalize_path(&path);

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
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
fn set_window_workspace(window: tauri::Window, workspace_path: String) -> Result<(), String> {
    set_window_workspace_impl(window.label(), workspace_path)
}

#[tauri::command]
fn get_opened_workspaces() -> Vec<String> {
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
    {
        let mut locks = WORKTREE_LOCKS.lock().unwrap();
        let had_locks = locks.values().any(|v| *v == label);
        locks.retain(|_, v| *v != label);
        // If locks changed, broadcast updates for all workspaces
        if had_locks {
            let mut by_workspace: HashMap<String, HashMap<String, String>> = HashMap::new();
            for ((ws_path, wt_name), lbl) in locks.iter() {
                by_workspace
                    .entry(ws_path.clone())
                    .or_default()
                    .insert(wt_name.clone(), lbl.clone());
            }
            drop(locks);
            for (ws_path, lock_snapshot) in by_workspace {
                if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
                    "workspacePath": ws_path,
                    "locks": lock_snapshot,
                })) {
                    let _ = LOCK_BROADCAST.send(json_str);
                }
            }
        }
    }
}

#[tauri::command]
fn unregister_window(window: tauri::Window) {
    unregister_window_impl(window.label())
}

/// 锁定 worktree 到当前窗口，如果该 worktree 已被其他窗口锁定则返回错误
pub fn lock_worktree_impl(window_label: &str, workspace_path: String, worktree_name: String) -> Result<(), String> {
    let label = window_label.to_string();
    let ws_path = workspace_path.clone();
    let mut locks = WORKTREE_LOCKS.lock().unwrap();
    let key = (workspace_path, worktree_name.clone());

    if let Some(existing_label) = locks.get(&key) {
        if *existing_label != label {
            return Err(format!("Worktree \"{}\" 已在其他窗口中打开", worktree_name));
        }
    }
    locks.insert(key, label);

    // Broadcast lock state change for the affected workspace
    let lock_snapshot: HashMap<String, String> = locks
        .iter()
        .filter(|((wp, _), _)| *wp == ws_path)
        .map(|((_, wt), lbl)| (wt.clone(), lbl.clone()))
        .collect();
    drop(locks);
    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
        "workspacePath": ws_path,
        "locks": lock_snapshot,
    })) {
        let _ = LOCK_BROADCAST.send(json_str);
    }

    Ok(())
}

#[tauri::command]
fn lock_worktree(window: tauri::Window, workspace_path: String, worktree_name: String) -> Result<(), String> {
    lock_worktree_impl(window.label(), workspace_path, worktree_name)
}

/// 解锁当前窗口持有的指定 worktree
pub fn unlock_worktree_impl(window_label: &str, workspace_path: String, worktree_name: String) {
    let label = window_label.to_string();
    let ws_path = workspace_path.clone();
    let mut locks = WORKTREE_LOCKS.lock().unwrap();
    let key = (workspace_path, worktree_name);
    if let Some(existing_label) = locks.get(&key) {
        if *existing_label == label {
            locks.remove(&key);
        }
    }

    // Broadcast lock state change for the affected workspace
    let lock_snapshot: HashMap<String, String> = locks
        .iter()
        .filter(|((wp, _), _)| *wp == ws_path)
        .map(|((_, wt), lbl)| (wt.clone(), lbl.clone()))
        .collect();
    drop(locks);
    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
        "workspacePath": ws_path,
        "locks": lock_snapshot,
    })) {
        let _ = LOCK_BROADCAST.send(json_str);
    }
}

#[tauri::command]
fn unlock_worktree(window: tauri::Window, workspace_path: String, worktree_name: String) {
    unlock_worktree_impl(window.label(), workspace_path, worktree_name)
}

/// 获取指定 workspace 中所有被锁定的 worktree 列表 (worktree_name -> window_label)
#[tauri::command]
fn get_locked_worktrees(workspace_path: String) -> HashMap<String, String> {
    let locks = WORKTREE_LOCKS.lock().unwrap();
    locks.iter()
        .filter(|((ws_path, _), _)| *ws_path == workspace_path)
        .map(|((_, wt_name), label)| (wt_name.clone(), label.clone()))
        .collect()
}

#[tauri::command]
async fn open_workspace_window(app: tauri::AppHandle, workspace_path: String) -> Result<String, String> {
    let global = load_global_config();
    if !global.workspaces.iter().any(|w| w.path == workspace_path) {
        return Err("Workspace not found".to_string());
    }

    let ws_name = global.workspaces.iter()
        .find(|w| w.path == workspace_path)
        .map(|w| w.name.clone())
        .unwrap_or_else(|| "Worktree Manager".to_string());

    let window_label = format!("workspace-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    let url = format!("index.html?workspace={}", urlencoding::encode(&workspace_path));

    let _webview = tauri::WebviewWindowBuilder::new(
        &app,
        &window_label,
        tauri::WebviewUrl::App(url.into()),
    )
    .title(format!("Worktree Manager - {}", ws_name))
    .inner_size(1100.0, 700.0)
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

// ==================== HTTP Server 共享接口 ====================
// 以下函数供 http_server 模块调用（对应无 window 参数的 Tauri 命令）

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

pub fn switch_branch_internal(request: &SwitchBranchRequest) -> Result<(), String> {
    let path = PathBuf::from(&request.project_path);
    if !path.exists() {
        return Err(format!("Project path does not exist: {}", request.project_path));
    }
    let _ = Command::new("git")
        .args(["fetch", "origin"])
        .current_dir(&path)
        .output();
    let checkout_output = Command::new("git")
        .args(["checkout", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to checkout: {}", e))?;
    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        return Err(format!("Failed to checkout {}: {}", request.branch, stderr));
    }
    let _ = Command::new("git")
        .args(["pull", "origin", &request.branch])
        .current_dir(&path)
        .output();
    Ok(())
}

pub fn scan_linked_folders_internal(project_path: &str) -> Result<Vec<ScannedFolder>, String> {
    let path = PathBuf::from(project_path);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", project_path));
    }
    let mut results = Vec::new();
    scan_dir_for_linkable_folders(&path, &path, &mut results);
    results.sort_by(|a, b| {
        b.is_recommended
            .cmp(&a.is_recommended)
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });
    Ok(results)
}

pub fn open_in_terminal_internal(path: &str) -> Result<(), String> {
    let normalized = normalize_path(path);
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", "Terminal", &normalized])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }
    Ok(())
}

pub fn open_in_editor_internal(request: &OpenEditorRequest) -> Result<(), String> {
    let path = &request.path;
    #[cfg(target_os = "macos")]
    {
        let app_name = match request.editor.as_str() {
            "vscode" => "Visual Studio Code",
            "cursor" => "Cursor",
            "idea" => "IntelliJ IDEA",
            _ => "Visual Studio Code",
        };
        let result = Command::new("open").args(["-a", app_name, path]).spawn();
        if result.is_ok() {
            return Ok(());
        }
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

pub fn reveal_in_finder_internal(path: &str) -> Result<(), String> {
    let normalized = normalize_path(path);
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&normalized)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }
    Ok(())
}

pub fn open_log_dir_internal() -> Result<(), String> {
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

// ==================== 分享功能命令 ====================

#[tauri::command]
async fn start_sharing(window: tauri::Window, port: u16, password: String) -> Result<String, String> {
    let workspace_path = get_window_workspace_path(window.label())
        .ok_or("No workspace selected")?;

    // Check if already sharing
    {
        let state = SHARE_STATE.lock().unwrap();
        if state.active {
            return Err("Already sharing. Stop current sharing first.".to_string());
        }
    }

    // Determine local IP for the share URL
    let local_ip = local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "0.0.0.0".to_string());

    let share_url = format!("http://{}:{}", local_ip, port);

    // Create shutdown channel
    let (tx, rx) = tokio::sync::watch::channel(false);

    // Update share state
    {
        let mut state = SHARE_STATE.lock().unwrap();
        state.active = true;
        state.workspace_path = Some(workspace_path.clone());
        state.port = port;
        state.password = Some(password);
        state.shutdown_tx = Some(tx);
    }

    // Clear any previous authenticated sessions
    {
        let mut sessions = AUTHENTICATED_SESSIONS.lock().unwrap();
        sessions.clear();
    }

    // Spawn the HTTP server on the shared tokio runtime
    TOKIO_RT.spawn(http_server::start_server(port, rx));

    log::info!("Sharing started on {} for workspace {}", share_url, workspace_path);

    Ok(share_url)
}

#[tauri::command]
async fn stop_sharing() -> Result<(), String> {
    let tx = {
        let mut state = SHARE_STATE.lock().unwrap();
        if !state.active {
            return Err("Not currently sharing".to_string());
        }
        state.shutdown_tx.take()
    };

    // Send shutdown signal
    if let Some(tx) = tx {
        let _ = tx.send(true);
    }

    // Reset state
    {
        let mut state = SHARE_STATE.lock().unwrap();
        state.active = false;
        state.workspace_path = None;
        state.port = 0;
        state.password = None;
        // shutdown_tx already taken above
    }

    // Clear authenticated sessions
    {
        let mut sessions = AUTHENTICATED_SESSIONS.lock().unwrap();
        sessions.clear();
    }

    log::info!("Sharing stopped");
    Ok(())
}

#[tauri::command]
async fn get_share_state() -> Result<ShareStateInfo, String> {
    let state = SHARE_STATE.lock().unwrap();
    let url = if state.active {
        let local_ip = local_ip_address::local_ip()
            .map(|ip| ip.to_string())
            .unwrap_or_else(|_| "0.0.0.0".to_string());
        Some(format!("http://{}:{}", local_ip, state.port))
    } else {
        None
    };

    Ok(ShareStateInfo {
        active: state.active,
        url,
        workspace_path: state.workspace_path.clone(),
    })
}

#[tauri::command]
async fn update_share_password(password: String) -> Result<(), String> {
    let mut state = SHARE_STATE.lock().unwrap();
    if !state.active {
        return Err("Not currently sharing".to_string());
    }
    state.password = Some(password);
    drop(state);

    // Clear authenticated sessions so everyone must re-auth with the new password
    AUTHENTICATED_SESSIONS.lock().unwrap().clear();

    log::info!("Share password updated");
    Ok(())
}

// ==================== DevTools ====================

#[tauri::command]
fn open_devtools(webview_window: tauri::WebviewWindow) {
    webview_window.open_devtools();
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                {
                    let mut map = WINDOW_WORKSPACES.lock().unwrap();
                    map.remove(&label);
                }
                {
                    let mut locks = WORKTREE_LOCKS.lock().unwrap();
                    locks.retain(|_, v| *v != label);
                }
            }
        })
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
            add_project_to_worktree,
            // Git 操作
            switch_branch,
            clone_project,
            // 工具
            open_in_terminal,
            open_in_editor,
            open_log_dir,
            reveal_in_finder,
            // 多窗口管理
            set_window_workspace,
            get_opened_workspaces,
            unregister_window,
            open_workspace_window,
            lock_worktree,
            unlock_worktree,
            get_locked_worktrees,
            // 智能扫描
            scan_linked_folders,
            // PTY 终端
            pty_create,
            pty_write,
            pty_read,
            pty_resize,
            pty_close,
            pty_exists,
            pty_close_by_path,
            // 分享功能
            start_sharing,
            stop_sharing,
            get_share_state,
            update_share_password,
            // DevTools
            open_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
