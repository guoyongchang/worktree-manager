use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;

use crate::config::load_global_config;

// ==================== 类型定义 ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorSource {
    pub name: String,
    pub url: String,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorTestResult {
    pub name: String,
    pub url: String,
    pub bytes_downloaded: u64,
    pub speed_mbps: f64,
    pub ping_ms: u64,
    pub available: bool,
}

// ==================== 内置镜像源 ====================

const BUILTIN_MIRRORS: &[(&str, &str)] = &[
    ("gh-proxy.org", "https://gh-proxy.org/"),
    ("ghproxy.net", "https://ghproxy.net/"),
    ("mirror.ghproxy.com", "https://mirror.ghproxy.com/"),
    ("gh.llkk.cc", "https://gh.llkk.cc/"),
    ("github.moeyy.xyz", "https://github.moeyy.xyz/"),
    ("ghps.cc", "https://ghps.cc/"),
    ("cf.ghproxy.cc", "https://cf.ghproxy.cc/"),
    ("gh.noki.icu", "https://gh.noki.icu/"),
    ("ghproxy.cn", "https://ghproxy.cn/"),
];

/// PING 测试文件：React favicon (~3KB)，用于快速过滤不可用源
const PING_TEST_BASE_URL: &str =
    "https://raw.githubusercontent.com/facebook/react/refs/heads/main/fixtures/dom/public/favicon.ico";

/// PING 超时（秒）
const PING_TIMEOUT_SECS: u64 = 3;

/// 吞吐量测速文件：pip 24.3.1 release zip (~4MB)
const SPEED_TEST_BASE_URL: &str = "https://github.com/pypa/pip/archive/refs/tags/24.3.1.zip";

/// 测速时长（秒）
const SPEED_TEST_DURATION_SECS: u64 = 10;

/// PING 最小有效大小（字节）— favicon.ico 约 24KB，低于 10KB 视为返回了错误页
const PING_MIN_VALID_BYTES: usize = 10_000;

/// 测速最小有效下载量（字节）— 低于此值说明源返回了错误页而非真实文件
const SPEED_TEST_MIN_VALID_BYTES: u64 = 100_000;

/// 缓存有效期（秒）— 预留给未来自动刷新
#[allow(dead_code)]
const CACHE_TTL_SECS: u64 = 30 * 60;

// ==================== 缓存 ====================

static MIRROR_CACHE: Mutex<Option<(Instant, Vec<MirrorTestResult>)>> = Mutex::new(None);

/// 获取所有镜像源（内置 + 用户自定义）
pub fn get_all_mirrors() -> Vec<MirrorSource> {
    let mut mirrors: Vec<MirrorSource> = BUILTIN_MIRRORS
        .iter()
        .map(|(name, url)| MirrorSource {
            name: name.to_string(),
            url: url.to_string(),
            builtin: true,
        })
        .collect();

    let config = load_global_config();
    for cm in &config.custom_mirrors {
        mirrors.push(MirrorSource {
            name: cm.name.clone(),
            url: cm.url.clone(),
            builtin: false,
        });
    }

    mirrors
}

/// 清除测速缓存
pub fn clear_mirror_cache() {
    let mut cache = MIRROR_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cache = None;
}

// ==================== 测速逻辑 ====================

fn make_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn unavailable_result(mirror: &MirrorSource) -> MirrorTestResult {
    MirrorTestResult {
        name: mirror.name.clone(),
        url: mirror.url.clone(),
        bytes_downloaded: 0,
        speed_mbps: 0.0,
        ping_ms: 0,
        available: false,
    }
}

/// 第一阶段：PING 测试，用小文件快速验证镜像是否可用，返回 (mirror, available, ping_ms)
/// 校验 mirror URL 是合法的 http(s) 绝对地址且 host 非空。非法 URL（空、缺 scheme/host、
/// 格式错误）直接判定不可用，避免与基础路径拼接后误打到某个意外解析出的主机（DNS 偶然性导致测试/行为不确定）。
fn is_valid_mirror_url(raw: &str) -> bool {
    match url::Url::parse(raw) {
        Ok(u) => {
            matches!(u.scheme(), "http" | "https")
                && u.host_str().map(|h| !h.is_empty()).unwrap_or(false)
        }
        Err(_) => false,
    }
}

