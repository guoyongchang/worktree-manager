use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

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
    HOP_BY_HOP_HEADERS.contains(&name.to_lowercase().as_str())
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
    let url = format!("http://localhost:{}{}", local_port, uri);

    let req_method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut builder = client.request(req_method, &url);

    for (name, value) in &headers {
        if !is_hop_by_hop(name) {
            builder = builder.header(name.as_str(), value.as_str());
        }
    }

    if let Some(b) = body {
        match BASE64.decode(&b) {
            Ok(decoded) => builder = builder.body(decoded),
            Err(_) => builder = builder.body(b.into_bytes()),
        }
    }

    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
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
        Err(e) => ClientMessage::HttpResponse {
            request_id,
            status: 502,
            headers: vec![("content-type".to_string(), "text/plain".to_string())],
            body: Some(BASE64.encode(format!("Proxy error: {}", e).as_bytes())),
        },
    }
}

/// Handle a WebSocket open request: connect to local WS server and bridge frames.
async fn handle_ws_open(
    local_port: u16,
    stream_id: String,
    path: String,
    _headers: Vec<(String, String)>,
    send_tx: mpsc::UnboundedSender<ClientMessage>,
    ws_streams: Arc<tokio::sync::Mutex<HashMap<String, mpsc::UnboundedSender<String>>>>,
) {
    let url = format!("ws://localhost:{}{}", local_port, path);

    match tokio_tungstenite::connect_async(&url).await {
        Ok((ws_stream, _)) => {
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
            let read_task = tokio::spawn(async move {
                while let Some(msg) = ws_source.next().await {
                    match msg {
                        Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                            let _ = send_tx_read.send(ClientMessage::WsFrame {
                                stream_id: sid_read.clone(),
                                data: BASE64.encode(text.as_bytes()),
                            });
                        }
                        Ok(tokio_tungstenite::tungstenite::Message::Binary(bin)) => {
                            let _ = send_tx_read.send(ClientMessage::WsFrame {
                                stream_id: sid_read.clone(),
                                data: BASE64.encode(&bin),
                            });
                        }
                        Ok(tokio_tungstenite::tungstenite::Message::Close(_)) | Err(_) => {
                            break;
                        }
                        _ => {}
                    }
                }
                let _ = send_tx_read.send(ClientMessage::WsClose {
                    stream_id: sid_read.clone(),
                });
                let mut streams = ws_streams_clone.lock().await;
                streams.remove(&sid_read);
            });

            // Task: tunnel → local WS (receive from tunnel, write to local)
            let write_task = tokio::spawn(async move {
                while let Some(data) = frame_rx.recv().await {
                    match BASE64.decode(&data) {
                        Ok(decoded) => {
                            // Try as Text first (local WS server only handles Text frames),
                            // fall back to Binary for non-UTF-8 data
                            let msg = match String::from_utf8(decoded.clone()) {
                                Ok(text) => {
                                    tokio_tungstenite::tungstenite::Message::Text(text.into())
                                }
                                Err(_) => {
                                    tokio_tungstenite::tungstenite::Message::Binary(decoded.into())
                                }
                            };
                            if ws_sink.send(msg).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => {
                            let msg = tokio_tungstenite::tungstenite::Message::Text(data.into());
                            if ws_sink.send(msg).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                let _ = ws_sink.close().await;
            });

            // Wait for either task to finish, then abort the other
            tokio::select! {
                _ = read_task => {}
                _ = write_task => {}
            }

            // Cleanup
            let mut streams = ws_streams.lock().await;
            streams.remove(&stream_id);
        }
        Err(e) => {
            let _ = send_tx.send(ClientMessage::WsError {
                stream_id,
                error: format!("Failed to connect to local WS: {}", e),
            });
        }
    }
}

/// Type alias for the WebSocket stream used by tokio-tungstenite.
type WsStream = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Run a single tunnel session on an already-connected WebSocket stream.
///
/// Handles proxying HTTP/WS requests until the connection drops or shutdown is signaled.
/// Returns `true` if shutdown was requested (caller should not reconnect).
async fn run_tunnel_session(
    local_port: u16,
    ws_stream: WsStream,
    shutdown_rx: &tokio::sync::watch::Receiver<bool>,
) -> bool {
    let (mut ws_sink, mut ws_source) = ws_stream.split();

    let (send_tx, mut send_rx) = mpsc::unbounded_channel::<ClientMessage>();

    let ws_streams: Arc<tokio::sync::Mutex<HashMap<String, mpsc::UnboundedSender<String>>>> =
        Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    let http_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
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
                    log::info!("WMS tunnel: sending Close frame for graceful shutdown");
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
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg_result_opt = ws_source.next() => {
                        let Some(msg_result) = msg_result_opt else { break };
                        let msg = match msg_result {
                            Ok(m) => m,
                            Err(e) => {
                                log::error!("WMS tunnel WS error: {}", e);
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
                                log::warn!("WMS tunnel: failed to parse server message: {}", e);
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
                                let tx = send_tx.clone();
                                let streams = ws_streams.clone();
                                tokio::spawn(handle_ws_open(
                                    local_port, stream_id, path, headers, tx, streams,
                                ));
                            }
                            ServerMessage::WsFrame { stream_id, data } => {
                                let streams = ws_streams.lock().await;
                                if let Some(frame_tx) = streams.get(&stream_id) {
                                    let _ = frame_tx.send(data);
                                }
                            }
                            ServerMessage::WsClose { stream_id } => {
                                let mut streams = ws_streams.lock().await;
                                streams.remove(&stream_id);
                            }
                            ServerMessage::Ping { timestamp } => {
                                let _ = send_tx.send(ClientMessage::Pong { timestamp });
                            }
                        }
                    }
                    _ = shutdown_rx_recv.changed() => {
                        log::info!("WMS tunnel recv loop: shutdown signal received");
                        break;
                    }
                }
            }
        })
    };

    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }

    *shutdown_rx.borrow()
}

