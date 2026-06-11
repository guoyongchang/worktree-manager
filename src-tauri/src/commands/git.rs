use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::config::{get_window_workspace_config, save_workspace_config_internal};
use crate::git_ops;
use crate::types::{CloneProjectRequest, ProjectConfig, SwitchBranchRequest};
use crate::utils::{
    friendly_fs_error, git_command, mask_url_credentials, normalize_path, parse_repo_url,
    validate_git_ref_name,
};

// ==================== Helper: spawn_blocking wrapper ====================

/// Run a blocking closure on tokio's blocking threadpool, converting JoinError to String.
async fn blocking<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

fn log_git_command_error<T>(
    operation: &str,
    path: &str,
    result: Result<T, String>,
) -> Result<T, String> {
    if let Err(error) = &result {
        let error_for_log = mask_url_credentials(error);
        log::error!(
            "[git-command] operation='{}', path='{}', error='{}'",
            operation,
            path,
            error_for_log
        );
    }
    result
}

// ==================== Tauri 命令：Git 操作 ====================

fn switch_branch_sync(request: SwitchBranchRequest) -> Result<(), String> {
    log::info!(
        "[git] Switching branch: path='{}', target='{}'",
        request.project_path,
        request.branch
    );
    let path = PathBuf::from(&request.project_path);

    if !path.exists() {
        log::error!(
            "[git] Project path does not exist: {}",
            request.project_path
        );
        return Err(format!(
            "Project path does not exist: {}",
            request.project_path
        ));
    }

    // Step 1: Fetch to ensure we have latest refs
    log::info!("[git] Step 1/3: git fetch origin");
    let fetch_output = git_command()
        .args(["fetch", "origin"])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to fetch: {}", e))?;

    if !fetch_output.status.success() {
        let stderr_for_log = mask_url_credentials(&String::from_utf8_lossy(&fetch_output.stderr));
        // Fetch failure is not critical, continue with checkout
        log::warn!(
            "[git] Step 1/3: git fetch failed (non-critical), continuing: {}",
            stderr_for_log
        );
    } else {
        log::info!("[git] Step 1/3: git fetch origin succeeded");
    }

    // Step 2: Checkout the branch
    log::info!("[git] Step 2/3: git checkout {}", request.branch);
    let checkout_output = git_command()
        .args(["checkout", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to checkout: {}", e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        let stderr_for_log = mask_url_credentials(&stderr);
        log::error!(
            "[git] Step 2/3 FAILED: git checkout {}: {}",
            request.branch,
            stderr_for_log
        );
        return Err(format!("Failed to checkout {}: {}", request.branch, stderr));
    }
    log::info!("[git] Step 2/3: git checkout {} succeeded", request.branch);

    // Step 3: Pull latest changes
    log::info!("[git] Step 3/3: git pull origin {}", request.branch);
    let pull_output = git_command()
        .args(["pull", "origin", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to pull: {}", e))?;

    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        let stderr_for_log = mask_url_credentials(&stderr);
        log::warn!(
            "[git] Step 3/3: git pull failed (non-critical): {}",
            stderr_for_log
        );
    } else {
        log::info!(
            "[git] Step 3/3: git pull origin {} succeeded",
            request.branch
        );
    }

    log::info!(
        "[git] Successfully switched to branch '{}' at '{}'",
        request.branch,
        request.project_path
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn switch_branch(request: SwitchBranchRequest) -> Result<(), String> {
    validate_git_ref_name(&request.branch)?;
    let path = request.project_path.clone();
    let result = blocking(move || switch_branch_sync(request)).await;
    log_git_command_error("switch_branch", &path, result)
}

pub fn clone_project_impl(window_label: &str, request: CloneProjectRequest) -> Result<(), String> {
    validate_git_ref_name(&request.base_branch)?;
    validate_git_ref_name(&request.test_branch)?;

    let (workspace_path, mut config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let projects_path = PathBuf::from(&workspace_path).join("projects");
    let target_path = projects_path.join(&request.name);

    // Sanitize URL for logging (may contain tokens)
    let safe_url = mask_url_credentials(&request.repo_url);

    log::info!(
        "[git] Cloning project: name='{}', url='{}', target='{}', base_branch='{}'",
        request.name,
        safe_url,
        target_path.display(),
        request.base_branch
    );

    // Check if project already exists
    if target_path.exists() {
        log::error!(
            "[git] Project '{}' already exists at {}",
            request.name,
            target_path.display()
        );
        return Err(format!("Project '{}' already exists", request.name));
    }

    // Parse repo URL and convert to git-compatible format
    let git_url = parse_repo_url(&request.repo_url)?;

    // Step 1: Clone the repository
    log::info!("[git] Step 1/3: git clone to {}", target_path.display());
    let clone_output = git_command()
        .args(["clone", &git_url, target_path.to_string_lossy().as_ref()])
        .output()
        .map_err(|e| format!("Failed to clone repository: {}", e))?;

    if !clone_output.status.success() {
        let stderr = String::from_utf8_lossy(&clone_output.stderr);
        let stderr_for_log = mask_url_credentials(&stderr);
        log::error!("[git] Step 1/3 FAILED: git clone: {}", stderr_for_log);
        return Err(format!("Git clone failed: {}", stderr));
    }
    log::info!("[git] Step 1/3: git clone succeeded");

    // Step 2: Checkout base branch if not already on it
    log::info!("[git] Step 2/3: git checkout {}", request.base_branch);
    let checkout_output = git_command()
        .args(["checkout", &request.base_branch])
        .current_dir(&target_path)
        .output()
        .map_err(|e| format!("Failed to checkout base branch: {}", e))?;

    if !checkout_output.status.success() {
        log::warn!(
            "[git] Step 2/3: Could not checkout base branch '{}', using default branch",
            request.base_branch
        );
    } else {
        log::info!(
            "[git] Step 2/3: Checked out base branch '{}'",
            request.base_branch
        );
    }

    // Step 3: Add project to config
    log::info!(
        "[git] Step 3/3: Adding project '{}' to workspace config",
        request.name
    );
    config.projects.push(ProjectConfig {
        name: request.name.clone(),
        base_branch: request.base_branch,
        test_branch: request.test_branch,
        merge_strategy: request.merge_strategy,
        linked_folders: request.linked_folders,
        commit_prefix_index: None,
        git_user_name: None,
        git_user_email: None,
        tags: vec![],
    });

    save_workspace_config_internal(&workspace_path, &config)?;

    log::info!("[git] Successfully cloned project '{}'", request.name);
    Ok(())
}

#[tauri::command]
pub(crate) async fn clone_project(
    window: tauri::Window,
    request: CloneProjectRequest,
) -> Result<(), String> {
    let label = window.label().to_string();
    blocking(move || clone_project_impl(&label, request)).await
}

// ==================== 主工作区项目管理 ====================

pub fn scan_existing_projects_impl(
    window_label: &str,
) -> Result<Vec<crate::types::ExistingProjectInfo>, String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let projects_dir = PathBuf::from(&workspace_path).join("projects");
    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let registered: std::collections::HashSet<String> =
        config.projects.iter().map(|p| p.name.clone()).collect();

    let mut result = vec![];
    let entries = std::fs::read_dir(&projects_dir)
        .map_err(|e| friendly_fs_error("无法读取 projects 目录", &e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if name.starts_with('.') {
            continue;
        }

        let is_registered = registered.contains(&name);

        // Check if it's a git repo
        if !path.join(".git").exists() {
            continue;
        }

        // Get current branch
        let current_branch = git_command()
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&path)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "unknown".to_string());

        result.push(crate::types::ExistingProjectInfo {
            name,
            current_branch,
            is_registered,
        });
    }

    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

#[tauri::command]
pub(crate) async fn scan_existing_projects(
    window: tauri::Window,
) -> Result<Vec<crate::types::ExistingProjectInfo>, String> {
    let label = window.label().to_string();
    blocking(move || scan_existing_projects_impl(&label)).await
}

pub fn add_existing_project_impl(
    window_label: &str,
    name: String,
    base_branch: String,
    test_branch: String,
    merge_strategy: String,
) -> Result<(), String> {
    validate_git_ref_name(&base_branch)?;
    validate_git_ref_name(&test_branch)?;

    let (workspace_path, mut config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let projects_dir = PathBuf::from(&workspace_path).join("projects");
    let project_path = projects_dir.join(&name);

    if !project_path.exists() || !project_path.join(".git").exists() {
        return Err(format!(
            "Project '{}' does not exist or is not a git repository",
            name
        ));
    }

    // Check if already registered
    if config.projects.iter().any(|p| p.name == name) {
        return Err(format!("Project '{}' is already registered", name));
    }

    log::info!(
        "[git] Adding existing project '{}' to config (base={}, test={})",
        name,
        base_branch,
        test_branch
    );

    config.projects.push(ProjectConfig {
        name: name.clone(),
        base_branch,
        test_branch,
        merge_strategy,
        linked_folders: vec![],
        commit_prefix_index: None,
        git_user_name: None,
        git_user_email: None,
        tags: vec![],
    });

    save_workspace_config_internal(&workspace_path, &config)?;
    log::info!("[git] Successfully added existing project '{}'", name);
    Ok(())
}

#[tauri::command]
pub(crate) async fn add_existing_project(
    window: tauri::Window,
    name: String,
    base_branch: String,
    test_branch: String,
    merge_strategy: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    blocking(move || {
        add_existing_project_impl(&label, name, base_branch, test_branch, merge_strategy)
    })
    .await
}

// ==================== 导入外部项目到 projects/ ====================

pub fn import_external_project_impl(
    window_label: &str,
    source_path: String,
) -> Result<crate::types::ExistingProjectInfo, String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err(format!("Path does not exist: {}", source_path));
    }
    if !source.join(".git").exists() {
        return Err("Selected folder is not a git repository (no .git found)".to_string());
    }

    let folder_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Cannot determine folder name from path")?
        .to_string();

    let projects_dir = PathBuf::from(&workspace_path).join("projects");
    let dest = projects_dir.join(&folder_name);

    // Check if already exists in projects/
    if dest.exists() {
        let is_registered = config.projects.iter().any(|p| p.name == folder_name);
        // Get current branch
        let current_branch = git_command()
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&dest)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "unknown".to_string());
        return Ok(crate::types::ExistingProjectInfo {
            name: folder_name,
            current_branch,
            is_registered,
        });
    }

    // Ensure projects/ dir exists
    std::fs::create_dir_all(&projects_dir)
        .map_err(|e| friendly_fs_error("无法创建 projects 目录", &e))?;

    // Copy the project directory
    log::info!(
        "[git] Importing external project from '{}' to '{}'",
        source_path,
        dest.display()
    );
    copy_dir_recursive(&source, &dest).map_err(|e| friendly_fs_error("复制项目失败", &e))?;

    // Get current branch of the copied project
    let current_branch = git_command()
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&dest)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    log::info!(
        "[git] Successfully imported project '{}' (branch: {})",
        folder_name,
        current_branch
    );

    Ok(crate::types::ExistingProjectInfo {
        name: folder_name,
        current_branch,
        is_registered: false,
    })
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn import_external_project(
    window: tauri::Window,
    source_path: String,
) -> Result<crate::types::ExistingProjectInfo, String> {
    let label = window.label().to_string();
    blocking(move || import_external_project_impl(&label, source_path)).await
}

pub fn remove_project_from_config_impl(window_label: &str, name: String) -> Result<(), String> {
    let (workspace_path, mut config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    // Check that the project exists in config
    if !config.projects.iter().any(|p| p.name == name) {
        return Err(format!("Project '{}' is not in the configuration", name));
    }

    // Check that no worktree references this project
    let root = PathBuf::from(&workspace_path);
    let worktrees_dir = root.join(&config.worktrees_dir);
    let mut referencing_worktrees = vec![];

    if worktrees_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&worktrees_dir) {
            for entry in entries.flatten() {
                let wt_path = entry.path();
                if !wt_path.is_dir() {
                    continue;
                }
                let wt_name = wt_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                // Skip archived worktrees (they end with .archive)
                if wt_name.ends_with(".archive") {
                    continue;
                }

                let proj_in_wt = wt_path.join("projects").join(&name);
                if proj_in_wt.symlink_metadata().is_ok() {
                    referencing_worktrees.push(wt_name);
                }
            }
        }
    }

    if !referencing_worktrees.is_empty() {
        return Err(format!(
            "Cannot remove project '{}': it is referenced by worktree(s): {}",
            name,
            referencing_worktrees.join(", ")
        ));
    }

    log::info!(
        "[git] Removing project '{}' from config (directory NOT deleted)",
        name
    );

    config.projects.retain(|p| p.name != name);
    save_workspace_config_internal(&workspace_path, &config)?;

    log::info!("[git] Successfully removed project '{}' from config", name);
    Ok(())
}

