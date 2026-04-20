# Mirror Sources 多镜像源实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将硬编码的 gh-proxy.org 单镜像源替换为多镜像源 + 真实文件测速 + 用户自定义 + 下载 fallback 系统。

**Architecture:** 新增 `mirror.rs` 模块负责内置源列表、并发测速（10s 真实下载量排序）、缓存。修改 `commands/system.rs` 的两个现有命令接受镜像 URL 参数 + 新增 3 个命令。前端 `useUpdater` 扩展测速状态，`UpdateCheckerDialog` 重新设计镜像卡片嵌入源管理 UI。

**Tech Stack:** Rust (reqwest, tokio, serde), TypeScript (React 19), i18next

---

## 文件结构

| 文件 | 类型 | 职责 |
|------|------|------|
| `src-tauri/src/mirror.rs` | 新增 | 内置镜像列表、测速逻辑、缓存、类型定义 |
| `src-tauri/src/types.rs` | 修改 | GlobalConfig 加 `custom_mirrors` 字段 |
| `src-tauri/src/lib.rs` | 修改 | `mod mirror;` + generate_handler 注册 3 个新命令 |
| `src-tauri/src/commands/system.rs` | 修改 | 改造 2 个命令签名 + 新增 3 个命令 |
| `src-tauri/src/http_server.rs` | 修改 | 新增 3 个 handler 函数 |
| `src-tauri/src/http_server/routing.rs` | 修改 | 新增 3 条路由 + import |
| `src-tauri/src/http_server/middleware.rs` | 修改 | 新增命令到 localhost_only |
| `src/hooks/useUpdater.ts` | 修改 | 扩展测速/源管理/fallback 状态和方法 |
| `src/components/UpdateCheckerDialog.tsx` | 修改 | 镜像卡片重新设计，嵌入源列表和自定义管理 |
| `src/locales/zh-CN.json` | 修改 | 新增 i18n key |
| `src/locales/en-US.json` | 修改 | 新增 i18n key |

---

### Task 1: 类型定义 — GlobalConfig 扩展 + mirror 类型

**Files:**
- Modify: `src-tauri/src/types.rs:142-167`
- Create: `src-tauri/src/mirror.rs`

- [ ] **Step 1: 在 `types.rs` 的 `GlobalConfig` 中新增 `custom_mirrors` 字段**

在 `src-tauri/src/types.rs` 的 `GlobalConfig` struct 中，`skip_git_hooks` 字段之后添加：

```rust
    #[serde(default)]
    pub custom_mirrors: Vec<CustomMirror>,
```

在 `GlobalConfig` struct 之后（`fn default_true()` 之前）添加新类型：

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomMirror {
    pub name: String,
    pub url: String, // 前缀，如 "https://ghproxy.net/"
}
```

- [ ] **Step 2: 创建 `src-tauri/src/mirror.rs`，定义内置镜像列表和类型**

```rust
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;

use crate::config::load_global_config;
use crate::types::CustomMirror;

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

/// 测速文件：pip 24.3.1 release zip (~4MB)
const SPEED_TEST_BASE_URL: &str =
    "https://github.com/pypa/pip/archive/refs/tags/24.3.1.zip";

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
```

- [ ] **Step 3: 在 `lib.rs` 中添加 `mod mirror;`**

在 `src-tauri/src/lib.rs` 第 1 行 `mod commands;` 之后添加：

```rust
pub mod mirror;
```

- [ ] **Step 4: 运行 cargo check 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: 编译通过（可能有 unused 警告，无 error）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/mirror.rs src-tauri/src/types.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(mirror): add mirror types, builtin sources list, and GlobalConfig extension
EOF
)"
```

---

### Task 2: 并发测速实现

**Files:**
- Modify: `src-tauri/src/mirror.rs`

- [ ] **Step 1: 在 `mirror.rs` 中添加单源测速函数 `test_single_mirror`**

在 `clear_mirror_cache()` 函数之后添加：

```rust
// ==================== 测速逻辑 ====================

/// 对单个镜像源进行限时下载测速
async fn test_single_mirror(mirror: &MirrorSource) -> MirrorTestResult {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let test_url = format!(
        "{}{}?t={}",
        mirror.url, SPEED_TEST_BASE_URL, timestamp
    );

    log::info!("[mirror] Testing {}: {}", mirror.name, test_url);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(SPEED_TEST_DURATION_SECS + 2))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[mirror] Failed to build client for {}: {}", mirror.name, e);
            return MirrorTestResult {
                name: mirror.name.clone(),
                url: mirror.url.clone(),
                bytes_downloaded: 0,
                speed_mbps: 0.0,
                available: false,
            };
        }
    };

    let resp = match client.get(&test_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            log::warn!("[mirror] {} returned HTTP {}", mirror.name, r.status());
            return MirrorTestResult {
                name: mirror.name.clone(),
                url: mirror.url.clone(),
                bytes_downloaded: 0,
                speed_mbps: 0.0,
                available: false,
            };
        }
        Err(e) => {
            log::warn!("[mirror] {} connection failed: {}", mirror.name, e);
            return MirrorTestResult {
                name: mirror.name.clone(),
                url: mirror.url.clone(),
                bytes_downloaded: 0,
                speed_mbps: 0.0,
                available: false,
            };
        }
    };

    // Stream the response body for SPEED_TEST_DURATION_SECS seconds
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
```

