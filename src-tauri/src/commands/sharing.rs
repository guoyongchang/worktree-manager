use ngrok::config::ForwarderBuilder; // trait import: provides listen_and_forward()
use ngrok::forwarder::Forwarder;
use ngrok::tunnel::{EndpointInfo, HttpTunnel}; // EndpointInfo trait import: provides url()

use crate::config::{get_window_workspace_path, load_global_config, save_global_config_internal};
use crate::http_server;

use crate::state::{
    AUTHENTICATED_SESSIONS, CLIENT_NOTIFICATION_BROADCAST, CONNECTED_CLIENTS, SHARE_STATE, TOKIO_RT,
};
use crate::tls;
use crate::types::{ConnectedClient, ShareStateInfo};

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
    // No longer persist passwords for security
    Ok(None)
}

/// Internal function to start LAN sharing.
pub async fn start_sharing_internal(
    workspace_path: String,
    port: u16,
    password: String,
) -> Result<String, String> {
    log::info!(
        "[sharing] Starting LAN sharing: workspace={}, port={}, password_len={}",
        workspace_path,
        port,
        password.len()
    );

    // SECURITY: Validate password is not empty (required for remote access security)
    if password.trim().is_empty() {
        log::warn!("[sharing] Rejected: empty password");
        return Err("分享密码不能为空".to_string());
    }

    // Validate port range (recommended dynamic/private ports: 49152-65535)
    // Allow common development ports (3000-9999) for convenience
    if port < 3000 {
        log::warn!("[sharing] Rejected: port {} too low (minimum 3000)", port);
        return Err(format!(
            "端口 {} 过小。推荐使用 49152-65535 范围内的端口，或 3000-9999 开发端口",
            port
        ));
    }

    // Check if already sharing
    {
        let state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        if state.active {
            log::warn!("[sharing] Rejected: already sharing on port {}", state.port);
            return Err("Already sharing. Stop current sharing first.".to_string());
        }
    }

    // Check if port is available
    // Bind to 0.0.0.0 to allow LAN access (security handled by password auth)
    let bind_addr = format!("0.0.0.0:{}", port);
    if let Err(e) = tokio::net::TcpListener::bind(&bind_addr).await {
        log::error!("[sharing] Port {} unavailable: {}", port, e);
        return Err(format!("端口 {} 已被占用: {}", port, e));
    }

    // Collect all LAN IPs for multi-address display
    // Include all non-loopback IPv4: private, link-local, CGNAT (Tailscale 100.x), etc.
    let mut lan_ips: Vec<std::net::IpAddr> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(_name, ip)| match ip {
            std::net::IpAddr::V4(v4)
                if !v4.is_loopback() && !v4.is_unspecified() && !v4.is_multicast() =>
            {
                Some(ip)
            }
            _ => None,
        })
        .collect();
    lan_ips.sort();
    lan_ips.dedup();
    log::info!(
        "[sharing] Detected {} LAN IPs: {:?}",
        lan_ips.len(),
        lan_ips
    );

    // Generate self-signed TLS certificate for HTTPS (includes all LAN IPs in SAN)
    let tls_certs = tls::generate_self_signed(&lan_ips)?;
    log::info!(
        "[sharing] TLS certificate generated for {} LAN IPs",
        lan_ips.len()
    );

    let share_urls: Vec<String> = lan_ips
        .iter()
        .map(|ip| format!("https://{}:{}", ip, port))
        .collect();

    let share_url = share_urls
        .first()
        .cloned()
        .unwrap_or_else(|| format!("https://0.0.0.0:{}", port));

    // Create shutdown channel
    let (tx, rx) = tokio::sync::watch::channel(false);

    // Generate salt and derive key using PBKDF2
    use ring::pbkdf2;
    use ring::rand::{SecureRandom, SystemRandom};

    let rng = SystemRandom::new();
    let mut salt = vec![0u8; 16];
    rng.fill(&mut salt).map_err(|_| "Failed to generate salt")?;

    let mut auth_key = vec![0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        std::num::NonZeroU32::new(100_000).unwrap(),
        &salt,
        password.as_bytes(),
        &mut auth_key,
    );
    log::info!("[sharing] PBKDF2 key derived, auth state updated");

    // Update share state
    {
        let mut state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        state.active = true;
        state.workspace_path = Some(workspace_path.clone());
        state.port = port;
        state.auth_key = Some(auth_key);
        state.auth_salt = Some(salt);
        state.shutdown_tx = Some(tx);
    }

    // Save port to global config (no longer save password)
    {
        let mut config = load_global_config();
        config.last_share_port = Some(port);
        let _ = save_global_config_internal(&config);
    }
    log::info!("[sharing] Port {} saved to global config", port);

    // Clear any previous authenticated sessions
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        sessions.clear();
    }
    log::info!("[sharing] Previous authenticated sessions cleared");

    // Spawn HTTP (port) + HTTPS (port+1) servers on the shared tokio runtime
    TOKIO_RT.spawn(http_server::start_server(port, rx, Some(tls_certs)));
    log::info!(
        "[sharing] HTTP/HTTPS server spawned on port {} for workspace {}",
        port,
        workspace_path
    );

    Ok(share_url)
}

