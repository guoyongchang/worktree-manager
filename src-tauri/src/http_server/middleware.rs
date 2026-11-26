use axum::{
    body::{to_bytes, Body},
    extract::{ConnectInfo, Request},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};

use crate::{
    normalize_path, set_window_workspace_impl, state::validate_and_touch_session,
    CONNECTED_CLIENTS, SHARE_STATE,
};
/// Request extension set by `localhost_only_middleware` indicating whether the caller is remote
/// (non-loopback socket OR arrived via reverse proxy / tunnel headers).
#[derive(Clone, Copy, Debug)]
pub(super) struct RequestRemoteFlag(pub bool);

pub(super) fn is_loopback_request(addr: &SocketAddr) -> bool {
    addr.ip().is_loopback()
}

pub(super) fn is_forwarded_remote_request(headers: &HeaderMap) -> bool {
    headers.contains_key("x-forwarded-for")
        || headers.contains_key("forwarded")
        || headers.contains_key("x-real-ip")
        // Requests proxied in from the WMS tunnel arrive from a loopback address but carry
        // this marker; treat them as remote so host-only operations stay blocked.
        || headers.contains_key(crate::wms_tunnel::TUNNEL_MARKER_HEADER)
}

pub(super) fn is_remote_request(addr: &SocketAddr, headers: &HeaderMap) -> bool {
    !is_loopback_request(addr) || is_forwarded_remote_request(headers)
}

/// Extract the effective client IP for rate-limiting and client tracking.
///
/// For direct LAN/loopback connections, uses the TCP peer IP.
/// For proxied connections arriving from loopback (WMS tunnel / ngrok), parses the
/// rightmost valid IP from `X-Forwarded-For` (harder for an external client to spoof
/// than the leftmost entry), falling back to `X-Real-IP`.
/// Returns `(client_ip_key, is_forwarded)`.
pub(super) fn extract_client_ip(addr: &SocketAddr, headers: &HeaderMap) -> (String, bool) {
    if is_loopback_request(addr) && is_forwarded_remote_request(headers) {
        if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            for candidate in xff.rsplit(',').map(str::trim) {
                if let Ok(ip) = candidate.parse::<std::net::IpAddr>() {
                    return (format!("proxy:{}", ip), true);
                }
            }
        }
        if let Some(real_ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
            if let Ok(ip) = real_ip.trim().parse::<std::net::IpAddr>() {
                return (format!("proxy:{}", ip), true);
            }
        }
        return ("proxy:unknown".to_string(), true);
    }

    (addr.ip().to_string(), false)
}

/// Explicit allowlist of API endpoints that remote (LAN / ngrok / WMS tunnel) share clients
/// are permitted to invoke. Any `/api/*` endpoint NOT listed here is restricted to localhost
/// by default (fail-closed) so newly added host/admin commands can never accidentally leak.
pub(super) fn is_remote_allowed_path(path: &str) -> bool {
    matches!(
        path,
        // Auth & public share bootstrap
        "/api/auth/challenge"
            | "/api/auth/verify"
            | "/api/get_share_info"
            | "/api/cert.pem"
            // Shared workspace read/context (scoped to active shared workspace in handlers)
            | "/api/list_workspaces"
            | "/api/get_current_workspace"
            | "/api/set_window_workspace"
            | "/api/get_workspace_config"
            | "/api/save_workspace_config"
            | "/api/get_opened_workspaces"
            | "/api/unregister_window"
            | "/api/open_workspace_window"
            // Worktree & project lifecycle within the shared workspace
            | "/api/list_worktrees"
            | "/api/update_worktree_color"
            | "/api/get_main_workspace_status"
            | "/api/create_worktree"
            | "/api/archive_worktree"
            | "/api/check_worktree_status"
            | "/api/restore_worktree"
            | "/api/delete_archived_worktree"
            | "/api/add_project_to_worktree"
            | "/api/deploy_to_main"
            | "/api/exit_main_occupation"
            | "/api/get_main_occupation"
            | "/api/clone_project"
            | "/api/scan_existing_projects"
            | "/api/add_existing_project"
            | "/api/remove_project_from_config"
            | "/api/scan_linked_folders"
            // Worktree locks & terminal state sync
            | "/api/lock_worktree"
            | "/api/unlock_worktree"
            | "/api/get_locked_worktrees"
            | "/api/broadcast_terminal_state"
            | "/api/get_terminal_state"
            // Git operations (path-confined to active shared workspace when remote)
            | "/api/switch_branch"
            | "/api/get_branch_diff_stats"
            | "/api/check_remote_branch_exists"
            | "/api/fetch_project_remote"
            | "/api/sync_with_base_branch"
            | "/api/sync_all_projects_to_base"
            | "/api/push_to_remote"
            | "/api/pull_current_branch"
            | "/api/merge_to_test_branch"
            | "/api/merge_to_base_branch"
            | "/api/create_pull_request"
            | "/api/get_remote_branches"
            | "/api/get_git_diff"
            | "/api/commit_all"
            | "/api/get_changed_files"
            | "/api/get_file_diff"
            | "/api/generate_commit_message"
            // PTY terminal operations (cwd/shell confined when remote)
            | "/api/pty_create"
            | "/api/pty_write"
            | "/api/pty_read"
            | "/api/pty_resize"
            | "/api/pty_close"
            | "/api/pty_exists"
            | "/api/pty_close_by_path"
            // Voice dictation usage (read/run only — never API key or base URL mutation)
            | "/api/voice_start"
            | "/api/voice_send_audio"
            | "/api/voice_stop"
            | "/api/voice_is_active"
            | "/api/voice_refine_text"
            // Read-only UI feature flags & version info needed by browser client
            | "/api/get_app_version"
            | "/api/check_dashscope_api_key"
            | "/api/check_commit_ai_api_key"
            | "/api/get_commit_ai_enabled"
            | "/api/get_commit_ai_model"
            | "/api/get_commit_prefix_config"
            | "/api/get_skip_git_hooks"
            | "/api/get_shell_integration_enabled"
            | "/api/get_ipc_timeout_seconds"
            | "/api/get_git_user_config"
            | "/api/get_git_user_global_config"
            | "/api/get_voice_refine_enabled"
            | "/api/get_voice_asr_model"
            | "/api/get_voice_refine_model"
            | "/api/report_time_saved"
    )
}

