use axum::{
    http::{header, HeaderValue, Method},
    routing::{get, post},
    Extension, Router,
};
use std::{path::PathBuf, sync::Arc};
use tower_http::cors::CorsLayer;

use super::{
    h_add_existing_project, h_add_project_to_worktree, h_add_workspace, h_archive_worktree,
    h_auth_challenge, h_auth_verify, h_broadcast_terminal_state, h_cert_pem, h_check_mirror_update,
    h_check_remote_branch_exists, h_check_worktree_status, h_clone_project, h_commit_all,
    h_create_pull_request, h_create_workspace, h_create_worktree, h_delete_archived_worktree,
    h_deploy_to_main, h_detect_tools, h_download_update_via_mirror, h_exit_main_occupation,
    h_fetch_project_remote, h_generate_commit_message, h_get_app_icon, h_get_app_version,
    h_get_branch_diff_stats, h_get_changed_files, h_get_config_path_info, h_get_connected_clients,
    h_get_current_workspace, h_get_dashscope_api_key, h_get_dashscope_base_url, h_get_file_diff,
    h_get_git_diff, h_get_last_share_password, h_get_last_share_port, h_get_locked_worktrees,
    h_get_main_occupation, h_get_main_workspace_status, h_get_ngrok_token, h_get_opened_workspaces,
    h_get_remote_branches, h_get_share_info, h_get_share_state, h_get_terminal_state,
    h_get_voice_refine_enabled, h_get_workspace_config, h_kick_client, h_list_workspaces,
    h_list_worktrees, h_load_workspace_config_by_path, h_lock_worktree, h_merge_to_base_branch,
    h_merge_to_test_branch, h_open_devtools, h_open_in_editor, h_open_in_terminal, h_open_log_dir,
    h_open_workspace_window, h_pty_close, h_pty_close_by_path, h_pty_create, h_pty_exists,
    h_pty_read, h_pty_resize, h_pty_write, h_push_to_remote, h_remove_project_from_config,
    h_remove_workspace, h_restore_worktree, h_reveal_in_finder, h_save_workspace_config,
    h_save_workspace_config_by_path, h_scan_existing_projects, h_scan_linked_folders,
    h_set_dashscope_api_key, h_set_dashscope_base_url, h_set_git_path, h_set_ngrok_token,
    h_set_voice_refine_enabled, h_set_window_workspace, h_start_ngrok_tunnel, h_start_sharing,
    h_stop_ngrok_tunnel, h_stop_sharing, h_switch_branch, h_switch_workspace,
    h_sync_with_base_branch, h_unlock_worktree, h_unregister_window, h_update_share_password,
    h_voice_is_active, h_voice_refine_text, h_voice_send_audio, h_voice_start, h_voice_stop,
    h_ws_upgrade, is_allowed_origin, load_mcp_config, save_mcp_config, McpConfig,
    h_vault_status, h_vault_link, h_list_vault_item_children,
};

pub(super) fn build_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(
            |origin: &HeaderValue, _| origin.to_str().is_ok_and(is_allowed_origin),
        ))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::HeaderName::from_static("x-session-id"),
        ])
}

pub(super) fn resolve_dist_path() -> PathBuf {
    if cfg!(debug_assertions) {
        let dev_dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
        log::info!("Using dev dist path: {:?}", dev_dist);
        return dev_dist;
    }

    std::env::current_exe()
        .ok()
        .and_then(|exe| {
            let exe_dir = exe.parent()?;
            if cfg!(target_os = "macos") {
                if let Some(contents_dir) = exe_dir.parent() {
                    if contents_dir.file_name().and_then(|n| n.to_str()) == Some("Contents") {
                        let resources_dist = contents_dir.join("Resources").join("dist");
                        if resources_dist.exists() {
                            log::info!("Using dist path from app bundle: {:?}", resources_dist);
                            return Some(resources_dist);
                        }
                    }
                }
            }
            let exe_dist = exe_dir.join("dist");
            if exe_dist.exists() {
                log::info!("Using dist path next to executable: {:?}", exe_dist);
                return Some(exe_dist);
            }
            None
        })
        .unwrap_or_else(|| {
            let fallback = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
            log::info!("Using fallback dist path: {:?}", fallback);
            fallback
        })
}

