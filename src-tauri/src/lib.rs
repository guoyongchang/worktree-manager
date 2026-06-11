pub mod cloud_client;
mod commands;
pub mod config;
mod git_ops;
pub(crate) mod http_origin_policy;
pub mod http_server;
pub mod mirror;
mod pty_manager;
pub mod state;
pub(crate) mod tls;
pub mod types;
pub mod utils;

// Re-exports used by http_server and other modules
pub use config::*;
pub(crate) use state::*;
pub use types::*;
pub use utils::normalize_path;

// Re-exports of _impl functions used by http_server
pub use commands::git::{
    add_existing_project_impl, clone_project_impl, import_external_project_impl,
    remove_project_from_config_impl, scan_existing_projects_impl, switch_branch_internal,
};
pub use commands::sharing::{kick_client_internal, start_ngrok_tunnel_internal};
pub use commands::system::{
    detect_tools_internal, get_app_icon_internal, open_in_editor_internal,
    open_in_terminal_internal, open_log_dir_internal, reveal_in_finder_internal,
    set_git_path_internal,
};
pub use commands::window::{
    lock_worktree_impl, set_window_workspace_impl, unlock_worktree_impl, unregister_window_impl,
};
pub use commands::workspace::{
    add_workspace_internal, create_workspace_internal, get_config_path_info_impl,
    get_current_workspace_impl, get_workspace_config_impl, remove_workspace_internal,
    save_workspace_config_impl, switch_workspace_impl,
};
pub use commands::worktree::{
    add_project_to_worktree_impl, archive_worktree_impl, check_worktree_status_impl,
    create_worktree_impl, delete_archived_worktree_impl, deploy_to_main_impl,
    exit_main_occupation_impl, get_main_occupation_impl, get_main_workspace_status_impl,
    list_worktrees_impl, restore_worktree_impl, scan_linked_folders_internal,
    terminate_worktree_locking_process_impl, update_worktree_color_impl,
};

use commands::cloud::*;
use commands::config::*;
use commands::git::*;
use commands::pty::*;
use commands::sharing::*;
use commands::system::*;
use commands::vault::*;
use commands::voice::*;
use commands::window::*;
use commands::workspace::*;
use commands::worktree::*;
use serde::Serialize;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

// ==================== Tauri 入口 ====================

const CRASH_LOG_FILE: &str = "crash.log";
const PENDING_ERROR_LOG_FILE: &str = "worktree-manager-err.log";
const SESSION_RUNNING_FILE: &str = "session.running";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CrashReport {
    abnormal_exit: bool,
    crash_detail: Option<String>,
    previous_session_info: Option<String>,
}

pub(crate) static PENDING_CRASH_REPORT: OnceLock<Mutex<Option<CrashReport>>> = OnceLock::new();

pub(crate) fn pending_crash_report() -> &'static Mutex<Option<CrashReport>> {
    PENDING_CRASH_REPORT.get_or_init(|| Mutex::new(None))
}

// cfg 分支结构要求每个平台分支显式 return，clippy 的 needless_return 在此为误报
#[allow(clippy::needless_return)]
fn crash_log_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return dirs::home_dir().map(|home| {
            home.join("Library")
                .join("Logs")
                .join("com.guo.worktree-manager")
        });
    }

    #[cfg(target_os = "windows")]
    {
        return dirs::data_local_dir().map(|dir| dir.join("com.guo.worktree-manager").join("logs"));
    }

    #[cfg(target_os = "linux")]
    {
        return dirs::data_local_dir().map(|dir| dir.join("com.guo.worktree-manager").join("logs"));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        dirs::data_local_dir().map(|dir| dir.join("com.guo.worktree-manager").join("logs"))
    }
}

fn panic_payload_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(message) = info.payload().downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = info.payload().downcast_ref::<String>() {
        message.clone()
    } else {
        "<non-string panic payload>".to_string()
    }
}

fn append_crash_log(entry: &str) -> std::io::Result<()> {
    use std::io::Write;

    let log_dir = crash_log_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "cannot resolve crash log dir")
    })?;
    std::fs::create_dir_all(&log_dir)?;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join(CRASH_LOG_FILE))?;
    writeln!(file, "{}", entry)?;
    std::fs::write(log_dir.join(PENDING_ERROR_LOG_FILE), entry)?;
    Ok(())
}

fn read_and_clear_pending_error_log(log_dir: &Path) -> Option<String> {
    let path = log_dir.join(PENDING_ERROR_LOG_FILE);
    let detail = std::fs::read_to_string(&path).ok();

    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => log::warn!(
            "[crash] failed to remove pending crash detail {:?}: {}",
            path,
            e
        ),
    }

    detail
}

