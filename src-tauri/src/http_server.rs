use axum::{
    extract::{Json, Query, Request, ws::{Message, WebSocket, WebSocketUpgrade}},
    http::{HeaderMap, StatusCode},
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
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

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
    PTY_MANAGER, SHARE_STATE, AUTHENTICATED_SESSIONS, LOCK_BROADCAST,
    load_workspace_config,
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
    {
        let share_state = SHARE_STATE.lock().unwrap();
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
    let map = crate::WINDOW_WORKSPACES.lock().unwrap();
    let values: Vec<String> = map.values().cloned().collect();
    Json(json!(values)).into_response()
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
    let locks = crate::WORKTREE_LOCKS.lock().unwrap();
    let result: HashMap<String, String> = locks
        .iter()
        .filter(|((wp, _), _)| *wp == ws_path)
        .map(|((_, wt), label)| (wt.clone(), label.clone()))
        .collect();
    Json(json!(result)).into_response()
}

// -- PTY --

async fn h_pty_create(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let cwd = args["cwd"].as_str().unwrap_or("").to_string();
    let cols = args["cols"].as_u64().unwrap_or(80) as u16;
    let rows = args["rows"].as_u64().unwrap_or(24) as u16;
    let r = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))
        .and_then(|mut m| m.create_session(&session_id, &cwd, cols, rows));
    result_ok(r)
}

async fn h_pty_write(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let data = args["data"].as_str().unwrap_or("").to_string();
    let r = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))
        .and_then(|m| m.write_to_session(&session_id, &data));
    result_ok(r)
}

async fn h_pty_read(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let r = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))
        .and_then(|m| m.read_from_session(&session_id));
    result_json(r)
}

async fn h_pty_resize(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let cols = args["cols"].as_u64().unwrap_or(80) as u16;
    let rows = args["rows"].as_u64().unwrap_or(24) as u16;
    let r = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))
        .and_then(|m| m.resize_session(&session_id, cols, rows));
    result_ok(r)
}

async fn h_pty_close(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let r = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))
        .and_then(|mut m| m.close_session(&session_id));
    result_ok(r)
}

async fn h_pty_exists(Json(args): Json<Value>) -> Response {
    let session_id = args["sessionId"].as_str().unwrap_or("").to_string();
    let r = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))
        .map(|m| m.has_session(&session_id));
    result_json(r)
}

async fn h_pty_close_by_path(Json(args): Json<Value>) -> Response {
    let path_prefix = args["pathPrefix"].as_str().unwrap_or("").to_string();
    let r: Result<Vec<String>, String> = PTY_MANAGER
        .lock()
        .map_err(|e| format!("Lock error: {}", e))
        .map(|mut m| m.close_sessions_by_path_prefix(&path_prefix));
    result_json(r)
}

// -- Auth --

/// Middleware: check if the request is authenticated when password is set.
/// Exempt: /api/auth, /api/get_share_info, and non-API paths (static files).
async fn auth_middleware(headers: HeaderMap, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();

    // Allow non-API paths (static files), exempt endpoints, and WebSocket
    if !path.starts_with("/api/") || path == "/api/auth" || path == "/api/get_share_info" || path == "/ws" {
        return next.run(request).await;
    }

    // Check if sharing is active and has a password
    let needs_auth = {
        let state = SHARE_STATE.lock().unwrap();
        state.active && state.password.is_some()
    };

    if !needs_auth {
        return next.run(request).await;
    }

    // Check session authentication
    let sid = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("web-default")
        .to_string();

    let is_authenticated = {
        let sessions = AUTHENTICATED_SESSIONS.lock().unwrap();
        sessions.contains(&sid)
    };

    if is_authenticated {
        return next.run(request).await;
    }

    (StatusCode::UNAUTHORIZED, "Authentication required").into_response()
}

