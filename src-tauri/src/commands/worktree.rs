use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::commands::window::broadcast_lock_state;
use crate::config::{
    clear_occupation_state, get_window_workspace_config, load_occupation_state,
    save_occupation_state,
};
use crate::git_ops::{get_branch_status, get_worktree_info};
use crate::state::PTY_MANAGER;
use crate::types::{
    AddProjectToWorktreeRequest, CreateWorktreeRequest, DeployProjectError, DeployToMainResult,
    MainProjectStatus, MainWorkspaceOccupation, MainWorkspaceStatus, ProjectConfig, ProjectStatus,
    ScannedFolder, WorktreeArchiveStatus, WorktreeListItem,
};
use crate::utils::{normalize_path, run_git_command_with_timeout, scan_dir_for_linkable_folders};

/// Cross-platform symlink creation.
/// On Unix: uses std::os::unix::fs::symlink.
/// On Windows: uses symlink_dir for directories, symlink_file for files.
///             Falls back to junction for directories if symlink fails (no admin/dev mode).
fn create_symlink(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, dst)
    }
    #[cfg(windows)]
    {
        if src.is_dir() {
            // Try symlink_dir first (requires admin or developer mode)
            match std::os::windows::fs::symlink_dir(src, dst) {
                Ok(()) => Ok(()),
                Err(_) => {
                    // Fallback: use junction (works without admin rights)
                    let status = std::process::Command::new("cmd")
                        .args(["/c", "mklink", "/J"])
                        .arg(dst.as_os_str())
                        .arg(src.as_os_str())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .status()
                        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
                    if status.success() {
                        Ok(())
                    } else {
                        Err(std::io::Error::new(
                            std::io::ErrorKind::PermissionDenied,
                            "Failed to create junction",
                        ))
                    }
                }
            }
        } else {
            std::os::windows::fs::symlink_file(src, dst)
        }
    }
}

// ==================== Tauri 命令：Worktree 操作 ====================

pub fn list_worktrees_impl(
    window_label: &str,
    include_archived: bool,
) -> Result<Vec<WorktreeListItem>, String> {
    let start = std::time::Instant::now();
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let worktrees_path = PathBuf::from(&workspace_path).join(&config.worktrees_dir);

    if !worktrees_path.exists() {
        return Ok(vec![]);
    }

    let result = scan_worktrees_dir(&worktrees_path, &config, include_archived);
    log::info!("list_worktrees took {:?}", start.elapsed());
    result
}

#[tauri::command]
pub(crate) fn list_worktrees(
    window: tauri::Window,
    include_archived: bool,
) -> Result<Vec<WorktreeListItem>, String> {
    list_worktrees_impl(window.label(), include_archived)
}

fn scan_worktrees_dir(
    dir: &PathBuf,
    config: &crate::types::WorkspaceConfig,
    include_archived: bool,
) -> Result<Vec<WorktreeListItem>, String> {
    let mut result = vec![];

    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
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

                let proj_name = proj_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                let proj_config = config
                    .projects
                    .iter()
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
    let start = std::time::Instant::now();
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

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
            path: normalize_path(&proj_path.to_string_lossy()),
            current_branch: info.current_branch,
            has_uncommitted: info.uncommitted_count > 0,
            uncommitted_count: info.uncommitted_count,
            is_merged_to_test: info.is_merged_to_test,
            ahead_of_base: info.ahead_of_base,
            behind_base: info.behind_base,
            base_branch: proj_config.base_branch.clone(),
            test_branch: proj_config.test_branch.clone(),
            linked_folders: proj_config.linked_folders.clone(),
        });
    }

    let result = MainWorkspaceStatus {
        path: normalize_path(&root_path.to_string_lossy()),
        name: config.name.clone(),
        projects,
    };
    log::info!("get_main_workspace_status took {:?}", start.elapsed());
    Ok(result)
}

#[tauri::command]
pub(crate) fn get_main_workspace_status(
    window: tauri::Window,
) -> Result<MainWorkspaceStatus, String> {
    get_main_workspace_status_impl(window.label())
}

