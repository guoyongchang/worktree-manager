use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

// ==================== Tunnel discovery ====================

/// Configuration returned by the WMS server's discovery endpoint (`GET /api/tunnel/config`).
#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct TunnelDiscoveryResponse {
    /// WebSocket connect path, e.g. "/tunnel/connect"
    #[serde(default)]
    tunnel_ws_path: Option<String>,
    /// Public URL template with `{subdomain}` placeholder,
    /// e.g. "https://{subdomain}.tunnel.kirov-opensource.com"
    #[serde(default)]
    tunnel_domain_template: Option<String>,
    /// Server-recommended heartbeat interval (informational, reserved for future use)
    #[serde(default)]
    heartbeat_interval_secs: Option<u64>,
    #[serde(default)]
    routing_mode: Option<String>,
    #[serde(default)]
    desktop_max_peer_connections: Option<usize>,
    #[serde(default)]
    center_peer_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TunnelPeerCandidate {
    pub id: String,
    pub tunnel_ws_url: String,
    pub public_base_url: String,
    pub public_ws_url: String,
    pub region: String,
    pub weight: i32,
}

#[derive(Debug, Clone, Deserialize)]
struct TunnelPeerCandidatesResponse {
    peers: Vec<TunnelPeerCandidate>,
}

/// Resolved tunnel connection parameters.
struct ResolvedTunnelConfig {
    ws_url: String,
    public_url: String,
}

/// Default WebSocket path when discovery is unavailable.
const DEFAULT_TUNNEL_WS_PATH: &str = "/tunnel/connect";

/// Fetch tunnel configuration from the server's discovery endpoint.
/// Returns `None` on any failure (network, parse, non-2xx).
async fn discover_tunnel_config(server_url: &str) -> Option<TunnelDiscoveryResponse> {
    let url = format!("{}/api/tunnel/config", server_url.trim_end_matches('/'));
    log::info!("[wms-tunnel] Fetching discovery config from {}", url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<TunnelDiscoveryResponse>().await {
                Ok(config) => {
                    log::info!("[wms-tunnel] Discovery config: {:?}", config);
                    Some(config)
                }
                Err(e) => {
                    log::warn!("[wms-tunnel] Failed to parse discovery response: {}", e);
                    None
                }
            }
        }
        Ok(resp) => {
            log::warn!(
                "[wms-tunnel] Discovery endpoint returned status {}",
                resp.status()
            );
            None
        }
        Err(e) => {
            log::warn!("[wms-tunnel] Discovery request failed: {}", e);
            None
        }
    }
}

/// Build resolved tunnel URLs from discovery response (with hardcoded fallback).
fn resolve_tunnel_config(
    server_url: &str,
    token: Option<&str>,
    subdomain: &str,
    discovery: Option<&TunnelDiscoveryResponse>,
) -> ResolvedTunnelConfig {
    let ws_path = discovery
        .and_then(|d| d.tunnel_ws_path.as_deref())
        .unwrap_or(DEFAULT_TUNNEL_WS_PATH);

    // Build WebSocket base URL (https -> wss, http -> ws)
    let ws_base = if server_url.starts_with("https://") {
        server_url.replacen("https://", "wss://", 1)
    } else if server_url.starts_with("http://") {
        server_url.replacen("http://", "ws://", 1)
    } else {
        format!("wss://{}", server_url)
    };

    let ws_base_trimmed = ws_base.trim_end_matches('/');
    let ws_path_trimmed = ws_path.trim_start_matches('/');

    let ws_url = if let Some(t) = token {
        format!(
            "{}/{}?token={}&subdomain={}",
            ws_base_trimmed,
            ws_path_trimmed,
            urlencoding::encode(t),
            urlencoding::encode(subdomain)
        )
    } else {
        format!(
            "{}/{}?subdomain={}",
            ws_base_trimmed,
            ws_path_trimmed,
            urlencoding::encode(subdomain)
        )
    };

    // Build public URL from discovery template or hardcoded fallback
    let public_url =
        if let Some(template) = discovery.and_then(|d| d.tunnel_domain_template.as_deref()) {
            let mut url = template.replace("{subdomain}", subdomain);
            // Ensure trailing slash
            if !url.ends_with('/') {
                url.push('/');
            }
            // Ensure protocol prefix
            if !url.starts_with("http://") && !url.starts_with("https://") {
                url = format!("https://{}", url);
            }
            url
        } else {
            // Hardcoded default: {protocol}://{host}/t/{subdomain}/
            let host = server_url
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_end_matches('/');
            let protocol = if server_url.starts_with("http://") {
                "http"
            } else {
                "https"
            };
            format!("{}://{}/t/{}/", protocol, host, subdomain)
        };

    ResolvedTunnelConfig { ws_url, public_url }
}

fn peer_tunnel_ws_url(peer: &TunnelPeerCandidate, token: Option<&str>, subdomain: &str) -> String {
    let separator = if peer.tunnel_ws_url.contains('?') {
        '&'
    } else {
        '?'
    };
    match token {
        Some(token) => format!(
            "{}{}token={}&subdomain={}&peer_id={}",
            peer.tunnel_ws_url,
            separator,
            urlencoding::encode(token),
            urlencoding::encode(subdomain),
            urlencoding::encode(&peer.id),
        ),
        None => format!(
            "{}{}subdomain={}&peer_id={}",
            peer.tunnel_ws_url,
            separator,
            urlencoding::encode(subdomain),
            urlencoding::encode(&peer.id),
        ),
    }
}

