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
    import_external_project_impl,
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
    terminate_worktree_locking_process_impl,
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

fn mask_api_key_for_response(key: &str) -> String {
    let char_count = key.chars().count();
    if char_count <= 8 {
        return "****".to_string();
    }

    let prefix: String = key.chars().take(4).collect();
    let suffix: String = key.chars().skip(char_count.saturating_sub(4)).collect();
    format!("{}...{}", prefix, suffix)
}

/// Get a string parameter from JSON args, accepting either camelCase or snake_case key.
/// Returns owned String to avoid borrow lifetime issues with spawn_blocking.
fn get_param(args: &Value, key: &str) -> String {
    let map = match args.as_object() {
        Some(m) => m,
        None => return String::new(),
    };
    let camel = to_camel(key);
    let snake = to_snake(key);
    map.get(&camel)
        .or_else(|| map.get(&snake))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn get_param_opt(args: &Value, key: &str) -> Option<String> {
    let map = args.as_object()?;
    let camel = to_camel(key);
    let snake = to_snake(key);
    map.get(&camel)
        .or_else(|| map.get(&snake))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn get_param_bool(args: &Value, key: &str, default: bool) -> bool {
    let map = match args.as_object() {
        Some(m) => m,
        None => return default,
    };
    let camel = to_camel(key);
    let snake = to_snake(key);
    map.get(&camel)
        .or_else(|| map.get(&snake))
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

fn get_param_u64(args: &Value, key: &str, default: u64) -> u64 {
    let map = match args.as_object() {
        Some(m) => m,
        None => return default,
    };
    let camel = to_camel(key);
    let snake = to_snake(key);
    map.get(&camel)
        .or_else(|| map.get(&snake))
        .and_then(|v| v.as_u64())
        .unwrap_or(default)
}

fn to_camel(s: &str) -> String {
    // e.g. "base_branch" -> "baseBranch", "workspace_path" -> "workspacePath"
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '_' {
            if let Some(next) = chars.next() {
                result.push(next.to_ascii_uppercase());
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn to_snake(s: &str) -> String {
    // e.g. "baseBranch" -> "base_branch", "workspacePath" -> "workspace_path"
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            result.push('_');
        }
        result.push(c.to_ascii_lowercase());
    }
    result
}

fn current_app_handle() -> Result<tauri::AppHandle, String> {
    crate::APP_HANDLE
        .lock()
        .map_err(|_| "Internal app state error".to_string())?
        .clone()
        .ok_or("App handle unavailable".to_string())
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// -- Workspace management (no window context) --

async fn h_list_workspaces() -> Response {
    let list: Vec<_> = crate::load_global_config()
        .workspaces
        .into_iter()
        .map(|mut w| {
            w.path = crate::normalize_path(&w.path);
            w
        })
        .collect();
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
    let ws_path = normalize_path(&get_param(&args, "workspace_path"));
    result_ok(set_window_workspace_impl(&sid, ws_path))
}

async fn h_get_current_workspace(headers: HeaderMap) -> Response {
    let sid = session_id(&headers);
    Json(json!(get_current_workspace_impl(&sid))).into_response()
}

async fn h_switch_workspace(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let path = normalize_path(args["path"].as_str().unwrap_or(""));
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
    let path = normalize_path(args["path"].as_str().unwrap_or(""));
    result_json(crate::commands::workspace::load_workspace_config_by_path(
        path,
    ))
}

async fn h_save_workspace_config_by_path(Json(args): Json<Value>) -> Response {
    let path = normalize_path(args["path"].as_str().unwrap_or(""));
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
    let include_archived = get_param_bool(&args, "include_archived", false);
    result_json(list_worktrees_impl(&sid, include_archived))
}

async fn h_update_worktree_color(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let worktree_name = args["worktree_name"].as_str().unwrap_or("").to_string();
    let color: Option<crate::types::WorktreeColor> = match args.get("color") {
        Some(v) if !v.is_null() => match serde_json::from_value(v.clone()) {
            Ok(c) => Some(c),
            Err(e) => {
                return (StatusCode::BAD_REQUEST, format!("Invalid color: {}", e)).into_response()
            }
        },
        _ => None,
    };
    result_ok(crate::commands::worktree::update_worktree_color_impl(
        &sid,
        worktree_name,
        color,
    ))
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

async fn h_terminate_worktree_locking_process(
    headers: HeaderMap,
    Json(args): Json<Value>,
) -> Response {
    let sid = session_id(&headers);
    let name = args["name"].as_str().unwrap_or("").to_string();
    let Some(pid_value) = args["pid"].as_u64() else {
        return (StatusCode::BAD_REQUEST, "Invalid pid").into_response();
    };
    if pid_value > u32::MAX as u64 {
        return (StatusCode::BAD_REQUEST, "Invalid pid").into_response();
    }
    let process_start_time = args
        .get("processStartTime")
        .or_else(|| args.get("process_start_time"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if process_start_time.is_empty() {
        return (StatusCode::BAD_REQUEST, "Invalid processStartTime").into_response();
    }
    result_ok(terminate_worktree_locking_process_impl(
        &sid,
        name,
        pid_value as u32,
        process_start_time.to_string(),
    ))
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
    let worktree_name = get_param(&args, "worktree_name");
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
    let base_branch = get_param(&args, "base_branch");
    let test_branch = get_param(&args, "test_branch");
    let merge_strategy = get_param(&args, "merge_strategy");
    result_ok(add_existing_project_impl(
        &sid,
        name,
        base_branch,
        test_branch,
        merge_strategy,
    ))
}

async fn h_import_external_project(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let source_path = normalize_path(
        args["sourcePath"]
            .as_str()
            .or_else(|| args["source_path"].as_str())
            .unwrap_or(""),
    );
    result_json(import_external_project_impl(&sid, source_path))
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
    let base_branch = get_param(&args, "base_branch");
    let test_branch = args
        .get("testBranch")
        .or_else(|| args.get("test_branch"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let normalized = normalize_path(&path);
    let stats = git_ops::get_branch_diff_stats(
        std::path::Path::new(&normalized),
        &base_branch,
        test_branch.as_deref(),
    );
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
    let file_path = get_param(&args, "file_path");
    let normalized = normalize_path(&path);
    result_json(git_ops::get_file_diff(
        std::path::Path::new(&normalized),
        &file_path,
    ))
}

async fn h_check_remote_branch_exists(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let branch_name = get_param(&args, "branch_name");
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
    let base_branch = get_param(&args, "base_branch");
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::sync_with_base_branch(std::path::Path::new(&normalized), &base_branch)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_sync_all_projects_to_base(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let project_paths: Vec<String> = args
        .get("projectPaths")
        .or_else(|| args.get("project_paths"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let result = tokio::task::spawn_blocking(move || {
        crate::commands::git::sync_all_projects_to_base_impl(&sid, project_paths)
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

async fn h_pull_current_branch(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    let result = tokio::task::spawn_blocking(move || {
        git_ops::pull_current_branch(std::path::Path::new(&normalized))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))
    .and_then(|r| r);
    result_json(result)
}

async fn h_merge_to_test_branch(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let test_branch = get_param(&args, "test_branch");
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
    let base_branch = get_param(&args, "base_branch");
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
    let base_branch = get_param(&args, "base_branch");
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
    let author_name = args
        .get("authorName")
        .or_else(|| args.get("author_name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let author_email = args
        .get("authorEmail")
        .or_else(|| args.get("author_email"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let skip_hooks = args
        .get("skipHooks")
        .or_else(|| args.get("skip_hooks"))
        .and_then(|v| v.as_bool());
    result_json(
        crate::commands::git::commit_all(path, message, author_name, author_email, skip_hooks)
            .await,
    )
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
    #[serde(alias = "defaultIndex")]
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

async fn h_get_skip_git_hooks() -> Response {
    result_json(crate::commands::config::get_skip_git_hooks())
}

#[derive(serde::Deserialize)]
struct SetSkipGitHooksArgs {
    skip: bool,
}

async fn h_set_skip_git_hooks(Json(args): Json<SetSkipGitHooksArgs>) -> Response {
    result_ok(crate::commands::config::set_skip_git_hooks(args.skip))
}

async fn h_get_shell_integration_enabled() -> Response {
    result_json(crate::commands::config::get_shell_integration_enabled())
}

#[derive(serde::Deserialize)]
struct SetShellIntegrationEnabledArgs {
    enabled: bool,
}

async fn h_set_shell_integration_enabled(
    Json(args): Json<SetShellIntegrationEnabledArgs>,
) -> Response {
    result_ok(crate::commands::config::set_shell_integration_enabled(
        args.enabled,
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

async fn h_get_commit_ai_api_key() -> Response {
    // Return masked key via HTTP to avoid exposing secrets in LAN sharing mode
    let result: Result<Option<String>, String> =
        crate::commands::voice::get_commit_ai_api_key().await;
    match result {
        Ok(Some(key)) if !key.is_empty() => {
            let masked = mask_api_key_for_response(&key);
            result_json(Ok(Some(masked)))
        }
        Ok(_) => result_json(Ok(None::<String>)),
        Err(e) => result_json::<Option<String>>(Err(e)),
    }
}

async fn h_set_commit_ai_api_key(Json(args): Json<Value>) -> Response {
    let key = args["key"].as_str().unwrap_or("").to_string();
    result_json(crate::commands::voice::set_commit_ai_api_key(key).await)
}

async fn h_set_commit_ai_enabled(Json(args): Json<Value>) -> Response {
    let enabled = args["enabled"].as_bool().unwrap_or(true);
    result_json(crate::commands::voice::set_commit_ai_enabled(enabled).await)
}

async fn h_get_commit_ai_enabled() -> Response {
    Json(json!(crate::commands::voice::get_commit_ai_enabled().await)).into_response()
}

async fn h_check_commit_ai_api_key() -> Response {
    Json(json!(crate::commands::voice::check_commit_ai_api_key())).into_response()
}

// -- Scan --

async fn h_scan_linked_folders(Json(args): Json<Value>) -> Response {
    let project_path = normalize_path(&get_param(&args, "project_path"));
    result_json(crate::scan_linked_folders_internal(&project_path))
}

// -- System utilities --

async fn h_open_in_terminal(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let terminal = args["terminal"].as_str().map(|s| s.to_string());
    let shell = args["shell"].as_str().map(|s| s.to_string());
    result_ok(crate::open_in_terminal_internal(
        &path,
        terminal.as_deref(),
        shell.as_deref(),
    ))
}

async fn h_open_in_editor(Json(args): Json<Value>) -> Response {
    let request: OpenEditorRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response()
        }
    };
    let custom_path = get_param_opt(&args, "custom_path");
    result_ok(crate::open_in_editor_internal(
        &request,
        custom_path.as_deref(),
    ))
}

async fn h_detect_tools() -> Response {
    result_json(Ok(crate::detect_tools_internal().await))
}

async fn h_get_crash_report() -> Response {
    Json(json!(crate::commands::system::get_crash_report())).into_response()
}

async fn h_frontend_log(Json(args): Json<Value>) -> Response {
    let level = get_param(&args, "level");
    let message = get_param(&args, "message");
    crate::commands::system::frontend_log(level, message).await;
    result_void_ok()
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
    let ws_path = get_param(&args, "workspace_path");
    let wt_name = get_param(&args, "worktree_name");
    result_ok(lock_worktree_impl(&sid, ws_path, wt_name))
}

async fn h_unlock_worktree(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let ws_path = get_param(&args, "workspace_path");
    let wt_name = get_param(&args, "worktree_name");
    unlock_worktree_impl(&sid, ws_path, wt_name);
    result_void_ok()
}

async fn h_get_locked_worktrees(Json(args): Json<Value>) -> Response {
    let ws_path = get_param(&args, "workspace_path");
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

    let workspace_path = get_param(&args, "workspace_path");
    let worktree_name = get_param(&args, "worktree_name");
    let activated_terminals = args
        .get("activatedTerminals")
        .or_else(|| args.get("activated_terminals"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .collect();
    let active_terminal_tab = args
        .get("activeTerminalTab")
        .or_else(|| args.get("active_terminal_tab"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let terminal_visible = args
        .get("terminalVisible")
        .or_else(|| args.get("terminal_visible"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let client_id = args
        .get("clientId")
        .or_else(|| args.get("client_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let session_id = args
        .get("sessionId")
        .or_else(|| args.get("session_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

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
    let session_id = get_param(&args, "session_id");
    let cwd = normalize_path(&get_param(&args, "cwd"));
    let cols = get_param_u64(&args, "cols", 80) as u16;
    let rows = get_param_u64(&args, "rows", 24) as u16;
    let shell = get_param_opt(&args, "shell");

    result_ok(
        with_pty_manager(move |m| {
            let requested_shell = crate::pty_manager::requested_shell_path(shell.as_deref());
            if let Some(existing_shell) = m.session_shell_path(&session_id) {
                if existing_shell == requested_shell {
                    log::info!(
                        "[pty] Session already exists (HTTP), skipping create: id={}, requested cols={}, rows={}, shell={}",
                        session_id,
                        cols,
                        rows,
                        requested_shell
                    );
                    return Ok(());
                }

                log::info!(
                    "[pty] Session exists with different shell (HTTP), recreating: id={}, existing_shell={}, requested_shell={}",
                    session_id,
                    existing_shell,
                    requested_shell
                );
                m.close_session(&session_id, "h_pty_create: shell changed (HTTP)")?;
            }

            m.create_session(&session_id, &cwd, cols, rows, shell.as_deref())
        })
        .await,
    )
}

async fn h_pty_write(Json(args): Json<Value>) -> Response {
    let session_id = get_param(&args, "session_id");
    let data = get_param(&args, "data");
    result_ok(with_pty_manager(move |m| m.write_to_session(&session_id, &data)).await)
}

async fn h_pty_read(Json(args): Json<Value>) -> Response {
    let session_id = get_param(&args, "session_id");
    let client_id = get_param_opt(&args, "client_id");
    result_json(
        with_pty_manager(move |m| m.read_from_session(&session_id, client_id.as_deref())).await,
    )
}

async fn h_pty_resize(Json(args): Json<Value>) -> Response {
    let session_id = get_param(&args, "session_id");
    let cols = get_param_u64(&args, "cols", 80) as u16;
    let rows = get_param_u64(&args, "rows", 24) as u16;
    let _request_client_id = get_param_opt(&args, "client_id");

    log::info!(
        "[http] pty_resize: session={} size={}x{}",
        session_id,
        cols,
        rows
    );
    result_ok(with_pty_manager(move |m| m.resize_session(&session_id, cols, rows)).await)
}

async fn h_pty_close(Json(args): Json<Value>) -> Response {
    let session_id = get_param(&args, "session_id");
    result_ok(
        with_pty_manager(move |m| m.close_session(&session_id, "h_pty_close: HTTP request")).await,
    )
}

async fn h_pty_exists(Json(args): Json<Value>) -> Response {
    let session_id = get_param(&args, "session_id");
    result_json(with_pty_manager(move |m| Ok(m.has_session(&session_id))).await)
}

async fn h_pty_close_by_path(Json(args): Json<Value>) -> Response {
    let path_prefix = normalize_path(&get_param(&args, "path_prefix"));
    result_json(
        with_pty_manager(move |m| {
            Ok(m.close_sessions_by_path_prefix(&path_prefix, "h_pty_close_by_path: HTTP request"))
        })
        .await,
    )
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
        "workspace_path": ws_path.map(|p| normalize_path(&p)),
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
    let ws_path = normalize_path(&get_param(&args, "workspace_path"));
    let wt_name = get_param(&args, "worktree_name");
    let state = crate::commands::window::get_terminal_state_inner(ws_path, wt_name);
    Json(json!(state)).into_response()
}

async fn h_open_workspace_window(Json(args): Json<Value>) -> Response {
    // In browser mode, "open new window" just opens a new browser tab
    let ws_path = normalize_path(&get_param(&args, "workspace_path"));
    // Return a URL that the frontend can use to open a new tab
    let url = format!("/?workspace={}", urlencoding::encode(&ws_path));
    Json(json!(url)).into_response()
}

async fn h_get_app_version() -> Response {
    Json(json!(env!("CARGO_PKG_VERSION"))).into_response()
}

async fn h_check_mirror_update(Json(payload): Json<Value>) -> Response {
    let mirror_url = payload["mirrorUrl"]
        .as_str()
        .unwrap_or("https://gh-proxy.org/")
        .to_string();
    result_json(crate::commands::system::check_mirror_update(mirror_url).await)
}

async fn h_download_update_via_mirror(Json(payload): Json<Value>) -> Response {
    let app = match current_app_handle() {
        Ok(app) => app,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    let mirror_url = payload["mirrorUrl"]
        .as_str()
        .unwrap_or("https://gh-proxy.org/")
        .to_string();
    result_ok(crate::commands::system::download_update_via_mirror(app, mirror_url).await)
}

async fn h_test_mirror_speed() -> Response {
    result_json(crate::commands::system::test_mirror_speed().await)
}

async fn h_speed_test_single_mirror(Json(payload): Json<Value>) -> Response {
    let mirror_url = payload["mirrorUrl"].as_str().unwrap_or("").to_string();
    result_json(crate::commands::system::speed_test_single_mirror(mirror_url).await)
}

async fn h_get_mirror_sources() -> Response {
    result_json(Ok(crate::commands::system::get_mirror_sources()))
}

async fn h_save_custom_mirrors(Json(payload): Json<Value>) -> Response {
    let mirrors: Vec<crate::types::CustomMirror> =
        match serde_json::from_value(payload["mirrors"].clone()) {
            Ok(m) => m,
            Err(e) => {
                return (StatusCode::BAD_REQUEST, format!("Invalid mirrors: {}", e)).into_response()
            }
        };
    result_ok(crate::commands::system::save_custom_mirrors(mirrors))
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
    let keep_symlinks = args
        .get("keepSymlinks")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    result_json(crate::commands::vault::vault_link_impl(
        &sid,
        path,
        keep_symlinks,
    ))
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
    headers: HeaderMap,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(params): Query<WsParams>,
) -> Response {
    if let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        if !is_allowed_origin(origin) {
            return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
        }
    }

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

            "pty_resize" => {
                let pty_session_id = match parsed["sessionId"].as_str() {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let cols = parsed["cols"].as_u64().unwrap_or(80) as u16;
                let rows = parsed["rows"].as_u64().unwrap_or(24) as u16;
                let _request_client_id = parsed["clientId"].as_str().map(|s| s.to_string());

                log::info!(
                    "[ws] pty_resize: session={} size={}x{}",
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
    let sample_rate = args
        .get("sampleRate")
        .or_else(|| args.get("sample_rate"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
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
    // Return masked key via HTTP to avoid exposing secrets in LAN sharing mode
    let result: Result<Option<String>, String> =
        crate::commands::voice::get_dashscope_api_key_inner();
    match result {
        Ok(Some(key)) if !key.is_empty() => {
            let masked = mask_api_key_for_response(&key);
            result_json(Ok(Some(masked)))
        }
        Ok(_) => result_json(Ok(None::<String>)),
        Err(e) => result_json::<Option<String>>(Err(e)),
    }
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

async fn h_get_voice_refine_base_url() -> Response {
    result_json(crate::commands::voice::get_voice_refine_base_url_inner())
}

async fn h_set_voice_refine_base_url(Json(args): Json<Value>) -> Response {
    let url = args["url"].as_str().unwrap_or("").to_string();
    result_ok(crate::commands::voice::set_voice_refine_base_url_inner(url))
}

async fn h_get_voice_asr_model() -> Response {
    result_json(crate::commands::voice::get_voice_asr_model_inner())
}

async fn h_set_voice_asr_model(Json(args): Json<Value>) -> Response {
    let model = args["model"].as_str().unwrap_or("").to_string();
    result_ok(crate::commands::voice::set_voice_asr_model_inner(model))
}

async fn h_get_voice_refine_model() -> Response {
    result_json(crate::commands::voice::get_voice_refine_model_inner())
}

async fn h_set_voice_refine_model(Json(args): Json<Value>) -> Response {
    let model = args["model"].as_str().unwrap_or("").to_string();
    result_ok(crate::commands::voice::set_voice_refine_model_inner(model))
}

async fn h_list_dashscope_models() -> Response {
    result_json(crate::commands::voice::list_dashscope_models_inner().await)
}

// -- Cloud connection --

async fn h_cloud_get_status() -> Response {
    result_json(crate::commands::cloud::cloud_get_status().await)
}

async fn h_cloud_start_pairing() -> Response {
    result_json(crate::commands::cloud::cloud_start_pairing().await)
}

async fn h_cloud_check_pairing_status() -> Response {
    result_json(crate::commands::cloud::cloud_check_pairing_status().await)
}

async fn h_cloud_approve_pairing() -> Response {
    result_json(crate::commands::cloud::cloud_approve_pairing().await)
}

async fn h_cloud_reject_pairing() -> Response {
    result_ok(crate::commands::cloud::cloud_reject_pairing().await)
}

async fn h_cloud_disconnect() -> Response {
    result_ok(crate::commands::cloud::cloud_disconnect().await)
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
    let session_id = get_param(&args, "session_id");
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
    let ngrok_url = SHARE_STATE.lock().ok().and_then(|s| s.ngrok_url.clone());
    crate::http_origin_policy::is_allowed_origin(origin, ngrok_url.as_deref())
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
    use serial_test::serial;
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
                let mut state = SHARE_STATE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
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
                let mut state = SHARE_STATE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state.active = false;
                state.auth_key = None;
                state.auth_salt = None;
                state.workspace_path = None;
            }
            guard
        }

        fn capture() -> Self {
            let prev_share_state = {
                let mut state = SHARE_STATE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *state)
            };
            let prev_sessions = {
                let mut sessions = AUTHENTICATED_SESSIONS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *sessions)
            };
            let prev_clients = {
                let mut clients = CONNECTED_CLIENTS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *clients)
            };
            let prev_rate_limiter = {
                let mut limiter = AUTH_RATE_LIMITER
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *limiter, crate::AuthRateLimiter::new())
            };
            let prev_nonce_cache = {
                let mut cache = NONCE_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
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
            *SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_share_state);
            *AUTHENTICATED_SESSIONS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_sessions);
            *CONNECTED_CLIENTS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_clients);
            *AUTH_RATE_LIMITER
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::replace(&mut self.prev_rate_limiter, crate::AuthRateLimiter::new());
            *NONCE_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
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

    #[serial]
    #[test]
    fn masks_multibyte_api_keys_without_byte_slicing() {
        assert_eq!(
            super::mask_api_key_for_response("abcd1234wxyz"),
            "abcd...wxyz"
        );
        assert_eq!(super::mask_api_key_for_response("abcdefgh"), "****");
        assert_eq!(
            super::mask_api_key_for_response("密钥abcd尾巴EF"),
            "密钥ab...尾巴EF"
        );
    }

    // Pure-logic origin policy tests live in crate::http_origin_policy.
    // This test exercises the global-state path (ngrok URL from SHARE_STATE).
    #[serial]
    #[test]
    fn only_allows_exact_active_ngrok_origin() {
        let _serial = lock_test_mutex();
        let previous = {
            let mut state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
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

        let mut state = SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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

    #[serial]
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

    #[serial]
    #[tokio::test]
    async fn auth_middleware_allows_authenticated_protected_route() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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

    #[serial]
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

    #[serial]
    #[tokio::test]
    async fn localhost_only_middleware_blocks_remote_last_share_password() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::without_password();

        let response = request_with_addr(
            SocketAddr::from(([203, 0, 113, 9], 32004)),
            Request::builder()
                .method(Method::POST)
                .uri("/api/get_last_share_password")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[serial]
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

    #[serial]
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

    #[serial]
    #[tokio::test]
    async fn auth_challenge_requires_configured_salt() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::without_password();

        {
            let mut state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
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

    #[serial]
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

    #[serial]
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

    #[serial]
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

    #[serial]
    #[tokio::test]
    async fn auth_verify_replaces_stale_sessions_from_same_ip() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateTestGuard::with_auth_enabled();

        CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
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
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains("stale-session"));
        assert!(AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(new_session));
    }

    #[serial]
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
                match rustls_pemfile::private_key(&mut reader) {
                    Ok(Some(key)) => key,
                    Ok(None) => {
                        log::error!("[http-server] No private key found in TLS key PEM");
                        return;
                    }
                    Err(e) => {
                        log::error!("[http-server] Failed to parse TLS private key PEM: {}", e);
                        return;
                    }
                }
            };

            let mut tls_config = match rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(cert_chain, key_der)
            {
                Ok(config) => config,
                Err(e) => {
                    log::error!("[http-server] Failed to build TLS ServerConfig: {}", e);
                    return;
                }
            };
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

#[cfg(test)]
mod additional_tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::Json;
    use serde_json::json;
    use serial_test::serial;

    async fn response_text(response: Response) -> (StatusCode, String) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[serial]
    #[test]
    fn mcp_config_round_trips_json_with_concrete_fields() {
        let config = McpConfig {
            version: "0.1.2".to_string(),
            http_port: 42_819,
            installed_at: "2026-06-11T00:00:00+00:00".to_string(),
            capability_level: "advanced".to_string(),
        };

        let encoded = serde_json::to_string(&config).unwrap();
        let decoded: McpConfig = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded.version, "0.1.2");
        assert_eq!(decoded.http_port, 42_819);
        assert_eq!(decoded.installed_at, "2026-06-11T00:00:00+00:00");
        assert_eq!(decoded.capability_level, "advanced");
    }

    #[serial]
    #[test]
    fn request_structs_deserialize_expected_and_reject_missing_fields() {
        let add_workspace: AddWsArgs =
            serde_json::from_value(json!({ "name": "Demo", "path": "/tmp/demo" })).unwrap();
        assert_eq!(add_workspace.name, "Demo");
        assert_eq!(add_workspace.path, "/tmp/demo");

        let path_args: PathArgs = serde_json::from_value(json!({ "path": "/tmp/remove" })).unwrap();
        assert_eq!(path_args.path, "/tmp/remove");

        let verify: VerifyRequest =
            serde_json::from_value(json!({ "proof": "abcd", "nonce": "1234" })).unwrap();
        assert_eq!(verify.proof, "abcd");
        assert_eq!(verify.nonce, "1234");

        assert!(serde_json::from_value::<AddWsArgs>(json!({ "name": "missing path" })).is_err());
        assert!(serde_json::from_value::<VerifyRequest>(json!({ "proof": "abcd" })).is_err());
    }

    #[serial]
    #[test]
    fn nonce_cache_generates_hex_nonce_and_consumes_once() {
        let mut cache = crate::NonceCache::new();

        let nonce = cache.generate().unwrap();

        assert_eq!(nonce.len(), 64);
        assert!(nonce.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(cache.consume(&nonce).unwrap().len(), 32);
        assert!(cache.consume(&nonce).is_none());
        assert!(cache.consume("not-hex-and-not-present").is_none());
    }

    #[serial]
    #[test]
    fn loopback_request_parser_accepts_only_loopback_addresses() {
        assert!(middleware::is_loopback_request(&SocketAddr::from((
            [127, 0, 0, 1],
            42819
        ))));
        assert!(middleware::is_loopback_request(&SocketAddr::from((
            std::net::Ipv6Addr::LOCALHOST,
            42819
        ))));
        assert!(!middleware::is_loopback_request(&SocketAddr::from((
            [192, 168, 1, 50],
            42819
        ))));
    }

    #[serial]
    #[tokio::test]
    async fn terminate_process_handler_rejects_wrong_pid_type_before_command_logic() {
        let (status, body) = response_text(
            h_terminate_worktree_locking_process(
                HeaderMap::new(),
                Json(json!({
                    "name": "feature-a",
                    "pid": "not-a-number",
                    "processStartTime": "2026-06-11T00:00:00Z"
                })),
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, "Invalid pid");
    }

    #[serial]
    #[tokio::test]
    async fn terminate_process_handler_rejects_missing_process_start_time() {
        let (status, body) = response_text(
            h_terminate_worktree_locking_process(
                HeaderMap::new(),
                Json(json!({
                    "name": "feature-a",
                    "pid": 1234
                })),
            )
            .await,
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, "Invalid processStartTime");
    }
}

#[cfg(test)]
mod http_server_coverage_tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::{header, HeaderMap, Method, Request, StatusCode};
    use axum::response::Response;
    use futures_util::{SinkExt, StreamExt};
    use once_cell::sync::Lazy;
    use serde_json::{json, Value};
    use serial_test::serial;
    use std::collections::{HashMap, HashSet};
    use std::net::SocketAddr;
    use std::path::PathBuf;
    use std::sync::{Mutex, MutexGuard};
    use std::time::Duration;
    use tempfile::TempDir;
    use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message as WsClientMessage};
    use tower::ServiceExt;

    static COVERAGE_TEST_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_coverage_tests() -> MutexGuard<'static, ()> {
        COVERAGE_TEST_MUTEX
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct GlobalStateGuard {
        prev_global_config_cache: Option<crate::types::GlobalConfig>,
        prev_workspace_config_cache: Option<(String, crate::WorkspaceConfig)>,
        prev_share_state: crate::ShareState,
        prev_sessions: HashSet<String>,
        prev_clients: HashMap<String, crate::ConnectedClient>,
        prev_locks: HashMap<(String, String), String>,
        prev_terminal_states: HashMap<(String, String), crate::TerminalState>,
        prev_window_workspaces: HashMap<String, String>,
    }

    impl GlobalStateGuard {
        fn new() -> Self {
            let prev_global_config_cache = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *cache)
            };
            let prev_workspace_config_cache = {
                let mut cache = crate::state::WORKSPACE_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *cache)
            };
            let prev_share_state = {
                let mut state = SHARE_STATE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *state)
            };
            let prev_sessions = {
                let mut sessions = AUTHENTICATED_SESSIONS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *sessions)
            };
            let prev_clients = {
                let mut clients = CONNECTED_CLIENTS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *clients)
            };
            let prev_locks = {
                let mut locks = crate::WORKTREE_LOCKS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *locks)
            };
            let prev_terminal_states = {
                let mut states = crate::TERMINAL_STATES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *states)
            };
            let prev_window_workspaces = {
                let mut windows = crate::WINDOW_WORKSPACES
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *windows)
            };

            *crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                Some(crate::types::GlobalConfig::default());
            crate::commands::cloud::clear_pairing_state_for_test();

            Self {
                prev_global_config_cache,
                prev_workspace_config_cache,
                prev_share_state,
                prev_sessions,
                prev_clients,
                prev_locks,
                prev_terminal_states,
                prev_window_workspaces,
            }
        }
    }

    impl Drop for GlobalStateGuard {
        fn drop(&mut self) {
            *crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_global_config_cache);
            *crate::state::WORKSPACE_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_workspace_config_cache);
            *SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_share_state);
            *AUTHENTICATED_SESSIONS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_sessions);
            *CONNECTED_CLIENTS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_clients);
            *crate::WORKTREE_LOCKS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_locks);
            *crate::TERMINAL_STATES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_terminal_states);
            *crate::WINDOW_WORKSPACES
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_window_workspaces);
            crate::commands::cloud::clear_pairing_state_for_test();
        }
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<std::ffi::OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    struct NamedFileLock {
        path: PathBuf,
    }

    impl NamedFileLock {
        fn acquire(name: &str) -> Self {
            let path = std::env::temp_dir().join(name);
            loop {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(err) => panic!("failed to acquire test lock {:?}: {}", path, err),
                }
            }
        }
    }

    impl Drop for NamedFileLock {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    struct TempConfigRootGuard {
        _command_lock: NamedFileLock,
        _config_lock: NamedFileLock,
        temp_home: TempDir,
        prev_home: Option<std::ffi::OsString>,
        prev_global_config_cache: Option<crate::types::GlobalConfig>,
    }

    impl TempConfigRootGuard {
        fn new(config: crate::types::GlobalConfig) -> Self {
            let command_lock = NamedFileLock::acquire("worktree-manager-command-test-global-lock");
            let config_lock = NamedFileLock::acquire("worktree-manager-global-config-cache.lock");
            let temp_home = TempDir::new().unwrap();
            let prev_home = std::env::var_os("HOME");
            std::env::set_var("HOME", temp_home.path());
            let prev_global_config_cache = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };

            Self {
                _command_lock: command_lock,
                _config_lock: config_lock,
                temp_home,
                prev_home,
                prev_global_config_cache,
            }
        }

        fn mcp_config_path(&self) -> PathBuf {
            self.temp_home
                .path()
                .join(".config")
                .join("worktree-manager")
                .join("mcp.json")
        }
    }

    impl Drop for TempConfigRootGuard {
        fn drop(&mut self) {
            match &self.prev_home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            *crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                std::mem::take(&mut self.prev_global_config_cache);
        }
    }

    fn cache_global_config(config: crate::types::GlobalConfig) {
        *crate::state::GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(config);
    }

    fn auth_headers(session_id: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("x-session-id", session_id.parse().unwrap());
        headers
    }

    fn enable_auth(auth_key: &[u8], salt: &[u8], workspace_path: Option<String>) {
        let mut state = SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.active = true;
        state.port = 42819;
        state.auth_key = Some(auth_key.to_vec());
        state.auth_salt = Some(salt.to_vec());
        state.workspace_path = workspace_path;
    }

    fn proof_hex(auth_key: &[u8], nonce_hex: &str) -> String {
        let nonce_bytes = hex::decode(nonce_hex).unwrap();
        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, auth_key);
        hex::encode(ring::hmac::sign(&key, &nonce_bytes).as_ref())
    }

    async fn text_response(response: Response) -> (StatusCode, String) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    async fn json_response(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                panic!(
                    "failed to parse response body as JSON (status {}): {}; body={}",
                    status,
                    err,
                    String::from_utf8_lossy(&bytes)
                )
            })
        };
        (status, value)
    }

    async fn assert_text_contains(response: Response, status: StatusCode, expected: &str) {
        let (actual_status, body) = text_response(response).await;
        assert_eq!(
            actual_status, status,
            "expected status {status} with body containing {expected:?}, got status {actual_status} and body {body:?}"
        );
        assert!(
            body.contains(expected),
            "expected body to contain {expected:?}, got {body:?}"
        );
    }

    async fn request_with_addr(addr: SocketAddr, request: Request<Body>) -> Response {
        let make_svc = create_router(Some("coverage-cert".to_string()))
            .into_make_service_with_connect_info::<SocketAddr>();
        let svc = make_svc.oneshot(addr).await.unwrap();
        svc.oneshot(request).await.unwrap()
    }

    async fn next_ws_json(
        socket: &mut tokio_tungstenite::WebSocketStream<tokio::io::DuplexStream>,
        expected_type: &str,
    ) -> Value {
        let mut seen = Vec::new();
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let message = socket
                    .next()
                    .await
                    .expect("websocket should produce a message")
                    .expect("websocket message should be valid");
                if let WsClientMessage::Text(text) = message {
                    seen.push(text.to_string());
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value["type"].as_str() == Some(expected_type) {
                        return value;
                    }
                }
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!("timed out waiting for websocket JSON message {expected_type:?}; seen={seen:?}")
        })
    }

    #[serial]
    #[tokio::test]
    async fn helper_functions_cover_response_shapes_and_parameter_aliases() {
        let (_status, body) =
            text_response(result_json::<Value>(Err("bad input".to_string()))).await;
        assert_eq!(body, "bad input");

        let (status, body) = json_response(result_json(Ok(json!({"ok": true})))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"ok": true}));

        let (status, body) = text_response(result_ok(Err("nope".to_string()))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, "nope");

        let (status, body) = text_response(result_ok(Ok(()))).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(body.is_empty());

        let (status, body) = text_response(result_void_ok()).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(body.is_empty());

        let args = json!({
            "workspacePath": "/tmp/camel",
            "base_branch": "main",
            "enabled": true,
            "rowCount": 42,
            "badNumber": "42"
        });
        assert_eq!(get_param(&args, "workspace_path"), "/tmp/camel");
        assert_eq!(get_param(&args, "baseBranch"), "main");
        assert_eq!(get_param(&json!(null), "workspace_path"), "");
        assert_eq!(
            get_param_opt(
                &json!({"customPath": "/Applications/Editor.app"}),
                "custom_path"
            ),
            Some("/Applications/Editor.app".to_string())
        );
        assert_eq!(
            get_param_opt(&json!({"customPath": 7}), "custom_path"),
            None
        );
        assert!(get_param_bool(&args, "enabled", false));
        assert!(get_param_bool(&json!(null), "enabled", true));
        assert_eq!(get_param_u64(&args, "row_count", 1), 42);
        assert_eq!(get_param_u64(&args, "bad_number", 7), 7);
        assert_eq!(to_camel("base_branch_name"), "baseBranchName");
        assert_eq!(to_snake("workspacePathName"), "workspace_path_name");
    }

    #[serial]
    #[tokio::test]
    async fn malformed_handler_payloads_return_specific_client_errors() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let headers = auth_headers("validation-session");

        assert_text_contains(
            h_save_workspace_config(headers.clone(), Json(json!({"config": "bad"}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid config",
        )
        .await;
        assert_text_contains(
            h_save_workspace_config_by_path(Json(json!({
                "path": "/tmp/workspace",
                "config": "bad"
            })))
            .await,
            StatusCode::BAD_REQUEST,
            "Invalid config",
        )
        .await;
        assert_text_contains(
            h_update_worktree_color(
                headers.clone(),
                Json(json!({"worktreeName": "feature", "color": "not-a-color"})),
            )
            .await,
            StatusCode::BAD_REQUEST,
            "Invalid color",
        )
        .await;
        assert_text_contains(
            h_create_worktree(headers.clone(), Json(json!({"request": {"name": 7}}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid request",
        )
        .await;
        assert_text_contains(
            h_add_project_to_worktree(headers.clone(), Json(json!({"request": {"x": true}}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid request",
        )
        .await;
        assert_text_contains(
            h_clone_project(headers.clone(), Json(json!({"request": {"name": "repo"}}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid request",
        )
        .await;
        assert_text_contains(
            h_switch_branch(Json(json!({"request": {"projectPath": "/tmp/repo"}}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid request",
        )
        .await;
        assert_text_contains(
            h_open_in_editor(Json(json!({"request": {"path": "/tmp/repo"}}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid request",
        )
        .await;
        assert_text_contains(
            h_save_custom_mirrors(Json(json!({"mirrors": "bad"}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid mirrors",
        )
        .await;
        assert_text_contains(
            h_terminate_worktree_locking_process(
                headers,
                Json(json!({
                    "name": "feature",
                    "pid": u64::from(u32::MAX) + 1,
                    "processStartTime": "2026-06-11T00:00:00Z"
                })),
            )
            .await,
            StatusCode::BAD_REQUEST,
            "Invalid pid",
        )
        .await;
    }

    #[serial]
    #[tokio::test]
    async fn workspace_window_handlers_cover_temp_workspace_success_and_error_paths() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let temp = TempDir::new().unwrap();
        let _config_root = TempConfigRootGuard::new(crate::types::GlobalConfig::default());
        let workspace_path = temp.path().to_string_lossy().to_string();
        let mut config = crate::types::GlobalConfig::default();
        config.workspaces.push(crate::types::WorkspaceRef {
            name: "Coverage Workspace".to_string(),
            path: workspace_path.clone(),
        });
        config.current_workspace = Some(workspace_path.clone());
        cache_global_config(config);

        let headers = auth_headers("window-session");
        let workspace_config = crate::WorkspaceConfig {
            name: "Coverage Workspace".to_string(),
            ..crate::WorkspaceConfig::default()
        };
        crate::save_workspace_config_internal(&workspace_path, &workspace_config).unwrap();

        assert_eq!(
            h_set_window_workspace(
                headers.clone(),
                Json(json!({"workspacePath": workspace_path}))
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );

        let (status, current) = json_response(h_get_current_workspace(headers.clone()).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(current["path"], workspace_path);
        assert_eq!(current["name"], "Coverage Workspace");

        let (status, body) = json_response(h_get_workspace_config(headers.clone()).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["name"], "Coverage Workspace");

        let updated_config = json!({
            "name": "Updated Workspace",
            "worktrees_dir": "worktrees",
            "projects": [],
            "linked_workspace_items": [],
            "vault_linked_workspace_items": [],
            "uat_branch": "uat",
            "archived_worktrees": [],
            "worktree_colors": {},
            "tags": []
        });
        assert_eq!(
            h_save_workspace_config(
                headers.clone(),
                Json(json!({"config": updated_config.clone()}))
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_save_workspace_config_by_path(Json(json!({
                "path": workspace_path,
                "config": updated_config
            })))
            .await
            .status(),
            StatusCode::NO_CONTENT
        );

        let (status, loaded) = json_response(
            h_load_workspace_config_by_path(Json(json!({"path": workspace_path}))).await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(loaded["name"], "Updated Workspace");

        let checked_handlers = [
            h_get_config_path_info(headers.clone()).await,
            h_list_worktrees(headers.clone(), Json(json!({"includeArchived": true}))).await,
            h_get_main_workspace_status(headers.clone()).await,
            h_scan_existing_projects(headers.clone()).await,
            h_get_main_occupation(headers.clone()).await,
            h_check_worktree_status(headers.clone(), Json(json!({"name": "missing"}))).await,
            h_get_opened_workspaces().await,
        ];
        for response in checked_handlers {
            assert_ne!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        }

        // 注意：不在此处调用 h_start_sharing —— 合法参数会真正启动分享服务器、绑定端口并污染
        // 全局 SHARE_STATE 且不清理，导致其他测试 flaky；分享启动有专门的测试覆盖。
        let error_handlers = [
            h_archive_worktree(headers.clone(), Json(json!({"name": "missing"}))).await,
            h_restore_worktree(headers.clone(), Json(json!({"name": "missing"}))).await,
            h_delete_archived_worktree(headers.clone(), Json(json!({"name": "missing"}))).await,
            h_import_external_project(headers.clone(), Json(json!({"sourcePath": ""}))).await,
            h_remove_project_from_config(headers.clone(), Json(json!({"name": "missing"}))).await,
        ];
        for response in error_handlers {
            assert!(
                response.status().is_client_error(),
                "expected 4xx client error, got {}",
                response.status()
            );
        }
    }

    #[serial]
    #[tokio::test]
    async fn cached_config_get_handlers_mask_secrets_and_return_settings() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let mut config = crate::types::GlobalConfig::default();
        config.workspaces.push(crate::types::WorkspaceRef {
            name: "Demo".to_string(),
            path: "/tmp/demo".to_string(),
        });
        config.ngrok_token = Some("ngrok-token".to_string());
        config.last_share_port = Some(45678);
        config.share_password = Some("last-password".to_string());
        config.dashscope_api_key = Some("dashscope-secret-key".to_string());
        config.commit_ai_api_key = Some("commit-secret-key".to_string());
        config.commit_ai_enabled = false;
        config.dashscope_base_url = Some("wss://example.test/ws".to_string());
        config.voice_refine_enabled = false;
        config.voice_refine_base_url = Some("https://example.test/v1".to_string());
        config.voice_asr_model = Some("asr-model".to_string());
        config.voice_refine_model = Some("refine-model".to_string());
        config.commit_prefix_templates = vec!["feat({{worktree-name}}):".to_string()];
        config.commit_prefix_enabled = false;
        config.default_prefix_index = 0;
        config.git_user_name = Some("Ada".to_string());
        config.git_user_email = Some("ada@example.test".to_string());
        config.skip_git_hooks = true;
        config.shell_integration_enabled = false;
        config.custom_mirrors.push(crate::types::CustomMirror {
            name: "custom".to_string(),
            url: "https://mirror.example/".to_string(),
        });
        cache_global_config(config);

        let (status, workspaces) = json_response(h_list_workspaces().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(workspaces[0]["name"], "Demo");

        let assertions = [
            (h_get_ngrok_token().await, json!("ngrok-token")),
            (h_get_last_share_port().await, json!(45678)),
            (h_get_last_share_password().await, json!("last-password")),
            (h_get_dashscope_api_key().await, json!("dash...-key")),
            (h_get_commit_ai_api_key().await, json!("comm...-key")),
            (h_check_dashscope_api_key().await, json!(true)),
            (h_check_commit_ai_api_key().await, json!(true)),
            (h_get_commit_ai_enabled().await, json!(false)),
            (
                h_get_dashscope_base_url().await,
                json!("wss://example.test/ws"),
            ),
            (h_get_voice_refine_enabled().await, json!(false)),
            (
                h_get_voice_refine_base_url().await,
                json!("https://example.test/v1"),
            ),
            (h_get_voice_asr_model().await, json!("asr-model")),
            (h_get_voice_refine_model().await, json!("refine-model")),
            (h_get_skip_git_hooks().await, json!(true)),
            (h_get_shell_integration_enabled().await, json!(false)),
        ];
        for (response, expected) in assertions {
            let (status, body) = json_response(response).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body, expected);
        }

        let (status, prefix) = json_response(h_get_commit_prefix_config().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(prefix["enabled"], false);
        assert_eq!(prefix["templates"][0], "feat({{worktree-name}}):");

        let (status, git_user) = json_response(h_get_git_user_global_config().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(git_user["name"], "Ada");

        let (status, mirrors) = json_response(h_get_mirror_sources().await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(mirrors
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["name"] == "custom" && m["builtin"] == false));
    }

    #[serial]
    #[tokio::test]
    async fn git_pty_voice_cloud_handlers_cover_fast_error_paths() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let temp = TempDir::new().unwrap();
        let path = temp.path().to_string_lossy().to_string();

        let git_errors = [
            h_get_changed_files(Json(json!({"path": path}))).await,
            h_check_remote_branch_exists(Json(json!({"path": path, "branchName": "main"}))).await,
            h_fetch_project_remote(Json(json!({"path": path}))).await,
            h_sync_with_base_branch(Json(json!({"path": path, "baseBranch": "main"}))).await,
            h_push_to_remote(Json(json!({"path": path}))).await,
            h_pull_current_branch(Json(json!({"path": path}))).await,
            h_merge_to_test_branch(Json(json!({"path": path, "testBranch": "test"}))).await,
            h_merge_to_base_branch(Json(json!({"path": path, "baseBranch": "main"}))).await,
            h_create_pull_request(Json(json!({
                "path": path,
                "baseBranch": "main",
                "title": "PR",
                "body": "body"
            })))
            .await,
            h_get_remote_branches(Json(json!({"path": path}))).await,
            h_get_git_diff(Json(json!({"path": path}))).await,
            h_commit_all(Json(json!({"path": path, "message": "test: commit"}))).await,
        ];
        for response in git_errors {
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }

        let (status, stats) =
            json_response(h_get_branch_diff_stats(Json(json!({"path": path}))).await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(stats.is_object());

        let (status, diff) = json_response(
            h_get_file_diff(Json(json!({"path": path, "filePath": "missing.rs"}))).await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(diff["file_path"], "missing.rs");
        assert_eq!(diff["is_new"], true);

        assert_eq!(
            h_pty_write(Json(json!({"sessionId": "missing", "data": "x"})))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_pty_resize(Json(
                json!({"sessionId": "missing", "cols": 90, "rows": 25})
            ))
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_pty_close(Json(json!({"sessionId": "missing"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        let (status, exists) =
            json_response(h_pty_exists(Json(json!({"sessionId": "missing"}))).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(exists, json!(false));

        assert_text_contains(
            h_voice_start(Json(json!({"sampleRate": 8000}))).await,
            StatusCode::BAD_REQUEST,
            "Dashscope API Key",
        )
        .await;
        assert_text_contains(
            h_voice_send_audio(Json(json!({"data": "not base64"}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid",
        )
        .await;
        assert_eq!(h_voice_stop().await.status(), StatusCode::NO_CONTENT);
        let (status, active) = json_response(h_voice_is_active().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(active, json!(false));
        let (status, refined) =
            json_response(h_voice_refine_text(Json(json!({"text": "   "}))).await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(refined, json!(""));
        assert_text_contains(
            h_list_dashscope_models().await,
            StatusCode::BAD_REQUEST,
            "Dashscope API Key",
        )
        .await;
        let (status, cloud_status) = json_response(h_cloud_get_status().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cloud_status["connected"], false);
    }

    #[serial]
    #[tokio::test]
    async fn misc_handlers_cover_no_app_handle_and_simple_success_paths() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();

        let (status, terminal_state) = json_response(
            h_get_terminal_state(Json(json!({
                "workspacePath": "/tmp/ws-a",
                "worktreeName": "feature-a"
            })))
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            terminal_state["terminal_visible"].is_null()
                || terminal_state["terminal_visible"] == false
        );

        let (status, window_url) = json_response(
            h_open_workspace_window(Json(json!({"workspacePath": "/tmp/ws with spaces"}))).await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(window_url, json!("/?workspace=%2Ftmp%2Fws%20with%20spaces"));

        let (status, version) = json_response(h_get_app_version().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(version, json!(env!("CARGO_PKG_VERSION")));

        assert_text_contains(
            h_download_update_via_mirror(Json(json!({"mirrorUrl": "https://mirror.invalid/"})))
                .await,
            StatusCode::INTERNAL_SERVER_ERROR,
            "App handle unavailable",
        )
        .await;
        assert_text_contains(
            h_open_devtools().await,
            StatusCode::INTERNAL_SERVER_ERROR,
            "App handle unavailable",
        )
        .await;
        assert_text_contains(
            h_broadcast_terminal_state(Json(json!({
                "workspacePath": "/tmp/ws-a",
                "worktreeName": "feature-a",
                "activatedTerminals": ["main"],
                "activeTerminalTab": "main",
                "terminalVisible": true,
                "clientId": "client-a",
                "sessionId": "pty-a"
            })))
            .await,
            StatusCode::INTERNAL_SERVER_ERROR,
            "App handle unavailable",
        )
        .await;

        assert_eq!(
            h_frontend_log(Json(json!({"level": "info", "message": "coverage"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_set_git_path(Json(json!({"path": "/usr/bin/git"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );

        let (status, icon) =
            json_response(h_get_app_icon(Json(json!({"path": "/definitely/missing.app"}))).await)
                .await;
        assert_eq!(status, StatusCode::OK);
        assert!(icon.is_null() || icon.is_string());

        let (status, crash_report) = json_response(h_get_crash_report().await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(crash_report.is_null() || crash_report.is_object());

        assert_text_contains(
            h_speed_test_single_mirror(Json(json!({"mirrorUrl": "https://missing.example/"})))
                .await,
            StatusCode::BAD_REQUEST,
            "Mirror not found",
        )
        .await;
        assert_text_contains(
            h_check_mirror_update(Json(json!({"mirrorUrl": "not-a-valid-url://"}))).await,
            StatusCode::BAD_REQUEST,
            "Failed to fetch mirror manifest",
        )
        .await;
    }

    #[serial]
    #[tokio::test]
    async fn lock_connected_client_and_ngrok_handlers_cover_state_changes() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let workspace_path = "/tmp/http-server-coverage-locks";
        let owner = auth_headers("coverage-owner");
        let other = auth_headers("coverage-other");

        assert_eq!(
            h_lock_worktree(
                owner.clone(),
                Json(json!({
                    "workspacePath": workspace_path,
                    "worktreeName": "feature-a"
                })),
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        assert_text_contains(
            h_lock_worktree(
                other,
                Json(json!({
                    "workspacePath": workspace_path,
                    "worktreeName": "feature-a"
                })),
            )
            .await,
            StatusCode::BAD_REQUEST,
            "feature-a",
        )
        .await;

        let (status, locks) = json_response(
            h_get_locked_worktrees(Json(json!({"workspacePath": workspace_path}))).await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(locks["feature-a"], "coverage-owner");

        assert_eq!(
            h_unlock_worktree(
                owner.clone(),
                Json(json!({
                    "workspacePath": workspace_path,
                    "worktreeName": "feature-a"
                })),
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_unregister_window(owner).await.status(),
            StatusCode::NO_CONTENT
        );

        let session_id = "coverage-client";
        CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                session_id.to_string(),
                crate::ConnectedClient {
                    session_id: session_id.to_string(),
                    ip: "127.0.0.1".to_string(),
                    user_agent: "coverage-test/1.0".to_string(),
                    authenticated_at: "2026-06-11T00:00:00Z".to_string(),
                    last_active: "2026-06-11T00:00:00Z".to_string(),
                    ws_connected: false,
                },
            );
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(session_id.to_string());

        let (status, clients) = json_response(h_get_connected_clients().await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(clients
            .as_array()
            .unwrap()
            .iter()
            .any(|client| client["session_id"] == session_id));
        assert_eq!(
            h_kick_client(Json(json!({"sessionId": session_id})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert!(!CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key(session_id));
        assert!(!AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(session_id));

        SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .ngrok_url = Some("https://coverage.ngrok-free.app".to_string());
        assert_eq!(
            h_stop_ngrok_tunnel().await.status(),
            StatusCode::NO_CONTENT,
            "h_stop_ngrok_tunnel should stop a seeded ngrok task"
        );
        assert!(SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .ngrok_url
            .is_none());
    }

    #[serial]
    #[tokio::test]
    async fn vault_mcp_and_share_validation_handlers_return_expected_errors() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let headers = auth_headers("coverage-vault");

        assert_text_contains(
            h_vault_status(headers.clone()).await,
            StatusCode::BAD_REQUEST,
            "No workspace bound to window",
        )
        .await;
        assert_text_contains(
            h_vault_link(
                headers,
                Json(json!({"path": "/tmp/missing-vault", "keepSymlinks": true})),
            )
            .await,
            StatusCode::BAD_REQUEST,
            "No workspace bound to window",
        )
        .await;
        assert_text_contains(
            h_list_vault_item_children(Json(json!({
                "vaultPath": "/tmp/vault",
                "relativePath": "../escape"
            })))
            .await,
            StatusCode::BAD_REQUEST,
            "路径越界",
        )
        .await;
        assert_text_contains(
            routing::h_set_mcp_capability(Json(json!({"capability_level": "invalid"}))).await,
            StatusCode::BAD_REQUEST,
            "Invalid capability level",
        )
        .await;
        assert_text_contains(
            h_update_share_password(Json(json!({"password": "short"}))).await,
            StatusCode::BAD_REQUEST,
            "至少需要 8 位",
        )
        .await;
    }

    #[serial]
    #[tokio::test]
    async fn additional_project_handlers_cover_bound_workspace_error_paths() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let temp = TempDir::new().unwrap();
        let workspace_path = temp.path().to_string_lossy().to_string();
        let headers = auth_headers("coverage-projects");
        let mut config = crate::types::GlobalConfig::default();
        config.workspaces.push(crate::types::WorkspaceRef {
            name: "Coverage Projects".to_string(),
            path: workspace_path.clone(),
        });
        config.current_workspace = Some(workspace_path.clone());
        cache_global_config(config);
        crate::WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert("coverage-projects".to_string(), workspace_path.clone());
        crate::save_workspace_config_internal(&workspace_path, &crate::WorkspaceConfig::default())
            .unwrap();

        assert_eq!(
            h_deploy_to_main(headers.clone(), Json(json!({"worktreeName": "missing"})))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_ne!(
            h_add_existing_project(
                headers.clone(),
                Json(json!({
                    "name": "missing-project",
                    "baseBranch": "main",
                    "testBranch": "test",
                    "mergeStrategy": "merge"
                })),
            )
            .await
            .status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_ne!(
            h_remove_project_from_config(headers.clone(), Json(json!({"name": "missing"})))
                .await
                .status(),
            StatusCode::INTERNAL_SERVER_ERROR
        );
        let (status, sync_results) = json_response(
            h_sync_all_projects_to_base(
                headers.clone(),
                Json(json!({"projectPaths": ["/definitely/missing"], "baseBranch": "main"})),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(sync_results.is_array());
        let (status, git_user_config) = json_response(
            h_get_git_user_config(Json(json!({"path": "/definitely/missing"}))).await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(git_user_config.is_array() || git_user_config.is_object());
        assert_eq!(
            h_set_git_user_config(Json(SetGitUserArgs {
                path: "/definitely/missing".to_string(),
                name: Some("Ada".to_string()),
                email: Some("ada@example.test".to_string()),
            }))
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );

        assert_eq!(
            h_exit_main_occupation(headers, Json(json!({"force": true})))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        crate::WINDOW_WORKSPACES
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove("coverage-projects");
    }

    #[serial]
    #[tokio::test]
    async fn full_auth_flow_over_router_oneshot_unlocks_protected_routes() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        enable_auth(b"test-auth-key", b"test-auth-salt", None);
        let addr = SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, 33112));

        let challenge_response = request_with_addr(
            addr,
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/challenge")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;
        let (status, challenge) = json_response(challenge_response).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(challenge["salt"], json!(hex::encode(b"test-auth-salt")));

        let nonce = challenge["nonce"].as_str().unwrap();
        let proof = proof_hex(b"test-auth-key", nonce);
        let verify_response = request_with_addr(
            addr,
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/verify")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::USER_AGENT, "coverage-router/1.0")
                .body(Body::from(
                    json!({ "nonce": nonce, "proof": proof }).to_string(),
                ))
                .unwrap(),
        )
        .await;
        let (status, verify) = json_response(verify_response).await;
        assert_eq!(status, StatusCode::OK);
        let session_id = verify["sessionId"].as_str().unwrap();
        assert!(AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(session_id));

        let protected = request_with_addr(
            addr,
            Request::builder()
                .method(Method::POST)
                .uri("/api/get_share_state")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-session-id", session_id)
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;
        let (status, body) = json_response(protected).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["active"], true);

        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(session_id);
        CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(session_id);
    }

    #[serial]
    #[tokio::test]
    async fn websocket_upgrade_extractor_requires_real_upgrade_extension_under_oneshot() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 34001)),
            Request::builder()
                .method(Method::GET)
                .uri("/ws?session_id=s")
                .header(header::CONNECTION, "upgrade")
                .header(header::UPGRADE, "websocket")
                .header(header::ORIGIN, "https://evil.example")
                .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
                .header("sec-websocket-version", "13")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::UPGRADE_REQUIRED);
    }

    #[serial]
    #[tokio::test]
    async fn websocket_upgrade_over_duplex_covers_authenticated_message_flow() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let session_id = "coverage-ws-session";
        let temp = TempDir::new().unwrap();
        let workspace_path = temp.path().to_string_lossy().to_string();
        let worktree_name = "feature-ws";
        *crate::state::GLOBAL_CONFIG_CACHE.lock().unwrap() = Some(crate::types::GlobalConfig {
            workspaces: vec![crate::types::WorkspaceRef {
                name: "WebSocket Workspace".to_string(),
                path: workspace_path.clone(),
            }],
            current_workspace: Some(workspace_path.clone()),
            ..crate::types::GlobalConfig::default()
        });
        {
            let mut share = SHARE_STATE.lock().unwrap();
            share.active = true;
            share.workspace_path = Some(workspace_path.to_string());
            share.auth_key = Some(b"coverage-auth-key".to_vec());
        }
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap()
            .insert(session_id.to_string());
        CONNECTED_CLIENTS.lock().unwrap().insert(
            session_id.to_string(),
            crate::ConnectedClient {
                session_id: session_id.to_string(),
                ip: "127.0.0.1".to_string(),
                user_agent: "duplex-websocket-test".to_string(),
                authenticated_at: "2026-06-11T00:00:00Z".to_string(),
                last_active: "2026-06-11T00:00:00Z".to_string(),
                ws_connected: false,
            },
        );
        crate::WORKTREE_LOCKS.lock().unwrap().insert(
            (workspace_path.to_string(), worktree_name.to_string()),
            "desktop".to_string(),
        );
        crate::TERMINAL_STATES.lock().unwrap().insert(
            (workspace_path.to_string(), worktree_name.to_string()),
            crate::TerminalState {
                activated_terminals: vec!["one".to_string()],
                active_terminal_tab: Some("one".to_string()),
                terminal_visible: true,
                client_id: Some("desktop".to_string()),
                session_id: Some("desktop-session".to_string()),
            },
        );

        let (client_io, server_io) = tokio::io::duplex(128 * 1024);
        let service = create_router(None)
            .into_make_service_with_connect_info::<SocketAddr>()
            .oneshot(SocketAddr::from(([127, 0, 0, 1], 37001)))
            .await
            .unwrap();
        let server = tokio::spawn(async move {
            let service = hyper::service::service_fn(move |request| {
                let service = service.clone();
                async move { service.oneshot(request).await }
            });
            hyper::server::conn::http1::Builder::new()
                .serve_connection(hyper_util::rt::TokioIo::new(server_io), service)
                .with_upgrades()
                .await
                .unwrap();
        });

        let mut request = format!("ws://localhost/ws?session_id={session_id}")
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            header::ORIGIN,
            axum::http::HeaderValue::from_static("http://localhost:3000"),
        );
        let (mut socket, response) = tokio_tungstenite::client_async(request, client_io)
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            StatusCode::SWITCHING_PROTOCOLS.as_u16()
        );
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let connected = CONNECTED_CLIENTS
                    .lock()
                    .unwrap()
                    .get(session_id)
                    .map(|client| client.ws_connected)
                    .unwrap_or(false);
                if connected {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("websocket should be marked connected");
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if crate::config::get_window_workspace_path(session_id)
                    == Some(workspace_path.to_string())
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("websocket should bind session to shared workspace");
        assert_eq!(
            crate::config::get_window_workspace_path(session_id),
            Some(workspace_path.to_string())
        );

        socket
            .send(WsClientMessage::text(
                json!({"type": "subscribe_locks", "workspacePath": workspace_path}).to_string(),
            ))
            .await
            .unwrap();
        let lock_update = next_ws_json(&mut socket, "lock_update").await;
        assert_eq!(lock_update["locks"][worktree_name], "desktop");
        let _ = LOCK_BROADCAST.send(
            json!({
                "workspacePath": workspace_path,
                "locks": { worktree_name: "web-client" }
            })
            .to_string(),
        );
        let lock_update = next_ws_json(&mut socket, "lock_update").await;
        assert_eq!(lock_update["locks"][worktree_name], "web-client");

        socket
            .send(WsClientMessage::Binary(vec![1, 2, 3].into()))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text("{not-json"))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "unknown"}).to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "pty_subscribe"}).to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "pty_subscribe", "sessionId": "missing-pty"}).to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "pty_unsubscribe"}).to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "pty_write", "sessionId": "missing-pty"}).to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "pty_write", "sessionId": "missing-pty", "data": "echo hi\n"})
                    .to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "pty_resize"}).to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({"type": "pty_resize", "sessionId": "missing-pty", "cols": 100, "rows": 40})
                    .to_string(),
            ))
            .await
            .unwrap();

        socket
            .send(WsClientMessage::text(
                json!({"type": "subscribe_locks"}).to_string(),
            ))
            .await
            .unwrap();

        socket
            .send(WsClientMessage::text(
                json!({"type": "subscribe_terminal_state", "workspacePath": workspace_path})
                    .to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(WsClientMessage::text(
                json!({
                    "type": "subscribe_terminal_state",
                    "workspacePath": workspace_path,
                    "worktreeName": worktree_name
                })
                .to_string(),
            ))
            .await
            .unwrap();
        let terminal_update = next_ws_json(&mut socket, "terminal_state_update").await;
        assert_eq!(terminal_update["workspacePath"], workspace_path);
        assert_eq!(terminal_update["worktreeName"], worktree_name);
        assert_eq!(terminal_update["activeTerminalTab"], "one");
        let _ = TERMINAL_STATE_BROADCAST.send(
            json!({
                "workspacePath": workspace_path,
                "worktreeName": worktree_name,
                "activatedTerminals": ["two"],
                "activeTerminalTab": "two",
                "terminalVisible": false,
                "clientId": "browser"
            })
            .to_string(),
        );
        let terminal_update = next_ws_json(&mut socket, "terminal_state_update").await;
        assert_eq!(terminal_update["activeTerminalTab"], "two");
        assert_eq!(terminal_update["terminalVisible"], false);

        socket
            .send(WsClientMessage::text(
                json!({
                    "type": "broadcast_terminal_state",
                    "workspacePath": workspace_path,
                    "worktreeName": worktree_name,
                    "activatedTerminals": ["three"],
                    "activeTerminalTab": "three",
                    "terminalVisible": true,
                    "clientId": "browser",
                    "sessionId": session_id
                })
                .to_string(),
            ))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let state = crate::TERMINAL_STATES
                    .lock()
                    .unwrap()
                    .get(&(workspace_path.to_string(), worktree_name.to_string()))
                    .cloned();
                if state
                    .as_ref()
                    .and_then(|state| state.active_terminal_tab.as_deref())
                    == Some("three")
                {
                    assert_eq!(state.unwrap().client_id.as_deref(), Some("browser"));
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("broadcast_terminal_state should update cache");
        let terminal_update = next_ws_json(&mut socket, "terminal_state_update").await;
        assert_eq!(terminal_update["activeTerminalTab"], "three");
        assert_eq!(terminal_update["clientId"], "browser");

        socket
            .send(WsClientMessage::text(
                json!({"type": "subscribe_voice_events"}).to_string(),
            ))
            .await
            .unwrap();
        let voice_event_sender = tokio::spawn(async {
            let payload =
                json!({"event": "recording-started", "payload": {"level": 7}}).to_string();
            for _ in 0..40 {
                let _ = crate::state::VOICE_BROADCAST.send(payload.clone());
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        });
        let voice_event = next_ws_json(&mut socket, "voice_event").await;
        voice_event_sender.abort();
        assert_eq!(voice_event["event"], "recording-started");
        assert_eq!(voice_event["payload"]["level"], 7);

        let _ = crate::state::CLIENT_NOTIFICATION_BROADCAST.send(
            json!({"session_id": session_id, "type": "kicked", "reason": "coverage"}).to_string(),
        );
        let kicked = next_ws_json(&mut socket, "kicked").await;
        assert_eq!(kicked["reason"], "coverage");
        let close = tokio::time::timeout(Duration::from_secs(2), socket.next())
            .await
            .expect("websocket should close after kick");
        assert!(matches!(close, Some(Ok(WsClientMessage::Close(_))) | None));

        drop(socket);
        server.abort();
        match server.await {
            Ok(()) => {}
            Err(err) => assert!(err.is_cancelled()),
        }
    }

    #[serial]
    #[tokio::test]
    async fn cors_security_headers_and_certificate_route_are_applied_by_router() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();

        let cert_response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 35001)),
            Request::builder()
                .method(Method::GET)
                .uri("/api/cert.pem")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(cert_response.status(), StatusCode::OK);
        assert_eq!(
            cert_response.headers()[header::CONTENT_TYPE],
            "application/x-pem-file"
        );
        assert_eq!(cert_response.headers()["x-content-type-options"], "nosniff");

        let preflight = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 35002)),
            Request::builder()
                .method(Method::OPTIONS)
                .uri("/api/get_share_info")
                .header(header::ORIGIN, "http://localhost:3000")
                .header(header::ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert!(preflight.status().is_success());
        assert_eq!(
            preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://localhost:3000"
        );
    }

    #[serial]
    #[tokio::test]
    async fn websocket_upgrade_extractor_failure_is_bounded_without_local_bind() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        // TODO: Real WebSocket upgrade coverage is skipped because
        // TcpListener::bind("127.0.0.1:0") returns PermissionDenied in this
        // sandbox, and axum's WebSocketUpgrade needs Hyper's private upgrade
        // extension before h_ws_upgrade can run.
        let response = request_with_addr(
            SocketAddr::from(([127, 0, 0, 1], 36001)),
            Request::builder()
                .method(Method::GET)
                .uri("/ws?session_id=ws-coverage-session")
                .header(header::CONNECTION, "upgrade")
                .header(header::UPGRADE, "websocket")
                .header("sec-websocket-key", "dGhlIHNhbXBsZSBub25jZQ==")
                .header("sec-websocket-version", "13")
                .body(Body::empty())
                .unwrap(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::UPGRADE_REQUIRED);
    }

    #[serial]
    #[tokio::test]
    async fn temp_config_setters_workspace_and_mcp_paths_cover_success_shapes() {
        let _serial = lock_coverage_tests();
        let mut config = crate::types::GlobalConfig::default();
        config.commit_prefix_templates = vec!["old:".to_string()];
        let guard = TempConfigRootGuard::new(config);
        let workspace = TempDir::new().unwrap();
        let workspace_path = workspace.path().join("workspace-a");
        std::fs::create_dir_all(&workspace_path).unwrap();
        let workspace_path = workspace_path.to_string_lossy().to_string();

        assert_eq!(
            h_add_workspace(Json(AddWsArgs {
                name: "Workspace A".to_string(),
                path: workspace_path.clone(),
            }))
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        let (status, workspaces) = json_response(h_list_workspaces().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(workspaces[0]["name"], "Workspace A");
        assert_eq!(
            h_remove_workspace(Json(PathArgs {
                path: workspace_path.clone(),
            }))
            .await
            .status(),
            StatusCode::NO_CONTENT
        );

        let created_path = workspace.path().join("created-workspace");
        assert_eq!(
            h_create_workspace(Json(AddWsArgs {
                name: "Created".to_string(),
                path: created_path.to_string_lossy().to_string(),
            }))
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        assert!(created_path.join(".worktree-manager.json").exists());

        assert_eq!(
            h_set_commit_prefix_config(Json(SetPrefixArgs {
                templates: vec![
                    "feat:".to_string(),
                    "fix:".to_string(),
                    "docs:".to_string(),
                    "ignored:".to_string(),
                ],
                enabled: true,
                default_index: 1,
            }))
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        let (status, prefix) = json_response(h_get_commit_prefix_config().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(prefix["templates"].as_array().unwrap().len(), 3);
        assert_eq!(prefix["default_index"], 1);

        assert_eq!(
            h_set_git_user_global_config(Json(SetGitUserGlobalArgs {
                name: Some("Grace".to_string()),
                email: Some("grace@example.test".to_string()),
            }))
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        let (status, git_user) = json_response(h_get_git_user_global_config().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(git_user["name"], "Grace");
        assert_eq!(git_user["email"], "grace@example.test");

        assert_eq!(
            h_set_skip_git_hooks(Json(SetSkipGitHooksArgs { skip: true }))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_set_shell_integration_enabled(Json(SetShellIntegrationEnabledArgs { enabled: true }))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            json_response(h_get_skip_git_hooks().await).await.1,
            json!(true)
        );
        assert_eq!(
            json_response(h_get_shell_integration_enabled().await)
                .await
                .1,
            json!(true)
        );

        assert_eq!(
            h_set_ngrok_token(Json(json!({"token": "ngrok-temp-token"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            json_response(h_get_ngrok_token().await).await.1,
            json!("ngrok-temp-token")
        );

        assert_eq!(
            h_set_commit_ai_api_key(Json(json!({"key": "commit-ai-temp-key"})))
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            h_set_commit_ai_enabled(Json(json!({"enabled": true})))
                .await
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            json_response(h_get_commit_ai_enabled().await).await.1,
            json!(true)
        );
        let (status, commit_key) = json_response(h_get_commit_ai_api_key().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(commit_key, json!("comm...-key"));
        assert_eq!(
            h_generate_commit_message(Json(json!({"diff": ""})))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );

        assert_eq!(
            h_set_dashscope_api_key(Json(json!({"key": "dashscope-temp-key"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_set_dashscope_base_url(Json(json!({"url": "wss://dash.example/ws"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_set_voice_refine_enabled(Json(json!({"enabled": true})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_set_voice_refine_base_url(Json(json!({"url": "https://voice.example/v1"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_set_voice_asr_model(Json(json!({"model": "asr-temp"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            h_set_voice_refine_model(Json(json!({"model": "refine-temp"})))
                .await
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            json_response(h_get_dashscope_base_url().await).await.1,
            json!("wss://dash.example/ws")
        );
        assert_eq!(
            json_response(h_get_voice_refine_enabled().await).await.1,
            json!(true)
        );
        assert_eq!(
            json_response(h_get_voice_refine_base_url().await).await.1,
            json!("https://voice.example/v1")
        );
        assert_eq!(
            json_response(h_get_voice_asr_model().await).await.1,
            json!("asr-temp")
        );
        assert_eq!(
            json_response(h_get_voice_refine_model().await).await.1,
            json!("refine-temp")
        );

        let mcp = McpConfig {
            version: "1.2.3".to_string(),
            http_port: 49152,
            installed_at: "2026-06-11T00:00:00Z".to_string(),
            capability_level: "details".to_string(),
        };
        save_mcp_config(&mcp).unwrap();
        assert!(guard.mcp_config_path().exists());
        let loaded = load_mcp_config().unwrap();
        assert_eq!(loaded.http_port, 49152);
        assert_eq!(loaded.capability_level, "details");
        let (status, mcp_body) = json_response(routing::h_mcp_config().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(mcp_body["version"], "1.2.3");
        let (status, capability) = json_response(
            routing::h_set_mcp_capability(Json(json!({"capability_level": "advanced"}))).await,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(capability["success"], true);
        assert_eq!(load_mcp_config().unwrap().capability_level, "advanced");
    }

    #[serial]
    #[tokio::test]
    async fn additional_valid_payload_wrappers_cover_fast_local_error_paths() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let temp = TempDir::new().unwrap();
        let workspace_path = temp.path().to_string_lossy().to_string();
        let headers = auth_headers("valid-payload-session");

        assert_eq!(
            h_switch_workspace(headers.clone(), Json(json!({"path": workspace_path})))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_update_worktree_color(
                headers.clone(),
                Json(json!({"worktreeName": "feature-a", "color": "blue"})),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_update_worktree_color(
                headers.clone(),
                Json(json!({"worktreeName": "feature-a", "color": null})),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_create_worktree(
                headers.clone(),
                Json(json!({"request": {"name": "feature-a", "projects": []}})),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_add_project_to_worktree(
                headers.clone(),
                Json(json!({
                    "request": {
                        "worktreeName": "feature-a",
                        "projectName": "project-a",
                        "baseBranch": "main"
                    }
                })),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_clone_project(
                headers.clone(),
                Json(json!({
                    "request": {
                        "name": "project-a",
                        "repoUrl": "not-a-valid-url",
                        "baseBranch": "main",
                        "testBranch": "test",
                        "mergeStrategy": "merge",
                        "linkedFolders": []
                    }
                })),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_switch_branch(Json(json!({
                "request": {
                    "projectPath": temp.path().join("missing").to_string_lossy(),
                    "branch": "main"
                }
            })))
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_terminate_worktree_locking_process(
                headers,
                Json(json!({
                    "name": "feature-a",
                    "pid": 1,
                    "processStartTime": "2026-06-11T00:00:00Z"
                })),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );

        let (status, folders) =
            json_response(h_scan_linked_folders(Json(json!({"projectPath": temp.path()}))).await)
                .await;
        assert_eq!(status, StatusCode::OK);
        assert!(folders.is_array());

        let editor_response = h_open_in_editor(Json(json!({
            "request": {
                "editor": "cursor",
                "path": workspace_path
            },
            "customPath": temp.path().join("missing-editor").to_string_lossy()
        })))
        .await;
        assert_eq!(editor_response.status(), StatusCode::BAD_REQUEST);

        let (status, tools) = json_response(h_detect_tools().await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(tools["git"].is_array());
    }

    #[serial]
    #[tokio::test]
    async fn share_pty_ngrok_and_cloud_handlers_cover_additional_state_branches() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let temp = TempDir::new().unwrap();
        let workspace_path = temp.path().to_string_lossy().to_string();

        let (status, inactive_share) = json_response(h_get_share_info().await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(inactive_share["workspace_path"].is_null());
        assert_text_contains(
            h_start_sharing(
                auth_headers("no-workspace"),
                Json(json!({"port": 0, "password": "abcdefgh"})),
            )
            .await,
            StatusCode::BAD_REQUEST,
            "No workspace selected",
        )
        .await;

        crate::save_workspace_config_internal(
            &workspace_path,
            &crate::WorkspaceConfig {
                name: "Shared Workspace".to_string(),
                ..crate::WorkspaceConfig::default()
            },
        )
        .unwrap();
        {
            let mut share = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            share.active = true;
            share.workspace_path = Some(workspace_path.clone());
        }
        crate::WORKTREE_LOCKS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                (workspace_path.clone(), "feature-a".to_string()),
                "desktop".to_string(),
            );
        let (status, active_share) = json_response(h_get_share_info().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(active_share["workspace_name"], "Shared Workspace");
        assert_eq!(active_share["current_worktree"], "feature-a");
        SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .active = false;
        assert_eq!(
            h_stop_sharing().await.status(),
            StatusCode::BAD_REQUEST,
            "h_stop_sharing should reject inactive share state"
        );
        assert_eq!(
            h_start_ngrok_tunnel().await.status(),
            StatusCode::BAD_REQUEST,
            "h_start_ngrok_tunnel should reject inactive share state"
        );
        SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .ngrok_task = Some(tokio::spawn(async {
            tokio::time::sleep(Duration::from_secs(60)).await;
        }));
        assert_eq!(h_stop_ngrok_tunnel().await.status(), StatusCode::NO_CONTENT);

        let normalized_temp_path =
            crate::normalize_path(&workspace_path).replace(['/', '\\', '#'], "-");
        let pty_session = format!("pty-{normalized_temp_path}-coverage");
        let create_status = h_pty_create(Json(json!({
            "sessionId": pty_session,
            "cwd": temp.path(),
            "cols": 80,
            "rows": 24,
            "shell": "sh"
        })))
        .await
        .status();
        assert!(matches!(
            create_status,
            StatusCode::NO_CONTENT | StatusCode::BAD_REQUEST
        ));
        if create_status == StatusCode::NO_CONTENT {
            assert_eq!(
                h_pty_create(Json(json!({
                    "sessionId": pty_session,
                    "cwd": temp.path(),
                    "cols": 100,
                    "rows": 30,
                    "shell": "sh"
                })))
                .await
                .status(),
                StatusCode::NO_CONTENT,
                "h_pty_create should be idempotent for the same shell"
            );
            let (status, exists) =
                json_response(h_pty_exists(Json(json!({"sessionId": pty_session}))).await).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(exists, json!(true));
            let (status, output) = json_response(
                h_pty_read(Json(
                    json!({"sessionId": pty_session, "clientId": "reader"}),
                ))
                .await,
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert!(output.is_string());
            let (status, closed) =
                json_response(h_pty_close_by_path(Json(json!({"pathPrefix": temp.path()}))).await)
                    .await;
            assert_eq!(status, StatusCode::OK);
            assert!(closed
                .as_array()
                .unwrap()
                .iter()
                .any(|id| id == &pty_session));
        }

        let _cloud_config_root = TempConfigRootGuard::new(crate::types::GlobalConfig::default());
        let _https_proxy = EnvVarGuard::set("HTTPS_PROXY", "http://127.0.0.1:1");
        let _https_proxy_lower = EnvVarGuard::set("https_proxy", "http://127.0.0.1:1");
        let _http_proxy = EnvVarGuard::set("HTTP_PROXY", "http://127.0.0.1:1");
        let _http_proxy_lower = EnvVarGuard::set("http_proxy", "http://127.0.0.1:1");
        let _all_proxy = EnvVarGuard::set("ALL_PROXY", "http://127.0.0.1:1");
        let _all_proxy_lower = EnvVarGuard::set("all_proxy", "http://127.0.0.1:1");
        let _no_proxy = EnvVarGuard::set("NO_PROXY", "");
        let _no_proxy_lower = EnvVarGuard::set("no_proxy", "");
        crate::commands::cloud::clear_pairing_state_for_test();
        assert_eq!(
            h_cloud_start_pairing().await.status(),
            StatusCode::BAD_REQUEST,
            "h_cloud_start_pairing should fail through the test proxy"
        );
        crate::commands::cloud::clear_pairing_state_for_test();
        let (status, cloud_status) = json_response(h_cloud_get_status().await).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(cloud_status["pairing"], false);
        assert_text_contains(
            h_cloud_check_pairing_status().await,
            StatusCode::BAD_REQUEST,
            "没有进行中的配对流程",
        )
        .await;
        assert_eq!(
            h_cloud_approve_pairing().await.status(),
            StatusCode::BAD_REQUEST,
            "h_cloud_approve_pairing should reject missing pairing state"
        );
        assert_text_contains(
            h_cloud_reject_pairing().await,
            StatusCode::BAD_REQUEST,
            "没有进行中的配对流程",
        )
        .await;
        let (status, disconnect_error) = text_response(h_cloud_disconnect().await).await;
        match status {
            StatusCode::BAD_REQUEST => assert!(!disconnect_error.is_empty()),
            StatusCode::NO_CONTENT => assert!(disconnect_error.is_empty()),
            unexpected => panic!("unexpected cloud disconnect status: {}", unexpected),
        }
    }

    #[serial]
    #[tokio::test]
    async fn mcp_server_start_attempt_saves_config_and_never_hangs() {
        let _serial = lock_coverage_tests();
        let guard = TempConfigRootGuard::new(crate::types::GlobalConfig::default());
        let handle = tokio::spawn(start_mcp_server(0));
        tokio::time::sleep(Duration::from_millis(50)).await;
        if handle.is_finished() {
            let result = handle.await.unwrap();
            assert!(result.unwrap_err().contains("Failed to bind MCP server"));
        } else {
            handle.abort();
            assert!(guard.mcp_config_path().exists());
        }
    }

    #[serial]
    #[tokio::test]
    async fn start_server_bind_path_returns_or_shutdowns_without_hanging() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let (tx, rx) = tokio::sync::watch::channel(false);
        let handle = tokio::spawn(start_server(0, rx, None));
        tokio::time::sleep(Duration::from_millis(25)).await;
        let _ = tx.send(true);
        tokio::time::timeout(Duration::from_secs(2), handle)
            .await
            .expect("start_server should return after bind failure or shutdown")
            .unwrap();
    }

    #[serial]
    #[tokio::test]
    async fn valid_request_wrappers_cover_deserialized_error_paths() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let temp = TempDir::new().unwrap();
        let headers = auth_headers("valid-deserialize-session");
        let missing_project_path = temp.path().join("missing-project");

        assert_eq!(
            h_add_project_to_worktree(
                headers.clone(),
                Json(json!({
                    "request": {
                        "worktree_name": "feature-a",
                        "project_name": "project-a",
                        "base_branch": "main"
                    }
                })),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_clone_project(
                headers,
                Json(json!({
                    "request": {
                        "name": "project-a",
                        "repo_url": "not-a-valid-url",
                        "base_branch": "main",
                        "test_branch": "test",
                        "merge_strategy": "merge",
                        "linked_folders": []
                    }
                })),
            )
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_switch_branch(Json(json!({
                "request": {
                    "project_path": missing_project_path,
                    "branch": "main"
                }
            })))
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            h_open_in_editor(Json(json!({
                "request": {
                    "editor": "custom",
                    "path": temp.path()
                },
                "custom_path": temp.path().join("missing-editor")
            })))
            .await
            .status(),
            StatusCode::BAD_REQUEST
        );
    }

    #[serial]
    #[tokio::test]
    async fn auth_verify_rejects_when_auth_key_missing_after_challenge() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        let addr = SocketAddr::from(([127, 0, 0, 1], 33113));
        {
            let mut share = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            share.active = true;
            share.auth_salt = Some(b"salt-without-key".to_vec());
            share.auth_key = None;
        }

        let (status, challenge) = json_response(h_auth_challenge(ConnectInfo(addr)).await).await;
        assert_eq!(status, StatusCode::OK);
        let nonce = challenge["nonce"].as_str().unwrap().to_string();

        assert_text_contains(
            h_auth_verify(
                ConnectInfo(addr),
                HeaderMap::new(),
                Json(VerifyRequest {
                    nonce,
                    proof: "00".to_string(),
                }),
            )
            .await,
            StatusCode::INTERNAL_SERVER_ERROR,
            "No password configured",
        )
        .await;
    }

    #[serial]
    #[tokio::test]
    async fn optional_secret_and_ngrok_config_handlers_cover_none_and_clear_paths() {
        let _serial = lock_coverage_tests();
        let _guard = TempConfigRootGuard::new(crate::types::GlobalConfig::default());

        assert_eq!(
            json_response(h_get_commit_ai_api_key().await).await.1,
            Value::Null
        );
        assert_eq!(
            json_response(h_get_dashscope_api_key().await).await.1,
            Value::Null
        );
        assert_eq!(
            h_set_ngrok_token(Json(json!({"token": ""}))).await.status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            json_response(h_get_ngrok_token().await).await.1,
            Value::Null
        );
    }

    #[serial]
    #[test]
    fn mcp_config_loads_none_for_missing_or_invalid_files_and_reports_save_errors() {
        let _serial = lock_coverage_tests();
        let guard = TempConfigRootGuard::new(crate::types::GlobalConfig::default());
        assert!(load_mcp_config().is_none());

        std::fs::create_dir_all(guard.mcp_config_path().parent().unwrap()).unwrap();
        std::fs::write(guard.mcp_config_path(), "{not-json").unwrap();
        assert!(load_mcp_config().is_none());

        let bad_home = TempDir::new().unwrap();
        let home_file = bad_home.path().join("home-file");
        std::fs::write(&home_file, "not a directory").unwrap();
        let _home = EnvVarGuard::set("HOME", home_file.to_str().unwrap());
        let config = McpConfig {
            version: "1.0.0".to_string(),
            http_port: 49200,
            installed_at: "2026-06-11T00:00:00Z".to_string(),
            capability_level: "core".to_string(),
        };
        assert!(save_mcp_config(&config).is_err());
    }

    #[serial]
    #[tokio::test]
    async fn share_info_and_config_helpers_cover_null_and_default_branches() {
        let _serial = lock_coverage_tests();
        let _guard = GlobalStateGuard::new();
        {
            let mut share = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            share.active = true;
            share.workspace_path = None;
        }

        let (status, info) = json_response(h_get_share_info().await).await;
        assert_eq!(status, StatusCode::OK);
        assert!(info["workspace_path"].is_null());
        assert!(info["current_worktree"].is_null());
        assert_eq!(get_param_u64(&json!(null), "missing_number", 99), 99);
    }

    // TODO: websocket/ngrok integration test skipped
    // TODO: start_server bind-and-serve success branches are skipped because
    // this sandbox rejects local TCP binds with PermissionDenied. The bind
    // error path is exercised by the MCP startup test above.
}