pub fn create_worktree_impl(
    window_label: &str,
    request: CreateWorktreeRequest,
) -> Result<String, String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&request.name);

    let project_count = request.projects.len();
    log::info!(
        "[worktree] Creating worktree '{}' in workspace '{}' with {} projects",
        request.name, workspace_path, project_count
    );

    // Create worktree directory
    log::info!("[worktree] Step 1: Creating directory structure at {}", worktree_path.display());
    std::fs::create_dir_all(worktree_path.join("projects"))
        .map_err(|e| format!("Failed to create worktree directory: {}", e))?;

    // Create symlinks for workspace-level items
    log::info!(
        "[worktree] Step 2: Creating workspace-level symlinks ({} items)",
        config.linked_workspace_items.len()
    );
    for name in &config.linked_workspace_items {
        let src = root.join(name);
        let dst = worktree_path.join(name);
        if src.exists() && !dst.exists() {
            #[allow(unused_variables)]
            let link_result = create_symlink(&src, &dst);
            log::debug!("[worktree] Linked workspace item: {} (result: {:?})", name, link_result);
        }
    }

    // Create worktrees for each project
    for proj_req in &request.projects {
        let proj_config = config
            .projects
            .iter()
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
        log::info!(
            "[worktree] Project '{}': git fetch origin",
            proj_req.name
        );
        run_git_command_with_timeout(&["fetch", "origin"], main_proj_path.to_str().unwrap())?;

        // Check if branch already exists
        let branch_check = Command::new("git")
            .args([
                "-C",
                main_proj_path.to_str().unwrap(),
                "branch",
                "--list",
                &request.name,
            ])
            .output();

        let branch_exists = branch_check
            .as_ref()
            .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
            .unwrap_or(false);

        // Create worktree: use existing branch or create new one
        let output = if branch_exists {
            log::info!(
                "Branch '{}' already exists, using it for project {}",
                request.name,
                proj_req.name
            );
            Command::new("git")
                .args([
                    "-C",
                    main_proj_path.to_str().unwrap(),
                    "worktree",
                    "add",
                    wt_proj_path.to_str().unwrap(),
                    &request.name,
                ])
                .output()
                .map_err(|e| format!("Failed to create worktree: {}", e))?
        } else {
            log::info!(
                "Creating new branch '{}' for project {} from origin/{}",
                request.name,
                proj_req.name,
                proj_req.base_branch
            );
            Command::new("git")
                .args([
                    "-C",
                    main_proj_path.to_str().unwrap(),
                    "worktree",
                    "add",
                    wt_proj_path.to_str().unwrap(),
                    "-b",
                    &request.name,
                    &format!("origin/{}", proj_req.base_branch),
                ])
                .output()
                .map_err(|e| format!("Failed to create worktree: {}", e))?
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!(
                "[worktree] FAILED: git worktree add for project '{}': {}",
                proj_req.name, stderr
            );
            return Err(format!(
                "Failed to create worktree for {}: {}",
                proj_req.name, stderr
            ));
        }
        log::info!("[worktree] Project '{}': git worktree add succeeded", proj_req.name);

        // Link configured folders
        log::info!(
            "[worktree] Project '{}': Creating symlinks for {} linked folders",
            proj_req.name, proj_config.linked_folders.len()
        );
        for folder_name in &proj_config.linked_folders {
            let main_folder = main_proj_path.join(folder_name);
            let wt_folder = wt_proj_path.join(folder_name);

            if main_folder.exists() && !wt_folder.exists() {
                create_symlink(&main_folder, &wt_folder).ok();

                // Remove from git index if it's tracked
                Command::new("git")
                    .args([
                        "-C",
                        wt_proj_path.to_str().unwrap(),
                        "rm",
                        "--cached",
                        "-r",
                        folder_name,
                    ])
                    .output()
                    .ok();
            }
        }
    }

    log::info!(
        "[worktree] Successfully created worktree '{}' with {} projects",
        request.name, project_count
    );
    Ok(normalize_path(&worktree_path.to_string_lossy()))
}

#[tauri::command]
pub(crate) fn create_worktree(
    window: tauri::Window,
    request: CreateWorktreeRequest,
) -> Result<String, String> {
    create_worktree_impl(window.label(), request)
}

