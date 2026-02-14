use axum::{
    extract::{ConnectInfo, Json, Query, Request, ws::{Message, WebSocket, WebSocketUpgrade}},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::services::{ServeDir, ServeFile};
use tauri::Emitter;

use crate::{
    // _impl functions (window-context commands)
    get_current_workspace_impl, switch_workspace_impl,
    set_window_workspace_impl, get_workspace_config_impl,
    save_workspace_config_impl, get_config_path_info_impl,
    list_worktrees_impl, get_main_workspace_status_impl,
    create_worktree_impl, archive_worktree_impl,
    check_worktree_status_impl, restore_worktree_impl,
    delete_archived_worktree_impl, add_project_to_worktree_impl,
    clone_project_impl, unregister_window_impl,
    lock_worktree_impl, unlock_worktree_impl,
    // Direct functions (no window context)
    WorkspaceConfig, CreateWorktreeRequest, AddProjectToWorktreeRequest,
    SwitchBranchRequest, CloneProjectRequest, OpenEditorRequest,
    PTY_MANAGER, SHARE_STATE, AUTHENTICATED_SESSIONS, CONNECTED_CLIENTS, LOCK_BROADCAST,
    AUTH_RATE_LIMITER, TERMINAL_STATE_BROADCAST,
    ConnectedClient, load_workspace_config, git_ops, normalize_path,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract the session ID from headers, falling back to "web-default".
/// Auto-binds the session to the shared workspace if one is active.
fn session_id(headers: &HeaderMap) -> String {
    let sid = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("web-default")
        .to_string();

    // Auto-bind: if SHARE_STATE has an active workspace, bind this session to it
    if let Ok(share_state) = SHARE_STATE.lock() {
        if let Some(ref ws_path) = share_state.workspace_path {
            if share_state.active {
                let _ = set_window_workspace_impl(&sid, ws_path.clone());
            }
        }
    }

    sid
}

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
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid config: {}", e)).into_response(),
    };
    result_ok(save_workspace_config_impl(&sid, config))
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
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response(),
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
    let request: AddProjectToWorktreeRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response(),
    };
    result_ok(add_project_to_worktree_impl(&sid, request))
}

async fn h_clone_project(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let sid = session_id(&headers);
    let request: CloneProjectRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response(),
    };
    result_ok(clone_project_impl(&sid, request))
}

// -- Git operations --

async fn h_switch_branch(Json(args): Json<Value>) -> Response {
    let request: SwitchBranchRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response(),
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

async fn h_check_remote_branch_exists(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    let branch_name = args["branchName"].as_str().unwrap_or("").to_string();
    let normalized = normalize_path(&path);
    result_json(git_ops::check_remote_branch_exists(std::path::Path::new(&normalized), &branch_name))
}


// -- Scan --

async fn h_scan_linked_folders(Json(args): Json<Value>) -> Response {
    let project_path = args["projectPath"].as_str().unwrap_or("").to_string();
    result_json(crate::scan_linked_folders_internal(&project_path))
}

// -- System utilities --

async fn h_open_in_terminal(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    result_ok(crate::open_in_terminal_internal(&path))
}

async fn h_open_in_editor(Json(args): Json<Value>) -> Response {
    let request: OpenEditorRequest = match serde_json::from_value(args["request"].clone()) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid request: {}", e)).into_response(),
    };
    result_ok(crate::open_in_editor_internal(&request))
}

async fn h_reveal_in_finder(Json(args): Json<Value>) -> Response {
    let path = args["path"].as_str().unwrap_or("").to_string();
    result_ok(crate::reveal_in_finder_internal(&path))
}

async fn h_open_log_dir() -> Response {
    result_ok(crate::open_log_dir_internal())
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

// -- PTY --

/// Run a closure that requires the PTY_MANAGER lock on a blocking thread.
async fn with_pty_manager<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut crate::pty_manager::PtyManager) -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut manager = PTY_MANAGER.lock().map_err(|e| format!("Lock error: {}", e))?;
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
    result_ok(with_pty_manager(move |m| m.create_session(&session_id, &cwd, cols, rows)).await)
}

async fn h_pty_write(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let data = args["data"].as_str().unwrap_or("").to_string();
    result_ok(with_pty_manager(move |m| m.write_to_session(&session_id, &data)).await)
}

