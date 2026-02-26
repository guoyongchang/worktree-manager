use ngrok::config::ForwarderBuilder; // trait import: provides listen_and_forward()
use ngrok::forwarder::Forwarder;
use ngrok::tunnel::{EndpointInfo, HttpTunnel}; // EndpointInfo trait import: provides url()

use crate::config::{get_window_workspace_path, load_global_config, save_global_config_internal};
use crate::http_server;
use crate::state::{
    AUTHENTICATED_SESSIONS, CLIENT_NOTIFICATION_BROADCAST, CONNECTED_CLIENTS, SHARE_STATE,
    TOKIO_RT,
};
use crate::tls;
use crate::types::{ConnectedClient, ShareStateInfo};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

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

/// Internal function to start LAN sharing. Can be called from Tauri command or from WMS tunnel auto-start.
pub async fn start_sharing_internal(
    workspace_path: String,
    port: u16,
    password: String,
) -> Result<String, String> {
    // SECURITY: Validate password is not empty (required for remote access security)
    if password.trim().is_empty() {
        return Err("分享密码不能为空".to_string());
    }

    // Validate port range (recommended dynamic/private ports: 49152-65535)
    // Allow common development ports (3000-9999) for convenience
    if port < 3000 {
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

    // Generate self-signed TLS certificate for HTTPS (includes all LAN IPs in SAN)
    let tls_certs = tls::generate_self_signed(&lan_ips)?;

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
    rng.fill(&mut salt)
        .map_err(|_| "Failed to generate salt")?;

    let mut auth_key = vec![0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        std::num::NonZeroU32::new(100_000).unwrap(),
        &salt,
        password.as_bytes(),
        &mut auth_key,
    );

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

    // Clear any previous authenticated sessions
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        sessions.clear();
    }

    // Spawn HTTP (port) + HTTPS (port+1) servers on the shared tokio runtime
    TOKIO_RT.spawn(http_server::start_server(port, rx, Some(tls_certs)));

    log::info!(
        "Sharing started on {} for workspace {}",
        share_url,
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
    let port = {
        let state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        if !state.active {
            return Err("请先开启分享".to_string());
        }
        if state.ngrok_url.is_some() {
            return Err("ngrok 隧道已在运行".to_string());
        }
        state.port
    };

    let ngrok_token = load_global_config()
        .ngrok_token
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
                        .map_err(|e| format!("URL 解析失败: {}", e))?,
                )
                .await
                .map_err(|e| format!("ngrok 隧道创建失败: {}", e))?;

            let ngrok_url = forwarder.url().to_string();
            Ok::<(String, Forwarder<HttpTunnel>), String>((ngrok_url, forwarder))
        }
        .await;

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
            let mut state = SHARE_STATE
                .lock()
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
    let mut state = SHARE_STATE
        .lock()
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

// ==================== WMS 隧道 ====================