pub fn archive_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&name);

    let archive_name = format!("{}.archive", name);
    let archive_path = root.join(&config.worktrees_dir).join(&archive_name);

    if !worktree_path.exists() {
        return Err("Worktree does not exist".to_string());
    }

    log::info!("[worktree] Archiving worktree '{}' in workspace '{}'", name, workspace_path);

    // Step 1: Close all PTY sessions associated with this worktree
    log::info!("[worktree] Step 1/3: Closing PTY sessions for worktree '{}'", name);
    {
        let worktree_path_str = worktree_path.to_string_lossy().to_string();
        if let Ok(mut manager) = PTY_MANAGER.lock() {
            let closed = manager.close_sessions_by_path_prefix(&worktree_path_str);
            if !closed.is_empty() {
                log::info!(
                    "[worktree] Closed {} PTY sessions for archived worktree: {:?}",
                    closed.len(),
                    closed
                );
            } else {
                log::info!("[worktree] No PTY sessions to close");
            }
        }
    }

    // Step 2: Remove git worktrees first
    log::info!("[worktree] Step 2/3: Removing git worktree registrations for '{}'", name);
    let projects_path = worktree_path.join("projects");
    if projects_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_path) {
            for entry in entries.flatten() {
                let proj_path = entry.path();
                let proj_name = proj_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                let main_proj_path = root.join("projects").join(proj_name);

                log::info!("[worktree] Removing git worktree for project '{}'", proj_name);
                let output = Command::new("git")
                    .args([
                        "-C",
                        main_proj_path.to_str().unwrap(),
                        "worktree",
                        "remove",
                        proj_path.to_str().unwrap(),
                        "--force",
                    ])
                    .output();

                match &output {
                    Ok(o) if o.status.success() => {
                        log::info!("[worktree] Successfully removed git worktree for '{}'", proj_name);
                    }
                    Ok(o) => {
                        log::warn!(
                            "[worktree] git worktree remove for '{}' returned non-zero: {}",
                            proj_name,
                            String::from_utf8_lossy(&o.stderr)
                        );
                    }
                    Err(e) => {
                        log::warn!("[worktree] Failed to execute git worktree remove for '{}': {}", proj_name, e);
                    }
                }
            }
        }
    }

    // Step 3: Rename directory to .archive
    log::info!("[worktree] Step 3/3: Renaming directory to '{}'", archive_name);
    // If archive directory already exists (e.g. from a previous failed attempt), remove it first
    if archive_path.exists() {
        log::warn!(
            "[worktree] Archive directory already exists, removing: {:?}",
            archive_path
        );
        fs::remove_dir_all(&archive_path)
            .map_err(|e| format!("Failed to remove existing archive directory: {}", e))?;
    }

    std::fs::rename(&worktree_path, &archive_path)
        .map_err(|e| format!("Failed to archive worktree: {}", e))?;

    log::info!("[worktree] Successfully archived worktree '{}'", name);
    Ok(())
}

#[tauri::command]
pub(crate) fn archive_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    archive_worktree_impl(window.label(), name)
}

pub fn check_worktree_status_impl(
    window_label: &str,
    name: String,
) -> Result<WorktreeArchiveStatus, String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

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

            let proj_name = proj_path
                .file_name()
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
                    status
                        .warnings
                        .push(format!("{}: 分支未推送到远端", proj_name));
                }
            }

            if !branch_status.has_merge_request && branch_status.is_pushed {
                status
                    .warnings
                    .push(format!("{}: 请确认是否已创建 Merge Request", proj_name));
            }

            status.projects.push(branch_status);
        }
    }

    Ok(status)
}

#[tauri::command]
pub(crate) fn check_worktree_status(
    window: tauri::Window,
    name: String,
) -> Result<WorktreeArchiveStatus, String> {
    check_worktree_status_impl(window.label(), name)
}