pub(super) fn is_localhost_only_path(path: &str) -> bool {
    path.starts_with("/api/") && !is_remote_allowed_path(path)
}

/// Extract the session ID from headers, falling back to `web-default`.
/// Auto-binds the session to the shared workspace if one is active.
pub(super) fn session_id(headers: &HeaderMap) -> String {
    let sid = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("web-default")
        .to_string();

    if let Ok(share_state) = SHARE_STATE.lock() {
        if share_state.active {
            if let Some(ws_path) = &share_state.workspace_path {
                let _ = set_window_workspace_impl(&sid, ws_path.clone());
            }
        }
    }
    sid
}

/// Middleware: block dangerous host-only operations from remote (non-localhost) clients.
pub(super) async fn localhost_only_middleware(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    mut request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();
    let remote = is_remote_request(&addr, request.headers());
    request.extensions_mut().insert(RequestRemoteFlag(remote));

    if is_localhost_only_path(path.as_str()) && remote {
        return (
            StatusCode::FORBIDDEN,
            "This operation is only available from localhost",
        )
            .into_response();
    }

    next.run(request).await
}

/// Middleware: add security headers to all responses.
pub(super) async fn security_headers_middleware(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        "x-xss-protection",
        HeaderValue::from_static("1; mode=block"),
    );
    headers.insert(
        "referrer-policy",
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), geolocation=()"),
    );
    headers.insert(
        "content-security-policy",
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss: https:; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        ),
    );
    response
}

/// Middleware: fail-closed authentication check on all protected `/api/*` endpoints.
///
/// Sharing always requires an active share session with a configured password key; if sharing
/// has been stopped (e.g. an attacker held an HTTP/1.1 keep-alive connection across shutdown),
/// requests are rejected rather than failing open.
pub(super) async fn auth_middleware(
    ConnectInfo(_addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();

    if !path.starts_with("/api/")
        || path == "/api/auth/challenge"
        || path == "/api/auth/verify"
        || path == "/api/get_share_info"
        || path == "/api/cert.pem"
        || path == "/ws"
    {
        return next.run(request).await;
    }

    let (active, has_auth_key) = {
        let state = SHARE_STATE.lock().unwrap_or_else(|p| p.into_inner());
        (state.active, state.auth_key.is_some())
    };
    if !active || !has_auth_key {
        return (StatusCode::SERVICE_UNAVAILABLE, "Sharing is not active").into_response();
    }

    let Some(sid) = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return (StatusCode::UNAUTHORIZED, "Authentication required").into_response();
    };

    if validate_and_touch_session(sid) {
        if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
            if let Some(client) = clients.get_mut(sid) {
                client.last_active = chrono::Utc::now().to_rfc3339();
            }
        }
        return next.run(request).await;
    }

    (StatusCode::UNAUTHORIZED, "Authentication required").into_response()
}