#[tauri::command]
pub(crate) async fn remove_project_from_config(
    window: tauri::Window,
    name: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    blocking(move || remove_project_from_config_impl(&label, name)).await
}

// ==================== Tauri 命令：Git 高级操作 ====================

#[tauri::command]
pub(crate) async fn sync_with_base_branch(
    path: String,
    base_branch: String,
) -> Result<String, String> {
    validate_git_ref_name(&base_branch)?;
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::sync_with_base_branch(Path::new(&normalized), &base_branch)
    })
    .await;
    log_git_command_error("sync_with_base_branch", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn push_to_remote(path: String) -> Result<String, String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::push_to_remote(Path::new(&normalized))
    })
    .await;
    log_git_command_error("push_to_remote", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn pull_current_branch(path: String) -> Result<String, String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::pull_current_branch(Path::new(&normalized))
    })
    .await;
    log_git_command_error("pull_current_branch", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn merge_to_test_branch(
    path: String,
    test_branch: String,
) -> Result<String, String> {
    validate_git_ref_name(&test_branch)?;
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::merge_to_test_branch(Path::new(&normalized), &test_branch)
    })
    .await;
    log_git_command_error("merge_to_test_branch", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn merge_to_base_branch(
    path: String,
    base_branch: String,
) -> Result<String, String> {
    validate_git_ref_name(&base_branch)?;
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::merge_to_base_branch(Path::new(&normalized), &base_branch)
    })
    .await;
    log_git_command_error("merge_to_base_branch", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn get_branch_diff_stats(
    path: String,
    base_branch: String,
    test_branch: Option<String>,
) -> Result<git_ops::BranchDiffStats, String> {
    validate_git_ref_name(&base_branch)?;
    if let Some(branch) = &test_branch {
        validate_git_ref_name(branch)?;
    }
    let path_for_log = path.clone();
    let result = tokio::task::spawn_blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_branch_diff_stats(Path::new(&normalized), &base_branch, test_branch.as_deref())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e));
    log_git_command_error("get_branch_diff_stats", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn create_pull_request(
    path: String,
    base_branch: String,
    title: String,
    body: String,
) -> Result<String, String> {
    validate_git_ref_name(&base_branch)?;
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::create_pull_request(Path::new(&normalized), &base_branch, &title, &body)
    })
    .await;
    log_git_command_error("create_pull_request", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn fetch_project_remote(path: String) -> Result<(), String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::fetch_remote(Path::new(&normalized))
    })
    .await;
    log_git_command_error("fetch_project_remote", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn check_remote_branch_exists(
    path: String,
    branch_name: String,
) -> Result<bool, String> {
    validate_git_ref_name(&branch_name)?;
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::check_remote_branch_exists(Path::new(&normalized), &branch_name)
    })
    .await;
    log_git_command_error("check_remote_branch_exists", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn get_remote_branches(path: String) -> Result<Vec<String>, String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_remote_branches(Path::new(&normalized))
    })
    .await;
    log_git_command_error("get_remote_branches", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn get_git_diff(path: String) -> Result<String, String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_git_diff(Path::new(&normalized))
    })
    .await;
    log_git_command_error("get_git_diff", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn commit_all(
    path: String,
    message: String,
    author_name: Option<String>,
    author_email: Option<String>,
    skip_hooks: Option<bool>,
) -> Result<String, String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::commit_all(
            Path::new(&normalized),
            &message,
            author_name.as_deref(),
            author_email.as_deref(),
            skip_hooks.unwrap_or(false),
        )
    })
    .await;
    log_git_command_error("commit_all", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn get_git_user_config(
    path: String,
) -> Result<(Option<String>, Option<String>), String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_git_user_config(Path::new(&normalized))
    })
    .await;
    log_git_command_error("get_git_user_config", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn set_git_user_config(
    path: String,
    name: Option<String>,
    email: Option<String>,
) -> Result<(), String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::set_git_user_config(Path::new(&normalized), name.as_deref(), email.as_deref())
    })
    .await;
    log_git_command_error("set_git_user_config", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn get_changed_files(path: String) -> Result<Vec<git_ops::ChangedFile>, String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_changed_files(Path::new(&normalized))
    })
    .await;
    log_git_command_error("get_changed_files", &path_for_log, result)
}