pub fn restore_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let archive_path = root.join(&config.worktrees_dir).join(&name);

    let restored_name = name.strip_suffix(".archive").unwrap_or(&name);
    let worktree_path = root.join(&config.worktrees_dir).join(restored_name);

    if !archive_path.exists() {
        return Err("Archived worktree does not exist".to_string());
    }

    log::info!(
        "[worktree] Restoring worktree '{}' from archive in workspace '{}'",
        restored_name, workspace_path
    );

    // Step 1: Rename archive directory to restored path
    log::info!("[worktree] Step 1/3: Renaming archive directory to '{}'", restored_name);
    // If target directory already exists, remove it first
    if worktree_path.exists() {
        log::warn!(
            "[worktree] Target directory already exists, removing: {:?}",
            worktree_path
        );
        fs::remove_dir_all(&worktree_path)
            .map_err(|e| format!("Failed to remove existing directory: {}", e))?;
    }

    // Rename archive directory to restored path
    std::fs::rename(&archive_path, &worktree_path)
        .map_err(|e| format!("Failed to restore worktree: {}", e))?;

    // Step 2: Re-register git worktrees for each project
    log::info!("[worktree] Step 2/3: Re-registering git worktrees for '{}'", restored_name);
    let projects_path = worktree_path.join("projects");
    if projects_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_path) {
            for entry in entries.flatten() {
                let proj_path = entry.path();
                if !proj_path.is_dir() {
                    continue;
                }

                let proj_name = proj_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                let main_proj_path = root.join("projects").join(&proj_name);
                if !main_proj_path.exists() {
                    log::warn!(
                        "Main project path does not exist for {}, skipping",
                        proj_name
                    );
                    continue;
                }

                // Remove the old project directory content (it was archived without git worktree registration)
                // We need to remove it and re-add via git worktree add
                let wt_proj_path = projects_path.join(&proj_name);

                // Check if branch exists
                let branch_name = restored_name;
                let branch_check = Command::new("git")
                    .args([
                        "-C",
                        main_proj_path.to_str().unwrap(),
                        "branch",
                        "--list",
                        branch_name,
                    ])
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
                    log::info!(
                        "Re-adding worktree for {} with existing branch {}",
                        proj_name,
                        branch_name
                    );
                    Command::new("git")
                        .args([
                            "-C",
                            main_proj_path.to_str().unwrap(),
                            "worktree",
                            "add",
                            wt_proj_path.to_str().unwrap(),
                            branch_name,
                        ])
                        .output()
                } else {
                    // Find appropriate base branch from project config
                    let base_branch = config
                        .projects
                        .iter()
                        .find(|p| p.name == proj_name)
                        .map(|p| p.base_branch.clone())
                        .unwrap_or_else(|| "uat".to_string());

                    log::info!(
                        "Re-adding worktree for {} with new branch {} from origin/{}",
                        proj_name,
                        branch_name,
                        base_branch
                    );
                    Command::new("git")
                        .args([
                            "-C",
                            main_proj_path.to_str().unwrap(),
                            "worktree",
                            "add",
                            wt_proj_path.to_str().unwrap(),
                            "-b",
                            branch_name,
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
                        log::error!(
                            "Failed to execute git worktree add for {}: {}",
                            proj_name,
                            e
                        );
                    }
                }

                // Restore project-level symlinks (linked_folders)
                let proj_config = config.projects.iter().find(|p| p.name == proj_name);
                if let Some(pc) = proj_config {
                    for folder_name in &pc.linked_folders {
                        let main_folder = main_proj_path.join(folder_name);
                        let wt_folder = wt_proj_path.join(folder_name);

                        if main_folder.exists() && !wt_folder.exists() {
                            create_symlink(&main_folder, &wt_folder).ok();
                        }
                    }
                }
            }
        }
    }

    // Step 3: Restore workspace-level symlinks
    log::info!(
        "[worktree] Step 3/3: Restoring workspace-level symlinks ({} items)",
        config.linked_workspace_items.len()
    );
    for item_name in &config.linked_workspace_items {
        let src = root.join(item_name);
        let dst = worktree_path.join(item_name);
        if src.exists() && !dst.exists() {
            create_symlink(&src, &dst).ok();
        }
    }

    log::info!("Successfully restored worktree '{}'", restored_name);
    Ok(())
}

#[tauri::command]
pub(crate) fn restore_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    restore_worktree_impl(window.label(), name)
}