async fn fetch_tunnel_peers(
    server_url: &str,
    access_token: Option<&str>,
    subdomain: &str,
) -> Vec<TunnelPeerCandidate> {
    let url = format!(
        "{}/api/tunnel/peers?subdomain={}",
        server_url.trim_end_matches('/'),
        urlencoding::encode(subdomain)
    );
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return Vec::new(),
    };
    let mut req = client.get(&url);
    if let Some(token) = access_token {
        req = req.bearer_auth(token);
    }

    match req.send().await {
        Ok(resp) if resp.status().is_success() => resp
            .json::<TunnelPeerCandidatesResponse>()
            .await
            .map(|body| body.peers)
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

// ==================== Reconnection state shared with frontend ====================

/// Shared state for WMS tunnel reconnection, polled by the frontend via get_share_state.
#[derive(Default)]
pub struct WmsTunnelReconnectState {
    /// Whether the tunnel is currently in the reconnection loop (not connected).
    pub reconnecting: bool,
    /// Current reconnection attempt number (resets to 0 on successful connect).
    pub attempt: u32,
    /// When the next retry will happen (used to compute countdown).
    pub next_retry_at: Option<std::time::Instant>,
}

impl WmsTunnelReconnectState {
    /// Returns the number of seconds until the next retry, or 0 if not waiting.
    pub fn next_retry_secs(&self) -> u32 {
        self.next_retry_at
            .map(|t| {
                t.checked_duration_since(std::time::Instant::now())
                    .map(|d| d.as_secs() as u32 + if d.subsec_millis() > 0 { 1 } else { 0 })
                    .unwrap_or(0)
            })
            .unwrap_or(0)
    }
}

// ==================== Protocol types (matching WMS server tunnel/protocol.rs) ====================

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ServerMessage {
    HttpRequest {
        request_id: String,
        method: String,
        uri: String,
        headers: Vec<(String, String)>,
        body: Option<String>,
    },
    WsOpen {
        stream_id: String,
        path: String,
        headers: Vec<(String, String)>,
    },
    WsFrame {
        stream_id: String,
        data: String,
    },
    WsClose {
        stream_id: String,
    },
    Ping {
        timestamp: i64,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    HttpResponse {
        request_id: String,
        status: u16,
        headers: Vec<(String, String)>,
        body: Option<String>,
    },
    WsOpened {
        stream_id: String,
    },
    WsFrame {
        stream_id: String,
        data: String,
    },
    WsClose {
        stream_id: String,
    },
    WsError {
        stream_id: String,
        error: String,
    },
    Pong {
        timestamp: i64,
    },
}

// Hop-by-hop headers that should not be forwarded
const HOP_BY_HOP_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
];

fn is_hop_by_hop(name: &str) -> bool {
    HOP_BY_HOP_HEADERS
        .iter()
        .any(|h| name.eq_ignore_ascii_case(h))
}

/// Marker header injected on every request proxied in from the WMS tunnel.
/// The local server's `localhost_only_middleware` treats any request carrying this
/// header as remote-originated, so host-only operations (open terminal/editor,
/// tunnel control, token setters, ...) cannot be reached through the public tunnel
/// even though the proxied request arrives from a loopback address.
pub const TUNNEL_MARKER_HEADER: &str = "x-wms-tunnel";

/// Reject server-supplied request targets that could rewrite the authority of the
/// hardcoded `http(s)://localhost:{port}` base (SSRF / host-injection defense).
/// A safe origin-form target starts with a single '/' (path), never '//' (which some
/// parsers read as a protocol-relative authority).
fn is_safe_forward_target(target: &str) -> bool {
    target.starts_with('/') && !target.starts_with("//")
}

/// Redact the `token=<...>` query value in a WebSocket URL before logging, so the
/// long-lived tunnel credential is never written to disk via the log files.
fn redact_ws_url(url: &str) -> String {
    match url.find("token=") {
        Some(start) => {
            let value_start = start + "token=".len();
            let value_end = url[value_start..]
                .find('&')
                .map(|i| value_start + i)
                .unwrap_or(url.len());
            format!("{}token=***{}", &url[..start], &url[value_end..])
        }
        None => url.to_string(),
    }
}

/// Map an HTTP method string to a `reqwest::Method`, returning `None` for anything
/// unrecognized (so the proxy can fail with 405 instead of silently downgrading to GET).
fn parse_http_method(method: &str) -> Option<reqwest::Method> {
    Some(match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => return None,
    })
}

