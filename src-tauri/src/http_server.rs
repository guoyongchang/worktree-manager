use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Json, Query,
    },
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    serve, Extension, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::Mutex as TokioMutex;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::pty_manager::bytes_to_utf8_with_pending;

use crate::tls::TlsCerts;

#[path = "http_server/middleware.rs"]
mod middleware;
#[path = "http_server/routing.rs"]
mod routing;

use crate::{
    // Project management
    add_existing_project_impl,
    add_project_to_worktree_impl,
    archive_worktree_impl,
    check_worktree_status_impl,
    clone_project_impl,
    create_worktree_impl,
    delete_archived_worktree_impl,
    deploy_to_main_impl,
    exit_main_occupation_impl,
    get_config_path_info_impl,
    // _impl functions (window-context commands)
    get_current_workspace_impl,
    get_main_occupation_impl,
    get_main_workspace_status_impl,
    get_workspace_config_impl,
    git_ops,
    list_worktrees_impl,
    load_workspace_config,
    lock_worktree_impl,
    normalize_path,
    remove_project_from_config_impl,
    restore_worktree_impl,
    save_workspace_config_impl,
    scan_existing_projects_impl,
    set_window_workspace_impl,
    switch_workspace_impl,
    unlock_worktree_impl,
    unregister_window_impl,
    AddProjectToWorktreeRequest,
    CloneProjectRequest,
    ConnectedClient,
    CreateWorktreeRequest,
    OpenEditorRequest,
    SwitchBranchRequest,
    // Direct functions (no window context)
    WorkspaceConfig,
    AUTHENTICATED_SESSIONS,
    AUTH_RATE_LIMITER,
    CONNECTED_CLIENTS,
    LOCK_BROADCAST,
    NONCE_CACHE,
    PTY_MANAGER,
    SHARE_STATE,
    TERMINAL_STATE_BROADCAST,
};
use middleware::{
    auth_middleware, localhost_only_middleware, no_cache_html_middleware,
    security_headers_middleware, session_id,
};
use routing::{build_api_router, build_cors_layer, resolve_dist_path};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert a Result<T, String> to an Axum response (200 with JSON or 400 with error text).
fn result_json<T: serde::Serialize>(r: Result<T, String>) -> Response {
    match r {
        Ok(v) => (StatusCode::OK, Json(json!(v))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

fn result_ok(r: Result<(), String>) -> Response {
    match r {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

fn result_void_ok() -> Response {
    StatusCode::NO_CONTENT.into_response()
}

fn current_app_handle() -> Result<tauri::AppHandle, String> {
    crate::APP_HANDLE
        .lock()
        .map_err(|_| "Internal app state error".to_string())?
        .clone()
        .ok_or("App handle unavailable".to_string())
}

fn parse_origin_url(origin: &str) -> Option<url::Url> {
    let parsed = url::Url::parse(origin).ok()?;
    matches!(parsed.scheme(), "http" | "https").then_some(parsed)
}

fn is_loopback_origin(origin: &url::Url) -> bool {
    match origin.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ipv4)) => ipv4.is_loopback(),
        Some(url::Host::Ipv6(ipv6)) => ipv6.is_loopback(),
        None => false,
    }
}

fn is_private_lan_origin(origin: &url::Url) -> bool {
    matches!(origin.host(), Some(url::Host::Ipv4(ipv4)) if ipv4.is_private())
}

fn same_origin(left: &url::Url, right: &url::Url) -> bool {
    left.scheme() == right.scheme()
        && match (left.host(), right.host()) {
            (Some(url::Host::Domain(a)), Some(url::Host::Domain(b))) => a.eq_ignore_ascii_case(b),
            (Some(url::Host::Ipv4(a)), Some(url::Host::Ipv4(b))) => a == b,
            (Some(url::Host::Ipv6(a)), Some(url::Host::Ipv6(b))) => a == b,
            _ => false,
        }
        && left.port_or_known_default() == right.port_or_known_default()
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// -- Workspace management (no window context) --

async fn h_list_workspaces() -> Response {
    let list = crate::load_global_config().workspaces;
    Json(json!(list)).into_response()
}

#[derive(Deserialize)]
struct AddWsArgs {
    name: String,
    path: String,
}

async fn h_add_workspace(Json(args): Json<AddWsArgs>) -> Response {
    result_ok(crate::add_workspace_internal(&args.name, &args.path))
}

#[derive(Deserialize)]
struct PathArgs {
    path: String,
}

async fn h_remove_workspace(Json(args): Json<PathArgs>) -> Response {
    result_ok(crate::remove_workspace_internal(&args.path))
}

async fn h_create_workspace(Json(args): Json<AddWsArgs>) -> Response {
    result_ok(crate::create_workspace_internal(&args.name, &args.path))
}

// -- Workspace management (with window/session context) --

async fn h_set_window_workspace(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let ws_path = args["workspacePath"].as_str().unwrap_or("").to_string();
    result_ok(set_window_workspace_impl(&sid, ws_path))
}

async fn h_get_current_workspace(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    Json(json!(get_current_workspace_impl(&sid))).into_response()
}

async fn h_switch_workspace(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let path = args["path"].as_str().unwrap_or("").to_string();
    result_ok(switch_workspace_impl(&sid, path))
}

async fn h_get_workspace_config(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    result_json(get_workspace_config_impl(&sid))
}

async fn h_save_workspace_config(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let config: WorkspaceConfig = match serde_json::from_value(args["config"].clone()) {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid config: {}", e)).into_response()
        }
    };
    result_ok(save_workspace_config_impl(&sid, config))
}

async fn h_load_workspace_config_by_path(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    result_json(crate::commands::workspace::load_workspace_config_by_path(
        path,
    ))
}

async fn h_save_workspace_config_by_path(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let config: WorkspaceConfig = match serde_json::from_value(args["config"].clone()) {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid config: {}", e)).into_response()
        }
    };
    result_ok(crate::commands::workspace::save_workspace_config_by_path(
        path, config,
    ))
}

async fn h_get_config_path_info(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    Json(json!(get_config_path_info_impl(&sid))).into_response()
}

// -- Worktree operations --

async fn h_list_worktrees(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let include_archived = args["includeArchived"].as_bool().unwrap_or(false);
    result_json(list_worktrees_impl(&sid, include_archived))
}

async fn h_get_main_workspace_status(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    result_json(get_main_workspace_status_impl(&sid))
}

async fn h_create_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let request: CreateWorktreeRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };
    result_json(create_worktree_impl(&sid, request))
}

async fn h_archive_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let name = args["name"].as_str().unwrap_or("").to_string();
    result_ok(archive_worktree_impl(&sid, name))
}

async fn h_check_worktree_status(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let name = args["name"].as_str().unwrap_or("").to_string();
    result_json(check_worktree_status_impl(&sid, name))
}

async fn h_restore_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let name = args["name"].as_str().unwrap_or("").to_string();
    result_ok(restore_worktree_impl(&sid, name))
}

async fn h_delete_archived_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let name = args["name"].as_str().unwrap_or("").to_string();
    result_ok(delete_archived_worktree_impl(&sid, name))
}

async fn h_add_project_to_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let request: AddProjectToWorktreeRequest = match serde_json::from_value(args["request"].clone())
    {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };
    result_ok(add_project_to_worktree_impl(&sid, request))
}

async fn h_deploy_to_main(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let worktree_name = args["worktreeName"].as_str().unwrap_or("").to_string();
    result_json(deploy_to_main_impl(&sid, worktree_name))
}

async fn h_exit_main_occupation(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let force = args["force"].as_bool().unwrap_or(false);
    result_ok(exit_main_occupation_impl(&sid, force))
}

async fn h_get_main_occupation(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    result_json(get_main_occupation_impl(&sid))
}

async fn h_clone_project(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let request: CloneProjectRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };
    result_ok(clone_project_impl(&sid, request))
}

async fn h_scan_existing_projects(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    result_json(scan_existing_projects_impl(&sid))
}