pub fn delete_archived_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

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
    log::info!(
        "[worktree] Deleting archived worktree '{}' (branch: {}) in workspace '{}'",
        name, branch_name, workspace_path
    );

    // Step 1: Close any related PTY sessions
    log::info!("[worktree] Step 1/3: Closing PTY sessions for archived worktree '{}'", name);
    {
        let archive_path_str = archive_path.to_string_lossy().to_string();
        if let Ok(mut manager) = PTY_MANAGER.lock() {
            let closed = manager.close_sessions_by_path_prefix(&archive_path_str);
            if !closed.is_empty() {
                log::info!("[worktree] Closed {} PTY sessions for deleted worktree", closed.len());
            } else {
                log::info!("[worktree] No PTY sessions to close");
            }
        }
    }

    // Step 2: Delete associated local branches for each project
    log::info!("[worktree] Step 2/3: Deleting local branch '{}' from projects", branch_name);
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
                    .args([
                        "-C",
                        proj_path.to_str().unwrap(),
                        "branch",
                        "-D",
                        branch_name,
                    ])
                    .output();

                match output {
                    Ok(o) if o.status.success() => {
                        let proj_name =
                            proj_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        log::info!(
                            "Deleted branch '{}' from project '{}'",
                            branch_name,
                            proj_name
                        );
                    }
                    _ => {} // Branch might not exist in this project, that's fine
                }
            }
        }
    }

    // Step 3: Remove the directory
    log::info!("[worktree] Step 3/3: Removing directory {}", archive_path.display());
    fs::remove_dir_all(&archive_path)
        .map_err(|e| format!("Failed to delete archived worktree: {}", e))?;

    log::info!("[worktree] Successfully deleted archived worktree '{}'", name);
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_archived_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    delete_archived_worktree_impl(window.label(), name)
}

// ==================== 向已有 Worktree 添加项目 ====================

