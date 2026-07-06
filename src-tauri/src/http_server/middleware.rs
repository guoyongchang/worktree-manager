use axum::{
    extract::{ConnectInfo, Request},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::net::SocketAddr;

use crate::{set_window_workspace_impl, AUTHENTICATED_SESSIONS, CONNECTED_CLIENTS, SHARE_STATE};

pub(super) fn is_loopback_request(addr: &SocketAddr) -> bool {
    addr.ip().is_loopback()
}

fn is_forwarded_remote_request(headers: &HeaderMap) -> bool {
    headers.contains_key("x-forwarded-for")
        || headers.contains_key("forwarded")
        || headers.contains_key("x-real-ip")
        // Requests proxied in from the WMS tunnel arrive from a loopback address but carry
        // this marker; treat them as remote so host-only operations stay blocked.
        || headers.contains_key(crate::wms_tunnel::TUNNEL_MARKER_HEADER)
}

fn is_localhost_only_path(path: &str) -> bool {
    matches!(
        path,
        "/api/get_config_path_info"
            | "/api/load_workspace_config_by_path"
            | "/api/save_workspace_config_by_path"
            | "/api/vault_status"
            | "/api/vault_link"
            | "/api/list_vault_item_children"
            | "/api/open_in_terminal"
            | "/api/open_in_editor"
            | "/api/reveal_in_finder"
            | "/api/open_log_dir"
            | "/api/detect_tools"
            | "/api/get_crash_report"
            | "/api/set_git_path"
            | "/api/get_ngrok_token"
            | "/api/set_ngrok_token"
            | "/api/start_ngrok_tunnel"
            | "/api/stop_ngrok_tunnel"
            | "/api/start_wms_tunnel"
            | "/api/stop_wms_tunnel"
            | "/api/wms_manual_reconnect"
            | "/api/get_last_share_password"
            | "/api/get_dashscope_api_key"
            | "/api/set_dashscope_api_key"
            | "/api/get_dashscope_base_url"
            | "/api/set_dashscope_base_url"
            | "/api/download_update_via_mirror"
            | "/api/test_mirror_speed"
            | "/api/save_custom_mirrors"
            | "/api/open_devtools"
            | "/api/terminate_worktree_locking_process"
            | "/api/frontend_log"
            // Cloud account / device-pairing management is owner-only, just like the ngrok
            // token and WMS tunnel controls above. A remote share client must never be able
            // to read the owner's cloud status or wipe/rebind their cloud + tunnel credentials.
            | "/api/cloud_get_status"
            | "/api/cloud_start_pairing"
            | "/api/cloud_check_pairing_status"
            | "/api/cloud_approve_pairing"
            | "/api/cloud_reject_pairing"
            | "/api/cloud_disconnect"
    )
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
        if let Some(ref ws_path) = share_state.workspace_path {
            if share_state.active {
                let _ = set_window_workspace_impl(&sid, ws_path.clone());
            }
        }
    }

    sid
}

/// Middleware: block dangerous host-only operations from remote (non-localhost) clients.
pub(super) async fn localhost_only_middleware(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path().to_string();

    if is_localhost_only_path(path.as_str())
        && (!is_loopback_request(&addr) || is_forwarded_remote_request(request.headers()))
    {
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
    response
}

/// Middleware: check if the request is authenticated when password is set.
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

    // Recover from a poisoned lock instead of `.unwrap_or(false)`: the previous form would
    // silently drop authentication (fail OPEN) on the RCE-gating endpoints if the mutex were
    // ever poisoned. Reading the real state under poison keeps the gate fail-closed.
    let needs_auth = {
        let state = SHARE_STATE.lock().unwrap_or_else(|p| p.into_inner());
        state.active && state.auth_key.is_some()
    };
    if !needs_auth {
        return next.run(request).await;
    }

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
        if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
            if let Some(client) = clients.get_mut(&sid) {
                client.last_active = chrono::Utc::now().to_rfc3339();
            }
        }
        return next.run(request).await;
    }

    (StatusCode::UNAUTHORIZED, "Authentication required").into_response()
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
}