async fn ping_mirror(mirror: &MirrorSource) -> (MirrorSource, bool, u64) {
    if !is_valid_mirror_url(&mirror.url) {
        log::warn!(
            "[mirror] PING {} skipped: invalid URL '{}'",
            mirror.name,
            mirror.url
        );
        return (mirror.clone(), false, 0);
    }

    let test_url = format!(
        "{}{}?t={}",
        mirror.url,
        PING_TEST_BASE_URL,
        make_timestamp()
    );

    log::info!("[mirror] PING {}: {}", mirror.name, test_url);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(PING_TIMEOUT_SECS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (mirror.clone(), false, 0),
    };

    let start = Instant::now();

    match client.get(&test_url).send().await {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(body) if body.len() > PING_MIN_VALID_BYTES => {
                let ping_ms = start.elapsed().as_millis() as u64;
                log::info!(
                    "[mirror] PING {} OK ({} bytes, {}ms)",
                    mirror.name,
                    body.len(),
                    ping_ms
                );
                (mirror.clone(), true, ping_ms)
            }
            Ok(body) => {
                log::warn!(
                    "[mirror] PING {} returned suspicious body size ({} bytes < {} threshold), likely error page",
                    mirror.name, body.len(), PING_MIN_VALID_BYTES
                );
                (mirror.clone(), false, 0)
            }
            Err(e) => {
                log::warn!("[mirror] PING {} body read failed: {}", mirror.name, e);
                (mirror.clone(), false, 0)
            }
        },
        Ok(r) => {
            log::warn!("[mirror] PING {} returned HTTP {}", mirror.name, r.status());
            (mirror.clone(), false, 0)
        }
        Err(e) => {
            log::warn!("[mirror] PING {} failed: {}", mirror.name, e);
            (mirror.clone(), false, 0)
        }
    }
}

/// 第二阶段：对存活源进行限时下载测速
async fn speed_test_mirror(mirror: &MirrorSource) -> MirrorTestResult {
    if !is_valid_mirror_url(&mirror.url) {
        log::warn!(
            "[mirror] Speed test {} skipped: invalid URL '{}'",
            mirror.name,
            mirror.url
        );
        return unavailable_result(mirror);
    }

    let test_url = format!(
        "{}{}?t={}",
        mirror.url,
        SPEED_TEST_BASE_URL,
        make_timestamp()
    );

    log::info!("[mirror] Speed testing {}: {}", mirror.name, test_url);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(SPEED_TEST_DURATION_SECS + 2))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[mirror] Failed to build client for {}: {}", mirror.name, e);
            return unavailable_result(mirror);
        }
    };

    let resp = match client.get(&test_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            log::warn!("[mirror] {} returned HTTP {}", mirror.name, r.status());
            return unavailable_result(mirror);
        }
        Err(e) => {
            log::warn!("[mirror] {} connection failed: {}", mirror.name, e);
            return unavailable_result(mirror);
        }
    };

    use futures_util::StreamExt;
    let start = Instant::now();
    let deadline = start + std::time::Duration::from_secs(SPEED_TEST_DURATION_SECS);
    let mut total_bytes: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        if Instant::now() >= deadline {
            break;
        }
        match chunk_result {
            Ok(chunk) => {
                total_bytes += chunk.len() as u64;
            }
            Err(e) => {
                log::warn!("[mirror] {} stream error: {}", mirror.name, e);
                break;
            }
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    let speed_mbps = if elapsed > 0.0 {
        (total_bytes as f64) / elapsed / 1_048_576.0
    } else {
        0.0
    };

    log::info!(
        "[mirror] {} result: {} bytes in {:.1}s = {:.2} MB/s",
        mirror.name,
        total_bytes,
        elapsed,
        speed_mbps
    );

    // 保留缓存中已有的 ping_ms
    let ping_ms = {
        let cache = MIRROR_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache
            .as_ref()
            .and_then(|(_, results)| results.iter().find(|r| r.url == mirror.url))
            .map(|r| r.ping_ms)
            .unwrap_or(0)
    };

    MirrorTestResult {
        name: mirror.name.clone(),
        url: mirror.url.clone(),
        bytes_downloaded: total_bytes,
        speed_mbps: (speed_mbps * 100.0).round() / 100.0,
        ping_ms,
        available: total_bytes > SPEED_TEST_MIN_VALID_BYTES,
    }
}