async fn h_pty_read(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    result_json(with_pty_manager(move |m| m.read_from_session(&session_id)).await)
}

async fn h_pty_resize(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let cols = args["cols"].as_u64().unwrap_or(80) as u16;
    let rows = args["rows"].as_u64().unwrap_or(24) as u16;
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

/// Middleware: block dangerous host-only operations from remote (non-localhost) clients.
/// Operations like open_in_terminal, open_in_editor, reveal_in_finder, open_log_dir
/// should only be available from localhost, not from remote browser sessions.
async fn localhost_only_middleware(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    let restricted_paths = [
        "/api/open_in_terminal",
        "/api/open_in_editor",
        "/api/reveal_in_finder",
        "/api/open_log_dir",
        // ngrok management should only be accessible from localhost
        "/api/get_ngrok_token",
        "/api/set_ngrok_token",
        "/api/start_ngrok_tunnel",
        "/api/stop_ngrok_tunnel",
    ];

    if restricted_paths.contains(&path.as_str()) {
        let ip = addr.ip();
        if !ip.is_loopback() {
            return (StatusCode::FORBIDDEN, "This operation is only available from localhost").into_response();
        }
    }

    next.run(request).await
}

/// Middleware: add security headers to all responses.
async fn security_headers_middleware(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("x-xss-protection", HeaderValue::from_static("1; mode=block"));
    headers.insert("referrer-policy", HeaderValue::from_static("strict-origin-when-cross-origin"));
    headers.insert("permissions-policy", HeaderValue::from_static("camera=(), microphone=(), geolocation=()"));
    response
}

/// Middleware: check if the request is authenticated when password is set.
/// Exempt: /api/auth, /api/get_share_info, and non-API paths (static files).
async fn auth_middleware(headers: HeaderMap, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();

    // Allow non-API paths (static files), exempt endpoints, and WebSocket
    if !path.starts_with("/api/") || path == "/api/auth" || path == "/api/get_share_info" || path == "/ws" {
        return next.run(request).await;
    }

    // Check if sharing is active and has a password
    let needs_auth = SHARE_STATE
        .lock()
        .map(|state| state.active && state.password.is_some())
        .unwrap_or(false);

    if !needs_auth {
        return next.run(request).await;
    }

    // Check session authentication
    let sid = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("web-default")
        .to_string();

    let is_authenticated = AUTHENTICATED_SESSIONS
        .lock()
        .map(|sessions| sessions.contains(&sid))
        .unwrap_or(false);

    if is_authenticated {
        // Update last_active timestamp
        if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
            if let Some(client) = clients.get_mut(&sid) {
                client.last_active = chrono::Utc::now().to_rfc3339();
            }
        }
        return next.run(request).await;
    }

    (StatusCode::UNAUTHORIZED, "Authentication required").into_response()
}

