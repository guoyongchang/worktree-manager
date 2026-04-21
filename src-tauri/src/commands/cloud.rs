use once_cell::sync::Lazy;
use std::sync::Mutex;

use crate::config::{load_global_config, save_global_config_internal};

// ==================== Pairing State ====================

struct PairingState {
    code: String,
    device_secret: String,
    server_url: String,
}

static PAIRING_STATE: Lazy<Mutex<Option<PairingState>>> = Lazy::new(|| Mutex::new(None));

// ==================== Return Types ====================

#[derive(serde::Serialize)]
pub struct CloudStatus {
    pub connected: bool,
    pub pairing: bool,
    pub server_url: Option<String>,
    pub user_email: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct DeviceCodeResponse {
    code: String,
    device_secret: String,
    expires_in: Option<u64>,
    poll_interval: Option<u64>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct DeviceCodeStatusResponse {
    status: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
    user_email: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct ApproveResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    user_email: Option<String>,
}

// ==================== Commands ====================

/// Returns current cloud connection status.
#[tauri::command]
pub(crate) async fn cloud_get_status() -> Result<CloudStatus, String> {
    let config = load_global_config();
    let pairing = {
        let state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        state.is_some()
    };
    Ok(CloudStatus {
        connected: config.cloud.access_token.as_ref().map(|t| !t.is_empty()).unwrap_or(false),
        pairing,
        server_url: config.cloud.server_url,
        user_email: None,
    })
}

/// Initiates device-code pairing flow.
/// POSTs to `{server_url}/api/device-codes`, stores server_url + device_name in config,
/// and stores the returned code + secret in PAIRING_STATE.
#[tauri::command]
pub(crate) async fn cloud_start_pairing(
    server_url: String,
    device_name: String,
) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("{}/api/device-codes", server_url.trim_end_matches('/')))
        .json(&serde_json::json!({ "device_name": device_name }))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("服务器返回错误 {}: {}", status, text));
    }

    let data: DeviceCodeResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // Store server_url + device_name in config
    {
        let mut config = load_global_config();
        config.cloud.server_url = Some(server_url.clone());
        config.cloud.device_name = Some(device_name);
        // Clear any existing tokens on new pairing
        config.cloud.access_token = None;
        config.cloud.refresh_token = None;
        save_global_config_internal(&config)?;
    }

    // Store pairing state
    {
        let mut state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        *state = Some(PairingState {
            code: data.code.clone(),
            device_secret: data.device_secret.clone(),
            server_url,
        });
    }

    Ok(data)
}

/// Polls the device-code status endpoint to check if the code has been approved.
#[tauri::command]
pub(crate) async fn cloud_check_pairing_status() -> Result<DeviceCodeStatusResponse, String> {
    let (code, device_secret, server_url) = {
        let state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        let s = state
            .as_ref()
            .ok_or_else(|| "没有进行中的配对流程".to_string())?;
        (s.code.clone(), s.device_secret.clone(), s.server_url.clone())
    };

    let client = reqwest::Client::new();

    let resp = client
        .post(format!(
            "{}/api/device-codes/status",
            server_url.trim_end_matches('/')
        ))
        .json(&serde_json::json!({
            "code": code,
            "device_secret": device_secret,
        }))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("服务器返回错误 {}: {}", status, text));
    }

    let data: DeviceCodeStatusResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // If approved, store the tokens
    if data.status == "approved" {
        if let (Some(access_token), Some(refresh_token)) =
            (data.access_token.clone(), data.refresh_token.clone())
        {
            let mut config = load_global_config();
            config.cloud.access_token = Some(access_token);
            config.cloud.refresh_token = Some(refresh_token);
            save_global_config_internal(&config)?;
        }
        // Clear pairing state
        let mut state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        *state = None;
    }

    Ok(data)
}

/// Approves the pairing on this device (admin flow).
/// POSTs to `{server_url}/api/device-codes/{code}/approve` and stores received tokens.
#[tauri::command]
pub(crate) async fn cloud_approve_pairing() -> Result<ApproveResponse, String> {
    let (code, server_url) = {
        let state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        let s = state
            .as_ref()
            .ok_or_else(|| "没有进行中的配对流程".to_string())?;
        (s.code.clone(), s.server_url.clone())
    };

    let client = reqwest::Client::new();

    let resp = client
        .post(format!(
            "{}/api/device-codes/{}/approve",
            server_url.trim_end_matches('/'),
            code
        ))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("服务器返回错误 {}: {}", status, text));
    }

    let data: ApproveResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // Store tokens in config
    {
        let mut config = load_global_config();
        if let Some(ref token) = data.access_token {
            config.cloud.access_token = Some(token.clone());
        }
        if let Some(ref token) = data.refresh_token {
            config.cloud.refresh_token = Some(token.clone());
        }
        save_global_config_internal(&config)?;
    }

    // Clear pairing state
    {
        let mut state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        *state = None;
    }

    Ok(data)
}

/// Rejects the pairing for this device code and clears PAIRING_STATE.
#[tauri::command]
pub(crate) async fn cloud_reject_pairing() -> Result<(), String> {
    let (code, server_url) = {
        let state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        let s = state
            .as_ref()
            .ok_or_else(|| "没有进行中的配对流程".to_string())?;
        (s.code.clone(), s.server_url.clone())
    };

    let client = reqwest::Client::new();

    let resp = client
        .post(format!(
            "{}/api/device-codes/{}/reject",
            server_url.trim_end_matches('/'),
            code
        ))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("服务器返回错误 {}: {}", status, text));
    }

    // Clear pairing state regardless
    {
        let mut state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        *state = None;
    }

    Ok(())
}

/// Disconnects from cloud by clearing tokens from config.
#[tauri::command]
pub(crate) async fn cloud_disconnect() -> Result<(), String> {
    let mut config = load_global_config();
    config.cloud.access_token = None;
    config.cloud.refresh_token = None;
    save_global_config_internal(&config)?;

    // Also clear any in-progress pairing
    {
        let mut state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        *state = None;
    }

    Ok(())
}