/// 并发 PING 所有镜像源，PING 通过即标记为可用（不做吞吐量测速）
pub async fn ping_all_mirrors() -> Vec<MirrorTestResult> {
    let mirrors = get_all_mirrors();
    log::info!(
        "[mirror] PING testing {} mirrors ({}s timeout)...",
        mirrors.len(),
        PING_TIMEOUT_SECS
    );

    let ping_handles: Vec<_> = mirrors
        .iter()
        .map(|m| {
            let m = m.clone();
            tokio::spawn(async move { ping_mirror(&m).await })
        })
        .collect();

    let mut results: Vec<MirrorTestResult> = Vec::new();

    for handle in ping_handles {
        if let Ok((mirror, alive, ping_ms)) = handle.await {
            if alive {
                results.push(MirrorTestResult {
                    name: mirror.name.clone(),
                    url: mirror.url.clone(),
                    bytes_downloaded: 0,
                    speed_mbps: 0.0,
                    ping_ms,
                    available: true,
                });
            } else {
                results.push(unavailable_result(&mirror));
            }
        }
    }

    // 可用源按 ping 延迟升序排列，不可用源排末尾
    results.sort_by(|a, b| {
        b.available
            .cmp(&a.available)
            .then(a.ping_ms.cmp(&b.ping_ms))
    });

    // 更新缓存
    {
        let mut cache = MIRROR_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *cache = Some((Instant::now(), results.clone()));
    }

    log::info!(
        "[mirror] PING complete: {}/{} available",
        results.iter().filter(|r| r.available).count(),
        results.len()
    );
    results
}

/// 对单个镜像源进行吞吐量测速（10 秒），返回更新后的结果
pub async fn speed_test_single(mirror_url: &str) -> Option<MirrorTestResult> {
    let mirrors = get_all_mirrors();
    let mirror = mirrors.iter().find(|m| m.url == mirror_url)?;
    let result = speed_test_mirror(mirror).await;

    // 更新缓存中该源的结果
    {
        let mut cache = MIRROR_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((_, ref mut results)) = *cache {
            if let Some(existing) = results.iter_mut().find(|r| r.url == mirror_url) {
                *existing = result.clone();
            }
        }
    }

    Some(result)
}