#[tauri::command]
pub(crate) async fn start_sharing(
    window: tauri::Window,
    port: u16,
    password: String,
) -> Result<String, String> {
    let workspace_path =
        get_window_workspace_path(window.label()).ok_or("No workspace selected")?;
    start_sharing_internal(workspace_path, port, password).await
}

pub async fn start_ngrok_tunnel_internal() -> Result<String, String> {
    log::info!("[ngrok] Starting ngrok tunnel");
    let port = {
        let state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        if !state.active {
            log::warn!("[ngrok] Rejected: LAN sharing not active");
            return Err("请先开启分享".to_string());
        }
        if state.ngrok_url.is_some() {
            log::warn!("[ngrok] Rejected: ngrok tunnel already running");
            return Err("ngrok 隧道已在运行".to_string());
        }
        state.port
    };

    let config = load_global_config();
    let ngrok_token = config
        .ngrok_token
        .ok_or("未配置 ngrok token，请先在设置中配置".to_string())?;
    log::info!("[ngrok] Token configured, forwarding to port {}", port);

    let (url_tx, url_rx) = std::sync::mpsc::channel::<Result<String, String>>();

    let ngrok_handle = TOKIO_RT.spawn(async move {
        let result = async {
            log::info!("[ngrok] Connecting to ngrok service...");
            let session = ngrok::Session::builder()
                .authtoken(ngrok_token)
                .connect()
                .await
                .map_err(|e| format!("ngrok 连接失败: {}", e))?;
            log::info!(
                "[ngrok] Session established, creating HTTP tunnel to localhost:{}",
                port
            );

            let forwarder = session
                .http_endpoint()
                .listen_and_forward(
                    url::Url::parse(&format!("http://localhost:{}", port))
                        .map_err(|e| format!("URL 解析失败: {}", e))?,
                )
                .await
                .map_err(|e| format!("ngrok 隧道创建失败: {}", e))?;

            let ngrok_url = forwarder.url().to_string();
            log::info!("[ngrok] Tunnel created, URL: {}", ngrok_url);
            Ok::<(String, Forwarder<HttpTunnel>), String>((ngrok_url, forwarder))
        }
        .await;

        match result {
            Ok((url, mut forwarder)) => {
                let _ = url_tx.send(Ok(url));
                // join() keeps the forwarder actively forwarding traffic
                let _ = forwarder.join().await;
                log::info!("[ngrok] Forwarder join() returned, tunnel closed");
            }
            Err(e) => {
                log::error!("[ngrok] Tunnel creation failed: {}", e);
                let _ = url_tx.send(Err(e));
            }
        }
    });

    // Wait for the ngrok URL (with timeout)
    match url_rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(ngrok_url)) => {
            let mut state = SHARE_STATE
                .lock()
                .map_err(|_| "Internal state error".to_string())?;
            state.ngrok_url = Some(ngrok_url.clone());
            state.ngrok_task = Some(ngrok_handle);
            log::info!("[ngrok] Tunnel started successfully: {}", ngrok_url);
            Ok(ngrok_url)
        }
        Ok(Err(e)) => {
            log::error!("[ngrok] Tunnel startup error: {}", e);
            ngrok_handle.abort();
            Err(e)
        }
        Err(_) => {
            log::error!("[ngrok] Tunnel startup timed out after 30s");
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
    log::info!("[ngrok] Stopping ngrok tunnel");
    let mut state = SHARE_STATE
        .lock()
        .map_err(|_| "Internal state error".to_string())?;
    if let Some(handle) = state.ngrok_task.take() {
        // abort() is intentional: the ngrok crate's Forwarder does not expose a graceful
        // shutdown API. Aborting the task triggers its Drop impl, which handles cleanup.
        handle.abort();
        log::info!("[ngrok] Tunnel task aborted");
    } else {
        log::info!("[ngrok] No active tunnel task to stop");
    }
    state.ngrok_url = None;
    log::info!("[ngrok] Tunnel stopped");
    Ok(())
}