/// Proxy an HTTP request to the local server and return the response as a ClientMessage.
async fn proxy_http(
    client: &reqwest::Client,
    local_port: u16,
    request_id: String,
    method: String,
    uri: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> ClientMessage {
    // SECURITY: reject targets that could rewrite the authority of the localhost base.
    if !is_safe_forward_target(&uri) {
        log::warn!(
            "[wms-tunnel] Rejected proxy request with unsafe uri (request_id={}): {}",
            request_id,
            uri
        );
        return ClientMessage::HttpResponse {
            request_id,
            status: 400,
            headers: vec![("content-type".to_string(), "text/plain".to_string())],
            body: Some(BASE64.encode(b"Invalid request target")),
        };
    }

    let url = format!("http://localhost:{}{}", local_port, uri);
    log::debug!(
        "[wms-tunnel] Proxying HTTP request: {} {} (request_id={})",
        method,
        uri,
        request_id
    );

    let Some(req_method) = parse_http_method(&method) else {
        log::warn!(
            "[wms-tunnel] Rejected proxy request with unsupported method '{}' (request_id={})",
            method,
            request_id
        );
        return ClientMessage::HttpResponse {
            request_id,
            status: 405,
            headers: vec![("content-type".to_string(), "text/plain".to_string())],
            body: Some(BASE64.encode(format!("Method not allowed: {}", method).as_bytes())),
        };
    };

    let mut builder = client.request(req_method, &url);

    // SECURITY: mark this request as tunnel-originated so the local server's
    // localhost_only_middleware blocks host-only operations even though the request
    // arrives from a loopback address. Client-supplied copies of this header are
    // dropped and replaced below.
    for (name, value) in &headers {
        if is_hop_by_hop(name) || name.eq_ignore_ascii_case(TUNNEL_MARKER_HEADER) {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_str());
    }
    builder = builder.header(TUNNEL_MARKER_HEADER, "1");

    if let Some(b) = body {
        match BASE64.decode(&b) {
            Ok(decoded) => builder = builder.body(decoded),
            Err(_) => builder = builder.body(b.into_bytes()),
        }
    }

    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            log::debug!(
                "[wms-tunnel] Proxy response: status={} (request_id={})",
                status,
                request_id
            );
            let resp_headers: Vec<(String, String)> = resp
                .headers()
                .iter()
                .filter(|(name, _)| !is_hop_by_hop(name.as_str()))
                .map(|(name, value)| (name.to_string(), value.to_str().unwrap_or("").to_string()))
                .collect();

            match resp.bytes().await {
                Ok(bytes) => {
                    let body = if bytes.is_empty() {
                        None
                    } else {
                        Some(BASE64.encode(&bytes))
                    };
                    ClientMessage::HttpResponse {
                        request_id,
                        status,
                        headers: resp_headers,
                        body,
                    }
                }
                Err(e) => ClientMessage::HttpResponse {
                    request_id,
                    status: 502,
                    headers: vec![],
                    body: Some(
                        BASE64.encode(format!("Failed to read response body: {}", e).as_bytes()),
                    ),
                },
            }
        }
        Err(e) => {
            log::error!(
                "[wms-tunnel] Proxy error for request_id={}: {}",
                request_id,
                e
            );
            ClientMessage::HttpResponse {
                request_id,
                status: 502,
                headers: vec![("content-type".to_string(), "text/plain".to_string())],
                body: Some(BASE64.encode(format!("Proxy error: {}", e).as_bytes())),
            }
        }
    }
}

/// Handle a WebSocket open request: connect to local WS server and bridge frames.
///
/// `session_cancel_rx` is a per-session watch channel: when the owning tunnel session
/// ends (disconnect or shutdown) it flips to `true`, so both bridge tasks terminate
/// and release the local WebSocket connection instead of leaking across reconnects.
async fn handle_ws_open(
    local_port: u16,
    stream_id: String,
    path: String,
    _headers: Vec<(String, String)>,
    send_tx: mpsc::UnboundedSender<ClientMessage>,
    ws_streams: Arc<tokio::sync::Mutex<HashMap<String, mpsc::UnboundedSender<String>>>>,
    session_cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    // SECURITY: reject server-supplied paths that could rewrite the local authority.
    if !is_safe_forward_target(&path) {
        log::warn!(
            "[wms-tunnel] Rejected WS open with unsafe path: stream_id={}, path={}",
            stream_id,
            path
        );
        let _ = send_tx.send(ClientMessage::WsError {
            stream_id,
            error: "Invalid WS path".to_string(),
        });
        return;
    }

    let url = format!("ws://localhost:{}{}", local_port, path);
    log::info!(
        "[wms-tunnel] Opening WS bridge: stream_id={}, path={}",
        stream_id,
        path
    );

    match tokio_tungstenite::connect_async(&url).await {
        Ok((ws_stream, _)) => {
            log::info!("[wms-tunnel] WS bridge connected: stream_id={}", stream_id);
            let _ = send_tx.send(ClientMessage::WsOpened {
                stream_id: stream_id.clone(),
            });

            let (mut ws_sink, mut ws_source) = ws_stream.split();

            // Channel for frames from tunnel → local WS
            let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<String>();

            // Register this stream
            {
                let mut streams = ws_streams.lock().await;
                streams.insert(stream_id.clone(), frame_tx);
            }

            let sid_read = stream_id.clone();
            let send_tx_read = send_tx.clone();

            // Task: local WS → tunnel (read from local, send to tunnel)
            let ws_streams_clone = ws_streams.clone();
            let mut cancel_read = session_cancel_rx.clone();
            let read_task = tokio::spawn(async move {
                loop {
                    tokio::select! {
                        msg = ws_source.next() => {
                            match msg {
                                Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                                    let _ = send_tx_read.send(ClientMessage::WsFrame {
                                        stream_id: sid_read.clone(),
                                        data: BASE64.encode(text.as_bytes()),
                                    });
                                }
                                Some(Ok(tokio_tungstenite::tungstenite::Message::Binary(bin))) => {
                                    let _ = send_tx_read.send(ClientMessage::WsFrame {
                                        stream_id: sid_read.clone(),
                                        data: BASE64.encode(&bin),
                                    });
                                }
                                Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_)))
                                | Some(Err(_))
                                | None => break,
                                _ => {}
                            }
                        }
                        _ = cancel_read.changed() => break,
                    }
                }
                let _ = send_tx_read.send(ClientMessage::WsClose {
                    stream_id: sid_read.clone(),
                });
                let mut streams = ws_streams_clone.lock().await;
                streams.remove(&sid_read);
            });

            // Task: tunnel → local WS (receive from tunnel, write to local)
            let mut cancel_write = session_cancel_rx.clone();
            let write_task = tokio::spawn(async move {
                loop {
                    tokio::select! {
                        data_opt = frame_rx.recv() => {
                            let Some(data) = data_opt else { break };
                            let msg = match BASE64.decode(&data) {
                                // Prefer Text (local WS server only handles Text frames),
                                // fall back to Binary for non-UTF-8 data. from_utf8 consumes
                                // the buffer and hands it back on error, avoiding a copy.
                                Ok(decoded) => match String::from_utf8(decoded) {
                                    Ok(text) => {
                                        tokio_tungstenite::tungstenite::Message::Text(text.into())
                                    }
                                    Err(e) => tokio_tungstenite::tungstenite::Message::Binary(
                                        e.into_bytes().into(),
                                    ),
                                },
                                Err(_) => tokio_tungstenite::tungstenite::Message::Text(data.into()),
                            };
                            if ws_sink.send(msg).await.is_err() {
                                break;
                            }
                        }
                        _ = cancel_write.changed() => break,
                    }
                }
                let _ = ws_sink.close().await;
            });

            // Wait for either task to finish (or session cancel), then abort the other so
            // neither the local socket nor the task lingers past the bridge's lifetime.
            let mut read_task = read_task;
            let mut write_task = write_task;
            tokio::select! {
                _ = &mut read_task => { write_task.abort(); }
                _ = &mut write_task => { read_task.abort(); }
            }

            // Cleanup
            let mut streams = ws_streams.lock().await;
            streams.remove(&stream_id);
        }
        Err(e) => {
            log::error!(
                "[wms-tunnel] WS bridge connection failed: stream_id={}, error={}",
                stream_id,
                e
            );
            let _ = send_tx.send(ClientMessage::WsError {
                stream_id,
                error: format!("Failed to connect to local WS: {}", e),
            });
        }
    }
}