// MCP handlers
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub async fn h_mcp_config() -> Response {
    match load_mcp_config() {
        Some(config) => (StatusCode::OK, Json(json!(config))).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "MCP not configured"})),
        )
            .into_response(),
    }
}

pub async fn h_set_mcp_capability(Json(payload): Json<serde_json::Value>) -> Response {
    let level = match payload.get("capability_level").and_then(|v| v.as_str()) {
        Some(l) if matches!(l, "core" | "details" | "advanced") => l,
        _ => return (StatusCode::BAD_REQUEST, "Invalid capability level").into_response(),
    };

    let mut config = load_mcp_config().unwrap_or(McpConfig {
        version: env!("CARGO_PKG_VERSION").to_string(),
        http_port: 42819,
        installed_at: chrono::Utc::now().to_rfc3339(),
        capability_level: "core".to_string(),
    });

    config.capability_level = level.to_string();

    match save_mcp_config(&config) {
        Ok(()) => (StatusCode::OK, Json(json!({"success": true}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

pub(super) fn build_api_router(cert_pem: Option<String>) -> Router {
    let mut router = Router::new()
        .route("/api/list_workspaces", post(h_list_workspaces))
        .route("/api/add_workspace", post(h_add_workspace))
        .route("/api/remove_workspace", post(h_remove_workspace))
        .route("/api/create_workspace", post(h_create_workspace))
        .route("/api/set_window_workspace", post(h_set_window_workspace))
        .route("/api/get_current_workspace", post(h_get_current_workspace))
        .route("/api/switch_workspace", post(h_switch_workspace))
        .route("/api/get_workspace_config", post(h_get_workspace_config))
        .route("/api/save_workspace_config", post(h_save_workspace_config))
        .route(
            "/api/load_workspace_config_by_path",
            post(h_load_workspace_config_by_path),
        )
        .route(
            "/api/save_workspace_config_by_path",
            post(h_save_workspace_config_by_path),
        )
        .route("/api/get_config_path_info", post(h_get_config_path_info))
        .route("/api/list_worktrees", post(h_list_worktrees))
        .route(
            "/api/get_main_workspace_status",
            post(h_get_main_workspace_status),
        )
        .route("/api/create_worktree", post(h_create_worktree))
        .route("/api/archive_worktree", post(h_archive_worktree))
        .route("/api/check_worktree_status", post(h_check_worktree_status))
        .route("/api/restore_worktree", post(h_restore_worktree))
        .route(
            "/api/delete_archived_worktree",
            post(h_delete_archived_worktree),
        )
        .route(
            "/api/add_project_to_worktree",
            post(h_add_project_to_worktree),
        )
        .route("/api/deploy_to_main", post(h_deploy_to_main))
        .route("/api/exit_main_occupation", post(h_exit_main_occupation))
        .route("/api/get_main_occupation", post(h_get_main_occupation))
        .route("/api/switch_branch", post(h_switch_branch))
        .route("/api/clone_project", post(h_clone_project))
        .route(
            "/api/scan_existing_projects",
            post(h_scan_existing_projects),
        )
        .route("/api/add_existing_project", post(h_add_existing_project))
        .route(
            "/api/remove_project_from_config",
            post(h_remove_project_from_config),
        )
        .route("/api/get_branch_diff_stats", post(h_get_branch_diff_stats))
        .route(
            "/api/check_remote_branch_exists",
            post(h_check_remote_branch_exists),
        )
        .route("/api/fetch_project_remote", post(h_fetch_project_remote))
        .route("/api/sync_with_base_branch", post(h_sync_with_base_branch))
        .route("/api/push_to_remote", post(h_push_to_remote))
        .route("/api/merge_to_test_branch", post(h_merge_to_test_branch))
        .route("/api/merge_to_base_branch", post(h_merge_to_base_branch))
        .route("/api/create_pull_request", post(h_create_pull_request))
        .route("/api/get_remote_branches", post(h_get_remote_branches))
        .route("/api/get_git_diff", post(h_get_git_diff))
        .route("/api/commit_all", post(h_commit_all))
        .route("/api/get_changed_files", post(h_get_changed_files))
        .route("/api/get_file_diff", post(h_get_file_diff))
        .route(
            "/api/generate_commit_message",
            post(h_generate_commit_message),
        )
        .route("/api/scan_linked_folders", post(h_scan_linked_folders))
        .route("/api/open_in_terminal", post(h_open_in_terminal))
        .route("/api/open_in_editor", post(h_open_in_editor))
        .route("/api/reveal_in_finder", post(h_reveal_in_finder))
        .route("/api/open_log_dir", post(h_open_log_dir))
        .route("/api/detect_tools", post(h_detect_tools))
        .route("/api/set_git_path", post(h_set_git_path))
        .route("/api/get_opened_workspaces", post(h_get_opened_workspaces))
        .route("/api/unregister_window", post(h_unregister_window))
        .route("/api/lock_worktree", post(h_lock_worktree))
        .route("/api/unlock_worktree", post(h_unlock_worktree))
        .route("/api/get_locked_worktrees", post(h_get_locked_worktrees))
        .route(
            "/api/broadcast_terminal_state",
            post(h_broadcast_terminal_state),
        )
        .route("/api/get_terminal_state", post(h_get_terminal_state))
        .route("/api/open_workspace_window", post(h_open_workspace_window))
        .route("/api/pty_create", post(h_pty_create))
        .route("/api/pty_write", post(h_pty_write))
        .route("/api/pty_read", post(h_pty_read))
        .route("/api/pty_resize", post(h_pty_resize))
        .route("/api/pty_close", post(h_pty_close))
        .route("/api/pty_exists", post(h_pty_exists))
        .route("/api/pty_close_by_path", post(h_pty_close_by_path))
        .route("/api/auth/challenge", post(h_auth_challenge))
        .route("/api/auth/verify", post(h_auth_verify))
        .route("/api/get_share_info", get(h_get_share_info))
        .route("/api/start_sharing", post(h_start_sharing))
        .route("/api/stop_sharing", post(h_stop_sharing))
        .route("/api/get_share_state", post(h_get_share_state))
        .route("/api/update_share_password", post(h_update_share_password))
        .route("/api/get_connected_clients", post(h_get_connected_clients))
        .route("/api/kick_client", post(h_kick_client))
        .route("/api/get_ngrok_token", post(h_get_ngrok_token))
        .route("/api/set_ngrok_token", post(h_set_ngrok_token))
        .route("/api/get_last_share_port", post(h_get_last_share_port))
        .route(
            "/api/get_last_share_password",
            post(h_get_last_share_password),
        )
        .route("/api/start_ngrok_tunnel", post(h_start_ngrok_tunnel))
        .route("/api/stop_ngrok_tunnel", post(h_stop_ngrok_tunnel))
        .route("/api/voice_start", post(h_voice_start))
        .route("/api/voice_send_audio", post(h_voice_send_audio))
        .route("/api/voice_stop", post(h_voice_stop))
        .route("/api/voice_is_active", post(h_voice_is_active))
        .route("/api/voice_refine_text", post(h_voice_refine_text))
        .route("/api/get_dashscope_api_key", post(h_get_dashscope_api_key))
        .route("/api/set_dashscope_api_key", post(h_set_dashscope_api_key))
        .route(
            "/api/get_dashscope_base_url",
            post(h_get_dashscope_base_url),
        )
        .route(
            "/api/set_dashscope_base_url",
            post(h_set_dashscope_base_url),
        )
        .route(
            "/api/get_voice_refine_enabled",
            post(h_get_voice_refine_enabled),
        )
        .route(
            "/api/set_voice_refine_enabled",
            post(h_set_voice_refine_enabled),
        )
        .route("/api/get_app_version", post(h_get_app_version))
        .route("/api/get_app_icon", post(h_get_app_icon))
        .route("/api/check_mirror_update", post(h_check_mirror_update))
        .route(
            "/api/download_update_via_mirror",
            post(h_download_update_via_mirror),
        )
        .route("/api/open_devtools", post(h_open_devtools))
        .route("/api/mcp/config", post(h_mcp_config))
        .route("/api/mcp/set_capability", post(h_set_mcp_capability))
        // Vault
        .route("/api/vault_status", post(h_vault_status))
        .route("/api/vault_link", post(h_vault_link))
        .route("/api/list_vault_item_children", post(h_list_vault_item_children))
        .route("/ws", get(h_ws_upgrade));

    if let Some(pem) = cert_pem {
        router = router
            .route("/api/cert.pem", get(h_cert_pem))
            .layer(Extension(Arc::new(pem)));
    }

    router
}