pub fn add_project_to_worktree_impl(
    window_label: &str,
    request: AddProjectToWorktreeRequest,
) -> Result<(), String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root
        .join(&config.worktrees_dir)
        .join(&request.worktree_name);

    if !worktree_path.exists() {
        return Err(format!(
            "Worktree '{}' does not exist",
            request.worktree_name
        ));
    }

    let main_proj_path = root.join("projects").join(&request.project_name);
    if !main_proj_path.exists() {
        return Err(format!(
            "Project '{}' does not exist in main workspace",
            request.project_name
        ));
    }

    let wt_proj_path = worktree_path.join("projects").join(&request.project_name);
    if wt_proj_path.exists() {
        return Err(format!(
            "Project '{}' already exists in worktree '{}'",
            request.project_name, request.worktree_name
        ));
    }

    // Ensure the projects directory exists in the worktree
    let projects_dir = worktree_path.join("projects");
    if !projects_dir.exists() {
        std::fs::create_dir_all(&projects_dir)
            .map_err(|e| format!("Failed to create projects directory: {}", e))?;
    }

    let proj_config = config
        .projects
        .iter()
        .find(|p| p.name == request.project_name)
        .cloned()
        .unwrap_or(ProjectConfig {
            name: request.project_name.clone(),
            base_branch: request.base_branch.clone(),
            test_branch: "test".to_string(),
            merge_strategy: "merge".to_string(),
            linked_folders: vec![],
        });

    log::info!(
        "[worktree] Adding project '{}' to worktree '{}' (base_branch: {})",
        request.project_name, request.worktree_name, request.base_branch
    );

    // Step 1: Fetch origin first
    log::info!(
        "[worktree] Step 1/3: git fetch origin for project '{}'",
        request.project_name
    );
    run_git_command_with_timeout(&["fetch", "origin"], main_proj_path.to_str().unwrap())?;

    // Check if branch already exists
    let branch_check = Command::new("git")
        .args([
            "-C",
            main_proj_path.to_str().unwrap(),
            "branch",
            "--list",
            &request.worktree_name,
        ])
        .output();

    let branch_exists = branch_check
        .as_ref()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    // Step 2: Create worktree - use existing branch or create new one
    log::info!(
        "[worktree] Step 2/3: git worktree add for project '{}'",
        request.project_name
    );
    let output = if branch_exists {
        log::info!(
            "[worktree] Branch '{}' already exists, using it for project '{}'",
            request.worktree_name,
            request.project_name
        );
        Command::new("git")
            .args([
                "-C",
                main_proj_path.to_str().unwrap(),
                "worktree",
                "add",
                wt_proj_path.to_str().unwrap(),
                &request.worktree_name,
            ])
            .output()
            .map_err(|e| format!("Failed to create worktree: {}", e))?
    } else {
        log::info!(
            "[worktree] Creating new branch '{}' for project '{}' from origin/{}",
            request.worktree_name,
            request.project_name,
            request.base_branch
        );
        Command::new("git")
            .args([
                "-C",
                main_proj_path.to_str().unwrap(),
                "worktree",
                "add",
                wt_proj_path.to_str().unwrap(),
                "-b",
                &request.worktree_name,
                &format!("origin/{}", request.base_branch),
            ])
            .output()
            .map_err(|e| format!("Failed to create worktree: {}", e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!(
            "[worktree] FAILED: git worktree add for project '{}': {}",
            request.project_name, stderr
        );
        return Err(format!(
            "Failed to add project {} to worktree: {}",
            request.project_name, stderr
        ));
    }
    log::info!(
        "[worktree] Project '{}': git worktree add succeeded",
        request.project_name
    );

    // Step 3: Link configured folders
    log::info!(
        "[worktree] Step 3/3: Creating symlinks for {} linked folders",
        proj_config.linked_folders.len()
    );
    for folder_name in &proj_config.linked_folders {
        let main_folder = main_proj_path.join(folder_name);
        let wt_folder = wt_proj_path.join(folder_name);

        if main_folder.exists() && !wt_folder.exists() {
            create_symlink(&main_folder, &wt_folder).ok();

            // Remove from git index if it's tracked
            Command::new("git")
                .args([
                    "-C",
                    wt_proj_path.to_str().unwrap(),
                    "rm",
                    "--cached",
                    "-r",
                    folder_name,
                ])
                .output()
                .ok();
        }
    }

    log::info!(
        "Successfully added project '{}' to worktree '{}'",
        request.project_name,
        request.worktree_name
    );
    Ok(())
}

#[tauri::command]
pub(crate) fn add_project_to_worktree(
    window: tauri::Window,
    request: AddProjectToWorktreeRequest,
) -> Result<(), String> {
    add_project_to_worktree_impl(window.label(), request)
}

// ==================== 智能扫描 ====================

#[tauri::command]
pub(crate) async fn scan_linked_folders(
    project_path: String,
) -> Result<Vec<ScannedFolder>, String> {
    scan_linked_folders_sync(&project_path)
}

pub fn scan_linked_folders_internal(project_path: &str) -> Result<Vec<ScannedFolder>, String> {
    scan_linked_folders_sync(project_path)
}

fn scan_linked_folders_sync(project_path: &str) -> Result<Vec<ScannedFolder>, String> {
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

// ==================== 部署到主工作区 ====================

pub fn deploy_to_main_impl(
    window_label: &str,
    worktree_name: String,
) -> Result<DeployToMainResult, String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    // Check not already occupied
    if let Some(existing) = load_occupation_state(&workspace_path) {
        return Err(format!(
            "Main workspace is already occupied by worktree '{}'",
            existing.worktree_name
        ));
    }

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&worktree_name);

    if !worktree_path.exists() {
        return Err(format!("Worktree '{}' does not exist", worktree_name));
    }

    let wt_projects_path = worktree_path.join("projects");
    if !wt_projects_path.exists() {
        return Err("Worktree has no projects directory".to_string());
    }

    // Collect worktree project branches
    let mut wt_branches: HashMap<String, String> = HashMap::new();
    if let Ok(entries) = std::fs::read_dir(&wt_projects_path) {
        for entry in entries.flatten() {
            let proj_path = entry.path();
            if !proj_path.is_dir() {
                continue;
            }
            let proj_name = proj_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let info = crate::git_ops::get_worktree_info(&proj_path);
            wt_branches.insert(proj_name, info.current_branch);
        }
    }

    if wt_branches.is_empty() {
        return Err("No projects found in worktree".to_string());
    }

    // Check main workspace projects for uncommitted changes
    let main_projects_path = root.join("projects");
    let mut original_branches: HashMap<String, String> = HashMap::new();

    for (proj_name, _) in &wt_branches {
        let main_proj_path = main_projects_path.join(proj_name);
        if !main_proj_path.exists() {
            continue;
        }

        let info = crate::git_ops::get_worktree_info(&main_proj_path);
        if info.uncommitted_count > 0 {
            return Err(format!(
                "Project '{}' in main workspace has {} uncommitted changes. Please commit or stash them first.",
                proj_name, info.uncommitted_count
            ));
        }
        original_branches.insert(proj_name.clone(), info.current_branch);
    }

    let occupation = MainWorkspaceOccupation {
        worktree_name: worktree_name.clone(),
        original_branches: original_branches.clone(),
        deployed_at: chrono::Utc::now().to_rfc3339(),
    };

    let mut switched_projects = Vec::new();
    let mut failed_projects = Vec::new();

    // Detach worktree project HEADs and switch main workspace branches
    for (proj_name, wt_branch) in &wt_branches {
        let wt_proj_path = wt_projects_path.join(proj_name);
        let main_proj_path = main_projects_path.join(proj_name);

        if !main_proj_path.exists() {
            continue;
        }

        // Step 1: Detach worktree HEAD
        log::info!(
            "[deploy] Detaching HEAD in worktree project '{}'",
            proj_name
        );
        let detach_output = Command::new("git")
            .args(["-C", wt_proj_path.to_str().unwrap(), "checkout", "--detach"])
            .output();

        match &detach_output {
            Ok(o) if o.status.success() => {
                log::info!("[deploy] Detached HEAD in worktree project '{}'", proj_name);
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                log::error!(
                    "[deploy] Failed to detach HEAD in '{}': {}",
                    proj_name,
                    stderr
                );
                failed_projects.push(DeployProjectError {
                    project_name: proj_name.clone(),
                    error: format!("Failed to detach worktree HEAD: {}", stderr),
                });
                continue;
            }
            Err(e) => {
                log::error!(
                    "[deploy] Failed to run git detach in '{}': {}",
                    proj_name,
                    e
                );
                failed_projects.push(DeployProjectError {
                    project_name: proj_name.clone(),
                    error: format!("Failed to run git: {}", e),
                });
                continue;
            }
        }

        // Step 2: Switch main workspace project to worktree branch
        log::info!(
            "[deploy] Switching main project '{}' to branch '{}'",
            proj_name,
            wt_branch
        );
        let switch_output = Command::new("git")
            .args([
                "-C",
                main_proj_path.to_str().unwrap(),
                "checkout",
                wt_branch,
            ])
            .output();

        match switch_output {
            Ok(o) if o.status.success() => {
                log::info!(
                    "[deploy] Switched main project '{}' to '{}'",
                    proj_name,
                    wt_branch
                );
                switched_projects.push(proj_name.clone());
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                log::error!(
                    "[deploy] Failed to switch main '{}' to '{}': {}",
                    proj_name,
                    wt_branch,
                    stderr
                );
                failed_projects.push(DeployProjectError {
                    project_name: proj_name.clone(),
                    error: format!("Failed to switch branch: {}", stderr),
                });
            }
            Err(e) => {
                log::error!(
                    "[deploy] Failed to run git checkout in main '{}': {}",
                    proj_name,
                    e
                );
                failed_projects.push(DeployProjectError {
                    project_name: proj_name.clone(),
                    error: format!("Failed to run git: {}", e),
                });
            }
        }
    }

    // Only persist occupation state if at least one project deployed successfully
    if !switched_projects.is_empty() {
        save_occupation_state(&workspace_path, &occupation)?;
    }

    log::info!(
        "[deploy] Deploy complete: {} switched, {} failed",
        switched_projects.len(),
        failed_projects.len()
    );

    broadcast_lock_state(&workspace_path);

    Ok(DeployToMainResult {
        success: failed_projects.is_empty(),
        switched_projects,
        failed_projects,
    })
}