/// Type alias for the WebSocket stream used by tokio-tungstenite.
type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// Server sends Ping every 30s. If we receive nothing within this timeout,
/// consider the connection dead and trigger reconnection.
const RECV_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

/// Run a single tunnel session on an already-connected WebSocket stream.
///
/// Handles proxying HTTP/WS requests until the connection drops or shutdown is signaled.
/// Returns `true` if shutdown was requested (caller should not reconnect).
async fn run_tunnel_session(
    local_port: u16,
    ws_stream: WsStream,
    shutdown_rx: &tokio::sync::watch::Receiver<bool>,
) -> bool {
    log::info!(
        "[wms-tunnel] Session started, proxying to localhost:{}",
        local_port
    );
    let (mut ws_sink, mut ws_source) = ws_stream.split();

    let (send_tx, mut send_rx) = mpsc::unbounded_channel::<ClientMessage>();

    let ws_streams: Arc<tokio::sync::Mutex<HashMap<String, mpsc::UnboundedSender<String>>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    // Per-session cancellation: flipped once the session ends so all spawned WS bridges
    // tear down instead of lingering (and holding local sockets) across reconnects.
    let (session_cancel_tx, session_cancel_rx) = tokio::sync::watch::channel(false);
    // Handles of spawned WS bridge tasks, aborted when the session ends.
    let bridge_handles: Arc<std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>> =
        Arc::new(std::sync::Mutex::new(Vec::new()));

    // A finite request timeout keeps a slow/hung local endpoint from parking a proxy
    // task (and its buffered body) forever.
    let http_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .unwrap_or_default();

    let mut shutdown_rx_send = shutdown_rx.clone();
    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                msg_opt = send_rx.recv() => {
                    let Some(msg) = msg_opt else { break };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if ws_sink
                            .send(tokio_tungstenite::tungstenite::Message::Text(json.into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
                _ = shutdown_rx_send.changed() => {
                    log::info!("[wms-tunnel] Sending Close frame for graceful shutdown");
                    let _ = ws_sink.send(tokio_tungstenite::tungstenite::Message::Close(None)).await;
                    let _ = ws_sink.close().await;
                    break;
                }
            }
        }
    });

    let recv_task = {
        let send_tx = send_tx.clone();
        let ws_streams = ws_streams.clone();
        let mut shutdown_rx_recv = shutdown_rx.clone();
        let session_cancel_rx = session_cancel_rx.clone();
        let bridge_handles = bridge_handles.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    recv_result = tokio::time::timeout(RECV_TIMEOUT, ws_source.next()) => {
                        let msg_result_opt = match recv_result {
                            Ok(v) => v,
                            Err(_) => {
                                log::warn!("[wms-tunnel] No message received in {}s, assuming connection dead", RECV_TIMEOUT.as_secs());
                                break;
                            }
                        };
                        let Some(msg_result) = msg_result_opt else { break };
                        let msg = match msg_result {
                            Ok(m) => m,
                            Err(e) => {
                                log::error!("[wms-tunnel] WebSocket error: {}", e);
                                break;
                            }
                        };

                        let text = match msg {
                            tokio_tungstenite::tungstenite::Message::Text(t) => t,
                            tokio_tungstenite::tungstenite::Message::Ping(data) => {
                                let _ = data;
                                continue;
                            }
                            tokio_tungstenite::tungstenite::Message::Close(_) => break,
                            _ => continue,
                        };

                        let server_msg: ServerMessage = match serde_json::from_str(&text) {
                            Ok(m) => m,
                            Err(e) => {
                                log::warn!("[wms-tunnel] Failed to parse server message: {}", e);
                                continue;
                            }
                        };

                        match server_msg {
                            ServerMessage::HttpRequest {
                                request_id,
                                method,
                                uri,
                                headers,
                                body,
                            } => {
                                log::debug!("[wms-tunnel] Received HttpRequest: {} {} (id={})", method, uri, request_id);
                                let client = http_client.clone();
                                let tx = send_tx.clone();
                                tokio::spawn(async move {
                                    let resp =
                                        proxy_http(&client, local_port, request_id, method, uri, headers, body)
                                            .await;
                                    let _ = tx.send(resp);
                                });
                            }
                            ServerMessage::WsOpen {
                                stream_id,
                                path,
                                headers,
                            } => {
                                log::debug!("[wms-tunnel] Received WsOpen: stream_id={}, path={}", stream_id, path);
                                let tx = send_tx.clone();
                                let streams = ws_streams.clone();
                                let cancel = session_cancel_rx.clone();
                                let handle = tokio::spawn(handle_ws_open(
                                    local_port, stream_id, path, headers, tx, streams, cancel,
                                ));
                                if let Ok(mut handles) = bridge_handles.lock() {
                                    // Drop handles of bridges that already finished to bound growth.
                                    handles.retain(|h| !h.is_finished());
                                    handles.push(handle);
                                }
                            }
                            ServerMessage::WsFrame { stream_id, data } => {
                                let streams = ws_streams.lock().await;
                                if let Some(frame_tx) = streams.get(&stream_id) {
                                    let _ = frame_tx.send(data);
                                }
                            }
                            ServerMessage::WsClose { stream_id } => {
                                log::debug!("[wms-tunnel] Received WsClose: stream_id={}", stream_id);
                                let mut streams = ws_streams.lock().await;
                                streams.remove(&stream_id);
                            }
                            ServerMessage::Ping { timestamp } => {
                                log::trace!("[wms-tunnel] Received Ping, sending Pong (timestamp={})", timestamp);
                                let _ = send_tx.send(ClientMessage::Pong { timestamp });
                            }
                        }
                    }
                    _ = shutdown_rx_recv.changed() => {
                        log::info!("[wms-tunnel] Recv loop: shutdown signal received");
                        break;
                    }
                }
            }
        })
    };

    let mut send_task = send_task;
    let mut recv_task = recv_task;
    tokio::select! {
        _ = &mut send_task => { recv_task.abort(); }
        _ = &mut recv_task => { send_task.abort(); }
    }

    // Session over: cancel and abort every WS bridge so no local socket or task leaks.
    let _ = session_cancel_tx.send(true);
    if let Ok(mut handles) = bridge_handles.lock() {
        for handle in handles.drain(..) {
            handle.abort();
        }
    }

    *shutdown_rx.borrow()
}