/// 读取缓存的测速结果（不触发新测速）
pub fn get_cached_results() -> Vec<MirrorTestResult> {
    let cache = MIRROR_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match &*cache {
        Some((_, results)) => results.clone(),
        None => Vec::new(),
    }
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
        fn with_custom_mirrors(custom_mirrors: Vec<crate::types::CustomMirror>) -> Self {
            let lock = FileLockGuard::acquire();
            let mut config = crate::types::GlobalConfig::default();
            config.custom_mirrors = custom_mirrors;
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

    fn sample_result(name: &str, url: &str, available: bool, ping_ms: u64) -> MirrorTestResult {
        MirrorTestResult {
            name: name.to_string(),
            url: url.to_string(),
            bytes_downloaded: if available { 120_000 } else { 0 },
            speed_mbps: if available { 1.25 } else { 0.0 },
            ping_ms,
            available,
        }
    }

    #[serial]
    #[test]
    fn mirror_types_round_trip_json() {
        let source = MirrorSource {
            name: "custom".to_string(),
            url: "https://mirror.example/".to_string(),
            builtin: false,
        };
        let source_json = serde_json::to_value(&source).unwrap();
        assert_eq!(
            source_json,
            json!({"name":"custom","url":"https://mirror.example/","builtin":false})
        );
        let decoded_source: MirrorSource = serde_json::from_value(source_json).unwrap();
        assert_eq!(decoded_source.name, "custom");
        assert_eq!(decoded_source.url, "https://mirror.example/");
        assert!(!decoded_source.builtin);

        let result = sample_result("fast", "https://fast.example/", true, 27);
        let decoded_result: MirrorTestResult =
            serde_json::from_str(&serde_json::to_string(&result).unwrap()).unwrap();
        assert_eq!(decoded_result.name, "fast");
        assert_eq!(decoded_result.bytes_downloaded, 120_000);
        assert_eq!(decoded_result.speed_mbps, 1.25);
        assert_eq!(decoded_result.ping_ms, 27);
        assert!(decoded_result.available);
    }

    #[serial]
    #[test]
    fn get_all_mirrors_appends_custom_mirrors_after_builtins() {
        let _config = ConfigCacheGuard::with_custom_mirrors(vec![crate::types::CustomMirror {
            name: "office".to_string(),
            url: "https://office.example/".to_string(),
        }]);

        let mirrors = get_all_mirrors();

        assert_eq!(mirrors[0].name, "gh-proxy.org");
        assert_eq!(mirrors[0].url, "https://gh-proxy.org/");
        assert!(mirrors[0].builtin);
        let custom = mirrors.last().unwrap();
        assert_eq!(custom.name, "office");
        assert_eq!(custom.url, "https://office.example/");
        assert!(!custom.builtin);
    }

    #[serial]
    #[test]
    fn unavailable_result_preserves_mirror_identity_with_zero_metrics() {
        let mirror = MirrorSource {
            name: "down".to_string(),
            url: "https://down.example/".to_string(),
            builtin: false,
        };

        let result = unavailable_result(&mirror);

        assert_eq!(result.name, "down");
        assert_eq!(result.url, "https://down.example/");
        assert_eq!(result.bytes_downloaded, 0);
        assert_eq!(result.speed_mbps, 0.0);
        assert_eq!(result.ping_ms, 0);
        assert!(!result.available);
    }

    #[serial]
    #[test]
    fn cache_returns_cloned_results_and_clear_empties_it() {
        clear_mirror_cache();
        {
            let mut cache = MIRROR_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = Some((
                Instant::now(),
                vec![
                    sample_result("fast", "https://fast.example/", true, 10),
                    sample_result("slow", "https://slow.example/", true, 80),
                ],
            ));
        }

        let first_read = get_cached_results();
        assert_eq!(first_read.len(), 2);
        assert_eq!(first_read[0].url, "https://fast.example/");
        assert_eq!(first_read[1].ping_ms, 80);

        clear_mirror_cache();
        assert!(get_cached_results().is_empty());
    }

    #[serial]
    #[tokio::test]
    async fn ping_mirror_returns_unavailable_for_invalid_mirror_url_without_network() {
        let mirror = MirrorSource {
            name: "invalid".to_string(),
            url: "://bad-mirror/".to_string(),
            builtin: false,
        };

        let (tested_mirror, available, ping_ms) = ping_mirror(&mirror).await;

        assert_eq!(tested_mirror.name, "invalid");
        assert_eq!(tested_mirror.url, "://bad-mirror/");
        assert!(!available);
        assert_eq!(ping_ms, 0);
    }

    #[serial]
    #[tokio::test]
    async fn speed_test_invalid_url_returns_unavailable_without_network() {
        let mirror = MirrorSource {
            name: "invalid-speed".to_string(),
            url: "://bad-mirror/".to_string(),
            builtin: false,
        };
        {
            let mut cache = MIRROR_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = Some((
                Instant::now(),
                vec![sample_result("cached", "://bad-mirror/", true, 42)],
            ));
        }

        let result = speed_test_mirror(&mirror).await;

        assert_eq!(result.name, "invalid-speed");
        assert_eq!(result.url, "://bad-mirror/");
        assert_eq!(result.bytes_downloaded, 0);
        assert_eq!(result.speed_mbps, 0.0);
        assert_eq!(result.ping_ms, 0);
        assert!(!result.available);
    }

    #[serial]
    #[tokio::test]
    async fn speed_test_single_unknown_url_returns_none_without_request() {
        let _config = ConfigCacheGuard::with_custom_mirrors(Vec::new());

        let result = speed_test_single("https://missing.example/").await;

        assert!(result.is_none());
    }

    // URL rewrite capture and full ranking through `ping_all_mirrors` intentionally are not
    // tested here: the sandbox denies local socket binds, and built-in mirrors are external.
}

#[cfg(test)]
mod coverage_completion_tests {
    use super::*;
    #[cfg(any())]
    use axum::{
        extract::State,
        http::{StatusCode, Uri},
        response::{IntoResponse, Response},
        routing::get,
        Router,
    };
    use serial_test::serial;
    #[cfg(any())]
    use std::collections::VecDeque;
    use std::path::PathBuf;
    #[cfg(any())]
    use std::sync::{Arc, Mutex};
    #[cfg(any())]
    use tokio::net::TcpListener;

    struct ConfigCacheGuard {
        previous: Option<crate::types::GlobalConfig>,
        _lock: FileLockGuard,
    }

    impl ConfigCacheGuard {
        fn with_custom_mirrors(custom_mirrors: Vec<crate::types::CustomMirror>) -> Self {
            let lock = FileLockGuard::acquire();
            let mut config = crate::types::GlobalConfig::default();
            config.custom_mirrors = custom_mirrors;
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
    }

    impl Drop for ConfigCacheGuard {
        fn drop(&mut self) {
            let mut cache = crate::state::GLOBAL_CONFIG_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = self.previous.take();
            clear_mirror_cache();
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

    fn custom_mirror(name: &str, url: &str) -> crate::types::CustomMirror {
        crate::types::CustomMirror {
            name: name.to_string(),
            url: url.to_string(),
        }
    }

    fn result(name: &str, available: bool, ping_ms: u64, speed_mbps: f64) -> MirrorTestResult {
        MirrorTestResult {
            name: name.to_string(),
            url: format!("https://{name}.example/"),
            bytes_downloaded: if available { 200_000 } else { 0 },
            speed_mbps,
            ping_ms,
            available,
        }
    }

    // Local mock-server coverage is intentionally compiled out in this sandbox:
    // binding 127.0.0.1:0 returns PermissionDenied, while public mirrors are external.
    #[cfg(any())]
    #[derive(Clone)]
    struct MockResponse {
        status: StatusCode,
        bytes: usize,
    }

    #[cfg(any())]
    #[derive(Default)]
    struct MockMirrorState {
        responses: VecDeque<MockResponse>,
        requested_uris: Vec<String>,
    }

    #[cfg(any())]
    async fn spawn_mirror_server(state: Arc<Mutex<MockMirrorState>>) -> String {
        let app = Router::new()
            .route(
                "/{*path}",
                get(
                    |uri: Uri, State(state): State<Arc<Mutex<MockMirrorState>>>| async move {
                        let response = {
                            let mut state = state
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            state.requested_uris.push(uri.to_string());
                            state.responses.pop_front().expect("queued mirror response")
                        };
                        let body = vec![b'x'; response.bytes];
                        Response::from((response.status, body).into_response())
                    },
                ),
            )
            .with_state(state);
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind mirror mock server");
        let addr = listener.local_addr().expect("mirror mock addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{}/", addr)
    }

    #[serial]
    #[test]
    fn builtin_and_custom_mirror_selection_preserves_order_and_flags() {
        let _config = ConfigCacheGuard::with_custom_mirrors(vec![
            custom_mirror("office-a", "https://office-a.example/"),
            custom_mirror("office-b", "https://office-b.example/"),
        ]);

        let mirrors = get_all_mirrors();

        assert_eq!(mirrors.len(), BUILTIN_MIRRORS.len() + 2);
        assert_eq!(mirrors[0].name, BUILTIN_MIRRORS[0].0);
        assert_eq!(mirrors[0].url, BUILTIN_MIRRORS[0].1);
        assert!(mirrors[..BUILTIN_MIRRORS.len()]
            .iter()
            .all(|mirror| mirror.builtin));
        assert_eq!(mirrors[BUILTIN_MIRRORS.len()].name, "office-a".to_string());
        assert_eq!(mirrors.last().unwrap().name, "office-b");
        assert!(!mirrors.last().unwrap().builtin);
    }

    #[serial]
    #[test]
    fn timestamp_cache_key_component_is_nonzero_and_monotonic() {
        let first = make_timestamp();
        let second = make_timestamp();

        assert!(first > 0);
        assert!(second >= first);
    }

    #[serial]
    #[test]
    fn speed_test_sorting_orders_available_by_ping_then_unavailable_last() {
        let mut results = vec![
            result("down-fast-ping", false, 1, 0.0),
            result("available-slow-ping", true, 80, 1.0),
            result("available-fast-ping", true, 12, 0.5),
            result("down-slow-ping", false, 99, 0.0),
        ];

        results.sort_by(|a, b| {
            b.available
                .cmp(&a.available)
                .then(a.ping_ms.cmp(&b.ping_ms))
        });

        let names = results
            .iter()
            .map(|result| result.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "available-fast-ping",
                "available-slow-ping",
                "down-fast-ping",
                "down-slow-ping"
            ]
        );
    }

    #[serial]
    #[tokio::test]
    async fn speed_test_single_updates_cached_entry_by_mirror_url() {
        let _config = ConfigCacheGuard::with_custom_mirrors(vec![custom_mirror(
            "invalid-custom",
            "://bad-mirror/",
        )]);
        clear_mirror_cache();
        {
            let mut cache = MIRROR_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = Some((
                Instant::now(),
                vec![MirrorTestResult {
                    name: "old-cache-name".to_string(),
                    url: "://bad-mirror/".to_string(),
                    bytes_downloaded: 123,
                    speed_mbps: 9.9,
                    ping_ms: 55,
                    available: true,
                }],
            ));
        }

        let result = speed_test_single("://bad-mirror/")
            .await
            .expect("custom mirror should be selected");
        let cached = get_cached_results();

        assert_eq!(result.name, "invalid-custom");
        assert_eq!(result.url, "://bad-mirror/");
        assert!(!result.available);
        assert_eq!(result.bytes_downloaded, 0);
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].name, "invalid-custom");
        assert_eq!(cached[0].url, "://bad-mirror/");
        assert!(!cached[0].available);
    }

    #[serial]
    #[test]
    fn mirror_source_matrix_preserves_builtin_and_custom_ordering() {
        let custom = vec![
            custom_mirror("office-alpha", "https://office-alpha.example/"),
            custom_mirror("office-beta", "https://office-beta.example/base/"),
            custom_mirror("office-gamma", "https://office-gamma.example/proxy/"),
            custom_mirror("office-delta", "https://office-delta.example/"),
            custom_mirror("office-epsilon", "https://office-epsilon.example/"),
        ];
        let _config = ConfigCacheGuard::with_custom_mirrors(custom);

        let mirrors = get_all_mirrors();

        assert_eq!(mirrors.len(), BUILTIN_MIRRORS.len() + 5);
        assert_eq!(mirrors[0].name, "gh-proxy.org");
        assert_eq!(mirrors[1].name, "ghproxy.net");
        assert_eq!(mirrors[2].name, "mirror.ghproxy.com");
        assert_eq!(mirrors[3].name, "gh.llkk.cc");
        assert_eq!(mirrors[4].name, "github.moeyy.xyz");
        assert_eq!(mirrors[5].name, "ghps.cc");
        assert_eq!(mirrors[6].name, "cf.ghproxy.cc");
        assert_eq!(mirrors[7].name, "gh.noki.icu");
        assert_eq!(mirrors[8].name, "ghproxy.cn");
        assert!(mirrors[..BUILTIN_MIRRORS.len()]
            .iter()
            .all(|mirror| mirror.builtin));
        assert_eq!(mirrors[BUILTIN_MIRRORS.len()].name, "office-alpha");
        assert_eq!(
            mirrors[BUILTIN_MIRRORS.len()].url,
            "https://office-alpha.example/"
        );
        assert_eq!(mirrors[BUILTIN_MIRRORS.len() + 1].name, "office-beta");
        assert_eq!(
            mirrors[BUILTIN_MIRRORS.len() + 1].url,
            "https://office-beta.example/base/"
        );
        assert_eq!(mirrors[BUILTIN_MIRRORS.len() + 2].name, "office-gamma");
        assert_eq!(
            mirrors[BUILTIN_MIRRORS.len() + 2].url,
            "https://office-gamma.example/proxy/"
        );
        assert_eq!(mirrors[BUILTIN_MIRRORS.len() + 3].name, "office-delta");
        assert_eq!(mirrors[BUILTIN_MIRRORS.len() + 4].name, "office-epsilon");
        assert!(!mirrors[BUILTIN_MIRRORS.len()].builtin);
        assert!(!mirrors[BUILTIN_MIRRORS.len() + 4].builtin);
    }

    #[serial]
    #[test]
    fn mirror_cache_matrix_returns_clones_and_replaces_exact_entries() {
        clear_mirror_cache();
        let original = vec![
            result("alpha", true, 9, 3.4),
            result("beta", true, 20, 1.2),
            result("gamma", false, 0, 0.0),
            result("delta", true, 45, 0.8),
            result("epsilon", false, 0, 0.0),
        ];
        {
            let mut cache = MIRROR_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = Some((Instant::now(), original.clone()));
        }

        let first = get_cached_results();
        let mut mutated = first.clone();
        mutated[0].name = "mutated".to_string();
        mutated[1].available = false;
        let second = get_cached_results();

        assert_eq!(second[0].name, "alpha");
        assert_eq!(second[0].url, "https://alpha.example/");
        assert_eq!(second[0].bytes_downloaded, 200_000);
        assert_eq!(second[0].speed_mbps, 3.4);
        assert_eq!(second[0].ping_ms, 9);
        assert!(second[0].available);
        assert_eq!(second[1].name, "beta");
        assert_eq!(second[1].url, "https://beta.example/");
        assert_eq!(second[1].speed_mbps, 1.2);
        assert_eq!(second[1].ping_ms, 20);
        assert!(second[1].available);
        assert_eq!(second[2].name, "gamma");
        assert_eq!(second[2].bytes_downloaded, 0);
        assert_eq!(second[2].speed_mbps, 0.0);
        assert!(!second[2].available);
        assert_eq!(second[3].name, "delta");
        assert_eq!(second[3].ping_ms, 45);
        assert!(second[3].available);
        assert_eq!(second[4].name, "epsilon");
        assert!(!second[4].available);

        clear_mirror_cache();
        assert!(get_cached_results().is_empty());
    }

    #[serial]
    #[test]
    fn mirror_sort_matrix_orders_available_sources_by_ping() {
        let mut cases = vec![
            result("unavailable-low-ping", false, 1, 0.0),
            result("available-medium", true, 30, 1.0),
            result("available-low", true, 5, 4.0),
            result("available-high", true, 90, 0.2),
            result("unavailable-zero", false, 0, 0.0),
            result("available-equal-a", true, 30, 2.0),
            result("available-equal-b", true, 30, 2.5),
            result("unavailable-high-ping", false, 99, 0.0),
        ];

        cases.sort_by(|a, b| {
            b.available
                .cmp(&a.available)
                .then(a.ping_ms.cmp(&b.ping_ms))
        });

        assert_eq!(cases[0].name, "available-low");
        assert_eq!(cases[0].ping_ms, 5);
        assert!(cases[0].available);
        assert_eq!(cases[1].name, "available-medium");
        assert_eq!(cases[1].ping_ms, 30);
        assert!(cases[1].available);
        assert_eq!(cases[2].name, "available-equal-a");
        assert_eq!(cases[2].ping_ms, 30);
        assert!(cases[2].available);
        assert_eq!(cases[3].name, "available-equal-b");
        assert_eq!(cases[3].ping_ms, 30);
        assert!(cases[3].available);
        assert_eq!(cases[4].name, "available-high");
        assert_eq!(cases[4].ping_ms, 90);
        assert!(cases[4].available);
        assert!(!cases[5].available);
        assert!(!cases[6].available);
        assert!(!cases[7].available);
    }

    #[serial]
    #[tokio::test]
    async fn invalid_mirror_url_matrix_maps_to_unavailable_results() {
        let cases = [
            ("empty", ""),
            ("bad-scheme", "://bad-mirror/"),
            ("missing-scheme", "mirror.example/"),
            ("malformed-ipv6", "http://[::1"),
            ("missing-host", "http://"),
        ];

        for (name, url) in cases {
            let mirror = MirrorSource {
                name: name.to_string(),
                url: url.to_string(),
                builtin: false,
            };

            let (ping_source, available, ping_ms) = ping_mirror(&mirror).await;
            let speed = speed_test_mirror(&mirror).await;

            assert_eq!(ping_source.name, name);
            assert_eq!(ping_source.url, url);
            assert!(!available, "{name} ping should be unavailable");
            assert_eq!(ping_ms, 0);
            assert_eq!(speed.name, name);
            assert_eq!(speed.url, url);
            assert_eq!(speed.bytes_downloaded, 0);
            assert_eq!(speed.speed_mbps, 0.0);
            assert_eq!(speed.ping_ms, 0);
            assert!(!speed.available, "{name} speed should be unavailable");
        }
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn ping_mirror_rewrites_to_local_server_and_classifies_body_sizes() {
        let state = Arc::new(Mutex::new(MockMirrorState {
            responses: VecDeque::from([
                MockResponse {
                    status: StatusCode::OK,
                    bytes: PING_MIN_VALID_BYTES + 1,
                },
                MockResponse {
                    status: StatusCode::OK,
                    bytes: PING_MIN_VALID_BYTES - 1,
                },
                MockResponse {
                    status: StatusCode::BAD_GATEWAY,
                    bytes: 8,
                },
            ]),
            ..MockMirrorState::default()
        }));
        let base_url = spawn_mirror_server(state.clone()).await;
        let mirror = MirrorSource {
            name: "local-ping".to_string(),
            url: base_url,
            builtin: false,
        };

        let (first_mirror, first_available, first_ping) = ping_mirror(&mirror).await;
        let (_, second_available, second_ping) = ping_mirror(&mirror).await;
        let (_, third_available, third_ping) = ping_mirror(&mirror).await;

        let state = state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(first_mirror.name, "local-ping");
        assert!(first_available);
        assert!(first_ping <= PING_TIMEOUT_SECS * 1000);
        assert!(!second_available);
        assert_eq!(second_ping, 0);
        assert!(!third_available);
        assert_eq!(third_ping, 0);
        assert_eq!(state.requested_uris.len(), 3);
        assert!(state.requested_uris[0].contains("raw.githubusercontent.com"));
        assert!(state.requested_uris[0].contains("favicon.ico"));
        assert!(state.requested_uris[0].contains("?t="));
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn speed_test_mirror_downloads_from_local_server_and_preserves_cached_ping() {
        let state = Arc::new(Mutex::new(MockMirrorState {
            responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                bytes: SPEED_TEST_MIN_VALID_BYTES as usize + 1,
            }]),
            ..MockMirrorState::default()
        }));
        let base_url = spawn_mirror_server(state.clone()).await;
        let mirror = MirrorSource {
            name: "local-speed".to_string(),
            url: base_url.clone(),
            builtin: false,
        };
        {
            let mut cache = MIRROR_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = Some((
                Instant::now(),
                vec![MirrorTestResult {
                    name: "cached-speed".to_string(),
                    url: base_url.clone(),
                    bytes_downloaded: 0,
                    speed_mbps: 0.0,
                    ping_ms: 37,
                    available: true,
                }],
            ));
        }

        let result = speed_test_mirror(&mirror).await;

        let state = state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(result.name, "local-speed");
        assert_eq!(result.url, base_url);
        assert_eq!(result.bytes_downloaded, SPEED_TEST_MIN_VALID_BYTES + 1);
        assert_eq!(result.ping_ms, 37);
        assert!(result.available);
        assert!(result.speed_mbps >= 0.0);
        assert_eq!(state.requested_uris.len(), 1);
        assert!(state.requested_uris[0].contains("github.com/pypa/pip"));
        assert!(state.requested_uris[0].contains("24.3.1.zip"));
    }

    #[cfg(any())]
    #[serial]
    #[tokio::test]
    async fn speed_test_single_selects_custom_local_mirror_and_updates_cache() {
        let state = Arc::new(Mutex::new(MockMirrorState {
            responses: VecDeque::from([MockResponse {
                status: StatusCode::OK,
                bytes: SPEED_TEST_MIN_VALID_BYTES as usize + 5,
            }]),
            ..MockMirrorState::default()
        }));
        let base_url = spawn_mirror_server(state).await;
        let _config =
            ConfigCacheGuard::with_custom_mirrors(vec![custom_mirror("local-custom", &base_url)]);
        clear_mirror_cache();
        {
            let mut cache = MIRROR_CACHE
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *cache = Some((
                Instant::now(),
                vec![MirrorTestResult {
                    name: "old-custom".to_string(),
                    url: base_url.clone(),
                    bytes_downloaded: 1,
                    speed_mbps: 0.01,
                    ping_ms: 19,
                    available: false,
                }],
            ));
        }

        let result = speed_test_single(&base_url)
            .await
            .expect("custom mirror should be found");
        let cached = get_cached_results();

        assert_eq!(result.name, "local-custom");
        assert_eq!(result.bytes_downloaded, SPEED_TEST_MIN_VALID_BYTES + 5);
        assert_eq!(result.ping_ms, 19);
        assert!(result.available);
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].name, "local-custom");
        assert_eq!(cached[0].url, base_url);
        assert_eq!(cached[0].bytes_downloaded, SPEED_TEST_MIN_VALID_BYTES + 5);
        assert!(cached[0].available);
    }
}
