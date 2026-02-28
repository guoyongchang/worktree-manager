mod commands;
pub mod config;
mod git_ops;
pub mod http_server;
mod pty_manager;
pub mod state;
pub(crate) mod tls;
pub mod types;
pub mod utils;
pub(crate) mod wms_tunnel;

// Re-exports used by http_server and other modules
pub use config::*;
pub(crate) use state::*;
pub use types::*;
pub use utils::normalize_path;

// Re-exports of _impl functions used by http_server
pub use commands::git::{clone_project_impl, switch_branch_internal};
pub use commands::sharing::{
    auto_register_tunnel_internal, kick_client_internal, start_ngrok_tunnel_internal,
    start_wms_tunnel_internal, stop_wms_tunnel_internal, wms_manual_reconnect_internal, WmsConfig,
};
pub use commands::system::{
    open_in_editor_internal, open_in_terminal_internal, open_log_dir_internal,
    reveal_in_finder_internal,
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
};

use commands::git::*;
use commands::pty::*;
use commands::sharing::*;
use commands::system::*;
use commands::voice::*;
use commands::window::*;
use commands::workspace::*;
use commands::worktree::*;

// ==================== Tauri 入口 ====================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install rustls CryptoProvider before any TLS usage (required by rustls 0.23+)
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                )])
                .build(),
        )
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Check if sharing is active and stop it before closing
                    let share_active = {
                        if let Ok(state) = SHARE_STATE.lock() {
                            state.active
                        } else {
                            false
                        }
                    };

                    if share_active {
                        // Prevent immediate close
                        api.prevent_close();

                        // Clone window for async task
                        let window = window.clone();

                        // Stop sharing in background, then close window
                        tauri::async_runtime::spawn(async move {
                            log::info!("Window closing - stopping sharing first");

                            // Stop ngrok tunnel
                            if let Err(e) = stop_ngrok_tunnel().await {
                                log::warn!("Failed to stop ngrok tunnel on close: {}", e);
                            }

                            // Stop WMS tunnel
                            if let Err(e) = stop_wms_tunnel().await {
                                log::warn!("Failed to stop WMS tunnel on close: {}", e);
                            }

                            // Stop sharing
                            if let Err(e) = stop_sharing().await {
                                log::warn!("Failed to stop sharing on close: {}", e);
                            }

                            log::info!("Sharing stopped, closing window");

                            // Now close the window
                            let _ = window.close();
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
            create_worktree,
            archive_worktree,
            restore_worktree,
            delete_archived_worktree,
            check_worktree_status,
            add_project_to_worktree,
            deploy_to_main,
            exit_main_occupation,
            get_main_occupation,
            // Git 操作
            switch_branch,
            clone_project,
            sync_with_base_branch,
            push_to_remote,
            merge_to_test_branch,
            merge_to_base_branch,
            get_branch_diff_stats,
            create_pull_request,
            fetch_project_remote,
            check_remote_branch_exists,
            get_remote_branches,
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
            // WMS 隧道
            get_wms_config,
            set_wms_config,
            auto_register_tunnel,
            start_wms_tunnel,
            stop_wms_tunnel,
            wms_manual_reconnect,
            // 语音识别 (Dashscope)
            get_dashscope_api_key,
            set_dashscope_api_key,
            get_dashscope_base_url,
            set_dashscope_base_url,
            get_voice_refine_enabled,
            set_voice_refine_enabled,
            voice_start,
            voice_send_audio,
            voice_stop,
            voice_is_active,
            voice_refine_text,
            // DevTools
            open_devtools,
        ])
        .setup(|app| {
            // Initialize APP_HANDLE for use in WebSocket handlers
            *APP_HANDLE.lock().unwrap() = Some(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