async fn run_single_tunnel_session(
    local_port: u16,
    ws_url: String,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    connected_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
    log::info!(
        "[wms-tunnel] Connecting peer session to: {}",
        redact_ws_url(&ws_url)
    );

    let mut shutdown = shutdown_rx.clone();
    let ws_stream = tokio::select! {
        result = tokio::time::timeout(CONNECT_TIMEOUT, tokio_tungstenite::connect_async(&ws_url)) => {
            match result {
                Ok(Ok((stream, _))) => stream,
                Ok(Err(e)) => return Err(format!("WMS Peer 连接失败: {}", e)),
                Err(_) => return Err("WMS Peer 连接超时".to_string()),
            }
        }
        _ = shutdown.changed() => return Ok(()),
    };

    connected_flag.store(true, Ordering::Relaxed);
    let _shutdown_requested = run_tunnel_session(local_port, ws_stream, &shutdown_rx).await;
    connected_flag.store(false, Ordering::Relaxed);
    Ok(())
}

async fn run_tunnel_to_peer(
    local_port: u16,
    peer: TunnelPeerCandidate,
    token: Option<String>,
    subdomain: String,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    connected_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let ws_url = peer_tunnel_ws_url(&peer, token.as_deref(), &subdomain);
    log::info!(
        "[wms-tunnel] Starting peer tunnel: id={}, region={}, weight={}, public_base_url={}, public_ws_url={}",
        peer.id,
        peer.region,
        peer.weight,
        peer.public_base_url,
        peer.public_ws_url
    );
    run_single_tunnel_session(local_port, ws_url, shutdown_rx, connected_flag).await
}

