use std::path::{Path, PathBuf};

use crate::config::{get_window_workspace_config, save_workspace_config_internal};
use crate::git_ops;
use crate::types::{CloneProjectRequest, ProjectConfig, SwitchBranchRequest};
use crate::utils::{git_command, normalize_path, parse_repo_url};

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
        // Fetch failure is not critical, continue with checkout
        log::warn!(
            "[git] Step 1/3: git fetch failed (non-critical), continuing: {}",
            String::from_utf8_lossy(&fetch_output.stderr)
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
        log::error!(
            "[git] Step 2/3 FAILED: git checkout {}: {}",
            request.branch,
            stderr
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
        log::warn!("[git] Step 3/3: git pull failed (non-critical): {}", stderr);
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
    blocking(move || switch_branch_sync(request)).await
}

pub fn clone_project_impl(window_label: &str, request: CloneProjectRequest) -> Result<(), String> {
    let (workspace_path, mut config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let projects_path = PathBuf::from(&workspace_path).join("projects");
    let target_path = projects_path.join(&request.name);

    // Sanitize URL for logging (may contain tokens)
    let safe_url = if request.repo_url.contains('@') && request.repo_url.contains("://") {
        // URL with possible embedded credentials: scheme://user:token@host/...
        request
            .repo_url
            .split('@')
            .next_back()
            .map(|h| format!("***@{}", h))
            .unwrap_or_else(|| "<redacted>".to_string())
    } else {
        request.repo_url.clone()
    };

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
        .args(["clone", &git_url, target_path.to_str().unwrap()])
        .output()
        .map_err(|e| format!("Failed to clone repository: {}", e))?;

    if !clone_output.status.success() {
        let stderr = String::from_utf8_lossy(&clone_output.stderr);
        log::error!("[git] Step 1/3 FAILED: git clone: {}", stderr);
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
        .map_err(|e| format!("Failed to read projects dir: {}", e))?;

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
    blocking(move || add_existing_project_impl(&label, name, base_branch, test_branch, merge_strategy)).await
}

pub fn remove_project_from_config_impl(
    window_label: &str,
    name: String,
) -> Result<(), String> {
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
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::sync_with_base_branch(Path::new(&normalized), &base_branch)
    })
    .await
}

#[tauri::command]
pub(crate) async fn push_to_remote(path: String) -> Result<String, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::push_to_remote(Path::new(&normalized))
    })
    .await
}

#[tauri::command]
pub(crate) async fn merge_to_test_branch(
    path: String,
    test_branch: String,
) -> Result<String, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::merge_to_test_branch(Path::new(&normalized), &test_branch)
    })
    .await
}

#[tauri::command]
pub(crate) async fn merge_to_base_branch(
    path: String,
    base_branch: String,
) -> Result<String, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::merge_to_base_branch(Path::new(&normalized), &base_branch)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_branch_diff_stats(
    path: String,
    base_branch: String,
) -> Result<git_ops::BranchDiffStats, String> {
    let result = tokio::task::spawn_blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_branch_diff_stats(Path::new(&normalized), &base_branch)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn create_pull_request(
    path: String,
    base_branch: String,
    title: String,
    body: String,
) -> Result<String, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::create_pull_request(Path::new(&normalized), &base_branch, &title, &body)
    })
    .await
}

#[tauri::command]
pub(crate) async fn fetch_project_remote(path: String) -> Result<(), String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::fetch_remote(Path::new(&normalized))
    })
    .await
}

#[tauri::command]
pub(crate) async fn check_remote_branch_exists(
    path: String,
    branch_name: String,
) -> Result<bool, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::check_remote_branch_exists(Path::new(&normalized), &branch_name)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_remote_branches(path: String) -> Result<Vec<String>, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_remote_branches(Path::new(&normalized))
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_git_diff(path: String) -> Result<String, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_git_diff(Path::new(&normalized))
    })
    .await
}

#[tauri::command]
pub(crate) async fn commit_all(path: String, message: String) -> Result<String, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::commit_all(Path::new(&normalized), &message)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_changed_files(path: String) -> Result<Vec<git_ops::ChangedFile>, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_changed_files(Path::new(&normalized))
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_file_diff(
    path: String,
    file_path: String,
) -> Result<git_ops::FileDiff, String> {
    blocking(move || {
        let normalized = normalize_path(&path);
        git_ops::get_file_diff(Path::new(&normalized), &file_path)
    })
    .await
}

// ==================== HTTP Server 共享接口 ====================

pub fn switch_branch_internal(request: &SwitchBranchRequest) -> Result<(), String> {
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
        log::error!(
            "[git] Step 2/3 FAILED: git checkout {}: {}",
            request.branch,
            stderr
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