- [ ] **Step 2: 添加并发测速函数 `test_all_mirrors`**

在 `test_single_mirror` 之后添加：

```rust
/// 并发测速所有镜像源
pub async fn test_all_mirrors() -> Vec<MirrorTestResult> {
    let mirrors = get_all_mirrors();
    log::info!("[mirror] Starting speed test for {} mirrors...", mirrors.len());

    let handles: Vec<_> = mirrors
        .into_iter()
        .map(|m| {
            tokio::spawn(async move { test_single_mirror(&m).await })
        })
        .collect();

    let mut results: Vec<MirrorTestResult> = Vec::new();
    for handle in handles {
        if let Ok(result) = handle.await {
            results.push(result);
        }
    }

    // 按下载量降序排序
    results.sort_by(|a, b| b.bytes_downloaded.cmp(&a.bytes_downloaded));

    // 更新缓存
    {
        let mut cache = MIRROR_CACHE.lock().unwrap();
        *cache = Some((Instant::now(), results.clone()));
    }

    results
}

/// 获取测速结果，优先用缓存（30 分钟 TTL）
pub async fn get_fastest_mirrors() -> Vec<MirrorTestResult> {
    {
        let cache = MIRROR_CACHE.lock().unwrap();
        if let Some((cached_at, ref results)) = *cache {
            if cached_at.elapsed().as_secs() < CACHE_TTL_SECS {
                log::info!("[mirror] Using cached speed test results ({} entries)", results.len());
                return results.clone();
            }
        }
    }

    test_all_mirrors().await
}
```

- [ ] **Step 3: 运行 cargo check 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/mirror.rs
git commit -m "$(cat <<'EOF'
feat(mirror): implement concurrent speed testing with real file download
EOF
)"
```

---

### Task 3: 后端命令 — 新增 3 个 + 改造 2 个

**Files:**
- Modify: `src-tauri/src/commands/system.rs:1247-1455`
- Modify: `src-tauri/src/lib.rs` (generate_handler)

- [ ] **Step 1: 新增 3 个 Tauri 命令到 `commands/system.rs`**

在 `download_update_via_mirror` 函数之后（`// ==================== HTTP Server 共享接口 ====================` 之前）添加：

```rust
// ==================== 镜像源管理 ====================

/// 触发测速，返回排序后的结果列表
#[tauri::command]
pub(crate) async fn test_mirror_speed() -> Result<Vec<crate::mirror::MirrorTestResult>, String> {
    log::info!("[system] Starting mirror speed test...");
    let results = crate::mirror::test_all_mirrors().await;
    log::info!("[system] Mirror speed test complete, {} results", results.len());
    Ok(results)
}

/// 返回所有镜像源（内置 + 自定义）
#[tauri::command]
pub(crate) fn get_mirror_sources() -> Vec<crate::mirror::MirrorSource> {
    crate::mirror::get_all_mirrors()
}

/// 保存用户自定义镜像源到 global.json
#[tauri::command]
pub(crate) fn save_custom_mirrors(mirrors: Vec<crate::types::CustomMirror>) -> Result<(), String> {
    let mut config = crate::config::load_global_config();
    config.custom_mirrors = mirrors;
    crate::config::save_global_config_internal(&config)?;
    crate::mirror::clear_mirror_cache();
    Ok(())
}
```

- [ ] **Step 2: 改造 `check_mirror_update` 接受 `mirror_url` 参数**

将 `src-tauri/src/commands/system.rs` 中现有的 `check_mirror_update` 函数整体替换为：

```rust
/// 通过指定镜像源检测最新版本（仅检测，不下载）
/// mirror_url: 镜像前缀，如 "https://ghproxy.net/"
#[tauri::command]
pub(crate) async fn check_mirror_update(mirror_url: String) -> Result<serde_json::Value, String> {
    log::info!("[system] Checking mirror update via: {}", mirror_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let github_url =
        "https://github.com/guoyongchang/worktree-manager/releases/latest/download/latest.json";
    let endpoint = format!("{}{}", mirror_url, github_url);
    let resp = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch mirror manifest: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Mirror returned HTTP {}", resp.status()));
    }

    let manifest: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse mirror manifest: {}", e))?;

    let version = manifest
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let pub_date = manifest
        .get("pub_date")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let notes = manifest
        .get("notes")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    log::info!(
        "[system] Mirror latest version: {} (pub_date: {})",
        version,
        pub_date
    );

    Ok(serde_json::json!({
        "version": version,
        "pub_date": pub_date,
        "notes": notes,
        "current_version": env!("CARGO_PKG_VERSION"),
    }))
}
```