/// Run the WMS tunnel client with automatic reconnection.
///
/// Connects to the WMS server via WebSocket and proxies HTTP/WS requests to `localhost:{local_port}`.
/// The `url_tx` channel is used to send back the public URL (or an error) once the first connection is established.
/// The `shutdown_rx` watch channel signals graceful shutdown.
/// The `connected_flag` reflects real-time connection status for the frontend to poll.
/// The `reconnect_state` is shared with the frontend for detailed reconnection status.
/// The `manual_reconnect_rx` allows the frontend to trigger an immediate reconnection attempt.
///
/// On disconnect, automatically reconnects with exponential backoff (1s -> 2s -> 4s -> ... -> 30s cap).
/// First connection failure returns an error via `url_tx` (no retry, likely config error).
/// User-initiated shutdown (via `shutdown_rx`) stops reconnection.
#[allow(clippy::too_many_arguments)]
pub async fn run_tunnel(
    local_port: u16,
    server_url: String,
    token: Option<String>,
    subdomain: String,
    url_tx: tokio::sync::oneshot::Sender<Result<String, String>>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    connected_flag: Arc<AtomicBool>,
    reconnect_state: Arc<std::sync::Mutex<WmsTunnelReconnectState>>,
    mut manual_reconnect_rx: tokio::sync::mpsc::UnboundedReceiver<()>,
) {
    /// Handshake timeout for a single connection attempt (first and reconnect).
    const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
    /// A session must stay up at least this long to count as "stable" and reset backoff;
    /// shorter sessions escalate backoff so an accept-then-drop server can't spin a tight loop.
    const STABLE_SESSION: std::time::Duration = std::time::Duration::from_secs(30);
    const MAX_BACKOFF_SECS: u64 = 30;
    // Fetch tunnel config from discovery endpoint (falls back to hardcoded defaults)
    let discovery = discover_tunnel_config(&server_url).await;
    let resolved = resolve_tunnel_config(
        &server_url,
        token.as_deref(),
        &subdomain,
        discovery.as_ref(),
    );
    let ws_url = resolved.ws_url;
    let public_url = resolved.public_url;

    // Redact the token query param so the long-lived credential never lands in the logs.
    log::info!("[wms-tunnel] Connecting to: {}", redact_ws_url(&ws_url));

    // Helper: one bounded connection attempt that also aborts if shutdown is signaled.
    // Returns Ok(Some(stream)) on success, Ok(None) on shutdown, Err(msg) on failure/timeout.
    async fn connect_once(
        ws_url: &str,
        shutdown_rx: &tokio::sync::watch::Receiver<bool>,
        connect_timeout: std::time::Duration,
    ) -> Result<Option<WsStream>, String> {
        let mut shutdown = shutdown_rx.clone();
        tokio::select! {
            result = tokio::time::timeout(connect_timeout, tokio_tungstenite::connect_async(ws_url)) => {
                match result {
                    Ok(Ok((stream, _))) => Ok(Some(stream)),
                    Ok(Err(e)) => Err(format!("WMS 连接失败: {}", e)),
                    Err(_) => Err("WMS 连接超时".to_string()),
                }
            }
            _ = shutdown.changed() => Ok(None),
        }
    }

    // First connection attempt — failure here means a likely config error; report it and
    // don't retry. Success reports the public URL back to the caller.
    log::info!("[wms-tunnel] First connection attempt...");
    let first_stream = match connect_once(&ws_url, &shutdown_rx, CONNECT_TIMEOUT).await {
        Ok(Some(stream)) => {
            log::info!("[wms-tunnel] First connection succeeded");
            stream
        }
        Ok(None) => {
            log::info!("[wms-tunnel] Shutdown before first connection completed");
            let _ = url_tx.send(Err("WMS 隧道已取消".to_string()));
            return;
        }
        Err(e) => {
            log::error!("[wms-tunnel] First connection failed (no retry): {}", e);
            let _ = url_tx.send(Err(e));
            return;
        }
    };

    let _ = url_tx.send(Ok(public_url));
    connected_flag.store(true, Ordering::Relaxed);
    log::info!("[wms-tunnel] Connected, public URL sent to caller");

    let mut backoff_secs: u64 = 1;
    let mut attempt: u32 = 0;
    let mut current_stream = first_stream;

    'outer: loop {
        // Run a session on the freshly connected stream.
        if let Ok(mut rs) = reconnect_state.lock() {
            rs.reconnecting = false;
            rs.attempt = 0;
            rs.next_retry_at = None;
        }
        let session_start = std::time::Instant::now();
        let shutdown_requested = run_tunnel_session(local_port, current_stream, &shutdown_rx).await;
        connected_flag.store(false, Ordering::Relaxed);

        if shutdown_requested {
            log::info!("[wms-tunnel] Disconnected (shutdown requested)");
            break;
        }

        // A session that dropped almost immediately must NOT reset backoff, otherwise a
        // server that accepts the handshake then instantly closes would spin us into a
        // ~1s reconnect loop. Only a stable session earns a backoff reset.
        if session_start.elapsed() >= STABLE_SESSION {
            backoff_secs = 1;
            attempt = 0;
        } else {
            backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
        }
        log::info!("[wms-tunnel] Disconnected, will attempt to reconnect...");

        // Reconnect with backoff until we obtain a fresh stream (or shutdown).
        current_stream = loop {
            if *shutdown_rx.borrow() {
                log::info!("[wms-tunnel] Shutdown requested, stopping reconnection");
                break 'outer;
            }

            attempt += 1;
            let sleep_until =
                std::time::Instant::now() + std::time::Duration::from_secs(backoff_secs);
            if let Ok(mut rs) = reconnect_state.lock() {
                rs.reconnecting = true;
                rs.attempt = attempt;
                rs.next_retry_at = Some(sleep_until);
            }
            log::info!(
                "[wms-tunnel] Reconnecting in {}s (attempt {})",
                backoff_secs,
                attempt
            );

            // Sleep with shutdown check and manual-reconnect interrupt.
            let mut shutdown_rx_sleep = shutdown_rx.clone();
            enum WakeReason {
                TimerExpired,
                Shutdown,
                ManualReconnect,
            }
            let wake_reason = tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => WakeReason::TimerExpired,
                _ = shutdown_rx_sleep.changed() => WakeReason::Shutdown,
                _ = manual_reconnect_rx.recv() => WakeReason::ManualReconnect,
            };
            match wake_reason {
                WakeReason::Shutdown => {
                    log::info!("[wms-tunnel] Shutdown requested during backoff, stopping");
                    break 'outer;
                }
                WakeReason::ManualReconnect => {
                    log::info!("[wms-tunnel] Manual reconnect triggered, skipping backoff");
                    backoff_secs = 1;
                    attempt = 0;
                }
                WakeReason::TimerExpired => {}
            }

            if let Ok(mut rs) = reconnect_state.lock() {
                rs.next_retry_at = None;
            }
            log::info!("[wms-tunnel] Attempting reconnection...");

            match connect_once(&ws_url, &shutdown_rx, CONNECT_TIMEOUT).await {
                Ok(Some(stream)) => {
                    connected_flag.store(true, Ordering::Relaxed);
                    log::info!("[wms-tunnel] Reconnected successfully");
                    break stream;
                }
                Ok(None) => {
                    log::info!("[wms-tunnel] Shutdown requested during reconnect, stopping");
                    break 'outer;
                }
                Err(e) => {
                    log::warn!("[wms-tunnel] Reconnection failed: {}", e);
                    backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                }
            }
        };
    }

    // Clear reconnecting state on exit
    if let Ok(mut rs) = reconnect_state.lock() {
        rs.reconnecting = false;
        rs.attempt = 0;
        rs.next_retry_at = None;
    }

    connected_flag.store(false, Ordering::Relaxed);
    log::info!("[wms-tunnel] Tunnel stopped");
}

