# 分享安全测试设计文档

**日期：** 2026-04-12  
**项目：** worktree-manager  
**主题：** 补齐分享与浏览器访问边界的安全测试

---

## 目标

当前仓库已经有：

- 前端 `vitest` 测试
- Rust 单元测试
- HTTP API surface smoke 测试
- GitHub CI 中的类型、契约、前端测试和 Rust 测试门禁

但分享相关的安全语义测试仍然偏薄，尤其是浏览器访问路径的真实边界：

- 未认证访问是否被正确拦截
- 非 localhost 是否被禁止执行危险命令
- challenge/verify 是否具备最基本的限流和一次性使用约束
- session 是否只在认证成功后建立
- 允许旁路的端点集合是否足够小且可验证

本次工作目标不是“让所有 API 都有一份测试”，而是按最佳实践优先补齐高风险外部暴露面的安全测试，并把这些测试纳入现有 CI 门禁。

---

## 范围

本次范围只覆盖“分享与浏览器访问”的安全边界，重点是浏览器模式下通过 HTTP/WebSocket 暴露给 LAN 或 ngrok 的接口。

包括：

- `auth_middleware` 的认证拦截语义
- `localhost_only_middleware` 的 host-only 保护语义
- `h_auth_challenge` 的 salt 依赖与限流语义
- `h_auth_verify` 的 proof、nonce、session 建立语义
- `AUTHENTICATED_SESSIONS`、`CONNECTED_CLIENTS`、`NONCE_CACHE`、`AUTH_RATE_LIMITER` 的测试隔离
- 现有 router smoke 在安全测试体系中的定位说明

不包括：

- 所有内部 Tauri command 的安全回归
- Git 操作本身的权限模型
- 配置迁移、兼容性和旧字段反序列化安全
- 浏览器端视觉交互细节
- 大规模 E2E 自动化

---

## 设计原则

### 1. 风险优先，而不是接口数量优先

优先覆盖外部暴露面和鉴权边界，而不是把所有 API 机械地逐个补测。

### 2. 真实边界用真实链路验证

安全语义优先通过 `create_router()` 加 `oneshot()` 验证真实中间件链，而不是只直接调用 handler。

### 3. 纯逻辑与集成边界分层

不把所有测试都塞进 router 级别。纯逻辑状态机和缓存行为应在定义处就地测试，保持快和稳。

### 4. 全局状态必须显式隔离

分享能力依赖多个全局 `Lazy<Mutex<...>>` 状态。任何安全测试如果不显式保存和恢复状态，都会在后续演变中变脆。

### 5. CI 只接受稳定测试

本次新增测试不能依赖真实网络、真实分享启动、真实 ngrok、真实浏览器，也不能依赖测试执行顺序。

---

## 测试矩阵

### Layer A: 纯逻辑单元测试

落点：

- `src-tauri/src/types.rs`
- 其他逻辑定义所在文件

覆盖目标：

- `AuthRateLimiter` 的窗口内计数与阈值行为
- `NonceCache` 的生成、消费、一次性语义
- 必要时补充本地路径白名单相关纯逻辑函数

价值：

- 快
- 稳
- 能覆盖边界条件
- 出问题时定位清晰

### Layer B: Router/handler 安全测试

落点：

- `src-tauri/src/http_server.rs` 的 `#[cfg(test)] mod tests`

覆盖目标：

- 未认证 session 访问受保护路由返回 `401`
- 已认证 session 访问相同路由时不再被 `401` 拦截
- 非 loopback 地址访问 localhost-only 路由返回 `403`
- loopback 地址访问相同路由时允许进入 handler
- `challenge` 在无 `auth_salt` 时失败
- `challenge` 在同一 IP 超阈值时返回 `429`
- `challenge` 正常时返回 `nonce + salt`
- `verify` 仅在正确 `proof + nonce` 时建立 session
- 错误 `proof` 返回 `401`
- 已消费 `nonce` 不能再次使用
- 同 IP 旧的非活跃 session 会在新的认证成功后被清理
- 允许旁路的少数端点不会被认证中间件误拦截

说明：

这层是本次工作的核心，因为它直接证明“真实安全边界是否生效”。

### Layer C: API Surface Smoke

落点：

- `src-tauri/src/http_server.rs` 中现有 router smoke

覆盖目标：

- 所有 `/api/*` 路由存在
- 路由不会在最小输入下直接 `404` 或 `500`

说明：

这层只证明路由面稳定，不证明安全语义正确。它必须保留，但不能替代 Layer B。

### Layer D: 前端烟测

本次不把前端测试作为主工作面。

仅在实现后发现某个安全相关用户流程容易回归时，才补最少量的前端烟测，例如：

- 浏览器密码认证失败后的错误展示
- 成功认证后 session 写入行为的 UI 级表现

默认不在本次范围中扩展。

---