/// Run the WMS tunnel client with automatic reconnection.
///
/// Connects to the WMS server via WebSocket and proxies HTTP/WS requests to `localhost:{local_port}`.
/// The `url_tx` channel is used to send back the public URL (or an error) once the first connection is established.
/// The `shutdown_rx` watch channel signals graceful shutdown.
/// The `connected_flag` reflects real-time connection status for the frontend to poll.
///
/// On disconnect, automatically reconnects with exponential backoff (1s -> 2s -> 4s -> ... -> 30s cap).
/// First connection failure returns an error via `url_tx` (no retry, likely config error).
/// User-initiated shutdown (via `shutdown_rx`) stops reconnection.
pub async fn run_tunnel(
    local_port: u16,
    server_url: String,
    token: Option<String>,
    subdomain: String,
    url_tx: std::sync::mpsc::Sender<Result<String, String>>,
    shutdown_rx: tokio::sync::watch::Receiver<bool>,
    connected_flag: Arc<AtomicBool>,
) {
    // Build the WebSocket URL
    let ws_base = if server_url.starts_with("https://") {
        server_url.replacen("https://", "wss://", 1)
    } else if server_url.starts_with("http://") {
        server_url.replacen("http://", "ws://", 1)
    } else {
        format!("wss://{}", server_url)
    };

    let ws_url = if let Some(ref t) = token {
        format!(
            "{}/tunnel/connect?token={}&subdomain={}",
            ws_base.trim_end_matches('/'),
            urlencoding::encode(t),
            urlencoding::encode(&subdomain)
        )
    } else {
        format!(
            "{}/tunnel/connect?subdomain={}",
            ws_base.trim_end_matches('/'),
            urlencoding::encode(&subdomain)
        )
    };

    // Compute public URL
    let host = server_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    let protocol = if server_url.starts_with("http://") {
        "http"
    } else {
        "https"
    };
    let public_url = format!("{}://{}/t/{}/", protocol, host, subdomain);

    log::info!("WMS tunnel connecting to: {}", ws_url);

    // First connection attempt — failure here means config error, don't retry
    let first_stream = match tokio_tungstenite::connect_async(&ws_url).await {
        Ok((stream, _)) => stream,
        Err(e) => {
            let _ = url_tx.send(Err(format!("WMS 连接失败: {}", e)));
            return;
        }
    };

    // First connection succeeded — send URL back
    let _ = url_tx.send(Ok(public_url));
    connected_flag.store(true, Ordering::Relaxed);
    log::info!("WMS tunnel connected");

    // Run the first session
    let shutdown_requested = run_tunnel_session(local_port, first_stream, &shutdown_rx).await;
    connected_flag.store(false, Ordering::Relaxed);

    if shutdown_requested {
        log::info!("WMS tunnel disconnected (shutdown requested)");
        return;
    }

    log::info!("WMS tunnel disconnected, will attempt to reconnect...");

    // Reconnection loop with exponential backoff
    let mut backoff_secs: u64 = 1;
    const MAX_BACKOFF_SECS: u64 = 30;

    loop {
        if *shutdown_rx.borrow() {
            log::info!("WMS tunnel: shutdown requested, stopping reconnection");
            break;
        }

        log::info!("WMS tunnel: reconnecting in {}s...", backoff_secs);

        // Sleep with shutdown check
        let mut shutdown_rx_sleep = shutdown_rx.clone();
        let should_stop = tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(backoff_secs)) => false,
            _ = shutdown_rx_sleep.changed() => true,
        };
        if should_stop {
            log::info!("WMS tunnel: shutdown requested during backoff, stopping");
            break;
        }

        log::info!("WMS tunnel: attempting reconnection...");

        match tokio_tungstenite::connect_async(&ws_url).await {
            Ok((stream, _)) => {
                connected_flag.store(true, Ordering::Relaxed);
                backoff_secs = 1;
                log::info!("WMS tunnel: reconnected successfully");

                let shutdown_requested =
                    run_tunnel_session(local_port, stream, &shutdown_rx).await;
                connected_flag.store(false, Ordering::Relaxed);

                if shutdown_requested {
                    log::info!("WMS tunnel disconnected (shutdown requested)");
                    break;
                }

                log::info!("WMS tunnel disconnected, will attempt to reconnect...");
            }
            Err(e) => {
                log::warn!("WMS tunnel: reconnection failed: {}", e);
                backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
            }
        }
    }

    connected_flag.store(false, Ordering::Relaxed);
    log::info!("WMS tunnel stopped");
}
