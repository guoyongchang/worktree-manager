use ngrok::config::ForwarderBuilder;  // trait import: provides listen_and_forward()
use ngrok::forwarder::Forwarder;
use ngrok::tunnel::{EndpointInfo, HttpTunnel};  // EndpointInfo trait import: provides url()

use crate::types::{ShareStateInfo, ConnectedClient};
use crate::config::{
    load_global_config, save_global_config_internal,
    get_window_workspace_path,
};
use crate::state::{
    SHARE_STATE, AUTHENTICATED_SESSIONS, CONNECTED_CLIENTS,
    TOKIO_RT,
};
use crate::http_server;
use crate::tls;

// ==================== 分享功能命令 ====================

#[tauri::command]
pub(crate) async fn get_ngrok_token() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.ngrok_token)
}

#[tauri::command]
pub(crate) async fn set_ngrok_token(token: String) -> Result<(), String> {
    let mut config = load_global_config();
    config.ngrok_token = if token.is_empty() { None } else { Some(token) };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_last_share_port() -> Result<Option<u16>, String> {
    let config = load_global_config();
    Ok(config.last_share_port)
}

#[tauri::command]
pub(crate) async fn get_last_share_password() -> Result<Option<String>, String> {
    let config = load_global_config();
    Ok(config.last_share_password)
}

#[tauri::command]
pub(crate) async fn start_sharing(window: tauri::Window, port: u16, password: String) -> Result<String, String> {
    let workspace_path = get_window_workspace_path(window.label())
        .ok_or("No workspace selected")?;

    // SECURITY: Validate password is not empty (required for remote access security)
    if password.trim().is_empty() {
        return Err("分享密码不能为空".to_string());
    }

    // Validate port range (recommended dynamic/private ports: 49152-65535)
    // Allow common development ports (3000-9999) for convenience
    if port < 3000 {
        return Err(format!("端口 {} 过小。推荐使用 49152-65535 范围内的端口，或 3000-9999 开发端口", port));
    }

    // Check if already sharing
    {
        let state = SHARE_STATE.lock()
            .map_err(|_| "Internal state error".to_string())?;
        if state.active {
            return Err("Already sharing. Stop current sharing first.".to_string());
        }
    }

    // Check if port is available
    // Bind to 0.0.0.0 to allow LAN access (security handled by password auth)
    let bind_addr = format!("0.0.0.0:{}", port);
    if let Err(e) = tokio::net::TcpListener::bind(&bind_addr).await {
        return Err(format!("端口 {} 已被占用: {}", port, e));
    }

    // Collect all LAN IPs for multi-address display
    // Include all non-loopback IPv4: private, link-local, CGNAT (Tailscale 100.x), etc.
    let mut lan_ips: Vec<std::net::IpAddr> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(_name, ip)| {
            match ip {
                std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() && !v4.is_multicast() => Some(ip),
                _ => None,
            }
        })
        .collect();
    lan_ips.sort();
    lan_ips.dedup();

    // Generate self-signed TLS certificate for HTTPS (includes all LAN IPs in SAN)
    let tls_certs = tls::generate_self_signed(&lan_ips)?;

    let share_urls: Vec<String> = lan_ips.iter()
        .map(|ip| format!("https://{}:{}", ip, port))
        .collect();

    let share_url = share_urls.first().cloned().unwrap_or_else(|| format!("https://0.0.0.0:{}", port));

    // Create shutdown channel
    let (tx, rx) = tokio::sync::watch::channel(false);

    // Update share state
    {
        let mut state = SHARE_STATE.lock()
            .map_err(|_| "Internal state error".to_string())?;
        state.active = true;
        state.workspace_path = Some(workspace_path.clone());
        state.port = port;
        state.password = Some(password.clone());
        state.shutdown_tx = Some(tx);
    }

    // 保存端口和密码到全局配置
    {
        let mut config = load_global_config();
        config.last_share_port = Some(port);
        config.last_share_password = Some(password.clone());
        let _ = save_global_config_internal(&config);
    }

    // Clear any previous authenticated sessions
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        sessions.clear();
    }

    // Spawn HTTP (port) + HTTPS (port+1) servers on the shared tokio runtime
    TOKIO_RT.spawn(http_server::start_server(port, rx, Some(tls_certs)));

    log::info!("Sharing started on {} for workspace {}", share_url, workspace_path);

    Ok(share_url)
}

