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

pub(super) fn has_trusted_remote_proxy_marker(headers: &HeaderMap) -> bool {
    headers
        .get(crate::wms_tunnel::REMOTE_PROXY_AUTH_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == crate::state::REMOTE_PROXY_AUTH_TOKEN.as_str())
        .unwrap_or(false)
}

fn is_forwarded_remote_request(headers: &HeaderMap) -> bool {
    has_trusted_remote_proxy_marker(headers)
        || headers.contains_key("x-forwarded-for")
        || headers.contains_key("forwarded")
        || headers.contains_key("x-real-ip")
}

fn is_tunnel_proxied_remote_request(request: &Request) -> bool {
    is_forwarded_remote_request(request.headers())
}

fn is_localhost_only_path(path: &str) -> bool {
    matches!(
        path,
        "/auth/wms-callback"
            | "/api/get_config_path_info"
            | "/api/load_workspace_config_by_path"
            | "/api/save_workspace_config_by_path"
            | "/api/open_in_terminal"
            | "/api/open_in_editor"
            | "/api/reveal_in_finder"
            | "/api/open_log_dir"
            | "/api/detect_tools"
            | "/api/set_git_path"
            | "/api/get_ngrok_token"
            | "/api/set_ngrok_token"
            | "/api/start_ngrok_tunnel"
            | "/api/stop_ngrok_tunnel"
            | "/api/get_wms_config"
            | "/api/set_wms_config"
            | "/api/auto_register_tunnel"
            | "/api/wms_login"
            | "/api/wms_browser_login"
            | "/api/get_wms_user"
            | "/api/wms_logout"
            | "/api/start_wms_tunnel"
            | "/api/stop_wms_tunnel"
            | "/api/wms_manual_reconnect"
            | "/api/get_dashscope_api_key"
            | "/api/set_dashscope_api_key"
            | "/api/get_dashscope_base_url"
            | "/api/set_dashscope_base_url"
            | "/api/download_update_via_mirror"
            | "/api/open_devtools"
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
        && (!is_loopback_request(&addr) || is_tunnel_proxied_remote_request(&request))
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

    let needs_auth = SHARE_STATE
        .lock()
        .map(|state| state.active && state.auth_key.is_some())
        .unwrap_or(false);
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
