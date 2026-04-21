use crate::config::{load_global_config, save_global_config_internal};
use reqwest::header;
use serde_json::Value;

#[derive(Debug)]
pub enum CloudError {
    NotConfigured,
    AuthExpired,
    Network(String),
    Http(u16, String),
}

impl CloudError {
    pub fn is_network_error(&self) -> bool {
        matches!(self, Self::Network(_))
    }
    pub fn is_auth_failed(&self) -> bool {
        matches!(self, Self::AuthExpired)
    }
}

impl std::fmt::Display for CloudError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotConfigured => write!(f, "cloud not configured"),
            Self::AuthExpired => write!(f, "cloud auth expired, please re-pair"),
            Self::Network(e) => write!(f, "network error: {}", e),
            Self::Http(code, msg) => write!(f, "HTTP {}: {}", code, msg),
        }
    }
}

pub fn is_cloud_configured() -> bool {
    let config = load_global_config();
    config.cloud.server_url.is_some() && config.cloud.access_token.is_some()
}

pub async fn cloud_ai_chat(
    messages: &Value,
    model: Option<&str>,
    stream: bool,
    purpose: &str,
    temperature: Option<f64>,
) -> Result<String, CloudError> {
    let config = load_global_config();
    let server_url = config
        .cloud
        .server_url
        .as_ref()
        .ok_or(CloudError::NotConfigured)?
        .clone();
    let access_token = config
        .cloud
        .access_token
        .as_ref()
        .ok_or(CloudError::NotConfigured)?
        .clone();

    let url = format!(
        "{}/api/ai/v1/chat/completions",
        server_url.trim_end_matches('/')
    );
    let client = reqwest::Client::new();

    let mut body = serde_json::json!({ "messages": messages, "stream": stream, "purpose": purpose });
    if let Some(m) = model {
        body["model"] = Value::String(m.to_string());
    }
    if let Some(t) = temperature {
        body["temperature"] = Value::from(t);
    }

    let resp = client
        .post(&url)
        .header(header::AUTHORIZATION, format!("Bearer {}", access_token))
        .header(header::CONTENT_TYPE, "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                CloudError::Network(e.to_string())
            } else {
                CloudError::Http(0, e.to_string())
            }
        })?;

    let status = resp.status().as_u16();
    if status == 401 {
        // Try refresh
        let refresh_token = config
            .cloud
            .refresh_token
            .as_ref()
            .ok_or(CloudError::AuthExpired)?
            .clone();
        match refresh_access_token(&server_url, &refresh_token).await {
            Ok(new_token) => {
                let mut config = load_global_config();
                config.cloud.access_token = Some(new_token.clone());
                let _ = save_global_config_internal(&config);
                // Retry with new token
                let resp2 = client
                    .post(&url)
                    .header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", new_token),
                    )
                    .header(header::CONTENT_TYPE, "application/json")
                    .json(&body)
                    .timeout(std::time::Duration::from_secs(60))
                    .send()
                    .await
                    .map_err(|e| CloudError::Network(e.to_string()))?;
                if !resp2.status().is_success() {
                    return Err(CloudError::Http(
                        resp2.status().as_u16(),
                        "retry failed".to_string(),
                    ));
                }
                resp2
                    .text()
                    .await
                    .map_err(|e| CloudError::Network(e.to_string()))
            }
            Err(_) => {
                let mut config = load_global_config();
                config.cloud.access_token = None;
                config.cloud.refresh_token = None;
                let _ = save_global_config_internal(&config);
                Err(CloudError::AuthExpired)
            }
        }
    } else if !resp.status().is_success() {
        Err(CloudError::Http(
            status,
            resp.text().await.unwrap_or_default(),
        ))
    } else {
        resp.text()
            .await
            .map_err(|e| CloudError::Network(e.to_string()))
    }
}

async fn refresh_access_token(
    server_url: &str,
    refresh_token: &str,
) -> Result<String, CloudError> {
    let url = format!("{}/api/auth/refresh", server_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "refresh_token": refresh_token }))
        .send()
        .await
        .map_err(|e| CloudError::Network(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(CloudError::AuthExpired);
    }
    #[derive(serde::Deserialize)]
    struct R {
        access_token: String,
    }
    let data: R = resp
        .json()
        .await
        .map_err(|e| CloudError::Network(e.to_string()))?;
    Ok(data.access_token)
}