#[tauri::command]
pub(crate) async fn get_file_diff(
    path: String,
    file_path: String,
) -> Result<git_ops::FileDiff, String> {
    let path_for_log = path.clone();
    let result = blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_file_diff(Path::new(&normalized), &file_path)
    })
    .await;
    log_git_command_error("get_file_diff", &path_for_log, result)
}

// ==================== HTTP Server 共享接口 ====================

pub fn switch_branch_internal(request: &SwitchBranchRequest) -> Result<(), String> {
    validate_git_ref_name(&request.branch)?;

    log::info!(
        "[git] switch_branch_internal: path='{}', target='{}'",
        request.project_path,
        request.branch
    );
    let path = PathBuf::from(&request.project_path);
    if !path.exists() {
        log::error!(
            "[git] Project path does not exist: {}",
            request.project_path
        );
        return Err(format!(
            "Project path does not exist: {}",
            request.project_path
        ));
    }
    log::info!("[git] Step 1/3: git fetch origin");
    let _ = git_command()
        .args(["fetch", "origin"])
        .current_dir(&path)
        .output();
    log::info!("[git] Step 2/3: git checkout {}", request.branch);
    let checkout_output = git_command()
        .args(["checkout", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to checkout: {}", e))?;
    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        let stderr_for_log = mask_url_credentials(&stderr);
        log::error!(
            "[git] Step 2/3 FAILED: git checkout {}: {}",
            request.branch,
            stderr_for_log
        );
        return Err(format!("Failed to checkout {}: {}", request.branch, stderr));
    }
    log::info!("[git] Step 3/3: git pull origin {}", request.branch);
    let _ = git_command()
        .args(["pull", "origin", &request.branch])
        .current_dir(&path)
        .output();
    log::info!("[git] Successfully switched to branch '{}'", request.branch);
    Ok(())
}

// ==================== Sync All Projects to BASE ====================

#[derive(Debug, serde::Serialize, Clone)]
pub struct SyncBaseResult {
    pub path: String,
    pub project_name: String,
    pub status: String, // "success" | "skipped" | "failed"
    pub message: String,
}

struct SyncPermitRelease(std::sync::mpsc::SyncSender<()>);

impl Drop for SyncPermitRelease {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

fn sync_worker_join_result(
    join_result: std::thread::Result<SyncBaseResult>,
    path: String,
    project_name: String,
) -> SyncBaseResult {
    match join_result {
        Ok(result) => result,
        Err(_) => {
            log::error!(
                "[sync-base] Worker thread panicked for project '{}'",
                project_name
            );
            SyncBaseResult {
                path,
                project_name,
                status: "failed".to_string(),
                message: "内部错误：同步线程异常退出".to_string(),
            }
        }
    }
}

pub(crate) fn sync_all_projects_to_base_impl(
    window_label: &str,
    project_paths: Vec<String>,
) -> Result<Vec<SyncBaseResult>, String> {
    let (_, config) = get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let projects_config: Vec<(String, String)> = config
        .projects
        .iter()
        .map(|p| (p.name.clone(), p.base_branch.clone()))
        .collect();

    let max_concurrent = project_paths.len().clamp(1, 8);

    log::info!(
        "[sync-base] Syncing {} projects to their base branches (max concurrent: {})",
        project_paths.len(),
        max_concurrent
    );

    // Use a channel-based semaphore to avoid tokio block_on in thread::scope
    let (sem_tx, sem_rx) = std::sync::mpsc::sync_channel::<()>(max_concurrent);
    let sem_rx = Arc::new(std::sync::Mutex::new(sem_rx));

    // Pre-fill permits
    for _ in 0..max_concurrent {
        let _ = sem_tx.send(());
    }

    let results: Vec<SyncBaseResult> = std::thread::scope(|s| {
        let mut handles = Vec::new();

        for project_path in &project_paths {
            let path = PathBuf::from(project_path.clone());
            let project_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(project_path.as_str())
                .to_string();
            let base_branch = projects_config
                .iter()
                .find(|(name, _)| name == &project_name)
                .map(|(_, b)| b.clone())
                .unwrap_or_else(|| {
                    log::warn!(
                        "[sync-base] Project '{}' not found in config, defaulting to 'main'",
                        project_name
                    );
                    "main".to_string()
                });
            let result_path = path.to_string_lossy().to_string();
            let result_project_name = project_name.clone();

            // Acquire permit: blocks if max concurrent reached
            let rx = sem_rx.clone();
            rx.lock().unwrap().recv().expect("Semaphore channel closed");

            let tx = sem_tx.clone();
            let handle = s.spawn(move || {
                let _permit = SyncPermitRelease(tx);
                sync_single_project_to_base(&path, &project_name, &base_branch)
            });
            handles.push((result_path, result_project_name, handle));
        }

        let mut results = Vec::new();
        for (path, project_name, handle) in handles {
            results.push(sync_worker_join_result(handle.join(), path, project_name));
        }
        results
    });

    log::info!(
        "[sync-base] Done. Results: {} success, {} skipped, {} failed",
        results.iter().filter(|r| r.status == "success").count(),
        results.iter().filter(|r| r.status == "skipped").count(),
        results.iter().filter(|r| r.status == "failed").count(),
    );

    Ok(results)
}

/// Push with exponential backoff retry (synchronous — safe for use in thread::scope)
fn retry_push(project_path: &str, max_retries: u32) -> Result<(), String> {
    let mut delay_ms = 1000u64;
    for attempt in 0..max_retries {
        match git_ops::push_to_remote(Path::new(project_path)) {
            Ok(_) => {
                log::info!(
                    "[sync-base] Push succeeded after {} attempt(s)",
                    attempt + 1
                );
                return Ok(());
            }
            Err(e) if attempt < max_retries - 1 => {
                let error_for_log = mask_url_credentials(&e);
                log::warn!(
                    "[sync-base] Push attempt {} failed: {}, retrying in {}ms...",
                    attempt + 1,
                    error_for_log,
                    delay_ms
                );
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                delay_ms *= 2;
            }
            Err(e) => {
                let error_for_log = mask_url_credentials(&e);
                log::error!(
                    "[sync-base] Push attempt {} failed: {}",
                    attempt + 1,
                    error_for_log
                );
                return Err(e);
            }
        }
    }
    Ok(())
}

fn sync_single_project_to_base(
    path: &Path,
    project_name: &str,
    base_branch: &str,
) -> SyncBaseResult {
    let path_str = path.to_string_lossy().to_string();

    if let Err(e) = validate_git_ref_name(base_branch) {
        log::error!(
            "[sync-base] {}: invalid base branch '{}': {}",
            project_name,
            base_branch,
            e
        );
        return SyncBaseResult {
            path: path_str,
            project_name: project_name.to_string(),
            status: "failed".to_string(),
            message: e,
        };
    }

    if !path.exists() {
        log::error!("[sync-base] Project path does not exist: {}", path_str);
        return SyncBaseResult {
            path: path_str,
            project_name: project_name.to_string(),
            status: "failed".to_string(),
            message: "Project path does not exist".to_string(),
        };
    }

    match git_ops::sync_with_base_branch(path, base_branch) {
        Ok(msg) => {
            log::info!("[sync-base] {}: sync succeeded - {}", project_name, msg);

            let push_result = retry_push(&path_str, 3);

            match push_result {
                Ok(()) => {
                    log::info!(
                        "[sync-base] {}: success - {} (push succeeded)",
                        project_name,
                        msg
                    );
                    SyncBaseResult {
                        path: path_str,
                        project_name: project_name.to_string(),
                        status: "success".to_string(),
                        message: format!("{} (push succeeded)", msg),
                    }
                }
                Err(e) => {
                    let error_for_log = mask_url_credentials(&e);
                    log::error!(
                        "[sync-base] {}: push failed - {}",
                        project_name,
                        error_for_log
                    );
                    SyncBaseResult {
                        path: path_str,
                        project_name: project_name.to_string(),
                        status: "failed".to_string(),
                        message: format!("{} (push failed: {})", msg, e),
                    }
                }
            }
        }
        Err(e) => {
            let error_for_log = mask_url_credentials(&e);
            log::error!("[sync-base] {}: failed - {}", project_name, error_for_log);
            SyncBaseResult {
                path: path_str,
                project_name: project_name.to_string(),
                status: "failed".to_string(),
                message: e,
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn sync_all_projects_to_base(
    window: tauri::Window,
    project_paths: Vec<String>,
) -> Result<Vec<SyncBaseResult>, String> {
    let label = window.label().to_string();
    blocking(move || sync_all_projects_to_base_impl(&label, project_paths)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::load_workspace_config;
    use crate::state::WINDOW_WORKSPACES;
    use crate::types::WorkspaceConfig;
    use serial_test::serial;
    use std::path::Path;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Mutex, Once};
    use tempfile::TempDir;

    struct TestLogger;

    static TEST_LOGGER: TestLogger = TestLogger;
    static LOGGER_INIT: Once = Once::new();
    static LOG_MESSAGES: Mutex<Vec<String>> = Mutex::new(Vec::new());
    static NEXT_WINDOW_ID: AtomicUsize = AtomicUsize::new(0);

    impl log::Log for TestLogger {
        fn enabled(&self, metadata: &log::Metadata<'_>) -> bool {
            metadata.level() <= log::Level::Error
        }

        fn log(&self, record: &log::Record<'_>) {
            if self.enabled(record.metadata()) {
                LOG_MESSAGES
                    .lock()
                    .expect("lock log messages")
                    .push(format!("{}", record.args()));
            }
        }

        fn flush(&self) {}
    }

    fn init_test_logger() {
        LOGGER_INIT.call_once(|| {
            log::set_logger(&TEST_LOGGER).expect("set test logger");
            log::set_max_level(log::LevelFilter::Error);
        });
        LOG_MESSAGES.lock().expect("clear log messages").clear();
    }

    fn run_git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn git_output(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn make_test_repo() -> TempDir {
        let temp = tempfile::tempdir().expect("create temp repo");
        let repo = temp.path();

        run_git(repo, &["init"]);
        run_git(repo, &["checkout", "-b", "main"]);
        run_git(repo, &["config", "user.email", "test@example.com"]);
        run_git(repo, &["config", "user.name", "Test User"]);
        std::fs::write(repo.join("README.md"), "initial\n").expect("write initial file");
        run_git(repo, &["add", "README.md"]);
        run_git(repo, &["commit", "-m", "initial commit"]);
        run_git(repo, &["branch", "feature/local"]);

        temp
    }

    fn workspace_config(projects: Vec<ProjectConfig>) -> WorkspaceConfig {
        WorkspaceConfig {
            name: "Git Command Workspace".to_string(),
            worktrees_dir: "worktrees".to_string(),
            projects,
            ..WorkspaceConfig::default()
        }
    }

    fn project_config(name: &str, base_branch: &str) -> ProjectConfig {
        ProjectConfig {
            name: name.to_string(),
            base_branch: base_branch.to_string(),
            test_branch: "test".to_string(),
            merge_strategy: "merge".to_string(),
            linked_folders: vec![],
            commit_prefix_index: None,
            git_user_name: None,
            git_user_email: None,
            tags: vec![],
        }
    }

    fn bind_workspace(workspace: &Path, config: &WorkspaceConfig) -> String {
        let label = format!(
            "git-test-window-{}",
            NEXT_WINDOW_ID.fetch_add(1, Ordering::SeqCst)
        );
        let workspace_path = workspace.to_string_lossy().to_string();
        save_workspace_config_internal(&workspace_path, config).expect("save workspace config");
        WINDOW_WORKSPACES
            .lock()
            .expect("lock window workspaces")
            .insert(label.clone(), workspace_path);
        label
    }

    fn init_named_repo(parent: &Path, name: &str) -> PathBuf {
        let repo = parent.join(name);
        std::fs::create_dir_all(&repo).expect("create named repo");
        run_git(&repo, &["init"]);
        run_git(&repo, &["checkout", "-b", "main"]);
        run_git(&repo, &["config", "user.email", "test@example.com"]);
        run_git(&repo, &["config", "user.name", "Test User"]);
        std::fs::write(repo.join("README.md"), format!("{name}\n")).expect("write readme");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial commit"]);
        repo
    }

    fn init_bare_repo(origin_path: &Path) {
        let output = Command::new("git")
            .args(["init", "--bare"])
            .arg(origin_path)
            .output()
            .expect("init bare origin");
        assert!(
            output.status.success(),
            "git init --bare {} failed\nstdout:\n{}\nstderr:\n{}",
            origin_path.display(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn make_bare_origin() -> TempDir {
        let origin = tempfile::tempdir().expect("create bare origin dir");
        init_bare_repo(origin.path());
        let seed = make_test_repo();
        run_git(seed.path(), &["branch", "test"]);
        run_git(
            seed.path(),
            &["remote", "add", "origin", origin.path().to_str().unwrap()],
        );
        run_git(seed.path(), &["push", "origin", "main"]);
        run_git(seed.path(), &["push", "origin", "test"]);
        run_git(seed.path(), &["push", "origin", "feature/local"]);
        run_git(origin.path(), &["symbolic-ref", "HEAD", "refs/heads/main"]);
        origin
    }

    fn clone_repo(origin_path: &Path, clone_path: &Path) {
        let output = Command::new("git")
            .arg("clone")
            .arg(origin_path)
            .arg(clone_path)
            .output()
            .expect("clone repo");
        assert!(
            output.status.success(),
            "git clone {} {} failed\nstdout:\n{}\nstderr:\n{}",
            origin_path.display(),
            clone_path.display(),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn make_origin_backed_repo() -> (TempDir, TempDir) {
        let origin = make_bare_origin();
        let clone = tempfile::tempdir().expect("create clone dir");
        clone_repo(origin.path(), clone.path());
        run_git(clone.path(), &["config", "user.email", "test@example.com"]);
        run_git(clone.path(), &["config", "user.name", "Test User"]);
        run_git(clone.path(), &["checkout", "feature/local"]);
        (origin, clone)
    }

    #[serial]
    #[test]
    fn sync_worker_join_result_converts_panic_to_failed_result() {
        let join_result = std::thread::spawn(|| -> SyncBaseResult {
            panic!("worker panic");
        })
        .join();

        let result = sync_worker_join_result(
            join_result,
            "/tmp/workspace/projects/demo".to_string(),
            "demo".to_string(),
        );

        assert_eq!(result.path, "/tmp/workspace/projects/demo");
        assert_eq!(result.project_name, "demo");
        assert_eq!(result.status, "failed");
        assert_eq!(result.message, "内部错误：同步线程异常退出");
    }

    #[serial]
    #[tokio::test]
    async fn switch_branch_switches_to_existing_branch_even_when_fetch_and_pull_fail() {
        let repo = make_test_repo();
        let request = SwitchBranchRequest {
            project_path: repo.path().to_string_lossy().to_string(),
            branch: "feature/local".to_string(),
        };

        switch_branch(request).await.expect("switch branch");

        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "feature/local"
        );
    }

    #[serial]
    #[test]
    fn switch_branch_internal_switches_existing_branch() {
        let repo = make_test_repo();
        let request = SwitchBranchRequest {
            project_path: repo.path().to_string_lossy().to_string(),
            branch: "feature/local".to_string(),
        };

        switch_branch_internal(&request).expect("switch branch internally");

        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "feature/local"
        );
    }

    #[serial]
    #[tokio::test]
    async fn switch_branch_returns_checkout_error_for_missing_branch() {
        let repo = make_test_repo();
        let request = SwitchBranchRequest {
            project_path: repo.path().to_string_lossy().to_string(),
            branch: "missing-branch".to_string(),
        };

        let err = switch_branch(request).await.unwrap_err();

        assert!(err.contains("Failed to checkout missing-branch"), "{err}");
        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "main"
        );
    }

    #[serial]
    #[tokio::test]
    async fn switch_branch_reports_missing_project_path() {
        let missing = tempfile::tempdir()
            .expect("create temp dir")
            .path()
            .join("missing-project");
        let request = SwitchBranchRequest {
            project_path: missing.to_string_lossy().to_string(),
            branch: "main".to_string(),
        };

        let err = switch_branch(request).await.unwrap_err();

        assert_eq!(
            err,
            format!("Project path does not exist: {}", missing.display())
        );
    }

    #[serial]
    #[tokio::test]
    async fn switch_branch_rejects_invalid_ref_before_path_lookup() {
        let request = SwitchBranchRequest {
            project_path: "/path/that/does/not/exist".to_string(),
            branch: "-upload-pack=sh".to_string(),
        };

        let err = switch_branch(request).await.unwrap_err();

        assert_eq!(err, "无效的分支名");
    }

    #[serial]
    #[test]
    fn log_git_command_error_masks_credentials_in_logs_and_returns_original_error() {
        init_test_logger();
        let raw_error =
            "fatal: Authentication failed for https://user:secret-token@example.com/repo.git";

        let result = log_git_command_error::<()>(
            "clone_project_test_unique",
            "/tmp/redaction-test",
            Err(raw_error.to_string()),
        );

        assert_eq!(result.unwrap_err(), raw_error);
        let joined = LOG_MESSAGES.lock().expect("read log messages").join("\n");
        assert!(joined.contains("clone_project_test_unique"), "{joined}");
        assert!(
            joined.contains("https://***@example.com/repo.git"),
            "{joined}"
        );
        assert!(!joined.contains("secret-token"), "{joined}");
    }

    #[serial]
    #[tokio::test]
    async fn get_changed_files_command_returns_parsed_entries() {
        let repo = make_test_repo();
        std::fs::write(repo.path().join("README.md"), "changed\n").expect("modify readme");
        std::fs::write(repo.path().join("new.txt"), "new\n").expect("write new file");

        let files = get_changed_files(repo.path().to_string_lossy().to_string())
            .await
            .expect("get changed files");

        let readme = files
            .iter()
            .find(|file| file.path == "README.md")
            .expect("README.md changed file");
        assert_eq!(readme.status, "M");
        assert!(!readme.staged);

        let new_file = files
            .iter()
            .find(|file| file.path == "new.txt")
            .expect("new.txt changed file");
        assert_eq!(new_file.status, "?");
        assert!(!new_file.staged);
    }

    #[serial]
    #[tokio::test]
    async fn get_git_diff_command_propagates_clean_repo_error() {
        let repo = make_test_repo();

        let err = get_git_diff(repo.path().to_string_lossy().to_string())
            .await
            .unwrap_err();

        assert_eq!(err, "No changes to commit");
    }

    #[serial]
    #[tokio::test]
    async fn set_and_get_git_user_config_commands_round_trip_local_config() {
        let repo = make_test_repo();
        let path = repo.path().to_string_lossy().to_string();

        set_git_user_config(
            path.clone(),
            Some("Command User".to_string()),
            Some("command@example.com".to_string()),
        )
        .await
        .expect("set git user config");

        let (name, email) = get_git_user_config(path)
            .await
            .expect("get git user config");
        assert_eq!(name.as_deref(), Some("Command User"));
        assert_eq!(email.as_deref(), Some("command@example.com"));
    }

    #[serial]
    #[tokio::test]
    async fn commit_all_command_commits_local_changes_and_returns_message() {
        let repo = make_test_repo();
        let path = repo.path().to_string_lossy().to_string();
        std::fs::write(repo.path().join("README.md"), "committed\n").expect("modify readme");

        let result = commit_all(path, "command commit".to_string(), None, None, Some(true))
            .await
            .expect("commit all");

        assert_eq!(result, "Committed: command commit");
        assert_eq!(
            git_output(repo.path(), &["log", "-1", "--pretty=%s"]),
            "command commit"
        );
    }

    #[serial]
    #[test]
    fn clone_project_reports_existing_target_and_rejects_file_url_local_remote() {
        let workspace = tempfile::tempdir().expect("create workspace");
        std::fs::create_dir_all(workspace.path().join("projects")).expect("create projects dir");
        let label = bind_workspace(workspace.path(), &workspace_config(vec![]));
        let origin = make_bare_origin();
        let file_url = format!("file://{}", origin.path().display());

        let err = clone_project_impl(
            &label,
            CloneProjectRequest {
                name: "demo".to_string(),
                repo_url: file_url.clone(),
                base_branch: "main".to_string(),
                test_branch: "test".to_string(),
                merge_strategy: "merge".to_string(),
                linked_folders: vec!["node_modules".to_string()],
            },
        )
        .unwrap_err();
        assert_eq!(err, format!("Invalid repository URL format: {file_url}"));
        assert!(!workspace.path().join("projects").join("demo").exists());

        std::fs::create_dir_all(workspace.path().join("projects").join("existing"))
            .expect("create existing target");
        let existing = clone_project_impl(
            &label,
            CloneProjectRequest {
                name: "existing".to_string(),
                repo_url: file_url,
                base_branch: "main".to_string(),
                test_branch: "test".to_string(),
                merge_strategy: "merge".to_string(),
                linked_folders: vec![],
            },
        )
        .unwrap_err();
        assert_eq!(existing, "Project 'existing' already exists");
    }

    #[serial]
    #[test]
    fn scan_import_add_and_remove_existing_projects_update_workspace_config() {
        let workspace = tempfile::tempdir().expect("create workspace");
        std::fs::create_dir_all(workspace.path().join("projects")).expect("create projects dir");
        let external = tempfile::tempdir().expect("create external parent");
        let source = init_named_repo(external.path(), "alpha");
        let label = bind_workspace(workspace.path(), &workspace_config(vec![]));

        let imported = import_external_project_impl(&label, source.to_string_lossy().to_string())
            .expect("import external project");
        assert_eq!(imported.name, "alpha");
        assert_eq!(imported.current_branch, "main");
        assert!(!imported.is_registered);

        let scanned = scan_existing_projects_impl(&label).expect("scan imported project");
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].name, "alpha");
        assert_eq!(scanned[0].current_branch, "main");
        assert!(!scanned[0].is_registered);

        add_existing_project_impl(
            &label,
            "alpha".to_string(),
            "main".to_string(),
            "test".to_string(),
            "merge".to_string(),
        )
        .expect("add existing project");
        let scanned = scan_existing_projects_impl(&label).expect("scan registered project");
        assert!(scanned[0].is_registered);

        let duplicate = add_existing_project_impl(
            &label,
            "alpha".to_string(),
            "main".to_string(),
            "test".to_string(),
            "merge".to_string(),
        )
        .unwrap_err();
        assert_eq!(duplicate, "Project 'alpha' is already registered");

        let reference = workspace
            .path()
            .join("worktrees")
            .join("feature_a")
            .join("projects")
            .join("alpha");
        std::fs::create_dir_all(&reference).expect("create worktree project reference");
        let blocked = remove_project_from_config_impl(&label, "alpha".to_string()).unwrap_err();
        assert!(
            blocked.contains("referenced by worktree(s): feature_a"),
            "{blocked}"
        );

        std::fs::remove_dir_all(workspace.path().join("worktrees")).expect("remove reference");
        remove_project_from_config_impl(&label, "alpha".to_string())
            .expect("remove project from config");
        let saved = load_workspace_config(&workspace.path().to_string_lossy());
        assert!(saved.projects.is_empty());

        let missing = remove_project_from_config_impl(&label, "alpha".to_string()).unwrap_err();
        assert_eq!(missing, "Project 'alpha' is not in the configuration");
    }

    #[serial]
    #[tokio::test]
    async fn advanced_git_command_wrappers_use_local_bare_origin_success_paths() {
        let (_origin, repo) = make_origin_backed_repo();
        let path = repo.path().to_string_lossy().to_string();

        switch_branch(SwitchBranchRequest {
            project_path: path.clone(),
            branch: "main".to_string(),
        })
        .await
        .expect("switch to main with fetch and pull");
        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "main"
        );

        switch_branch(SwitchBranchRequest {
            project_path: path.clone(),
            branch: "feature/local".to_string(),
        })
        .await
        .expect("switch back to feature");
        assert_eq!(
            git_output(repo.path(), &["branch", "--show-current"]),
            "feature/local"
        );

        assert_eq!(
            sync_with_base_branch(path.clone(), "main".to_string())
                .await
                .expect("sync with base"),
            "Successfully synced with main"
        );
        assert_eq!(
            push_to_remote(path.clone())
                .await
                .expect("push feature branch"),
            "Successfully pushed feature/local to origin"
        );
        assert_eq!(
            pull_current_branch(path.clone())
                .await
                .expect("pull feature branch"),
            "Successfully pulled feature/local from origin"
        );
        fetch_project_remote(path.clone())
            .await
            .expect("fetch remote");
        assert!(
            check_remote_branch_exists(path.clone(), "feature/local".to_string())
                .await
                .expect("check feature remote branch")
        );
        assert!(
            !check_remote_branch_exists(path.clone(), "missing".to_string())
                .await
                .expect("check missing remote branch")
        );
        let branches = get_remote_branches(path.clone())
            .await
            .expect("get remote branches");
        assert!(branches.contains(&"main".to_string()), "{branches:?}");
        assert!(branches.contains(&"test".to_string()), "{branches:?}");
        assert!(
            branches.contains(&"feature/local".to_string()),
            "{branches:?}"
        );

        let test_merge = merge_to_test_branch(path.clone(), "test".to_string())
            .await
            .expect("merge to test");
        assert!(test_merge.contains("feature/local"), "{test_merge}");
        let base_merge = merge_to_base_branch(path.clone(), "main".to_string())
            .await
            .expect("merge to base");
        assert!(base_merge.contains("feature/local"), "{base_merge}");

        std::fs::write(repo.path().join("README.md"), "wrapper change\n").expect("modify readme");
        let stats =
            get_branch_diff_stats(path.clone(), "main".to_string(), Some("test".to_string()))
                .await
                .expect("get diff stats");
        assert_eq!(stats.changed_files, 1);
        let diff = get_file_diff(path, "README.md".to_string())
            .await
            .expect("get file diff");
        assert_eq!(diff.old_content, "initial\n");
        assert_eq!(diff.new_content, "wrapper change\n");
        assert!(!diff.is_binary);
    }

    #[serial]
    #[tokio::test]
    async fn advanced_git_command_wrappers_propagate_validation_and_git_errors() {
        let non_git = tempfile::tempdir().expect("create non git dir");
        let path = non_git.path().to_string_lossy().to_string();

        let invalid_sync = sync_with_base_branch(path.clone(), "bad..branch".to_string())
            .await
            .unwrap_err();
        assert_eq!(invalid_sync, "无效的分支名");

        let fetch_err = fetch_project_remote(path.clone()).await.unwrap_err();
        assert!(fetch_err.contains("Git fetch failed"), "{fetch_err}");

        let remote_check_err = check_remote_branch_exists(path.clone(), "main".to_string())
            .await
            .unwrap_err();
        assert!(
            remote_check_err.contains("Git branch check failed"),
            "{remote_check_err}"
        );

        let invalid_remote_branch =
            check_remote_branch_exists(path.clone(), "bad..branch".to_string())
                .await
                .unwrap_err();
        assert_eq!(invalid_remote_branch, "无效的分支名");

        let remote_branches_err = get_remote_branches(path.clone()).await.unwrap_err();
        assert!(
            remote_branches_err.contains("Git fetch failed"),
            "{remote_branches_err}"
        );

        let pr_validation = create_pull_request(
            path,
            "bad..branch".to_string(),
            "title".to_string(),
            "body".to_string(),
        )
        .await
        .unwrap_err();
        assert_eq!(pr_validation, "无效的分支名");
    }

    #[serial]
    #[test]
    fn sync_all_projects_to_base_reports_success_missing_path_and_invalid_base() {
        let (_origin, repo) = make_origin_backed_repo();
        let workspace = tempfile::tempdir().expect("create workspace");
        let project_name = repo
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .expect("repo dir name")
            .to_string();
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config(&project_name, "main")]),
        );
        let missing_path = workspace.path().join("projects").join("missing");

        let results = sync_all_projects_to_base_impl(
            &label,
            vec![
                repo.path().to_string_lossy().to_string(),
                missing_path.to_string_lossy().to_string(),
            ],
        )
        .expect("sync all projects");

        assert_eq!(results.len(), 2);
        let success = results
            .iter()
            .find(|result| result.path == repo.path().to_string_lossy())
            .expect("success result");
        assert_eq!(success.project_name, project_name);
        assert_eq!(success.status, "success");
        assert!(success.message.contains("push succeeded"), "{success:?}");

        let missing = results
            .iter()
            .find(|result| result.path == missing_path.to_string_lossy())
            .expect("missing result");
        assert_eq!(missing.project_name, "missing");
        assert_eq!(missing.status, "failed");
        assert_eq!(missing.message, "Project path does not exist");

        let invalid = sync_single_project_to_base(repo.path(), "demo", "bad..branch");
        assert_eq!(invalid.status, "failed");
        assert_eq!(invalid.message, "无效的分支名");
    }
}