## 本次必须交付的测试清单

### 1. 认证中间件

必须覆盖：

- 当 `SHARE_STATE.active = true` 且存在 `auth_key` 时，普通受保护 `/api/*` 路由对未认证请求返回 `401`
- 将 `x-session-id` 写入 `AUTHENTICATED_SESSIONS` 后，相同请求不再被 `401` 拦截
- 认证白名单旁路仅限预期端点：
  - `/api/auth/challenge`
  - `/api/auth/verify`
  - `/api/get_share_info`
  - `/api/cert.pem`
  - `/ws`

### 2. Localhost-only 保护

必须覆盖：

- 非 loopback 地址访问危险命令返回 `403`
- loopback 地址访问同一路由时允许进入 handler

建议使用高风险端点之一：

- `/api/open_in_terminal`
- `/api/set_ngrok_token`

### 3. Challenge

必须覆盖：

- 缺少 `auth_salt` 时 `challenge` 返回失败
- 同一 IP 在窗口期内第 6 次请求返回 `429`
- 正常请求返回 `nonce` 和十六进制编码的 `salt`

### 4. Verify

必须覆盖：

- 正确 `proof + nonce` 返回成功并建立 session
- 错误 `proof` 返回 `401`
- 已消费 nonce 再次提交返回失败
- 未配置密码时不能建立有效 session

### 5. Session 生命周期

必须覆盖：

- 认证成功后 session 被写入 `AUTHENTICATED_SESSIONS`
- 同 IP 下旧的无活动 session 被清理
- 测试结束后所有全局状态被恢复，后续测试不受污染

---

## 文件组织

### 主测试文件

主要新增或增强以下文件中的测试：

- `src-tauri/src/http_server.rs`
- `src-tauri/src/types.rs`

原因：

- `http_server.rs` 已经有 router smoke 和 `ShareAuthGuard`
- `types.rs` 是 `AuthRateLimiter` 与 `NonceCache` 的定义处
- 这样可以复用现有测试结构，降低接线成本

### 共享测试守卫

需要在 `http_server.rs` 的测试模块中引入一个更完整的测试状态守卫，用于保存和恢复：

- `SHARE_STATE`
- `AUTHENTICATED_SESSIONS`
- `CONNECTED_CLIENTS`
- `AUTH_RATE_LIMITER`
- `NONCE_CACHE`

要求：

- 每个测试都能独立运行
- 对会修改全局分享状态的测试，通过一个测试级全局互斥锁串行执行
- 即使重复运行或单独运行，也不依赖其它测试先做初始化
- 守卫逻辑只服务于测试，不改变生产行为

---

## 执行顺序

### 阶段 1

先补 `Layer B` 的高价值安全测试：

- `401`
- `403`
- `429`
- `verify` 正反路径
- `nonce` 一次性使用

### 阶段 2

再补 `Layer A` 的纯逻辑测试，如果当前定义处还缺失明显边界覆盖：

- `AuthRateLimiter`
- `NonceCache`

### 阶段 3

保留并校正现有 router smoke，确保其和新的安全测试边界明确分工。

### 阶段 4

补充 `docs/TESTING.md` 的安全面矩阵，明确每类风险由哪层测试负责。

---

## CI 与验收标准

本次工作完成后，至少需要以下验证保持通过：

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm test`
- `npx tsc --noEmit`
- `npm run check-i18n`
- `npm run verify:contracts`

安全测试本身必须满足以下标准：

- 不访问真实网络
- 不依赖真实 ngrok
- 不要求真实分享服务启动
- 不依赖测试顺序
- 失败时能明确指出是哪一类安全边界失效

---

## 风险与控制

### 风险 1: 全局状态污染导致随机失败

控制方式：

- 增强测试守卫
- 每个测试显式初始化状态
- 尽量避免让多个测试共享前一次的 nonce、session、rate-limit 记录

### 风险 2: Router 级测试误触发真实副作用

控制方式：

- 优先让请求在中间件处被拦截
- 选取最小输入
- 对需要进入 handler 的路径只验证高信号语义，不扩张到外部依赖

### 风险 3: Smoke 测试与语义测试职责混淆

控制方式：

- 在文档中明确 Layer B 与 Layer C 的边界
- 不再把 “not 500” 视为安全覆盖

---

## 非目标

以下内容明确不作为本次交付：

- 完整浏览器 E2E 安全回归
- 对所有 HTTP 端点逐一编写细粒度业务语义测试
- 引入新的测试框架
- 借这次任务重构整个分享模块

---

## 实施后的预期结果

完成后，仓库会形成一条更可靠的安全测试基线：

- 关键浏览器分享边界有可执行测试证明
- 路由存在性和安全语义分层清晰
- 新增分享能力改动更容易被 CI 拦截回归
- 后续若继续扩展安全测试，可以沿着当前分层模型追加，而不是重起一套体系