- [ ] **Step 3: 改造 `download_update_via_mirror` 接受 `mirror_url` 参数并加 fallback**

将 `download_update_via_mirror` 函数整体替换为：

```rust
/// 通过镜像源下载更新，支持 fallback 到其他源
/// mirror_url: 首选镜像前缀
#[tauri::command]
pub(crate) async fn download_update_via_mirror(
    app: tauri::AppHandle,
    mirror_url: String,
) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    // 构建 fallback 列表：首选 → 缓存中的其他源（按速度排序）
    let mut fallback_urls = vec![mirror_url.clone()];
    {
        let cache = crate::mirror::get_cached_results();
        for result in cache {
            if result.available && result.url != mirror_url {
                fallback_urls.push(result.url);
            }
        }
    }
    // 最多尝试 3 个源
    fallback_urls.truncate(3);

    log::info!(
        "[system] Starting mirror update download, {} candidates: {:?}",
        fallback_urls.len(),
        fallback_urls.iter().map(|u| u.as_str()).collect::<Vec<_>>()
    );

    let mut last_error = String::new();

    for (attempt, current_mirror) in fallback_urls.iter().enumerate() {
        log::info!(
            "[system] Attempt {}/{}: using mirror {}",
            attempt + 1,
            fallback_urls.len(),
            current_mirror
        );

        if attempt > 0 {
            let _ = app.emit(
                "mirror-update-progress",
                serde_json::json!({
                    "event": "Fallback",
                    "data": { "mirror": current_mirror, "attempt": attempt + 1 }
                }),
            );
        }

        match download_with_mirror(&app, current_mirror).await {
            Ok(()) => {
                log::info!("[system] Mirror update download complete via {}", current_mirror);
                return Ok(());
            }
            Err(e) => {
                log::warn!("[system] Mirror {} failed: {}", current_mirror, e);
                last_error = e;
            }
        }
    }

    Err(format!(
        "All {} mirrors failed. Last error: {}",
        fallback_urls.len(),
        last_error
    ))
}

/// 使用指定镜像源执行下载（内部函数）
async fn download_with_mirror(app: &tauri::AppHandle, mirror_url: &str) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    // 1. Fetch latest.json from GitHub (directly, not via mirror)
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let github_manifest_url =
        "https://github.com/guoyongchang/worktree-manager/releases/latest/download/latest.json";
    let manifest_via_mirror = format!("{}{}", mirror_url, github_manifest_url);
    let resp = client
        .get(&manifest_via_mirror)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch update manifest: {}", e))?;
    let mut manifest: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse update manifest: {}", e))?;

    // 2. Modify all platform download URLs to use this mirror
    if let Some(platforms) = manifest.get_mut("platforms") {
        if let Some(obj) = platforms.as_object_mut() {
            for (platform, info) in obj.iter_mut() {
                if let Some(url_val) = info.get_mut("url") {
                    if let Some(url_str) = url_val.as_str() {
                        let proxied = format!("{}{}", mirror_url, url_str);
                        log::info!("[system] Proxied URL for {}: {}", platform, proxied);
                        *url_val = serde_json::Value::String(proxied);
                    }
                }
            }
        }
    }

    let manifest_body = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;

    // 3. Start a temporary local HTTP server to serve the modified manifest
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local server: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let router = axum::Router::new().route(
        "/latest.json",
        axum::routing::get(move || {
            let body = manifest_body.clone();
            async move { body }
        }),
    );

    struct AbortServerOnDrop(Option<tokio::task::JoinHandle<()>>);
    impl Drop for AbortServerOnDrop {
        fn drop(&mut self) {
            if let Some(handle) = self.0.take() {
                handle.abort();
            }
        }
    }

    let server_handle = tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });
    let mut server_guard = AbortServerOnDrop(Some(server_handle));

    // 4. Create a new updater instance pointing to the local endpoint
    let local_endpoint: url::Url = format!("http://127.0.0.1:{}/latest.json", port)
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;

    log::info!("[system] Local manifest server at: {}", local_endpoint);

    let updater = app
        .updater_builder()
        .endpoints(vec![local_endpoint])
        .map_err(|e| format!("Failed to set endpoints: {}", e))?
        .build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    // 5. Check for update
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Mirror update check failed: {}", e))?
        .ok_or_else(|| "No update available".to_string())?;

    log::info!("[system] Mirror update found: v{}", update.version);

    // 6. Download and install with progress events
    let app_for_chunk = app.clone();
    let app_for_finish = app.clone();
    let mut first_chunk = true;

    update
        .download_and_install(
            move |chunk_len: usize, content_length: Option<u64>| {
                if first_chunk {
                    first_chunk = false;
                    let _ = app_for_chunk.emit(
                        "mirror-update-progress",
                        serde_json::json!({
                            "event": "Started",
                            "data": { "contentLength": content_length.unwrap_or(0) }
                        }),
                    );
                }
                let _ = app_for_chunk.emit(
                    "mirror-update-progress",
                    serde_json::json!({
                        "event": "Progress",
                        "data": { "chunkLength": chunk_len }
                    }),
                );
            },
            move || {
                let _ = app_for_finish.emit(
                    "mirror-update-progress",
                    serde_json::json!({
                        "event": "Finished",
                        "data": {}
                    }),
                );
            },
        )
        .await
        .map_err(|e| format!("Mirror download failed: {}", e))?;

    // 7. Clean up local server
    if let Some(handle) = server_guard.0.take() {
        handle.abort();
    }

    Ok(())
}
```