async fn h_auth(headers: HeaderMap, Json(args): Json<Value>) -> Response {
    let password = args["password"].as_str().unwrap_or("");

    let expected = {
        let state = SHARE_STATE.lock().unwrap();
        state.password.clone().unwrap_or_default()
    };

    if password == expected {
        let sid = headers
            .get("x-session-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("web-default")
            .to_string();
        AUTHENTICATED_SESSIONS.lock().unwrap().insert(sid);
        StatusCode::NO_CONTENT.into_response()
    } else {
        (StatusCode::UNAUTHORIZED, "密码错误").into_response()
    }
}

// -- Share info --

async fn h_get_share_info() -> Response {
    let share_state = SHARE_STATE.lock().unwrap();
    if !share_state.active {
        return Json(json!({
            "workspace_name": null,
            "workspace_path": null
        })).into_response();
    }

    let (ws_name, ws_path) = if let Some(ref path) = share_state.workspace_path {
        let config = load_workspace_config(path);
        (Some(config.name), Some(path.clone()))
    } else {
        (None, None)
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
    Query(params): Query<WsParams>,
) -> Response {
    // Authenticate via query param
    let sid = match params.session_id {
        Some(s) => s,
        None => return (StatusCode::UNAUTHORIZED, "Missing session_id").into_response(),
    };

    let needs_auth = {
        let state = SHARE_STATE.lock().unwrap();
        state.active && state.password.is_some()
    };

    if needs_auth {
        let is_authenticated = {
            let sessions = AUTHENTICATED_SESSIONS.lock().unwrap();
            sessions.contains(&sid)
        };
        if !is_authenticated {
            return (StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
        }
    }

    ws.on_upgrade(move |socket| handle_ws(socket, sid))
}

async fn handle_ws(socket: WebSocket, session_id: String) {
    let (ws_sender, mut ws_receiver) = socket.split();
    let ws_sender = Arc::new(TokioMutex::new(ws_sender));

    // Auto-bind session to the shared workspace
    {
        let share_state = SHARE_STATE.lock().unwrap();
        if let Some(ref ws_path) = share_state.workspace_path {
            if share_state.active {
                let _ = set_window_workspace_impl(&session_id, ws_path.clone());
            }
        }
    }

    // Track spawned forwarder tasks so we can abort them on disconnect
    let mut pty_forwarders: HashMap<String, tokio::task::JoinHandle<()>> = HashMap::new();
    let mut lock_forwarder: Option<tokio::task::JoinHandle<()>> = None;

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
                                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                                    // Missed some messages, continue
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
                    Some(s) => s,
                    None => continue,
                };
                let data = match parsed["data"].as_str() {
                    Some(d) => d,
                    None => continue,
                };
                let _ = PTY_MANAGER
                    .lock()
                    .map_err(|e| format!("Lock error: {}", e))
                    .and_then(|m| m.write_to_session(pty_session_id, data));
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
                {
                    let msg_str = {
                        let locks = crate::WORKTREE_LOCKS.lock().unwrap();
                        let lock_snapshot: HashMap<String, String> = locks
                            .iter()
                            .filter(|((wp, _), _)| *wp == workspace_path)
                            .map(|((_, wt), label)| (wt.clone(), label.clone()))
                            .collect();
                        json!({
                            "type": "lock_update",
                            "locks": lock_snapshot,
                        }).to_string()
                    };
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
    log::info!("WebSocket disconnected for session {}", session_id);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn create_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Resolve the dist/ folder relative to the current executable
    let dist_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
        .map(|dir| dir.join("dist"))
        .unwrap_or_else(|| std::path::PathBuf::from("dist"));

    // If the bundled dist doesn't exist, try the project-level dist (for dev)
    let dist_path = if dist_path.exists() {
        dist_path
    } else {
        // Fallback: relative to cargo manifest / project root
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
    };

    let serve_dir = ServeDir::new(&dist_path)
        .append_index_html_on_directories(true)
        .fallback(ServeDir::new(&dist_path).append_index_html_on_directories(true));

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
        // Misc
        .route("/api/get_app_version", post(h_get_app_version))
        // WebSocket (auth handled in upgrade handler via query param)
        .route("/ws", get(h_ws_upgrade))
        .layer(axum::middleware::from_fn(auth_middleware))
        .fallback_service(serve_dir)
        .layer(cors)
}

/// Start the HTTP server with graceful shutdown support.
pub async fn start_server(port: u16, mut shutdown_rx: tokio::sync::watch::Receiver<bool>) {
    let app = create_router();
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    log::info!("HTTP API server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind HTTP server");
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.changed().await;
            log::info!("HTTP server shutting down gracefully");
        })
        .await
        .expect("HTTP server error");
}