#[tauri::command]
pub(crate) fn deploy_to_main(
    window: tauri::Window,
    worktree_name: String,
) -> Result<DeployToMainResult, String> {
    deploy_to_main_impl(window.label(), worktree_name)
}

pub fn exit_main_occupation_impl(window_label: &str, force: bool) -> Result<(), String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let occupation = load_occupation_state(&workspace_path)
        .ok_or("Main workspace is not currently occupied")?;

    let root = PathBuf::from(&workspace_path);
    let main_projects_path = root.join("projects");
    let worktree_path = root
        .join(&config.worktrees_dir)
        .join(&occupation.worktree_name);
    let wt_projects_path = worktree_path.join("projects");

    // If not force, check for uncommitted changes in main workspace
    if !force {
        for (proj_name, _) in &occupation.original_branches {
            let main_proj_path = main_projects_path.join(proj_name);
            if !main_proj_path.exists() {
                continue;
            }

            let info = crate::git_ops::get_worktree_info(&main_proj_path);
            if info.uncommitted_count > 0 {
                return Err(format!(
                    "Project '{}' in main workspace has {} uncommitted changes. Use force to discard them.",
                    proj_name, info.uncommitted_count
                ));
            }
        }
    }

    // Switch main workspace projects back to original branches
    for (proj_name, original_branch) in &occupation.original_branches {
        let main_proj_path = main_projects_path.join(proj_name);
        if !main_proj_path.exists() {
            continue;
        }

        log::info!(
            "[deploy] Switching main project '{}' back to '{}'",
            proj_name,
            original_branch
        );

        // If force, fully discard all changes (staged, tracked, and untracked)
        if force {
            Command::new("git")
                .args(["-C", main_proj_path.to_str().unwrap(), "reset", "HEAD"])
                .output()
                .ok();
            Command::new("git")
                .args([
                    "-C",
                    main_proj_path.to_str().unwrap(),
                    "checkout",
                    "--",
                    ".",
                ])
                .output()
                .ok();
            Command::new("git")
                .args(["-C", main_proj_path.to_str().unwrap(), "clean", "-fd"])
                .output()
                .ok();
        }

        let output = Command::new("git")
            .args([
                "-C",
                main_proj_path.to_str().unwrap(),
                "checkout",
                original_branch,
            ])
            .output()
            .map_err(|e| format!("Failed to switch project '{}': {}", proj_name, e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "Failed to switch project '{}' back to '{}': {}",
                proj_name, original_branch, stderr
            ));
        }
    }

    // Re-attach worktree project branches
    for (proj_name, _) in &occupation.original_branches {
        let wt_proj_path = wt_projects_path.join(proj_name);
        if !wt_proj_path.exists() {
            continue;
        }

        // The branch name should be the worktree name (convention)
        let branch = &occupation.worktree_name;
        log::info!(
            "[deploy] Re-attaching worktree project '{}' to branch '{}'",
            proj_name,
            branch
        );

        let output = Command::new("git")
            .args(["-C", wt_proj_path.to_str().unwrap(), "checkout", branch])
            .output();

        match output {
            Ok(o) if o.status.success() => {
                log::info!("[deploy] Re-attached worktree project '{}'", proj_name);
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                log::warn!(
                    "[deploy] Failed to re-attach worktree '{}': {}",
                    proj_name,
                    stderr
                );
            }
            Err(e) => {
                log::warn!(
                    "[deploy] Failed to run git checkout in worktree '{}': {}",
                    proj_name,
                    e
                );
            }
        }
    }

    // Clear occupation state
    clear_occupation_state(&workspace_path)?;

    log::info!(
        "[deploy] Exited occupation from worktree '{}'",
        occupation.worktree_name
    );

    broadcast_lock_state(&workspace_path);

    Ok(())
}

#[tauri::command]
pub(crate) fn exit_main_occupation(window: tauri::Window, force: bool) -> Result<(), String> {
    exit_main_occupation_impl(window.label(), force)
}

pub fn get_main_occupation_impl(
    window_label: &str,
) -> Result<Option<MainWorkspaceOccupation>, String> {
    let (workspace_path, _config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    Ok(load_occupation_state(&workspace_path))
}

#[tauri::command]
pub(crate) fn get_main_occupation(
    window: tauri::Window,
) -> Result<Option<MainWorkspaceOccupation>, String> {
    get_main_occupation_impl(window.label())
}