#[derive(Debug, Serialize, Deserialize)]
pub struct WmsConfig {
    pub server_url: Option<String>,
    pub token: Option<String>,
    pub subdomain: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_wms_config() -> Result<WmsConfig, String> {
    let config = load_global_config();
    Ok(WmsConfig {
        server_url: config.wms_server_url,
        token: config.wms_token,
        subdomain: config.wms_subdomain,
    })
}

#[tauri::command]
pub(crate) async fn set_wms_config(
    server_url: String,
    token: String,
    subdomain: String,
) -> Result<(), String> {
    let mut config = load_global_config();
    config.wms_server_url = if server_url.is_empty() {
        None
    } else {
        Some(server_url)
    };
    config.wms_token = if token.is_empty() { None } else { Some(token) };
    config.wms_subdomain = if subdomain.is_empty() {
        None
    } else {
        Some(subdomain)
    };
    save_global_config_internal(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn start_wms_tunnel(window: tauri::Window) -> Result<String, String> {
    start_wms_tunnel_internal(Some(window)).await
}

/// Internal function for starting WMS tunnel, callable from both Tauri command and HTTP handler.
/// If LAN sharing is not active, automatically starts it using saved port/password.
pub async fn start_wms_tunnel_internal(window: Option<tauri::Window>) -> Result<String, String> {
    // Auto-start LAN sharing if not active
    let port = {
        let state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        if state.wms_url.is_some() {
            return Err("WMS 隧道已在运行".to_string());
        }
        if state.active {
            Some(state.port)
        } else {
            None
        }
    };

    let port = if let Some(p) = port {
        p
    } else {
        // LAN sharing is not active, auto-start it
        let config = load_global_config();

        // Determine workspace path: prefer window binding, fall back to current_workspace
        let _workspace_path = if let Some(ref w) = window {
            get_window_workspace_path(w.label())
        } else {
            config.current_workspace.clone()
        }
        .ok_or("无法确定当前工作区，请先选择一个工作区".to_string())?;

        // Since passwords are no longer persisted for security, WMS auto-start requires manual LAN sharing first
        return Err(
            "WMS 隧道需要先手动启动 LAN 分享。出于安全考虑，密码不再自动保存。"
                .to_string(),
        );
    };

    let config = load_global_config();
    let server_url = "https://tunnel.kirov-opensource.com".to_string();
    let subdomain = config
        .wms_subdomain
        .ok_or("未配置 WMS Subdomain，请先在设置中配置".to_string())?;
    let token = config.wms_token.filter(|t| !t.is_empty());
    if token.is_none() {
        return Err("未配置 WMS Token，请先在设置中配置".to_string());
    }

    let (url_tx, url_rx) = std::sync::mpsc::channel::<Result<String, String>>();

    // Create a shutdown signal so we can gracefully close the WebSocket later
    let (wms_shutdown_tx, wms_shutdown_rx) = tokio::sync::watch::channel(false);

    // Create connected flag for real-time status tracking
    let connected_flag = Arc::new(AtomicBool::new(false));
    let connected_flag_clone = connected_flag.clone();

    // Create shared reconnect state for frontend polling
    let reconnect_state = Arc::new(std::sync::Mutex::new(
        crate::wms_tunnel::WmsTunnelReconnectState::default(),
    ));
    let reconnect_state_clone = reconnect_state.clone();

    // Create manual reconnect channel
    let (manual_reconnect_tx, manual_reconnect_rx) = tokio::sync::mpsc::unbounded_channel::<()>();

    let wms_handle = TOKIO_RT.spawn(async move {
        crate::wms_tunnel::run_tunnel(
            port,
            server_url,
            token,
            subdomain,
            url_tx,
            wms_shutdown_rx,
            connected_flag_clone,
            reconnect_state_clone,
            manual_reconnect_rx,
        )
        .await;
    });

    // Check if LAN was auto-started so we can roll back on failure
    let auto_started_lan = {
        SHARE_STATE
            .lock()
            .map(|s| s.wms_auto_started_lan)
            .unwrap_or(false)
    };

    match url_rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(Ok(wms_url)) => {
            let mut state = SHARE_STATE
                .lock()
                .map_err(|_| "Internal state error".to_string())?;
            state.wms_url = Some(wms_url.clone());
            state.wms_task = Some(wms_handle);
            state.wms_shutdown_tx = Some(wms_shutdown_tx);
            state.wms_connected = Some(connected_flag);
            state.wms_reconnect_state = Some(reconnect_state);
            state.wms_manual_reconnect_tx = Some(manual_reconnect_tx);
            log::info!("WMS tunnel started: {}", wms_url);
            Ok(wms_url)
        }
        Ok(Err(e)) => {
            wms_handle.abort();
            // Roll back auto-started LAN sharing on failure
            if auto_started_lan {
                log::info!("WMS tunnel failed, rolling back auto-started LAN sharing");
                let _ = stop_sharing_internal();
            }
            Err(e)
        }
        Err(_) => {
            wms_handle.abort();
            // Roll back auto-started LAN sharing on timeout
            if auto_started_lan {
                log::info!("WMS tunnel timed out, rolling back auto-started LAN sharing");
                let _ = stop_sharing_internal();
            }
            Err("WMS 隧道启动超时".to_string())
        }
    }
}

#[tauri::command]
pub(crate) async fn stop_wms_tunnel() -> Result<(), String> {
    stop_wms_tunnel_internal().await
}

/// Internal function for stopping WMS tunnel.
/// If LAN sharing was auto-started by WMS, also stops LAN sharing.
pub async fn stop_wms_tunnel_internal() -> Result<(), String> {
    let (shutdown_tx, task_handle, should_stop_lan) = {
        let mut state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        let tx = state.wms_shutdown_tx.take();
        let handle = state.wms_task.take();
        let auto_lan = state.wms_auto_started_lan;
        state.wms_url = None;
        state.wms_connected = None;
        state.wms_reconnect_state = None;
        state.wms_manual_reconnect_tx = None;
        state.wms_auto_started_lan = false;
        (tx, handle, auto_lan)
    };

    // Signal graceful shutdown (sends WebSocket Close frame)
    if let Some(tx) = shutdown_tx {
        let _ = tx.send(true);
    }

    if let Some(handle) = task_handle {
        // Wait briefly for graceful shutdown, then abort as fallback
        match tokio::time::timeout(std::time::Duration::from_secs(3), handle).await {
            Ok(_) => log::info!("WMS tunnel stopped gracefully"),
            Err(_) => log::warn!("WMS tunnel graceful shutdown timed out, task will be dropped"),
        }
    } else {
        log::info!("WMS tunnel stopped");
    }

    // Auto-stop LAN sharing if it was auto-started by WMS
    if should_stop_lan {
        log::info!("WMS tunnel: auto-stopping LAN sharing (was auto-started)");
        if let Err(e) = stop_sharing_internal() {
            log::warn!("WMS tunnel: failed to auto-stop LAN sharing: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn wms_manual_reconnect() -> Result<(), String> {
    let state = SHARE_STATE
        .lock()
        .map_err(|_| "Internal state error".to_string())?;

    if state.wms_url.is_none() {
        return Err("WMS 隧道未启动".to_string());
    }

    let tx = state
        .wms_manual_reconnect_tx
        .as_ref()
        .ok_or("WMS 手动重连通道不可用".to_string())?;

    tx.send(())
        .map_err(|_| "发送手动重连信号失败".to_string())?;

    log::info!("WMS tunnel: manual reconnect triggered by user");
    Ok(())
}

/// Internal function for HTTP server to call manual reconnect.
pub fn wms_manual_reconnect_internal() -> Result<(), String> {
    let state = SHARE_STATE
        .lock()
        .map_err(|_| "Internal state error".to_string())?;

    if state.wms_url.is_none() {
        return Err("WMS 隧道未启动".to_string());
    }

    let tx = state
        .wms_manual_reconnect_tx
        .as_ref()
        .ok_or("WMS 手动重连通道不可用".to_string())?;

    tx.send(())
        .map_err(|_| "发送手动重连信号失败".to_string())?;

    log::info!("WMS tunnel: manual reconnect triggered via HTTP");
    Ok(())
}

/// Internal function to stop LAN sharing. Can be called from Tauri command or from WMS tunnel auto-stop.
pub fn stop_sharing_internal() -> Result<(), String> {
    // Single lock scope: check active, stop ngrok, extract shutdown_tx, and reset state
    let shutdown_tx = {
        let mut state = SHARE_STATE
            .lock()
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

        // Stop WMS tunnel if active (signal graceful shutdown first)
        if let Some(tx) = state.wms_shutdown_tx.take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = state.wms_task.take() {
            handle.abort();
        }
        state.wms_url = None;
        state.wms_connected = None;
        state.wms_reconnect_state = None;
        state.wms_manual_reconnect_tx = None;
        state.wms_auto_started_lan = false;

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

    let wms_connected = state
        .wms_connected
        .as_ref()
        .map_or(false, |flag| flag.load(Ordering::Relaxed));

    let (wms_reconnecting, wms_reconnect_attempt, wms_next_retry_secs) =
        if let Some(ref rs) = state.wms_reconnect_state {
            if let Ok(rs) = rs.lock() {
                (rs.reconnecting, rs.attempt, rs.next_retry_secs())
            } else {
                (false, 0, 0)
            }
        } else {
            (false, 0, 0)
        };

    let current_workspace_name = state.workspace_path.as_ref().map(|path| {
        crate::config::load_workspace_config(path).name
    });

    Ok(ShareStateInfo {
        active: state.active,
        urls,
        ngrok_url: state.ngrok_url.clone(),
        wms_url: state.wms_url.clone(),
        wms_connected,
        wms_reconnecting,
        wms_reconnect_attempt,
        wms_next_retry_secs,
        workspace_path: state.workspace_path.clone(),
        current_workspace_name,
    })
}

#[tauri::command]
pub(crate) async fn update_share_password(password: String) -> Result<(), String> {
    // SECURITY: Validate password is not empty
    if password.trim().is_empty() {
        return Err("分享密码不能为空".to_string());
    }

    // Generate new salt and derive new key
    use ring::pbkdf2;
    use ring::rand::{SecureRandom, SystemRandom};

    let rng = SystemRandom::new();
    let mut salt = vec![0u8; 16];
    rng.fill(&mut salt)
        .map_err(|_| "Failed to generate salt")?;

    let mut auth_key = vec![0u8; 32];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        std::num::NonZeroU32::new(100_000).unwrap(),
        &salt,
        password.as_bytes(),
        &mut auth_key,
    );

    let mut state = SHARE_STATE
        .lock()
        .map_err(|_| "Internal state error".to_string())?;
    if !state.active {
        return Err("Not currently sharing".to_string());
    }
    state.auth_key = Some(auth_key);
    state.auth_salt = Some(salt);
    drop(state);

    // Clear authenticated sessions and connected clients so everyone must re-auth with the new password
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        sessions.clear();
    }
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        clients.clear();
    }

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

/// Kick a client by session ID: send WebSocket notification, then disconnect and remove session.
pub fn kick_client_internal(session_id: &str) -> Result<(), String> {
    log::info!("Kicking client with session ID: {}", session_id);

    // Send kick notification via WebSocket broadcast before removing session
    let notification = serde_json::json!({
        "session_id": session_id,
        "type": "kicked",
        "reason": "您已被管理员踢出"
    })
    .to_string();
    let _ = CLIENT_NOTIFICATION_BROADCAST.send(notification);

    // Remove from authenticated sessions
    if let Ok(mut sessions) = AUTHENTICATED_SESSIONS.lock() {
        sessions.remove(session_id);
    }

    // Remove from connected clients
    if let Ok(mut clients) = CONNECTED_CLIENTS.lock() {
        clients.remove(session_id);
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn kick_client(session_id: String) -> Result<(), String> {
    kick_client_internal(&session_id)
}