pub async fn start_ngrok_tunnel_internal() -> Result<String, String> {
    let port = {
        let state = SHARE_STATE.lock()
            .map_err(|_| "Internal state error".to_string())?;
        if !state.active {
            return Err("请先开启分享".to_string());
        }
        if state.ngrok_url.is_some() {
            return Err("ngrok 隧道已在运行".to_string());
        }
        state.port
    };

    let ngrok_token = load_global_config().ngrok_token
        .ok_or("未配置 ngrok token，请先在设置中配置".to_string())?;

    let (url_tx, url_rx) = std::sync::mpsc::channel::<Result<String, String>>();

    let ngrok_handle = TOKIO_RT.spawn(async move {
        let result = async {
            let session = ngrok::Session::builder()
                .authtoken(ngrok_token)
                .connect()
                .await
                .map_err(|e| format!("ngrok 连接失败: {}", e))?;

            let forwarder = session
                .http_endpoint()
                .listen_and_forward(
                    url::Url::parse(&format!("http://localhost:{}", port))
                        .map_err(|e| format!("URL 解析失败: {}", e))?
                )
                .await
                .map_err(|e| format!("ngrok 隧道创建失败: {}", e))?;

            let ngrok_url = forwarder.url().to_string();
            Ok::<(String, Forwarder<HttpTunnel>), String>((ngrok_url, forwarder))
        }.await;

        match result {
            Ok((url, mut forwarder)) => {
                let _ = url_tx.send(Ok(url));
                // join() keeps the forwarder actively forwarding traffic
                let _ = forwarder.join().await;
            }
            Err(e) => {
                let _ = url_tx.send(Err(e));
            }
        }
    });

    // Wait for the ngrok URL (with timeout)
    match url_rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(ngrok_url)) => {
            let mut state = SHARE_STATE.lock()
                .map_err(|_| "Internal state error".to_string())?;
            state.ngrok_url = Some(ngrok_url.clone());
            state.ngrok_task = Some(ngrok_handle);
            log::info!("ngrok tunnel started: {}", ngrok_url);
            Ok(ngrok_url)
        }
        Ok(Err(e)) => {
            ngrok_handle.abort();
            Err(e)
        }
        Err(_) => {
            ngrok_handle.abort();
            Err("ngrok 隧道启动超时".to_string())
        }
    }
}

#[tauri::command]
pub(crate) async fn start_ngrok_tunnel() -> Result<String, String> {
    start_ngrok_tunnel_internal().await
}

#[tauri::command]
pub(crate) async fn stop_ngrok_tunnel() -> Result<(), String> {
    let mut state = SHARE_STATE.lock()
        .map_err(|_| "Internal state error".to_string())?;
    if let Some(handle) = state.ngrok_task.take() {
        // abort() is intentional: the ngrok crate's Forwarder does not expose a graceful
        // shutdown API. Aborting the task triggers its Drop impl, which handles cleanup.
        handle.abort();
    }
    state.ngrok_url = None;
    log::info!("ngrok tunnel stopped");
    Ok(())
}

#[tauri::command]
pub(crate) async fn stop_sharing() -> Result<(), String> {
    // Single lock scope: check active, stop ngrok, extract shutdown_tx, and reset state
    let shutdown_tx = {
        let mut state = SHARE_STATE.lock()
            .map_err(|_| "Internal state error".to_string())?;
        if !state.active {
            return Err("Not currently sharing".to_string());
        }

        // Stop ngrok tunnel if active
        // NOTE: abort() is intentional here -- the ngrok crate's Forwarder does not expose
        // a graceful shutdown API; aborting the task triggers its Drop impl for cleanup.
        if let Some(handle) = state.ngrok_task.take() {
            handle.abort();
        }
        state.ngrok_url = None;

        // Extract shutdown_tx and reset all state atomically
        let tx = state.shutdown_tx.take();
        state.active = false;
        state.workspace_path = None;
        state.port = 0;
        state.password = None;
        tx
    };

    // Stop HTTP server (outside SHARE_STATE lock to avoid holding it during send)
    if let Some(tx) = shutdown_tx {
        let _ = tx.send(true);
    }

    // Clear authenticated sessions and connected clients
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        sessions.clear();
    }
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        clients.clear();
    }

    log::info!("Sharing stopped");
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_share_state() -> Result<ShareStateInfo, String> {
    let state = SHARE_STATE.lock()
        .map_err(|_| "Internal state error".to_string())?;
    let urls = if state.active {
        let mut ips: Vec<std::net::IpAddr> = local_ip_address::list_afinet_netifas()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(_name, ip)| match ip {
                std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() && !v4.is_multicast() => Some(ip),
                _ => None,
            })
            .collect();
        ips.sort();
        ips.dedup();
        ips.iter().map(|ip| format!("https://{}:{}", ip, state.port)).collect()
    } else {
        vec![]
    };

    Ok(ShareStateInfo {
        active: state.active,
        urls,
        ngrok_url: state.ngrok_url.clone(),
        workspace_path: state.workspace_path.clone(),
    })
}

#[tauri::command]
pub(crate) async fn update_share_password(password: String) -> Result<(), String> {
    // SECURITY: Validate password is not empty
    if password.trim().is_empty() {
        return Err("分享密码不能为空".to_string());
    }
    let mut state = SHARE_STATE.lock()
        .map_err(|_| "Internal state error".to_string())?;
    if !state.active {
        return Err("Not currently sharing".to_string());
    }
    state.password = Some(password);
    drop(state);

    // Clear authenticated sessions and connected clients so everyone must re-auth with the new password
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() { sessions.clear(); }
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() { clients.clear(); }

    log::info!("Share password updated");
    Ok(())
}

// ==================== Connected Clients ====================

#[tauri::command]
pub(crate) fn get_connected_clients() -> Vec<ConnectedClient> {
    let Ok(clients) = CONNECTED_CLIENTS.lock() else {
        return vec![];
    };
    clients.values().cloned().collect()
}

/// Kick a client by session ID (disconnect and remove from authenticated sessions)
pub fn kick_client_internal(session_id: &str) -> Result<(), String> {
    log::info!("Kicking client with session ID: {}", session_id);

    // Remove from authenticated sessions
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        sessions.remove(session_id);
    }

    // Remove from connected clients
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        clients.remove(session_id);
    }

    // Note: WebSocket connections will be automatically closed when the client
    // tries to make the next request and fails authentication

    Ok(())
}

#[tauri::command]
pub(crate) fn kick_client(session_id: String) -> Result<(), String> {
    kick_client_internal(&session_id)
}
