# 移除 Native Share 设计文档

**日期：** 2026-04-12  
**项目：** worktree-manager  
**功能：** 移除 WMS/native share 与账号登录，仅保留 LAN/ngrok 分享和密码验证

---

## 需求概述

当前项目的分享能力实际包含三条链路：

1. **LAN 分享** - 本地启动 HTTP/HTTPS 服务，对局域网暴露工作区
2. **ngrok 分享** - 在 LAN 分享之上增加公网隧道
3. **WMS/native share** - 通过 WMS 隧道、账号登录、远程回调和重连机制暴露远程访问

本次调整的目标是删除第 3 条链路，保留前两条，并保持浏览器访问分享页时的密码验证机制不变。

明确范围如下：

- 保留 `LAN 分享`
- 保留 `ngrok tunnel`
- 保留浏览器访问分享页时的密码验证
- 删除 `WMS/native share` 的账号登录
- 删除 `WMS/native share` 的远程分享功能
- 删除相关前后端状态、命令、配置、路由和文档

本次采用**硬删除**策略，不做仅隐藏 UI 的下线方式，也不保留兼容分支或 feature flag。

---

## 技术方案

### 方案选择：硬删除 WMS/native share 全链路

**选择理由：**

- 与产品目标一致，避免“界面删了但代码仍存在”的假下线
- 可以显著收缩分享模块的状态和 props，降低后续维护复杂度
- 避免继续维护 WMS 隧道、账号、回调、重连等与当前产品方向不一致的能力
- 风险主要体现在改动面较广，但这是一次性成本，长期收益更高

**不采用的方案：**

- **仅隐藏 UI**：后端和配置仍残留，后续容易产生死代码和误用
- **分阶段下线**：会引入中间态，增加测试和维护成本

---

## 详细设计

### 1. 产品行为调整

变更后，分享能力只保留以下行为：

- 用户可以启动分享服务，获得局域网访问地址
- 用户可以在已分享状态下启动或停止 ngrok 公网隧道
- 浏览器通过 LAN 或 ngrok 地址访问时，仍然先经过分享密码验证
- 分享栏只展示 `LAN` 和 `ngrok` 两种地址与相关控制

以下行为将被完全移除：

- WMS/native share 的远程地址展示
- WMS 连接状态、断线重连、手动重连
- WMS 账号登录、网页登录、表单登录、登出
- WMS 配置入口和用户身份展示
- WMS callback 与 native share 相关 HTTP 能力

---

### 2. 前端架构收缩

#### 2.1 `useShareFeature` 职责收敛

`src/hooks/useShareFeature.ts` 目前同时承担三类职责：

- 分享主状态（LAN）
- ngrok 状态
- WMS/native share 状态与登录流程

本次调整后，该 hook 只保留：

- `shareActive`
- `shareUrls`
- `sharePassword`
- `shareNgrokUrl`
- `ngrokLoading`
- `connectedClients`
- `showNgrokTokenDialog`
- `share disclaimer`
- 与 LAN/ngrok/client/password 相关的 handler

以下状态与 handler 将被删除：

- `shareWmsUrl`
- `wmsConnected`
- `wmsReconnecting`
- `wmsReconnectAttempt`
- `wmsNextRetrySecs`
- `wmsLoading`
- `showWmsConfigDialog`
- `wmsConfigInput`
- `savingWmsConfig`
- `wmsLoggedIn`
- `wmsUser`
- `showWmsLoginDialog`
- `wmsLoginLoading`
- `wmsUsername`
- `wmsPassword`
- `wmsFormLoginLoading`
- `handleToggleWms`
- `handleWmsManualReconnect`
- `handleSaveWmsConfig`
- `handleWmsBrowserLogin`
- `handleCancelWmsBrowserLogin`
- `handleWmsFormLogin`
- `handleWmsLogout`

#### 2.2 分享 UI 简化

`src/components/worktree-sidebar/ShareBar.tsx` 改为只展示：

- `ngrok` 行
- `LAN` 地址列表
- 密码编辑与复制
- 客户端列表和踢出操作
- 分享启动、停止、改端口、快速分享

将被移除的 UI：

- `remote/native share` 行
- WMS 连接/断线/重连状态展示
- WMS 手动重连按钮
- WMS 登录入口
- WMS 配置入口

#### 2.3 上层组件 props 收缩

以下组件删除所有 WMS 相关 props 和展示：