/// Lexically normalize a path (resolving `.` and `..` without touching disk) and unify separators.
fn normalize_lexical(raw: &str) -> Option<PathBuf> {
    let stripped = raw.split('#').next().unwrap_or(raw).trim();
    if stripped.is_empty() {
        return None;
    }
    let normalized = normalize_path(stripped);
    let mut out = PathBuf::new();
    for comp in Path::new(&normalized).components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

/// Resolve an existing path or its deepest existing ancestor via `canonicalize` to prevent
/// symlink escapes out of the shared workspace.
fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(canon) = std::fs::canonicalize(path) {
        return canon;
    }
    let mut suffix = Vec::new();
    let mut current = path.to_path_buf();
    while let Some(name) = current.file_name() {
        suffix.push(name.to_os_string());
        if !current.pop() {
            break;
        }
        if let Ok(mut base) = std::fs::canonicalize(&current) {
            for part in suffix.into_iter().rev() {
                base.push(part);
            }
            return base;
        }
    }
    path.to_path_buf()
}

fn path_key_for_prefix(path: &Path) -> String {
    let s = normalize_path(&path.to_string_lossy())
        .trim_end_matches('/')
        .to_string();
    #[cfg(target_os = "windows")]
    {
        s.to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        s
    }
}

pub(super) fn is_path_within_workspace(candidate: &str, workspace_root: &str) -> bool {
    let Some(cand_lex) = normalize_lexical(candidate) else {
        return false;
    };
    let Some(root_lex) = normalize_lexical(workspace_root) else {
        return false;
    };

    let cand_str = path_key_for_prefix(&cand_lex);
    let root_str = path_key_for_prefix(&root_lex);
    let lexical_ok = cand_str == root_str || cand_str.starts_with(&format!("{}/", root_str));
    if !lexical_ok {
        return false;
    }

    // Also verify symlink-resolved canonical paths when on-disk ancestors exist.
    let cand_canon = path_key_for_prefix(&canonicalize_best_effort(&cand_lex));
    let root_canon = path_key_for_prefix(&canonicalize_best_effort(&root_lex));
    cand_canon == root_canon || cand_canon.starts_with(&format!("{}/", root_canon))
}

fn is_allowed_remote_shell(shell: &str) -> bool {
    let trimmed = shell.trim();
    trimmed.is_empty()
        || matches!(
            trimmed.to_ascii_lowercase().as_str(),
            "auto"
                | "zsh"
                | "bash"
                | "sh"
                | "fish"
                | "nu"
                | "cmd"
                | "powershell"
                | "pwsh"
                | "gitbash"
        )
}

