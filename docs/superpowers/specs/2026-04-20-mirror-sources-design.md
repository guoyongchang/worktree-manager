# Mirror Sources 多镜像源设计

## 概述

将硬编码的 `gh-proxy.org` 单镜像源替换为多镜像源 + 自动测速 + 用户自定义系统。用户检查更新时自动并发测速所有源，选最快的进行下载，失败自动 fallback。

## 内置镜像源列表

```rust
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
```

镜像 URL 格式：`{mirror_prefix}{github_url}`，例如 `https://ghproxy.net/https://github.com/...`。

## 测速方案

**测试文件**：`https://github.com/pypa/pip/archive/refs/tags/24.3.1.zip?t={timestamp}`（~4MB）

**策略**：
- 用户点击检查更新时，并发测速所有源（内置 + 自定义）
- 每个源限时 10 秒，通过镜像代理下载测试文件
- 记录 10 秒内下载的总字节数作为排序依据
- `?t={timestamp}` 防止 CDN 缓存
- 过滤掉 0 字节（不可用）的源
- 结果缓存 30 分钟（进程内 `Mutex<Option<(Instant, Vec<MirrorTestResult>)>>`）

**下载 fallback**：用测速排名第一的源下载，失败自动切换到第二、第三名，最多尝试 3 个源。

## 后端变更

### 1. 新增 `src-tauri/src/mirror.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorSource {
    pub name: String,
    pub url: String,       // 前缀，如 "https://ghproxy.net/"
    pub builtin: bool,     // 是否为内置源
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MirrorTestResult {
    pub name: String,
    pub url: String,
    pub bytes_downloaded: u64,  // 10 秒内下载的字节数
    pub speed_mbps: f64,        // 换算为 MB/s
    pub available: bool,
}

// 测速文件 URL
const SPEED_TEST_URL: &str = "https://github.com/pypa/pip/archive/refs/tags/24.3.1.zip";

/// 获取所有镜像源（内置 + 用户自定义）
pub fn get_all_mirrors() -> Vec<MirrorSource>

/// 并发测速所有镜像源，每个限时 10 秒
pub async fn test_all_mirrors(custom_mirrors: Vec<MirrorSource>) -> Vec<MirrorTestResult>

/// 获取缓存的测速结果（30 分钟 TTL），无缓存则触发测速
pub async fn get_fastest_mirrors(custom_mirrors: Vec<MirrorSource>) -> Vec<MirrorTestResult>

/// 清除缓存
pub fn clear_mirror_cache()
```

### 2. 修改 `GlobalConfig`（types.rs）

```rust
pub struct GlobalConfig {
    // ... existing fields ...
    #[serde(default)]
    pub custom_mirrors: Vec<CustomMirror>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomMirror {
    pub name: String,
    pub url: String,
}
```

### 3. 修改 `commands/system.rs`

- `check_mirror_update()` → `check_mirror_update(mirror_url: Option<String>)`
  - 接受前端传入的镜像 URL 前缀
  - 无参数时使用默认第一个内置源
- `download_update_via_mirror(mirror_url: String)` → 接受镜像 URL
  - 新增 fallback 逻辑：失败时尝试下一个源
- 新增命令 `test_mirror_speed()` — 触发测速，返回结果列表
- 新增命令 `get_mirror_sources()` — 返回内置+自定义源列表
- 新增命令 `save_custom_mirrors(mirrors: Vec<CustomMirror>)` — 保存自定义源到 global.json

### 4. 命令注册

`lib.rs` generate_handler 新增：`test_mirror_speed`, `get_mirror_sources`, `save_custom_mirrors`

`http_server` routing 新增对应的 HTTP 端点。

`backend.ts` 无需修改（已有通用 `callBackend`）。

## 前端变更

### 1. `useUpdater.ts` 扩展

新增状态：
```typescript
// 测速相关
mirrorSources: MirrorSource[]        // 所有源列表
mirrorTestResults: MirrorTestResult[] // 测速结果（按速度排序）
selectedMirror: string | null         // 当前选中的镜像 URL
speedTesting: boolean                 // 是否正在测速
```

新增方法：
```typescript
testMirrorSpeed(): Promise<void>      // 触发测速
addCustomMirror(name, url): void      // 添加自定义源
removeCustomMirror(name): void        // 删除自定义源
```

流程变更：
- `checkMirrorChannel` 改为：先测速 → 用最快源检查更新
- `downloadViaMirror` 传入选中的镜像 URL（非硬编码）

### 2. `UpdateCheckerDialog.tsx` 改版

镜像渠道卡片重新设计：

**检查中状态**：显示测速进度（"正在测速 3/10..."），测速完成后显示最快源名称和速度。

**发现更新状态**：
- 显示"通过 {mirror_name} 检测到更新 v{version}"
- 下方显示可展开的镜像源列表：
  - 每行：`{name} | {speed} MB/s | ✓可用 / ✗不可用`
  - 用户可点击切换使用其他源
  - 列表底部：添加自定义镜像源输入框（name + URL）
  - 已添加的自定义源可删除

**下载按钮**：显示 "通过 {mirror_name} 下载"。

### 3. 国际化

`zh-CN.json` 和 `en-US.json` 新增：
```json
"updater.speedTesting": "正在测速..." / "Speed testing..."
"updater.speedTestProgress": "正在测速 {{current}}/{{total}}..." / "Testing {{current}}/{{total}}..."
"updater.mirrorSpeed": "{{speed}} MB/s" / "{{speed}} MB/s"
"updater.mirrorAvailable": "可用" / "Available"
"updater.mirrorUnavailable": "不可用" / "Unavailable"
"updater.downloadVia": "通过 {{name}} 下载" / "Download via {{name}}"
"updater.addCustomMirror": "添加自定义镜像源" / "Add custom mirror"
"updater.mirrorName": "名称" / "Name"
"updater.mirrorUrl": "URL 前缀" / "URL prefix"
"updater.removeMirror": "删除" / "Remove"
"updater.bestMirror": "最快: {{name}} ({{speed}} MB/s)" / "Fastest: {{name}} ({{speed}} MB/s)"
"updater.noMirrorAvailable": "所有镜像源不可用" / "No mirror available"
"updater.mirrorFallback": "正在切换镜像源重试..." / "Retrying with another mirror..."
```

## 文件清单

| 文件 | 变更类型 |
|------|---------|
| `src-tauri/src/mirror.rs` | 新增 |
| `src-tauri/src/types.rs` | 修改（GlobalConfig 加 custom_mirrors） |
| `src-tauri/src/commands/system.rs` | 修改（改造 2 个命令 + 新增 3 个命令） |
| `src-tauri/src/lib.rs` | 修改（注册新命令） |
| `src-tauri/src/http_server/routing.rs` | 修改（新增路由） |
| `src-tauri/src/http_server.rs` | 修改（新增 handler） |
| `src/hooks/useUpdater.ts` | 修改（扩展测速/源管理状态） |
| `src/components/UpdateCheckerDialog.tsx` | 修改（重新设计镜像卡片） |
| `src/locales/zh-CN.json` | 修改（新增 i18n key） |
| `src/locales/en-US.json` | 修改（新增 i18n key） |