- `src/components/WorktreeSidebar.tsx`
- `src/components/worktree-sidebar/ExpandedSidebar.tsx`
- `src/components/SettingsView.tsx`
- `src/App.tsx`

典型收缩包括：

- 不再向侧边栏透传 `shareWmsUrl`、`wmsConnected`、`wmsLoading` 等状态
- 设置页不再展示 WMS 用户信息和登出入口
- 桌面主界面中不再出现任何 WMS 用户名注入

#### 2.4 浏览器密码认证保留

`src/hooks/useBrowserAuth.ts` 与 `src/lib/backend.ts` 中的浏览器密码登录机制保留原样：

- 浏览器仍通过分享密码完成 challenge-response 认证
- 认证成功后仍使用 `sessionStorage` 持有 `sessionId`
- WebSocket 与 API 仍沿用现有密码认证后的 session 机制

本次删除不会改变浏览器登录页是否存在，只删除 WMS 账号登录，不删除分享密码登录。

---

### 3. 后端架构收缩

#### 3.1 分享状态收缩

`src-tauri/src/types.rs` 中的 `ShareState` 只保留 LAN/ngrok 所需字段：

- `active`
- `workspace_path`
- `port`
- `auth_key`
- `auth_salt`
- `shutdown_tx`
- `ngrok_url`
- `ngrok_task`

将删除以下字段：

- `wms_url`
- `wms_task`
- `wms_shutdown_tx`
- `wms_connected`
- `wms_reconnect_state`
- `wms_manual_reconnect_tx`
- `wms_auto_started_lan`

`ShareStateInfo` 也同步收缩，不再包含任何 `wms_*` 输出字段。

#### 3.2 分享命令删除

`src-tauri/src/commands/sharing.rs` 中仅保留以下能力：

- `start_sharing`
- `stop_sharing`
- `get_share_state`
- `update_share_password`
- `get_connected_clients`
- `kick_client`
- `get_ngrok_token`
- `set_ngrok_token`
- `start_ngrok_tunnel`
- `stop_ngrok_tunnel`
- `get_last_share_port`
- `get_last_share_password`

以下命令将被彻底删除：

- `get_wms_config`
- `set_wms_config`
- `auto_register_tunnel`
- `wms_login`
- `wms_browser_login`
- `cancel_wms_browser_login`
- `get_wms_user`
- `wms_logout`
- `start_wms_tunnel`
- `stop_wms_tunnel`
- `wms_manual_reconnect`

#### 3.3 路由与中间件删除

`src-tauri/src/http_server/routing.rs` 删除：

- `/api/get_wms_config`
- `/api/set_wms_config`
- `/api/auto_register_tunnel`
- `/api/wms_login`
- `/api/wms_browser_login`
- `/api/cancel_wms_browser_login`
- `/api/get_wms_user`
- `/api/wms_logout`
- `/api/start_wms_tunnel`
- `/api/stop_wms_tunnel`
- `/api/wms_manual_reconnect`
- `/auth/wms-callback`

`src-tauri/src/http_server/middleware.rs` 中与 WMS 相关的 localhost-only 路径白名单同步删除，避免保留无效限制项。

#### 3.4 Native share 实现文件删除

以下实现文件及引用将被删除：

- `src-tauri/src/wms_tunnel.rs`

所有依赖它的状态、回调、常量和注册逻辑也一并移除，确保编译期不存在悬空引用。

---

### 4. 配置与数据模型调整

#### 4.1 全局配置字段删除

`src-tauri/src/types.rs` 中 `GlobalConfig` 删除以下字段：

- `wms_server_url`
- `wms_token`
- `wms_subdomain`
- `wms_jwt`
- `device_id`

保留以下分享相关字段：

- `ngrok_token`
- `last_share_port`

#### 4.2 历史配置兼容策略

本次不编写迁移脚本，不主动修改用户旧配置文件。

兼容策略为：

- 新代码不再读取或写入任何 `wms_*` 字段
- 旧 `global.json` 中残留的 WMS 字段由反序列化过程忽略
- 不做“保留但废弃”的兼容层，不添加中间状态逻辑

---

### 5. 文档与契约同步

以下文档需要同步删除或改写所有 WMS/native share 相关描述：