fn parse_session_marker_pid(contents: &str) -> Option<u32> {
    contents.lines().find_map(|line| {
        line.strip_prefix("pid:")
            .and_then(|pid| pid.trim().parse::<u32>().ok())
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn is_process_running(pid: u32) -> Option<bool> {
    if pid > i32::MAX as u32 {
        return Some(false);
    }

    // Signal 0 performs permission/existence checks without sending a signal.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return Some(true);
    }

    match std::io::Error::last_os_error().raw_os_error() {
        Some(code) if code == libc::ESRCH => Some(false),
        Some(code) if code == libc::EPERM => Some(true),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn is_process_running(pid: u32) -> Option<bool> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Some(stdout.contains(&pid.to_string()))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn is_process_running(_pid: u32) -> Option<bool> {
    None
}

fn take_startup_crash_report(log_dir: &Path) -> Option<CrashReport> {
    let session_path = log_dir.join(SESSION_RUNNING_FILE);
    let abnormal_exit = session_path.exists();
    let previous_session_info = if abnormal_exit {
        std::fs::read_to_string(&session_path).ok()
    } else {
        None
    };

    if abnormal_exit {
        if let Some(pid) = previous_session_info
            .as_deref()
            .and_then(parse_session_marker_pid)
        {
            if is_process_running(pid) == Some(true) {
                log::info!(
                    "[crash] session marker belongs to a running process (pid={}), skipping crash report",
                    pid
                );
                return None;
            }
        }

        let crash_detail = read_and_clear_pending_error_log(log_dir);
        Some(CrashReport {
            abnormal_exit,
            crash_detail,
            previous_session_info,
        })
    } else {
        let _ = read_and_clear_pending_error_log(log_dir);
        None
    }
}

fn detect_startup_crash_report() {
    let Some(log_dir) = crash_log_dir() else {
        log::warn!("[crash] cannot resolve crash log dir for startup check");
        return;
    };

    let report = take_startup_crash_report(&log_dir);
    match pending_crash_report().lock() {
        Ok(mut pending) => *pending = report,
        Err(e) => log::error!("[crash] failed to lock pending crash report: {}", e),
    }
}

fn session_running_contents() -> String {
    format!(
        "timestamp: {}\nversion: {}\npid: {}\n",
        chrono::Local::now().to_rfc3339(),
        env!("CARGO_PKG_VERSION"),
        std::process::id()
    )
}

fn write_session_running_file_at(log_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(log_dir)?;
    std::fs::write(
        log_dir.join(SESSION_RUNNING_FILE),
        session_running_contents(),
    )
}

fn write_session_running_file() {
    let Some(log_dir) = crash_log_dir() else {
        log::warn!("[crash] cannot resolve crash log dir for session marker");
        return;
    };

    if let Err(e) = write_session_running_file_at(&log_dir) {
        log::warn!("[crash] failed to write session marker: {}", e);
    }
}

fn remove_session_running_file_at(log_dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(log_dir.join(SESSION_RUNNING_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn remove_session_running_file() {
    let Some(log_dir) = crash_log_dir() else {
        log::warn!("[crash] cannot resolve crash log dir for session cleanup");
        return;
    };

    if let Err(e) = remove_session_running_file_at(&log_dir) {
        log::warn!("[crash] failed to remove session marker: {}", e);
    }
}

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let timestamp = chrono::Local::now().to_rfc3339();
        let message = panic_payload_message(info);
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();
        let entry = format!(
            "timestamp: {}\nversion: {}\npanic: {}\nlocation: {}\nbacktrace:\n{}",
            timestamp,
            env!("CARGO_PKG_VERSION"),
            message,
            location,
            backtrace
        );

        log::error!("[panic] {}", entry);
        if let Err(e) = append_crash_log(&entry) {
            log::error!("[panic] failed to write crash logs: {}", e);
            eprintln!("failed to write crash logs: {}", e);
        }

        default_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
    detect_startup_crash_report();
    write_session_running_file();

    // Install rustls CryptoProvider before any TLS usage (required by rustls 0.23+)
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(10_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("worktree-manager".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .build(),
        )
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let is_main = window.label() == "main";

                    // Secondary windows: always allow close without confirmation
                    if !is_main {
                        // Let the default close proceed; Destroyed event will handle cleanup
                        return;
                    }

                    // Main window: check global state before closing
                    let terminal_count = {
                        if let Ok(manager) = PTY_MANAGER.lock() {
                            manager.session_count()
                        } else {
                            0
                        }
                    };

                    let share_active = {
                        if let Ok(state) = SHARE_STATE.lock() {
                            state.active
                        } else {
                            false
                        }
                    };

                    if terminal_count > 0 || share_active {
                        api.prevent_close();
                        let window = window.clone();

                        tauri::async_runtime::spawn(async move {
                            use tokio::time::{timeout, Duration};

                            if terminal_count > 0 {
                                use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
                                let (tx, rx) = tokio::sync::oneshot::channel();
                                window
                                    .dialog()
                                    .message(format!(
                                        "有 {} 个活跃终端会话，关闭将终止所有会话。\n\n确定关闭？",
                                        terminal_count
                                    ))
                                    .title("Worktree Manager")
                                    .buttons(MessageDialogButtons::OkCancelCustom(
                                        "关闭".to_string(),
                                        "取消".to_string(),
                                    ))
                                    .show(move |confirmed| {
                                        let _ = tx.send(confirmed);
                                    });
                                // Timeout: force close if dialog doesn't respond within 30s
                                match timeout(Duration::from_secs(30), rx).await {
                                    Ok(Ok(false)) => return,
                                    Ok(Ok(true)) => {} // user confirmed
                                    Ok(Err(_)) => {}   // channel dropped, proceed with close
                                    Err(_) => {
                                        log::warn!(
                                            "Close confirmation dialog timed out, forcing close"
                                        );
                                    }
                                }
                            }

                            if share_active {
                                log::info!("Window closing - stopping sharing first");
                                // Timeout: don't let cleanup block close for more than 5s
                                let cleanup = async {
                                    if let Err(e) = stop_ngrok_tunnel().await {
                                        log::warn!("Failed to stop ngrok tunnel on close: {}", e);
                                    }
                                    if let Err(e) = stop_sharing().await {
                                        log::warn!("Failed to stop sharing on close: {}", e);
                                    }
                                };
                                if timeout(Duration::from_secs(5), cleanup).await.is_err() {
                                    log::warn!("Sharing cleanup timed out, forcing close");
                                } else {
                                    log::info!("Sharing stopped, closing window");
                                }
                            }

                            let _ = window.destroy();
                        });
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    unregister_window_impl(window.label());
                }
                _ => {}
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
            load_workspace_config_by_path,
            save_workspace_config_by_path,
            get_config_path_info,
            // Worktree 操作
            list_worktrees,
            get_main_workspace_status,
            update_worktree_color,
            create_worktree,
            archive_worktree,
            restore_worktree,
            delete_archived_worktree,
            check_worktree_status,
            terminate_worktree_locking_process,
            add_project_to_worktree,
            deploy_to_main,
            exit_main_occupation,
            get_main_occupation,
            // Git 操作
            switch_branch,
            clone_project,
            scan_existing_projects,
            add_existing_project,
            import_external_project,
            remove_project_from_config,
            sync_with_base_branch,
            push_to_remote,
            pull_current_branch,
            merge_to_test_branch,
            merge_to_base_branch,
            get_branch_diff_stats,
            create_pull_request,
            fetch_project_remote,
            check_remote_branch_exists,
            get_remote_branches,
            get_git_diff,
            commit_all,
            sync_all_projects_to_base,
            get_changed_files,
            get_file_diff,
            generate_commit_message,
            // 工具
            open_in_terminal,
            open_in_editor,
            open_log_dir,
            reveal_in_finder,
            detect_tools,
            frontend_log,
            set_git_path,
            get_app_icon,
            get_crash_report,
            get_app_version,
            // 多窗口管理
            set_window_workspace,
            get_opened_workspaces,
            unregister_window,
            open_workspace_window,
            lock_worktree,
            unlock_worktree,
            get_locked_worktrees,
            broadcast_terminal_state,
            get_terminal_state,
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
            get_connected_clients,
            kick_client,
            // ngrok
            get_ngrok_token,
            set_ngrok_token,
            get_last_share_port,
            get_last_share_password,
            start_ngrok_tunnel,
            stop_ngrok_tunnel,
            // 语音识别 (Dashscope)
            get_dashscope_api_key,
            set_dashscope_api_key,
            get_dashscope_base_url,
            set_dashscope_base_url,
            get_voice_refine_enabled,
            set_voice_refine_enabled,
            get_voice_refine_base_url,
            set_voice_refine_base_url,
            get_voice_asr_model,
            set_voice_asr_model,
            get_voice_refine_model,
            set_voice_refine_model,
            list_dashscope_models,
            check_dashscope_api_key,
            get_commit_ai_api_key,
            set_commit_ai_api_key,
            set_commit_ai_enabled,
            get_commit_ai_enabled,
            check_commit_ai_api_key,
            voice_start,
            voice_send_audio,
            voice_stop,
            voice_is_active,
            voice_refine_text,
            // 提交前缀配置
            get_commit_prefix_config,
            set_commit_prefix_config,
            // Git 用户全局配置
            get_git_user_global_config,
            set_git_user_global_config,
            // Git hooks 跳过配置
            get_skip_git_hooks,
            set_skip_git_hooks,
            // Shell Integration 配置
            get_shell_integration_enabled,
            set_shell_integration_enabled,
            // Git 用户本地配置
            get_git_user_config,
            set_git_user_config,
            // 更新镜像
            check_mirror_update,
            download_update_via_mirror,
            test_mirror_speed,
            speed_test_single_mirror,
            get_mirror_sources,
            save_custom_mirrors,
            // DevTools
            open_devtools,
            // Vault
            vault_status,
            vault_link,
            list_vault_item_children,
            // 云端连接
            cloud_get_status,
            cloud_start_pairing,
            cloud_check_pairing_status,
            cloud_approve_pairing,
            cloud_reject_pairing,
            cloud_disconnect,
        ])
        .setup(|app| {
            use tauri::Manager;
            // Initialize APP_HANDLE for use in WebSocket handlers
            *APP_HANDLE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(app.handle().clone());

            // Initialize shell integration scripts
            let resource_dir = app.path().resource_dir().ok().or_else(|| {
                // Dev mode fallback: resource_dir() is unavailable, use src-tauri/ directly
                let dev_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                log::info!("[setup] Using dev resource_dir: {:?}", dev_dir);
                Some(dev_dir)
            });
            if let Some(dir) = resource_dir {
                pty_manager::init_shell_integration(dir);
            }

            // Start MCP server on the port expected by @worktree-manager/mcp.
            let mcp_port = 42819;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http_server::start_mcp_server(mcp_port).await {
                    log::error!("[MCP] Server failed: {}", e);
                }
            });

            log::info!(
                "=== app started, version {}, os {}/{} ===",
                env!("CARGO_PKG_VERSION"),
                std::env::consts::OS,
                std::env::consts::ARCH
            );

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, event| {
        if let tauri::RunEvent::Exit = event {
            log::info!("=== app exiting normally ===");
            remove_session_running_file();
        }
    });
}

#[cfg(test)]
mod crash_report_tests {
    use serial_test::serial;
    use std::fs;
    use std::panic::{self, AssertUnwindSafe};
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::Duration;

    static PANIC_HOOK_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn temp_log_dir(test_name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "worktree-manager-{}-{}",
            test_name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn capture_panic_payload_message<F>(panic_fn: F) -> String
    where
        F: FnOnce() + panic::UnwindSafe,
    {
        let _guard = PANIC_HOOK_MUTEX
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous_hook = panic::take_hook();
        let (tx, rx) = mpsc::channel();

        panic::set_hook(Box::new(move |info| {
            let _ = tx.send(super::panic_payload_message(info));
        }));

        let result = panic::catch_unwind(AssertUnwindSafe(panic_fn));
        panic::set_hook(previous_hook);

        assert!(result.is_err());
        rx.recv_timeout(Duration::from_secs(1))
            .expect("panic hook should capture payload message")
    }

    #[serial]
    #[test]
    fn startup_crash_report_reads_previous_session_and_consumes_error_log() {
        let dir = temp_log_dir("startup-crash-report");
        fs::write(
            dir.join("session.running"),
            "timestamp: old\nversion: 0.1.2\npid: 4294967295",
        )
        .unwrap();
        fs::write(dir.join("worktree-manager-err.log"), "panic detail").unwrap();

        let report = super::take_startup_crash_report(&dir).unwrap();

        assert!(report.abnormal_exit);
        assert_eq!(
            report.previous_session_info.as_deref(),
            Some("timestamp: old\nversion: 0.1.2\npid: 4294967295")
        );
        assert_eq!(report.crash_detail.as_deref(), Some("panic detail"));
        assert!(!dir.join("worktree-manager-err.log").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[serial]
    #[test]
    fn startup_crash_report_reports_marker_without_error_detail() {
        let temp = tempfile::tempdir().expect("create temp crash dir");
        fs::write(
            temp.path().join("session.running"),
            "timestamp: old\nversion: 0.1.2\npid: 4294967295\n",
        )
        .unwrap();

        let report = super::take_startup_crash_report(temp.path()).unwrap();

        assert!(report.abnormal_exit);
        assert_eq!(
            report.previous_session_info.as_deref(),
            Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n")
        );
        assert_eq!(report.crash_detail, None);
    }

    #[serial]
    #[test]
    fn startup_crash_report_skips_marker_when_pid_is_still_running() {
        let dir = temp_log_dir("startup-running-pid");
        fs::write(
            dir.join("session.running"),
            format!(
                "timestamp: old\nversion: 0.1.2\npid: {}\n",
                std::process::id()
            ),
        )
        .unwrap();
        fs::write(dir.join("worktree-manager-err.log"), "panic detail").unwrap();

        assert!(super::take_startup_crash_report(&dir).is_none());
        assert!(dir.join("worktree-manager-err.log").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[serial]
    #[test]
    fn startup_crash_report_clears_stale_error_log_without_marker() {
        let dir = temp_log_dir("startup-stale-error");
        fs::write(dir.join("worktree-manager-err.log"), "stale panic detail").unwrap();

        assert!(super::take_startup_crash_report(&dir).is_none());
        assert!(!dir.join("worktree-manager-err.log").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[serial]
    #[test]
    fn startup_crash_report_without_marker_and_without_error_log_returns_none() {
        let temp = tempfile::tempdir().expect("create temp crash dir");

        assert!(super::take_startup_crash_report(temp.path()).is_none());
    }

    #[serial]
    #[test]
    fn session_marker_contains_timestamp_version_and_pid() {
        let dir = temp_log_dir("session-marker");

        super::write_session_running_file_at(&dir).unwrap();
        let contents = fs::read_to_string(dir.join("session.running")).unwrap();

        assert!(contents.contains("timestamp: "));
        assert!(contents.contains("version: "));
        assert!(contents.contains("pid: "));

        let _ = fs::remove_dir_all(&dir);
    }

    #[serial]
    #[test]
    fn parse_session_marker_pid_reads_pid_line() {
        assert_eq!(
            super::parse_session_marker_pid("timestamp: old\nversion: 1.0\npid: 4242\n"),
            Some(4242)
        );
    }

    #[serial]
    #[test]
    fn parse_session_marker_pid_trims_pid_value_and_ignores_blank_content() {
        assert_eq!(super::parse_session_marker_pid(""), None);
        assert_eq!(super::parse_session_marker_pid("   \n\t\n"), None);
        assert_eq!(
            super::parse_session_marker_pid("timestamp: old\npid:   9876  \n"),
            Some(9876)
        );
    }

    #[serial]
    #[test]
    fn parse_session_marker_pid_rejects_missing_or_invalid_pid() {
        assert_eq!(super::parse_session_marker_pid("timestamp: old"), None);
        assert_eq!(
            super::parse_session_marker_pid("timestamp: old\npid: not-a-number\n"),
            None
        );
        assert_eq!(super::parse_session_marker_pid(" pid: 123\n"), None);
    }

    #[serial]
    #[test]
    fn crash_log_dir_returns_a_platform_path() {
        let path = super::crash_log_dir().expect("crash log directory should resolve");

        assert!(
            path.to_string_lossy().contains("com.guo.worktree-manager"),
            "unexpected crash log path: {:?}",
            path
        );
    }

    #[serial]
    #[test]
    fn remove_session_running_file_at_deletes_marker_and_ignores_missing_marker() {
        let temp = tempfile::tempdir().expect("create temp crash dir");
        let marker = temp.path().join("session.running");
        fs::write(&marker, "pid: 4294967295\n").expect("write marker");

        super::remove_session_running_file_at(temp.path()).expect("remove existing marker");
        assert!(!marker.exists());

        super::remove_session_running_file_at(temp.path()).expect("missing marker is ok");
    }

    #[serial]
    #[test]
    fn panic_payload_message_handles_str_string_and_unknown_payloads() {
        assert_eq!(
            capture_panic_payload_message(|| panic::panic_any("borrowed payload")),
            "borrowed payload"
        );
        assert_eq!(
            capture_panic_payload_message(|| panic::panic_any(String::from("owned payload"))),
            "owned payload"
        );
        assert_eq!(
            capture_panic_payload_message(|| panic::panic_any(123_u32)),
            "<non-string panic payload>"
        );
    }
}

#[cfg(test)]
mod crash_report_coverage_completion_tests {
    use serial_test::serial;
    use std::fs;

    #[serial]
    #[test]
    fn pending_error_log_read_is_consuming_and_idempotent() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let pending = temp.path().join("worktree-manager-err.log");
        fs::write(&pending, "panic detail").expect("write pending error log");

        let first = super::read_and_clear_pending_error_log(temp.path());
        let second = super::read_and_clear_pending_error_log(temp.path());

        assert_eq!(first.as_deref(), Some("panic detail"));
        assert_eq!(second, None);
        assert!(!pending.exists());
    }

    #[serial]
    #[test]
    fn session_running_contents_contains_parseable_current_pid() {
        let contents = super::session_running_contents();

        assert_eq!(
            super::parse_session_marker_pid(&contents),
            Some(std::process::id())
        );
        assert!(contents.contains(env!("CARGO_PKG_VERSION")));
    }

    #[serial]
    #[test]
    fn pending_crash_report_mutex_stores_and_restores_report() {
        let mut pending = super::pending_crash_report()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = pending.take();
        *pending = Some(super::CrashReport {
            abnormal_exit: true,
            crash_detail: Some("detail".to_string()),
            previous_session_info: Some("pid: 4294967295".to_string()),
        });

        let report = pending.as_ref().expect("pending report");
        assert!(report.abnormal_exit);
        assert_eq!(report.crash_detail.as_deref(), Some("detail"));
        assert_eq!(
            report.previous_session_info.as_deref(),
            Some("pid: 4294967295")
        );

        *pending = previous;
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[serial]
    #[test]
    fn process_running_detects_current_pid_and_rejects_impossible_pid() {
        assert_eq!(super::is_process_running(std::process::id()), Some(true));
        assert_eq!(super::is_process_running(u32::MAX), Some(false));
    }

    #[serial]
    #[test]
    fn startup_crash_report_handles_marker_without_pid_line() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        fs::write(
            temp.path().join("session.running"),
            "timestamp: old\nversion: 0.1.2\n",
        )
        .expect("write marker");
        fs::write(temp.path().join("worktree-manager-err.log"), "detail").expect("write detail");

        let report = super::take_startup_crash_report(temp.path()).expect("crash report");

        assert!(report.abnormal_exit);
        assert_eq!(
            report.previous_session_info.as_deref(),
            Some("timestamp: old\nversion: 0.1.2\n")
        );
        assert_eq!(report.crash_detail.as_deref(), Some("detail"));
        assert!(!temp.path().join("worktree-manager-err.log").exists());
    }

    #[serial]
    #[test]
    fn remove_session_running_file_at_reports_non_file_marker_errors() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        fs::create_dir(temp.path().join("session.running")).expect("create marker directory");

        let err = super::remove_session_running_file_at(temp.path())
            .expect_err("directory marker cannot be removed as a file");

        assert_ne!(err.kind(), std::io::ErrorKind::NotFound);
        assert!(temp.path().join("session.running").is_dir());
    }

    #[serial]
    #[test]
    fn parse_session_marker_pid_accepts_later_valid_pid_after_invalid_lines() {
        assert_eq!(
            super::parse_session_marker_pid("pid: nope\ntimestamp: old\npid: 4242\n"),
            Some(4242)
        );
    }

    #[serial]
    #[test]
    fn parse_session_marker_pid_rejects_signed_and_overflow_values() {
        assert_eq!(super::parse_session_marker_pid("pid: -1\n"), None);
        assert_eq!(super::parse_session_marker_pid("pid: 4294967296\n"), None);
    }

    #[serial]
    #[test]
    fn pending_error_log_read_returns_none_when_parent_is_missing() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let missing = temp.path().join("missing-parent");

        assert_eq!(super::read_and_clear_pending_error_log(&missing), None);
        assert!(!missing.exists());
    }

    #[serial]
    #[test]
    fn pending_error_log_directory_is_left_in_place() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let pending = temp.path().join("worktree-manager-err.log");
        fs::create_dir(&pending).expect("create pending error directory");

        assert_eq!(super::read_and_clear_pending_error_log(temp.path()), None);
        assert!(pending.is_dir());
    }

    #[serial]
    #[test]
    fn write_session_running_file_at_creates_missing_parent_dirs() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let nested = temp.path().join("nested").join("logs");

        super::write_session_running_file_at(&nested).expect("write nested marker");

        let marker = fs::read_to_string(nested.join("session.running")).expect("read marker");
        assert_eq!(
            super::parse_session_marker_pid(&marker),
            Some(std::process::id())
        );
    }

    #[serial]
    #[test]
    fn startup_crash_report_handles_directory_marker_without_session_text() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        fs::create_dir(temp.path().join("session.running")).expect("create marker directory");
        fs::write(
            temp.path().join("worktree-manager-err.log"),
            "directory marker detail",
        )
        .expect("write detail");

        let report = super::take_startup_crash_report(temp.path()).expect("crash report");

        assert!(report.abnormal_exit);
        assert_eq!(report.previous_session_info, None);
        assert_eq!(
            report.crash_detail.as_deref(),
            Some("directory marker detail")
        );
        assert!(!temp.path().join("worktree-manager-err.log").exists());
    }

    #[serial]
    #[test]
    fn pending_error_log_read_preserves_multiline_detail() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let detail = "timestamp: old\npanic: boom\nbacktrace:\nframe 1\n";
        fs::write(temp.path().join("worktree-manager-err.log"), detail).expect("write detail");

        let read = super::read_and_clear_pending_error_log(temp.path());

        assert_eq!(read.as_deref(), Some(detail));
        assert!(!temp.path().join("worktree-manager-err.log").exists());
    }

    #[serial]
    #[test]
    fn startup_crash_report_with_invalid_pid_consumes_error_log() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let marker = "timestamp: old\nversion: 0.1.2\npid: invalid\n";
        fs::write(temp.path().join("session.running"), marker).expect("write marker");
        fs::write(
            temp.path().join("worktree-manager-err.log"),
            "invalid pid detail",
        )
        .expect("write detail");

        let report = super::take_startup_crash_report(temp.path()).expect("crash report");

        assert!(report.abnormal_exit);
        assert_eq!(report.previous_session_info.as_deref(), Some(marker));
        assert_eq!(report.crash_detail.as_deref(), Some("invalid pid detail"));
        assert!(!temp.path().join("worktree-manager-err.log").exists());
    }

    #[serial]
    #[test]
    fn startup_crash_report_with_empty_marker_keeps_empty_session_info() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        fs::write(temp.path().join("session.running"), "").expect("write empty marker");

        let report = super::take_startup_crash_report(temp.path()).expect("crash report");

        assert!(report.abnormal_exit);
        assert_eq!(report.previous_session_info.as_deref(), Some(""));
        assert_eq!(report.crash_detail, None);
    }

    #[serial]
    #[test]
    fn startup_crash_report_without_marker_consumes_multiline_stale_error() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let pending = temp.path().join("worktree-manager-err.log");
        fs::write(&pending, "stale\nmultiline\nerror\n").expect("write stale detail");

        assert!(super::take_startup_crash_report(temp.path()).is_none());
        assert!(!pending.exists());
    }

    #[serial]
    #[test]
    fn write_session_running_file_at_overwrites_existing_marker() {
        let temp = tempfile::tempdir().expect("create crash temp dir");
        let marker_path = temp.path().join("session.running");
        fs::write(&marker_path, "old marker").expect("write old marker");

        super::write_session_running_file_at(temp.path()).expect("overwrite marker");
        let marker = fs::read_to_string(marker_path).expect("read marker");

        assert_ne!(marker, "old marker");
        assert_eq!(
            super::parse_session_marker_pid(&marker),
            Some(std::process::id())
        );
    }

    #[serial]
    #[test]
    fn session_running_contents_has_timestamp_version_pid_lines_in_order() {
        let contents = super::session_running_contents();
        let lines: Vec<&str> = contents.lines().collect();

        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with("timestamp: "), "{contents}");
        assert_eq!(lines[1], format!("version: {}", env!("CARGO_PKG_VERSION")));
        assert_eq!(lines[2], format!("pid: {}", std::process::id()));
    }

    #[serial]
    #[test]
    fn append_crash_log_writes_append_log_and_pending_detail_under_temp_home() {
        let temp_home = tempfile::tempdir().expect("create temp home");
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("HOME", temp_home.path());

        let first_entry = "timestamp: first\npanic: one";
        let second_entry = "timestamp: second\npanic: two";
        super::append_crash_log(first_entry).expect("append first crash log entry");
        super::append_crash_log(second_entry).expect("append second crash log entry");

        let log_dir = super::crash_log_dir().expect("crash dir from temp home");
        let crash_log = fs::read_to_string(log_dir.join("crash.log")).expect("read crash log");
        let pending =
            fs::read_to_string(log_dir.join("worktree-manager-err.log")).expect("read pending log");

        assert!(crash_log.contains(first_entry));
        assert!(crash_log.contains(second_entry));
        assert_eq!(pending, second_entry);
        assert!(log_dir.starts_with(temp_home.path()));

        match previous_home {
            Some(home) => std::env::set_var("HOME", home),
            None => std::env::remove_var("HOME"),
        }
    }

    #[serial]
    #[test]
    fn detect_write_and_remove_session_marker_use_configured_crash_dir() {
        let temp_home = tempfile::tempdir().expect("create temp home");
        let previous_home = std::env::var_os("HOME");
        std::env::set_var("HOME", temp_home.path());
        let pending = super::pending_crash_report();
        let previous_pending = {
            let mut guard = pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.take()
        };

        super::detect_startup_crash_report();
        assert!(pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_none());

        super::write_session_running_file();
        let log_dir = super::crash_log_dir().expect("crash dir");
        let marker_path = log_dir.join("session.running");
        let marker = fs::read_to_string(&marker_path).expect("session marker exists");
        assert_eq!(
            super::parse_session_marker_pid(&marker),
            Some(std::process::id())
        );

        super::remove_session_running_file();
        assert!(!marker_path.exists());
        super::remove_session_running_file();
        assert!(!marker_path.exists());

        *pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = previous_pending;
        match previous_home {
            Some(home) => std::env::set_var("HOME", home),
            None => std::env::remove_var("HOME"),
        }
    }

    #[serial]
    #[test]
    fn crash_report_marker_matrix_handles_stale_sessions_and_error_details() {
        let cases = [
            (
                "marker-with-detail",
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                Some("panic detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                Some("panic detail"),
            ),
            (
                "marker-without-detail",
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                None,
                true,
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                None,
            ),
            (
                "marker-with-invalid-pid",
                Some("timestamp: old\nversion: 0.1.2\npid: invalid\n"),
                Some("invalid pid detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid: invalid\n"),
                Some("invalid pid detail"),
            ),
            (
                "marker-with-overflow-pid",
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967296\n"),
                Some("overflow pid detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967296\n"),
                Some("overflow pid detail"),
            ),
            (
                "marker-with-negative-pid",
                Some("timestamp: old\nversion: 0.1.2\npid: -1\n"),
                Some("negative pid detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid: -1\n"),
                Some("negative pid detail"),
            ),
            (
                "marker-with-empty-pid",
                Some("timestamp: old\nversion: 0.1.2\npid:\n"),
                Some("empty pid detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid:\n"),
                Some("empty pid detail"),
            ),
            (
                "marker-with-spaced-pid",
                Some("timestamp: old\nversion: 0.1.2\npid:   4294967295  \n"),
                Some("spaced pid detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid:   4294967295  \n"),
                Some("spaced pid detail"),
            ),
            (
                "marker-with-later-valid-pid",
                Some("pid: invalid\ntimestamp: old\npid: 4294967295\n"),
                Some("later pid detail"),
                true,
                Some("pid: invalid\ntimestamp: old\npid: 4294967295\n"),
                Some("later pid detail"),
            ),
            (
                "marker-with-leading-space-pid",
                Some("timestamp: old\n pid: 4294967295\n"),
                Some("leading space detail"),
                true,
                Some("timestamp: old\n pid: 4294967295\n"),
                Some("leading space detail"),
            ),
            (
                "marker-with-no-pid",
                Some("timestamp: old\nversion: 0.1.2\n"),
                Some("missing pid detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\n"),
                Some("missing pid detail"),
            ),
            ("marker-empty", Some(""), None, true, Some(""), None),
            (
                "marker-empty-with-detail",
                Some(""),
                Some("empty marker detail"),
                true,
                Some(""),
                Some("empty marker detail"),
            ),
            (
                "marker-multiline-detail",
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                Some("timestamp: old\npanic: boom\nbacktrace:\nframe 1\n"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                Some("timestamp: old\npanic: boom\nbacktrace:\nframe 1\n"),
            ),
            (
                "marker-unicode-detail",
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                Some("panic: non-ascii detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\npid: 4294967295\n"),
                Some("panic: non-ascii detail"),
            ),
            (
                "no-marker-with-detail",
                None,
                Some("stale detail"),
                false,
                None,
                None,
            ),
            ("no-marker-without-detail", None, None, false, None, None),
            (
                "marker-with-zero-like-invalid-prefix",
                Some("timestamp: old\npid : 4294967295\n"),
                Some("wrong prefix detail"),
                true,
                Some("timestamp: old\npid : 4294967295\n"),
                Some("wrong prefix detail"),
            ),
            (
                "marker-with-tabbed-pid",
                Some("timestamp: old\npid:\t4294967295\n"),
                Some("tab pid detail"),
                true,
                Some("timestamp: old\npid:\t4294967295\n"),
                Some("tab pid detail"),
            ),
            (
                "marker-with-extra-fields",
                Some("timestamp: old\nversion: 0.1.2\nbranch: main\npid: 4294967295\n"),
                Some("extra field detail"),
                true,
                Some("timestamp: old\nversion: 0.1.2\nbranch: main\npid: 4294967295\n"),
                Some("extra field detail"),
            ),
            (
                "marker-with-trailing-text",
                Some("timestamp: old\npid: 4294967295\nstatus: interrupted\n"),
                Some("trailing detail"),
                true,
                Some("timestamp: old\npid: 4294967295\nstatus: interrupted\n"),
                Some("trailing detail"),
            ),
        ];

        for (name, marker, detail, expect_report, expected_session, expected_detail) in cases {
            let temp = tempfile::tempdir().expect("create crash temp dir");
            let pending_path = temp.path().join("worktree-manager-err.log");
            if let Some(marker) = marker {
                fs::write(temp.path().join("session.running"), marker)
                    .unwrap_or_else(|err| panic!("{name}: write marker: {err}"));
            }
            if let Some(detail) = detail {
                fs::write(&pending_path, detail)
                    .unwrap_or_else(|err| panic!("{name}: write pending detail: {err}"));
            }

            let report = super::take_startup_crash_report(temp.path());

            if expect_report {
                let report = report.unwrap_or_else(|| panic!("{name}: expected report"));
                assert!(report.abnormal_exit, "{name}");
                assert_eq!(
                    report.previous_session_info.as_deref(),
                    expected_session,
                    "{name}"
                );
                assert_eq!(report.crash_detail.as_deref(), expected_detail, "{name}");
                assert!(
                    !pending_path.exists(),
                    "{name}: pending detail should be consumed"
                );
            } else {
                assert!(report.is_none(), "{name}: expected no report");
                assert!(
                    !pending_path.exists(),
                    "{name}: stale detail should be consumed"
                );
            }
        }
    }
}
