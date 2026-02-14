use std::path::{Path, PathBuf};
use std::process::Command;

use crate::types::{
    SwitchBranchRequest, CloneProjectRequest, ProjectConfig,
};
use crate::config::{
    get_window_workspace_config, save_workspace_config_internal,
};
use crate::utils::{normalize_path, parse_repo_url};
use crate::git_ops;

// ==================== Tauri 命令：Git 操作 ====================

#[tauri::command]
pub(crate) fn switch_branch(request: SwitchBranchRequest) -> Result<(), String> {
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
pub(crate) fn clone_project(window: tauri::Window, request: CloneProjectRequest) -> Result<(), String> {
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
    tokio::task::spawn_blocking(move || {
        git_ops::fetch_remote(Path::new(&normalized))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub(crate) fn check_remote_branch_exists(path: String, branch_name: String) -> Result<bool, String> {
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