- `README.md`
- `CLAUDE.md`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/NEW_FEATURES.md`
- `docs/generated/command-contracts.md`

命令契约需要体现：

- `wms_*` 命令不再存在
- `get_wms_config`、`set_wms_config` 等命令不再出现在契约表中
- 分享能力只保留 LAN/ngrok/password 对应命令

---

## 数据流与交互变化

### 变更后的分享数据流

1. 桌面端用户点击“开始分享”
2. 前端调用 `start_sharing`
3. 后端启动 LAN 分享服务，生成局域网地址与密码校验材料
4. 前端通过 `get_share_state` 获取 LAN 地址列表
5. 用户可选择继续开启 `ngrok`
6. 浏览器通过 LAN 或 ngrok 地址访问
7. 浏览器通过 challenge-response 完成分享密码认证
8. 认证后的浏览器使用 session 访问 API 与 WebSocket

### 删除后的简化效果

以下复杂链路将消失：

- WMS 登录 -> 获取用户态 -> 配置 tunnel -> 启动 native share -> 监听回调 -> 断线重连

这样分享模块会重新回到更简单的结构：

- 一个本地分享服务
- 一个可选的 ngrok 公网出口
- 一套统一的密码认证

---

## 错误处理

以下错误语义保持不变：

- 分享端口被占用
- 分享密码为空
- 未配置 ngrok token
- ngrok 启动失败或超时
- 浏览器密码错误或 session 失效

本次不新增新的错误分支，重点是确保删除 WMS 后：

- 停止分享时仍正确清理 ngrok 状态
- 分享状态查询不会再返回已经无效的 `wms_*` 字段
- 浏览器模式不会因为删除 WMS 路由而影响密码登录页与 WebSocket 连接

---

## 测试与验证

### 前端验证

- 侧边栏分享区域只剩 `LAN` 和 `ngrok`
- 不再出现 native share/WMS 的任何入口、状态、按钮、文案
- 设置页不再出现 WMS 用户信息或登出按钮
- TypeScript 编译通过，无残留 WMS props 或类型引用

### 后端验证

- Rust 编译通过，无残留 `wms_tunnel` 或 `wms_*` 命令引用
- HTTP 路由注册中不再包含 WMS 相关路径
- `GlobalConfig` 和 `ShareState` 收缩后仍可正常序列化/反序列化

### 功能验证

1. 启动分享，看到 LAN 地址与密码
2. 使用 LAN 地址访问浏览器分享页，仍需密码登录
3. 登录后可以正常加载工作区内容
4. WebSocket 正常连接，终端和实时状态同步正常
5. 启动 ngrok 后可获得公网地址
6. 使用 ngrok 地址访问时，仍需密码登录
7. 停止分享后，LAN/ngrok 状态和客户端列表被正确清空

### 文档与契约验证

- 命令契约文档中不再出现 `wms_*`
- README 与架构文档的分享描述与当前实现一致

---

## 风险与排查重点

### 风险 1：前端死引用

`useShareFeature`、`ShareBar`、`WorktreeSidebar`、`SettingsView`、`App.tsx` 之间目前存在较多透传字段。删除 WMS 后最容易出现：

- props 仍声明但不再使用
- JSX 中残留字段访问
- 类型定义未同步收缩

排查要求：

- 以 TypeScript 编译错误为第一轮兜底
- 再用全文搜索确认 `wms`、`native share`、`shareWmsUrl` 等关键词已无残留

### 风险 2：后端多点联动残留

WMS 逻辑跨越状态、命令、路由、配置、middleware、多文件引用。最容易出现：

- 删除实现文件后仍有 `mod` 或 `use` 引用
- 路由注册与命令导出不一致
- 状态结构收缩后序列化类型未同步

排查要求：

- 以 Rust 编译错误为第一轮兜底
- 再对 `wms_`、`wms_tunnel`、`auth/wms-callback` 做全文搜索

### 风险 3：误伤浏览器密码认证

浏览器模式同时依赖：

- 分享密码登录
- session 持久化
- WebSocket 连接

这些能力和 WMS 都属于“远程访问”语义，删除时容易被误判为同一系统。

排查要求：

- 明确保留 `useBrowserAuth`
- 明确保留 `/api/auth/challenge`、`/api/auth/verify`、`/ws`
- 实测浏览器通过 LAN/ngrok 访问时仍可登录和使用

---

## 实施边界

本次实现只做与“移除 WMS/native share”直接相关的改动，不包含：

- 分享 UI 的额外重设计
- ngrok 功能增强
- 浏览器密码认证协议升级
- 分享权限模型重构
- 与分享无关的代码整理

目标是先把产品边界收回到 `LAN + ngrok + 密码验证`，并确保代码、配置和文档与这个边界一致。
