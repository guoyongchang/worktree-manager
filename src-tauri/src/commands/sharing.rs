use ngrok::config::ForwarderBuilder; // trait import: provides listen_and_forward()
use ngrok::forwarder::Forwarder;
use ngrok::tunnel::{EndpointInfo, HttpTunnel}; // EndpointInfo trait import: provides url()
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

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
    let config = load_global_config();
    Ok(config.share_password)
}

fn save_last_share_credentials(port: Option<u16>, password: &str) -> Result<(), String> {
    let mut config = load_global_config();
    if let Some(port) = port {
        config.last_share_port = Some(port);
    }
    config.share_password = Some(password.to_string());
    save_global_config_internal(&config)
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

    // SECURITY: Validate password strength (required for remote access security)
    if password.trim().chars().count() < 8 {
        log::warn!("[sharing] Rejected: password shorter than 8 characters");
        return Err("分享密码至少需要 8 位".to_string());
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

    if port == crate::state::MCP_SERVER_PORT {
        log::warn!(
            "[sharing] Rejected: port {} conflicts with MCP server",
            port
        );
        return Err(format!("端口 {} 已被 MCP 服务占用，请更换其他端口", port));
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
    log::info!("[sharing] PBKDF2 key derived");

    save_last_share_credentials(Some(port), &password)?;
    log::info!(
        "[sharing] Port {} and password saved to global config",
        port
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

    // WMS: take a single consistent snapshot from wms_reconnect_state
    let (wms_reconnecting, wms_reconnect_attempt, wms_next_retry_secs) = if let Some(rs) = state
        .wms_reconnect_state
        .as_ref()
        .and_then(|arc| arc.lock().ok())
    {
        (rs.reconnecting, rs.attempt, rs.next_retry_secs())
    } else {
        (false, 0, 0)
    };

    Ok(ShareStateInfo {
        active: state.active,
        urls,
        ngrok_url: state.ngrok_url.clone(),
        workspace_path: state
            .workspace_path
            .as_ref()
            .map(|p| crate::normalize_path(p)),
        current_workspace_name,
        wms_url: state.wms_url.clone(),
        wms_connected: state
            .wms_connected
            .as_ref()
            .map(|f| f.load(std::sync::atomic::Ordering::Relaxed))
            .unwrap_or(false),
        wms_reconnecting,
        wms_reconnect_attempt,
        wms_next_retry_secs,
    })
}

#[tauri::command]
pub(crate) async fn update_share_password(password: String) -> Result<(), String> {
    log::info!(
        "[sharing] Updating share password (new password_len={})",
        password.len()
    );

    // SECURITY: Validate password strength
    if password.trim().chars().count() < 8 {
        log::warn!("[sharing] Password update rejected: shorter than 8 characters");
        return Err("分享密码至少需要 8 位".to_string());
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

    save_last_share_credentials(None, &password)?;

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

// ==================== WMS 隧道分享命令 ====================

const DEFAULT_WMS_SERVER_URL: &str = "https://wms.kirov-opensource.com";

/// Outcome of a device auto-registration: whether the device was registered under
/// the logged-in user (authenticated) or anonymously (fell back).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistrationMode {
    Authenticated,
    Anonymous,
}

/// Auto-register the current device with the WMS server.
/// Writes tunnel_token, subdomain, device_id, and server_url back to CloudConfig.
/// If access_token is set, sends it as Bearer for authenticated registration.
/// On 401, tries to refresh once using refresh_token; if refresh fails, falls back to anonymous.
/// Returns whether the final registration was authenticated or anonymous so callers
/// can detect a silent auth downgrade (logged-in but token+refresh both expired).
pub async fn auto_register_tunnel_internal() -> Result<RegistrationMode, String> {
    let mut config = load_global_config();

    // Generate device_id if not yet assigned
    let device_id = match config.cloud.device_id.clone() {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            config.cloud.device_id = Some(id.clone());
            save_global_config_internal(&config)?;
            log::info!("[wms-tunnel] Generated new device_id: {}", id);
            id
        }
    };

    let server_url = config
        .cloud
        .server_url
        .clone()
        .unwrap_or_else(|| DEFAULT_WMS_SERVER_URL.to_string());

    let device_name = config.cloud.device_name.clone().unwrap_or_else(|| {
        gethostname::gethostname()
            .into_string()
            .unwrap_or_else(|_| "Desktop".to_string())
    });

    let register_url = format!("{}/api/device/register", server_url.trim_end_matches('/'));
    log::info!(
        "[wms-tunnel] Auto-registering device at {} (device_id={})",
        register_url,
        device_id
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

    #[derive(serde::Deserialize)]
    struct DeviceRegisterResponse {
        token: String,
        subdomain: String,
    }

    // Helper closure to build the registration request
    let build_request = |access_token: Option<&str>| -> reqwest::RequestBuilder {
        let mut req = client
            .post(&register_url)
            .json(&serde_json::json!({ "device_id": device_id, "device_name": device_name }));
        if let Some(token) = access_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        req
    };

    // Re-load config to get latest token (may have been updated since top of fn)
    let config = load_global_config();
    let access_token = config.cloud.access_token.clone();
    let refresh_token = config.cloud.refresh_token.clone();

    // Track whether the final successful request was authenticated or anonymous.
    let attempted_authenticated = access_token.is_some();
    let mut mode = if attempted_authenticated {
        RegistrationMode::Authenticated
    } else {
        RegistrationMode::Anonymous
    };

    let resp = build_request(access_token.as_deref())
        .send()
        .await
        .map_err(|e| format!("设备注册请求失败: {}", e))?;

    // On 401: try refresh once, then retry; if refresh fails, fall back to anonymous.
    let resp = if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        if let Some(rt) = refresh_token.as_deref() {
            log::info!("[wms-tunnel] Registration got 401, attempting token refresh");
            match crate::cloud_client::refresh_access_token(&server_url, rt).await {
                Ok(new_token) => {
                    // Persist new access_token
                    let mut cfg = load_global_config();
                    cfg.cloud.access_token = Some(new_token.clone());
                    let _ = save_global_config_internal(&cfg);
                    // Retry with new token (still authenticated)
                    build_request(Some(&new_token))
                        .send()
                        .await
                        .map_err(|e| format!("设备注册重试请求失败: {}", e))?
                }
                Err(e) => {
                    log::warn!(
                        "[wms-tunnel] Token refresh failed ({}), falling back to anonymous registration",
                        e
                    );
                    mode = RegistrationMode::Anonymous;
                    build_request(None)
                        .send()
                        .await
                        .map_err(|e| format!("匿名设备注册请求失败: {}", e))?
                }
            }
        } else {
            // No refresh token available, fall back to anonymous
            log::info!("[wms-tunnel] No refresh token available, retrying anonymously");
            mode = RegistrationMode::Anonymous;
            build_request(None)
                .send()
                .await
                .map_err(|e| format!("匿名设备注册请求失败: {}", e))?
        }
    } else {
        resp
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("设备注册失败 ({}): {}", status, body));
    }

    let result: DeviceRegisterResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析注册响应失败: {}", e))?;

    log::info!(
        "[wms-tunnel] Device registered ({:?}): subdomain={}, token_len={}",
        mode,
        result.subdomain,
        result.token.len()
    );

    // Save tunnel credentials back to CloudConfig
    let mut config = load_global_config();
    config.cloud.server_url = Some(server_url);
    config.cloud.tunnel_token = Some(result.token);
    config.cloud.subdomain = Some(result.subdomain);
    save_global_config_internal(&config)?;

    Ok(mode)
}

#[tauri::command]
pub(crate) async fn auto_register_tunnel() -> Result<(), String> {
    auto_register_tunnel_internal().await.map(|_| ())
}

#[tauri::command]
pub(crate) async fn start_wms_tunnel() -> Result<String, String> {
    start_wms_tunnel_internal().await
}

/// Internal function for starting WMS tunnel, callable from both Tauri command and HTTP handler.
/// Requires LAN sharing to already be active (active=true, password set).
/// If tunnel_token/subdomain not configured, auto-registers first.
pub async fn start_wms_tunnel_internal() -> Result<String, String> {
    log::info!("[wms-tunnel] Starting WMS tunnel");

    // Check preconditions: not already running, and LAN sharing is active
    let port = {
        let state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        if state.wms_url.is_some() {
            log::warn!("[wms-tunnel] Rejected: WMS tunnel already running");
            return Err("WMS 隧道已在运行".to_string());
        }
        if !state.active {
            log::warn!("[wms-tunnel] Rejected: LAN sharing not active");
            return Err(
                "WMS 隧道需要先开启 LAN 分享并设置分享密码。请先点击「开始分享」再启动 WMS 隧道。"
                    .to_string(),
            );
        }
        state.port
    };

    // Login gate: WMS tunnel requires a logged-in cloud account
    let config = load_global_config();
    if config.cloud.access_token.is_none() {
        log::warn!("[wms-tunnel] Rejected: no cloud access_token (not logged in)");
        return Err("WMS 隧道需要先登录云账号（设置 → 账号）".to_string());
    }

    // Auto-register if tunnel_token/subdomain missing.
    {
        let cfg = load_global_config();
        let has_token = cfg
            .cloud
            .tunnel_token
            .as_ref()
            .is_some_and(|t| !t.is_empty());
        let has_subdomain = cfg.cloud.subdomain.as_ref().is_some_and(|s| !s.is_empty());
        if !has_token || !has_subdomain {
            log::info!("[wms-tunnel] tunnel_token/subdomain missing, auto-registering...");
            let mode = auto_register_tunnel_internal().await?;
            // The login gate above guaranteed access_token.is_some(). If registration
            // nonetheless fell back to anonymous, the access_token AND refresh_token both
            // failed -- treat this as an expired session rather than silently exposing an
            // anonymous (device:xxx) public tunnel while the UI still shows "logged in".
            if mode == RegistrationMode::Anonymous {
                log::warn!(
                    "[wms-tunnel] Rejected: registration downgraded to anonymous despite login"
                );
                return Err("登录已过期，请重新登录".to_string());
            }
        }
    }

    // Read final config after potential registration
    let config = load_global_config();
    let server_url = config
        .cloud
        .server_url
        .clone()
        .unwrap_or_else(|| DEFAULT_WMS_SERVER_URL.to_string());
    let subdomain = config
        .cloud
        .subdomain
        .clone()
        .ok_or("注册后未获得 subdomain".to_string())?;
    let token = config.cloud.tunnel_token.clone().filter(|t| !t.is_empty());

    log::info!(
        "[wms-tunnel] Config: server_url={}, subdomain={}, token={}, port={}",
        server_url,
        subdomain,
        if token.is_some() { "Some" } else { "None" },
        port
    );

    let (url_tx, url_rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let (wms_shutdown_tx, wms_shutdown_rx) = tokio::sync::watch::channel(false);
    let connected_flag = Arc::new(AtomicBool::new(false));
    let connected_flag_clone = connected_flag.clone();
    let reconnect_state = Arc::new(std::sync::Mutex::new(
        crate::wms_tunnel::WmsTunnelReconnectState::default(),
    ));
    let reconnect_state_clone = reconnect_state.clone();
    let (manual_reconnect_tx, manual_reconnect_rx) = tokio::sync::mpsc::unbounded_channel::<()>();

    log::info!("[wms-tunnel] Spawning tunnel task");
    let wms_handle = crate::state::TOKIO_RT.spawn(async move {
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

    log::info!("[wms-tunnel] Waiting for tunnel URL (timeout: 30s)");
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
            log::info!("[wms-tunnel] Tunnel started successfully: {}", wms_url);
            Ok(wms_url)
        }
        Ok(Err(e)) => {
            log::error!("[wms-tunnel] Tunnel startup error: {}", e);
            wms_handle.abort();
            Err(e)
        }
        Err(_) => {
            log::error!("[wms-tunnel] Tunnel startup timed out after 30s");
            wms_handle.abort();
            Err("WMS 隧道启动超时".to_string())
        }
    }
}

#[tauri::command]
pub(crate) async fn stop_wms_tunnel() -> Result<(), String> {
    stop_wms_tunnel_internal().await
}

/// Internal function for stopping WMS tunnel.
/// Clears all wms_* fields in SHARE_STATE and sends shutdown signal.
/// LAN sharing is independent: it is always started manually first, so stopping the
/// WMS tunnel never tears down LAN sharing.
pub async fn stop_wms_tunnel_internal() -> Result<(), String> {
    log::info!("[wms-tunnel] Stopping WMS tunnel");
    let (shutdown_tx, task_handle) = {
        let mut state = SHARE_STATE
            .lock()
            .map_err(|_| "Internal state error".to_string())?;
        let tx = state.wms_shutdown_tx.take();
        let handle = state.wms_task.take();
        state.wms_url = None;
        state.wms_connected = None;
        state.wms_reconnect_state = None;
        state.wms_manual_reconnect_tx = None;
        (tx, handle)
    };

    if let Some(tx) = shutdown_tx {
        log::info!("[wms-tunnel] Sending shutdown signal");
        let _ = tx.send(true);
    }

    if let Some(handle) = task_handle {
        log::info!("[wms-tunnel] Waiting for graceful shutdown (timeout: 3s)");
        match tokio::time::timeout(std::time::Duration::from_secs(3), handle).await {
            Ok(_) => log::info!("[wms-tunnel] Tunnel stopped gracefully"),
            Err(_) => log::warn!("[wms-tunnel] Graceful shutdown timed out, task will be dropped"),
        }
    } else {
        log::info!("[wms-tunnel] No active tunnel task, stopped");
    }

    Ok(())
}

/// Internal function for HTTP server to trigger manual reconnect.
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

    log::info!("[wms-tunnel] Manual reconnect triggered");
    Ok(())
}

#[tauri::command]
pub(crate) async fn wms_manual_reconnect() -> Result<(), String> {
    wms_manual_reconnect_internal()
}

// ==================== Connected Clients ====================

#[tauri::command]
pub(crate) fn get_connected_clients() -> Vec<ConnectedClient> {
    let Ok(clients) = CONNECTED_CLIENTS.lock() else {
        return vec![];
    };
    clients.values().cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        AUTHENTICATED_SESSIONS, CONNECTED_CLIENTS, GLOBAL_CONFIG_CACHE, SHARE_STATE,
    };
    use once_cell::sync::Lazy;
    use serde_json::Value;
    use serial_test::serial;
    use std::sync::{Mutex, MutexGuard};

    static TEST_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_test_mutex() -> MutexGuard<'static, ()> {
        TEST_MUTEX.lock().unwrap_or_else(|err| err.into_inner())
    }

    struct GlobalConfigCacheGuard {
        previous: Option<crate::GlobalConfig>,
    }

    impl GlobalConfigCacheGuard {
        fn with_share_password(password: &str) -> Self {
            let mut cache = GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let previous = std::mem::replace(
                &mut *cache,
                Some(crate::GlobalConfig {
                    share_password: Some(password.to_string()),
                    ..crate::GlobalConfig::default()
                }),
            );
            Self { previous }
        }
    }

    impl Drop for GlobalConfigCacheGuard {
        fn drop(&mut self) {
            let mut cache = GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous.take();
        }
    }

    struct TempHomeGuard {
        previous_home: Option<String>,
        _temp_dir: tempfile::TempDir,
    }

    impl TempHomeGuard {
        fn new() -> Self {
            let temp_dir = tempfile::tempdir().expect("create temp home");
            let previous_home = std::env::var("HOME").ok();
            std::env::set_var("HOME", temp_dir.path());
            clear_global_config_cache();
            Self {
                previous_home,
                _temp_dir: temp_dir,
            }
        }
    }

    impl Drop for TempHomeGuard {
        fn drop(&mut self) {
            match &self.previous_home {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }
            clear_global_config_cache();
        }
    }

    struct ShareStateGuard {
        previous: crate::ShareState,
    }

    impl ShareStateGuard {
        fn inactive() -> Self {
            let mut state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let previous = std::mem::take(&mut *state);
            state.active = false;
            Self { previous }
        }

        fn active(workspace_path: String, port: u16) -> Self {
            let mut state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let previous = std::mem::take(&mut *state);
            let (tx, _rx) = tokio::sync::watch::channel(false);
            state.active = true;
            state.workspace_path = Some(workspace_path);
            state.port = port;
            state.auth_key = Some(vec![7; 32]);
            state.auth_salt = Some(vec![8; 16]);
            state.shutdown_tx = Some(tx);
            Self { previous }
        }
    }

    impl Drop for ShareStateGuard {
        fn drop(&mut self) {
            let mut state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *state = std::mem::take(&mut self.previous);
        }
    }

    struct ClientStateGuard {
        previous_sessions: std::collections::HashSet<String>,
        previous_clients: std::collections::HashMap<String, ConnectedClient>,
    }

    impl ClientStateGuard {
        fn empty() -> Self {
            let previous_sessions = {
                let mut sessions = AUTHENTICATED_SESSIONS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *sessions)
            };
            let previous_clients = {
                let mut clients = CONNECTED_CLIENTS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::take(&mut *clients)
            };
            Self {
                previous_sessions,
                previous_clients,
            }
        }
    }

    impl Drop for ClientStateGuard {
        fn drop(&mut self) {
            let mut sessions = AUTHENTICATED_SESSIONS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *sessions = std::mem::take(&mut self.previous_sessions);

            let mut clients = CONNECTED_CLIENTS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *clients = std::mem::take(&mut self.previous_clients);
        }
    }

    fn clear_global_config_cache() {
        let mut cache = GLOBAL_CONFIG_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cache = None;
    }

    fn free_port_at_least_3000() -> u16 {
        for _ in 0..100 {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind free port");
            let port = listener.local_addr().unwrap().port();
            if port >= 3000 {
                return port;
            }
        }
        panic!("could not allocate a test port >= 3000");
    }

    async fn loopback_bind_allowed() -> bool {
        tokio::net::TcpListener::bind("127.0.0.1:0").await.is_ok()
    }

    #[serial]
    #[tokio::test]
    async fn get_last_share_password_reads_global_config() {
        let _serial = lock_test_mutex();
        let _guard = GlobalConfigCacheGuard::with_share_password("persisted-secret");

        let password = get_last_share_password().await.expect("read password");

        assert_eq!(password, Some("persisted-secret".to_string()));
    }

    #[serial]
    #[tokio::test]
    async fn start_sharing_rejects_trimmed_password_shorter_than_eight_before_port_validation() {
        let _serial = lock_test_mutex();

        let result =
            start_sharing_internal("/tmp/workspace".to_string(), 1, " 1234567 ".to_string()).await;

        assert_eq!(result, Err("分享密码至少需要 8 位".to_string()));
    }

    #[serial]
    #[tokio::test]
    async fn start_sharing_accepts_exactly_eight_trimmed_password_characters() {
        let _serial = lock_test_mutex();

        let result =
            start_sharing_internal("/tmp/workspace".to_string(), 1, " 12345678 ".to_string()).await;

        assert_eq!(
            result,
            Err(
                "端口 1 过小。推荐使用 49152-65535 范围内的端口，或 3000-9999 开发端口".to_string()
            )
        );
    }

    #[serial]
    #[tokio::test]
    async fn start_sharing_accepts_passwords_longer_than_eight_characters() {
        let _serial = lock_test_mutex();

        let result =
            start_sharing_internal("/tmp/workspace".to_string(), 2, "long-password".to_string())
                .await;

        assert_eq!(
            result,
            Err(
                "端口 2 过小。推荐使用 49152-65535 范围内的端口，或 3000-9999 开发端口".to_string()
            )
        );
    }

    #[serial]
    #[tokio::test]
    async fn start_sharing_rejects_mcp_server_port() {
        let _serial = lock_test_mutex();

        let result = start_sharing_internal(
            "/tmp/workspace".to_string(),
            crate::state::MCP_SERVER_PORT,
            "long-password".to_string(),
        )
        .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("MCP"));
    }

    #[serial]
    #[tokio::test]
    async fn start_sharing_rejects_already_active_before_binding_port() {
        let _serial = lock_test_mutex();
        let _state = ShareStateGuard::active("/tmp/workspace".to_string(), 45678);

        let result = start_sharing_internal(
            "/tmp/other-workspace".to_string(),
            45679,
            "long-password".to_string(),
        )
        .await;

        assert_eq!(
            result,
            Err("Already sharing. Stop current sharing first.".to_string())
        );
    }

    #[serial]
    #[tokio::test]
    async fn start_sharing_rejects_occupied_port_and_preserves_inactive_state() {
        let _serial = lock_test_mutex();
        if !loopback_bind_allowed().await {
            // The managed sandbox can deny loopback binds; this branch needs local sockets only.
            return;
        }
        let _state = ShareStateGuard::inactive();
        let listener = std::net::TcpListener::bind("0.0.0.0:0").expect("bind occupied port");
        let port = listener.local_addr().unwrap().port();
        if port < 3000 {
            // Rare ephemeral allocation below the command's validation threshold.
            return;
        }

        let result = start_sharing_internal(
            "/tmp/workspace".to_string(),
            port,
            "long-password".to_string(),
        )
        .await;

        assert!(result
            .unwrap_err()
            .starts_with(&format!("端口 {} 已被占用", port)));
        let state = SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(!state.active);
        assert_eq!(state.port, 0);
    }

    #[serial]
    #[tokio::test]
    async fn start_sharing_success_sets_state_persists_credentials_and_stop_resets() {
        let _serial = lock_test_mutex();
        if !loopback_bind_allowed().await {
            // The managed sandbox can deny loopback binds; this branch needs local sockets only.
            return;
        }
        let _home = TempHomeGuard::new();
        let _state = ShareStateGuard::inactive();
        let _clients = ClientStateGuard::empty();
        let workspace = tempfile::tempdir().expect("workspace");
        let port = free_port_at_least_3000();

        let url = start_sharing_internal(
            workspace.path().to_string_lossy().to_string(),
            port,
            "strong-password".to_string(),
        )
        .await
        .expect("start sharing");

        assert!(url.starts_with("https://"));
        {
            let state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            assert!(state.active);
            assert_eq!(state.workspace_path.as_deref(), workspace.path().to_str());
            assert_eq!(state.port, port);
            assert_eq!(state.auth_key.as_ref().unwrap().len(), 32);
            assert_eq!(state.auth_salt.as_ref().unwrap().len(), 16);
            assert!(state.shutdown_tx.is_some());
        }
        let config = load_global_config();
        assert_eq!(config.last_share_port, Some(port));
        assert_eq!(config.share_password.as_deref(), Some("strong-password"));

        stop_sharing_internal().expect("stop sharing");
        let state = SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(!state.active);
        assert_eq!(state.workspace_path, None);
        assert_eq!(state.port, 0);
        assert!(state.auth_key.is_none());
        assert!(state.auth_salt.is_none());
        assert!(state.shutdown_tx.is_none());
    }

    #[serial]
    #[tokio::test]
    async fn update_share_password_rejects_trimmed_password_shorter_than_eight() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateGuard::inactive();

        let result = update_share_password(" 1234567 ".to_string()).await;

        assert_eq!(result, Err("分享密码至少需要 8 位".to_string()));
    }

    #[serial]
    #[tokio::test]
    async fn update_share_password_accepts_exactly_eight_chars_before_state_check() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateGuard::inactive();

        let result = update_share_password("12345678".to_string()).await;

        assert_eq!(result, Err("Not currently sharing".to_string()));
    }

    #[serial]
    #[tokio::test]
    async fn update_share_password_accepts_long_trimmed_password_before_state_check() {
        let _serial = lock_test_mutex();
        let _guard = ShareStateGuard::inactive();

        let result = update_share_password("  longer-password  ".to_string()).await;

        assert_eq!(result, Err("Not currently sharing".to_string()));
    }

    #[serial]
    #[tokio::test]
    async fn update_share_password_rotates_key_persists_password_and_clears_clients() {
        let _serial = lock_test_mutex();
        let _home = TempHomeGuard::new();
        let _state = ShareStateGuard::active("/tmp/workspace".to_string(), 50123);
        let _clients = ClientStateGuard::empty();
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert("session-1".to_string());
        CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                "session-1".to_string(),
                ConnectedClient {
                    session_id: "session-1".to_string(),
                    ip: "198.51.100.10".to_string(),
                    user_agent: "unit-test".to_string(),
                    authenticated_at: "2026-06-11T00:00:00Z".to_string(),
                    last_active: "2026-06-11T00:01:00Z".to_string(),
                    ws_connected: true,
                },
            );
        let (old_key, old_salt) = {
            let state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            (
                state.auth_key.clone().unwrap(),
                state.auth_salt.clone().unwrap(),
            )
        };

        update_share_password("new-strong-password".to_string())
            .await
            .expect("update password");

        let state = SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let new_key = state.auth_key.as_ref().unwrap();
        let new_salt = state.auth_salt.as_ref().unwrap();
        assert_eq!(new_key.len(), 32);
        assert_eq!(new_salt.len(), 16);
        assert_ne!(new_key, &old_key);
        assert_ne!(new_salt, &old_salt);
        drop(state);
        assert!(AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
        assert!(CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
        assert_eq!(
            load_global_config().share_password.as_deref(),
            Some("new-strong-password")
        );
    }

    #[serial]
    #[test]
    fn save_last_share_credentials_persists_port_and_password() {
        let _serial = lock_test_mutex();
        let _home = TempHomeGuard::new();

        save_last_share_credentials(Some(45678), "persisted-secret")
            .expect("persist share credentials");

        let config_path = crate::config::get_global_config_path();
        let content = std::fs::read_to_string(config_path).expect("read global config");
        let value: Value = serde_json::from_str(&content).expect("parse global config");

        assert_eq!(value["last_share_port"], Value::from(45678));
        assert_eq!(value["share_password"], Value::from("persisted-secret"));
        assert_eq!(
            load_global_config().share_password,
            Some("persisted-secret".to_string())
        );
    }

    #[serial]
    #[tokio::test]
    async fn saved_share_credentials_reload_through_public_getters() {
        let _serial = lock_test_mutex();
        let _home = TempHomeGuard::new();

        save_last_share_credentials(Some(45679), "reload-secret").expect("persist credentials");
        clear_global_config_cache();

        assert_eq!(get_last_share_port().await.unwrap(), Some(45679));
        assert_eq!(
            get_last_share_password().await.unwrap(),
            Some("reload-secret".to_string())
        );
    }

    #[serial]
    #[tokio::test]
    async fn ngrok_token_getter_and_setter_persist_empty_as_none() {
        let _serial = lock_test_mutex();
        let _home = TempHomeGuard::new();

        assert_eq!(get_ngrok_token().await.unwrap(), None);
        set_ngrok_token("token-123".to_string()).await.unwrap();
        assert_eq!(
            get_ngrok_token().await.unwrap(),
            Some("token-123".to_string())
        );
        set_ngrok_token(String::new()).await.unwrap();
        assert_eq!(get_ngrok_token().await.unwrap(), None);
    }

    #[serial]
    #[tokio::test]
    async fn get_share_state_reports_inactive_and_active_snapshots() {
        let _serial = lock_test_mutex();
        let workspace = tempfile::tempdir().expect("workspace");
        {
            let _state = ShareStateGuard::inactive();
            let inactive = get_share_state().await.unwrap();
            assert!(!inactive.active);
            assert!(inactive.urls.is_empty());
            assert_eq!(inactive.ngrok_url, None);
            assert_eq!(inactive.workspace_path, None);
        }
        let _state = ShareStateGuard::active(workspace.path().to_string_lossy().to_string(), 51234);
        {
            let mut state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.ngrok_url = Some("https://unit.ngrok.test".to_string());
        }

        let active = get_share_state().await.unwrap();

        assert!(active.active);
        assert_eq!(active.ngrok_url.as_deref(), Some("https://unit.ngrok.test"));
        assert_eq!(
            active.workspace_path.as_deref(),
            Some(workspace.path().to_str().unwrap())
        );
        assert!(
            active.urls.iter().all(|url| url.ends_with(":51234")),
            "urls were {:?}",
            active.urls
        );
    }

    #[serial]
    #[tokio::test]
    async fn stop_ngrok_tunnel_aborts_task_and_clears_url() {
        let _serial = lock_test_mutex();
        let _state = ShareStateGuard::active("/tmp/workspace".to_string(), 51235);
        let handle = TOKIO_RT.spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        {
            let mut state = SHARE_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.ngrok_url = Some("https://unit.ngrok.test".to_string());
            state.ngrok_task = Some(handle);
        }

        stop_ngrok_tunnel().await.expect("stop ngrok");

        let state = SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(state.ngrok_url.is_none());
        assert!(state.ngrok_task.is_none());
    }

    #[serial]
    #[test]
    fn stop_sharing_rejects_inactive_state() {
        let _serial = lock_test_mutex();
        let _state = ShareStateGuard::inactive();

        assert_eq!(
            stop_sharing_internal(),
            Err("Not currently sharing".to_string())
        );
    }

    #[serial]
    #[tokio::test]
    async fn stop_sharing_command_wrapper_returns_same_inactive_error() {
        let _serial = lock_test_mutex();
        let _state = ShareStateGuard::inactive();

        assert_eq!(
            stop_sharing().await,
            Err("Not currently sharing".to_string())
        );
    }

    #[serial]
    #[test]
    fn stop_sharing_resets_state_and_clears_sessions_and_clients() {
        let _serial = lock_test_mutex();
        let _state = ShareStateGuard::active("/tmp/workspace".to_string(), 51236);
        let _clients = ClientStateGuard::empty();
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert("session-1".to_string());
        CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                "session-1".to_string(),
                ConnectedClient {
                    session_id: "session-1".to_string(),
                    ip: "203.0.113.10".to_string(),
                    user_agent: "unit-test".to_string(),
                    authenticated_at: "2026-06-11T00:00:00Z".to_string(),
                    last_active: "2026-06-11T00:01:00Z".to_string(),
                    ws_connected: false,
                },
            );

        stop_sharing_internal().expect("stop sharing");

        let state = SHARE_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert!(!state.active);
        assert_eq!(state.workspace_path, None);
        assert_eq!(state.port, 0);
        assert!(state.auth_key.is_none());
        assert!(state.auth_salt.is_none());
        drop(state);
        assert!(AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
        assert!(CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
    }

    #[serial]
    #[test]
    fn save_last_share_credentials_without_port_preserves_existing_port() {
        let _serial = lock_test_mutex();
        let _home = TempHomeGuard::new();
        let initial = crate::GlobalConfig {
            last_share_port: Some(50123),
            share_password: Some("old-secret".to_string()),
            ..crate::GlobalConfig::default()
        };
        save_global_config_internal(&initial).expect("write initial config");

        save_last_share_credentials(None, "new-secret").expect("persist password only");
        clear_global_config_cache();
        let config = load_global_config();

        assert_eq!(config.last_share_port, Some(50123));
        assert_eq!(config.share_password, Some("new-secret".to_string()));
    }

    #[serial]
    #[test]
    fn get_connected_clients_returns_current_client_snapshot() {
        let _serial = lock_test_mutex();
        let _clients = ClientStateGuard::empty();
        let client = ConnectedClient {
            session_id: "session-1".to_string(),
            ip: "192.0.2.10".to_string(),
            user_agent: "unit-test".to_string(),
            authenticated_at: "2026-06-11T00:00:00Z".to_string(),
            last_active: "2026-06-11T00:01:00Z".to_string(),
            ws_connected: true,
        };
        CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(client.session_id.clone(), client.clone());

        let clients = get_connected_clients();

        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].session_id, client.session_id);
        assert_eq!(clients[0].ip, client.ip);
        assert!(clients[0].ws_connected);
    }

    #[serial]
    #[test]
    fn kick_client_internal_removes_session_and_client_records() {
        let _serial = lock_test_mutex();
        let _clients = ClientStateGuard::empty();
        let mut notifications = CLIENT_NOTIFICATION_BROADCAST.subscribe();
        AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert("session-1".to_string());
        CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(
                "session-1".to_string(),
                ConnectedClient {
                    session_id: "session-1".to_string(),
                    ip: "192.0.2.10".to_string(),
                    user_agent: "unit-test".to_string(),
                    authenticated_at: "2026-06-11T00:00:00Z".to_string(),
                    last_active: "2026-06-11T00:01:00Z".to_string(),
                    ws_connected: true,
                },
            );

        kick_client_internal("session-1").expect("kick client");

        let notification = notifications.try_recv().expect("kick notification");
        let notification: Value = serde_json::from_str(&notification).unwrap();
        assert_eq!(notification["session_id"], "session-1");
        assert_eq!(notification["type"], "kicked");
        assert_eq!(notification["reason"], "您已被管理员踢出");
        assert!(!AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains("session-1"));
        assert!(!CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains_key("session-1"));
    }

    #[serial]
    #[test]
    fn kick_client_command_wrapper_succeeds_for_missing_client_and_broadcasts() {
        let _serial = lock_test_mutex();
        let _clients = ClientStateGuard::empty();
        let mut notifications = CLIENT_NOTIFICATION_BROADCAST.subscribe();

        kick_client("missing-session".to_string()).expect("kick missing client");

        let notification = notifications.try_recv().expect("kick notification");
        let notification: Value = serde_json::from_str(&notification).unwrap();
        assert_eq!(notification["session_id"], "missing-session");
        assert!(AUTHENTICATED_SESSIONS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
        assert!(CONNECTED_CLIENTS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_empty());
    }
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