async fn h_auth(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(args): Json<Value>,
) -> Response {
    let client_ip = addr.ip().to_string();

    // Rate limiting: max 5 attempts per 60 seconds per IP
    let rate_ok = AUTH_RATE_LIMITER.lock()
        .map(|mut limiter| limiter.check_and_record(&client_ip))
        .unwrap_or(false);
    if !rate_ok {
        log::warn!("Auth rate limited for IP: {}", client_ip);
        return (StatusCode::TOO_MANY_REQUESTS, "请求过于频繁，请稍后再试").into_response();
    }

    let password = args["password"].as_str().unwrap_or("");

    let expected = SHARE_STATE
        .lock()
        .map(|state| state.password.clone().unwrap_or_default())
        .unwrap_or_default();

    // Constant-time comparison to prevent timing attacks.
    // We hash both inputs with a fixed-length output to avoid leaking length information.
    use std::hash::{Hash, Hasher};
    let password_match = {
        // Use SipHash (Rust default) on both values to normalize length, then compare.
        // This prevents timing leaks from early-exit on length mismatch.
        let hash_val = |s: &str| -> u64 {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            s.hash(&mut hasher);
            hasher.finish()
        };
        let h_input = hash_val(password);
        let h_expected = hash_val(&expected);
        // Constant-time XOR comparison on fixed 8-byte values
        let mut diff = h_input ^ h_expected;
        // Also require exact string match to avoid hash collisions
        diff |= (password.len() != expected.len()) as u64;
        // Iterate bytes for actual comparison (both hashed to same length first)
        let a = password.as_bytes();
        let b = expected.as_bytes();
        let max_len = a.len().max(b.len());
        let mut byte_diff = 0u8;
        for i in 0..max_len {
            let x = if i < a.len() { a[i] } else { 0 };
            let y = if i < b.len() { b[i] } else { 1 }; // different default to avoid false match
            byte_diff |= x ^ y;
        }
        diff == 0 && byte_diff == 0
    };
    if password_match {
        // Generate a server-side session ID to prevent client forgery
        let sid = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let user_agent = headers
            .get("user-agent")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_string();

        // Record connected client, removing stale entries from the same IP
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
            let stale: Vec<String> = clients.iter()
                .filter(|(_, c)| c.ip == client_ip && !c.ws_connected)
                .map(|(s, _)| s.clone())
                .collect();
            for s in &stale { clients.remove(s); }
            clients.insert(sid.clone(), client);
            stale
        } else {
            vec![]
        };
        if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
            for s in &stale_sids { sessions.remove(s); }
            sessions.insert(sid.clone());
        }
        Json(json!({ "sessionId": sid })).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, "密码错误").into_response()
    }
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
    let null_response = || Json(json!({ "workspace_name": null, "workspace_path": null })).into_response();

    let share_state = match SHARE_STATE.lock() {
        Ok(s) if s.active => s,
        _ => return null_response(),
    };

    let (ws_name, ws_path) = match share_state.workspace_path {
        Some(ref path) => {
            let config = load_workspace_config(path);
            (Some(config.name), Some(path.clone()))
        }
        None => (None, None),
    };

    Json(json!({
        "workspace_name": ws_name,
        "workspace_path": ws_path
    })).into_response()
}