#[allow(clippy::too_many_arguments)]
pub async fn run_tunnel_pool(
    local_port: u16,
    server_url: String,
    access_token: Option<String>,
    tunnel_token: Option<String>,
    subdomain: String,
    url_tx: tokio::sync::oneshot::Sender<Result<String, String>>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    connected_flag: Arc<AtomicBool>,
    reconnect_state: Arc<std::sync::Mutex<WmsTunnelReconnectState>>,
    manual_reconnect_rx: mpsc::UnboundedReceiver<()>,
) {
    let discovery = discover_tunnel_config(&server_url).await;
    let max_peer_connections = discovery
        .as_ref()
        .and_then(|d| d.desktop_max_peer_connections)
        .unwrap_or(1)
        .max(1);
    let center_peer_id = discovery
        .as_ref()
        .and_then(|d| d.center_peer_id.as_deref())
        .unwrap_or("center")
        .to_string();

    let center_handle = tokio::spawn(run_tunnel(
        local_port,
        server_url.clone(),
        tunnel_token.clone(),
        subdomain.clone(),
        url_tx,
        shutdown_rx.clone(),
        connected_flag,
        reconnect_state,
        manual_reconnect_rx,
    ));

    let mut peer_handles = Vec::new();
    if max_peer_connections > 1 {
        let mut peers = fetch_tunnel_peers(&server_url, access_token.as_deref(), &subdomain).await;
        peers.retain(|peer| peer.id != center_peer_id);
        peers.sort_by(|a, b| a.weight.cmp(&b.weight).then_with(|| a.id.cmp(&b.id)));

        for peer in peers.into_iter().take(max_peer_connections - 1) {
            let peer_flag = Arc::new(AtomicBool::new(false));
            let peer_shutdown = shutdown_rx.clone();
            let peer_token = tunnel_token.clone();
            let peer_subdomain = subdomain.clone();
            peer_handles.push(tokio::spawn(async move {
                if let Err(e) = run_tunnel_to_peer(
                    local_port,
                    peer,
                    peer_token,
                    peer_subdomain,
                    peer_shutdown,
                    peer_flag,
                )
                .await
                {
                    log::warn!("[wms-tunnel] Peer tunnel ended: {}", e);
                }
            }));
        }
    }

    let _ = center_handle.await;
    for handle in peer_handles {
        handle.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_forward_target_accepts_origin_form_paths() {
        assert!(is_safe_forward_target("/"));
        assert!(is_safe_forward_target("/api/list_worktrees"));
        assert!(is_safe_forward_target("/search?q=a@b&x=1"));
        // '@' inside the path/query is harmless once the authority is fixed by a leading '/'.
        assert!(is_safe_forward_target("/path/@handle"));
    }

    #[test]
    fn is_safe_forward_target_rejects_authority_rewrites() {
        assert!(!is_safe_forward_target("@evil.com/steal"));
        assert!(!is_safe_forward_target("//evil.com/steal"));
        assert!(!is_safe_forward_target("http://evil.com"));
        assert!(!is_safe_forward_target("api/relative"));
        assert!(!is_safe_forward_target(""));
    }

    #[test]
    fn redact_ws_url_masks_token_and_preserves_other_params() {
        assert_eq!(
            redact_ws_url("wss://h.example/tunnel/connect?token=SECRET123&subdomain=abc"),
            "wss://h.example/tunnel/connect?token=***&subdomain=abc"
        );
        // token as the last param
        assert_eq!(
            redact_ws_url("wss://h.example/c?subdomain=abc&token=SECRET"),
            "wss://h.example/c?subdomain=abc&token=***"
        );
        // no token → unchanged
        assert_eq!(
            redact_ws_url("wss://h.example/c?subdomain=abc"),
            "wss://h.example/c?subdomain=abc"
        );
    }

    #[test]
    fn parse_http_method_maps_known_and_rejects_unknown() {
        assert_eq!(parse_http_method("get"), Some(reqwest::Method::GET));
        assert_eq!(parse_http_method("POST"), Some(reqwest::Method::POST));
        assert_eq!(parse_http_method("Patch"), Some(reqwest::Method::PATCH));
        assert_eq!(parse_http_method("TRACE"), None);
        assert_eq!(parse_http_method("CONNECT"), None);
        assert_eq!(parse_http_method(""), None);
    }

    #[test]
    fn is_hop_by_hop_is_case_insensitive() {
        assert!(is_hop_by_hop("Connection"));
        assert!(is_hop_by_hop("TRANSFER-ENCODING"));
        assert!(!is_hop_by_hop("content-type"));
        assert!(!is_hop_by_hop("x-wms-tunnel"));
    }

    #[test]
    fn resolve_tunnel_config_uses_hardcoded_fallback_without_discovery() {
        let resolved =
            resolve_tunnel_config("https://wms.example.com", Some("tok en"), "sub", None);
        assert_eq!(
            resolved.ws_url,
            "wss://wms.example.com/tunnel/connect?token=tok%20en&subdomain=sub"
        );
        assert_eq!(resolved.public_url, "https://wms.example.com/t/sub/");
    }

    #[test]
    fn resolve_tunnel_config_without_token_omits_token_param() {
        let resolved = resolve_tunnel_config("http://localhost:9000", None, "s", None);
        assert_eq!(
            resolved.ws_url,
            "ws://localhost:9000/tunnel/connect?subdomain=s"
        );
        assert_eq!(resolved.public_url, "http://localhost:9000/t/s/");
    }

    #[test]
    fn resolve_tunnel_config_honors_discovery_template_and_ws_path() {
        let discovery = TunnelDiscoveryResponse {
            tunnel_ws_path: Some("/custom/ws".to_string()),
            tunnel_domain_template: Some("{subdomain}.tunnel.example.com".to_string()),
            heartbeat_interval_secs: None,
            routing_mode: None,
            desktop_max_peer_connections: None,
            center_peer_id: None,
        };
        let resolved = resolve_tunnel_config(
            "https://wms.example.com",
            Some("t"),
            "abc",
            Some(&discovery),
        );
        assert_eq!(
            resolved.ws_url,
            "wss://wms.example.com/custom/ws?token=t&subdomain=abc"
        );
        // template lacks protocol + trailing slash → both are added
        assert_eq!(resolved.public_url, "https://abc.tunnel.example.com/");
    }

    #[test]
    fn discovery_deserializes_multi_peer_fields() {
        let json = r#"{
            "tunnel_ws_path": "/tunnel/connect",
            "tunnel_domain_template": "https://tunnel.example/t/{subdomain}/",
            "heartbeat_interval_secs": 30,
            "routing_mode": "multi_peer",
            "desktop_max_peer_connections": 4,
            "center_peer_id": "center"
        }"#;
        let config: TunnelDiscoveryResponse = serde_json::from_str(json).expect("parse");
        assert_eq!(config.routing_mode.as_deref(), Some("multi_peer"));
        assert_eq!(config.desktop_max_peer_connections, Some(4));
        assert_eq!(config.center_peer_id.as_deref(), Some("center"));
    }

    #[test]
    fn peer_candidate_builds_ws_url_with_peer_id() {
        let peer = TunnelPeerCandidate {
            id: "eu-1".to_string(),
            tunnel_ws_url: "wss://167.235.103.66:8443/tunnel/connect".to_string(),
            public_base_url: "https://167.235.103.66:8443".to_string(),
            public_ws_url: "wss://167.235.103.66:8443".to_string(),
            region: "eu".to_string(),
            weight: 10,
        };
        let url = peer_tunnel_ws_url(&peer, Some("tok en"), "bliss-kind-drift");
        assert_eq!(
            url,
            "wss://167.235.103.66:8443/tunnel/connect?token=tok%20en&subdomain=bliss-kind-drift&peer_id=eu-1"
        );
    }

    #[test]
    fn next_retry_secs_is_zero_when_no_retry_scheduled() {
        let state = WmsTunnelReconnectState::default();
        assert_eq!(state.next_retry_secs(), 0);
    }

    #[test]
    fn next_retry_secs_rounds_up_future_instant() {
        let state = WmsTunnelReconnectState {
            reconnecting: true,
            attempt: 2,
            next_retry_at: Some(std::time::Instant::now() + std::time::Duration::from_millis(2500)),
        };
        let secs = state.next_retry_secs();
        assert!((3..=4).contains(&secs), "unexpected countdown: {}", secs);
    }
}