- [ ] **Step 4: 在 `mirror.rs` 中添加 `get_cached_results` 辅助函数**

在 `mirror.rs` 的 `get_fastest_mirrors` 函数之后添加：

```rust
/// 读取缓存的测速结果（不触发新测速）
pub fn get_cached_results() -> Vec<MirrorTestResult> {
    let cache = MIRROR_CACHE.lock().unwrap();
    match &*cache {
        Some((_, results)) => results.clone(),
        None => Vec::new(),
    }
}
```

- [ ] **Step 5: 在 `lib.rs` 的 `generate_handler` 中注册新命令**

在 `src-tauri/src/lib.rs` 的 `generate_handler!` 宏中，找到：

```rust
            // 更新镜像
            check_mirror_update,
            download_update_via_mirror,
```

替换为：

```rust
            // 更新镜像
            check_mirror_update,
            download_update_via_mirror,
            test_mirror_speed,
            get_mirror_sources,
            save_custom_mirrors,
```

- [ ] **Step 6: 在 `lib.rs` 顶部添加新命令的 use 导入**

在 `src-tauri/src/lib.rs` 中找到：

```rust
use commands::system::*;
```

确认这行已存在（`use commands::system::*;` 会自动包含所有 pub(crate) 函数）。

同样确认 `pub use commands::system::` 的 re-export 列表中添加新的 `_internal` 函数（如果 http_server 需要）。由于新命令不需要 `_internal` 变体（直接调用 mirror 模块），这步无需修改。

- [ ] **Step 7: 运行 cargo check 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译通过

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/system.rs src-tauri/src/mirror.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(mirror): add test_mirror_speed, get_mirror_sources, save_custom_mirrors commands; refactor check/download to accept mirror_url with fallback
EOF
)"
```

---

### Task 4: HTTP Server 路由同步

**Files:**
- Modify: `src-tauri/src/http_server.rs`
- Modify: `src-tauri/src/http_server/routing.rs`
- Modify: `src-tauri/src/http_server/middleware.rs`

- [ ] **Step 1: 在 `http_server.rs` 中添加 3 个新 handler + 修改 2 个现有 handler**

在 `src-tauri/src/http_server.rs` 中找到：

```rust
async fn h_check_mirror_update() -> Response {
    result_json(crate::commands::system::check_mirror_update().await)
}