async fn h_add_existing_project(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let name = args["name"].as_str().unwrap_or("").to_string();
    let base_branch = args
        .get("baseBranch")
        .or_else(|| args.get("base_branch"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let test_branch = args
        .get("testBranch")
        .or_else(|| args.get("test_branch"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let merge_strategy = args
        .get("mergeStrategy")
        .or_else(|| args.get("merge_strategy"))
        .and_then(|v| v.as_str())
        .unwrap_or("merge")
        .to_string();
    result_ok(add_existing_project_impl(
        &sid,
        name,
        base_branch,
        test_branch,
        merge_strategy,
    ))
}

async fn h_remove_project_from_config(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let name = args["name"].as_str().unwrap_or("").to_string();
    result_ok(remove_project_from_config_impl(&sid, name))
}

// -- Git operations --

async fn h_switch_branch(Json(args): Json<Value>) -> Response {
    let request: SwitchBranchRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };
    result_ok(crate::switch_branch_internal(&request))
}

async fn h_get_branch_diff_stats(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let base_branch = args["baseBranch"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let stats = git_ops::get_branch_diff_stats(std::path::Path::new(&normalized), &base_branch);
    Json(json!(stats)).into_response()
}

async fn h_get_changed_files(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    result_json(git_ops::get_changed_files(std::path::Path::new(
        &normalized,
    )))
}

async fn h_get_file_diff(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let file_path = args["filePath"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    result_json(git_ops::get_file_diff(
        std::path::Path::new(&normalized),
        &file_path,
    ))
}

async fn h_check_remote_branch_exists(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let branch_name = args["branchName"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    result_json(git_ops::check_remote_branch_exists(
        std::path::Path::new(&normalized),
        &branch_name,
    ))
}

async fn h_fetch_project_remote(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::fetch_remote(std::path::Path::new(&normalized))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_sync_with_base_branch(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let base_branch = args["baseBranch"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::sync_with_base_branch(std::path::Path::new(&normalized), &base_branch)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_push_to_remote(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::push_to_remote(std::path::Path::new(&normalized))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_merge_to_test_branch(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let test_branch = args["testBranch"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::merge_to_test_branch(std::path::Path::new(&normalized), &test_branch)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_merge_to_base_branch(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let base_branch = args["baseBranch"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::merge_to_base_branch(std::path::Path::new(&normalized), &base_branch)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_create_pull_request(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let base_branch = args["baseBranch"].as_str().unwrap_or("").to_string();
    let title = args["title"].as_str().unwrap_or("").to_string();
    let body = args["body"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::create_pull_request(
            std::path::Path::new(&normalized),
            &base_branch,
            &title,
            &body,
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_get_remote_branches(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::get_remote_branches(std::path::Path::new(&normalized))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_get_git_diff(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    result_json(crate::commands::git::get_git_diff(path).await)
}

async fn h_commit_all(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let message = args["message"].as_str().unwrap_or("").to_string();
    let author_name = args["authorName"].as_str().map(|s| s.to_string());
    let author_email = args["authorEmail"].as_str().map(|s| s.to_string());
    result_json(crate::commands::git::commit_all(path, message, author_name, author_email).await)
}

async fn h_generate_commit_message(Json(args): Json<Value>) -> Response {
    let diff = args["diff"].as_str().unwrap_or("").to_string();
    result_json(crate::commands::voice::generate_commit_message(diff).await)
}

async fn h_get_commit_prefix_config() -> Response {
    result_json(crate::commands::config::get_commit_prefix_config())
}

#[derive(serde::Deserialize)]
struct SetPrefixArgs {
    templates: Vec<String>,
    enabled: bool,
    default_index: usize,
}

async fn h_set_commit_prefix_config(Json(args): Json<SetPrefixArgs>) -> Response {
    result_ok(crate::commands::config::set_commit_prefix_config(
        args.templates,
        args.enabled,
        args.default_index,
    ))
}

async fn h_get_git_user_global_config() -> Response {
    result_json(crate::commands::config::get_git_user_global_config())
}

#[derive(serde::Deserialize)]
struct SetGitUserGlobalArgs {
    name: Option<String>,
    email: Option<String>,
}

async fn h_set_git_user_global_config(Json(args): Json<SetGitUserGlobalArgs>) -> Response {
    result_ok(crate::commands::config::set_git_user_global_config(
        args.name, args.email,
    ))
}

async fn h_get_git_user_config(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::get_git_user_config(std::path::Path::new(&normalized))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

#[derive(serde::Deserialize)]
struct SetGitUserArgs {
    path: String,
    name: Option<String>,
    email: Option<String>,
}

async fn h_set_git_user_config(Json(args): Json<SetGitUserArgs>) -> Response {
    let normalized = normalize_path(&args.path);
    let name = args.name;
    let email = args.email;
    let result = tokio::task::spawn_blocking(move || {
        git_ops::set_git_user_config(
            std::path::Path::new(&normalized),
            name.as_deref(),
            email.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_ok(result)
}

async fn h_check_dashscope_api_key() -> Response {
    Json(json!(crate::commands::voice::check_dashscope_api_key())).into_response()
}

// -- Scan --

async fn h_scan_linked_folders(Json(args): Json<Value>) -> Response {
    let project_path = args["projectPath"].as_str().unwrap_or("").to_string();
    result_json(crate::scan_linked_folders_internal(&project_path))
}

// -- System utilities --

async fn h_open_in_terminal(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let terminal = args["terminal"].as_str().map(|s| s.to_string());
    result_ok(crate::open_in_terminal_internal(&path, terminal.as_deref()))
}

async fn h_open_in_editor(Json(args): Json<Value>) -> Response {
    let request: OpenEditorRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };
    let custom_path = args["customPath"].as_str().map(|s| s.to_string());
    result_ok(crate::open_in_editor_internal(
        &request,
        custom_path.as_deref(),
    ))
}

async fn h_detect_tools() -> Response {
    result_json(Ok(crate::detect_tools_internal()))
}

async fn h_set_git_path(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    crate::set_git_path_internal(&path);
    result_void_ok()
}

async fn h_reveal_in_finder(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    result_ok(crate::reveal_in_finder_internal(&path))
}

async fn h_open_log_dir() -> Response {
    result_ok(crate::open_log_dir_internal())
}

async fn h_get_app_icon(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    Json(json!(crate::get_app_icon_internal(&path))).into_response()
}

// -- Multi-window management --

async fn h_get_opened_workspaces() -> Response {
    match crate::WINDOW_WORKSPACES.lock() {
        Ok(map) => {
            let values: Vec<String> = map.values().cloned().collect();
            Json(json!(values)).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal state error").into_response(),
    }
}

async fn h_unregister_window(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    unregister_window_impl(&sid);
    result_void_ok()
}

async fn h_lock_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let ws_path = args["workspacePath"].as_str().unwrap_or("").to_string();
    let wt_name = args["worktreeName"].as_str().unwrap_or("").to_string();
    result_ok(lock_worktree_impl(&sid, ws_path, wt_name))
}

async fn h_unlock_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let ws_path = args["workspacePath"].as_str().unwrap_or("").to_string();
    let wt_name = args["worktreeName"].as_str().unwrap_or("").to_string();
    unlock_worktree_impl(&sid, ws_path, wt_name);
    result_void_ok()
}

async fn h_get_locked_worktrees(Json(args): Json<Value>) -> Response {
    let ws_path = args["workspacePath"].as_str().unwrap_or("").to_string();
    match crate::WORKTREE_LOCKS.lock() {
        Ok(locks) => {
            let result: HashMap<String, String> = locks
                .iter()
                .filter(|((wp, _), _)| *wp == ws_path)
                .map(|((_, wt), label)| (wt.clone(), label.clone()))
                .collect();
            Json(json!(result)).into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal state error").into_response(),
    }
}

async fn h_broadcast_terminal_state(Json(args): Json<Value>) -> Response {
    let app = match current_app_handle() {
        Ok(app) => app,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };

    let workspace_path = args["workspacePath"].as_str().unwrap_or("").to_string();
    let worktree_name = args["worktreeName"].as_str().unwrap_or("").to_string();
    let activated_terminals = args["activatedTerminals"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .collect();
    let active_terminal_tab = args["activeTerminalTab"].as_str().map(|s| s.to_string());
    let terminal_visible = args["terminalVisible"].as_bool().unwrap_or(false);
    let client_id = args["clientId"].as_str().map(|s| s.to_string());
    let session_id = args["sessionId"].as_str().map(|s| s.to_string());

    crate::commands::window::broadcast_terminal_state(
        app,
        workspace_path,
        worktree_name,
        activated_terminals,
        active_terminal_tab,
        terminal_visible,
        client_id,
        session_id,
    );
    result_void_ok()
}

// -- PTY --

/// Run a closure that requires the PTY_MANAGER lock on a blocking thread.
async fn with_pty_manager<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut crate::pty_manager::PtyManager) -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut manager = PTY_MANAGER
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        f(&mut manager)
    })
    .await
    .unwrap_or_else(|e| Err(format!("Task error: {}", e)))
}

async fn h_pty_create(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let cwd = args["cwd"].as_str().unwrap_or("").to_string();
    let cols = args["cols"].as_u64().unwrap_or(80) as u16;
    let rows = args["rows"].as_u64().unwrap_or(24) as u16;
    let shell = args["shell"].as_str().map(|s| s.to_string());

    // Make create idempotent: if session already exists, skip
    {
        let session_id_clone = session_id.clone();
        let already_exists = tokio::task::spawn_blocking(move || {
            PTY_MANAGER
                .lock()
                .ok()
                .map(|m| m.has_session(&session_id_clone))
                .unwrap_or(false)
        })
        .await
        .unwrap_or(false);
        if already_exists {
            log::info!(
                "[pty] Session already exists (HTTP), skipping create: id={}, requested cols={}, rows={}",
                session_id, cols, rows
            );
            return result_ok(Ok::<(), String>(()));
        }
    }

    result_ok(
        with_pty_manager(move |m| {
            m.create_session(&session_id, &cwd, cols, rows, shell.as_deref())
        })
        .await,
    )
}

async fn h_pty_write(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let data = args["data"].as_str().unwrap_or("").to_string();
    result_ok(with_pty_manager(move |m| m.write_to_session(&session_id, &data)).await)
}

async fn h_pty_read(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let client_id = args["clientId"].as_str().map(|s| s.to_string());
    result_json(
        with_pty_manager(move |m| m.read_from_session(&session_id, client_id.as_deref())).await,
    )
}

async fn h_pty_resize(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let cols = args["cols"].as_u64().unwrap_or(80) as u16;
    let rows = args["rows"].as_u64().unwrap_or(24) as u16;
    let request_client_id = args["clientId"].as_str().map(|s| s.to_string());

    // "Last active client wins resize" — per-session gating.
    // Only the client that most recently broadcast terminal state for THIS session
    // can resize it. Per-window sessions make cross-window gating unnecessary.
    let active_client_id = crate::TERMINAL_STATES
        .lock()
        .ok()
        .and_then(|states| {
            states.values()
                .find(|ts| ts.session_id.as_deref() == Some(&session_id))
                .and_then(|ts| ts.client_id.clone())
        });

    let is_active = if let Some(ref req_cid) = request_client_id {
        active_client_id.as_deref() == Some(req_cid)
    } else {
        // No clientId provided (legacy/Tauri desktop) — always allow
        true
    };

    if !is_active {
        log::info!(
            "[http] REJECTED pty_resize: client={:?} session={} size={}x{} (active_client={:?})",
            request_client_id,
            session_id,
            cols,
            rows,
            active_client_id
        );
        return result_ok(Ok::<(), String>(()));
    }

    log::info!(
        "[http] ACCEPTED pty_resize: client={:?} session={} size={}x{}",
        request_client_id,
        session_id,
        cols,
        rows
    );
    result_ok(with_pty_manager(move |m| m.resize_session(&session_id, cols, rows)).await)
}

async fn h_pty_close(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    result_ok(with_pty_manager(move |m| m.close_session(&session_id)).await)
}

async fn h_pty_exists(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    result_json(with_pty_manager(move |m| Ok(m.has_session(&session_id))).await)
}

async fn h_pty_close_by_path(Json(args): Json<Value>) -> Response {
    let path_prefix = args["pathPrefix"].as_str().unwrap_or("").to_string();
    result_json(with_pty_manager(move |m| Ok(m.close_sessions_by_path_prefix(&path_prefix))).await)
}

// -- Auth --

async fn h_auth_challenge(ConnectInfo(addr): ConnectInfo<SocketAddr>) -> Response {
    let client_ip = addr.ip().to_string();
    log::info!("[auth] Challenge requested from IP: {}", client_ip);

    // Rate limiting: max 5 attempts per 60 seconds per IP
    let rate_ok = AUTH_RATE_LIMITER
        .lock()
        .map(|mut limiter| limiter.check_and_record(&client_ip))
        .unwrap_or(false);
    if !rate_ok {
        log::warn!(
            "[auth] Rate limited: IP {} exceeded 5 attempts/60s",
            client_ip
        );
        return (StatusCode::TOO_MANY_REQUESTS, "请求过于频繁，请稍后再试").into_response();
    }

    // Get salt
    let salt = SHARE_STATE
        .lock()
        .ok()
        .and_then(|state| state.auth_salt.clone())
        .unwrap_or_default();

    if salt.is_empty() {
        log::error!("[auth] No password configured for challenge");
        return (StatusCode::INTERNAL_SERVER_ERROR, "No password configured").into_response();
    }

    // Generate nonce
    let nonce_hex = match NONCE_CACHE.lock() {
        Ok(mut cache) => match cache.generate() {
            Ok(n) => {
                log::info!("[auth] Nonce generated successfully for IP: {}", client_ip);
                n
            }
            Err(e) => {
                log::error!("[auth] Failed to generate nonce: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response();
            }
        },
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response(),
    };

    Json(json!({
        "nonce": nonce_hex,
        "salt": hex::encode(&salt),
    }))
    .into_response()
}

#[derive(serde::Deserialize)]
struct VerifyRequest {
    proof: String, // hex-encoded HMAC
    nonce: String, // hex-encoded nonce
}

async fn h_auth_verify(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<VerifyRequest>,
) -> Response {
    let client_ip = addr.ip().to_string();
    log::info!("[auth] Verification attempt from IP: {}", client_ip);

    // Consume nonce (one-time use)
    let nonce_bytes = match NONCE_CACHE.lock() {
        Ok(mut cache) => match cache.consume(&req.nonce) {
            Some(n) => n,
            None => {
                log::warn!("[auth] Invalid or expired nonce from IP: {}", client_ip);
                return (StatusCode::UNAUTHORIZED, "Invalid or expired nonce").into_response();
            }
        },
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response(),
    };

    // Get auth key
    let auth_key = SHARE_STATE
        .lock()
        .ok()
        .and_then(|state| state.auth_key.clone())
        .unwrap_or_default();

    if auth_key.is_empty() {
        log::error!("[auth] No password configured for verification");
        return (StatusCode::INTERNAL_SERVER_ERROR, "No password configured").into_response();
    }

    // Compute expected HMAC
    use ring::hmac;
    let key = hmac::Key::new(hmac::HMAC_SHA256, &auth_key);
    let expected_tag = hmac::sign(&key, &nonce_bytes);
    let expected_hex = hex::encode(expected_tag.as_ref());

    // Constant-time comparison
    let proof_match = req.proof.len() == expected_hex.len()
        && req
            .proof
            .as_bytes()
            .iter()
            .zip(expected_hex.as_bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0;

    if !proof_match {
        log::warn!("[auth] Verification failed from IP: {}", client_ip);
        return (StatusCode::UNAUTHORIZED, "密码错误").into_response();
    }

    // Generate session ID (same logic as before)
    let sid = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let client_ip = addr.ip().to_string();
    let client = ConnectedClient {
        session_id: sid.clone(),
        ip: client_ip.clone(),
        user_agent,
        authenticated_at: now.clone(),
        last_active: now,
        ws_connected: false,
    };

    // Remove old sessions from the same IP that don't have an active WebSocket
    let stale_sids: Vec<String> = if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        let stale: Vec<String> = clients
            .iter()
            .filter(|(_, c)| c.ip == client_ip && !c.ws_connected)
            .map(|(s, _)| s.clone())
            .collect();
        for s in &stale {
            clients.remove(s);
        }
        clients.insert(sid.clone(), client);
        stale
    } else {
        vec![]
    };

    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        for s in &stale_sids {
            sessions.remove(s);
        }
        sessions.insert(sid.clone());
    }

    log::info!(
        "[auth] Verification successful for session: {}, IP: {}",
        sid,
        client_ip
    );
    Json(json!({ "sessionId": sid })).into_response()
}

// -- ngrok token --

async fn h_get_ngrok_token() -> Response {
    let config = crate::load_global_config();
    Json(json!(config.ngrok_token)).into_response()
}

async fn h_set_ngrok_token(Json(args): Json<Value>) -> Response {
    let token = args["token"].as_str().unwrap_or("").to_string();
    let mut config = crate::load_global_config();
    config.ngrok_token = if token.is_empty() { None } else { Some(token) };
    match crate::save_global_config_internal(&config) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

async fn h_start_ngrok_tunnel() -> Response {
    match crate::start_ngrok_tunnel_internal().await {
        Ok(url) => Json(json!(url)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

async fn h_stop_ngrok_tunnel() -> Response {
    match SHARE_STATE.lock() {
        Ok(mut state) => {
            if let Some(handle) = state.ngrok_task.take() {
                handle.abort();
            }
            state.ngrok_url = None;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal state error").into_response(),
    }
}

// -- Share info --

async fn h_get_share_info() -> Response {
    let null_response = || {
        Json(json!({
            "workspace_name": null,
            "workspace_path": null,
            "current_worktree": null,
        }))
        .into_response()
    };

    // Extract share state data, then drop the lock before acquiring WORKTREE_LOCKS
    let (ws_name, ws_path) = {
        let share_state = match SHARE_STATE.lock() {
            Ok(s) if s.active => s,
            _ => return null_response(),
        };
        match share_state.workspace_path {
            Some(ref path) => {
                let config = load_workspace_config(path);
                (Some(config.name), Some(path.clone()))
            }
            None => (None, None),
        }
    };

    // Get current locked worktree (the one the desktop user is viewing)
    let current_worktree = if let Some(ref ws_path) = ws_path {
        if let Ok(locks) = crate::WORKTREE_LOCKS.lock() {
            // Find the first locked worktree for this workspace
            locks
                .iter()
                .find(|((wp, _), _)| wp == ws_path)
                .map(|((_, wt), _)| wt.clone())
        } else {
            None
        }
    } else {
        None
    };

    Json(json!({
        "workspace_name": ws_name,
        "workspace_path": ws_path,
        "current_worktree": current_worktree,
    }))
    .into_response()
}

async fn h_start_sharing(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let workspace_path = match crate::config::get_window_workspace_path(&sid) {
        Some(path) => path,
        None => return (StatusCode::BAD_REQUEST, "No workspace selected").into_response(),
    };
    let port = args["port"].as_u64().unwrap_or(0) as u16;
    let password = args["password"].as_str().unwrap_or("").to_string();
    match crate::commands::sharing::start_sharing_internal(workspace_path, port, password).await {
        Ok(url) => Json(json!(url)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

async fn h_stop_sharing() -> Response {
    result_ok(crate::commands::sharing::stop_sharing_internal())
}

async fn h_get_share_state() -> Response {
    result_json(crate::commands::sharing::get_share_state().await)
}

async fn h_update_share_password(Json(args): Json<Value>) -> Response {
    let password = args["password"].as_str().unwrap_or("").to_string();
    result_ok(crate::commands::sharing::update_share_password(password).await)
}

async fn h_get_last_share_port() -> Response {
    result_json(crate::commands::sharing::get_last_share_port().await)
}

async fn h_get_last_share_password() -> Response {
    result_json(crate::commands::sharing::get_last_share_password().await)
}

// -- Misc --

async fn h_get_terminal_state(Json(args): Json<Value>) -> Response {
    let ws_path = args["workspacePath"].as_str().unwrap_or("").to_string();
    let wt_name = args["worktreeName"].as_str().unwrap_or("").to_string();
    let state = crate::commands::window::get_terminal_state_inner(ws_path, wt_name);
    Json(json!(state)).into_response()
}

async fn h_open_workspace_window(Json(args): Json<Value>) -> Response {
    // In browser mode, "open new window" just opens a new browser tab
    let ws_path = args["workspacePath"].as_str().unwrap_or("").to_string();
    // Return a URL that the frontend can use to open a new tab
    let url = format!("/?workspace={}", urlencoding::encode(&ws_path));
    Json(json!(url)).into_response()
}

async fn h_get_app_version() -> Response {
    Json(json!(env!("CARGO_PKG_VERSION"))).into_response()
}

async fn h_check_mirror_update() -> Response {
    result_json(crate::commands::system::check_mirror_update().await)
}

async fn h_download_update_via_mirror() -> Response {
    let app = match current_app_handle() {
        Ok(app) => app,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    result_ok(crate::commands::system::download_update_via_mirror(app).await)
}

async fn h_open_devtools() -> Response {
    let app = match current_app_handle() {
        Ok(app) => app,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => return (StatusCode::BAD_REQUEST, "Main window not found").into_response(),
    };
    crate::commands::window::open_devtools(window);
    result_void_ok()
}

// ---------------------------------------------------------------------------
// Vault Handlers
// ---------------------------------------------------------------------------

pub async fn h_vault_status(headers: HeaderMap) -> axum::response::Response {
    let sid = session_id(&headers);
    result_json(crate::commands::vault::vault_status_impl(&sid))
}

pub async fn h_vault_link(
    headers: HeaderMap,
    axum::extract::Json(args): axum::extract::Json<serde_json::Value>,
) -> axum::response::Response {
    let sid = session_id(&headers);
    let path = args.get("path").and_then(|v| {
        if v.is_null() {
            None
        } else {
            v.as_str().map(|s| s.to_string())
        }
    });
    result_json(crate::commands::vault::vault_link_impl(&sid, path))
}

pub async fn h_list_vault_item_children(
    axum::extract::Json(args): axum::extract::Json<serde_json::Value>,
) -> axum::response::Response {
    let vault_path = args
        .get("vaultPath")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let relative_path = args
        .get("relativePath")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    result_json(crate::commands::vault::list_vault_item_children(
        vault_path,
        relative_path,
    ))
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct WsParams {
    session_id: Option<String>,
}

async fn h_ws_upgrade(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(params): Query<WsParams>,
) -> Response {
    // Authenticate via query param
    let sid = match params.session_id {
        Some(s) => s,
        None => return (StatusCode::UNAUTHORIZED, "Missing session_id").into_response(),
    };

    let needs_auth = SHARE_STATE
        .lock()
        .map(|state| state.active && state.auth_key.is_some())
        .unwrap_or(false);

    if needs_auth {
        let is_authenticated = AUTHENTICATED_SESSIONS
            .lock()
            .map(|sessions| sessions.contains(&sid))
            .unwrap_or(false);
        if !is_authenticated {
            return (StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
        }
    }

    // Mark WebSocket connected
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        if let Some(client) = clients.get_mut(&sid) {
            client.ws_connected = true;
            client.last_active = chrono::Utc::now().to_rfc3339();
        }
    }
    log::info!("WebSocket upgrade for session {} from {}", sid, addr.ip());

    ws.on_upgrade(move |socket| handle_ws(socket, sid))
}

// TODO(security): Consider per-session rate limiting for WebSocket messages
// to prevent a single client from flooding the server with pty_write commands.
async fn handle_ws(socket: WebSocket, session_id: String) {
    let (ws_sender, mut ws_receiver) = socket.split();
    let ws_sender = Arc::new(TokioMutex::new(ws_sender));

    // Auto-bind session to the shared workspace
    if let Ok(share_state) = SHARE_STATE.lock() {
        if let Some(ref ws_path) = share_state.workspace_path {
            if share_state.active {
                let _ = set_window_workspace_impl(&session_id, ws_path.clone());
            }
        }
    }

    // Track spawned forwarder tasks so we can abort them on disconnect
    let mut pty_forwarders: HashMap<String, tokio::task::JoinHandle<()>> = HashMap::new();
    let mut lock_forwarder: Option<tokio::task::JoinHandle<()>> = None;
    let mut terminal_state_forwarder: Option<tokio::task::JoinHandle<()>> = None;
    let mut voice_forwarder: Option<tokio::task::JoinHandle<()>> = None;

    // Always-on: subscribe to per-client notifications (kick events, etc.)
    let notification_forwarder: tokio::task::JoinHandle<()> = {
        let mut rx = crate::state::CLIENT_NOTIFICATION_BROADCAST.subscribe();
        let sender = Arc::clone(&ws_sender);
        let sid = session_id.clone();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(json_str) => {
                        if let Ok(val) = serde_json::from_str::<Value>(&json_str) {
                            // Only forward notifications targeted at this session
                            if val["session_id"].as_str() == Some(&sid) {
                                let msg_type = val["type"].as_str().unwrap_or("");
                                let reason = val["reason"].as_str().unwrap_or("").to_string();
                                let msg = json!({
                                    "type": msg_type,
                                    "reason": reason,
                                });
                                let mut sender = sender.lock().await;
                                let _ = sender.send(Message::text(msg.to_string())).await;
                                // After sending kick notification, close the connection
                                if msg_type == "kicked" {
                                    let _ = sender.close().await;
                                    break;
                                }
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    };

    // Process incoming messages
    while let Some(msg) = ws_receiver.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };

        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        let parsed: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg_type = parsed["type"].as_str().unwrap_or("");

        match msg_type {
            "pty_subscribe" => {
                let pty_session_id = match parsed["sessionId"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };

                // Abort existing forwarder for this session if any
                if let Some(handle) = pty_forwarders.remove(&pty_session_id) {
                    handle.abort();
                }

                // Get replay buffer + broadcast receiver from PTY manager
                let subscription = {
                    let manager = match PTY_MANAGER.lock() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    manager.subscribe_session(&pty_session_id)
                };

                if let Some((replay, mut rx)) = subscription {
                    log::info!(
                        "PTY subscribe '{}': replay buffer {} bytes",
                        pty_session_id,
                        replay.len()
                    );
                    let sender = Arc::clone(&ws_sender);
                    let sid = pty_session_id.clone();
                    let handle = tokio::spawn(async move {
                        // Pending buffer for incomplete UTF-8 sequences across chunk boundaries
                        let mut utf8_pending: Vec<u8> = Vec::new();

                        // Send replay buffer first so new subscribers see existing content
                        if !replay.is_empty() {
                            let (text, pending) = bytes_to_utf8_with_pending(&replay);
                            utf8_pending = pending;
                            if !text.is_empty() {
                                let msg = json!({
                                    "type": "pty_output",
                                    "sessionId": sid,
                                    "data": text,
                                });
                                let mut s = sender.lock().await;
                                if s.send(Message::text(msg.to_string())).await.is_err() {
                                    return;
                                }
                            }
                        }

                        // Forward real-time output
                        loop {
                            match rx.recv().await {
                                Ok(data) => {
                                    // Prepend any leftover bytes from the previous chunk
                                    let combined = if utf8_pending.is_empty() {
                                        data
                                    } else {
                                        let mut buf = std::mem::take(&mut utf8_pending);
                                        buf.extend(data);
                                        buf
                                    };
                                    let (text, pending) = bytes_to_utf8_with_pending(&combined);
                                    utf8_pending = pending;
                                    if !text.is_empty() {
                                        let msg = json!({
                                            "type": "pty_output",
                                            "sessionId": sid,
                                            "data": text,
                                        });
                                        let mut sender = sender.lock().await;
                                        if sender
                                            .send(Message::text(msg.to_string()))
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                    }
                                }
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                                    log::warn!("PTY output broadcast lagged, skipped {} messages for session {}",
                                        skipped, sid);
                                    // Clear pending buffer on lag — skipped messages may have
                                    // contained the continuation bytes we were waiting for.
                                    utf8_pending.clear();
                                    continue;
                                }
                                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                    break;
                                }
                            }
                        }
                    });
                    pty_forwarders.insert(pty_session_id, handle);
                } else {
                    log::warn!(
                        "PTY subscribe '{}': session not found in PTY manager",
                        pty_session_id
                    );
                }
            }

            "pty_unsubscribe" => {
                if let Some(sid) = parsed["sessionId"].as_str() {
                    if let Some(handle) = pty_forwarders.remove(sid) {
                        handle.abort();
                    }
                }
            }

            "pty_write" => {
                let pty_session_id = match parsed["sessionId"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let data = match parsed["data"].as_str() {
                    Some(d) => d.to_string(),
                    None => continue,
                };
                let _ = tokio::task::spawn_blocking(move || {
                    PTY_MANAGER
                        .lock()
                        .map_err(|e| format!("Lock error: {}", e))
                        .and_then(|m| m.write_to_session(&pty_session_id, &data))
                })
                .await;
            }

            // "Last active client wins resize" — only the most recently active
            // client's resize is applied to the PTY. This prevents a mobile
            // client (40 cols) from breaking output formatting on the PC (120 cols).
            "pty_resize" => {
                let pty_session_id = match parsed["sessionId"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let cols = parsed["cols"].as_u64().unwrap_or(80) as u16;
                let rows = parsed["rows"].as_u64().unwrap_or(24) as u16;
                let request_client_id = parsed["clientId"].as_str().map(|s| s.to_string());

                // "Last active client wins resize" — per-session gating.
                let active_client_id = crate::TERMINAL_STATES
                    .lock()
                    .ok()
                    .and_then(|states| {
                        states.values()
                            .find(|ts| ts.session_id.as_deref() == Some(&pty_session_id))
                            .and_then(|ts| ts.client_id.clone())
                    });

                let is_active = if let Some(ref req_cid) = request_client_id {
                    active_client_id.as_deref() == Some(req_cid)
                } else {
                    // No clientId provided (legacy/local) — always allow
                    true
                };

                if is_active {
                    log::info!(
                        "[ws] ACCEPTED pty_resize: client={:?} session={} size={}x{}",
                        request_client_id,
                        pty_session_id,
                        cols,
                        rows
                    );
                    let _ = tokio::task::spawn_blocking(move || {
                        PTY_MANAGER
                            .lock()
                            .map_err(|e| format!("Lock error: {}", e))
                            .and_then(|m| m.resize_session(&pty_session_id, cols, rows))
                    })
                    .await;
                } else {
                    log::info!(
                        "[ws] REJECTED pty_resize: client={:?} session={} size={}x{} (active_client={:?})",
                        request_client_id,
                        pty_session_id,
                        cols,
                        rows,
                        active_client_id
                    );
                }
            }

            "subscribe_locks" => {
                let workspace_path = match parsed["workspacePath"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };

                // Abort existing lock forwarder if any
                if let Some(handle) = lock_forwarder.take() {
                    handle.abort();
                }

                // Send initial lock state
                // Scope the std::sync::MutexGuard so it drops before any .await
                let initial_lock_msg = if let Ok(locks) = crate::WORKTREE_LOCKS.lock() {
                    let lock_snapshot: HashMap<String, String> = locks
                        .iter()
                        .filter(|((wp, _), _)| *wp == workspace_path)
                        .map(|((_, wt), label)| (wt.clone(), label.clone()))
                        .collect();
                    Some(
                        json!({
                            "type": "lock_update",
                            "locks": lock_snapshot,
                        })
                        .to_string(),
                    )
                } else {
                    None
                };
                if let Some(msg_str) = initial_lock_msg {
                    let mut sender = ws_sender.lock().await;
                    let _ = sender.send(Message::text(msg_str)).await;
                }

                // Subscribe to lock broadcast
                let mut rx = LOCK_BROADCAST.subscribe();
                let sender = Arc::clone(&ws_sender);
                let ws_path = workspace_path.clone();
                let handle = tokio::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(json_str) => {
                                // Parse the broadcast to check if it's for our workspace
                                if let Ok(val) = serde_json::from_str::<Value>(&json_str) {
                                    if val["workspacePath"].as_str() == Some(&ws_path) {
                                        let locks = &val["locks"];
                                        let msg = json!({
                                            "type": "lock_update",
                                            "locks": locks,
                                        });
                                        let mut sender = sender.lock().await;
                                        if sender
                                            .send(Message::text(msg.to_string()))
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                    }
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
                lock_forwarder = Some(handle);
            }

            "subscribe_terminal_state" => {
                let workspace_path = match parsed["workspacePath"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let worktree_name = match parsed["worktreeName"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };

                // Abort existing terminal state forwarder if any
                if let Some(handle) = terminal_state_forwarder.take() {
                    handle.abort();
                }

                // Send initial terminal state from cache
                let initial_state = crate::TERMINAL_STATES.lock().ok().and_then(|states| {
                    let key = (workspace_path.clone(), worktree_name.clone());
                    states.get(&key).cloned()
                });

                if let Some(state) = initial_state {
                    let msg = json!({
                        "type": "terminal_state_update",
                        "workspacePath": &workspace_path,
                        "worktreeName": &worktree_name,
                        "activatedTerminals": state.activated_terminals,
                        "activeTerminalTab": state.active_terminal_tab,
                        "terminalVisible": state.terminal_visible,
                        "clientId": state.client_id,
                    });
                    let mut sender = ws_sender.lock().await;
                    let _ = sender.send(Message::text(msg.to_string())).await;
                }

                // Subscribe to terminal state broadcast
                let mut rx = TERMINAL_STATE_BROADCAST.subscribe();
                let sender = Arc::clone(&ws_sender);
                let ws_path = workspace_path.clone();
                let wt_name = worktree_name.clone();
                let handle = tokio::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(json_str) => {
                                // Parse the broadcast to check if it's for our workspace/worktree
                                if let Ok(val) = serde_json::from_str::<Value>(&json_str) {
                                    if val["workspacePath"].as_str() == Some(&ws_path)
                                        && val["worktreeName"].as_str() == Some(&wt_name)
                                    {
                                        let msg = json!({
                                            "type": "terminal_state_update",
                                            "workspacePath": &ws_path,
                                            "worktreeName": &wt_name,
                                            "activatedTerminals": val["activatedTerminals"],
                                            "activeTerminalTab": val["activeTerminalTab"],
                                            "terminalVisible": val["terminalVisible"],
                                            "clientId": val["clientId"],
                                        });
                                        let mut sender = sender.lock().await;
                                        if sender
                                            .send(Message::text(msg.to_string()))
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                    }
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                                // Log lagged receiver warning - client is too slow
                                log::warn!("Terminal state broadcast lagged, skipped {} messages for {}/{}",
                                    skipped, ws_path, wt_name);
                                continue;
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
                terminal_state_forwarder = Some(handle);
            }

            "broadcast_terminal_state" => {
                let workspace_path = match parsed["workspacePath"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let worktree_name = match parsed["worktreeName"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let activated_terminals = parsed["activatedTerminals"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let active_terminal_tab =
                    parsed["activeTerminalTab"].as_str().map(|s| s.to_string());
                let terminal_visible = parsed["terminalVisible"].as_bool().unwrap_or(false);
                let client_id = parsed["clientId"].as_str().map(|s| s.to_string());
                let session_id = parsed["sessionId"].as_str().map(|s| s.to_string());

                // Update cache with client_id and session_id
                if let Ok(mut states) = crate::TERMINAL_STATES.lock() {
                    let key = (workspace_path.clone(), worktree_name.clone());
                    states.insert(
                        key,
                        crate::TerminalState {
                            activated_terminals: activated_terminals.clone(),
                            active_terminal_tab: active_terminal_tab.clone(),
                            terminal_visible,
                            client_id: client_id.clone(),
                            session_id: session_id.clone(),
                        },
                    );
                }

                // Broadcast to all connected clients with clientId
                let broadcast_msg = json!({
                    "workspacePath": workspace_path,
                    "worktreeName": worktree_name,
                    "activatedTerminals": activated_terminals,
                    "activeTerminalTab": active_terminal_tab,
                    "terminalVisible": terminal_visible,
                    "clientId": client_id,
                    "sessionId": session_id,
                })
                .to_string();
                let _ = TERMINAL_STATE_BROADCAST.send(broadcast_msg);

                // Also emit Tauri event for PC端 to receive Web端 changes
                if let Some(app_handle) = crate::APP_HANDLE
                    .lock()
                    .ok()
                    .and_then(|h| h.as_ref().cloned())
                {
                    let _ = app_handle.emit(
                        "terminal-state-update",
                        json!({
                            "workspacePath": workspace_path,
                            "worktreeName": worktree_name,
                            "activatedTerminals": activated_terminals,
                            "activeTerminalTab": active_terminal_tab,
                            "terminalVisible": terminal_visible,
                            "clientId": client_id,
                            "sessionId": session_id,
                        }),
                    );
                }
            }

            "subscribe_voice_events" => {
                // Abort existing voice forwarder if any
                if let Some(handle) = voice_forwarder.take() {
                    handle.abort();
                }

                let mut rx = crate::state::VOICE_BROADCAST.subscribe();
                let sender = Arc::clone(&ws_sender);
                let handle = tokio::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(json_str) => {
                                if let Ok(val) = serde_json::from_str::<Value>(&json_str) {
                                    let event = val["event"].as_str().unwrap_or("");
                                    let payload = &val["payload"];
                                    let msg = json!({
                                        "type": "voice_event",
                                        "event": event,
                                        "payload": payload,
                                    });
                                    let mut sender = sender.lock().await;
                                    if sender.send(Message::text(msg.to_string())).await.is_err() {
                                        break;
                                    }
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        }
                    }
                });
                voice_forwarder = Some(handle);
            }

            _ => {}
        }
    }

    // Cleanup: abort all forwarder tasks on disconnect
    for (_, handle) in pty_forwarders {
        handle.abort();
    }
    if let Some(handle) = lock_forwarder {
        handle.abort();
    }
    if let Some(handle) = terminal_state_forwarder {
        handle.abort();
    }
    if let Some(handle) = voice_forwarder {
        handle.abort();
    }
    notification_forwarder.abort();

    // Mark WebSocket disconnected
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        if let Some(client) = clients.get_mut(&session_id) {
            client.ws_connected = false;
        }
    }
    log::info!("WebSocket disconnected for session {}", session_id);
}

// -- Voice --

async fn h_voice_start(Json(args): Json<Value>) -> Response {
    let sample_rate = args["sampleRate"].as_u64().map(|v| v as u32);
    result_ok(crate::commands::voice::voice_start_inner(sample_rate).await)
}

async fn h_voice_send_audio(Json(args): Json<Value>) -> Response {
    let data = args["data"].as_str().unwrap_or("").to_string();
    result_ok(crate::commands::voice::voice_send_audio_inner(data))
}

async fn h_voice_stop() -> Response {
    result_ok(crate::commands::voice::voice_stop_inner())
}

async fn h_voice_is_active() -> Response {
    result_json(crate::commands::voice::voice_is_active_inner())
}

async fn h_voice_refine_text(Json(args): Json<Value>) -> Response {
    let text = args["text"].as_str().unwrap_or("").to_string();
    result_json(crate::commands::voice::voice_refine_text_inner(text).await)
}

async fn h_get_dashscope_api_key() -> Response {
    result_json(crate::commands::voice::get_dashscope_api_key_inner())
}

async fn h_set_dashscope_api_key(Json(args): Json<Value>) -> Response {
    let key = args["key"].as_str().unwrap_or("").to_string();
    result_ok(crate::commands::voice::set_dashscope_api_key_inner(key))
}

async fn h_get_dashscope_base_url() -> Response {
    result_json(crate::commands::voice::get_dashscope_base_url_inner())
}

async fn h_set_dashscope_base_url(Json(args): Json<Value>) -> Response {
    let url = args["url"].as_str().unwrap_or("").to_string();
    result_ok(crate::commands::voice::set_dashscope_base_url_inner(url))
}

async fn h_get_voice_refine_enabled() -> Response {
    result_json(crate::commands::voice::get_voice_refine_enabled_inner())
}

async fn h_set_voice_refine_enabled(Json(args): Json<Value>) -> Response {
    let enabled = args["enabled"].as_bool().unwrap_or(true);
    result_ok(crate::commands::voice::set_voice_refine_enabled_inner(
        enabled,
    ))
}

// -- Connected clients --

async fn h_get_connected_clients() -> Response {
    match CONNECTED_CLIENTS.lock() {
        Ok(clients) => {
            let list: Vec<ConnectedClient> = clients.values().cloned().collect();
            Json(json!(list)).into_response()
        }
        Err(_) => Json(json!(Vec::<ConnectedClient>::new())).into_response(),
    }
}

async fn h_kick_client(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    result_ok(crate::kick_client_internal(&session_id))
}

// -- Certificate download --

async fn h_cert_pem(Extension(cert_pem): Extension<Arc<String>>) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/x-pem-file"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"worktree-manager.pem\"",
            ),
        ],
        cert_pem.as_str().to_string(),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Check if an origin is allowed (localhost, LAN, or active ngrok URL).
fn is_allowed_origin(origin: &str) -> bool {
    let Some(parsed_origin) = parse_origin_url(origin) else {
        return false;
    };

    if is_loopback_origin(&parsed_origin) || is_private_lan_origin(&parsed_origin) {
        return true;
    }

    if let Ok(state) = SHARE_STATE.lock() {
        if let Some(ref ngrok_url) = state.ngrok_url {
            if let Some(parsed_ngrok) = parse_origin_url(ngrok_url) {
                if same_origin(&parsed_origin, &parsed_ngrok) {
                    return true;
                }
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::create_router;
    use super::is_allowed_origin;
    use crate::{
        AUTHENTICATED_SESSIONS, AUTH_RATE_LIMITER, CONNECTED_CLIENTS, NONCE_CACHE, SHARE_STATE,
    };
    use axum::body::{to_bytes, Body};
    use axum::http::{header, Method, Request, StatusCode};
    use axum::response::Response;
    use once_cell::sync::Lazy;
    use serde_json::{json, Value};
    use std::collections::{HashMap, HashSet};
    use std::net::SocketAddr;
    use std::sync::{Mutex, MutexGuard};
    use tower::ServiceExt;

    static TEST_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_test_mutex() -> MutexGuard<'static, ()> {
        TEST_MUTEX.lock().unwrap_or_else(|err| err.into_inner())
    }

    struct ShareStateTestGuard {
        prev_share_state: crate::ShareState,
        prev_sessions: HashSet<String>,
        prev_clients: HashMap<String, crate::ConnectedClient>,
        prev_rate_limiter: crate::AuthRateLimiter,
        prev_nonce_cache: crate::NonceCache,
    }

    impl ShareStateTestGuard {
        fn with_auth_enabled() -> Self {
            let guard = Self::capture();
            {
                let mut state = SHARE_STATE.lock().unwrap();
                state.active = true;
                state.auth_key = Some(b"test-auth-key".to_vec());
                state.auth_salt = Some(b"test-auth-salt".to_vec());
                state.workspace_path = Some("/tmp/test-workspace".to_string());
            }
            guard
        }

        fn without_password() -> Self {
            let guard = Self::capture();
            {
                let mut state = SHARE_STATE.lock().unwrap();
                state.active = false;
                state.auth_key = None;
                state.auth_salt = None;
                state.workspace_path = None;
            }
            guard
        }

        fn capture() -> Self {
            let prev_share_state = {
                let mut state = SHARE_STATE.lock().unwrap();
                std::mem::take(&mut *state)
            };
            let prev_sessions = {
                let mut sessions = AUTHENTICATED_SESSIONS.lock().unwrap();
                std::mem::take(&mut *sessions)
            };
            let prev_clients = {
                let mut clients = CONNECTED_CLIENTS.lock().unwrap();
                std::mem::take(&mut *clients)
            };
            let prev_rate_limiter = {
                let mut limiter = AUTH_RATE_LIMITER.lock().unwrap();
                std::mem::replace(&mut *limiter, crate::AuthRateLimiter::new())
            };
            let prev_nonce_cache = {
                let mut cache = NONCE_CACHE.lock().unwrap();
                std::mem::replace(&mut *cache, crate::NonceCache::new())
            };

            Self {
                prev_share_state,
                prev_sessions,
                prev_clients,
                prev_rate_limiter,
                prev_nonce_cache,
            }
        }
    }

    impl Drop for ShareStateTestGuard {
        fn drop(&mut self) {
            *SHARE_STATE.lock().unwrap() = std::mem::take(&mut self.prev_share_state);
            *AUTHENTICATED_SESSIONS.lock().unwrap() = std::mem::take(&mut self.prev_sessions);
            *CONNECTED_CLIENTS.lock().unwrap() = std::mem::take(&mut self.prev_clients);
            *AUTH_RATE_LIMITER.lock().unwrap() =
                std::mem::replace(&mut self.prev_rate_limiter, crate::AuthRateLimiter::new());
            *NONCE_CACHE.lock().unwrap() =
                std::mem::replace(&mut self.prev_nonce_cache, crate::NonceCache::new());
        }
    }

    async fn request_with_addr(addr: SocketAddr, request: Request<Body>) -> Response {
        let make_svc = create_router(Some("dummy-cert-pem".to_string()))
            .into_make_service_with_connect_info::<SocketAddr>();
        let svc = make_svc.oneshot(addr).await.unwrap();
        svc.oneshot(request).await.unwrap()
    }

    async fn response_json(response: Response) -> Value {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(err) => {
                eprintln!(
                    "response_json parse failed (status {}). raw body: {:?}",
                    status,
                    String::from_utf8_lossy(&bytes)
                );
                panic!("{}", err);
            }
        }
    }

    async fn request_json(
        addr: SocketAddr,
        path: &str,
        payload: Value,
        user_agent: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(path)
            .header(header::CONTENT_TYPE, "application/json");

        if let Some(agent) = user_agent {
            builder = builder.header(header::USER_AGENT, agent);
        }

        let response =
            request_with_addr(addr, builder.body(Body::from(payload.to_string())).unwrap()).await;
        let status = response.status();
        let body = response_json(response).await;
        (status, body)
    }

    fn build_proof_hex(auth_key: &[u8], nonce_hex: &str) -> String {
        let nonce_bytes = hex::decode(nonce_hex).unwrap();
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, auth_key);
        hex::encode(ring::hmac::sign(&key, &nonce_bytes).as_ref())
    }

    #[test]
    fn allows_exact_loopback_and_private_lan_origins_only() {
        assert!(is_allowed_origin("http://localhost:1420"));
        assert!(is_allowed_origin("https://127.0.0.1"));
        assert!(is_allowed_origin("http://[::1]:8080"));
        assert!(is_allowed_origin("http://192.168.1.8:3000"));
        assert!(is_allowed_origin("http://10.0.0.8"));
        assert!(is_allowed_origin("http://172.16.5.4"));

        assert!(!is_allowed_origin("https://localhost.evil.example"));
        assert!(!is_allowed_origin("https://127.0.0.1.evil.example"));
        assert!(!is_allowed_origin("https://192.168.1.8.evil.example"));
        assert!(!is_allowed_origin("not-a-url"));
    }

    #[test]
    fn only_allows_exact_active_ngrok_origin() {
        let _serial = lock_test_mutex();
        let previous = {
            let mut state = SHARE_STATE.lock().unwrap();
            let previous = state.ngrok_url.clone();
            state.ngrok_url = Some("https://demo.ngrok-free.app/".to_string());
            previous
        };

        assert!(is_allowed_origin("https://demo.ngrok-free.app"));
        assert!(is_allowed_origin("https://demo.ngrok-free.app:443"));
        assert!(!is_allowed_origin(
            "https://demo.ngrok-free.app.evil.example"
        ));
        assert!(!is_allowed_origin("https://other.ngrok-free.app"));

        let mut state = SHARE_STATE.lock().unwrap();
        state.ngrok_url = previous;
    }

    fn extract_api_routes_from_routing_source() -> Vec<(Method, String)> {
        // Keep this in sync with routing behavior without hand-maintaining a list.
        // We parse `.route(...)` calls in `routing.rs` and extract (method, path).
        let src = include_str!("http_server/routing.rs");
        let mut routes = Vec::new();

        let mut i = 0usize;
        while let Some(found) = src[i..].find(".route(") {
            let start = i + found + ".route(".len();
            let bytes = src.as_bytes();
            let mut depth = 1i32;
            let mut j = start;
            while j < bytes.len() && depth > 0 {
                match bytes[j] as char {
                    '(' => depth += 1,
                    ')' => depth -= 1,
                    _ => {}
                }
                j += 1;
            }
            if depth != 0 {
                break;
            }

            // `.route(<call>)` contents:
            let call = &src[start..(j - 1)];

            // Extract first string literal as the path.
            let q1 = match call.find('"') {
                Some(x) => x,
                None => {
                    i = j;
                    continue;
                }
            };
            let q2 = match call[q1 + 1..].find('"') {
                Some(x) => q1 + 1 + x,
                None => {
                    i = j;
                    continue;
                }
            };
            let path = call[q1 + 1..q2].to_string();

            // Determine HTTP method by looking for `get(` / `post(` inside the call.
            let method = if call.contains("get(") {
                Method::GET
            } else if call.contains("post(") {
                Method::POST
            } else {
                i = j;
                continue;
            };

            if path.starts_with("/api/") {
                routes.push((method, path));
            }

            i = j;
        }

        // Stable order makes failures easier to read.
        routes.sort_by(|a, b| a.1.cmp(&b.1));
        routes
    }

    #[tokio::test]
    async fn auth_middleware_rejects_unauthenticated_protected_route() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();

        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 31001)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/get_share_state")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-session-id", "unauth-session")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_middleware_allows_authenticated_protected_route() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap()
            .insert("auth-session".to_string());

        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 31002)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/get_share_state")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-session-id", "auth-session")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn localhost_only_middleware_blocks_remote_clients() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::without_password();

        let response = request_with_addr(
            SocketAddr::from(([203, 0, 113, 9], 32001)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/get_ngrok_token")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn localhost_only_middleware_blocks_forwarded_loopback_clients() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::without_password();

        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 32003)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/get_ngrok_token")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "203.0.113.9")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn localhost_only_middleware_allows_loopback_clients() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::without_password();

        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 32002)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/get_ngrok_token")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn auth_challenge_requires_configured_salt() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::without_password();

        {
            let mut state = SHARE_STATE.lock().unwrap();
            state.active = true;
            state.auth_key = Some(b"test-auth-key".to_vec());
            state.auth_salt = None;
        }

        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 33001)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/challenge")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn auth_challenge_rate_limits_after_five_attempts() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();

        for attempt in 1..=6 {
            let response = request_with_addr(
                SocketAddr::from(([127, 0, 0, 1], 33002)),
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/challenge")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await;

            let expected = if attempt < 6 {
                StatusCode::OK
            } else {
                StatusCode::TOO_MANY_REQUESTS
            };
            assert_eq!(response.status(), expected);
        }
    }

    #[tokio::test]
    async fn auth_verify_accepts_valid_proof_and_rejects_nonce_reuse() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();

        let (_status, challenge) = request_json(
            SocketAddr::from(([127, 0, 0, 1], 33003)),
            "/api/auth/challenge",
            json!({}),
            None,
        )
        .await;

        let nonce = challenge["nonce"].as_str().unwrap().to_string();
        let proof = build_proof_hex(b"test-auth-key", &nonce);

        let verify_response = request_json(
            SocketAddr::from(([127, 0, 0, 1], 33003)),
            "/api/auth/verify",
            json!({ "nonce": nonce, "proof": proof }),
            Some("test-agent/1.0"),
        )
        .await;
        assert_eq!(verify_response.0, StatusCode::OK);

        let second_response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 33003)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/verify")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "nonce": nonce, "proof": proof }).to_string(),
                ))
                .unwrap(),
        )
        .await;

        assert_eq!(second_response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_verify_rejects_bad_proof() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();

        let (_status, challenge) = request_json(
            SocketAddr::from(([127, 0, 0, 1], 33005)),
            "/api/auth/challenge",
            json!({}),
            None,
        )
        .await;
        let nonce = challenge["nonce"].as_str().unwrap().to_string();

        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 33005)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/verify")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "nonce": nonce, "proof": "00" }).to_string(),
                ))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn auth_verify_replaces_stale_sessions_from_same_ip() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();

        CONNECTED_CLIENTS.lock().unwrap().insert(
            "stale-session".to_string(),
            crate::ConnectedClient {
                session_id: "stale-session".to_string(),
                ip: "127.0.0.1".to_string(),
                user_agent: "old".to_string(),
                authenticated_at: "2026-04-12T00:00:00Z".to_string(),
                last_active: "2026-04-12T00:00:00Z".to_string(),
                ws_connected: false,
            },
        );
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap()
            .insert("stale-session".to_string());

        let (_status, challenge) = request_json(
            SocketAddr::from(([127, 0, 0, 1], 33004)),
            "/api/auth/challenge",
            json!({}),
            None,
        )
        .await;
        let nonce = challenge["nonce"].as_str().unwrap().to_string();
        let proof = build_proof_hex(b"test-auth-key", &nonce);

        let (status, body) = request_json(
            SocketAddr::from(([127, 0, 0, 1], 33004)),
            "/api/auth/verify",
            json!({ "nonce": nonce, "proof": proof }),
            Some("test-agent/1.0"),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let new_session = body["sessionId"].as_str().unwrap();
        assert!(!AUTHENTICATED_SESSIONS
            .lock()
            .unwrap()
            .contains("stale-session"));
        assert!(AUTHENTICATED_SESSIONS.lock().unwrap().contains(new_session));
    }

    #[tokio::test]
    async fn api_router_smoke_all_routes_exist_and_do_not_500() {
        let _serial = lock_test_mutex();
        // Turn on auth so most `/api/*` endpoints short-circuit at middleware and don't
        // execute handler logic (avoids IO/network side effects while still proving routing).
        let _guard = ShareStateTestGuard::with_auth_enabled();

        let routes = extract_api_routes_from_routing_source();
        assert!(
            !routes.is_empty(),
            "expected to extract /api routes from routing.rs"
        );

        let addr = SocketAddr::from(([127, 0, 0, 1], 12345));

        for (method, path) in routes {
            // Build router with cert enabled so `/api/cert.pem` exists.
            let make_svc = create_router(Some("dummy-cert-pem".to_string()))
                .into_make_service_with_connect_info::<SocketAddr>();

            let svc = make_svc
                .oneshot(addr)
                .await
                .expect("make_service should succeed");

            let mut builder = Request::builder()
                .method(method.clone())
                .uri(&path)
                .header("x-session-id", "test-session");

            // For POST routes, send an empty JSON body so Json extractors fail fast where present.
            let req = if method == Method::POST {
                builder = builder.header(header::CONTENT_TYPE, "application/json");
                builder.body(Body::empty()).unwrap()
            } else {
                builder.body(Body::empty()).unwrap()
            };

            let resp = svc.oneshot(req).await.expect("request should succeed");
            let status = resp.status();

            assert_ne!(
                status,
                StatusCode::NOT_FOUND,
                "route missing: {} {}",
                method,
                path
            );
            assert_ne!(
                status,
                StatusCode::INTERNAL_SERVER_ERROR,
                "route crashed (500): {} {}",
                method,
                path
            );
        }
    }
}

pub fn create_router(cert_pem: Option<String>) -> Router {
    let cors = build_cors_layer();
    let dist_path = resolve_dist_path();
    let serve_dir = ServeDir::new(&dist_path)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(dist_path.join("index.html")));

    build_api_router(cert_pem)
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(localhost_only_middleware))
        .layer(axum::middleware::from_fn(security_headers_middleware))
        .layer(RequestBodyLimitLayer::new(1024 * 1024))
        .fallback_service(serve_dir)
        .layer(axum::middleware::from_fn(no_cache_html_middleware))
        .layer(cors)
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

/// Start the server with graceful shutdown support.
///
/// When `tls_certs` is Some (sharing mode):
///   Single port — localhost connections get plain HTTP, LAN connections get HTTPS.
/// When `tls_certs` is None:
///   Plain HTTP for everyone (e.g. dev mode).
pub async fn start_server(
    port: u16,
    mut shutdown_rx: tokio::sync::watch::Receiver<bool>,
    tls_certs: Option<TlsCerts>,
) {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    log::info!("[http-server] Starting server on {}", addr);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("[http-server] Failed to bind server on {}: {}", addr, e);
            return;
        }
    };

    match tls_certs {
        Some(certs) => {
            // Dual-protocol: HTTP for localhost, HTTPS for LAN — same port
            log::info!(
                "[http-server] Server on {} (localhost: HTTP, LAN: HTTPS)",
                addr
            );

            let app = create_router(Some(certs.cert_pem.clone()));

            let cert_chain: Vec<rustls_pki_types::CertificateDer<'static>> = {
                let mut reader = std::io::BufReader::new(certs.cert_pem.as_bytes());
                rustls_pemfile::certs(&mut reader)
                    .filter_map(|r| r.ok())
                    .collect()
            };
            let key_der = {
                let mut reader = std::io::BufReader::new(certs.key_pem.as_bytes());
                rustls_pemfile::private_key(&mut reader)
                    .expect("Failed to parse private key PEM")
                    .expect("No private key found in PEM")
            };

            let mut tls_config = rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(cert_chain, key_der)
                .expect("Failed to build TLS ServerConfig");
            // ALPN: HTTP/1.1 only (h2 doesn't support traditional WebSocket upgrade)
            tls_config.alpn_protocols = vec![b"http/1.1".to_vec()];
            let tls_acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(tls_config));

            loop {
                tokio::select! {
                    _ = shutdown_rx.changed() => {
                        log::info!("[http-server] Server shutting down gracefully");
                        break;
                    }
                    result = listener.accept() => {
                        let (tcp_stream, remote_addr) = match result {
                            Ok(v) => v,
                            Err(e) => {
                                log::warn!("TCP accept error: {}", e);
                                continue;
                            }
                        };

                        let app = app.clone();

                        if remote_addr.ip().is_loopback() {
                            // Localhost → plain HTTP/1.1 (with WebSocket upgrade support)
                            tokio::spawn(async move {
                                let io = hyper_util::rt::TokioIo::new(tcp_stream);
                                let service = hyper::service::service_fn(move |mut req: hyper::Request<hyper::body::Incoming>| {
                                    req.extensions_mut().insert(ConnectInfo(remote_addr));
                                    let mut app = app.clone();
                                    async move {
                                        use tower::Service;
                                        app.call(req).await
                                    }
                                });
                                if let Err(e) = hyper::server::conn::http1::Builder::new()
                                    .keep_alive(true)
                                    .serve_connection(io, service)
                                    .with_upgrades()
                                    .await
                                {
                                    let msg = e.to_string();
                                    if !msg.contains("connection closed") && !msg.contains("reset") {
                                        log::warn!("HTTP connection error from {}: {}", remote_addr, e);
                                    }
                                }
                            });
                        } else {
                            // LAN → TLS handshake → HTTPS (h2 or h1.1 via ALPN)
                            let acceptor = tls_acceptor.clone();
                            tokio::spawn(async move {
                                let tls_stream = match acceptor.accept(tcp_stream).await {
                                    Ok(s) => s,
                                    Err(e) => {
                                        // Expected when LAN client tries plain HTTP
                                        log::debug!("TLS handshake failed from {}: {}", remote_addr, e);
                                        return;
                                    }
                                };
                                let io = hyper_util::rt::TokioIo::new(tls_stream);
                                let service = hyper::service::service_fn(move |mut req: hyper::Request<hyper::body::Incoming>| {
                                    req.extensions_mut().insert(ConnectInfo(remote_addr));
                                    let mut app = app.clone();
                                    async move {
                                        use tower::Service;
                                        app.call(req).await
                                    }
                                });
                                // HTTPS with HTTP/1.1 keep-alive + WebSocket upgrade support
                                // (h2 doesn't support traditional WebSocket upgrade)
                                if let Err(e) = hyper::server::conn::http1::Builder::new()
                                    .keep_alive(true)
                                    .serve_connection(io, service)
                                    .with_upgrades()
                                    .await
                                {
                                    let msg = e.to_string();
                                    if !msg.contains("connection closed") && !msg.contains("reset") {
                                        log::warn!("HTTPS connection error from {}: {}", remote_addr, e);
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }
        None => {
            // Pure HTTP mode
            log::info!("[http-server] HTTP server listening on http://{}", addr);
            let app = create_router(None);

            if let Err(e) = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.changed().await;
                log::info!("[http-server] HTTP server shutting down");
            })
            .await
            {
                log::error!("[http-server] HTTP server error: {}", e);
            }
        }
    }
}

// MCP config management
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct McpConfig {
    pub version: String,
    pub http_port: u16,
    pub installed_at: String,
    pub capability_level: String,
}

pub fn get_mcp_config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join(".config")
        .join("worktree-manager")
        .join("mcp.json")
}

pub fn load_mcp_config() -> Option<McpConfig> {
    let path = get_mcp_config_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    } else {
        None
    }
}

pub fn save_mcp_config(config: &McpConfig) -> Result<(), String> {
    let path = get_mcp_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Start the MCP HTTP server on the specified port.
/// This runs as a background task.
pub async fn start_mcp_server(port: u16) -> Result<(), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    // Save MCP config
    let config = McpConfig {
        version: env!("CARGO_PKG_VERSION").to_string(),
        http_port: port,
        installed_at: chrono::Utc::now().to_rfc3339(),
        capability_level: "core".to_string(),
    };
    save_mcp_config(&config)?;

    log::info!("[MCP] Starting HTTP server on {}", addr);

    let router = build_api_router(None);

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind MCP server: {}", e))?;

    serve(listener, router)
        .await
        .map_err(|e| format!("MCP server error: {}", e))?;

    Ok(())
}
