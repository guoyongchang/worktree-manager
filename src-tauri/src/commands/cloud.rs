use once_cell::sync::Lazy;
use std::sync::Mutex;

use crate::config::{load_global_config, save_global_config_internal};

const DEFAULT_WMS_URL: &str = "https://wms.kirov-opensource.com/";

fn get_default_device_name() -> String {
    if let Ok(output) = std::process::Command::new("hostname").output() {
        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    "Worktree Manager".to_string()
}

// ==================== JWT helpers ====================

/// Decode the JWT payload (middle base64 part) without signature verification
/// to extract exp and sub claims. Returns (exp_iso8601, sub).
fn decode_jwt_claims(token: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = token.splitn(3, '.').collect();
    if parts.len() < 2 {
        return None;
    }
    use base64::Engine;
    let payload_b64 = parts[1];
    let padded = match payload_b64.len() % 4 {
        2 => format!("{}==", payload_b64),
        3 => format!("{}=", payload_b64),
        _ => payload_b64.to_string(),
    };
    let decoded = base64::engine::general_purpose::URL_SAFE
        .decode(&padded)
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    let exp = claims["exp"].as_u64()?;
    let sub = claims["sub"].as_str().unwrap_or("").to_string();
    let exp_dt = chrono::DateTime::<chrono::Utc>::from_timestamp(exp as i64, 0)?;
    Some((exp_dt.to_rfc3339(), sub))
}

#[derive(serde::Deserialize, Debug)]
struct MeResponse {
    email: Option<String>,
    username: Option<String>,
}

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
    pub username: Option<String>,
    pub token_expires_at: Option<String>, // ISO 8601
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct DeviceCodeResponse {
    pub code: String,
    pub device_secret: String,
    pub expires_in: Option<u64>,
    pub poll_interval: Option<u64>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct DeviceCodeStatusResponse {
    pub status: String,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub user_email: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct ApproveResponse {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub user_email: Option<String>,
}

// ==================== Commands ====================

/// Returns current cloud connection status.
/// If connected, decodes JWT for expiry and fetches /api/me for user info.
#[tauri::command]
pub(crate) async fn cloud_get_status() -> Result<CloudStatus, String> {
    let config = load_global_config();
    let pairing = {
        let state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        state.is_some()
    };

    let access_token = config
        .cloud
        .access_token
        .as_ref()
        .filter(|t| !t.is_empty())
        .cloned();
    let connected = access_token.is_some();

    if !connected {
        return Ok(CloudStatus {
            connected: false,
            pairing,
            server_url: config.cloud.server_url,
            user_email: None,
            username: None,
            token_expires_at: None,
        });
    }

    let token = access_token.unwrap();
    let server_url = config.cloud.server_url.clone();

    // Decode JWT locally to get expiry
    let token_expires_at = decode_jwt_claims(&token).map(|(exp, _)| exp);

    // Fetch /api/me for user info
    let (user_email, username) = if let Some(ref url) = server_url {
        let client = reqwest::Client::new();
        match client
            .get(format!("{}/api/me", url.trim_end_matches('/')))
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => match resp.json::<MeResponse>().await {
                Ok(me) => (me.email, me.username),
                Err(_) => (None, None),
            },
            _ => (None, None),
        }
    } else {
        (None, None)
    };

    Ok(CloudStatus {
        connected,
        pairing,
        server_url,
        user_email,
        username,
        token_expires_at,
    })
}

/// Initiates device-code pairing flow.
/// POSTs to `{server_url}/api/device-codes`, stores server_url + device_name in config,
/// and stores the returned code + secret in PAIRING_STATE.
#[tauri::command]
pub(crate) async fn cloud_start_pairing() -> Result<DeviceCodeResponse, String> {
    let server_url = DEFAULT_WMS_URL.to_string();
    let device_name = get_default_device_name();
    let client = reqwest::Client::new();

    let resp = client
        .post(format!(
            "{}/api/device-codes",
            server_url.trim_end_matches('/')
        ))
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
        (
            s.code.clone(),
            s.device_secret.clone(),
            s.server_url.clone(),
        )
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
    let (code, device_secret, server_url) = {
        let state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        let s = state
            .as_ref()
            .ok_or_else(|| "没有进行中的配对流程".to_string())?;
        (
            s.code.clone(),
            s.device_secret.clone(),
            s.server_url.clone(),
        )
    };

    let client = reqwest::Client::new();

    let resp = client
        .post(format!(
            "{}/api/device-codes/{}/approve",
            server_url.trim_end_matches('/'),
            code
        ))
        .json(&serde_json::json!({ "device_secret": device_secret }))
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
    let (code, device_secret, server_url) = {
        let state = PAIRING_STATE.lock().map_err(|e| e.to_string())?;
        let s = state
            .as_ref()
            .ok_or_else(|| "没有进行中的配对流程".to_string())?;
        (
            s.code.clone(),
            s.device_secret.clone(),
            s.server_url.clone(),
        )
    };

    let client = reqwest::Client::new();

    let resp = client
        .post(format!(
            "{}/api/device-codes/{}/reject",
            server_url.trim_end_matches('/'),
            code
        ))
        .json(&serde_json::json!({ "device_secret": device_secret }))
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

#[cfg(test)]
pub(crate) fn clear_pairing_state_for_test() {
    let mut state = PAIRING_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *state = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use once_cell::sync::Lazy;
    use serde_json::json;
    use serial_test::serial;
    use std::sync::{Mutex, MutexGuard};

    static PAIRING_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock_pairing_state() -> MutexGuard<'static, ()> {
        PAIRING_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    struct PairingStateGuard {
        previous: Option<PairingState>,
    }

    impl PairingStateGuard {
        fn isolated() -> Self {
            let previous = {
                let mut state = PAIRING_STATE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state.take()
            };
            Self { previous }
        }

        fn set_pending(&self, code: &str, device_secret: &str, server_url: &str) {
            let mut state = PAIRING_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *state = Some(PairingState {
                code: code.to_string(),
                device_secret: device_secret.to_string(),
                server_url: server_url.to_string(),
            });
        }
    }

    impl Drop for PairingStateGuard {
        fn drop(&mut self) {
            let mut state = PAIRING_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *state = self.previous.take();
        }
    }

    fn token_with_claims(claims: serde_json::Value) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).unwrap());
        format!("header.{}.signature", payload)
    }

    fn token_with_payload_mod(target_mod: usize) -> String {
        for pad_len in 0..32 {
            let token = token_with_claims(json!({
                "exp": 4_102_444_800u64,
                "sub": "user-123",
                "pad": "x".repeat(pad_len),
            }));
            let payload = token.split('.').nth(1).unwrap();
            if payload.len() % 4 == target_mod {
                return token;
            }
        }
        panic!("could not construct JWT payload with len % 4 == {target_mod}");
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_accepts_unpadded_payload_variants() {
        for target_mod in [0usize, 2, 3] {
            let token = token_with_payload_mod(target_mod);
            let payload = token.split('.').nth(1).unwrap();
            assert_eq!(payload.len() % 4, target_mod);

            let (expires_at, sub) = decode_jwt_claims(&token).unwrap();

            assert_eq!(expires_at, "2100-01-01T00:00:00+00:00");
            assert_eq!(sub, "user-123");
        }
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_returns_past_and_future_expirations() {
        let expired = token_with_claims(json!({ "exp": 946_684_800u64, "sub": "old-user" }));
        let valid = token_with_claims(json!({ "exp": 4_102_444_800u64, "sub": "new-user" }));

        assert_eq!(
            decode_jwt_claims(&expired).unwrap(),
            (
                "2000-01-01T00:00:00+00:00".to_string(),
                "old-user".to_string()
            )
        );
        assert_eq!(
            decode_jwt_claims(&valid).unwrap(),
            (
                "2100-01-01T00:00:00+00:00".to_string(),
                "new-user".to_string()
            )
        );
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_rejects_malformed_tokens() {
        assert_eq!(decode_jwt_claims("not-a-jwt"), None);
        assert_eq!(decode_jwt_claims("header.%%%bad%%%.sig"), None);
        assert_eq!(
            decode_jwt_claims(&token_with_claims(json!({ "sub": "missing-exp" }))),
            None
        );
        assert_eq!(
            decode_jwt_claims(&token_with_claims(
                json!({ "exp": "not-a-number", "sub": "u" })
            )),
            None
        );
    }

    #[serial]
    #[test]
    fn cloud_response_types_round_trip_json() {
        let device_code = DeviceCodeResponse {
            code: "ABCD-EFGH".to_string(),
            device_secret: "secret".to_string(),
            expires_in: Some(600),
            poll_interval: Some(3),
        };
        let encoded = serde_json::to_string(&device_code).unwrap();
        let decoded: DeviceCodeResponse = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.code, "ABCD-EFGH");
        assert_eq!(decoded.device_secret, "secret");
        assert_eq!(decoded.expires_in, Some(600));
        assert_eq!(decoded.poll_interval, Some(3));

        let status: DeviceCodeStatusResponse = serde_json::from_value(json!({
            "status": "approved",
            "access_token": "access",
            "refresh_token": "refresh",
            "user_email": "user@example.com"
        }))
        .unwrap();
        assert_eq!(status.status, "approved");
        assert_eq!(status.access_token.as_deref(), Some("access"));
        assert_eq!(status.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(status.user_email.as_deref(), Some("user@example.com"));
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_ignores_signature_text_with_extra_dots() {
        let token = format!(
            "{}.signature.with.extra.parts",
            token_with_claims(json!({ "exp": 4_102_444_800u64, "sub": "dotted-user" }))
                .trim_end_matches(".signature")
        );

        let decoded = decode_jwt_claims(&token).expect("decode token with dotted signature");

        assert_eq!(
            decoded,
            (
                "2100-01-01T00:00:00+00:00".to_string(),
                "dotted-user".to_string()
            )
        );
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_rejects_non_json_payloads() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("not-json");
        let token = format!("header.{payload}.signature");

        assert_eq!(decode_jwt_claims(&token), None);
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_rejects_null_negative_and_fractional_exp_values() {
        assert_eq!(
            decode_jwt_claims(&token_with_claims(json!({ "exp": null, "sub": "u" }))),
            None
        );
        assert_eq!(
            decode_jwt_claims(&token_with_claims(json!({ "exp": -1, "sub": "u" }))),
            None
        );
        assert_eq!(
            decode_jwt_claims(&token_with_claims(json!({ "exp": 123.45, "sub": "u" }))),
            None
        );
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_uses_empty_subject_for_non_string_sub() {
        let token = token_with_claims(json!({ "exp": 4_102_444_800u64, "sub": 123 }));

        let decoded = decode_jwt_claims(&token).expect("decode numeric sub token");

        assert_eq!(decoded.0, "2100-01-01T00:00:00+00:00");
        assert_eq!(decoded.1, "");
    }

    #[serial]
    #[test]
    fn cloud_status_serializes_snake_case_fields_and_null_optionals() {
        let status = CloudStatus {
            connected: true,
            pairing: false,
            server_url: Some("https://cloud.example".to_string()),
            user_email: None,
            username: Some("tester".to_string()),
            token_expires_at: Some("2100-01-01T00:00:00+00:00".to_string()),
        };

        let value = serde_json::to_value(status).expect("serialize cloud status");

        assert_eq!(value["connected"], true);
        assert_eq!(value["pairing"], false);
        assert_eq!(value["server_url"], "https://cloud.example");
        assert_eq!(value["user_email"], serde_json::Value::Null);
        assert_eq!(value["username"], "tester");
        assert_eq!(value["token_expires_at"], "2100-01-01T00:00:00+00:00");
    }

    #[serial]
    #[test]
    fn approve_and_device_code_responses_deserialize_missing_optional_fields() {
        let approve: ApproveResponse =
            serde_json::from_value(json!({})).expect("approve response without tokens");
        assert_eq!(approve.access_token, None);
        assert_eq!(approve.refresh_token, None);
        assert_eq!(approve.user_email, None);

        let device_code: DeviceCodeResponse = serde_json::from_value(json!({
            "code": "PAIR-000",
            "device_secret": "secret"
        }))
        .expect("device code without optional timing");
        assert_eq!(device_code.code, "PAIR-000");
        assert_eq!(device_code.device_secret, "secret");
        assert_eq!(device_code.expires_in, None);
        assert_eq!(device_code.poll_interval, None);
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_accepts_two_segment_tokens_without_signature() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({ "exp": 4_102_444_800u64, "sub": "unsigned" })).unwrap(),
        );
        let token = format!("header.{payload}");

        let decoded = decode_jwt_claims(&token).expect("decode unsigned token shape");

        assert_eq!(
            decoded,
            (
                "2100-01-01T00:00:00+00:00".to_string(),
                "unsigned".to_string()
            )
        );
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_rejects_empty_payload_segment() {
        assert_eq!(decode_jwt_claims("header..signature"), None);
    }

    #[serial]
    #[test]
    fn device_code_response_requires_code_and_device_secret() {
        let missing_code: Result<DeviceCodeResponse, _> =
            serde_json::from_value(json!({ "device_secret": "secret" }));
        let missing_secret: Result<DeviceCodeResponse, _> =
            serde_json::from_value(json!({ "code": "PAIR-000" }));

        assert!(missing_code.is_err());
        assert!(missing_secret.is_err());
    }

    #[serial]
    #[test]
    fn default_device_name_returns_non_empty_trimmed_name() {
        let name = get_default_device_name();

        assert!(!name.is_empty());
        assert_eq!(name, name.trim());
    }

    #[serial]
    #[test]
    fn pairing_state_guard_restores_existing_pending_state() {
        let _lock = lock_pairing_state();
        {
            let mut state = PAIRING_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *state = Some(PairingState {
                code: "ORIGINAL".to_string(),
                device_secret: "original-secret".to_string(),
                server_url: "https://original.example".to_string(),
            });
        }

        {
            let guard = PairingStateGuard::isolated();
            assert!(PAIRING_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .is_none());
            guard.set_pending("TEMP", "temp-secret", "https://temp.example");
            let state = PAIRING_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let state = state.as_ref().expect("temporary pairing state");
            assert_eq!(state.code, "TEMP");
            assert_eq!(state.device_secret, "temp-secret");
            assert_eq!(state.server_url, "https://temp.example");
        }

        let restored = PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|state| {
                (
                    state.code.clone(),
                    state.device_secret.clone(),
                    state.server_url.clone(),
                )
            });
        assert_eq!(
            restored,
            Some((
                "ORIGINAL".to_string(),
                "original-secret".to_string(),
                "https://original.example".to_string()
            ))
        );

        *PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }

    #[serial]
    #[tokio::test]
    async fn pairing_commands_fail_before_network_without_pending_state() {
        let _lock = lock_pairing_state();
        let _guard = PairingStateGuard::isolated();

        assert_eq!(
            cloud_check_pairing_status().await.unwrap_err(),
            "没有进行中的配对流程"
        );
        assert_eq!(
            cloud_approve_pairing().await.unwrap_err(),
            "没有进行中的配对流程"
        );
        assert_eq!(
            cloud_reject_pairing().await.unwrap_err(),
            "没有进行中的配对流程"
        );
    }

    #[serial]
    #[tokio::test]
    async fn reject_pairing_preserves_pending_state_when_request_cannot_be_built() {
        let _lock = lock_pairing_state();
        let _guard = PairingStateGuard::isolated();
        _guard.set_pending("PAIR-123", "device-secret", "://bad-url");

        let err = cloud_reject_pairing().await.unwrap_err();

        assert!(err.starts_with("请求失败:"));
        let state = PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|state| {
                (
                    state.code.clone(),
                    state.device_secret.clone(),
                    state.server_url.clone(),
                )
            });
        assert_eq!(
            state,
            Some((
                "PAIR-123".to_string(),
                "device-secret".to_string(),
                "://bad-url".to_string()
            ))
        );
    }

    // Posting the reject/approve/status request body is not covered with a live server:
    // this sandbox denies binding even 127.0.0.1:0, and external APIs would be flaky.
}

#[cfg(test)]
mod coverage_completion_tests {
    use super::*;
    #[cfg(any())]
    use axum::{
        extract::{Path as AxumPath, State},
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::{get, post},
        Json, Router,
    };
    use base64::Engine;
    use once_cell::sync::Lazy;
    use serde_json::json;
    use serial_test::serial;
    #[cfg(any())]
    use std::collections::VecDeque;
    use std::path::{Path, PathBuf};
    #[cfg(any())]
    use std::sync::Arc;
    use std::sync::{Mutex, MutexGuard};
    #[cfg(any())]
    use tokio::net::TcpListener;

    static CLOUD_EXTRA_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    struct GlobalConfigGuard {
        _command_lock: TestFileLock,
        _config_lock: TestFileLock,
        previous_config: Option<crate::types::GlobalConfig>,
        previous_home: Option<String>,
        #[cfg(target_os = "windows")]
        previous_appdata: Option<String>,
        #[cfg(target_os = "windows")]
        previous_userprofile: Option<String>,
        _temp_home: tempfile::TempDir,
    }

    impl GlobalConfigGuard {
        fn with_config(config: crate::types::GlobalConfig) -> Self {
            let command_lock = TestFileLock::acquire("worktree-manager-command-test-global-lock");
            let config_lock = TestFileLock::acquire("worktree-manager-global-config-cache.lock");
            let temp_home = tempfile::tempdir().expect("create temp cloud config home");
            let previous_home = std::env::var("HOME").ok();
            #[cfg(target_os = "windows")]
            let previous_appdata = std::env::var("APPDATA").ok();
            #[cfg(target_os = "windows")]
            let previous_userprofile = std::env::var("USERPROFILE").ok();
            set_config_root(temp_home.path());
            let previous_config = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };

            Self {
                _command_lock: command_lock,
                _config_lock: config_lock,
                previous_config,
                previous_home,
                #[cfg(target_os = "windows")]
                previous_appdata,
                #[cfg(target_os = "windows")]
                previous_userprofile,
                _temp_home: temp_home,
            }
        }
    }

    struct TestFileLock {
        path: PathBuf,
    }

    impl TestFileLock {
        fn acquire(name: &str) -> Self {
            let path = std::env::temp_dir().join(name);
            loop {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(err) => panic!("failed to acquire cloud test lock {:?}: {}", path, err),
                }
            }
        }
    }

    impl Drop for TestFileLock {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    impl Drop for GlobalConfigGuard {
        fn drop(&mut self) {
            let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous_config.take();
            restore_env_var("HOME", &self.previous_home);
            #[cfg(target_os = "windows")]
            {
                restore_env_var("APPDATA", &self.previous_appdata);
                restore_env_var("USERPROFILE", &self.previous_userprofile);
            }
        }
    }

    fn lock_cloud_tests() -> MutexGuard<'static, ()> {
        CLOUD_EXTRA_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set_config_root(path: &Path) {
        #[cfg(target_os = "windows")]
        {
            std::env::set_var("APPDATA", path);
            std::env::remove_var("USERPROFILE");
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::env::set_var("HOME", path);
        }
    }

    fn restore_env_var(key: &str, value: &Option<String>) {
        match value {
            Some(previous) => std::env::set_var(key, previous),
            None => std::env::remove_var(key),
        }
    }

    fn token_with_claims(claims: serde_json::Value) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).expect("serialize claims"));
        format!("header.{}.signature", payload)
    }

    struct PairingStateGuard {
        previous: Option<PairingState>,
    }

    impl PairingStateGuard {
        fn isolated() -> Self {
            let previous = {
                let mut state = PAIRING_STATE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state.take()
            };
            Self { previous }
        }

        fn set_pending(&self, code: &str, device_secret: &str, server_url: &str) {
            let mut state = PAIRING_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *state = Some(PairingState {
                code: code.to_string(),
                device_secret: device_secret.to_string(),
                server_url: server_url.to_string(),
            });
        }
    }

    impl Drop for PairingStateGuard {
        fn drop(&mut self) {
            let mut state = PAIRING_STATE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *state = self.previous.take();
        }
    }

    // Local mock-server coverage is intentionally compiled out in this sandbox:
    // binding 127.0.0.1:0 returns PermissionDenied, while the real cloud endpoint is external.
    #[cfg(any())]
    #[derive(Clone)]
    struct MockResponse {
        status: StatusCode,
        body: &'static str,
    }

    #[cfg(any())]
    #[derive(Default)]
    struct MockCloudCommandState {
        me_responses: VecDeque<MockResponse>,
        status_responses: VecDeque<MockResponse>,
        approve_responses: VecDeque<MockResponse>,
        reject_responses: VecDeque<MockResponse>,
        authorizations: Vec<String>,
        request_paths: Vec<String>,
        request_bodies: Vec<serde_json::Value>,
    }

    #[cfg(any())]
    fn header_string(headers: &HeaderMap, name: &str) -> String {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    }

    #[cfg(any())]
    async fn spawn_cloud_command_server(state: Arc<Mutex<MockCloudCommandState>>) -> String {
        let app = Router::new()
            .route(
                "/api/me",
                get(
                    |headers: HeaderMap,
                     State(state): State<Arc<Mutex<MockCloudCommandState>>>| async move {
                        let response = {
                            let mut state = state
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            state
                                .authorizations
                                .push(header_string(&headers, "authorization"));
                            state.me_responses.pop_front().expect("queued me response")
                        };
                        Response::from((response.status, response.body).into_response())
                    },
                ),
            )
            .route(
                "/api/device-codes/status",
                post(
                    |State(state): State<Arc<Mutex<MockCloudCommandState>>>,
                     Json(body): Json<serde_json::Value>| async move {
                        let response = {
                            let mut state = state
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            state.request_paths.push("/api/device-codes/status".to_string());
                            state.request_bodies.push(body);
                            state
                                .status_responses
                                .pop_front()
                                .expect("queued status response")
                        };
                        Response::from((response.status, response.body).into_response())
                    },
                ),
            )
            .route(
                "/api/device-codes/{code}/approve",
                post(
                    |AxumPath(code): AxumPath<String>,
                     State(state): State<Arc<Mutex<MockCloudCommandState>>>,
                     Json(body): Json<serde_json::Value>| async move {
                        let response = {
                            let mut state = state
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            state
                                .request_paths
                                .push(format!("/api/device-codes/{code}/approve"));
                            state.request_bodies.push(body);
                            state
                                .approve_responses
                                .pop_front()
                                .expect("queued approve response")
                        };
                        Response::from((response.status, response.body).into_response())
                    },
                ),
            )
            .route(
                "/api/device-codes/{code}/reject",
                post(
                    |AxumPath(code): AxumPath<String>,
                     State(state): State<Arc<Mutex<MockCloudCommandState>>>,
                     Json(body): Json<serde_json::Value>| async move {
                        let response = {
                            let mut state = state
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            state
                                .request_paths
                                .push(format!("/api/device-codes/{code}/reject"));
                            state.request_bodies.push(body);
                            state
                                .reject_responses
                                .pop_front()
                                .expect("queued reject response")
                        };
                        Response::from((response.status, response.body).into_response())
                    },
                ),
            )
            .with_state(state);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind cloud command mock server");
        let addr = listener.local_addr().expect("cloud command mock addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{}", addr)
    }

    fn cloud_config(
        server_url: Option<&str>,
        access_token: Option<&str>,
        refresh_token: Option<&str>,
    ) -> crate::types::GlobalConfig {
        let mut config = crate::types::GlobalConfig::default();
        config.cloud.server_url = server_url.map(ToOwned::to_owned);
        config.cloud.access_token = access_token.map(ToOwned::to_owned);
        config.cloud.refresh_token = refresh_token.map(ToOwned::to_owned);
        config
    }

    #[serial]
    #[test]
    fn decode_jwt_claims_handles_mod_one_payload_and_missing_sub() {
        assert_eq!(decode_jwt_claims("header.a.signature"), None);

        let token = token_with_claims(json!({ "exp": 4_102_444_800u64 }));

        assert_eq!(
            decode_jwt_claims(&token),
            Some(("2100-01-01T00:00:00+00:00".to_string(), String::new()))
        );
    }

    #[serial]
    #[tokio::test]
    async fn cloud_get_status_reports_disconnected_and_connected_token_states() {
        let _lock = lock_cloud_tests();

        let _config =
            GlobalConfigGuard::with_config(cloud_config(Some("https://cloud.example"), None, None));
        let disconnected = cloud_get_status().await.expect("status without token");
        assert!(!disconnected.connected);
        assert_eq!(
            disconnected.server_url.as_deref(),
            Some("https://cloud.example")
        );
        assert_eq!(disconnected.token_expires_at, None);
        drop(_config);

        let valid_token = token_with_claims(json!({ "exp": 4_102_444_800u64, "sub": "user-123" }));
        let _config = GlobalConfigGuard::with_config(cloud_config(None, Some(&valid_token), None));
        let connected = cloud_get_status().await.expect("connected status");
        assert!(connected.connected);
        assert_eq!(
            connected.token_expires_at.as_deref(),
            Some("2100-01-01T00:00:00+00:00")
        );
        assert_eq!(connected.user_email, None);
        drop(_config);

        let _config = GlobalConfigGuard::with_config(cloud_config(None, Some("not.jwt"), None));
        let malformed = cloud_get_status()
            .await
            .expect("connected malformed token status");
        assert!(malformed.connected);
        assert_eq!(malformed.token_expires_at, None);
    }

    #[serial]
    #[test]
    fn device_code_status_json_covers_terminal_states() {
        for status in ["pending", "approved", "rejected", "expired"] {
            let value = json!({
                "status": status,
                "access_token": if status == "approved" { Some("access") } else { None },
                "refresh_token": if status == "approved" { Some("refresh") } else { None },
                "user_email": if status == "approved" { Some("user@example.com") } else { None },
            });

            let decoded: DeviceCodeStatusResponse =
                serde_json::from_value(value).expect("parse device-code status");

            assert_eq!(decoded.status, status);
            if status == "approved" {
                assert_eq!(decoded.access_token.as_deref(), Some("access"));
                assert_eq!(decoded.refresh_token.as_deref(), Some("refresh"));
                assert_eq!(decoded.user_email.as_deref(), Some("user@example.com"));
            } else {
                assert_eq!(decoded.access_token, None);
                assert_eq!(decoded.refresh_token, None);
                assert_eq!(decoded.user_email, None);
            }
        }
    }

    #[serial]
    #[test]
    fn jwt_claim_matrix_covers_padding_subject_and_expiry_variants() {
        let valid_cases = [
            (
                json!({ "exp": 0u64, "sub": "epoch-user" }),
                "1970-01-01T00:00:00+00:00",
                "epoch-user",
            ),
            (
                json!({ "exp": 946_684_800u64, "sub": "y2k-user" }),
                "2000-01-01T00:00:00+00:00",
                "y2k-user",
            ),
            (
                json!({ "exp": 1_577_836_800u64, "sub": "twenty-twenty" }),
                "2020-01-01T00:00:00+00:00",
                "twenty-twenty",
            ),
            (
                json!({ "exp": 1_735_689_600u64, "sub": "twenty-twenty-five" }),
                "2025-01-01T00:00:00+00:00",
                "twenty-twenty-five",
            ),
            (
                json!({ "exp": 4_102_444_800u64, "sub": "future-user" }),
                "2100-01-01T00:00:00+00:00",
                "future-user",
            ),
            (
                json!({ "exp": 4_102_444_800u64 }),
                "2100-01-01T00:00:00+00:00",
                "",
            ),
            (
                json!({ "exp": 4_102_444_800u64, "sub": null }),
                "2100-01-01T00:00:00+00:00",
                "",
            ),
            (
                json!({ "exp": 4_102_444_800u64, "sub": 12345 }),
                "2100-01-01T00:00:00+00:00",
                "",
            ),
            (
                json!({ "exp": 4_102_444_800u64, "sub": true }),
                "2100-01-01T00:00:00+00:00",
                "",
            ),
        ];

        for (claims, expected_exp, expected_sub) in valid_cases {
            let token = token_with_claims(claims);

            let decoded = decode_jwt_claims(&token).expect("valid claim set decodes");

            assert_eq!(decoded.0, expected_exp);
            assert_eq!(decoded.1, expected_sub);
        }

        let invalid_payloads = [
            "not-a-jwt",
            "header.",
            "header..signature",
            "header.%%%%.signature",
            "header.a.signature",
            "header.W10.signature",
            "header.e30.signature",
        ];

        for token in invalid_payloads {
            assert_eq!(decode_jwt_claims(token), None, "{token}");
        }

        let invalid_claims = [
            json!({}),
            json!({ "exp": null }),
            json!({ "exp": -1 }),
            json!({ "exp": 1.25 }),
            json!({ "exp": "4102444800" }),
            json!({ "exp": [], "sub": "array-exp" }),
            json!({ "exp": {}, "sub": "object-exp" }),
        ];

        for claims in invalid_claims {
            let token = token_with_claims(claims);

            assert_eq!(decode_jwt_claims(&token), None);
        }
    }

    #[serial]
    #[tokio::test]
    async fn pairing_commands_with_bad_urls_preserve_or_clear_state_as_expected() {
        let _lock = lock_cloud_tests();
        let pairing = PairingStateGuard::isolated();
        let _config = GlobalConfigGuard::with_config(cloud_config(
            Some("://bad-url"),
            Some("old-access"),
            Some("old-refresh"),
        ));

        pairing.set_pending("PAIR-STATUS", "secret-status", "://bad-url");
        let status_error = cloud_check_pairing_status()
            .await
            .expect_err("bad status url fails before network");
        assert!(status_error.starts_with("请求失败:"), "{status_error}");
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some());

        pairing.set_pending("PAIR-APPROVE", "secret-approve", "://bad-url");
        let approve_error = cloud_approve_pairing()
            .await
            .expect_err("bad approve url fails before network");
        assert!(approve_error.starts_with("请求失败:"), "{approve_error}");
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some());

        pairing.set_pending("PAIR-REJECT", "secret-reject", "://bad-url");
        let reject_error = cloud_reject_pairing()
            .await
            .expect_err("bad reject url fails before network");
        assert!(reject_error.starts_with("请求失败:"), "{reject_error}");
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some());

        cloud_disconnect()
            .await
            .expect("disconnect clears local cloud state");
        let config = crate::config::load_global_config();
        assert_eq!(config.cloud.access_token, None);
        assert_eq!(config.cloud.refresh_token, None);
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_none());
    }

    #[serial]
    #[test]
    fn response_type_matrix_deserializes_optional_cloud_fields() {
        let device_code_cases = [
            (
                json!({
                    "code": "PAIR-001",
                    "device_secret": "secret-001"
                }),
                "PAIR-001",
                "secret-001",
                None,
                None,
            ),
            (
                json!({
                    "code": "PAIR-002",
                    "device_secret": "secret-002",
                    "expires_in": 60
                }),
                "PAIR-002",
                "secret-002",
                Some(60),
                None,
            ),
            (
                json!({
                    "code": "PAIR-003",
                    "device_secret": "secret-003",
                    "poll_interval": 5
                }),
                "PAIR-003",
                "secret-003",
                None,
                Some(5),
            ),
            (
                json!({
                    "code": "PAIR-004",
                    "device_secret": "secret-004",
                    "expires_in": 600,
                    "poll_interval": 3
                }),
                "PAIR-004",
                "secret-004",
                Some(600),
                Some(3),
            ),
        ];

        for (value, code, secret, expires_in, poll_interval) in device_code_cases {
            let decoded: DeviceCodeResponse =
                serde_json::from_value(value).expect("device code response parses");

            assert_eq!(decoded.code, code);
            assert_eq!(decoded.device_secret, secret);
            assert_eq!(decoded.expires_in, expires_in);
            assert_eq!(decoded.poll_interval, poll_interval);
        }

        let approve_cases = [
            (json!({}), None, None, None),
            (
                json!({ "access_token": "access-only" }),
                Some("access-only"),
                None,
                None,
            ),
            (
                json!({ "refresh_token": "refresh-only" }),
                None,
                Some("refresh-only"),
                None,
            ),
            (
                json!({ "user_email": "user@example.com" }),
                None,
                None,
                Some("user@example.com"),
            ),
            (
                json!({
                    "access_token": "access-full",
                    "refresh_token": "refresh-full",
                    "user_email": "full@example.com"
                }),
                Some("access-full"),
                Some("refresh-full"),
                Some("full@example.com"),
            ),
        ];

        for (value, access, refresh, email) in approve_cases {
            let decoded: ApproveResponse =
                serde_json::from_value(value).expect("approve response parses");

            assert_eq!(decoded.access_token.as_deref(), access);
            assert_eq!(decoded.refresh_token.as_deref(), refresh);
            assert_eq!(decoded.user_email.as_deref(), email);
        }
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_get_status_fetches_user_info_and_tolerates_bad_me_responses() {
        let _lock = lock_cloud_tests();
        let _pairing = PairingStateGuard::isolated();
        let token = token_with_claims(json!({ "exp": 4_102_444_800u64, "sub": "user-123" }));
        let state = Arc::new(Mutex::new(MockCloudCommandState {
            me_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: r#"{"email":"user@example.com","username":"tester"}"#,
            }]),
            ..MockCloudCommandState::default()
        }));
        let server_url = spawn_cloud_command_server(state.clone()).await;
        let _config =
            GlobalConfigGuard::with_config(cloud_config(Some(&server_url), Some(&token), None));

        let status = cloud_get_status().await.expect("status with /api/me");

        assert!(status.connected);
        assert!(!status.pairing);
        assert_eq!(status.server_url.as_deref(), Some(server_url.as_str()));
        assert_eq!(status.user_email.as_deref(), Some("user@example.com"));
        assert_eq!(status.username.as_deref(), Some("tester"));
        assert_eq!(
            status.token_expires_at.as_deref(),
            Some("2100-01-01T00:00:00+00:00")
        );
        assert_eq!(
            state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .authorizations,
            vec![format!("Bearer {token}")]
        );
        drop(_config);

        let bad_state = Arc::new(Mutex::new(MockCloudCommandState {
            me_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: "not-json",
            }]),
            ..MockCloudCommandState::default()
        }));
        let bad_server_url = spawn_cloud_command_server(bad_state).await;
        let _config =
            GlobalConfigGuard::with_config(cloud_config(Some(&bad_server_url), Some(&token), None));

        let bad_status = cloud_get_status()
            .await
            .expect("status ignores malformed me");

        assert!(bad_status.connected);
        assert_eq!(bad_status.user_email, None);
        assert_eq!(bad_status.username, None);
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_check_pairing_status_approved_persists_tokens_and_clears_pairing() {
        let _lock = lock_cloud_tests();
        let pairing = PairingStateGuard::isolated();
        let state = Arc::new(Mutex::new(MockCloudCommandState {
            status_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: r#"{"status":"approved","access_token":"access-new","refresh_token":"refresh-new","user_email":"user@example.com"}"#,
            }]),
            ..MockCloudCommandState::default()
        }));
        let server_url = spawn_cloud_command_server(state.clone()).await;
        let _config = GlobalConfigGuard::with_config(cloud_config(Some(&server_url), None, None));
        pairing.set_pending("PAIR-1", "secret-1", &server_url);

        let response = cloud_check_pairing_status()
            .await
            .expect("approved pairing status");

        let config = crate::config::load_global_config();
        let state = state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(response.status, "approved");
        assert_eq!(response.access_token.as_deref(), Some("access-new"));
        assert_eq!(response.refresh_token.as_deref(), Some("refresh-new"));
        assert_eq!(config.cloud.access_token.as_deref(), Some("access-new"));
        assert_eq!(config.cloud.refresh_token.as_deref(), Some("refresh-new"));
        assert_eq!(state.request_paths, vec!["/api/device-codes/status"]);
        assert_eq!(state.request_bodies[0]["code"], "PAIR-1");
        assert_eq!(state.request_bodies[0]["device_secret"], "secret-1");
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_none());
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_check_pairing_status_reports_http_and_parse_errors_without_clearing_pairing() {
        let _lock = lock_cloud_tests();
        let pairing = PairingStateGuard::isolated();
        let state = Arc::new(Mutex::new(MockCloudCommandState {
            status_responses: VecDeque::from([MockResponse {
                status: StatusCode::BAD_REQUEST,
                body: "bad device code",
            }]),
            ..MockCloudCommandState::default()
        }));
        let server_url = spawn_cloud_command_server(state).await;
        let _config = GlobalConfigGuard::with_config(cloud_config(Some(&server_url), None, None));
        pairing.set_pending("PAIR-2", "secret-2", &server_url);

        let http_err = cloud_check_pairing_status().await.unwrap_err();

        assert!(http_err.contains("400 Bad Request"));
        assert!(http_err.contains("bad device code"));
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some());
        drop(_config);

        let malformed_state = Arc::new(Mutex::new(MockCloudCommandState {
            status_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: "not-json",
            }]),
            ..MockCloudCommandState::default()
        }));
        let malformed_server_url = spawn_cloud_command_server(malformed_state).await;
        let _config =
            GlobalConfigGuard::with_config(cloud_config(Some(&malformed_server_url), None, None));
        pairing.set_pending("PAIR-3", "secret-3", &malformed_server_url);

        let parse_err = cloud_check_pairing_status().await.unwrap_err();

        assert!(parse_err.starts_with("解析响应失败:"));
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some());
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_approve_pairing_stores_tokens_and_cloud_reject_clears_pairing() {
        let _lock = lock_cloud_tests();
        let pairing = PairingStateGuard::isolated();
        let state = Arc::new(Mutex::new(MockCloudCommandState {
            approve_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: r#"{"access_token":"approved-access","refresh_token":"approved-refresh","user_email":"approver@example.com"}"#,
            }]),
            reject_responses: VecDeque::from([MockResponse {
                status: StatusCode::NO_CONTENT,
                body: "",
            }]),
            ..MockCloudCommandState::default()
        }));
        let server_url = spawn_cloud_command_server(state.clone()).await;
        let _config = GlobalConfigGuard::with_config(cloud_config(Some(&server_url), None, None));
        pairing.set_pending("PAIR-4", "secret-4", &server_url);

        let approved = cloud_approve_pairing().await.expect("approve pairing");
        let config = crate::config::load_global_config();

        assert_eq!(approved.access_token.as_deref(), Some("approved-access"));
        assert_eq!(approved.refresh_token.as_deref(), Some("approved-refresh"));
        assert_eq!(approved.user_email.as_deref(), Some("approver@example.com"));
        assert_eq!(
            config.cloud.access_token.as_deref(),
            Some("approved-access")
        );
        assert_eq!(
            config.cloud.refresh_token.as_deref(),
            Some("approved-refresh")
        );
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_none());

        pairing.set_pending("PAIR-5", "secret-5", &server_url);
        cloud_reject_pairing().await.expect("reject pairing");

        let state = state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(
            state.request_paths,
            vec![
                "/api/device-codes/PAIR-4/approve".to_string(),
                "/api/device-codes/PAIR-5/reject".to_string()
            ]
        );
        assert_eq!(state.request_bodies[0]["device_secret"], "secret-4");
        assert_eq!(state.request_bodies[1]["device_secret"], "secret-5");
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_none());
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_reject_pairing_reports_server_error_and_disconnect_clears_tokens_and_pairing() {
        let _lock = lock_cloud_tests();
        let pairing = PairingStateGuard::isolated();
        let state = Arc::new(Mutex::new(MockCloudCommandState {
            reject_responses: VecDeque::from([MockResponse {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                body: "reject failed",
            }]),
            ..MockCloudCommandState::default()
        }));
        let server_url = spawn_cloud_command_server(state).await;
        let _config = GlobalConfigGuard::with_config(cloud_config(
            Some(&server_url),
            Some("access-old"),
            Some("refresh-old"),
        ));
        pairing.set_pending("PAIR-6", "secret-6", &server_url);

        let reject_err = cloud_reject_pairing().await.unwrap_err();

        assert!(reject_err.contains("500 Internal Server Error"));
        assert!(reject_err.contains("reject failed"));
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_some());

        cloud_disconnect().await.expect("disconnect clears tokens");
        let config = crate::config::load_global_config();

        assert_eq!(config.cloud.access_token, None);
        assert_eq!(config.cloud.refresh_token, None);
        assert!(PAIRING_STATE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .is_none());
    }
}
