use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::window::broadcast_lock_state;
use crate::config::{
    clear_occupation_state, get_window_workspace_config, load_occupation_state,
    save_occupation_state, save_workspace_config_internal,
};
use crate::git_ops::{get_branch_status, get_worktree_info_for_branches};
use crate::state::{PTY_MANAGER, WINDOW_WORKSPACES};
use crate::types::{
    AddProjectToWorktreeRequest, CreateProjectRequest, CreateWorktreeRequest, DeployProjectError,
    DeployToMainResult, LockedProcessInfo, MainProjectStatus, MainWorkspaceOccupation,
    MainWorkspaceStatus, ProjectConfig, ProjectStatus, ScannedFolder, WorktreeArchiveStatus,
    WorktreeListItem,
};
use crate::utils::{
    friendly_fs_error, git_command, mask_url_credentials, normalize_path,
    run_git_command_with_timeout, scan_dir_for_linkable_folders, validate_git_ref_name,
};

/// Cross-platform symlink creation.
/// On Unix: uses std::os::unix::fs::symlink.
/// On Windows: uses symlink_dir for directories, symlink_file for files.
///             Falls back to junction for directories if symlink fails (no admin/dev mode).
pub(crate) fn create_symlink(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
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
                        .map_err(std::io::Error::other)?;
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

#[cfg(target_os = "windows")]
const LOCK_CHECK_MAX_RESOURCES: usize = 4096;
#[cfg(target_os = "windows")]
const LOCK_CHECK_BATCH_SIZE: usize = 128;

#[cfg(target_os = "windows")]
fn wide_string(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn fixed_wide_to_string(value: &[u16]) -> String {
    let end = value.iter().position(|ch| *ch == 0).unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
}

#[cfg(target_os = "windows")]
fn rm_app_type_name(value: i32) -> String {
    use windows_sys::Win32::System::RestartManager::{
        RmConsole, RmCritical, RmExplorer, RmMainWindow, RmOtherWindow, RmService,
    };

    match value {
        RmMainWindow => "main_window",
        RmOtherWindow => "other_window",
        RmService => "service",
        RmExplorer => "explorer",
        RmConsole => "console",
        RmCritical => "critical",
        _ => "unknown",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
fn collect_lock_check_resources(root: &Path) -> Vec<PathBuf> {
    let mut resources = Vec::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(path) = stack.pop() {
        if resources.len() >= LOCK_CHECK_MAX_RESOURCES {
            break;
        }

        resources.push(path.clone());
        let Ok(entries) = fs::read_dir(&path) else {
            continue;
        };

        for entry in entries.flatten() {
            if resources.len() >= LOCK_CHECK_MAX_RESOURCES {
                break;
            }

            let child = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&child) else {
                continue;
            };
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
            let is_reparse_point = metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;

            resources.push(child.clone());
            if metadata.is_dir() && !is_reparse_point {
                stack.push(child);
            }
        }
    }

    resources
}

#[cfg(target_os = "windows")]
fn filetime_to_string(value: windows_sys::Win32::Foundation::FILETIME) -> String {
    (((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64).to_string()
}

#[cfg(target_os = "windows")]
fn query_restart_manager(paths: &[PathBuf]) -> Result<Vec<LockedProcessInfo>, String> {
    use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_MORE_DATA, ERROR_SUCCESS};
    use windows_sys::Win32::System::RestartManager::{
        RmEndSession, RmGetList, RmRegisterResources, RmStartSession, CCH_RM_SESSION_KEY,
        RM_PROCESS_INFO,
    };

    let mut session = 0u32;
    let mut session_key = vec![0u16; (CCH_RM_SESSION_KEY + 1) as usize];
    let start_result = unsafe { RmStartSession(&mut session, 0, session_key.as_mut_ptr()) };
    if start_result == ERROR_ACCESS_DENIED {
        log::warn!("Restart Manager RmStartSession returned ACCESS_DENIED – skipping lock check");
        return Ok(Vec::new());
    }
    if start_result != ERROR_SUCCESS {
        return Err(format!("Restart Manager start failed: {}", start_result));
    }

    let result = (|| {
        let wide_paths: Vec<Vec<u16>> = paths
            .iter()
            .map(|path| wide_string(path.as_os_str()))
            .collect();
        let path_ptrs: Vec<*const u16> = wide_paths.iter().map(|path| path.as_ptr()).collect();

        let register_result = unsafe {
            RmRegisterResources(
                session,
                path_ptrs.len() as u32,
                path_ptrs.as_ptr(),
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
            )
        };
        if register_result == ERROR_ACCESS_DENIED {
            log::warn!("Restart Manager RmRegisterResources returned ACCESS_DENIED – skipping");
            return Ok(Vec::new());
        }
        if register_result != ERROR_SUCCESS {
            return Err(format!(
                "Restart Manager resource registration failed: {}",
                register_result
            ));
        }

        let mut needed = 0u32;
        let mut count = 0u32;
        let mut reboot_reasons = 0u32;
        let first_result = unsafe {
            RmGetList(
                session,
                &mut needed,
                &mut count,
                std::ptr::null_mut(),
                &mut reboot_reasons,
            )
        };
        if first_result == ERROR_SUCCESS && needed == 0 {
            return Ok(Vec::new());
        }
        if first_result == ERROR_ACCESS_DENIED {
            // Insufficient privileges to query locked processes (e.g. files held by
            // elevated or system processes).  Treat as "no known locks" so that
            // archiving is not blocked by the check itself.
            log::warn!(
                "Restart Manager RmGetList returned ACCESS_DENIED – skipping lock check for this batch"
            );
            return Ok(Vec::new());
        }
        if first_result != ERROR_MORE_DATA && first_result != ERROR_SUCCESS {
            return Err(format!(
                "Restart Manager process query failed: {}",
                first_result
            ));
        }

        // windows-sys does not derive Default for RM_PROCESS_INFO; use zeroed() instead.
        let mut processes: Vec<RM_PROCESS_INFO> = (0..needed as usize)
            .map(|_| unsafe { std::mem::zeroed() })
            .collect();
        count = needed;
        let second_result = unsafe {
            RmGetList(
                session,
                &mut needed,
                &mut count,
                processes.as_mut_ptr(),
                &mut reboot_reasons,
            )
        };
        if second_result == ERROR_ACCESS_DENIED {
            log::warn!("Restart Manager RmGetList (2nd call) returned ACCESS_DENIED – skipping");
            return Ok(Vec::new());
        }
        if second_result != ERROR_SUCCESS {
            return Err(format!(
                "Restart Manager process query failed: {}",
                second_result
            ));
        }

        processes.truncate(count as usize);
        Ok(processes
            .into_iter()
            .map(|process| {
                let app_name = fixed_wide_to_string(&process.strAppName);
                let service_name = fixed_wide_to_string(&process.strServiceShortName);
                LockedProcessInfo {
                    pid: process.Process.dwProcessId,
                    process_start_time: filetime_to_string(process.Process.ProcessStartTime),
                    name: if app_name.is_empty() {
                        service_name
                    } else {
                        app_name
                    },
                    application_type: rm_app_type_name(process.ApplicationType),
                    restartable: process.bRestartable != 0,
                }
            })
            .collect())
    })();

    unsafe {
        RmEndSession(session);
    }

    result
}

#[cfg(target_os = "windows")]
pub fn find_worktree_locking_processes(path: &Path) -> Result<Vec<LockedProcessInfo>, String> {
    let resources = collect_lock_check_resources(path);
    let mut by_pid: HashMap<u32, LockedProcessInfo> = HashMap::new();

    for batch in resources.chunks(LOCK_CHECK_BATCH_SIZE) {
        let processes = query_restart_manager(batch)?;
        for mut process in processes {
            if process.name.is_empty() {
                process.name = format!("PID {}", process.pid);
            }
            by_pid.entry(process.pid).or_insert(process);
        }
    }

    let current_pid = std::process::id();
    let mut result: Vec<LockedProcessInfo> = by_pid
        .into_values()
        .filter(|process| process.pid != current_pid)
        .collect();
    result.sort_by(|a, b| a.name.cmp(&b.name).then(a.pid.cmp(&b.pid)));
    Ok(result)
}

#[cfg(not(target_os = "windows"))]
pub fn find_worktree_locking_processes(_path: &Path) -> Result<Vec<LockedProcessInfo>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn probe_windows_rename(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Worktree path has no parent".to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid worktree path".to_string())?;
    let probe_path = parent.join(format!(
        ".{}.archive-lock-check-{}",
        name,
        std::process::id()
    ));

    match fs::remove_dir_all(&probe_path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(friendly_fs_error("无法清理归档检查的临时目录", &e));
        }
    }

    fs::rename(path, &probe_path).map_err(|e| {
        friendly_fs_error("Worktree 正在被占用，无法归档。请关闭相关程序后重试", &e)
    })?;
    if let Err(e) = fs::rename(&probe_path, path) {
        return Err(format!(
            "归档检查后恢复目录失败：{}。\n请手动将 '{}' 重命名为 '{}'",
            crate::utils::friendly_io_error(&e),
            probe_path.display(),
            path.display()
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_windows_archive_file_usage_clear(path: &Path) -> Result<(), String> {
    let locking_processes = find_worktree_locking_processes(path)?;
    if !locking_processes.is_empty() {
        let names = locking_processes
            .iter()
            .map(|process| format!("{} (PID {})", process.name, process.pid))
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "Worktree files are currently in use. End these processes before archiving: {}",
            names
        ));
    }

    probe_windows_rename(path)
}

#[cfg(not(target_os = "windows"))]
fn ensure_windows_archive_file_usage_clear(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub fn terminate_worktree_locking_process_impl(
    window_label: &str,
    name: String,
    pid: u32,
    process_start_time: String,
) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid worktree name".to_string());
    }

    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let worktree_path = PathBuf::from(&workspace_path)
        .join(&config.worktrees_dir)
        .join(&name);

    if !worktree_path.exists() {
        return Err("Worktree does not exist".to_string());
    }

    let locking_processes = find_worktree_locking_processes(&worktree_path)?;
    let is_current_blocker = locking_processes
        .iter()
        .any(|process| process.pid == pid && process.process_start_time == process_start_time);

    if !is_current_blocker {
        return Err("Process is no longer locking this worktree".to_string());
    }

    crate::commands::system::terminate_process_impl(pid)
}

#[tauri::command]
pub(crate) async fn terminate_worktree_locking_process(
    window: tauri::Window,
    name: String,
    pid: u32,
    process_start_time: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || {
        terminate_worktree_locking_process_impl(&label, name, pid, process_start_time)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

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
pub(crate) async fn list_worktrees(
    window: tauri::Window,
    include_archived: bool,
    workspace_path: Option<String>,
) -> Result<Vec<WorktreeListItem>, String> {
    if let Some(path) = workspace_path {
        let config = crate::config::load_workspace_config(&path);
        tokio::task::spawn_blocking(move || {
            let worktrees_path = std::path::PathBuf::from(&path).join(&config.worktrees_dir);
            if !worktrees_path.exists() {
                return Ok(vec![]);
            }
            scan_worktrees_dir(&worktrees_path, &config, include_archived)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    } else {
        let label = window.label().to_string();
        tokio::task::spawn_blocking(move || list_worktrees_impl(&label, include_archived))
            .await
            .map_err(|e| format!("Task join error: {}", e))?
    }
}

pub fn update_worktree_color_impl(
    window_label: &str,
    worktree_name: String,
    color: Option<crate::types::WorktreeColor>,
) -> Result<(), String> {
    let (_workspace_path, mut config) =
        crate::config::get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    match color {
        Some(c) => config.worktree_colors.insert(worktree_name, c),
        None => config.worktree_colors.remove(&worktree_name),
    };

    crate::commands::workspace::save_workspace_config_impl(window_label, config)
}

#[tauri::command]
pub(crate) async fn update_worktree_color(
    window: tauri::Window,
    worktree_name: String,
    color: Option<crate::types::WorktreeColor>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    if let Some(path) = workspace_path {
        let mut config = crate::config::load_workspace_config(&path);
        match color {
            Some(c) => config.worktree_colors.insert(worktree_name, c),
            None => config.worktree_colors.remove(&worktree_name),
        };
        crate::commands::workspace::save_workspace_config_by_path(path, config)
    } else {
        let label = window.label().to_string();
        tokio::task::spawn_blocking(move || {
            update_worktree_color_impl(&label, worktree_name, color)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }
}

/// Load worktree folder-name → display-name mapping from mapping.json
fn load_worktree_mapping(mapping_path: &std::path::Path) -> HashMap<String, String> {
    if let Ok(content) = std::fs::read_to_string(mapping_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

/// Save worktree folder-name → display-name mapping to mapping.json
fn save_worktree_mapping(mapping_path: &std::path::Path, mapping: &HashMap<String, String>) {
    if let Ok(json) = serde_json::to_string_pretty(mapping) {
        if let Err(e) = std::fs::write(mapping_path, json) {
            log::warn!("[worktree] Failed to save mapping.json: {}", e);
        }
    }
}

fn scan_worktrees_dir(
    dir: &PathBuf,
    config: &crate::types::WorkspaceConfig,
    include_archived: bool,
) -> Result<Vec<WorktreeListItem>, String> {
    let mut result = vec![];

    // Load display name mapping
    let mapping_path = dir.join("mapping.json");
    let mapping = load_worktree_mapping(&mapping_path);

    let entries = std::fs::read_dir(dir).map_err(|e| friendly_fs_error("无法读取目录", &e))?;

    for entry in entries {
        let entry = entry.map_err(|e| friendly_fs_error("无法读取目录项", &e))?;
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

        let is_archived = config.archived_worktrees.contains(&name);

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
                        commit_prefix_index: None,
                        git_user_name: None,
                        git_user_email: None,
                        tags: vec![],
                    });

                let info = get_worktree_info_for_branches(
                    &proj_path,
                    &proj_config.base_branch,
                    &proj_config.test_branch,
                );

                projects.push(ProjectStatus {
                    name: proj_name,
                    path: normalize_path(&proj_path.to_string_lossy()),
                    current_branch: info.current_branch,
                    base_branch: proj_config.base_branch,
                    test_branch: proj_config.test_branch,
                    has_uncommitted: info.uncommitted_count > 0,
                    uncommitted_count: info.uncommitted_count,
                    is_merged_to_test: info.is_merged_to_test,
                    is_merged_to_base: info.is_merged_to_base,
                    ahead_of_base: info.ahead_of_base,
                    behind_base: info.behind_base,
                    ahead_of_test: info.ahead_of_test,
                    unpushed_commits: info.unpushed_commits,
                    remote_url: info.remote_url,
                });
            }
        }

        // Look up display name from mapping
        let lookup_key = &name;
        let display_name = mapping.get(lookup_key).cloned();

        result.push(WorktreeListItem {
            name: name.clone(),
            display_name,
            path: normalize_path(&path.to_string_lossy()),
            is_archived,
            color: config.worktree_colors.get(&name).cloned(),
            projects,
        });
    }

    Ok(result)
}

fn get_main_workspace_status_by_path(
    workspace_path: &str,
    config: &crate::types::WorkspaceConfig,
) -> Result<MainWorkspaceStatus, String> {
    let start = std::time::Instant::now();
    let root_path = PathBuf::from(workspace_path);
    let projects_path = root_path.join("projects");

    let mut projects = vec![];

    for proj_config in &config.projects {
        let proj_path = projects_path.join(&proj_config.name);
        if !proj_path.exists() {
            continue;
        }

        let info = get_worktree_info_for_branches(
            &proj_path,
            &proj_config.base_branch,
            &proj_config.test_branch,
        );

        projects.push(MainProjectStatus {
            name: proj_config.name.clone(),
            path: normalize_path(&proj_path.to_string_lossy()),
            current_branch: info.current_branch,
            has_uncommitted: info.uncommitted_count > 0,
            uncommitted_count: info.uncommitted_count,
            is_merged_to_test: info.is_merged_to_test,
            is_merged_to_base: info.is_merged_to_base,
            ahead_of_base: info.ahead_of_base,
            behind_base: info.behind_base,
            ahead_of_test: info.ahead_of_test,
            unpushed_commits: info.unpushed_commits,
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

pub fn get_main_workspace_status_impl(window_label: &str) -> Result<MainWorkspaceStatus, String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;
    get_main_workspace_status_by_path(&workspace_path, &config)
}

#[tauri::command]
pub(crate) async fn get_main_workspace_status(
    window: tauri::Window,
    workspace_path: Option<String>,
) -> Result<MainWorkspaceStatus, String> {
    if let Some(path) = workspace_path {
        tokio::task::spawn_blocking(move || {
            let config = crate::config::load_workspace_config(&path);
            get_main_workspace_status_by_path(&path, &config)
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    } else {
        let label = window.label().to_string();
        tokio::task::spawn_blocking(move || get_main_workspace_status_impl(&label))
            .await
            .map_err(|e| format!("Task join error: {}", e))?
    }
}

/// Set up a single project inside a worktree: fetch → branch check → worktree add → symlink.
fn setup_project_worktree(
    root: &std::path::Path,
    worktree_path: &std::path::Path,
    worktree_name: &str,
    proj_req: &CreateProjectRequest,
    proj_config: &ProjectConfig,
) -> Result<(), String> {
    validate_git_ref_name(worktree_name)?;
    validate_git_ref_name(&proj_req.base_branch)?;

    let main_proj_path = root.join("projects").join(&proj_req.name);
    let wt_proj_path = worktree_path.join("projects").join(&proj_req.name);

    // Fetch origin first (with timeout)
    log::info!("[worktree] Project '{}': git fetch origin", proj_req.name);
    run_git_command_with_timeout(
        &["fetch", "origin"],
        main_proj_path.to_string_lossy().as_ref(),
    )?;

    // Check if branch already exists
    let branch_check = git_command()
        .args([
            "-C",
            main_proj_path.to_string_lossy().as_ref(),
            "branch",
            "--list",
            worktree_name,
        ])
        .output();

    let branch_exists = branch_check
        .as_ref()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    // Check if the same-named remote branch already exists (after fetch, so tracking refs are current).
    let remote_branch_exists = if !branch_exists {
        crate::git_ops::check_remote_branch_exists(&main_proj_path, worktree_name).unwrap_or(false)
    } else {
        false
    };

    // Create worktree: use existing local branch, track existing remote branch, or create from base.
    let output = if branch_exists {
        log::info!(
            "Branch '{}' already exists locally, using it for project {}",
            worktree_name,
            proj_req.name
        );
        git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
                "worktree",
                "add",
                wt_proj_path.to_string_lossy().as_ref(),
                worktree_name,
            ])
            .output()
            .map_err(|e| friendly_fs_error("创建 Worktree 失败", &e))?
    } else if remote_branch_exists {
        log::info!(
            "Remote branch 'origin/{}' already exists, tracking it for project {}",
            worktree_name,
            proj_req.name
        );
        git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
                "worktree",
                "add",
                "--track",
                "-b",
                worktree_name,
                wt_proj_path.to_string_lossy().as_ref(),
                &format!("origin/{}", worktree_name),
            ])
            .output()
            .map_err(|e| friendly_fs_error("创建 Worktree 失败", &e))?
    } else {
        log::info!(
            "Creating new branch '{}' for project {} from origin/{}",
            worktree_name,
            proj_req.name,
            proj_req.base_branch
        );
        git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
                "worktree",
                "add",
                wt_proj_path.to_string_lossy().as_ref(),
                "-b",
                worktree_name,
                &format!("origin/{}", proj_req.base_branch),
            ])
            .output()
            .map_err(|e| friendly_fs_error("创建 Worktree 失败", &e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_for_log = mask_url_credentials(&stderr);
        log::error!(
            "[worktree] FAILED: git worktree add for project '{}': {}",
            proj_req.name,
            stderr_for_log
        );
        return Err(format!(
            "Failed to create worktree for {}: {}",
            proj_req.name, stderr
        ));
    }
    log::info!(
        "[worktree] Project '{}': git worktree add succeeded",
        proj_req.name
    );

    // When tracking an existing remote branch, --track already set the upstream.
    // Only push (to create or update the remote branch) for new or locally-existing branches.
    if !remote_branch_exists {
        log::info!(
            "[worktree] Project '{}': git push -u origin {}",
            proj_req.name,
            worktree_name
        );
        let push_output = run_git_command_with_timeout(
            &["push", "-u", "origin", worktree_name],
            wt_proj_path.to_string_lossy().as_ref(),
        );

        match push_output {
            Ok(output) if output.status.success() => {
                log::info!(
                    "[worktree] Project '{}': git push -u origin {} succeeded",
                    proj_req.name,
                    worktree_name
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stderr_for_log = mask_url_credentials(&stderr);
                log::warn!(
                    "[worktree] Project '{}': git push -u origin {} failed (worktree created successfully): {}",
                    proj_req.name,
                    worktree_name,
                    stderr_for_log
                );
            }
            Err(e) => {
                log::warn!(
                    "[worktree] Project '{}': git push -u origin {} failed to execute (worktree created successfully): {}",
                    proj_req.name,
                    worktree_name,
                    e
                );
            }
        }
    } else {
        log::info!(
            "[worktree] Project '{}': tracking origin/{}, skipping push",
            proj_req.name,
            worktree_name
        );
    }

    // Link configured folders
    log::info!(
        "[worktree] Project '{}': Creating symlinks for {} linked folders",
        proj_req.name,
        proj_config.linked_folders.len()
    );
    for folder_name in &proj_config.linked_folders {
        let main_folder = main_proj_path.join(folder_name);
        let wt_folder = wt_proj_path.join(folder_name);

        if main_folder.exists() && !wt_folder.exists() {
            create_symlink(&main_folder, &wt_folder).ok();

            // Remove from git index if it's tracked
            git_command()
                .args([
                    "-C",
                    wt_proj_path.to_string_lossy().as_ref(),
                    "rm",
                    "--cached",
                    "-r",
                    folder_name,
                ])
                .output()
                .ok();
        }
    }

    Ok(())
}

pub fn create_worktree_impl(
    window_label: &str,
    request: CreateWorktreeRequest,
) -> Result<String, String> {
    validate_git_ref_name(&request.name)?;
    // 目录名同样必须校验：folder_name 会拼进磁盘路径，未校验则 `../` 可逃逸出 worktrees 目录。
    if let Some(folder) = &request.folder_name {
        validate_git_ref_name(folder)?;
    }
    for project in &request.projects {
        validate_git_ref_name(&project.base_branch)?;
    }

    let workspace_path =
        crate::config::get_window_workspace_path(window_label).ok_or("No workspace selected")?;

    // 串行化同一 workspace 的生命周期操作，防止并发同名创建留下半注册目录等竞态。
    let lifecycle_lock = crate::state::workspace_lifecycle_lock(&workspace_path);
    let _lifecycle_guard = lifecycle_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // 锁内读取最新配置。
    let config = crate::config::load_workspace_config(&workspace_path);

    let root = PathBuf::from(&workspace_path);

    // Use folder_name for the directory if provided, otherwise use name
    let actual_folder_name = request.folder_name.as_deref().unwrap_or(&request.name);
    let worktree_path = root.join(&config.worktrees_dir).join(actual_folder_name);

    let project_count = request.projects.len();
    log::info!(
        "[worktree] Creating worktree '{}' (folder: '{}') in workspace '{}' with {} projects (parallel)",
        request.name,
        actual_folder_name,
        workspace_path,
        project_count
    );

    // Step 1: Create worktree directory
    log::info!(
        "[worktree] Step 1: Creating directory structure at {}",
        worktree_path.display()
    );
    std::fs::create_dir_all(worktree_path.join("projects"))
        .map_err(|e| friendly_fs_error("无法创建 Worktree 目录", &e))?;

    // Step 2: Create symlinks for workspace-level items (fast, sequential)
    // Merge linked_workspace_items + vault_linked_workspace_items, deduplicated
    let mut all_linked: Vec<String> = config.linked_workspace_items.clone();
    for item in &config.vault_linked_workspace_items {
        if !all_linked.contains(item) {
            all_linked.push(item.clone());
        }
    }
    log::info!(
        "[worktree] Step 2: Creating workspace-level symlinks ({} items)",
        all_linked.len()
    );
    for name in &all_linked {
        let src = root.join(name);
        let dst = worktree_path.join(name);
        if src.exists() && !dst.exists() {
            #[allow(unused_variables)]
            let link_result = create_symlink(&src, &dst);
            log::debug!(
                "[worktree] Linked workspace item: {} (result: {:?})",
                name,
                link_result
            );
        }
    }

    // Step 3: Set up each project in parallel
    log::info!(
        "[worktree] Step 3: Setting up {} projects in parallel",
        project_count
    );

    // Pre-resolve project configs
    let proj_configs: Vec<_> = request
        .projects
        .iter()
        .map(|proj_req| {
            config
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
                    commit_prefix_index: None,
                    git_user_name: None,
                    git_user_email: None,
                    tags: vec![],
                })
        })
        .collect();

    // Use scoped threads for parallel execution
    let errors: Vec<String> = std::thread::scope(|s| {
        let handles: Vec<_> = request
            .projects
            .iter()
            .zip(proj_configs.iter())
            .map(|(proj_req, proj_config)| {
                s.spawn(|| {
                    setup_project_worktree(
                        &root,
                        &worktree_path,
                        &request.name,
                        proj_req,
                        proj_config,
                    )
                })
            })
            .collect();

        handles
            .into_iter()
            .filter_map(|h| h.join().ok().and_then(|r| r.err()))
            .collect()
    });

    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }

    // Save display name mapping if folder_name differs from name
    if request.folder_name.is_some() {
        let mapping_path = root.join(&config.worktrees_dir).join("mapping.json");
        let mut mapping = load_worktree_mapping(&mapping_path);
        mapping.insert(actual_folder_name.to_string(), request.name.clone());
        save_worktree_mapping(&mapping_path, &mapping);
        log::info!(
            "[worktree] Saved folder alias mapping: '{}' → '{}'",
            actual_folder_name,
            request.name
        );
    }

    log::info!(
        "[worktree] Successfully created worktree '{}' (folder: '{}') with {} projects",
        request.name,
        actual_folder_name,
        project_count
    );
    Ok(normalize_path(&worktree_path.to_string_lossy()))
}

/// Worktree creation timeout: 10 minutes (for large repos with slow fetch)
const CREATE_WORKTREE_TIMEOUT_SECS: u64 = 600;

#[tauri::command]
pub(crate) async fn create_worktree(
    window: tauri::Window,
    request: CreateWorktreeRequest,
) -> Result<String, String> {
    let label = window.label().to_string();
    match tokio::time::timeout(
        std::time::Duration::from_secs(CREATE_WORKTREE_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || create_worktree_impl(&label, request)),
    )
    .await
    {
        Ok(join_result) => join_result.map_err(|e| format!("Task join error: {}", e))?,
        Err(_) => Err(format!(
            "Worktree creation timed out after {} minutes",
            CREATE_WORKTREE_TIMEOUT_SECS / 60
        )),
    }
}

pub fn archive_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let workspace_path =
        crate::config::get_window_workspace_path(window_label).ok_or("No workspace selected")?;

    // 串行化同一 workspace 的生命周期操作，防止并发竞态破坏配置/git 状态。
    let lifecycle_lock = crate::state::workspace_lifecycle_lock(&workspace_path);
    let _lifecycle_guard = lifecycle_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // 锁内读取最新配置，防止并发生命周期操作之间丢更新。
    let config = crate::config::load_workspace_config(&workspace_path);

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&name);

    if !worktree_path.exists() {
        return Err("Worktree does not exist".to_string());
    }

    log::info!(
        "[worktree] Archiving worktree '{}' in workspace '{}'",
        name,
        workspace_path
    );

    // Step 1: Close all PTY sessions associated with this worktree
    log::info!(
        "[worktree] Step 1/4: Closing PTY sessions for worktree '{}'",
        name
    );
    {
        let worktree_path_str = worktree_path.to_string_lossy().to_string();
        if let Ok(mut manager) = PTY_MANAGER.lock() {
            let closed =
                manager.close_sessions_by_path_prefix(&worktree_path_str, "archive_worktree");
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

    // Step 2: On Windows, fail before mutating git worktree registrations if files are in use.
    log::info!("[worktree] Step 2/4: Checking file usage for '{}'", name);
    ensure_windows_archive_file_usage_clear(&worktree_path)?;

    // Step 3: Remove git worktrees first
    log::info!(
        "[worktree] Step 3/4: Removing git worktree registrations for '{}'",
        name
    );
    let projects_path = worktree_path.join("projects");
    if projects_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_path) {
            for entry in entries.flatten() {
                let proj_path = entry.path();
                let proj_name = proj_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                let main_proj_path = root.join("projects").join(proj_name);

                log::info!(
                    "[worktree] Removing git worktree for project '{}'",
                    proj_name
                );
                let output = git_command()
                    .args([
                        "-C",
                        main_proj_path.to_string_lossy().as_ref(),
                        "worktree",
                        "remove",
                        proj_path.to_string_lossy().as_ref(),
                        "--force",
                    ])
                    .output();

                match &output {
                    Ok(o) if o.status.success() => {
                        log::info!(
                            "[worktree] Successfully removed git worktree for '{}'",
                            proj_name
                        );
                    }
                    Ok(o) => {
                        let stderr_for_log =
                            mask_url_credentials(&String::from_utf8_lossy(&o.stderr));
                        log::warn!(
                            "[worktree] git worktree remove for '{}' returned non-zero: {}",
                            proj_name,
                            stderr_for_log
                        );
                    }
                    Err(e) => {
                        log::warn!(
                            "[worktree] Failed to execute git worktree remove for '{}': {}",
                            proj_name,
                            e
                        );
                    }
                }
            }
        }
    }

    // Step 4: Mark as archived in config (no folder rename)
    log::info!("[worktree] Step 4/4: Marking worktree as archived in config");
    let mut config = config;
    if !config.archived_worktrees.contains(&name) {
        config.archived_worktrees.push(name.clone());
    }
    save_workspace_config_internal(&workspace_path, &config)?;
    log::info!(
        "[worktree] Marked worktree '{}' as archived in config",
        name
    );

    log::info!("[worktree] Successfully archived worktree '{}'", name);
    Ok(())
}

#[tauri::command]
pub(crate) async fn archive_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || archive_worktree_impl(&label, name))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
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
        locked_processes: vec![],
        lock_check_supported: cfg!(target_os = "windows"),
        lock_check_error: None,
    };

    #[cfg(target_os = "windows")]
    {
        match find_worktree_locking_processes(&worktree_path) {
            Ok(processes) => {
                if !processes.is_empty() {
                    status.can_archive = false;
                    status.errors.push(format!(
                        "Worktree files are currently in use by {} process(es)",
                        processes.len()
                    ));
                    status.locked_processes = processes;
                }
            }
            Err(e) => {
                status.can_archive = false;
                status
                    .errors
                    .push(format!("File usage check failed: {}", e));
                status.lock_check_error = Some(e);
            }
        }
    }

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

            let base_branch = config
                .projects
                .iter()
                .find(|p| p.name == proj_name)
                .map(|p| p.base_branch.as_str())
                .unwrap_or("uat");

            let branch_status = get_branch_status(&proj_path, &proj_name, base_branch);

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
pub(crate) async fn check_worktree_status(
    window: tauri::Window,
    name: String,
) -> Result<WorktreeArchiveStatus, String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || check_worktree_status_impl(&label, name))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

pub fn restore_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    validate_git_ref_name(&name)?;

    let workspace_path =
        crate::config::get_window_workspace_path(window_label).ok_or("No workspace selected")?;

    // 串行化同一 workspace 的生命周期操作，防止 restore vs delete TOCTOU 竞态。
    let lifecycle_lock = crate::state::workspace_lifecycle_lock(&workspace_path);
    let _lifecycle_guard = lifecycle_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // 锁内读取最新配置，防止并发丢更新。
    let config = crate::config::load_workspace_config(&workspace_path);

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&name);

    if !worktree_path.exists() {
        return Err("Archived worktree does not exist".to_string());
    }

    log::info!(
        "[worktree] Restoring worktree '{}' from archive in workspace '{}'",
        name,
        workspace_path
    );

    // Step 1: Re-register git worktrees for each project
    log::info!(
        "[worktree] Step 1/2: Re-registering git worktrees for '{}'",
        name
    );
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
                let branch_name = &name;
                let branch_check = git_command()
                    .args([
                        "-C",
                        main_proj_path.to_string_lossy().as_ref(),
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
                git_command()
                    .args([
                        "-C",
                        main_proj_path.to_string_lossy().as_ref(),
                        "worktree",
                        "prune",
                    ])
                    .output()
                    .ok();

                // Re-add worktree
                let output = if branch_exists {
                    log::info!(
                        "Re-adding worktree for {} with existing branch {}",
                        proj_name,
                        branch_name
                    );
                    git_command()
                        .args([
                            "-C",
                            main_proj_path.to_string_lossy().as_ref(),
                            "worktree",
                            "add",
                            wt_proj_path.to_string_lossy().as_ref(),
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
                    if let Err(e) = validate_git_ref_name(&base_branch) {
                        log::error!(
                            "[worktree] Invalid base branch '{}' for project '{}': {}",
                            base_branch,
                            proj_name,
                            e
                        );
                        continue;
                    }

                    log::info!(
                        "Re-adding worktree for {} with new branch {} from origin/{}",
                        proj_name,
                        branch_name,
                        base_branch
                    );
                    git_command()
                        .args([
                            "-C",
                            main_proj_path.to_string_lossy().as_ref(),
                            "worktree",
                            "add",
                            wt_proj_path.to_string_lossy().as_ref(),
                            "-b",
                            branch_name,
                            &format!("origin/{}", base_branch),
                        ])
                        .output()
                };

                match output {
                    Ok(o) if o.status.success() => {
                        log::info!("Successfully re-added worktree for {}", proj_name);
                        // Set upstream for the branch so git push works without -u flag
                        let push_output = run_git_command_with_timeout(
                            &["push", "-u", "origin", branch_name],
                            wt_proj_path.to_string_lossy().as_ref(),
                        );
                        match push_output {
                            Ok(p) if p.status.success() => {
                                log::info!(
                                    "[worktree] Project '{}': git push -u origin {} succeeded",
                                    proj_name,
                                    branch_name
                                );
                            }
                            Ok(p) => {
                                let stderr = String::from_utf8_lossy(&p.stderr);
                                let stderr_for_log = mask_url_credentials(&stderr);
                                log::warn!(
                                    "[worktree] Project '{}': git push -u origin {} failed (worktree restored successfully): {}",
                                    proj_name,
                                    branch_name,
                                    stderr_for_log
                                );
                            }
                            Err(e) => {
                                log::warn!(
                                    "[worktree] Project '{}': git push -u origin {} failed to execute (worktree restored successfully): {}",
                                    proj_name,
                                    branch_name,
                                    e
                                );
                            }
                        }
                    }
                    Ok(o) => {
                        let stderr = String::from_utf8_lossy(&o.stderr);
                        let stderr_for_log = mask_url_credentials(&stderr);
                        log::error!(
                            "Failed to re-add worktree for {}: {}",
                            proj_name,
                            stderr_for_log
                        );
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

    // Step 2: Restore workspace-level symlinks
    // Merge linked_workspace_items + vault_linked_workspace_items, deduplicated
    let mut all_linked: Vec<String> = config.linked_workspace_items.clone();
    for item in &config.vault_linked_workspace_items {
        if !all_linked.contains(item) {
            all_linked.push(item.clone());
        }
    }
    log::info!(
        "[worktree] Step 2/2: Restoring workspace-level symlinks ({} items)",
        all_linked.len()
    );
    for item_name in &all_linked {
        let src = root.join(item_name);
        let dst = worktree_path.join(item_name);
        if src.exists() && !dst.exists() {
            create_symlink(&src, &dst).ok();
        }
    }

    // Step 3: Remove from archived list in config
    let mut config = config;
    config.archived_worktrees.retain(|n| n != &name);
    save_workspace_config_internal(&workspace_path, &config)?;
    log::info!(
        "[worktree] Removed worktree '{}' from archived list in config",
        name
    );

    log::info!("Successfully restored worktree '{}'", name);
    Ok(())
}

#[tauri::command]
pub(crate) async fn restore_worktree(window: tauri::Window, name: String) -> Result<(), String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || restore_worktree_impl(&label, name))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

pub fn delete_archived_worktree_impl(window_label: &str, name: String) -> Result<(), String> {
    let workspace_path =
        crate::config::get_window_workspace_path(window_label).ok_or("No workspace selected")?;

    // 串行化同一 workspace 的生命周期操作，防止 delete vs restore TOCTOU、double-delete 竞态。
    let lifecycle_lock = crate::state::workspace_lifecycle_lock(&workspace_path);
    let _lifecycle_guard = lifecycle_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // 锁内读取最新配置，防止并发丢更新。
    let config = crate::config::load_workspace_config(&workspace_path);

    let root = PathBuf::from(&workspace_path);
    let worktree_path = root.join(&config.worktrees_dir).join(&name);

    // Validate it's an archived worktree
    if !config.archived_worktrees.contains(&name) {
        return Err("Can only delete archived worktrees".to_string());
    }

    if !worktree_path.exists() {
        return Err("Archived worktree does not exist".to_string());
    }

    let folder_key = &name;
    // Check mapping for the actual branch name (may differ from folder name if aliased)
    let mapping_path = root.join(&config.worktrees_dir).join("mapping.json");
    let mapping = load_worktree_mapping(&mapping_path);
    let branch_name = mapping
        .get(folder_key)
        .map(|s| s.as_str())
        .unwrap_or(folder_key);
    validate_git_ref_name(branch_name)?;
    log::info!(
        "[worktree] Deleting archived worktree '{}' (branch: {}) in workspace '{}'",
        name,
        branch_name,
        workspace_path
    );

    // Step 1: Close any related PTY sessions
    log::info!(
        "[worktree] Step 1/3: Closing PTY sessions for archived worktree '{}'",
        name
    );
    {
        let worktree_path_str = worktree_path.to_string_lossy().to_string();
        if let Ok(mut manager) = PTY_MANAGER.lock() {
            let closed = manager
                .close_sessions_by_path_prefix(&worktree_path_str, "delete_archived_worktree");
            if !closed.is_empty() {
                log::info!(
                    "[worktree] Closed {} PTY sessions for deleted worktree",
                    closed.len()
                );
            } else {
                log::info!("[worktree] No PTY sessions to close");
            }
        }
    }

    // Step 2: 先删除目录（原子性关键）。worktree 工作树可从分支重建，是可逆性更高的一步；
    // 若 remove_dir_all 失败则直接返回——此时分支尚未删除、配置未改，worktree 仍标记 archived
    // 可恢复，彻底避免“分支已删（丢 commits）但目录删除失败”的数据丢失。
    log::info!(
        "[worktree] Step 2/3: Removing directory {}",
        worktree_path.display()
    );
    fs::remove_dir_all(&worktree_path)
        .map_err(|e| friendly_fs_error("删除归档 Worktree 失败", &e))?;

    // Step 3: 仅在目录删除确认成功后才删除分支（不可逆操作放最后）。
    // 个别项目分支删除失败不影响整体一致性（worktree 目录已不存在，后续会清理 archived 标记）。
    log::info!(
        "[worktree] Step 3/3: Deleting local branch '{}' from projects",
        branch_name
    );
    let projects_path = root.join("projects");
    if projects_path.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_path) {
            for entry in entries.flatten() {
                let proj_path = entry.path();
                if !proj_path.is_dir() {
                    continue;
                }

                // Try to delete the branch (it may not exist in all projects)
                let output = git_command()
                    .args([
                        "-C",
                        proj_path.to_string_lossy().as_ref(),
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

    // Clean up mapping entry if exists
    if mapping.contains_key(folder_key) {
        let mut mapping = mapping;
        mapping.remove(folder_key);
        save_worktree_mapping(&mapping_path, &mapping);
        log::info!("[worktree] Removed mapping entry for '{}'", folder_key);
    }

    // Step 4: Remove from archived list in config
    let mut config = config;
    config.archived_worktrees.retain(|n| n != &name);
    save_workspace_config_internal(&workspace_path, &config)?;
    log::info!(
        "[worktree] Removed worktree '{}' from archived list in config",
        name
    );

    log::info!(
        "[worktree] Successfully deleted archived worktree '{}'",
        name
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn delete_archived_worktree(
    window: tauri::Window,
    name: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || delete_archived_worktree_impl(&label, name))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

// ==================== 向已有 Worktree 添加项目 ====================

pub fn add_project_to_worktree_impl(
    window_label: &str,
    request: AddProjectToWorktreeRequest,
) -> Result<(), String> {
    validate_git_ref_name(&request.base_branch)?;

    let workspace_path =
        crate::config::get_window_workspace_path(window_label).ok_or("No workspace selected")?;

    // 串行化同一 workspace 的生命周期操作，避免与 archive/delete 同一 worktree 交叉竞态。
    let lifecycle_lock = crate::state::workspace_lifecycle_lock(&workspace_path);
    let _lifecycle_guard = lifecycle_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // 锁内读取最新配置，防止并发丢更新。
    let config = crate::config::load_workspace_config(&workspace_path);

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
            .map_err(|e| friendly_fs_error("无法创建 projects 目录", &e))?;
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
            commit_prefix_index: None,
            git_user_name: None,
            git_user_email: None,
            tags: vec![],
        });

    // Resolve display name from mapping (used as branch name)
    let mapping_path = root.join(&config.worktrees_dir).join("mapping.json");
    let mapping = load_worktree_mapping(&mapping_path);
    let branch_name = mapping
        .get(&request.worktree_name)
        .cloned()
        .unwrap_or_else(|| request.worktree_name.clone());
    validate_git_ref_name(&branch_name)?;

    log::info!(
        "[worktree] Adding project '{}' to worktree '{}' (branch: '{}', base_branch: {})",
        request.project_name,
        request.worktree_name,
        branch_name,
        request.base_branch
    );

    // Step 1: Fetch origin first
    log::info!(
        "[worktree] Step 1/3: git fetch origin for project '{}'",
        request.project_name
    );
    run_git_command_with_timeout(
        &["fetch", "origin"],
        main_proj_path.to_string_lossy().as_ref(),
    )?;

    // Check if branch already exists
    let branch_check = git_command()
        .args([
            "-C",
            main_proj_path.to_string_lossy().as_ref(),
            "branch",
            "--list",
            &branch_name,
        ])
        .output();

    let branch_exists = branch_check
        .as_ref()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    let remote_branch_exists = if !branch_exists {
        crate::git_ops::check_remote_branch_exists(&main_proj_path, &branch_name).unwrap_or(false)
    } else {
        false
    };

    // Step 2: Create worktree - use existing local branch, track remote, or create from base.
    log::info!(
        "[worktree] Step 2/3: git worktree add for project '{}'",
        request.project_name
    );
    let output = if branch_exists {
        log::info!(
            "[worktree] Branch '{}' already exists locally, using it for project '{}'",
            branch_name,
            request.project_name
        );
        git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
                "worktree",
                "add",
                wt_proj_path.to_string_lossy().as_ref(),
                &branch_name,
            ])
            .output()
            .map_err(|e| friendly_fs_error("创建 Worktree 失败", &e))?
    } else if remote_branch_exists {
        log::info!(
            "[worktree] Remote branch 'origin/{}' already exists, tracking it for project '{}'",
            branch_name,
            request.project_name
        );
        git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
                "worktree",
                "add",
                "--track",
                "-b",
                &branch_name,
                wt_proj_path.to_string_lossy().as_ref(),
                &format!("origin/{}", branch_name),
            ])
            .output()
            .map_err(|e| friendly_fs_error("创建 Worktree 失败", &e))?
    } else {
        log::info!(
            "[worktree] Creating new branch '{}' for project '{}' from origin/{}",
            branch_name,
            request.project_name,
            request.base_branch
        );
        git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
                "worktree",
                "add",
                wt_proj_path.to_string_lossy().as_ref(),
                "-b",
                &branch_name,
                &format!("origin/{}", request.base_branch),
            ])
            .output()
            .map_err(|e| friendly_fs_error("创建 Worktree 失败", &e))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_for_log = mask_url_credentials(&stderr);
        log::error!(
            "[worktree] FAILED: git worktree add for project '{}': {}",
            request.project_name,
            stderr_for_log
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

    // When tracking an existing remote branch, --track already set the upstream.
    // Only push (to create the remote branch) for new or locally-existing branches.
    if !remote_branch_exists {
        // Push to create remote branch and set upstream tracking.
        // Even though there are no user commits yet, this is necessary to prevent
        // IDEs from defaulting to push to the base branch (uat/main).
        let push_output = run_git_command_with_timeout(
            &["push", "-u", "origin", &branch_name],
            wt_proj_path.to_string_lossy().as_ref(),
        );
        match push_output {
            Ok(p) if p.status.success() => {
                log::info!(
                    "[worktree] Project '{}': git push -u origin {} succeeded",
                    request.project_name,
                    branch_name
                );
            }
            Ok(p) => {
                let stderr = String::from_utf8_lossy(&p.stderr);
                let stderr_for_log = mask_url_credentials(&stderr);
                log::warn!(
                    "[worktree] Project '{}': git push -u origin {} failed (project added successfully): {}",
                    request.project_name,
                    branch_name,
                    stderr_for_log
                );
            }
            Err(e) => {
                log::warn!(
                    "[worktree] Project '{}': git push -u origin {} failed to execute: {}",
                    request.project_name,
                    branch_name,
                    e
                );
            }
        }
    } else {
        log::info!(
            "[worktree] Project '{}': tracking origin/{}, skipping push",
            request.project_name,
            branch_name
        );
    }

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
            git_command()
                .args([
                    "-C",
                    wt_proj_path.to_string_lossy().as_ref(),
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
pub(crate) async fn add_project_to_worktree(
    window: tauri::Window,
    request: AddProjectToWorktreeRequest,
) -> Result<(), String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || add_project_to_worktree_impl(&label, request))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
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
    let workspace_path =
        crate::config::get_window_workspace_path(window_label).ok_or("No workspace selected")?;

    // 串行化同一 workspace 的生命周期操作。
    let lifecycle_lock = crate::state::workspace_lifecycle_lock(&workspace_path);
    let _lifecycle_guard = lifecycle_lock
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // 锁内读取最新配置，防止并发丢更新。
    let config = crate::config::load_workspace_config(&workspace_path);

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

    for proj_name in wt_branches.keys() {
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
        worktree_branches: wt_branches.clone(),
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
        let detach_output = git_command()
            .args([
                "-C",
                wt_proj_path.to_string_lossy().as_ref(),
                "checkout",
                "--detach",
            ])
            .output();

        match &detach_output {
            Ok(o) if o.status.success() => {
                log::info!("[deploy] Detached HEAD in worktree project '{}'", proj_name);
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                let stderr_for_log = mask_url_credentials(&stderr);
                log::error!(
                    "[deploy] Failed to detach HEAD in '{}': {}",
                    proj_name,
                    stderr_for_log
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
        let switch_output = git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
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
                let stderr_for_log = mask_url_credentials(&stderr);
                log::error!(
                    "[deploy] Failed to switch main '{}' to '{}': {}",
                    proj_name,
                    wt_branch,
                    stderr_for_log
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

        // Clean up PTY sessions for switched main workspace projects
        if let Ok(mut manager) = PTY_MANAGER.lock() {
            for proj_name in &switched_projects {
                let proj_path = main_projects_path.join(proj_name);
                if let Some(path_str) = proj_path.to_str() {
                    let closed = manager.close_sessions_by_path_prefix(
                        path_str,
                        "deploy_to_main: project switched to different branch",
                    );
                    if !closed.is_empty() {
                        log::info!(
                            "[deploy] Closed {} PTY sessions for project '{}'",
                            closed.len(),
                            proj_name
                        );
                    }
                }
            }
        }
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
pub(crate) async fn deploy_to_main(
    window: tauri::Window,
    worktree_name: String,
) -> Result<DeployToMainResult, String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || deploy_to_main_impl(&label, worktree_name))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

pub fn exit_main_occupation_impl(window_label: &str, force: bool) -> Result<(), String> {
    let (workspace_path, config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let occupation =
        load_occupation_state(&workspace_path).ok_or("Main workspace is not currently occupied")?;

    let root = PathBuf::from(&workspace_path);
    let main_projects_path = root.join("projects");
    let worktree_path = root
        .join(&config.worktrees_dir)
        .join(&occupation.worktree_name);
    let wt_projects_path = worktree_path.join("projects");

    // If not force, check for uncommitted changes in main workspace
    if !force {
        for proj_name in occupation.original_branches.keys() {
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
            git_command()
                .args([
                    "-C",
                    main_proj_path.to_string_lossy().as_ref(),
                    "reset",
                    "HEAD",
                ])
                .output()
                .ok();
            git_command()
                .args([
                    "-C",
                    main_proj_path.to_string_lossy().as_ref(),
                    "checkout",
                    "--",
                    ".",
                ])
                .output()
                .ok();
            git_command()
                .args([
                    "-C",
                    main_proj_path.to_string_lossy().as_ref(),
                    "clean",
                    "-fd",
                ])
                .output()
                .ok();
        }

        let output = git_command()
            .args([
                "-C",
                main_proj_path.to_string_lossy().as_ref(),
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
    for proj_name in occupation.original_branches.keys() {
        let wt_proj_path = wt_projects_path.join(proj_name);
        if !wt_proj_path.exists() {
            continue;
        }

        // Use the saved worktree branch, fall back to worktree name (old state files)
        let branch = occupation
            .worktree_branches
            .get(proj_name)
            .unwrap_or(&occupation.worktree_name);
        log::info!(
            "[deploy] Re-attaching worktree project '{}' to branch '{}'",
            proj_name,
            branch
        );

        let output = git_command()
            .args([
                "-C",
                wt_proj_path.to_string_lossy().as_ref(),
                "checkout",
                branch,
            ])
            .output();

        match output {
            Ok(o) if o.status.success() => {
                log::info!("[deploy] Re-attached worktree project '{}'", proj_name);
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                let stderr_for_log = mask_url_credentials(&stderr);
                log::warn!(
                    "[deploy] Failed to re-attach worktree '{}': {}",
                    proj_name,
                    stderr_for_log
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

    // Clean up PTY sessions for main workspace projects
    if let Ok(mut manager) = PTY_MANAGER.lock() {
        for proj_name in occupation.original_branches.keys() {
            let proj_path = main_projects_path.join(proj_name);
            if let Some(path_str) = proj_path.to_str() {
                let closed = manager.close_sessions_by_path_prefix(
                    path_str,
                    "exit_occupation: project switched back to original branch",
                );
                if !closed.is_empty() {
                    log::info!(
                        "[deploy] Closed {} PTY sessions for project '{}'",
                        closed.len(),
                        proj_name
                    );
                }
            }
        }
    }

    log::info!(
        "[deploy] Exited occupation from worktree '{}'",
        occupation.worktree_name
    );

    broadcast_lock_state(&workspace_path);

    Ok(())
}

#[tauri::command]
pub(crate) async fn exit_main_occupation(window: tauri::Window, force: bool) -> Result<(), String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || exit_main_occupation_impl(&label, force))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

pub fn get_main_occupation_impl(
    window_label: &str,
) -> Result<Option<MainWorkspaceOccupation>, String> {
    let (workspace_path, _config) =
        get_window_workspace_config(window_label).ok_or("No workspace selected")?;

    let occupation = load_occupation_state(&workspace_path);

    // Auto-cleanup: if occupation exists but no window is using this workspace, clear it
    if occupation.is_some() {
        let windows = WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let is_in_use = windows.values().any(|p| *p == workspace_path);
        drop(windows);

        if !is_in_use {
            log::info!(
                "[worktree] Auto-clearing stale occupation state for workspace '{}' (no window using it)",
                workspace_path
            );
            let _ = clear_occupation_state(&workspace_path);
            return Ok(None);
        }
    }

    Ok(occupation)
}

#[tauri::command]
pub(crate) async fn get_main_occupation(
    window: tauri::Window,
) -> Result<Option<MainWorkspaceOccupation>, String> {
    let label = window.label().to_string();
    tokio::task::spawn_blocking(move || get_main_occupation_impl(&label))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{load_workspace_config, save_workspace_config_internal};
    use crate::state::WINDOW_WORKSPACES;
    use crate::types::WorkspaceConfig;
    use serial_test::serial;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    static NEXT_WINDOW_ID: AtomicUsize = AtomicUsize::new(0);

    fn run_git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("run git command");
        assert!(
            output.status.success(),
            "git {:?} failed in {}\nstdout:\n{}\nstderr:\n{}",
            args,
            repo.display(),
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
            "git {:?} failed in {}\nstdout:\n{}\nstderr:\n{}",
            args,
            repo.display(),
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
        run_git(repo, &["branch", "test"]);

        temp
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

    fn make_origin_backed_project(workspace: &Path, name: &str) -> PathBuf {
        let seed = make_test_repo();
        let origins_dir = workspace.join("origins");
        std::fs::create_dir_all(&origins_dir).expect("create origins dir");
        let origin_path = origins_dir.join(format!("{name}.git"));
        init_bare_repo(&origin_path);

        run_git(
            seed.path(),
            &["remote", "add", "origin", origin_path.to_str().unwrap()],
        );
        run_git(seed.path(), &["push", "origin", "main"]);
        run_git(seed.path(), &["push", "origin", "test"]);
        run_git(&origin_path, &["symbolic-ref", "HEAD", "refs/heads/main"]);

        let projects_dir = workspace.join("projects");
        std::fs::create_dir_all(&projects_dir).expect("create projects dir");
        let project_path = projects_dir.join(name);
        clone_repo(&origin_path, &project_path);
        run_git(&project_path, &["config", "user.email", "test@example.com"]);
        run_git(&project_path, &["config", "user.name", "Test User"]);
        run_git(&project_path, &["fetch", "origin"]);
        project_path
    }

    fn project_config(name: &str) -> ProjectConfig {
        ProjectConfig {
            name: name.to_string(),
            base_branch: "main".to_string(),
            test_branch: "test".to_string(),
            merge_strategy: "merge".to_string(),
            linked_folders: vec![],
            commit_prefix_index: None,
            git_user_name: None,
            git_user_email: None,
            tags: vec![],
        }
    }

    fn workspace_config(projects: Vec<ProjectConfig>) -> WorkspaceConfig {
        WorkspaceConfig {
            name: "Test Workspace".to_string(),
            worktrees_dir: "worktrees".to_string(),
            projects,
            ..WorkspaceConfig::default()
        }
    }

    fn bind_workspace(workspace: &Path, config: &WorkspaceConfig) -> String {
        let label = format!(
            "worktree-test-window-{}",
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

    #[serial]
    #[test]
    fn create_list_status_and_archive_worktree_with_local_git_fixture() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let project_path = make_origin_backed_project(workspace.path(), "demo");
        assert!(project_path.join(".git").exists());
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );

        let created_path = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "feature_roundtrip".to_string(),
                folder_name: None,
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create worktree");
        let worktree_path = PathBuf::from(&created_path);
        let wt_project_path = worktree_path.join("projects").join("demo");

        assert!(wt_project_path.exists());
        assert_eq!(
            git_output(&wt_project_path, &["branch", "--show-current"]),
            "feature_roundtrip"
        );

        let active = list_worktrees_impl(&label, false).expect("list active worktrees");
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].name, "feature_roundtrip");
        assert!(!active[0].is_archived);
        assert_eq!(active[0].projects.len(), 1);
        assert_eq!(active[0].projects[0].name, "demo");
        assert_eq!(active[0].projects[0].current_branch, "feature_roundtrip");
        assert_eq!(active[0].projects[0].base_branch, "main");

        let archive_status = check_worktree_status_impl(&label, "feature_roundtrip".to_string())
            .expect("check archive status");
        assert_eq!(archive_status.name, "feature_roundtrip");
        assert!(archive_status.can_archive, "{archive_status:?}");
        assert!(archive_status.errors.is_empty(), "{archive_status:?}");
        assert_eq!(archive_status.projects.len(), 1);
        assert_eq!(archive_status.projects[0].branch_name, "feature_roundtrip");

        archive_worktree_impl(&label, "feature_roundtrip".to_string()).expect("archive worktree");

        let workspace_path = workspace.path().to_string_lossy().to_string();
        let saved = load_workspace_config(&workspace_path);
        assert!(saved
            .archived_worktrees
            .contains(&"feature_roundtrip".to_string()));

        let visible_after_archive =
            list_worktrees_impl(&label, false).expect("list non-archived worktrees");
        assert!(visible_after_archive.is_empty());

        let archived = list_worktrees_impl(&label, true).expect("list archived worktrees");
        assert_eq!(archived.len(), 1);
        assert_eq!(archived[0].name, "feature_roundtrip");
        assert!(archived[0].is_archived);
        assert!(archived[0].projects.is_empty());
    }

    #[serial]
    #[test]
    fn restore_worktree_reregisters_existing_archived_project_and_clears_archive_flag() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let project_path = make_origin_backed_project(workspace.path(), "demo");
        run_git(&project_path, &["branch", "restore_feature"]);

        let mut config = workspace_config(vec![project_config("demo")]);
        config.archived_worktrees = vec!["restore_feature".to_string()];
        let label = bind_workspace(workspace.path(), &config);

        let placeholder_project = workspace
            .path()
            .join("worktrees")
            .join("restore_feature")
            .join("projects")
            .join("demo");
        std::fs::create_dir_all(&placeholder_project).expect("create archived placeholder");
        std::fs::write(placeholder_project.join("placeholder.txt"), "archived\n")
            .expect("write placeholder file");

        restore_worktree_impl(&label, "restore_feature".to_string()).expect("restore worktree");

        assert_eq!(
            git_output(&placeholder_project, &["branch", "--show-current"]),
            "restore_feature"
        );
        assert!(placeholder_project.join(".git").exists());

        let workspace_path = workspace.path().to_string_lossy().to_string();
        let saved = load_workspace_config(&workspace_path);
        assert!(!saved
            .archived_worktrees
            .contains(&"restore_feature".to_string()));
    }

    #[serial]
    #[test]
    fn create_worktree_rejects_invalid_name_before_workspace_lookup() {
        let err = create_worktree_impl(
            "unbound-window",
            CreateWorktreeRequest {
                name: "-upload-pack=sh".to_string(),
                folder_name: None,
                projects: vec![],
            },
        )
        .unwrap_err();

        assert_eq!(err, "无效的分支名");
    }

    #[serial]
    #[test]
    fn list_worktrees_returns_empty_when_worktrees_dir_is_missing() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let label = bind_workspace(workspace.path(), &workspace_config(vec![]));

        let items = list_worktrees_impl(&label, false).expect("list worktrees");

        assert!(items.is_empty());
    }

    #[serial]
    #[test]
    fn archive_worktree_reports_missing_worktree() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let label = bind_workspace(workspace.path(), &workspace_config(vec![]));

        let err = archive_worktree_impl(&label, "missing_feature".to_string()).unwrap_err();

        assert_eq!(err, "Worktree does not exist");
    }

    #[serial]
    #[test]
    fn restore_worktree_rejects_invalid_name_before_workspace_lookup() {
        let err = restore_worktree_impl("unbound-window", "bad..name".to_string()).unwrap_err();

        assert_eq!(err, "无效的分支名");
    }

    #[serial]
    #[test]
    fn terminate_worktree_locking_process_rejects_path_traversal_name() {
        let err = terminate_worktree_locking_process_impl(
            "unbound-window",
            "../feature".to_string(),
            123,
            "start".to_string(),
        )
        .unwrap_err();

        assert_eq!(err, "Invalid worktree name");
    }

    #[serial]
    #[test]
    fn scan_linked_folders_internal_reports_missing_path() {
        let missing = tempfile::tempdir()
            .expect("create temp dir")
            .path()
            .join("missing-project");

        let err = scan_linked_folders_internal(&missing.to_string_lossy()).unwrap_err();

        assert_eq!(err, format!("Path does not exist: {}", missing.display()));
    }

    #[serial]
    #[test]
    fn load_and_save_worktree_mapping_round_trip_display_name() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let mapping_path = temp.path().join("mapping.json");
        let mut mapping = HashMap::new();
        mapping.insert("folder_alias".to_string(), "Display Name".to_string());

        save_worktree_mapping(&mapping_path, &mapping);
        let loaded = load_worktree_mapping(&mapping_path);

        assert_eq!(
            loaded.get("folder_alias").map(String::as_str),
            Some("Display Name")
        );
    }

    #[serial]
    #[test]
    fn create_worktree_tracks_remote_branch_with_alias_links_color_and_scanning() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let project_path = make_origin_backed_project(workspace.path(), "demo");
        run_git(&project_path, &["checkout", "-b", "remote_feature"]);
        std::fs::write(project_path.join("remote.txt"), "remote branch\n")
            .expect("write remote branch file");
        run_git(&project_path, &["add", "remote.txt"]);
        run_git(&project_path, &["commit", "-m", "remote branch commit"]);
        run_git(&project_path, &["push", "-u", "origin", "remote_feature"]);
        run_git(&project_path, &["checkout", "main"]);
        run_git(&project_path, &["branch", "-D", "remote_feature"]);
        run_git(&project_path, &["fetch", "origin"]);

        std::fs::create_dir(project_path.join("node_modules")).expect("create linked folder");
        std::fs::write(
            project_path.join("node_modules").join("cache.txt"),
            "cache\n",
        )
        .expect("write linked folder file");
        std::fs::write(workspace.path().join(".env"), "A=1\n").expect("write workspace file");
        std::fs::create_dir(workspace.path().join("vault_shared")).expect("create vault item");

        let mut config = workspace_config(vec![project_config("demo")]);
        config.projects[0].linked_folders = vec!["node_modules".to_string()];
        config.linked_workspace_items = vec![".env".to_string()];
        config.vault_linked_workspace_items = vec!["vault_shared".to_string(), ".env".to_string()];
        let label = bind_workspace(workspace.path(), &config);

        let created_path = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "remote_feature".to_string(),
                folder_name: Some("remote_folder".to_string()),
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create aliased worktree from remote branch");
        let worktree_path = PathBuf::from(created_path);
        let wt_project_path = worktree_path.join("projects").join("demo");

        assert_eq!(
            git_output(&wt_project_path, &["branch", "--show-current"]),
            "remote_feature"
        );
        assert!(wt_project_path.join("remote.txt").exists());
        assert!(worktree_path.join(".env").symlink_metadata().is_ok());
        assert!(worktree_path
            .join("vault_shared")
            .symlink_metadata()
            .is_ok());
        assert!(wt_project_path
            .join("node_modules")
            .symlink_metadata()
            .is_ok());

        let main_status = get_main_workspace_status_impl(&label).expect("main status");
        assert_eq!(main_status.name, "Test Workspace");
        assert_eq!(main_status.projects.len(), 1);
        assert_eq!(main_status.projects[0].current_branch, "main");
        assert_eq!(
            main_status.projects[0].linked_folders,
            vec!["node_modules".to_string()]
        );

        let scanned =
            scan_linked_folders_internal(&project_path.to_string_lossy()).expect("scan folders");
        let node_modules = scanned
            .iter()
            .find(|folder| folder.relative_path == "node_modules")
            .expect("node_modules scan result");
        assert_eq!(node_modules.display_name, "node_modules");
        assert!(node_modules.is_recommended);

        let listed = list_worktrees_impl(&label, false).expect("list worktrees");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "remote_folder");
        assert_eq!(listed[0].display_name.as_deref(), Some("remote_feature"));
        assert!(listed[0].color.is_none());

        update_worktree_color_impl(
            &label,
            "remote_folder".to_string(),
            Some(crate::types::WorktreeColor::Blue),
        )
        .expect("set color");
        let listed = list_worktrees_impl(&label, false).expect("list colored worktree");
        assert_eq!(listed[0].color, Some(crate::types::WorktreeColor::Blue));

        update_worktree_color_impl(&label, "remote_folder".to_string(), None)
            .expect("remove color");
        let listed = list_worktrees_impl(&label, false).expect("list uncolored worktree");
        assert!(listed[0].color.is_none());
    }

    #[serial]
    #[test]
    fn archive_and_delete_aliased_worktree_removes_directory_mapping_and_local_branch() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let project_path = make_origin_backed_project(workspace.path(), "demo");
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );

        let created_path = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "delete_feature".to_string(),
                folder_name: Some("delete_folder".to_string()),
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create worktree to delete");
        let worktree_path = PathBuf::from(created_path);
        assert!(worktree_path.exists());
        assert!(!git_output(&project_path, &["branch", "--list", "delete_feature"]).is_empty());

        archive_worktree_impl(&label, "delete_folder".to_string()).expect("archive worktree");
        let workspace_path = workspace.path().to_string_lossy().to_string();
        let archived = load_workspace_config(&workspace_path);
        assert!(archived
            .archived_worktrees
            .contains(&"delete_folder".to_string()));
        assert!(worktree_path.exists());

        delete_archived_worktree_impl(&label, "delete_folder".to_string())
            .expect("delete archived worktree");

        assert!(!worktree_path.exists());
        let saved = load_workspace_config(&workspace_path);
        assert!(!saved
            .archived_worktrees
            .contains(&"delete_folder".to_string()));
        assert!(git_output(&project_path, &["branch", "--list", "delete_feature"]).is_empty());
        let mapping =
            load_worktree_mapping(&workspace.path().join("worktrees").join("mapping.json"));
        assert!(!mapping.contains_key("delete_folder"));
    }

    #[serial]
    #[test]
    fn add_project_to_aliased_worktree_uses_mapped_branch_and_reports_conflicts() {
        let workspace = tempfile::tempdir().expect("create workspace");
        make_origin_backed_project(workspace.path(), "demo");
        let api_path = make_origin_backed_project(workspace.path(), "api");
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo"), project_config("api")]),
        );

        create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "mapped_feature".to_string(),
                folder_name: Some("mapped_folder".to_string()),
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create initial worktree");

        add_project_to_worktree_impl(
            &label,
            AddProjectToWorktreeRequest {
                worktree_name: "mapped_folder".to_string(),
                project_name: "api".to_string(),
                base_branch: "main".to_string(),
            },
        )
        .expect("add api project to worktree");

        let api_in_worktree = workspace
            .path()
            .join("worktrees")
            .join("mapped_folder")
            .join("projects")
            .join("api");
        assert_eq!(
            git_output(&api_in_worktree, &["branch", "--show-current"]),
            "mapped_feature"
        );
        assert!(!git_output(&api_path, &["branch", "--list", "mapped_feature"]).is_empty());

        let duplicate = add_project_to_worktree_impl(
            &label,
            AddProjectToWorktreeRequest {
                worktree_name: "mapped_folder".to_string(),
                project_name: "api".to_string(),
                base_branch: "main".to_string(),
            },
        )
        .unwrap_err();
        assert!(
            duplicate.contains("already exists in worktree"),
            "{duplicate}"
        );

        let missing = add_project_to_worktree_impl(
            &label,
            AddProjectToWorktreeRequest {
                worktree_name: "mapped_folder".to_string(),
                project_name: "missing".to_string(),
                base_branch: "main".to_string(),
            },
        )
        .unwrap_err();
        assert!(
            missing.contains("does not exist in main workspace"),
            "{missing}"
        );
    }

    #[serial]
    #[test]
    fn worktree_status_reports_dirty_project_before_archive() {
        let workspace = tempfile::tempdir().expect("create workspace");
        make_origin_backed_project(workspace.path(), "demo");
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );
        let created_path = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "dirty_feature".to_string(),
                folder_name: None,
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create worktree");
        let wt_project_path = PathBuf::from(created_path).join("projects").join("demo");
        std::fs::write(wt_project_path.join("README.md"), "dirty\n").expect("dirty readme");

        let status = check_worktree_status_impl(&label, "dirty_feature".to_string())
            .expect("check dirty worktree status");

        assert_eq!(status.name, "dirty_feature");
        assert!(!status.can_archive, "{status:?}");
        assert_eq!(status.projects.len(), 1);
        assert!(status.projects[0].has_uncommitted);
        assert!(
            status.errors.iter().any(|error| error.contains("demo")),
            "{status:?}"
        );
    }

    #[serial]
    #[test]
    fn deploy_to_main_and_exit_occupation_round_trip_with_force_cleanup() {
        let workspace = tempfile::tempdir().expect("create workspace");
        make_origin_backed_project(workspace.path(), "demo");
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );
        let created_path = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "occupy_feature".to_string(),
                folder_name: None,
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create worktree");
        let workspace_path = workspace.path().to_string_lossy().to_string();
        let main_project_path = workspace.path().join("projects").join("demo");
        let wt_project_path = PathBuf::from(created_path).join("projects").join("demo");

        let deployed =
            deploy_to_main_impl(&label, "occupy_feature".to_string()).expect("deploy to main");

        assert!(deployed.success, "{deployed:?}");
        assert_eq!(deployed.switched_projects, vec!["demo".to_string()]);
        let occupation = load_occupation_state(&workspace_path).expect("occupation state saved");
        assert_eq!(occupation.worktree_name, "occupy_feature");
        assert_eq!(
            occupation.original_branches.get("demo").map(String::as_str),
            Some("main")
        );
        assert_eq!(
            occupation.worktree_branches.get("demo").map(String::as_str),
            Some("occupy_feature")
        );
        assert_eq!(
            git_output(&main_project_path, &["branch", "--show-current"]),
            "occupy_feature"
        );
        assert_eq!(
            git_output(&wt_project_path, &["rev-parse", "--abbrev-ref", "HEAD"]),
            "HEAD"
        );
        assert!(get_main_occupation_impl(&label)
            .expect("get occupation")
            .is_some());

        std::fs::write(main_project_path.join("dirty.txt"), "dirty\n").expect("dirty main");
        let err = exit_main_occupation_impl(&label, false).unwrap_err();
        assert!(err.contains("uncommitted changes"), "{err}");
        assert!(load_occupation_state(&workspace_path).is_some());

        exit_main_occupation_impl(&label, true).expect("force exit occupation");

        assert!(load_occupation_state(&workspace_path).is_none());
        assert_eq!(
            git_output(&main_project_path, &["branch", "--show-current"]),
            "main"
        );
        assert_eq!(
            git_output(&wt_project_path, &["branch", "--show-current"]),
            "occupy_feature"
        );
        assert!(!main_project_path.join("dirty.txt").exists());
        assert!(get_main_occupation_impl(&label)
            .expect("get cleared occupation")
            .is_none());
    }

    #[serial]
    #[test]
    fn create_worktree_reports_nonexistent_base_branch_and_existing_directory_conflict() {
        let workspace = tempfile::tempdir().expect("create workspace");
        make_origin_backed_project(workspace.path(), "demo");
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );

        let missing_base = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "missing_base_feature".to_string(),
                folder_name: None,
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "does-not-exist".to_string(),
                }],
            },
        )
        .unwrap_err();
        assert!(
            missing_base.contains("Failed to create worktree for demo"),
            "{missing_base}"
        );
        assert!(
            missing_base.contains("origin/does-not-exist")
                || missing_base.contains("invalid reference"),
            "{missing_base}"
        );

        let conflict_project_path = workspace
            .path()
            .join("worktrees")
            .join("conflict_feature")
            .join("projects")
            .join("demo");
        std::fs::create_dir_all(&conflict_project_path).expect("create conflicting dir");
        std::fs::write(conflict_project_path.join("occupied.txt"), "occupied\n")
            .expect("write conflict marker");

        let path_conflict = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "conflict_feature".to_string(),
                folder_name: None,
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .unwrap_err();

        assert!(
            path_conflict.contains("Failed to create worktree for demo"),
            "{path_conflict}"
        );
        assert!(
            path_conflict.contains("already exists") || path_conflict.contains("not empty"),
            "{path_conflict}"
        );
    }

    #[serial]
    #[test]
    fn list_worktrees_filters_hidden_non_project_entries_and_archived_items() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let mut config = workspace_config(vec![]);
        config
            .archived_worktrees
            .push("archived_folder".to_string());
        let label = bind_workspace(workspace.path(), &config);
        let worktrees_dir = workspace.path().join("worktrees");

        std::fs::create_dir_all(worktrees_dir.join(".hidden").join("projects"))
            .expect("create hidden worktree");
        std::fs::create_dir_all(worktrees_dir.join("no_projects")).expect("create non-project dir");
        std::fs::create_dir_all(
            worktrees_dir
                .join("active_folder")
                .join("projects")
                .join("external"),
        )
        .expect("create active project dir");
        std::fs::write(
            worktrees_dir
                .join("active_folder")
                .join("projects")
                .join("README.md"),
            "not a project dir\n",
        )
        .expect("write non-dir entry");
        std::fs::create_dir_all(
            worktrees_dir
                .join("archived_folder")
                .join("projects")
                .join("archived_project"),
        )
        .expect("create archived project dir");
        save_worktree_mapping(
            &worktrees_dir.join("mapping.json"),
            &HashMap::from([("active_folder".to_string(), "Active Display".to_string())]),
        );

        let active = list_worktrees_impl(&label, false).expect("list active only");
        assert_eq!(
            active
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            vec!["active_folder"]
        );
        assert_eq!(active[0].display_name.as_deref(), Some("Active Display"));
        assert_eq!(active[0].projects.len(), 1);
        assert_eq!(active[0].projects[0].name, "external");
        assert!(!active[0].is_archived);

        let all = list_worktrees_impl(&label, true).expect("list including archived");
        let names = all
            .iter()
            .map(|item| item.name.as_str())
            .collect::<Vec<_>>();
        assert!(names.contains(&"active_folder"), "{names:?}");
        assert!(names.contains(&"archived_folder"), "{names:?}");
        assert!(!names.contains(&".hidden"), "{names:?}");
        assert!(!names.contains(&"no_projects"), "{names:?}");
        assert!(
            all.iter()
                .find(|item| item.name == "archived_folder")
                .expect("archived item listed")
                .is_archived
        );
    }

    #[serial]
    #[test]
    fn archived_delete_and_deploy_preconditions_report_specific_errors() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let config = workspace_config(vec![]);
        let label = bind_workspace(workspace.path(), &config);
        let workspace_path = workspace.path().to_string_lossy().to_string();

        let delete_active =
            delete_archived_worktree_impl(&label, "not_archived".to_string()).unwrap_err();
        assert!(
            delete_active.contains("Can only delete archived worktrees"),
            "{delete_active}"
        );

        let mut archived_config = load_workspace_config(&workspace_path);
        archived_config
            .archived_worktrees
            .push("ghost_archive".to_string());
        save_workspace_config_internal(&workspace_path, &archived_config)
            .expect("save archived marker");
        let delete_missing =
            delete_archived_worktree_impl(&label, "ghost_archive".to_string()).unwrap_err();
        assert!(
            delete_missing.contains("Archived worktree does not exist"),
            "{delete_missing}"
        );

        let missing_worktree =
            deploy_to_main_impl(&label, "missing_worktree".to_string()).unwrap_err();
        assert!(
            missing_worktree.contains("Worktree 'missing_worktree' does not exist"),
            "{missing_worktree}"
        );

        let worktrees_dir = workspace.path().join("worktrees");
        std::fs::create_dir_all(worktrees_dir.join("without_projects"))
            .expect("create worktree shell");
        let no_projects_dir =
            deploy_to_main_impl(&label, "without_projects".to_string()).unwrap_err();
        assert!(
            no_projects_dir.contains("Worktree has no projects directory"),
            "{no_projects_dir}"
        );

        std::fs::create_dir_all(worktrees_dir.join("empty_projects").join("projects"))
            .expect("create empty projects dir");
        let no_project_entries =
            deploy_to_main_impl(&label, "empty_projects".to_string()).unwrap_err();
        assert!(
            no_project_entries.contains("No projects found in worktree"),
            "{no_project_entries}"
        );

        save_occupation_state(
            &workspace_path,
            &MainWorkspaceOccupation {
                worktree_name: "busy_feature".to_string(),
                original_branches: HashMap::new(),
                worktree_branches: HashMap::new(),
                deployed_at: "2026-06-11T00:00:00Z".to_string(),
            },
        )
        .expect("save occupation state");
        let occupied = deploy_to_main_impl(&label, "empty_projects".to_string()).unwrap_err();
        assert!(
            occupied.contains("Main workspace is already occupied by worktree 'busy_feature'"),
            "{occupied}"
        );
    }

    #[serial]
    #[test]
    fn create_worktree_uses_existing_local_branch_without_creating_remote_tracking_branch() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let project_path = make_origin_backed_project(workspace.path(), "demo");
        run_git(&project_path, &["branch", "local_feature"]);
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );

        let created = create_worktree_impl(
            &label,
            CreateWorktreeRequest {
                name: "local_feature".to_string(),
                folder_name: None,
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create worktree from existing local branch");
        let wt_project = PathBuf::from(created).join("projects").join("demo");

        assert_eq!(
            git_output(&wt_project, &["branch", "--show-current"]),
            "local_feature"
        );
        assert!(!git_output(&project_path, &["branch", "--list", "local_feature"]).is_empty());
    }

    #[serial]
    #[test]
    fn archive_and_status_accept_worktree_without_projects_directory() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let label = bind_workspace(workspace.path(), &workspace_config(vec![]));
        let worktree_path = workspace.path().join("worktrees").join("shell_only");
        std::fs::create_dir_all(&worktree_path).expect("create shell worktree");

        let status = check_worktree_status_impl(&label, "shell_only".to_string())
            .expect("status for shell-only worktree");
        assert!(status.can_archive, "{status:?}");
        assert!(status.projects.is_empty());
        assert!(status.errors.is_empty());

        archive_worktree_impl(&label, "shell_only".to_string()).expect("archive shell worktree");
        let saved = load_workspace_config(&workspace.path().to_string_lossy());
        assert!(saved.archived_worktrees.contains(&"shell_only".to_string()));
        assert!(worktree_path.exists());
    }

    #[serial]
    #[test]
    fn restore_worktree_recreates_missing_branch_and_relinks_workspace_items() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let project_path = make_origin_backed_project(workspace.path(), "demo");
        std::fs::create_dir(project_path.join("cache")).expect("create linked folder");
        std::fs::write(project_path.join("cache").join("data.txt"), "cache\n")
            .expect("write linked folder data");
        std::fs::write(workspace.path().join("shared.env"), "A=1\n").expect("write shared item");

        let mut config = workspace_config(vec![project_config("demo")]);
        config.projects[0].linked_folders = vec!["cache".to_string()];
        config.linked_workspace_items = vec!["shared.env".to_string()];
        config.archived_worktrees = vec!["restore_missing_branch".to_string()];
        let label = bind_workspace(workspace.path(), &config);
        let archived_project = workspace
            .path()
            .join("worktrees")
            .join("restore_missing_branch")
            .join("projects")
            .join("demo");
        std::fs::create_dir_all(&archived_project).expect("create archived project placeholder");
        std::fs::write(archived_project.join("placeholder.txt"), "archived\n")
            .expect("write placeholder");

        restore_worktree_impl(&label, "restore_missing_branch".to_string())
            .expect("restore by creating missing branch from origin/main");

        assert_eq!(
            git_output(&archived_project, &["branch", "--show-current"]),
            "restore_missing_branch"
        );
        assert!(archived_project.join("cache").symlink_metadata().is_ok());
        assert!(workspace
            .path()
            .join("worktrees")
            .join("restore_missing_branch")
            .join("shared.env")
            .symlink_metadata()
            .is_ok());
        let saved = load_workspace_config(&workspace.path().to_string_lossy());
        assert!(!saved
            .archived_worktrees
            .contains(&"restore_missing_branch".to_string()));
    }

    #[serial]
    #[test]
    fn restore_worktree_skips_missing_main_project_and_invalid_base_branch() {
        let workspace = tempfile::tempdir().expect("create workspace");
        make_origin_backed_project(workspace.path(), "demo");
        let mut invalid = project_config("demo");
        invalid.base_branch = "-bad".to_string();
        let mut missing = project_config("missing");
        missing.base_branch = "main".to_string();
        let mut config = workspace_config(vec![invalid, missing]);
        config.archived_worktrees = vec!["restore_edge".to_string()];
        let label = bind_workspace(workspace.path(), &config);

        let archived_root = workspace.path().join("worktrees").join("restore_edge");
        std::fs::create_dir_all(archived_root.join("projects").join("demo"))
            .expect("create invalid-base placeholder");
        std::fs::create_dir_all(archived_root.join("projects").join("missing"))
            .expect("create missing-main placeholder");

        restore_worktree_impl(&label, "restore_edge".to_string())
            .expect("restore skips unrecoverable projects and clears archive marker");

        let saved = load_workspace_config(&workspace.path().to_string_lossy());
        assert!(!saved
            .archived_worktrees
            .contains(&"restore_edge".to_string()));
        assert!(!archived_root.join("projects").join("demo").exists());
        assert!(archived_root.join("projects").join("missing").exists());
    }

    #[serial]
    #[test]
    fn add_project_to_worktree_tracks_existing_remote_branch_and_creates_projects_dir() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let api_path = make_origin_backed_project(workspace.path(), "api");
        run_git(&api_path, &["checkout", "-b", "remote_add_feature"]);
        std::fs::write(api_path.join("api.txt"), "api\n").expect("write api branch file");
        run_git(&api_path, &["add", "api.txt"]);
        run_git(&api_path, &["commit", "-m", "api branch"]);
        run_git(&api_path, &["push", "-u", "origin", "remote_add_feature"]);
        run_git(&api_path, &["checkout", "main"]);
        run_git(&api_path, &["branch", "-D", "remote_add_feature"]);
        run_git(&api_path, &["fetch", "origin"]);

        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("api")]),
        );
        std::fs::create_dir_all(
            workspace
                .path()
                .join("worktrees")
                .join("remote_add_feature"),
        )
        .expect("create empty worktree dir");

        add_project_to_worktree_impl(
            &label,
            AddProjectToWorktreeRequest {
                worktree_name: "remote_add_feature".to_string(),
                project_name: "api".to_string(),
                base_branch: "main".to_string(),
            },
        )
        .expect("add project by tracking existing remote branch");
        let api_in_worktree = workspace
            .path()
            .join("worktrees")
            .join("remote_add_feature")
            .join("projects")
            .join("api");

        assert_eq!(
            git_output(&api_in_worktree, &["branch", "--show-current"]),
            "remote_add_feature"
        );
        assert!(api_in_worktree.join("api.txt").exists());
    }

    #[serial]
    #[test]
    fn deploy_to_main_reports_dirty_main_and_failed_detach_without_saving_occupation() {
        let dirty_workspace = tempfile::tempdir().expect("create dirty workspace");
        make_origin_backed_project(dirty_workspace.path(), "demo");
        let dirty_label = bind_workspace(
            dirty_workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );
        create_worktree_impl(
            &dirty_label,
            CreateWorktreeRequest {
                name: "dirty_main_feature".to_string(),
                folder_name: None,
                projects: vec![CreateProjectRequest {
                    name: "demo".to_string(),
                    base_branch: "main".to_string(),
                }],
            },
        )
        .expect("create worktree for dirty deploy check");
        let dirty_main = dirty_workspace.path().join("projects").join("demo");
        std::fs::write(dirty_main.join("dirty.txt"), "dirty\n").expect("dirty main workspace");

        let dirty_err =
            deploy_to_main_impl(&dirty_label, "dirty_main_feature".to_string()).unwrap_err();
        assert!(dirty_err.contains("uncommitted changes"), "{dirty_err}");

        let broken_workspace = tempfile::tempdir().expect("create broken workspace");
        make_origin_backed_project(broken_workspace.path(), "broken");
        let broken_label = bind_workspace(
            broken_workspace.path(),
            &workspace_config(vec![project_config("broken")]),
        );
        std::fs::create_dir_all(
            broken_workspace
                .path()
                .join("worktrees")
                .join("broken_feature")
                .join("projects")
                .join("broken"),
        )
        .expect("create non-git worktree project");

        let result = deploy_to_main_impl(&broken_label, "broken_feature".to_string())
            .expect("deploy returns per-project failure result");
        assert!(!result.success, "{result:?}");
        assert!(result.switched_projects.is_empty());
        assert_eq!(result.failed_projects.len(), 1);
        assert!(result.failed_projects[0]
            .error
            .contains("Failed to detach worktree HEAD"));
        assert!(load_occupation_state(&broken_workspace.path().to_string_lossy()).is_none());
    }

    #[serial]
    #[test]
    fn process_termination_and_occupation_errors_are_reported_before_mutation() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let label = bind_workspace(workspace.path(), &workspace_config(vec![]));
        std::fs::create_dir_all(workspace.path().join("worktrees").join("locked_feature"))
            .expect("create worktree dir");

        let lock_err = terminate_worktree_locking_process_impl(
            &label,
            "locked_feature".to_string(),
            12345,
            "start-time".to_string(),
        )
        .unwrap_err();
        assert_eq!(lock_err, "Process is no longer locking this worktree");

        let exit_err = exit_main_occupation_impl(&label, false).unwrap_err();
        assert_eq!(exit_err, "Main workspace is not currently occupied");
    }

    #[serial]
    #[test]
    fn empty_workspace_impls_report_expected_preconditions_without_global_state() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let label = bind_workspace(workspace.path(), &workspace_config(vec![]));
        let add_request = AddProjectToWorktreeRequest {
            worktree_name: "feature".to_string(),
            project_name: "demo".to_string(),
            base_branch: "main".to_string(),
        };

        assert!(list_worktrees_impl(&label, false).unwrap().is_empty());
        update_worktree_color_impl(
            &label,
            "feature".to_string(),
            Some(crate::types::WorktreeColor::Green),
        )
        .expect("update worktree color");
        let saved = load_workspace_config(&workspace.path().to_string_lossy());
        assert_eq!(
            saved.worktree_colors.get("feature"),
            Some(&crate::types::WorktreeColor::Green)
        );
        assert_eq!(
            archive_worktree_impl(&label, "feature".to_string()).unwrap_err(),
            "Worktree does not exist"
        );
        assert_eq!(
            check_worktree_status_impl(&label, "feature".to_string()).unwrap_err(),
            "Worktree does not exist"
        );
        assert_eq!(
            restore_worktree_impl(&label, "feature".to_string()).unwrap_err(),
            "Archived worktree does not exist"
        );
        assert_eq!(
            delete_archived_worktree_impl(&label, "feature".to_string()).unwrap_err(),
            "Can only delete archived worktrees"
        );
        assert_eq!(
            add_project_to_worktree_impl(&label, add_request).unwrap_err(),
            "Worktree 'feature' does not exist"
        );
        assert_eq!(
            deploy_to_main_impl(&label, "feature".to_string()).unwrap_err(),
            "Worktree 'feature' does not exist"
        );
        assert_eq!(
            exit_main_occupation_impl(&label, false).unwrap_err(),
            "Main workspace is not currently occupied"
        );
        assert!(get_main_occupation_impl(&label).unwrap().is_none());
    }

    #[serial]
    #[test]
    fn add_project_to_worktree_rejects_invalid_base_branch_before_workspace_lookup() {
        let err = add_project_to_worktree_impl(
            "unbound-worktree-window",
            AddProjectToWorktreeRequest {
                worktree_name: "feature".to_string(),
                project_name: "demo".to_string(),
                base_branch: "-bad".to_string(),
            },
        )
        .unwrap_err();

        assert_eq!(err, "无效的分支名");
    }

    #[serial]
    #[test]
    fn load_worktree_mapping_returns_empty_for_missing_and_invalid_json() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let missing = temp.path().join("missing-mapping.json");
        let invalid = temp.path().join("mapping.json");
        std::fs::write(&invalid, "{not json").expect("write invalid mapping");

        assert!(load_worktree_mapping(&missing).is_empty());
        assert!(load_worktree_mapping(&invalid).is_empty());
    }

    #[serial]
    #[test]
    fn delete_archived_worktree_rejects_invalid_mapped_branch_without_deleting() {
        let workspace = tempfile::tempdir().expect("create workspace");
        let mut config = workspace_config(vec![]);
        config.archived_worktrees.push("folder_alias".to_string());
        let label = bind_workspace(workspace.path(), &config);
        let worktrees_dir = workspace.path().join("worktrees");
        let archived_dir = worktrees_dir.join("folder_alias");
        std::fs::create_dir_all(&archived_dir).expect("create archived worktree dir");
        save_worktree_mapping(
            &worktrees_dir.join("mapping.json"),
            &HashMap::from([("folder_alias".to_string(), "-bad".to_string())]),
        );

        let err = delete_archived_worktree_impl(&label, "folder_alias".to_string()).unwrap_err();

        assert_eq!(err, "无效的分支名");
        assert!(archived_dir.exists());
        let saved = load_workspace_config(&workspace.path().to_string_lossy());
        assert!(saved
            .archived_worktrees
            .contains(&"folder_alias".to_string()));
    }

    #[serial]
    #[test]
    fn add_project_to_worktree_rejects_invalid_mapped_branch_before_fetch() {
        let workspace = tempfile::tempdir().expect("create workspace");
        make_origin_backed_project(workspace.path(), "demo");
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![project_config("demo")]),
        );
        let worktrees_dir = workspace.path().join("worktrees");
        std::fs::create_dir_all(worktrees_dir.join("folder_alias"))
            .expect("create target worktree dir");
        save_worktree_mapping(
            &worktrees_dir.join("mapping.json"),
            &HashMap::from([("folder_alias".to_string(), "-bad".to_string())]),
        );

        let err = add_project_to_worktree_impl(
            &label,
            AddProjectToWorktreeRequest {
                worktree_name: "folder_alias".to_string(),
                project_name: "demo".to_string(),
                base_branch: "main".to_string(),
            },
        )
        .unwrap_err();

        assert_eq!(err, "无效的分支名");
        assert!(!worktrees_dir
            .join("folder_alias")
            .join("projects")
            .join("demo")
            .exists());
    }

    #[serial]
    #[test]
    fn restore_worktree_without_projects_dir_clears_archive_and_relinks_workspace_items() {
        let workspace = tempfile::tempdir().expect("create workspace");
        std::fs::write(workspace.path().join("shared.env"), "A=1\n").expect("write shared item");
        let mut config = workspace_config(vec![]);
        config.archived_worktrees.push("docs_only".to_string());
        config.linked_workspace_items.push("shared.env".to_string());
        let label = bind_workspace(workspace.path(), &config);
        let archived_root = workspace.path().join("worktrees").join("docs_only");
        std::fs::create_dir_all(&archived_root).expect("create archived worktree shell");

        restore_worktree_impl(&label, "docs_only".to_string()).expect("restore shell worktree");

        let saved = load_workspace_config(&workspace.path().to_string_lossy());
        assert!(!saved.archived_worktrees.contains(&"docs_only".to_string()));
        assert!(archived_root.join("shared.env").symlink_metadata().is_ok());
    }

    #[serial]
    #[test]
    fn get_main_workspace_status_skips_missing_projects_and_reports_existing_metadata() {
        let workspace = tempfile::tempdir().expect("create workspace");
        make_origin_backed_project(workspace.path(), "demo");
        let mut demo = project_config("demo");
        demo.linked_folders = vec!["node_modules".to_string()];
        let label = bind_workspace(
            workspace.path(),
            &workspace_config(vec![demo, project_config("missing")]),
        );

        let status = get_main_workspace_status_impl(&label).expect("main workspace status");

        assert_eq!(status.name, "Test Workspace");
        assert_eq!(status.projects.len(), 1);
        assert_eq!(status.projects[0].name, "demo");
        assert_eq!(status.projects[0].base_branch, "main");
        assert_eq!(status.projects[0].test_branch, "test");
        assert_eq!(
            status.projects[0].linked_folders,
            vec!["node_modules".to_string()]
        );
    }

    #[serial]
    #[test]
    fn scan_linked_folders_internal_sorts_recommended_before_larger_generic_folder() {
        let project = tempfile::tempdir().expect("create project dir");
        let node_modules = project.path().join("node_modules");
        let dist = project.path().join("dist");
        std::fs::create_dir(&node_modules).expect("create node_modules");
        std::fs::create_dir(&dist).expect("create dist");
        std::fs::write(node_modules.join("tiny.bin"), [1_u8; 4]).expect("write tiny file");
        std::fs::write(dist.join("large.bin"), [2_u8; 1024]).expect("write large file");

        let scanned =
            scan_linked_folders_internal(&project.path().to_string_lossy()).expect("scan folders");

        assert!(scanned.len() >= 2, "{scanned:?}");
        assert_eq!(scanned[0].relative_path, "node_modules");
        assert!(scanned[0].is_recommended);
        let dist = scanned
            .iter()
            .find(|folder| folder.relative_path == "dist")
            .expect("dist scan result");
        assert!(!dist.is_recommended);
        assert!(dist.size_bytes > scanned[0].size_bytes);
    }
}