/// Middleware: confine remote share clients' path parameters and PTY shell selection to the
/// active shared workspace so an authenticated guest cannot escape to arbitrary host paths.
pub(super) async fn remote_workspace_scope_middleware(request: Request, next: Next) -> Response {
    let is_remote = request
        .extensions()
        .get::<RequestRemoteFlag>()
        .is_some_and(|flag| flag.0);
    let path = request.uri().path().to_string();

    if !is_remote
        || request.method() != Method::POST
        || !path.starts_with("/api/")
        || path == "/api/auth/challenge"
        || path == "/api/auth/verify"
    {
        return next.run(request).await;
    }

    let shared_ws = {
        let state = SHARE_STATE.lock().unwrap_or_else(|p| p.into_inner());
        if state.active {
            state.workspace_path.clone()
        } else {
            None
        }
    };
    let Some(shared_ws) = shared_ws else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Sharing is not active").into_response();
    };

    let (parts, body) = request.into_parts();
    let bytes = match to_bytes(body, 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "Request body too large").into_response(),
    };

    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
        if let Some(obj) = json.as_object() {
            // Validate all single-path fields (camelCase and snake_case)
            const PATH_KEYS: &[&str] = &[
                "path",
                "cwd",
                "pathPrefix",
                "path_prefix",
                "projectPath",
                "project_path",
                "workspacePath",
                "workspace_path",
            ];
            for key in PATH_KEYS {
                if let Some(val) = obj.get(*key).and_then(|v| v.as_str()) {
                    if !val.trim().is_empty() && !is_path_within_workspace(val, &shared_ws) {
                        return (
                            StatusCode::FORBIDDEN,
                            "Path is outside the shared workspace",
                        )
                            .into_response();
                    }
                }
            }

            // Nested `request.project_path` / `request.path` (e.g. switch_branch)
            if let Some(req_obj) = obj.get("request").and_then(|v| v.as_object()) {
                for key in ["project_path", "projectPath", "path"] {
                    if let Some(val) = req_obj.get(key).and_then(|v| v.as_str()) {
                        if !val.trim().is_empty() && !is_path_within_workspace(val, &shared_ws) {
                            return (
                                StatusCode::FORBIDDEN,
                                "Path is outside the shared workspace",
                            )
                                .into_response();
                        }
                    }
                }
            }

            // Array path fields (`projectPaths` / `project_paths`)
            for key in ["projectPaths", "project_paths"] {
                if let Some(arr) = obj.get(key).and_then(|v| v.as_array()) {
                    for item in arr {
                        if let Some(val) = item.as_str() {
                            if !val.trim().is_empty() && !is_path_within_workspace(val, &shared_ws)
                            {
                                return (
                                    StatusCode::FORBIDDEN,
                                    "Path is outside the shared workspace",
                                )
                                    .into_response();
                            }
                        }
                    }
                }
            }

            // Restrict PTY shell selection from remote clients to known shell IDs
            if path == "/api/pty_create" {
                if let Some(shell) = obj.get("shell").and_then(|v| v.as_str()) {
                    if !is_allowed_remote_shell(shell) {
                        return (
                            StatusCode::FORBIDDEN,
                            "Custom shell path is not allowed from remote clients",
                        )
                            .into_response();
                    }
                }
            }
        }
    }

    let rebuilt = Request::from_parts(parts, Body::from(bytes));
    next.run(rebuilt).await
}
pub(super) async fn no_cache_html_middleware(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut resp = next.run(req).await;
    let is_html = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.contains("text/html"))
        .unwrap_or(false);
    if is_html {
        let headers = resp.headers_mut();
        headers.insert(
            "Cache-Control",
            "no-cache, no-store, must-revalidate".parse().unwrap(),
        );
        headers.insert("Pragma", "no-cache".parse().unwrap());
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::is_localhost_only_path;

    #[test]
    fn cloud_management_commands_are_localhost_only() {
        for path in [
            "/api/cloud_get_status",
            "/api/cloud_start_pairing",
            "/api/cloud_check_pairing_status",
            "/api/cloud_approve_pairing",
            "/api/cloud_reject_pairing",
            "/api/cloud_disconnect",
        ] {
            assert!(
                is_localhost_only_path(path),
                "{path} must be restricted to localhost"
            );
        }
    }

    #[test]
    fn shared_endpoints_stay_remote_reachable() {
        // These are used by remote share clients and must NOT become localhost-only.
        assert!(!is_localhost_only_path("/api/pty_create"));
        assert!(!is_localhost_only_path("/api/list_worktrees"));
        assert!(!is_localhost_only_path("/api/get_file_diff"));
    }

    #[test]
    fn admin_mcp_voice_ssrf_and_share_control_endpoints_are_localhost_only() {
        for path in [
            "/api/set_voice_refine_base_url",
            "/api/list_dashscope_models",
            "/api/set_commit_ai_api_key",
            "/api/start_sharing",
            "/api/stop_sharing",
            "/api/update_share_password",
            "/api/kick_client",
            "/api/get_connected_clients",
            "/api/get_share_state",
            "/api/mcp/config",
            "/api/mcp/set_capability",
            "/api/set_mcp_capability",
            "/api/set_mcp_port",
            "/api/install_mcp_client",
            "/api/resolve_mcp_confirm",
            "/api/add_workspace",
            "/api/remove_workspace",
            "/api/create_workspace",
            "/api/switch_workspace",
            "/api/import_external_project",
            "/api/set_git_user_global_config",
            "/api/some_future_unlisted_admin_command",
        ] {
            assert!(
                is_localhost_only_path(path),
                "{path} must default to localhost-only (fail-closed allowlist)"
            );
        }
    }

    #[test]
    fn path_confinement_blocks_traversal_and_sibling_prefixes() {
        assert!(super::is_path_within_workspace(
            "/tmp/ws/projects/api",
            "/tmp/ws"
        ));
        assert!(super::is_path_within_workspace(
            "/tmp/ws/worktrees/feat#1700000000",
            "/tmp/ws"
        ));
        assert!(!super::is_path_within_workspace(
            "/tmp/ws-other/projects/api",
            "/tmp/ws"
        ));
        assert!(!super::is_path_within_workspace(
            "/tmp/ws/../etc/passwd",
            "/tmp/ws"
        ));
        assert!(!super::is_path_within_workspace("/etc/passwd", "/tmp/ws"));
    }

    #[test]
    fn extract_client_ip_uses_rightmost_xff_only_for_forwarded_loopback() {
        let loopback = std::net::SocketAddr::from(([127, 0, 0, 1], 55555));
        let mut headers = super::HeaderMap::new();
        headers.insert(
            crate::wms_tunnel::TUNNEL_MARKER_HEADER,
            super::HeaderValue::from_static("1"),
        );
        headers.insert(
            "x-forwarded-for",
            super::HeaderValue::from_static("1.2.3.4, 198.51.100.7"),
        );
        assert_eq!(
            super::extract_client_ip(&loopback, &headers),
            ("proxy:198.51.100.7".to_string(), true)
        );

        // Direct LAN connection must ignore spoofed X-Forwarded-For
        let lan = std::net::SocketAddr::from(([192, 168, 1, 50], 55555));
        assert_eq!(
            super::extract_client_ip(&lan, &headers),
            ("192.168.1.50".to_string(), false)
        );
    }
}
