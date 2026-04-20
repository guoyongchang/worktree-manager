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

/// 缓存有效期（秒）
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
    let mut cache = MIRROR_CACHE.lock().unwrap();
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
        available: false,
    }
}

/// 第一阶段：PING 测试，用小文件快速验证镜像是否可用
async fn ping_mirror(mirror: &MirrorSource) -> (MirrorSource, bool) {
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
        Err(_) => return (mirror.clone(), false),
    };

    match client.get(&test_url).send().await {
        Ok(r) if r.status().is_success() => match r.bytes().await {
            Ok(body) if body.len() > 100 => {
                log::info!("[mirror] PING {} OK ({} bytes)", mirror.name, body.len());
                (mirror.clone(), true)
            }
            _ => {
                log::warn!("[mirror] PING {} returned empty/small body", mirror.name);
                (mirror.clone(), false)
            }
        },
        Ok(r) => {
            log::warn!("[mirror] PING {} returned HTTP {}", mirror.name, r.status());
            (mirror.clone(), false)
        }
        Err(e) => {
            log::warn!("[mirror] PING {} failed: {}", mirror.name, e);
            (mirror.clone(), false)
        }
    }
}

/// 第二阶段：对存活源进行限时下载测速
async fn speed_test_mirror(mirror: &MirrorSource) -> MirrorTestResult {
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

    MirrorTestResult {
        name: mirror.name.clone(),
        url: mirror.url.clone(),
        bytes_downloaded: total_bytes,
        speed_mbps: (speed_mbps * 100.0).round() / 100.0,
        available: total_bytes > 0,
    }
}

/// 两阶段并发测速：先 PING 过滤，再对存活源测吞吐量
pub async fn test_all_mirrors() -> Vec<MirrorTestResult> {
    let mirrors = get_all_mirrors();
    log::info!(
        "[mirror] Phase 1: PING testing {} mirrors ({}s timeout)...",
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

    let mut alive_mirrors: Vec<MirrorSource> = Vec::new();
    let mut dead_results: Vec<MirrorTestResult> = Vec::new();

    for handle in ping_handles {
        if let Ok((mirror, alive)) = handle.await {
            if alive {
                alive_mirrors.push(mirror);
            } else {
                dead_results.push(unavailable_result(&mirror));
            }
        }
    }

    log::info!(
        "[mirror] Phase 1 complete: {}/{} alive, proceeding to speed test",
        alive_mirrors.len(),
        alive_mirrors.len() + dead_results.len()
    );

    if alive_mirrors.is_empty() {
        return dead_results;
    }

    log::info!(
        "[mirror] Phase 2: Speed testing {} alive mirrors ({}s each)...",
        alive_mirrors.len(),
        SPEED_TEST_DURATION_SECS
    );

    let speed_handles: Vec<_> = alive_mirrors
        .iter()
        .map(|m| {
            let m = m.clone();
            tokio::spawn(async move { speed_test_mirror(&m).await })
        })
        .collect();

    let mut results: Vec<MirrorTestResult> = Vec::new();
    for handle in speed_handles {
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }

    results.sort_by(|a, b| b.bytes_downloaded.cmp(&a.bytes_downloaded));
    results.extend(dead_results);

    {
        let mut cache = MIRROR_CACHE.lock().unwrap();
        *cache = Some((Instant::now(), results.clone()));
    }

    log::info!(
        "[mirror] Speed test complete, {} total results",
        results.len()
    );
    results
}

/// 获取测速结果，优先用缓存（30 分钟 TTL）
pub async fn get_fastest_mirrors() -> Vec<MirrorTestResult> {
    {
        let cache = MIRROR_CACHE.lock().unwrap();
        if let Some((cached_at, ref results)) = *cache {
            if cached_at.elapsed().as_secs() < CACHE_TTL_SECS {
                log::info!(
                    "[mirror] Using cached speed test results ({} entries)",
                    results.len()
                );
                return results.clone();
            }
        }
    }

    test_all_mirrors().await
}

/// 读取缓存的测速结果（不触发新测速）
pub fn get_cached_results() -> Vec<MirrorTestResult> {
    let cache = MIRROR_CACHE.lock().unwrap();
    match &*cache {
        Some((_, results)) => results.clone(),
        None => Vec::new(),
    }
}
