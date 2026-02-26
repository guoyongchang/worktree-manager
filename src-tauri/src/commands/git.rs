use std::path::{Path, PathBuf};
use std::process::Command;

use crate::config::{get_window_workspace_config, save_workspace_config_internal};
use crate::git_ops;
use crate::types::{CloneProjectRequest, ProjectConfig, SwitchBranchRequest};
use crate::utils::{normalize_path, parse_repo_url};

// ==================== Tauri 命令：Git 操作 ====================

#[tauri::command]
pub(crate) fn switch_branch(request: SwitchBranchRequest) -> Result<(), String> {
    log::info!(
        "[git] Switching branch: path='{}', target='{}'",
        request.project_path, request.branch
    );
    let path = PathBuf::from(&request.project_path);

    if !path.exists() {
        log::error!("[git] Project path does not exist: {}", request.project_path);
        return Err(format!(
            "Project path does not exist: {}",
            request.project_path
        ));
    }

    // Step 1: Fetch to ensure we have latest refs
    log::info!("[git] Step 1/3: git fetch origin");
    let fetch_output = Command::new("git")
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
    let checkout_output = Command::new("git")
        .args(["checkout", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to checkout: {}", e))?;

    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        log::error!("[git] Step 2/3 FAILED: git checkout {}: {}", request.branch, stderr);
        return Err(format!("Failed to checkout {}: {}", request.branch, stderr));
    }
    log::info!("[git] Step 2/3: git checkout {} succeeded", request.branch);

    // Step 3: Pull latest changes
    log::info!("[git] Step 3/3: git pull origin {}", request.branch);
    let pull_output = Command::new("git")
        .args(["pull", "origin", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to pull: {}", e))?;

    if !pull_output.status.success() {
        let stderr = String::from_utf8_lossy(&pull_output.stderr);
        log::warn!("[git] Step 3/3: git pull failed (non-critical): {}", stderr);
    } else {
        log::info!("[git] Step 3/3: git pull origin {} succeeded", request.branch);
    }

    log::info!(
        "[git] Successfully switched to branch '{}' at '{}'",
        request.branch, request.project_path
    );
    Ok(())
}

pub fn clone_project_impl(window_label: &str, request: CloneProjectRequest) -> Result<(), String> {
    let (workspace_path, mut config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let projects_path = PathBuf::from(&workspace_path).join("projects");
    let target_path = projects_path.join(&request.name);

    // Sanitize URL for logging (may contain tokens)
    let safe_url = if request.repo_url.contains('@') && request.repo_url.contains("://") {
        // URL with possible embedded credentials: scheme://user:token@host/...
        request.repo_url.split('@').next_back().map(|h| format!("***@{}", h)).unwrap_or_else(|| "<redacted>".to_string())
    } else {
        request.repo_url.clone()
    };

    log::info!(
        "[git] Cloning project: name='{}', url='{}', target='{}', base_branch='{}'",
        request.name, safe_url, target_path.display(), request.base_branch
    );

    // Check if project already exists
    if target_path.exists() {
        log::error!("[git] Project '{}' already exists at {}", request.name, target_path.display());
        return Err(format!("Project '{}' already exists", request.name));
    }

    // Parse repo URL and convert to git-compatible format
    let git_url = parse_repo_url(&request.repo_url)?;

    // Step 1: Clone the repository
    log::info!("[git] Step 1/3: git clone to {}", target_path.display());
    let clone_output = Command::new("git")
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
    let checkout_output = Command::new("git")
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
        log::info!("[git] Step 2/3: Checked out base branch '{}'", request.base_branch);
    }

    // Step 3: Add project to config
    log::info!("[git] Step 3/3: Adding project '{}' to workspace config", request.name);
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
pub(crate) fn clone_project(
    window: tauri::Window,
    request: CloneProjectRequest,
) -> Result<(), String> {
    clone_project_impl(window.label(), request)
}

// ==================== Tauri 命令：Git 高级操作 ====================

#[tauri::command]
pub(crate) fn sync_with_base_branch(path: String, base_branch: String) -> Result<String, String> {
    let normalized = normalize_path(&path);
    git_ops::sync_with_base_branch(Path::new(&normalized), &base_branch)
}

#[tauri::command]
pub(crate) fn push_to_remote(path: String) -> Result<String, String> {
    let normalized = normalize_path(&path);
    git_ops::push_to_remote(Path::new(&normalized))
}

#[tauri::command]
pub(crate) fn merge_to_test_branch(path: String, test_branch: String) -> Result<String, String> {
    let normalized = normalize_path(&path);
    git_ops::merge_to_test_branch(Path::new(&normalized), &test_branch)
}

#[tauri::command]
pub(crate) fn merge_to_base_branch(path: String, base_branch: String) -> Result<String, String> {
    let normalized = normalize_path(&path);
    git_ops::merge_to_base_branch(Path::new(&normalized), &base_branch)
}

#[tauri::command]
pub(crate) fn get_branch_diff_stats(path: String, base_branch: String) -> git_ops::BranchDiffStats {
    let normalized = normalize_path(&path);
    git_ops::get_branch_diff_stats(Path::new(&normalized), &base_branch)
}

#[tauri::command]
pub(crate) fn create_pull_request(
    path: String,
    base_branch: String,
    title: String,
    body: String,
) -> Result<String, String> {
    let normalized = normalize_path(&path);
    git_ops::create_pull_request(Path::new(&normalized), &base_branch, &title, &body)
}

#[tauri::command]
pub(crate) async fn fetch_project_remote(path: String) -> Result<(), String> {
    let normalized = normalize_path(&path);
    tokio::task::spawn_blocking(move || git_ops::fetch_remote(Path::new(&normalized)))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub(crate) fn check_remote_branch_exists(
    path: String,
    branch_name: String,
) -> Result<bool, String> {
    let normalized = normalize_path(&path);
    git_ops::check_remote_branch_exists(Path::new(&normalized), &branch_name)
}

#[tauri::command]
pub(crate) fn get_remote_branches(path: String) -> Result<Vec<String>, String> {
    let normalized = normalize_path(&path);
    git_ops::get_remote_branches(Path::new(&normalized))
}

// ==================== HTTP Server 共享接口 ====================

pub fn switch_branch_internal(request: &SwitchBranchRequest) -> Result<(), String> {
    log::info!(
        "[git] switch_branch_internal: path='{}', target='{}'",
        request.project_path, request.branch
    );
    let path = PathBuf::from(&request.project_path);
    if !path.exists() {
        log::error!("[git] Project path does not exist: {}", request.project_path);
        return Err(format!(
            "Project path does not exist: {}",
            request.project_path
        ));
    }
    log::info!("[git] Step 1/3: git fetch origin");
    let _ = Command::new("git")
        .args(["fetch", "origin"])
        .current_dir(&path)
        .output();
    log::info!("[git] Step 2/3: git checkout {}", request.branch);
    let checkout_output = Command::new("git")
        .args(["checkout", &request.branch])
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to checkout: {}", e))?;
    if !checkout_output.status.success() {
        let stderr = String::from_utf8_lossy(&checkout_output.stderr);
        log::error!("[git] Step 2/3 FAILED: git checkout {}: {}", request.branch, stderr);
        return Err(format!("Failed to checkout {}: {}", request.branch, stderr));
    }
    log::info!("[git] Step 3/3: git pull origin {}", request.branch);
    let _ = Command::new("git")
        .args(["pull", "origin", &request.branch])
        .current_dir(&path)
        .output();
    log::info!("[git] Successfully switched to branch '{}'", request.branch);
    Ok(())
}