// -- Misc --

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
        .map(|state| state.active && state.password.is_some())
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

                // Get broadcast receiver from PTY manager
                let rx = {
                    let manager = match PTY_MANAGER.lock() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    manager.subscribe_session(&pty_session_id)
                };

                if let Some(mut rx) = rx {
                    let sender = Arc::clone(&ws_sender);
                    let sid = pty_session_id.clone();
                    let handle = tokio::spawn(async move {
                        loop {
                            match rx.recv().await {
                                Ok(data) => {
                                    let text = String::from_utf8_lossy(&data).to_string();
                                    let msg = json!({
                                        "type": "pty_output",
                                        "sessionId": sid,
                                        "data": text,
                                    });
                                    let mut sender = sender.lock().await;
                                    if sender.send(Message::text(msg.to_string())).await.is_err() {
                                        break;
                                    }
                                }
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                                    // Log lagged receiver warning - client is too slow to process PTY output
                                    log::warn!("PTY output broadcast lagged, skipped {} messages for session {}",
                                        skipped, sid);
                                    continue;
                                }
                                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                    break;
                                }
                            }
                        }
                    });
                    pty_forwarders.insert(pty_session_id, handle);
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
                }).await;
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
                    Some(json!({
                        "type": "lock_update",
                        "locks": lock_snapshot,
                    }).to_string())
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
                                        if sender.send(Message::text(msg.to_string())).await.is_err() {
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
                let initial_state = crate::TERMINAL_STATES
                    .lock()
                    .ok()
                    .and_then(|states| {
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
                        "sequence": state.sequence,
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
                                        && val["worktreeName"].as_str() == Some(&wt_name) {
                                        let msg = json!({
                                            "type": "terminal_state_update",
                                            "workspacePath": &ws_path,
                                            "worktreeName": &wt_name,
                                            "activatedTerminals": val["activatedTerminals"],
                                            "activeTerminalTab": val["activeTerminalTab"],
                                            "terminalVisible": val["terminalVisible"],
                                            "sequence": val["sequence"],
                                        });
                                        let mut sender = sender.lock().await;
                                        if sender.send(Message::text(msg.to_string())).await.is_err() {
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
                let activated_terminals = parsed["activatedTerminals"].as_array().map(|arr| {
                    arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>()
                }).unwrap_or_default();
                let active_terminal_tab = parsed["activeTerminalTab"].as_str().map(|s| s.to_string());
                let terminal_visible = parsed["terminalVisible"].as_bool().unwrap_or(false);
                let sequence = parsed["sequence"].as_u64();

                // Update cache with sequence number
                if let Ok(mut states) = crate::TERMINAL_STATES.lock() {
                    let key = (workspace_path.clone(), worktree_name.clone());
                    states.insert(key, crate::TerminalState {
                        activated_terminals: activated_terminals.clone(),
                        active_terminal_tab: active_terminal_tab.clone(),
                        terminal_visible,
                        sequence,
                    });
                }

                // Broadcast to all connected clients with sequence number
                let broadcast_msg = json!({
                    "workspacePath": workspace_path,
                    "worktreeName": worktree_name,
                    "activatedTerminals": activated_terminals,
                    "activeTerminalTab": active_terminal_tab,
                    "terminalVisible": terminal_visible,
                    "sequence": sequence,
                }).to_string();
                let _ = TERMINAL_STATE_BROADCAST.send(broadcast_msg);

                // Also emit Tauri event for PC端 to receive Web端 changes
                if let Some(app_handle) = crate::APP_HANDLE.lock().ok().and_then(|h| h.as_ref().cloned()) {
                    let _ = app_handle.emit("terminal-state-update", json!({
                        "workspacePath": workspace_path,
                        "worktreeName": worktree_name,
                        "activatedTerminals": activated_terminals,
                        "activeTerminalTab": active_terminal_tab,
                        "terminalVisible": terminal_visible,
                        "sequence": sequence,
                    }));
                }
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

    // Mark WebSocket disconnected
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        if let Some(client) = clients.get_mut(&session_id) {
            client.ws_connected = false;
        }
    }
    log::info!("WebSocket disconnected for session {}", session_id);
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/// Check if an origin is allowed (localhost, LAN, or active ngrok URL).
fn is_allowed_origin(origin: &str) -> bool {
    // Always allow localhost / loopback
    if origin.starts_with("http://localhost")
        || origin.starts_with("https://localhost")
        || origin.starts_with("http://127.0.0.1")
        || origin.starts_with("https://127.0.0.1")
        || origin.starts_with("http://[::1]")
        || origin.starts_with("https://[::1]")
    {
        return true;
    }
    // Allow LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if let Some(host) = origin.split("//").nth(1).map(|s| s.split(':').next().unwrap_or(s)) {
        if host.starts_with("192.168.")
            || host.starts_with("10.")
            || (host.starts_with("172.") && {
                host.split('.').nth(1).and_then(|s| s.parse::<u8>().ok()).map_or(false, |n| (16..=31).contains(&n))
            })
        {
            return true;
        }
    }
    // Allow the active ngrok URL if one exists
    if let Ok(state) = SHARE_STATE.lock() {
        if let Some(ref ngrok_url) = state.ngrok_url {
            if origin.starts_with(ngrok_url) {
                return true;
            }
        }
    }
    false
}

pub fn create_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(|origin: &HeaderValue, _| {
            origin.to_str().map_or(false, is_allowed_origin)
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::HeaderName::from_static("x-session-id"),
        ]);

    // Resolve the dist/ folder relative to the current executable
    let dist_path = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            let exe_dir = exe.parent()?;
            // On macOS, check if we're in an app bundle (Contents/MacOS/)
            if cfg!(target_os = "macos") {
                if let Some(contents_dir) = exe_dir.parent() {
                    if contents_dir.file_name().and_then(|n| n.to_str()) == Some("Contents") {
                        // In app bundle: dist is in Contents/Resources/dist
                        let resources_dist = contents_dir.join("Resources").join("dist");
                        if resources_dist.exists() {
                            log::info!("Using dist path from app bundle: {:?}", resources_dist);
                            return Some(resources_dist);
                        }
                    }
                }
            }
            // Try dist next to executable
            let exe_dist = exe_dir.join("dist");
            if exe_dist.exists() {
                log::info!("Using dist path next to executable: {:?}", exe_dist);
                return Some(exe_dist);
            }
            None
        })
        .unwrap_or_else(|| {
            // Fallback: relative to cargo manifest / project root (for dev)
            let fallback = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
            log::info!("Using fallback dist path: {:?}", fallback);
            fallback
        });

    let serve_dir = ServeDir::new(&dist_path)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(dist_path.join("index.html")));

    Router::new()
        // Workspace management
        .route("/api/list_workspaces", post(h_list_workspaces))
        .route("/api/add_workspace", post(h_add_workspace))
        .route("/api/remove_workspace", post(h_remove_workspace))
        .route("/api/create_workspace", post(h_create_workspace))
        .route("/api/set_window_workspace", post(h_set_window_workspace))
        .route("/api/get_current_workspace", post(h_get_current_workspace))
        .route("/api/switch_workspace", post(h_switch_workspace))
        // Workspace config
        .route("/api/get_workspace_config", post(h_get_workspace_config))
        .route("/api/save_workspace_config", post(h_save_workspace_config))
        .route("/api/get_config_path_info", post(h_get_config_path_info))
        // Worktree operations
        .route("/api/list_worktrees", post(h_list_worktrees))
        .route("/api/get_main_workspace_status", post(h_get_main_workspace_status))
        .route("/api/create_worktree", post(h_create_worktree))
        .route("/api/archive_worktree", post(h_archive_worktree))
        .route("/api/check_worktree_status", post(h_check_worktree_status))
        .route("/api/restore_worktree", post(h_restore_worktree))
        .route("/api/delete_archived_worktree", post(h_delete_archived_worktree))
        .route("/api/add_project_to_worktree", post(h_add_project_to_worktree))
        // Git operations
        .route("/api/switch_branch", post(h_switch_branch))
        .route("/api/clone_project", post(h_clone_project))
        .route("/api/get_branch_diff_stats", post(h_get_branch_diff_stats))
        .route("/api/check_remote_branch_exists", post(h_check_remote_branch_exists))
        // Scan
        .route("/api/scan_linked_folders", post(h_scan_linked_folders))
        // System utilities
        .route("/api/open_in_terminal", post(h_open_in_terminal))
        .route("/api/open_in_editor", post(h_open_in_editor))
        .route("/api/reveal_in_finder", post(h_reveal_in_finder))
        .route("/api/open_log_dir", post(h_open_log_dir))
        // Multi-window management
        .route("/api/get_opened_workspaces", post(h_get_opened_workspaces))
        .route("/api/unregister_window", post(h_unregister_window))
        .route("/api/lock_worktree", post(h_lock_worktree))
        .route("/api/unlock_worktree", post(h_unlock_worktree))
        .route("/api/get_locked_worktrees", post(h_get_locked_worktrees))
        .route("/api/open_workspace_window", post(h_open_workspace_window))
        // PTY
        .route("/api/pty_create", post(h_pty_create))
        .route("/api/pty_write", post(h_pty_write))
        .route("/api/pty_read", post(h_pty_read))
        .route("/api/pty_resize", post(h_pty_resize))
        .route("/api/pty_close", post(h_pty_close))
        .route("/api/pty_exists", post(h_pty_exists))
        .route("/api/pty_close_by_path", post(h_pty_close_by_path))
        // Auth
        .route("/api/auth", post(h_auth))
        // Share info
        .route("/api/get_share_info", get(h_get_share_info))
        // Connected clients
        .route("/api/get_connected_clients", post(h_get_connected_clients))
        .route("/api/kick_client", post(h_kick_client))
        // ngrok
        .route("/api/get_ngrok_token", post(h_get_ngrok_token))
        .route("/api/set_ngrok_token", post(h_set_ngrok_token))
        .route("/api/start_ngrok_tunnel", post(h_start_ngrok_tunnel))
        .route("/api/stop_ngrok_tunnel", post(h_stop_ngrok_tunnel))
        // Misc
        .route("/api/get_app_version", post(h_get_app_version))
        // WebSocket (auth handled in upgrade handler via query param)
        .route("/ws", get(h_ws_upgrade))
        .layer(axum::middleware::from_fn(auth_middleware))
        .layer(axum::middleware::from_fn(localhost_only_middleware))
        .layer(axum::middleware::from_fn(security_headers_middleware))
        // Limit request body to 1MB to prevent DoS via oversized payloads
        .layer(RequestBodyLimitLayer::new(1024 * 1024))
        .fallback_service(serve_dir)
        .layer(cors)
}

/// Start the HTTP server with graceful shutdown support.
pub async fn start_server(port: u16, mut shutdown_rx: tokio::sync::watch::Receiver<bool>) {
    let app = create_router();
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    log::info!("HTTP API server listening on http://{}", addr);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to bind HTTP server on {}: {}", addr, e);
            return;
        }
    };
    if let Err(e) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        let _ = shutdown_rx.changed().await;
        log::info!("HTTP server shutting down gracefully");
    })
    .await
    {
        log::error!("HTTP server error: {}", e);
    }
}
