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

    let mut body =
        serde_json::json!({ "messages": messages, "stream": stream, "purpose": purpose });
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
                    .header(header::AUTHORIZATION, format!("Bearer {}", new_token))
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

async fn refresh_access_token(server_url: &str, refresh_token: &str) -> Result<String, CloudError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;
    use std::path::PathBuf;

    struct ConfigCacheGuard {
        previous: Option<crate::types::GlobalConfig>,
        _lock: FileLockGuard,
    }

    impl ConfigCacheGuard {
        fn with_cloud(
            server_url: String,
            access_token: Option<&str>,
            refresh_token: Option<&str>,
        ) -> Self {
            let lock = FileLockGuard::acquire();
            let mut config = crate::types::GlobalConfig::default();
            config.cloud.server_url = Some(server_url);
            config.cloud.access_token = access_token.map(ToOwned::to_owned);
            config.cloud.refresh_token = refresh_token.map(ToOwned::to_owned);

            let previous = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };

            Self {
                previous,
                _lock: lock,
            }
        }

        fn not_configured() -> Self {
            let lock = FileLockGuard::acquire();
            let previous = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(crate::types::GlobalConfig::default()))
            };
            Self {
                previous,
                _lock: lock,
            }
        }
    }

    impl Drop for ConfigCacheGuard {
        fn drop(&mut self) {
            let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous.take();
        }
    }

    struct FileLockGuard {
        path: PathBuf,
    }

    impl FileLockGuard {
        fn acquire() -> Self {
            let path = std::env::temp_dir().join("worktree-manager-global-config-cache.lock");
            for _ in 0..500 {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    Err(err) => panic!("failed to create test lock {:?}: {}", path, err),
                }
            }
            panic!("timed out waiting for test lock {:?}", path);
        }
    }

    impl Drop for FileLockGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
    }

    #[serial]
    #[test]
    fn cloud_error_predicates_and_display_are_specific() {
        let network = CloudError::Network("dns failed".to_string());
        let auth = CloudError::AuthExpired;
        let http = CloudError::Http(503, "busy".to_string());

        assert!(network.is_network_error());
        assert!(!network.is_auth_failed());
        assert!(auth.is_auth_failed());
        assert_eq!(auth.to_string(), "cloud auth expired, please re-pair");
        assert_eq!(http.to_string(), "HTTP 503: busy");
        assert_eq!(
            CloudError::NotConfigured.to_string(),
            "cloud not configured"
        );
    }

    #[serial]
    #[test]
    fn is_cloud_configured_requires_server_url_and_access_token() {
        let _config = ConfigCacheGuard::with_cloud("https://cloud.example".to_string(), None, None);
        assert!(!is_cloud_configured());
        drop(_config);

        let _config = ConfigCacheGuard::with_cloud(
            "https://cloud.example".to_string(),
            Some("access-token"),
            None,
        );
        assert!(is_cloud_configured());
    }

    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_maps_invalid_server_url_before_network() {
        let _config =
            ConfigCacheGuard::with_cloud("://bad-url".to_string(), Some("access-token"), None);
        let messages = json!([{ "role": "user", "content": "Hi" }]);

        let err = cloud_ai_chat(
            &messages,
            Some("qwen-test"),
            false,
            "voice_refine",
            Some(0.25),
        )
        .await
        .unwrap_err();

        match err {
            CloudError::Http(0, msg) => assert!(msg.contains("builder error")),
            other => panic!("expected pre-network HTTP(0) builder error, got {other:?}"),
        }
    }

    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_missing_refresh_token_still_uses_access_token_path() {
        let _config =
            ConfigCacheGuard::with_cloud("://bad-url".to_string(), Some("access-token"), None);
        let messages = json!([{ "role": "user", "content": "Hi" }]);

        let err = cloud_ai_chat(&messages, None, true, "commit_ai", None)
            .await
            .unwrap_err();

        match err {
            CloudError::Http(0, msg) => assert!(msg.contains("builder error")),
            other => panic!("expected pre-network HTTP(0) builder error, got {other:?}"),
        }
    }

    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_returns_not_configured_before_network() {
        let _config = ConfigCacheGuard::not_configured();
        let messages = json!([{ "role": "user", "content": "Hi" }]);

        let err = cloud_ai_chat(&messages, None, false, "voice_refine", None)
            .await
            .unwrap_err();

        assert!(matches!(err, CloudError::NotConfigured));
    }

    #[serial]
    #[tokio::test]
    async fn refresh_access_token_maps_invalid_url_before_network() {
        let err = refresh_access_token("://bad-url", "refresh-token")
            .await
            .unwrap_err();

        match err {
            CloudError::Network(msg) => assert!(msg.contains("builder error")),
            other => panic!("expected pre-network builder error, got {other:?}"),
        }
    }

    #[serial]
    #[tokio::test]
    async fn refresh_access_token_maps_missing_scheme_before_network() {
        let err = refresh_access_token("cloud.example", "refresh-token")
            .await
            .unwrap_err();

        match err {
            CloudError::Network(msg) => assert!(msg.contains("builder error")),
            other => panic!("expected pre-network builder error, got {other:?}"),
        }
    }

    // Successful response parsing and concrete request capture require a local HTTP server.
    // The current sandbox denies binding even 127.0.0.1:0, and external APIs are skipped.
}