async fn h_download_update_via_mirror() -> Response {
    let app = match current_app_handle() {
        Ok(app) => app,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    result_ok(crate::commands::system::download_update_via_mirror(app).await)
}
```

替换为：

```rust
async fn h_check_mirror_update(Json(payload): Json<serde_json::Value>) -> Response {
    let mirror_url = payload
        .get("mirror_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://gh-proxy.org/")
        .to_string();
    result_json(crate::commands::system::check_mirror_update(mirror_url).await)
}

async fn h_download_update_via_mirror(Json(payload): Json<serde_json::Value>) -> Response {
    let app = match current_app_handle() {
        Ok(app) => app,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    let mirror_url = payload
        .get("mirror_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://gh-proxy.org/")
        .to_string();
    result_ok(
        crate::commands::system::download_update_via_mirror(app, mirror_url).await,
    )
}

async fn h_test_mirror_speed() -> Response {
    result_json(crate::commands::system::test_mirror_speed().await)
}

async fn h_get_mirror_sources() -> Response {
    (StatusCode::OK, Json(json!(crate::commands::system::get_mirror_sources()))).into_response()
}

async fn h_save_custom_mirrors(Json(payload): Json<serde_json::Value>) -> Response {
    let mirrors: Vec<crate::types::CustomMirror> = match payload.get("mirrors") {
        Some(v) => match serde_json::from_value(v.clone()) {
            Ok(m) => m,
            Err(e) => return (StatusCode::BAD_REQUEST, format!("Invalid mirrors: {}", e)).into_response(),
        },
        None => return (StatusCode::BAD_REQUEST, "Missing 'mirrors' field").into_response(),
    };
    result_ok(crate::commands::system::save_custom_mirrors(mirrors))
}
```

- [ ] **Step 2: 在 `routing.rs` 中添加 3 条新路由 + import 新 handler**

在 `src-tauri/src/http_server/routing.rs` 的 import 块中，找到：

```rust
    h_check_mirror_update,
```

在同一区域确认 `h_test_mirror_speed`, `h_get_mirror_sources`, `h_save_custom_mirrors` 也被 import。由于 `use super::{ ... }` 块需要添加这三个名称。

在 import 列表中 `h_check_mirror_update` 之后添加：

```rust
    h_test_mirror_speed, h_get_mirror_sources, h_save_custom_mirrors,
```

在 `build_api_router` 函数中，找到：

```rust
        .route(
            "/api/download_update_via_mirror",
            post(h_download_update_via_mirror),
        )
```

在其之后添加：

```rust
        .route("/api/test_mirror_speed", post(h_test_mirror_speed))
        .route("/api/get_mirror_sources", post(h_get_mirror_sources))
        .route("/api/save_custom_mirrors", post(h_save_custom_mirrors))
```

- [ ] **Step 3: 在 `middleware.rs` 中将新命令加入 localhost_only**

在 `src-tauri/src/http_server/middleware.rs` 的 `is_localhost_only_path` 函数中，找到：

```rust
            | "/api/download_update_via_mirror"
            | "/api/open_devtools"
```

替换为：

```rust
            | "/api/download_update_via_mirror"
            | "/api/test_mirror_speed"
            | "/api/save_custom_mirrors"
            | "/api/open_devtools"
```

- [ ] **Step 4: 运行 cargo check 验证编译**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server.rs src-tauri/src/http_server/routing.rs src-tauri/src/http_server/middleware.rs
git commit -m "$(cat <<'EOF'
feat(mirror): add HTTP routes for test_mirror_speed, get_mirror_sources, save_custom_mirrors
EOF
)"
```

---

### Task 5: 国际化文本

**Files:**
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

- [ ] **Step 1: 在 `zh-CN.json` 中添加镜像源相关 i18n key**

在 `src/locales/zh-CN.json` 中找到：

```json
  "updater.checkFailed": "检测失败",
```

在其之后添加：

```json
  "updater.speedTesting": "正在测速...",
  "updater.speedTestProgress": "正在测速 {{current}}/{{total}}...",
  "updater.speedTestComplete": "测速完成",
  "updater.mirrorSpeed": "{{speed}} MB/s",
  "updater.mirrorAvailable": "可用",
  "updater.mirrorUnavailable": "不可用",
  "updater.downloadVia": "通过 {{name}} 下载",
  "updater.addCustomMirror": "添加自定义镜像源",
  "updater.mirrorName": "名称",
  "updater.mirrorUrl": "URL 前缀",
  "updater.addMirror": "添加",
  "updater.removeMirror": "删除",
  "updater.bestMirror": "最快: {{name}} ({{speed}} MB/s)",
  "updater.noMirrorAvailable": "所有镜像源不可用",
  "updater.mirrorFallback": "正在切换镜像源重试...",
  "updater.mirrorList": "镜像源列表",
  "updater.builtinMirror": "内置",
  "updater.customMirror": "自定义",
  "updater.retest": "重新测速",
```

- [ ] **Step 2: 在 `en-US.json` 中添加对应的英文 key**

在 `src/locales/en-US.json` 中找到 `"updater.checkFailed"` 行，在其之后添加：

```json
  "updater.speedTesting": "Speed testing...",
  "updater.speedTestProgress": "Testing {{current}}/{{total}}...",
  "updater.speedTestComplete": "Speed test complete",
  "updater.mirrorSpeed": "{{speed}} MB/s",
  "updater.mirrorAvailable": "Available",
  "updater.mirrorUnavailable": "Unavailable",
  "updater.downloadVia": "Download via {{name}}",
  "updater.addCustomMirror": "Add custom mirror",
  "updater.mirrorName": "Name",
  "updater.mirrorUrl": "URL prefix",
  "updater.addMirror": "Add",
  "updater.removeMirror": "Remove",
  "updater.bestMirror": "Fastest: {{name}} ({{speed}} MB/s)",
  "updater.noMirrorAvailable": "No mirror available",
  "updater.mirrorFallback": "Retrying with another mirror...",
  "updater.mirrorList": "Mirror sources",
  "updater.builtinMirror": "Built-in",
  "updater.customMirror": "Custom",
  "updater.retest": "Retest",
```

- [ ] **Step 3: Commit**

```bash
git add src/locales/zh-CN.json src/locales/en-US.json
git commit -m "$(cat <<'EOF'
i18n: add mirror source management translations for zh-CN and en-US
EOF
)"
```

---

### Task 6: 前端 Hook — useUpdater 扩展

**Files:**
- Modify: `src/hooks/useUpdater.ts`

- [ ] **Step 1: 添加新的类型定义和状态**

在 `src/hooks/useUpdater.ts` 顶部的 `DownloadProgress` interface 之后添加：

```typescript
export interface MirrorSource {
  name: string;
  url: string;
  builtin: boolean;
}

export interface MirrorTestResult {
  name: string;
  url: string;
  bytes_downloaded: number;
  speed_mbps: number;
  available: boolean;
}
```

在 `UseUpdaterReturn` interface 中，`mirrorError: string;` 之后添加：

```typescript
  // Mirror source management
  mirrorTestResults: MirrorTestResult[];
  selectedMirror: MirrorSource | null;
  speedTesting: boolean;
  testMirrorSpeed: () => Promise<void>;
  addCustomMirror: (name: string, url: string) => Promise<void>;
  removeCustomMirror: (name: string) => Promise<void>;
```

- [ ] **Step 2: 在 `useUpdater` 函数中添加新状态变量**

在 `const [mirrorError, setMirrorError] = useState('');` 之后添加：

```typescript
  const [mirrorTestResults, setMirrorTestResults] = useState<MirrorTestResult[]>([]);
  const [selectedMirror, setSelectedMirror] = useState<MirrorSource | null>(null);
  const [speedTesting, setSpeedTesting] = useState(false);
```

- [ ] **Step 3: 添加 `testMirrorSpeed` 方法**

在 `checkMirrorChannel` 之后添加：

```typescript
  const testMirrorSpeed = useCallback(async () => {
    setSpeedTesting(true);
    try {
      const results = await callBackend<MirrorTestResult[]>('test_mirror_speed');
      setMirrorTestResults(results);
      // 自动选择最快的可用源
      const fastest = results.find((r) => r.available);
      if (fastest) {
        setSelectedMirror({ name: fastest.name, url: fastest.url, builtin: true });
      }
    } catch (err) {
      console.error('[updater] Mirror speed test failed:', err);
    } finally {
      setSpeedTesting(false);
    }
  }, []);
```

- [ ] **Step 4: 添加 `addCustomMirror` 和 `removeCustomMirror` 方法**

在 `testMirrorSpeed` 之后添加：

```typescript
  const addCustomMirror = useCallback(async (name: string, url: string) => {
    try {
      const sources = await callBackend<MirrorSource[]>('get_mirror_sources');
      const customMirrors = sources
        .filter((s) => !s.builtin)
        .map((s) => ({ name: s.name, url: s.url }));
      customMirrors.push({ name, url });
      await callBackend('save_custom_mirrors', { mirrors: customMirrors });
    } catch (err) {
      console.error('[updater] Failed to add custom mirror:', err);
    }
  }, []);

  const removeCustomMirror = useCallback(async (name: string) => {
    try {
      const sources = await callBackend<MirrorSource[]>('get_mirror_sources');
      const customMirrors = sources
        .filter((s) => !s.builtin && s.name !== name)
        .map((s) => ({ name: s.name, url: s.url }));
      await callBackend('save_custom_mirrors', { mirrors: customMirrors });
    } catch (err) {
      console.error('[updater] Failed to remove custom mirror:', err);
    }
  }, []);
```

- [ ] **Step 5: 修改 `checkMirrorChannel` 使用测速+最快源**

将 `checkMirrorChannel` 整体替换为：

```typescript
  const checkMirrorChannel = useCallback(async () => {
    setMirrorStatus('checking');
    try {
      // 先测速
      setSpeedTesting(true);
      const results = await callBackend<MirrorTestResult[]>('test_mirror_speed');
      setMirrorTestResults(results);
      setSpeedTesting(false);

      const fastest = results.find((r) => r.available);
      if (!fastest) {
        setMirrorError('No mirror available');
        setMirrorStatus('error');
        return;
      }

      setSelectedMirror({ name: fastest.name, url: fastest.url, builtin: true });

      // 用最快源检查更新
      const manifest = await callBackend<{
        version: string;
        pub_date: string;
        notes: string;
        current_version: string;
      }>('check_mirror_update', { mirror_url: fastest.url });

      const latestVersion = manifest.version;
      const currentVersion = manifest.current_version;

      setMirrorVersion(latestVersion);
      if (latestVersion && latestVersion !== currentVersion) {
        if (!updateRef.current) {
          setUpdateInfo((prev) =>
            prev ?? {
              version: latestVersion,
              currentVersion,
              date: manifest.pub_date?.split('T')[0] ?? new Date().toISOString().split('T')[0],
              notes: manifest.notes
                ? String(manifest.notes).split('\n').filter((l: string) => l.trim())
                : [],
            },
          );
        }
        setMirrorStatus('available');
      } else {
        setMirrorStatus('up-to-date');
      }
    } catch (err) {
      console.error('[updater] Mirror channel check failed:', err);
      setMirrorError(String(err));
      setMirrorStatus('error');
      setSpeedTesting(false);
    }
  }, []);
```

- [ ] **Step 6: 修改 `downloadViaMirror` 传入选中的镜像 URL**

将 `downloadViaMirror` 中的：

```typescript
      await callBackend('download_update_via_mirror');
```

替换为：

```typescript
      await callBackend('download_update_via_mirror', {
        mirror_url: selectedMirror?.url ?? 'https://gh-proxy.org/',
      });
```

- [ ] **Step 7: 在 return 对象中添加新属性**

在 return 对象中 `mirrorError,` 之后添加：

```typescript
    mirrorTestResults,
    selectedMirror,
    speedTesting,
    testMirrorSpeed,
    addCustomMirror,
    removeCustomMirror,
```

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useUpdater.ts
git commit -m "$(cat <<'EOF'
feat(mirror): extend useUpdater with speed testing, mirror selection, custom mirror management
EOF
)"
```

---

### Task 7: 前端 UI — UpdateCheckerDialog 改版

**Files:**
- Modify: `src/components/UpdateCheckerDialog.tsx`
- Modify: `src/components/GlobalDialogs.tsx` (传递新 props)

- [ ] **Step 1: 更新 `UpdateCheckerDialog` 的 props 和 import**

在 `src/components/UpdateCheckerDialog.tsx` 顶部的 import 中添加 `Input`：

```typescript
import { Input } from '@/components/ui/input';
```

更新 lucide-react import，添加 `Zap`, `Plus`, `Trash2`, `ChevronDown`, `ChevronUp`：

```typescript
import {
  Rocket,
  CheckCircle,
  AlertTriangle,
  Loader2,
  ArrowRight,
  Globe,
  Github,
  Zap,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
```

更新 import from useUpdater，添加新类型：

```typescript
import type { UpdateInfo, ChannelStatus, MirrorTestResult, MirrorSource } from '@/hooks/useUpdater';
```

更新 `UpdateCheckerDialogProps`：

```typescript
interface UpdateCheckerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  officialStatus: ChannelStatus;
  mirrorStatus: ChannelStatus;
  updateInfo: UpdateInfo | null;
  mirrorVersion: string | null;
  officialError: string;
  mirrorError: string;
  onOfficialDownload: () => void;
  onMirrorDownload: () => void;
  // New mirror management props
  mirrorTestResults: MirrorTestResult[];
  selectedMirror: MirrorSource | null;
  speedTesting: boolean;
  onTestSpeed: () => void;
  onAddCustomMirror: (name: string, url: string) => Promise<void>;
  onRemoveCustomMirror: (name: string) => Promise<void>;
}
```

- [ ] **Step 2: 创建 MirrorListPanel 子组件**

在 `UpdateCheckerDialog` 组件之前添加：

```typescript
// --- Mirror List Panel ---

interface MirrorListPanelProps {
  results: MirrorTestResult[];
  selectedMirror: MirrorSource | null;
  speedTesting: boolean;
  onTestSpeed: () => void;
  onAddCustomMirror: (name: string, url: string) => Promise<void>;
  onRemoveCustomMirror: (name: string) => Promise<void>;
}

const MirrorListPanel: FC<MirrorListPanelProps> = ({
  results,
  selectedMirror,
  speedTesting,
  onTestSpeed,
  onAddCustomMirror,
  onRemoveCustomMirror,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const handleAdd = async () => {
    const name = newName.trim();
    let url = newUrl.trim();
    if (!name || !url) return;
    if (!url.endsWith('/')) url += '/';
    await onAddCustomMirror(name, url);
    setNewName('');
    setNewUrl('');
    onTestSpeed(); // 重新测速以包含新源
  };

  return (
    <div className="mt-2">
      {/* Best mirror summary + expand toggle */}
      <button
        type="button"
        className="w-full flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-300 transition-colors py-1"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-emerald-400" />
          {speedTesting
            ? t('updater.speedTesting')
            : selectedMirror
              ? t('updater.bestMirror', {
                  name: selectedMirror.name,
                  speed: results.find((r) => r.url === selectedMirror.url)?.speed_mbps ?? '?',
                })
              : t('updater.mirrorList')}
        </span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="mt-1 rounded-lg bg-slate-800/50 border border-slate-700/50 p-2 space-y-1">
          {/* Mirror list */}
          {results.map((r) => (
            <div
              key={r.name}
              className={`flex items-center justify-between text-[11px] px-2 py-1 rounded ${
                selectedMirror?.url === r.url
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'hover:bg-slate-700/50'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full ${r.available ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="text-slate-300 truncate">{r.name}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {r.available ? (
                  <span className="text-emerald-400">{r.speed_mbps} MB/s</span>
                ) : (
                  <span className="text-red-400">{t('updater.mirrorUnavailable')}</span>
                )}
              </span>
            </div>
          ))}

          {results.length === 0 && !speedTesting && (
            <div className="text-[11px] text-slate-500 text-center py-2">
              {t('updater.noMirrorAvailable')}
            </div>
          )}

          {speedTesting && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
              <span className="text-[11px] text-slate-400">{t('updater.speedTesting')}</span>
            </div>
          )}

          {/* Retest button */}
          {!speedTesting && results.length > 0 && (
            <button
              type="button"
              className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors py-1"
              onClick={onTestSpeed}
            >
              {t('updater.retest')}
            </button>
          )}

          {/* Add custom mirror */}
          <div className="pt-1 border-t border-slate-700/50">
            <p className="text-[10px] text-slate-500 mb-1">{t('updater.addCustomMirror')}</p>
            <div className="flex gap-1.5">
              <Input
                className="h-6 text-[11px] flex-1 min-w-0"
                placeholder={t('updater.mirrorName')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                className="h-6 text-[11px] flex-[2] min-w-0"
                placeholder={t('updater.mirrorUrl')}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={handleAdd}
                disabled={!newName.trim() || !newUrl.trim()}
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 3: 更新 `UpdateCheckerDialog` 组件接收和使用新 props**

更新 `UpdateCheckerDialog` 的 destructured props，添加新字段：

```typescript
export const UpdateCheckerDialog: FC<UpdateCheckerDialogProps> = ({
  open,
  onOpenChange,
  officialStatus,
  mirrorStatus,
  updateInfo,
  mirrorVersion,
  officialError,
  mirrorError,
  onOfficialDownload,
  onMirrorDownload,
  mirrorTestResults,
  selectedMirror,
  speedTesting,
  onTestSpeed,
  onAddCustomMirror,
  onRemoveCustomMirror,
}) => {
```

将镜像渠道 `ChannelCard` 的 `subtitle` 从硬编码 `"gh-proxy.org"` 改为动态显示选中源：

找到：

```typescript
            <ChannelCard
              title={t('updater.mirrorChannel')}
              subtitle="gh-proxy.org"
```

替换为：

```typescript
            <ChannelCard
              title={t('updater.mirrorChannel')}
              subtitle={selectedMirror?.name ?? 'GHProxy'}
```

将镜像渠道 `ChannelCard` 的 `buttonLabel` 改为显示源名称：

找到：

```typescript
              buttonLabel={t('updater.mirrorDownload')}
```

替换为：

```typescript
              buttonLabel={selectedMirror ? t('updater.downloadVia', { name: selectedMirror.name }) : t('updater.mirrorDownload')}
```

在镜像渠道 `ChannelCard` 之后、`</div>` 关闭 flex gap-3 容器之前，在 `</div>` 内部（与两个 ChannelCard 同级）之后添加 MirrorListPanel：

找到：

```typescript
          </div>
        </div>

        {/* Release Notes (shown if any channel found update) */}
```

替换为：

```typescript
          </div>

          {/* Mirror source list */}
          <MirrorListPanel
            results={mirrorTestResults}
            selectedMirror={selectedMirror}
            speedTesting={speedTesting}
            onTestSpeed={onTestSpeed}
            onAddCustomMirror={onAddCustomMirror}
            onRemoveCustomMirror={onRemoveCustomMirror}
          />
        </div>

        {/* Release Notes (shown if any channel found update) */}
```

- [ ] **Step 4: 更新 `GlobalDialogs.tsx` 传递新 props**

读取 `src/components/GlobalDialogs.tsx` 找到 `UpdateCheckerDialog` 的使用位置，添加新 props。

找到类似：

```typescript
        <UpdateCheckerDialog
          ...
          onMirrorDownload={updater.downloadViaMirror}
        />
```

在 `onMirrorDownload` 之后添加：

```typescript
          mirrorTestResults={updater.mirrorTestResults}
          selectedMirror={updater.selectedMirror}
          speedTesting={updater.speedTesting}
          onTestSpeed={updater.testMirrorSpeed}
          onAddCustomMirror={updater.addCustomMirror}
          onRemoveCustomMirror={updater.removeCustomMirror}
```

- [ ] **Step 5: 运行 `npm run build` 验证前端编译**

Run: `npm run build 2>&1 | tail -10`
Expected: 编译通过

- [ ] **Step 6: Commit**

```bash
git add src/components/UpdateCheckerDialog.tsx src/components/GlobalDialogs.tsx
git commit -m "$(cat <<'EOF'
feat(mirror): redesign UpdateCheckerDialog with mirror list panel and custom mirror management
EOF
)"
```

---

### Task 8: 全链路验证

**Files:** 无新文件，全链路检查

- [ ] **Step 1: Rust 全量检查**

Run: `cd src-tauri && cargo clippy 2>&1 | tail -20`
Expected: 无 error（warning 可接受）

- [ ] **Step 2: Rust 格式检查**

Run: `cd src-tauri && cargo fmt --check 2>&1`
Expected: 无输出（已格式化）。如有输出，运行 `cargo fmt` 修复。

- [ ] **Step 3: 前端全量检查**

Run: `npm run build 2>&1 | tail -10`
Expected: 编译通过

- [ ] **Step 4: 命令契约同步检查**

Run: `npm run contracts 2>&1 | tail -20`
Expected: 通过（新增命令三处同步：generate_handler + HTTP routes + backend.ts 已通过 callBackend 通用调用）

- [ ] **Step 5: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(mirror): resolve clippy/fmt/build issues from full verification
EOF
)"
```