/// Internal function to stop LAN sharing.
pub fn stop_sharing_internal() -> Result<(), String> {
    log::info!("[sharing] Stopping LAN sharing");

    // Single lock scope: check active, stop ngrok, extract shutdown_tx, and reset state
    let shutdown_tx = {
        let mut state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        if !state.active {
            log::warn!("[sharing] Stop rejected: not currently sharing");
            return Err("Not currently sharing".to_string());
        }

        // Stop ngrok tunnel if active
        // NOTE: abort() is intentional here -- the ngrok crate's Forwarder does not expose
        // a graceful shutdown API; aborting the task triggers its Drop impl for cleanup.
        if let Some(handle) = state.ngrok_task.take() {
            handle.abort();
            log::info!("[sharing] Stopped ngrok tunnel");
        }
        state.ngrok_url = None;

        // Extract shutdown_tx and reset all state atomically
        let tx = state.shutdown_tx.take();
        state.active = false;
        state.workspace_path = None;
        state.port = 0;
        state.auth_key = None;
        state.auth_salt = None;
        tx
    };

    // Stop HTTP server (outside SHARE_STATE lock to avoid holding it during send)
    if let Some(tx) = shutdown_tx {
        let _ = tx.send(true);
        log::info!("[sharing] HTTP server shutdown signal sent");
    }

    // Clear authenticated sessions and connected clients
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        let count = sessions.len();
        sessions.clear();
        log::info!("[sharing] Cleared {} authenticated sessions", count);
    }
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        let count = clients.len();
        clients.clear();
        log::info!("[sharing] Cleared {} connected clients", count);
    }

    log::info!("[sharing] LAN sharing stopped");
    Ok(())
}

#[tauri::command]
pub(crate) async fn stop_sharing() -> Result<(), String> {
    stop_sharing_internal()
}

#[tauri::command]
pub(crate) async fn get_share_state() -> Result<ShareStateInfo, String> {
    let state = SHARE_STATE
        .lock()
        .map_err(|_| "Internal state error".to_string())?;
    let urls = if state.active {
        let mut ips: Vec<std::net::IpAddr> = local_ip_address::list_afinet_netifas()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(_name, ip)| match ip {
                std::net::IpAddr::V4(v4)
                    if !v4.is_loopback() && !v4.is_unspecified() && !v4.is_multicast() =>
                {
                    Some(ip)
                }
                _ => None,
            })
            .collect();
        ips.sort();
        ips.dedup();
        ips.iter()
            .map(|ip| format!("https://{}:{}", ip, state.port))
            .collect()
    } else {
        vec![]
    };

    let current_workspace_name = state
        .workspace_path
        .as_ref()
        .map(|path| crate::config::load_workspace_config(path).name);

    Ok(ShareStateInfo {
        active: state.active,
        urls,
        ngrok_url: state.ngrok_url.clone(),
        workspace_path: state.workspace_path.clone(),
        current_workspace_name,
    })
}

#[tauri::command]
pub(crate) async fn update_share_password(password: String) -> Result<(), String> {
    log::info!(
        "[sharing] Updating share password (new password_len={})",
        password.len()
    );

    // SECURITY: Validate password is not empty
    if password.trim().is_empty() {
        log::warn!("[sharing] Password update rejected: empty password");
        return Err("分享密码不能为空".to_string());
    }

    // Generate new salt and derive new key
    use ring::pbkdf2;
    use ring::rand::{SecureRandom, SystemRandom};

    let rng = SystemRandom::new();
    let mut salt = vec![0u8; 16];
    rng.fill(&mut salt).map_err(|_| "Failed to generate salt")?;

    let mut auth_key = vec![0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        std::num::NonZeroU32::new(100_000).unwrap(),
        &salt,
        password.as_bytes(),
        &mut auth_key,
    );
    log::info!("[sharing] New PBKDF2 key derived");

    let mut state = SHARE_STATE
        .lock()
        .map_err(|_| "Internal state error".to_string())?;
    if !state.active {
        log::warn!("[sharing] Password update rejected: not currently sharing");
        return Err("Not currently sharing".to_string());
    }
    state.auth_key = Some(auth_key);
    state.auth_salt = Some(salt);
    drop(state);

    // Clear authenticated sessions and connected clients so everyone must re-auth with the new password
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        let count = sessions.len();
        sessions.clear();
        log::info!(
            "[sharing] Cleared {} authenticated sessions after password change",
            count
        );
    }
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        let count = clients.len();
        clients.clear();
        log::info!(
            "[sharing] Cleared {} connected clients after password change",
            count
        );
    }

    log::info!("[sharing] Share password updated successfully");
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

/// Kick a client by session ID: send WebSocket notification, then disconnect and remove session.
pub fn kick_client_internal(session_id: &str) -> Result<(), String> {
    log::info!("[sharing] Kicking client: session_id={}", session_id);

    // Send kick notification via WebSocket broadcast before removing session
    let notification = serde_json::json!({
        "session_id": session_id,
        "type": "kicked",
        "reason": "您已被管理员踢出"
    })
    .to_string();
    let _ = CLIENT_NOTIFICATION_BROADCAST.send(notification);
    log::info!(
        "[sharing] Kick notification broadcast sent for session {}",
        session_id
    );

    // Remove from authenticated sessions
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        let removed = sessions.remove(session_id);
        log::info!(
            "[sharing] Session {} {} from authenticated sessions",
            session_id,
            if removed { "removed" } else { "not found" }
        );
    }

    // Remove from connected clients
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        let removed = clients.remove(session_id).is_some();
        log::info!(
            "[sharing] Session {} {} from connected clients",
            session_id,
            if removed { "removed" } else { "not found" }
        );
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn kick_client(session_id: String) -> Result<(), String> {
    kick_client_internal(&session_id)
}