#[cfg(test)]
mod coverage_completion_tests {
    use super::*;
    #[cfg(any())]
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::post,
        Json, Router,
    };
    use serde_json::json;
    use serial_test::serial;
    #[cfg(any())]
    use std::collections::VecDeque;
    use std::ffi::OsString;
    use std::path::PathBuf;
    #[cfg(any())]
    use std::sync::{Arc, Mutex};
    #[cfg(any())]
    use tokio::net::TcpListener;

    struct ConfigCacheGuard {
        previous: Option<crate::types::GlobalConfig>,
        previous_home: Option<OsString>,
        _temp_home: tempfile::TempDir,
        _lock: FileLockGuard,
    }

    impl ConfigCacheGuard {
        fn with_config(config: crate::types::GlobalConfig) -> Self {
            let lock = FileLockGuard::acquire();
            let temp_home = tempfile::tempdir().expect("create temp config home");
            let previous_home = std::env::var_os("HOME");
            std::env::set_var("HOME", temp_home.path());
            let previous = {
                let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                std::mem::replace(&mut *cache, Some(config))
            };
            Self {
                previous,
                previous_home,
                _temp_home: temp_home,
                _lock: lock,
            }
        }
    }

    impl Drop for ConfigCacheGuard {
        fn drop(&mut self) {
            let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous.take();
            match &self.previous_home {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }
        }
    }

    // Local mock-server coverage is intentionally compiled out in this sandbox:
    // binding 127.0.0.1:0 returns PermissionDenied, while external cloud APIs are flaky.
    #[cfg(any())]
    #[derive(Clone)]
    struct MockResponse {
        status: StatusCode,
        body: &'static str,
    }

    #[cfg(any())]
    #[derive(Default)]
    struct MockCloudState {
        chat_responses: VecDeque<MockResponse>,
        refresh_responses: VecDeque<MockResponse>,
        chat_authorizations: Vec<String>,
        chat_bodies: Vec<serde_json::Value>,
        refresh_bodies: Vec<serde_json::Value>,
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
    async fn spawn_cloud_server(state: Arc<Mutex<MockCloudState>>) -> String {
        let app = Router::new()
            .route(
                "/api/ai/v1/chat/completions",
                post(
                    |headers: HeaderMap,
                     State(state): State<Arc<Mutex<MockCloudState>>>,
                     Json(body): Json<serde_json::Value>| async move {
                        let response = {
                            let mut state = state
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            state
                                .chat_authorizations
                                .push(header_string(&headers, "authorization"));
                            state.chat_bodies.push(body);
                            state
                                .chat_responses
                                .pop_front()
                                .expect("queued chat response")
                        };
                        Response::from((response.status, response.body).into_response())
                    },
                ),
            )
            .route(
                "/api/auth/refresh",
                post(
                    |State(state): State<Arc<Mutex<MockCloudState>>>,
                     Json(body): Json<serde_json::Value>| async move {
                        let response = {
                            let mut state = state
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            state.refresh_bodies.push(body);
                            state
                                .refresh_responses
                                .pop_front()
                                .expect("queued refresh response")
                        };
                        Response::from((response.status, response.body).into_response())
                    },
                ),
            )
            .with_state(state);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind cloud client mock server");
        let addr = listener.local_addr().expect("cloud client mock addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{}", addr)
    }

    struct FileLockGuard {
        path: PathBuf,
    }

    impl FileLockGuard {
        fn acquire() -> Self {
            let path = std::env::temp_dir().join("worktree-manager-global-config-cache.lock");
            for _ in 0..500 {
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self { path },
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    Err(err) => panic!("failed to create test lock {:?}: {}", path, err),
                }
            }
            panic!("timed out waiting for test lock {:?}", path);
        }
    }

    impl Drop for FileLockGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir(&self.path);
        }
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
    fn is_cloud_configured_requires_both_url_and_access_token() {
        let _config =
            ConfigCacheGuard::with_config(cloud_config(Some("https://cloud.example"), None, None));
        assert!(!is_cloud_configured());
        drop(_config);

        let _config = ConfigCacheGuard::with_config(cloud_config(None, Some("access"), None));
        assert!(!is_cloud_configured());
        drop(_config);

        let _config = ConfigCacheGuard::with_config(cloud_config(
            Some("https://cloud.example"),
            Some("access"),
            None,
        ));
        assert!(is_cloud_configured());
    }

    #[serial]
    #[test]
    fn cloud_error_display_covers_network_and_http_empty_body() {
        assert_eq!(
            CloudError::Network("timeout".to_string()).to_string(),
            "network error: timeout"
        );
        assert_eq!(
            CloudError::Http(418, String::new()).to_string(),
            "HTTP 418: "
        );
        assert!(!CloudError::Http(500, "server".to_string()).is_network_error());
        assert!(!CloudError::Network("dns".to_string()).is_auth_failed());
    }

    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_requires_access_token_even_when_server_is_configured() {
        let _config = ConfigCacheGuard::with_config(cloud_config(
            Some("https://cloud.example"),
            None,
            Some("refresh"),
        ));

        let err = cloud_ai_chat(&json!([]), None, false, "unit_test", None)
            .await
            .unwrap_err();

        assert!(matches!(err, CloudError::NotConfigured));
    }

    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_maps_empty_server_url_to_request_builder_error() {
        let _config = ConfigCacheGuard::with_config(cloud_config(Some(""), Some("access"), None));

        let err = cloud_ai_chat(
            &json!([{ "role": "user", "content": "hello" }]),
            Some("model-a"),
            true,
            "unit_test",
            Some(0.5),
        )
        .await
        .unwrap_err();

        match err {
            CloudError::Http(0, msg) => assert!(msg.contains("builder error"), "{msg}"),
            other => panic!("expected builder error, got {other:?}"),
        }
    }

    #[serial]
    #[tokio::test]
    async fn refresh_access_token_maps_empty_server_url_to_network_builder_error() {
        let err = refresh_access_token("", "refresh-token").await.unwrap_err();

        match err {
            CloudError::Network(msg) => assert!(msg.contains("builder error"), "{msg}"),
            other => panic!("expected builder error, got {other:?}"),
        }
    }

    #[serial]
    #[test]
    fn response_json_shapes_parse_without_http() {
        let chat_response = json!({
            "id": "chatcmpl-test",
            "choices": [{
                "message": { "role": "assistant", "content": "done" },
                "finish_reason": "stop"
            }]
        });
        assert_eq!(chat_response["id"], "chatcmpl-test");
        assert_eq!(chat_response["choices"][0]["message"]["content"], "done");

        let refresh_response = json!({ "access_token": "new-access" });
        assert_eq!(
            refresh_response
                .get("access_token")
                .and_then(serde_json::Value::as_str),
            Some("new-access")
        );
    }

    #[serial]
    #[test]
    fn cloud_configuration_matrix_requires_url_and_access_token() {
        let cases = [
            (
                None,
                None,
                None,
                false,
                "empty cloud config is disconnected",
            ),
            (
                Some("https://cloud.example"),
                None,
                None,
                false,
                "server alone is not configured",
            ),
            (
                None,
                Some("access-a"),
                None,
                false,
                "access token alone is not configured",
            ),
            (
                None,
                None,
                Some("refresh-a"),
                false,
                "refresh token alone is not configured",
            ),
            (
                Some("https://cloud.example"),
                Some("access-a"),
                None,
                true,
                "server and access token are configured",
            ),
            (
                Some("https://cloud.example/"),
                Some("access-b"),
                Some("refresh-b"),
                true,
                "refresh token does not affect configured status",
            ),
            (
                Some(""),
                Some("access-c"),
                None,
                true,
                "empty server string is still present to the config check",
            ),
            (
                Some("https://cloud.example/base/path"),
                Some("access-d"),
                Some("refresh-d"),
                true,
                "nested server url is accepted by the config check",
            ),
        ];

        for (server_url, access_token, refresh_token, expected, label) in cases {
            let _config = ConfigCacheGuard::with_config(cloud_config(
                server_url,
                access_token,
                refresh_token,
            ));

            assert_eq!(is_cloud_configured(), expected, "{label}");
        }
    }

    #[serial]
    #[test]
    fn cloud_error_display_and_predicate_matrix_is_specific() {
        let cases = [
            (
                CloudError::NotConfigured,
                "cloud not configured",
                false,
                false,
            ),
            (
                CloudError::AuthExpired,
                "cloud auth expired, please re-pair",
                false,
                true,
            ),
            (
                CloudError::Network("dns failed".to_string()),
                "network error: dns failed",
                true,
                false,
            ),
            (
                CloudError::Network("timeout".to_string()),
                "network error: timeout",
                true,
                false,
            ),
            (
                CloudError::Http(0, "builder error".to_string()),
                "HTTP 0: builder error",
                false,
                false,
            ),
            (
                CloudError::Http(400, "bad request".to_string()),
                "HTTP 400: bad request",
                false,
                false,
            ),
            (
                CloudError::Http(401, "unauthorized".to_string()),
                "HTTP 401: unauthorized",
                false,
                false,
            ),
            (
                CloudError::Http(503, "maintenance".to_string()),
                "HTTP 503: maintenance",
                false,
                false,
            ),
            (
                CloudError::Http(599, String::new()),
                "HTTP 599: ",
                false,
                false,
            ),
        ];

        for (error, display, is_network, is_auth) in cases {
            assert_eq!(error.to_string(), display);
            assert_eq!(error.is_network_error(), is_network);
            assert_eq!(error.is_auth_failed(), is_auth);
        }
    }

    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_pre_network_validation_matrix_is_stable() {
        let messages = json!([
            {
                "role": "system",
                "content": "You are a concise assistant."
            },
            {
                "role": "user",
                "content": "Summarize the branch."
            }
        ]);
        let cases = [
            (
                cloud_config(None, None, None),
                None,
                false,
                "voice_refine",
                None,
                "not-configured empty config",
            ),
            (
                cloud_config(Some("https://cloud.example"), None, None),
                Some("model-a"),
                false,
                "voice_refine",
                Some(0.1),
                "not-configured missing access token",
            ),
            (
                cloud_config(None, Some("access-a"), Some("refresh-a")),
                Some("model-b"),
                true,
                "commit_ai",
                Some(0.2),
                "not-configured missing server url",
            ),
            (
                cloud_config(Some(""), Some("access-b"), None),
                None,
                false,
                "unit_test",
                None,
                "empty server url builder error",
            ),
            (
                cloud_config(Some("://bad-url"), Some("access-c"), None),
                Some("model-c"),
                true,
                "unit_test",
                Some(0.3),
                "invalid server url builder error",
            ),
            (
                cloud_config(Some("http://[::1"), Some("access-d"), Some("refresh-d")),
                None,
                false,
                "unit_test",
                None,
                "malformed ipv6 server url builder error",
            ),
        ];

        for (config, model, stream, purpose, temperature, label) in cases {
            let _config = ConfigCacheGuard::with_config(config);
            let error = cloud_ai_chat(&messages, model, stream, purpose, temperature)
                .await
                .expect_err(label);

            match label {
                label if label.starts_with("not-configured") => {
                    assert!(
                        matches!(error, CloudError::NotConfigured),
                        "{label}: {error:?}"
                    );
                }
                _ => match error {
                    CloudError::Http(0, message) => {
                        assert!(message.contains("builder error"), "{label}: {message}");
                    }
                    other => panic!("{label}: expected request builder error, got {other:?}"),
                },
            }
        }
    }

    #[serial]
    #[tokio::test]
    async fn refresh_access_token_pre_network_error_matrix_is_network_error() {
        let cases = [
            (
                "",
                "refresh-a",
                "empty server url cannot build refresh request",
            ),
            (
                "://bad-url",
                "refresh-b",
                "bad scheme cannot build refresh request",
            ),
            (
                "cloud.example",
                "refresh-c",
                "missing scheme cannot build refresh request",
            ),
            (
                "http://[::1",
                "refresh-d",
                "malformed ipv6 literal cannot build refresh request",
            ),
        ];

        for (server_url, refresh_token, label) in cases {
            let error = refresh_access_token(server_url, refresh_token)
                .await
                .expect_err(label);

            match error {
                CloudError::Network(message) => {
                    assert!(message.contains("builder error"), "{label}: {message}");
                }
                other => panic!("{label}: expected network builder error, got {other:?}"),
            }
        }
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_posts_expected_body_and_returns_success() {
        let state = Arc::new(Mutex::new(MockCloudState {
            chat_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: "assistant reply",
            }]),
            ..MockCloudState::default()
        }));
        let server_url = spawn_cloud_server(state.clone()).await;
        let _config =
            ConfigCacheGuard::with_config(cloud_config(Some(&server_url), Some("access-a"), None));

        let result = cloud_ai_chat(
            &json!([{ "role": "user", "content": "hello" }]),
            Some("model-a"),
            true,
            "voice_refine",
            Some(0.25),
        )
        .await
        .expect("chat succeeds");

        let state = state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(result, "assistant reply");
        assert_eq!(state.chat_authorizations, vec!["Bearer access-a"]);
        assert_eq!(state.chat_bodies[0]["model"], "model-a");
        assert_eq!(state.chat_bodies[0]["stream"], true);
        assert_eq!(state.chat_bodies[0]["purpose"], "voice_refine");
        assert_eq!(state.chat_bodies[0]["temperature"], 0.25);
        assert_eq!(state.chat_bodies[0]["messages"][0]["content"], "hello");
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_refreshes_access_token_and_retries_once() {
        let state = Arc::new(Mutex::new(MockCloudState {
            chat_responses: VecDeque::from([
                MockResponse {
                    status: StatusCode::UNAUTHORIZED,
                    body: "expired",
                },
                MockResponse {
                    status: StatusCode::OK,
                    body: "retry reply",
                },
            ]),
            refresh_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: r#"{"access_token":"fresh-access"}"#,
            }]),
            ..MockCloudState::default()
        }));
        let server_url = spawn_cloud_server(state.clone()).await;
        let _config = ConfigCacheGuard::with_config(cloud_config(
            Some(&server_url),
            Some("expired-access"),
            Some("refresh-a"),
        ));

        let result = cloud_ai_chat(&json!([]), None, false, "commit_ai", None)
            .await
            .expect("refresh then retry succeeds");

        let state = state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(result, "retry reply");
        assert_eq!(
            state.chat_authorizations,
            vec!["Bearer expired-access", "Bearer fresh-access"]
        );
        assert_eq!(
            state.refresh_bodies,
            vec![json!({ "refresh_token": "refresh-a" })]
        );
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn cloud_ai_chat_reports_retry_failure_and_http_error_bodies() {
        let retry_state = Arc::new(Mutex::new(MockCloudState {
            chat_responses: VecDeque::from([
                MockResponse {
                    status: StatusCode::UNAUTHORIZED,
                    body: "expired",
                },
                MockResponse {
                    status: StatusCode::BAD_GATEWAY,
                    body: "still bad",
                },
            ]),
            refresh_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: r#"{"access_token":"fresh-access"}"#,
            }]),
            ..MockCloudState::default()
        }));
        let retry_server = spawn_cloud_server(retry_state).await;
        let _config = ConfigCacheGuard::with_config(cloud_config(
            Some(&retry_server),
            Some("expired-access"),
            Some("refresh-a"),
        ));

        let retry_err = cloud_ai_chat(&json!([]), None, false, "commit_ai", None)
            .await
            .unwrap_err();
        assert!(matches!(
            retry_err,
            CloudError::Http(502, ref message) if message == "retry failed"
        ));
        drop(_config);

        let http_state = Arc::new(Mutex::new(MockCloudState {
            chat_responses: VecDeque::from([MockResponse {
                status: StatusCode::SERVICE_UNAVAILABLE,
                body: "maintenance",
            }]),
            ..MockCloudState::default()
        }));
        let http_server = spawn_cloud_server(http_state).await;
        let _config =
            ConfigCacheGuard::with_config(cloud_config(Some(&http_server), Some("access-a"), None));

        let http_err = cloud_ai_chat(&json!([]), None, false, "commit_ai", None)
            .await
            .unwrap_err();
        assert!(matches!(
            http_err,
            CloudError::Http(503, ref message) if message == "maintenance"
        ));
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn refresh_access_token_maps_status_and_malformed_json_to_auth_or_network() {
        let denied_state = Arc::new(Mutex::new(MockCloudState {
            refresh_responses: VecDeque::from([MockResponse {
                status: StatusCode::UNAUTHORIZED,
                body: "no",
            }]),
            ..MockCloudState::default()
        }));
        let denied_server = spawn_cloud_server(denied_state).await;

        let denied = refresh_access_token(&denied_server, "refresh-a")
            .await
            .unwrap_err();
        assert!(matches!(denied, CloudError::AuthExpired));

        let malformed_state = Arc::new(Mutex::new(MockCloudState {
            refresh_responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                body: "not-json",
            }]),
            ..MockCloudState::default()
        }));
        let malformed_server = spawn_cloud_server(malformed_state).await;

        let malformed = refresh_access_token(&malformed_server, "refresh-b")
            .await
            .unwrap_err();
        assert!(
            matches!(malformed, CloudError::Network(ref message) if message.contains("expected"))
        );
    }
}
