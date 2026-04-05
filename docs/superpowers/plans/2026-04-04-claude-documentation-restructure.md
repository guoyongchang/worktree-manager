# CLAUDE.md 文档体系重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the documentation into a three-layer progressive disclosure system: minimal CLAUDE.md, on-demand docs/claude/ reference files, and a comprehensive Obsidian vault.

**Architecture:** Layer 1 (CLAUDE.md ~40 lines) auto-loads every conversation with only core constraints. Layer 2 (docs/claude/ 3 files) provides detailed reference Claude reads on demand. Layer 3 (Obsidian vault ~20 files) is the full human-readable knowledge base with bidirectional wiki-links.

**Tech Stack:** Markdown, Obsidian wiki-link syntax, YAML frontmatter

**Spec:** `docs/superpowers/specs/2026-04-04-claude-documentation-restructure-design.md`

**Vault path:** `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/`

---

### Task 1: Create new CLAUDE.md (Layer 1)

**Files:**
- Modify: `CLAUDE.md` (complete rewrite, currently 190 lines → ~40 lines)

- [ ] **Step 1: Back up current CLAUDE.md**

```bash
cp CLAUDE.md CLAUDE.md.bak
```

- [ ] **Step 2: Rewrite CLAUDE.md with minimal progressive-disclosure content**

Replace the entire contents of `CLAUDE.md` with:

```markdown
# Worktree Manager

Git worktree 管理工具 | Tauri 2 + React 19 + Rust | 桌面端 + 浏览器双模式

## 开发命令

npm install / npm run dev / cargo tauri dev / npm run build / cargo tauri build

## 项目结构

```
src-tauri/src/: main.rs, lib.rs(核心~2770行), git_ops.rs(~800行), pty_manager.rs(~270行), http_server.rs(~1240行)
src/: App.tsx(~1230行), types.ts, constants.ts, index.css
  components/: WorktreeSidebar, WorktreeDetail, Terminal, TerminalPanel, GitOperations, SettingsView, CreateWorktreeModal, ArchiveConfirmationModal, AddProjectModal, AddProjectToWorktreeModal, AddWorkspaceModal, BranchCombobox, ContextMenus, WelcomeView, UpdaterDialogs, Icons, ui/
  hooks/: useWorkspace(~340行), useTerminal(~380行), useUpdater
  lib/: backend(~350行), websocket(~218行)
```

## 核心约束（必须遵守）

### 终端状态分离
activatedTerminals（标签栏显示）和 mountedTerminals（组件挂载/PTY 生命周期）必须分离，绝对不能合并。
- Terminal 组件卸载会调用 pty_close 销毁后端 PTY 会话
- 切换 worktree 时用 display:none + visible:false 隐藏，**不卸载**
- 归档 worktree 时必须调用 cleanupTerminalsForPath() 清理 mountedTerminals
- 语音输入在切换 worktree 或终端标签时自动关闭

### Git 操作混用规则
读取用 git2 crate，写入用 Command。Command 更安全不会锁库。

### 双模式命令同步
前端统一入口 callBackend(command, args)，自动路由到 IPC 或 HTTP。
新增命令须同步三处: backend.ts + lib.rs generate_handler + HTTP 路由。
运行 npm run contracts 验证同步。

### 性能约束
- Git 操作两阶段加载：先显示本地数据（毫秒级），后台 fetch 远程（3-6s），fetch 期间按钮禁用并显示进度条
- Loading 状态用 fixed overlay 而非 early return，避免组件卸载/重挂载风暴
- check_remote_branch_exists 使用 git branch -r --list（本地检查），不触发网络请求

## 按需参考（需要时读取）

- 后端全局状态 + 命令分类 → docs/claude/backend-state.md
- 终端系统架构详情 → docs/claude/terminal-architecture.md
- 双模式通信详情 → docs/claude/dual-mode.md
- 命令契约同步规则 → docs/COMMAND_CONTRACTS.md
- 数据类型定义 → src/types.ts
```

- [ ] **Step 3: Verify CLAUDE.md reads correctly**

```bash
wc -l CLAUDE.md
```

Expected: approximately 40-45 lines.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite CLAUDE.md with progressive disclosure (~40 lines)"
```

---

### Task 2: Create docs/claude/backend-state.md (Layer 2)

**Files:**
- Create: `docs/claude/backend-state.md`

- [ ] **Step 1: Create docs/claude/ directory**

```bash
mkdir -p docs/claude
```

- [ ] **Step 2: Write backend-state.md**

Create `docs/claude/backend-state.md` with the following content:

```markdown
# 后端全局状态与命令分类

## 全局状态 (lib.rs)

| 变量 | 类型 | 用途 |
|------|------|------|
| `PTY_MANAGER` | `Arc<Mutex<PtyManager>>` | PTY 会话池 |
| `WINDOW_WORKSPACES` | `HashMap<window_label, path>` | 窗口→工作区绑定 |
| `WORKTREE_LOCKS` | `HashMap<(ws_path, wt_name), label>` | worktree 排他锁 |
| `TERMINAL_STATES` | `HashMap<(ws_path, wt_name), state>` | 终端状态同步 |
| `SHARE_STATE` | `ShareState` | HTTP 分享状态 |
| `AUTHENTICATED_SESSIONS` | `HashSet<session_id>` | 已认证浏览器会话 |
| `CONNECTED_CLIENTS` | `HashMap<session_id, client>` | 连接客户端追踪 |
| `LOCK_BROADCAST` / `TERMINAL_STATE_BROADCAST` | `broadcast::Channel` | WebSocket 广播通道 |

## Tauri Commands 分类 (~61个)

### 工作区 (9)
list_workspaces, get_current_workspace, switch_workspace, add_workspace, remove_workspace, create_workspace, get_workspace_config, save_workspace_config, get_config_path

### Worktree (8)
list_worktrees, create_worktree, archive_worktree, restore_worktree, delete_archived_worktree, check_worktree_status, add_project_to_worktree, get_main_workspace_status

### Git (11)
switch_branch, clone_project, sync_with_base_branch, push_branch, merge_to_test_branch, merge_to_base_branch, get_branch_diff_stats, create_pull_request, fetch_project_remote, check_branches, get_branches

### PTY 终端 (7)
pty_create, pty_write, pty_read, pty_resize, pty_close, pty_exists, pty_close_by_path

### 多窗口 (6)
set_window_workspace, get_opened_workspaces, unregister_window, lock_worktree, unlock_worktree, get_locked_worktrees

### 系统 (4)
open_terminal, open_editor, reveal_in_finder, open_log_dir

### 分享 (6)
start_sharing, stop_sharing, get_share_state, update_share_password, get_connected_clients, kick_client

### ngrok (4)
get_ngrok_token, set_ngrok_token, start_ngrok_tunnel, stop_ngrok_tunnel

### 其他 (6)
broadcast_terminal_state, scan_linked_folders, open_workspace_window, list_workspace_names, get_display_name, remove_project

## 新增命令同步步骤

1. 在前端新增 `callBackend('your_command')` 或封装函数 (`src/lib/backend.ts`)
2. 在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![]` 中注册 `your_command`
3. 在 HTTP 路由层增加 `/api/your_command` (`src-tauri/src/http_server.rs`)
4. 运行 `npm run contracts` 验证同步
```

- [ ] **Step 3: Commit**

```bash
git add docs/claude/backend-state.md
git commit -m "docs: add docs/claude/backend-state.md for on-demand reference"
```

---

### Task 3: Create docs/claude/terminal-architecture.md (Layer 2)

**Files:**
- Create: `docs/claude/terminal-architecture.md`

- [ ] **Step 1: Write terminal-architecture.md**

Create `docs/claude/terminal-architecture.md` with the following content:

```markdown
# 终端系统架构

## 状态分离模型（核心约束）

| 状态 | 职责 | 作用域 | 何时移除 |
|------|------|--------|---------|
| `activatedTerminals` | 标签栏显示哪些 tab | 按 worktree 保存/恢复 | 切换 worktree 时替换 |
| `mountedTerminals` | Terminal 组件是否挂载（PTY 生命周期） | 全局累积 | 仅在显式关闭标签或归档 worktree 时 |
| `terminalVisible` | 终端面板展开/收起 | 按 worktree 保存/恢复 | — |

> ⚠️ activatedTerminals 和 mountedTerminals 绝对不能合并为同一个 Set。

## PTY 会话生命周期

```
创建 worktree → 选中 worktree → pty_create (后端创建 PTY)
  → Terminal 组件挂载 → 加入 mountedTerminals
  → 前端 100ms 轮询 pty_read（桌面端）/ WebSocket 推送（浏览器端）

切换 worktree → display:none + visible:false（不卸载！）
  → activatedTerminals 替换为新 worktree 的标签
  → mountedTerminals 不变，PTY 后台继续运行

关闭标签 → Terminal 组件卸载 → 触发 pty_close → 从 mountedTerminals 移除

归档 worktree → cleanupTerminalsForPath() 
  → 清理 mountedTerminals 中该 worktree 的所有终端
  → 关闭对应 PTY 会话
```

## 多窗口/多客户端同步

- **桌面端**: Tauri event 系统广播
- **浏览器端**: WebSocket 推送
- **同步机制**: broadcast channel + 序列号去重 + 防抖
- **锁定**: 桌面端选中 worktree 获取排他锁，浏览器端只读不锁定

## 会话 ID 格式

- 主终端: `pty-{path-with-dashes}` (路径中 `/` 替换为 `-`)
- 复制标签: `{path}#{timestamp}`

## 语音输入约束

切换 worktree 或终端标签时自动关闭语音输入，避免写入错误会话。

## 关键常量 (constants.ts)

- 默认面板高度: 280px (MIN: 100, MAX: 600)
- 窗口默认尺寸: 1100x700
- PTY 轮询间隔: 100ms
```

- [ ] **Step 2: Commit**

```bash
git add docs/claude/terminal-architecture.md
git commit -m "docs: add docs/claude/terminal-architecture.md for on-demand reference"
```

---

### Task 4: Create docs/claude/dual-mode.md (Layer 2)

**Files:**
- Create: `docs/claude/dual-mode.md`

- [ ] **Step 1: Write dual-mode.md**

Create `docs/claude/dual-mode.md` with the following content:

```markdown
# 双模式通信架构

## 前端统一入口

`callBackend(command, args)` in `src/lib/backend.ts`:
- 检测运行环境（Tauri window 对象是否存在）
- 桌面端 → `invoke(command, args)` (Tauri IPC)
- 浏览器端 → `POST /api/{command}` + JSON body (HTTP)
- 自动记录每次调用耗时（IPC 计时日志）

## Tauri IPC 模式（桌面端）

```
前端 invoke(command, args)
  → Tauri IPC bridge
  → #[tauri::command] fn handler
  → Result<T, String>
```

- 事件监听: `listen()` 接收后端 `window.emit()` 事件
- 用于: 锁状态变更、终端状态广播

## HTTP 模式（浏览器端）

### 路由
- 模式: `POST /api/{command}` + JSON body
- 静态文件: `/` 服务 `dist/` 目录
- WebSocket: `/ws?session_id=xxx`

### 认证
- 密码认证 → 获取 session_id
- 请求头: `x-session-id: {session_id}`
- 限流: 5次/60秒/IP（防暴力破解）
- 认证使用常量时间比较防止时序攻击

### 安全约束
- **localhost-only 限制**: open_terminal, open_editor, reveal_in_finder 操作仅限 localhost 调用
- CSP headers 防止 XSS
- 路径验证防止目录遍历

## WebSocket 消息类型

| 类型 | 方向 | 用途 |
|------|------|------|
| `terminal_output` | Server → Client | PTY 输出推送 |
| `terminal_input` | Client → Server | PTY 输入 |
| `worktree_lock` / `worktree_unlock` | Server → Client | 锁状态同步 |
| `terminal_state` | Server → Client | 终端状态广播 |
| `kick` | Server → Client | 踢出客户端 |

## 浏览器专用端点

`src/lib/backend.ts` 中直接使用 `fetch()` 的端点（不走 callBackend）:
- 认证端点
- 文件上传等浏览器特有功能

这些端点只需在 HTTP 路由层注册，不需要 Tauri IPC 对应。
```

- [ ] **Step 2: Commit**

```bash
git add docs/claude/dual-mode.md
git commit -m "docs: add docs/claude/dual-mode.md for on-demand reference"
```

---

### Task 5: Create Obsidian vault structure + CLAUDE.md MOC (Layer 3)

**Files:**
- Create: `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/CLAUDE.md`
- Delete: `/Users/guo/Work/GuoVault/Guo/workspaces/worktree/` (old misnamed directory)

- [ ] **Step 1: Remove old vault directory and create new structure**

```bash
rm -rf /Users/guo/Work/GuoVault/Guo/workspaces/worktree
mkdir -p /Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/{architecture,features,api,development,reference}
```

- [ ] **Step 2: Write vault CLAUDE.md (MOC entry point)**

Create `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/CLAUDE.md`:

```markdown
---
tags: [moc, worktree-manager]
aliases: [Worktree Manager, WTM]
---

# Worktree Manager

Git worktree 管理工具，基于 Tauri 2 + React 19 + Rust，支持桌面端和浏览器远程访问双模式。

> [!info] 项目仓库
> `~/Work/some-projects/some-projects/projects/worktree-manager/`

## 架构

- [[architecture/overview|架构总览]] — 分层架构图、技术栈
- [[architecture/dual-mode-communication|双模式通信]] — IPC / HTTP / WebSocket
- [[architecture/backend-global-state|后端全局状态]] — Rust 全局变量与生命周期
- [[architecture/terminal-system|终端系统]] — ⚠️ 核心，状态分离与 PTY 生命周期

## 功能模块

- [[features/workspace-management|工作区管理]] — 创建、切换、配置
- [[features/worktree-lifecycle|Worktree 生命周期]] — 创建 → 使用 → 归档 → 恢复 → 删除
- [[features/git-operations|Git 操作]] — sync / merge / PR / diff + 两阶段加载
- [[features/terminal-management|终端管理]] — 标签页、交互、会话隔离
- [[features/sharing-and-auth|分享与认证]] — HTTP 分享、密码认证、客户端管理
- [[features/ngrok-tunnel|Ngrok 隧道]] — 内网穿透
- [[features/ide-integration|IDE 集成]] — VS Code / Cursor / IDEA

## API 参考

- [[api/tauri-commands|Tauri Commands]] — 61 个后端命令完整签名
- [[api/http-endpoints|HTTP 端点]] — REST API
- [[api/websocket-protocol|WebSocket 协议]] — 实时消息格式

## 开发指南

- [[development/getting-started|快速开始]] — 环境搭建、依赖安装
- [[development/code-conventions|代码规范]] — TS / Rust / CSS 约定
- [[development/release-process|发布流程]] — 版本号、构建、发布

## 参考资料

- [[reference/data-types|数据类型]] — TypeScript / Rust 类型定义
- [[reference/config-files|配置文件]] — 全局配置、工作区配置格式
- [[reference/directory-conventions|目录约定]] — 工作区目录结构、symlink 规则
```

---

### Task 6: Create vault architecture/ files (Layer 3)

**Files:**
- Create: `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/architecture/overview.md`
- Create: `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/architecture/dual-mode-communication.md`
- Create: `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/architecture/backend-global-state.md`
- Create: `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/architecture/terminal-system.md`

- [ ] **Step 1: Write architecture/overview.md**

Create the file with content migrated from `docs/ARCHITECTURE.md` (架构分层图) and `docs/PROJECT_OVERVIEW.md` (技术栈). Include:

```markdown
---
tags: [architecture, overview]
aliases: [架构总览]
---

# 架构总览

## 项目定位

Git Worktree Manager 是一个 Git worktree 可视化管理工具，让多分支并行开发变得简单高效。利用 Git 原生 worktree 功能，同时检出多个分支，共享 `.git` 数据，自动链接 `node_modules` 等大文件夹以节省磁盘空间。

## 技术栈

### 后端
- **Rust** + **Tauri 2** — 跨平台桌面应用框架
- **Axum** — 高性能异步 Web 框架（浏览器模式 HTTP/WS 服务器）
- **Tokio** — 异步运行时
- **git2-rs** — Git 读取操作（写入使用 Command 避免锁库）
- **portable-pty** — 跨平台伪终端

### 前端
- **React 19** + **TypeScript** — UI 框架
- **Vite 7** — 构建工具
- **Tailwind CSS 4** — 样式
- **Radix UI** — 无样式可访问组件
- **xterm.js** — 终端模拟器

## 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      表现层 (Presentation)                   │
│  ┌────────────────────┐         ┌────────────────────────┐  │
│  │  Tauri Desktop UI  │         │   Browser Web UI       │  │
│  │  (React + Vite)    │         │   (React + Vite)       │  │
│  └────────────────────┘         └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                      通信层 (Communication)                  │
│  ┌────────────────────┐         ┌────────────────────────┐  │
│  │   Tauri IPC        │         │   HTTP/WebSocket       │  │
│  │   (invoke/listen)  │         │   (Axum Framework)     │  │
│  └────────────────────┘         └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                      业务层 (Business Logic)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Workspace   │  │   Worktree   │  │   Git Ops        │  │
│  │  Management  │  │   Operations │  │   (git2 + Cmd)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Terminal    │  │   Share      │  │   NGROK          │  │
│  │  ([[PTY]])   │  │   Service    │  │   Tunnel         │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────┐
│                      数据层 (Data)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Config      │  │   Git Repo   │  │   File System    │  │
│  │  (JSON)      │  │   (.git)     │  │   (Symlinks)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 核心特性

1. **多分支并行** — 同时打开多个分支，无需 git stash
2. **智能文件夹链接** — node_modules/.next 等通过 symlink 共享
3. **工作区全局文件** — .claude/CLAUDE.md 等通过 linked_workspace_items 共享
4. **实时状态监控** — 提交数、未提交更改、与基础分支差异
5. **内置终端** — 每个 worktree 独立 [[PTY]] 会话
6. **远程分享** — HTTP/WebSocket + [[features/sharing-and-auth|密码认证]]
7. **[[features/ngrok-tunnel|Ngrok 穿透]]** — 一键公网访问

## 数据流

```
User Action → Component Handler → callBackend(command, args)
  ├─ Desktop → Tauri IPC → #[tauri::command] → Rust impl
  └─ Browser → HTTP POST → Axum handler → same Rust impl
      → Response → Update State → Re-render
```

实时通信通过 [[dual-mode-communication|WebSocket]] 实现终端输出和状态同步。
```

- [ ] **Step 2: Write architecture/dual-mode-communication.md**

Create the file with content migrated from `docs/ARCHITECTURE.md` (通信机制 sections). Include:

```markdown
---
tags: [architecture, dual-mode, core-constraint]
aliases: [双模式通信, dual-mode]
---

# 双模式通信

> [!warning] 核心约束
> 新增命令须同步三处: `backend.ts` + `lib.rs generate_handler` + HTTP 路由。运行 `npm run contracts` 验证。

## 统一入口

`callBackend(command, args)` in `src/lib/backend.ts`:

```typescript
export async function callBackend<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  try {
    if (window.__TAURI__) {
      return await invoke<T>(command, args);   // Desktop: Tauri IPC
    } else {
      const res = await fetch(`${getApiBase()}/api/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': getSessionId() },
        body: JSON.stringify(args || {}),
      });
      return await res.json();                  // Browser: HTTP
    }
  } finally {
    console.debug(`[IPC] ${command}: ${(performance.now() - start).toFixed(1)}ms`);
  }
}
```

## Tauri IPC（桌面端）

- `invoke(command, args)` → `#[tauri::command]` handler
- 事件系统: `window.emit()` → `listen()` 用于锁变更、终端状态广播
- 同步通信，无需认证

## HTTP API（浏览器端）

- 路由模式: `POST /api/{command}` + JSON body
- 认证: `x-session-id` header
- 限流: 5次/60秒/IP（防暴力破解）
- 认证使用常量时间比较防止时序攻击
- **localhost-only**: open_terminal / open_editor / reveal_in_finder 仅限本机调用
- CSP headers 防 XSS

## WebSocket

连接: `/ws?session_id=xxx`

| 消息类型 | 方向 | 用途 |
|----------|------|------|
| `terminal_output` | Server→Client | [[PTY]] 输出推送 |
| `terminal_input` | Client→Server | [[PTY]] 输入 |
| `worktree_lock` / `unlock` | Server→Client | [[worktree-lock\|锁状态]]同步 |
| `terminal_state` | Server→Client | [[architecture/terminal-system\|终端状态]]广播 |
| `kick` | Server→Client | 踢出客户端 |

## 命令契约验证

```bash
npm run verify:contracts  # 检查三处是否同步
npm run docs:contracts    # 生成矩阵文档
npm run contracts         # 先校验再刷新
```

详见项目内 `docs/COMMAND_CONTRACTS.md`。
```

- [ ] **Step 3: Write architecture/backend-global-state.md**

Create the file with content from current `CLAUDE.md` (后端全局状态) and `docs/ARCHITECTURE.md` (核心模块). Include:

```markdown
---
tags: [architecture, backend, state]
aliases: [后端全局状态, backend-state]
---

# 后端全局状态

## 全局变量 (lib.rs)

| 变量 | 类型 | 用途 |
|------|------|------|
| `PTY_MANAGER` | `Arc<Mutex<PtyManager>>` | [[PTY]] 会话池，管理所有终端实例 |
| `WINDOW_WORKSPACES` | `HashMap<window_label, path>` | 窗口→工作区绑定 |
| `WORKTREE_LOCKS` | `HashMap<(ws_path, wt_name), label>` | [[worktree-lock\|worktree 排他锁]] |
| `TERMINAL_STATES` | `HashMap<(ws_path, wt_name), state>` | [[architecture/terminal-system\|终端状态]]同步 |
| `SHARE_STATE` | `ShareState` | [[features/sharing-and-auth\|HTTP 分享]]状态 |
| `AUTHENTICATED_SESSIONS` | `HashSet<session_id>` | 已认证浏览器会话 |
| `CONNECTED_CLIENTS` | `HashMap<session_id, client>` | 连接客户端追踪 |
| `LOCK_BROADCAST` | `broadcast::Channel` | 锁变更广播 → WebSocket |
| `TERMINAL_STATE_BROADCAST` | `broadcast::Channel` | 终端状态广播 → WebSocket |

## Rust 模块职责

| 文件 | 行数 | 职责 |
|------|------|------|
| `lib.rs` | ~2770 | 核心业务逻辑，所有 Tauri commands，全局状态管理 |
| `git_ops.rs` | ~800 | Git 操作（git2 读取 + Command 写入） |
| `pty_manager.rs` | ~270 | [[PTY]] 伪终端管理（shell 会话生命周期） |
| `http_server.rs` | ~1240 | Axum HTTP/WS 服务器（浏览器模式） |

## Tauri Commands 分类 (~61个)

| 领域 | 数量 | 命令 |
|------|------|------|
| 工作区 | 9 | list/get/switch/add/remove/create_workspace, get/save_config, get_config_path |
| Worktree | 8 | list/create/archive/restore/delete_archived, check_status, add_project, get_main_status |
| Git | 11 | switch_branch, clone_project, sync_base, push, merge_test/base, diff_stats, create_pr, fetch_remote, check/get_branches |
| [[PTY]] | 7 | create/write/read/resize/close/exists/close_by_path |
| 多窗口 | 6 | set_workspace, get_opened, unregister, lock/unlock/get_locked |
| 系统 | 4 | open_terminal/editor/finder/log_dir |
| [[features/sharing-and-auth\|分享]] | 6 | start/stop_sharing, get_state, update_password, get/kick_clients |
| [[features/ngrok-tunnel\|ngrok]] | 4 | get/set_token, start/stop_tunnel |
| 其他 | 6 | broadcast_terminal_state, scan_linked_folders, open_workspace_window, list_workspace_names, get_display_name, remove_project |

## 锁机制

```rust
// worktree 排他锁 — 桌面端选中 worktree 时获取
WORKTREE_LOCKS: HashMap<(workspace_path, worktree_name), window_label>
```

- 同一 worktree 只能被一个窗口选中
- 浏览器端只读，不获取锁
- 锁变更通过 `LOCK_BROADCAST` → WebSocket 同步到所有客户端
```

- [ ] **Step 4: Write architecture/terminal-system.md**

Create the file — this is the most critical page. Content from current `CLAUDE.md` (终端状态架构) expanded with details from `docs/FEATURES.md` (终端管理):

```markdown
---
tags: [architecture, terminal, core-constraint, PTY]
aliases: [终端系统, terminal-system, PTY]
---

# 终端系统

> [!warning] 核心约束
> `activatedTerminals` 和 `mountedTerminals` **必须分离**。合并会导致切换 worktree 时 PTY 被意外销毁。

## 状态分离模型

| 状态 | 职责 | 作用域 | 何时移除 |
|------|------|--------|---------|
| `activatedTerminals` | 标签栏显示哪些 tab | 按 worktree 保存/恢复 | 切换 worktree 时替换 |
| `mountedTerminals` | Terminal 组件是否挂载（[[PTY]] 生命周期） | 全局累积 | 仅在显式关闭标签或归档 worktree 时 |
| `terminalVisible` | 终端面板展开/收起 | 按 worktree 保存/恢复 | — |

### 为什么必须分离？

Terminal 组件**卸载时会调用 `pty_close`**，销毁后端 PTY 会话。如果用同一个 Set 控制标签栏和组件生命周期，切换 worktree 时：

1. `activatedTerminals` 被替换为新 worktree 的标签
2. 旧 worktree 的 Terminal 组件被卸载
3. `pty_close` 被调用 → 后端 PTY 被销毁 ❌
4. 切回旧 worktree 时终端丢失

正确做法：切换时仅替换 `activatedTerminals`，通过 `display:none` + `visible:false` 隐藏旧 Terminal 组件，**不卸载**。

## PTY 会话生命周期

```
创建: 选中 worktree → pty_create → Terminal 组件挂载 → mountedTerminals.add()
运行: 桌面端 100ms 轮询 pty_read / 浏览器端 WebSocket 推送
隐藏: 切换 worktree → display:none（不卸载！mountedTerminals 不变）
恢复: 切回 → display:block（activatedTerminals 恢复保存的标签）
关闭: 关闭标签 → Terminal 卸载 → pty_close → mountedTerminals.remove()
归档: cleanupTerminalsForPath() → 清理所有该路径终端 → pty_close
```

## 终端标签

| 类型 | path 格式 | 说明 |
|------|-----------|------|
| 主终端 | worktree 根路径 | isRoot=true |
| 项目终端 | 项目目录路径 | isRoot=false |
| 复制标签 | `{path}#{timestamp}` | isDuplicate=true |

TerminalTab 类型: `{ name, path, isRoot, isDuplicate }`

## 会话 ID 格式

- PTY 会话: `pty-{path-with-dashes}`（路径中 `/` 替换为 `-`）
- 复制标签: `pty-{path}#{timestamp}-with-dashes`

## 多窗口同步

- 桌面端: Tauri event 广播 → `listen()` 接收
- 浏览器端: `TERMINAL_STATE_BROADCAST` → WebSocket 推送
- 去重: 带序列号 + 防抖，避免重复处理

## 语音输入

切换 worktree 或终端标签时自动关闭语音输入，避免写入错误会话。

## 面板尺寸

- 默认高度: 280px
- 最小: 100px，最大: 600px
- 支持拖拽调整 + 全屏模式

## 相关文件

| 文件 | 职责 |
|------|------|
| `src/components/Terminal.tsx` | xterm.js 终端组件，PTY 交互 |
| `src/components/TerminalPanel.tsx` | 面板容器，标签页，拖拽高度 |
| `src/hooks/useTerminal.ts` | 终端状态管理，多窗口同步 |
| `src-tauri/src/pty_manager.rs` | [[PTY]] 管理器（创建/读写/关闭） |
| `src/constants.ts` | 高度/轮询间隔/滚动缓冲常量 |
```

- [ ] **Step 5: Commit**

Not a git repo — no commit needed for vault files.

---

### Task 7: Create vault features/ files (Layer 3)

**Files:**
- Create 7 files under `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/features/`

- [ ] **Step 1: Write features/workspace-management.md**

```markdown
---
tags: [feature, workspace]
aliases: [工作区管理]
---

# 工作区管理

工作区是 Worktree Manager 的顶层组织单位，一个工作区可包含多个项目和多个 worktree。

## 核心操作

| 操作 | 命令 | 说明 |
|------|------|------|
| 创建 | `create_workspace` | 在指定目录创建新工作区 + `.worktree-manager.json` |
| 导入 | `add_workspace` | 将现有 Git 仓库目录导入 |
| 切换 | `switch_workspace` | 切换当前工作区，保存/加载状态 |
| 删除 | `remove_workspace` | 从全局配置移除 |

## 配置

- **全局配置**: `~/.config/worktree-manager/global.json` — workspaces 列表
- **工作区配置**: `{workspace_root}/.worktree-manager.json` — 详见 [[reference/config-files]]

## 工作区设置项

- 名称 (display_name)
- Worktree 目录名（默认 `worktrees/`）
- [[reference/directory-conventions|全局链接项]]（如 `.claude`, `CLAUDE.md`）
- 项目列表 — 详见 [[features/worktree-lifecycle#项目管理]]

## 相关组件

| 组件 | 文件 |
|------|------|
| 欢迎引导页 | `src/components/WelcomeView.tsx` |
| 添加工作区弹窗 | `src/components/AddWorkspaceModal.tsx` |
| 设置页 | `src/components/SettingsView.tsx` |
```

- [ ] **Step 2: Write features/worktree-lifecycle.md**

```markdown
---
tags: [feature, worktree]
aliases: [Worktree 生命周期, worktree-lock]
---

# Worktree 生命周期

## 生命周期流程

```
创建 → 使用（选中/锁定） → 归档 → 恢复 → 删除
```

## 创建

`create_worktree(name, projects)`:
1. 在 `{workspace}/worktrees/{name}/projects/` 下为每个项目创建 git worktree
2. 自动链接项目配置的文件夹（如 `node_modules`）→ 通过 symlink
3. 自动链接工作区全局文件（如 `.claude`）→ 通过 linked_workspace_items

```
worktrees/{name}/
├── projects/
│   ├── repo-a/     # git worktree (分支=name 或指定分支)
│   └── repo-b/     # git worktree
├── .claude -> ../../.claude
└── CLAUDE.md -> ../../CLAUDE.md
```

## 使用

- 侧边栏点击选中 → 自动获取 [[worktree-lock|排他锁]]
- 右侧显示项目状态（分支、提交数、合并状态）
- [[architecture/terminal-system|终端]]自动创建/恢复

## 归档

`archive_worktree(name)` — 归档前安全检查：

| 级别 | 检查项 | 说明 |
|------|--------|------|
| ⚠️ Warning | 未提交更改 | 可归档但需确认 |
| ⚠️ Warning | 未推送提交 | 可归档但需确认 |
| ❌ Error | 必须解决的问题 | 阻止归档 |

归档操作：
1. 关闭该 worktree 的所有 [[PTY]] 会话
2. 清理 mountedTerminals（`cleanupTerminalsForPath()`）
3. 移除 git worktree 注册
4. 重命名目录：`{name}` → `{name}.archive`
5. 如已有同名 `.archive` 目录，先删除

## 恢复

`restore_worktree(name)`:
1. 去除 `.archive` 后缀
2. 重新注册 git worktree
3. 重建 symlink

## 删除

`delete_archived_worktree(name)` — 永久删除已归档的 worktree。

## 项目管理

### 添加项目到工作区

`clone_project(name, repo_url, ...)`:
- 支持 GitHub 简写 (`owner/repo`)、SSH URL、HTTPS URL
- 配置: base_branch, test_branch, merge_strategy, linked_folders

### 添加项目到已有 Worktree

`add_project_to_worktree(worktree_name, project_name, base_branch)`:
- 在该 worktree 下创建 git worktree
- 自动链接配置的文件夹

### 智能扫描

`scan_linked_folders` — 扫描项目目录识别可链接文件夹:
- node_modules, .next, vendor, target, build, dist
- 显示文件夹大小，支持自定义路径

## 相关组件

| 组件 | 文件 |
|------|------|
| 侧边栏 | `src/components/WorktreeSidebar.tsx` |
| 详情面板 | `src/components/WorktreeDetail.tsx` |
| 创建弹窗 | `src/components/CreateWorktreeModal.tsx` |
| 归档确认 | `src/components/ArchiveConfirmationModal.tsx` |
| 添加项目 | `src/components/AddProjectModal.tsx` |
| 项目到 WT | `src/components/AddProjectToWorktreeModal.tsx` |
```

- [ ] **Step 3: Write features/git-operations.md**

```markdown
---
tags: [feature, git]
aliases: [Git 操作]
---

# Git 操作

> [!note] 混用规则
> 读取用 git2 crate，写入用 Command。Command 更安全不会锁库。详见 [[architecture/backend-global-state]]。

## 操作列表

### 同步基础分支 (sync_with_base_branch)

将基础分支最新代码合并到当前分支：
1. `git fetch origin`
2. `git merge origin/{base_branch}` 或 `git rebase origin/{base_branch}`（取决于配置的 merge_strategy）

### 合并到测试分支 (merge_to_test_branch)

将当前分支合并到测试分支并推送：
1. 切换到测试分支
2. `git merge {current_branch}`
3. `git push origin {test_branch}`

### 合并到基础分支 (merge_to_base_branch)

同 merge_to_test_branch 但目标是 base_branch。

### 创建 Pull Request (create_pull_request)

通过 CLI 在 Git 平台创建 PR/MR：
- GitHub: `gh pr create`
- GitLab: `glab mr create`

### 查看分支差异 (get_branch_diff_stats)

显示当前分支与基础分支的差异统计：文件数、新增/删除行数、ahead/behind。

### 推送 (push_branch)

推送当前分支到远程。

## 两阶段加载（性能优化）

> [!warning] 性能约束
> 必须使用两阶段加载，不能让用户等待 fetch 完成。

1. **Phase 1**: 显示本地数据（毫秒级响应）— 分支名、本地 ahead/behind
2. **Phase 2**: 后台 `fetch_project_remote`（3-6s）— 更新远程状态
   - fetch 期间按钮禁用 + 显示进度条
   - `check_remote_branch_exists` 使用 `git branch -r --list`（本地检查，不触发网络）
   - `fetch_project_remote` 使用 `spawn_blocking` 避免阻塞 tokio runtime

## 相关文件

| 文件 | 职责 |
|------|------|
| `src/components/GitOperations.tsx` | Git 操作按钮 UI |
| `src-tauri/src/git_ops.rs` | Git 操作实现 |
| `src-tauri/src/lib.rs` | Tauri command 定义 |
```

- [ ] **Step 4: Write features/sharing-and-auth.md**

```markdown
---
tags: [feature, sharing, auth]
aliases: [分享与认证, sharing]
---

# 分享与认证

## 启动分享

`start_sharing(port, password)`:
1. 启动 Axum HTTP 服务器
2. 自动生成 8 位随机密码（含大小写字母和数字）
3. 提供静态文件服务 + REST API + WebSocket

分享信息：
- 本地地址: `http://localhost:{port}`
- 局域网地址: `http://{local_ip}:{port}`
- 密码: 显示 + 支持复制

## 认证流程

1. 浏览器客户端提交密码 → `POST /api/auth`
2. 常量时间比较验证密码（防时序攻击）
3. 生成 session_id → 存入 `AUTHENTICATED_SESSIONS`
4. 后续请求携带 `x-session-id` header
5. 限流: 5次/60秒/IP（防暴力破解）

## 客户端管理

| 操作 | 命令 | 说明 |
|------|------|------|
| 查看连接 | `get_connected_clients` | session_id, IP, 连接时间, UA |
| 踢出 | `kick_client` | 移除认证 + 关闭 WebSocket |

客户端被踢后收到 `kick` WebSocket 消息，自动跳转登录页。

## 分享状态持久化

- 端口和密码保存到全局配置
- 下次启动时自动填充

## 安全约束

- localhost-only: open_terminal / open_editor / reveal_in_finder 仅本机可调用
- CSP headers
- 路径验证防目录遍历

## 相关文件

| 文件 | 职责 |
|------|------|
| `src/App.tsx` | 分享 UI、客户端列表 |
| `src-tauri/src/http_server.rs` | HTTP/WS 服务器 |
| `src-tauri/src/lib.rs` | 分享命令 |
```

- [ ] **Step 5: Write features/ngrok-tunnel.md**

```markdown
---
tags: [feature, ngrok]
aliases: [Ngrok 隧道, ngrok]
---

# Ngrok 隧道

使用 Ngrok 将本地 [[features/sharing-and-auth|分享服务]] 暴露到公网。

## 使用流程

1. 配置 Token: `set_ngrok_token(token)` — 保存到全局配置
2. 前置条件: 分享服务必须先启动
3. 启动隧道: `start_ngrok_tunnel` → 生成 HTTPS 公网地址
4. 停止: `stop_ngrok_tunnel`

## 用户体验

- 未配置 Token 时点击启动 → 弹窗提示填写
- 隧道活跃时显示公网 URL + 一键复制
- 即使未配置也显示 Ngrok 区域

> [!note] 安全提示
> Token 目前明文存储在全局配置中（TODO: 使用 OS keychain）。

## 相关文件

- 前端: `src/App.tsx`
- 后端: `src-tauri/src/lib.rs`
```

- [ ] **Step 6: Write features/terminal-management.md**

```markdown
---
tags: [feature, terminal]
aliases: [终端管理]
---

# 终端管理

> [!tip] 架构详情
> 终端的状态分离模型和 PTY 生命周期详见 [[architecture/terminal-system]]。

## 终端标签页

每个 [[features/worktree-lifecycle|worktree]] 可拥有多个终端标签：

| 类型 | 说明 |
|------|------|
| 主标签 | worktree 根目录，isRoot=true |
| 项目标签 | 单个项目目录 |
| 复制标签 | 右键复制，独立 PTY 会话 |

标签操作: 切换、关闭、右键复制。

## 终端交互

- 键盘输入实时发送到后端 [[PTY]]
- 后端输出实时显示（桌面端 100ms 轮询 / 浏览器端 WebSocket）
- 支持 Ctrl+C/D 等控制键
- 支持复制粘贴
- Shell: 使用系统默认 (bash/zsh/powershell)

## 面板控制

- 拖拽调整高度（100px ~ 600px，默认 280px）
- 全屏模式
- 展开/收起（按 worktree 保存状态）

## 按 Worktree 隔离

- 切换 worktree → 保存当前终端标签状态 → 恢复目标的标签状态
- PTY 会话后台继续运行（不销毁）
- 组件通过 `display:none` 隐藏

## 相关组件

| 组件 | 文件 |
|------|------|
| 终端组件 | `src/components/Terminal.tsx` |
| 面板容器 | `src/components/TerminalPanel.tsx` |
| 状态 Hook | `src/hooks/useTerminal.ts` |
| PTY 后端 | `src-tauri/src/pty_manager.rs` |
```

- [ ] **Step 7: Write features/ide-integration.md**

```markdown
---
tags: [feature, ide]
aliases: [IDE 集成]
---

# IDE 集成

一键用常用 IDE 打开 worktree 或项目目录。

## 支持的 IDE

| IDE | 命令 | 类型标识 |
|-----|------|----------|
| VS Code | `code {path}` | `vscode` |
| Cursor | `cursor {path}` | `cursor` |
| IntelliJ IDEA | `idea {path}` | `idea` |

## 使用方式

- 下拉菜单选择 IDE
- 右键菜单快速打开
- 可分别打开不同项目目录

## 安全约束

浏览器模式下 `open_editor` 仅限 localhost 调用 — 详见 [[dual-mode-communication#安全约束]]。

## 相关文件

- `src/components/WorktreeDetail.tsx` — 编辑器按钮
- `src-tauri/src/lib.rs` — `open_editor` 命令
```

---

### Task 8: Create vault api/ files (Layer 3)

**Files:**
- Create 3 files under `/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/api/`

- [ ] **Step 1: Write api/tauri-commands.md**

Migrate content from `docs/API.md` (Tauri 命令列表 section). Create:

```markdown
---
tags: [api, tauri, commands]
aliases: [Tauri Commands]
---

# Tauri Commands

完整的 Tauri 命令列表（~61个）。按领域分类详见 [[architecture/backend-global-state#Tauri Commands 分类]]。

## 工作区管理

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `get_current_workspace` | — | `Option<String>` | 获取当前工作区路径 |
| `switch_workspace` | path | `()` | 切换工作区 |
| `add_workspace` | name, path | `()` | 添加工作区 |
| `create_workspace` | name, path | `()` | 创建新工作区 |
| `remove_workspace` | path | `()` | 移除工作区 |
| `list_workspaces` | — | `Vec<Workspace>` | 列出所有工作区 |
| `get_workspace_config` | — | `WorkspaceConfig` | 获取当前工作区配置 |
| `save_workspace_config` | config | `()` | 保存工作区配置 |
| `get_config_path` | — | `String` | 获取配置文件路径 |

## Worktree 管理

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `list_worktrees` | — | `Vec<WorktreeListItem>` | 列出所有 worktree |
| `create_worktree` | name, projects | `()` | 创建 worktree |
| `archive_worktree` | name | `()` | 归档 |
| `restore_worktree` | name | `()` | 恢复 |
| `delete_archived_worktree` | name | `()` | 删除归档 |
| `check_worktree_status` | name | `ArchiveStatus` | 归档前检查 |
| `add_project_to_worktree` | wt_name, proj_name, branch | `()` | 添加项目 |
| `get_main_workspace_status` | — | `MainStatus` | 主工作区状态 |

## Git 操作

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `sync_with_base_branch` | project_path, base_branch | `String` | 同步基础分支 |
| `merge_to_test_branch` | project_path, test_branch | `String` | 合并到测试分支 |
| `merge_to_base_branch` | project_path, base_branch | `String` | 合并到基础分支 |
| `push_branch` | project_path | `String` | 推送 |
| `create_pull_request` | project_path, base_branch, title, body | `String` | 创建 PR，返回 URL |
| `get_branch_diff_stats` | project_path, base_branch | `DiffStats` | 差异统计 |
| `fetch_project_remote` | project_path | `()` | 后台 fetch |
| `clone_project` | name, repo_url, ... | `()` | 克隆项目 |
| `switch_branch` | project_path, branch | `()` | 切换分支 |
| `check_branches` | project_path | `BranchCheck` | 检查分支 |
| `get_branches` | project_path | `Vec<String>` | 获取分支列表 |

## PTY 终端

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `pty_create` | path | `String` | 创建终端，返回 session_id |
| `pty_write` | session_id, data | `()` | 写入 |
| `pty_read` | session_id | `Option<String>` | 读取输出 |
| `pty_resize` | session_id, cols, rows | `()` | 调整大小 |
| `pty_close` | session_id | `()` | 关闭 |
| `pty_exists` | session_id | `bool` | 是否存在 |
| `pty_close_by_path` | path | `()` | 按路径关闭 |

## 多窗口

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `set_window_workspace` | path | `()` | 绑定窗口到工作区 |
| `get_opened_workspaces` | — | `Vec<OpenedWS>` | 已打开的工作区 |
| `unregister_window` | — | `()` | 注销窗口 |
| `lock_worktree` | ws_path, wt_name | `()` | 锁定 |
| `unlock_worktree` | ws_path, wt_name | `()` | 解锁 |
| `get_locked_worktrees` | — | `Vec<Lock>` | 获取锁列表 |

## 分享 & Ngrok

详见 [[features/sharing-and-auth]] 和 [[features/ngrok-tunnel]]。

所有命令返回 `Result<T, String>`，错误为字符串格式。
```

- [ ] **Step 2: Write api/http-endpoints.md**

Migrate from `docs/API.md` (HTTP API section):

```markdown
---
tags: [api, http, browser-mode]
aliases: [HTTP 端点, REST API]
---

# HTTP 端点

浏览器模式下的 REST API。详见 [[dual-mode-communication]]。

## 认证

### POST /api/auth

```json
// Request
{ "password": "abc123" }

// Response 200
{ "session_id": "uuid", "workspace_path": "/path" }
```

限流: 5次/60秒/IP。

## 通用模式

大部分命令映射为 `POST /api/{command_name}`，与 [[api/tauri-commands|Tauri Commands]] 一一对应。

请求需携带 `x-session-id` header。

## localhost-only 端点

以下端点仅限 localhost 调用:
- `/api/open_terminal`
- `/api/open_editor`
- `/api/reveal_in_finder`

## 静态文件

- `GET /` → 服务 `dist/` 目录
- 用于浏览器端加载 React 应用
```

- [ ] **Step 3: Write api/websocket-protocol.md**

Migrate from `docs/API.md` (WebSocket section):

```markdown
---
tags: [api, websocket, realtime]
aliases: [WebSocket 协议]
---

# WebSocket 协议

连接: `ws://host:port/ws?session_id=xxx`

## 消息类型

### Server → Client

| type | 数据 | 用途 |
|------|------|------|
| `terminal_output` | `{ terminal_id, data }` | [[PTY]] 输出 |
| `worktree_lock` | `{ workspace, worktree, locked_by }` | 锁定通知 |
| `worktree_unlock` | `{ workspace, worktree }` | 解锁通知 |
| `terminal_state` | `{ terminals: {...} }` | 终端状态同步 |
| `kick` | `{ session_id }` | 被踢出 |

### Client → Server

| type | 数据 | 用途 |
|------|------|------|
| `terminal_input` | `{ terminal_id, data }` | [[PTY]] 输入 |

## 广播机制

- `LOCK_BROADCAST` channel → 所有客户端收到锁变更
- `TERMINAL_STATE_BROADCAST` channel → 所有客户端收到终端状态
- 带序列号防重复处理

详见 [[architecture/terminal-system#多窗口同步]]。
```

- [ ] **Step 4: No commit needed** (vault is not a git repo managed by this project)

---

### Task 9: Create vault development/ + reference/ files (Layer 3)

**Files:**
- Create 3 files under `development/`
- Create 3 files under `reference/`

- [ ] **Step 1: Write development/getting-started.md**

Migrate from `docs/DEVELOPMENT.md` (开发环境设置, 构建和运行):

```markdown
---
tags: [development, setup]
aliases: [快速开始]
---

# 快速开始

## 系统要求

- Node.js 20+
- Rust 1.70+
- Git 2.0+
- macOS / Linux / Windows

## 安装

```bash
# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Node.js (推荐 nvm)
nvm install 20 && nvm use 20

# 3. 项目依赖
git clone https://github.com/guoyongchang/worktree-manager.git
cd worktree-manager
npm install
```

## 开发

```bash
npm run dev          # Vite dev server (localhost:1420)
cargo tauri dev      # 启动桌面应用（自动连接 Vite）
```

- 前端: Vite 热重载
- 后端: 修改 Rust 代码需重启

## 构建

```bash
npm run build        # 前端构建 → dist/
cargo tauri build    # 完整应用打包
```

构建产物:
- macOS: `src-tauri/target/release/bundle/dmg/`
- Linux: `deb/` 或 `appimage/`
- Windows: `msi/`

## 推荐 IDE

VS Code / Cursor + 扩展: Rust Analyzer, Tauri, Tailwind CSS IntelliSense

## 调试

- 前端: DevTools (Cmd+Option+I)
- 后端: `log::info!()` → `~/Library/Logs/worktree-manager/`
- IPC 计时: `callBackend` 自动在 console 输出每次调用耗时
```

- [ ] **Step 2: Write development/code-conventions.md**

Migrate from `docs/DEVELOPMENT.md` (代码规范):

```markdown
---
tags: [development, conventions]
aliases: [代码规范]
---

# 代码规范

## TypeScript / React

- 组件: PascalCase (`WorktreeSidebar`)
- 函数: camelCase (`handleClick`)
- 常量: UPPER_SNAKE_CASE (`API_BASE_URL`)
- 类型: PascalCase, 优先 `interface` 而非 `type`
- 类型集中管理: `src/types.ts`
- 样式: Tailwind 实用类优先，避免 inline style

## Rust

- 函数/模块: snake_case (`create_worktree`)
- 类型/结构体: PascalCase (`WorkspaceConfig`)
- 错误处理: `Result<T, String>` + `?` 操作符
- 异步: `async/await` + Tokio runtime

## Git 提交

```
<type>(<scope>): <subject>
```

type: feat / fix / docs / style / refactor / perf / test / chore
```

- [ ] **Step 3: Write development/release-process.md**

```markdown
---
tags: [development, release]
aliases: [发布流程]
---

# 发布流程

## 1. 更新版本号

三处同步更新:
- `package.json` — `npm version patch/minor/major`
- `src-tauri/Cargo.toml` — version 字段
- `src-tauri/tauri.conf.json` — version 字段

## 2. 构建

```bash
cargo tauri build
```

## 3. 测试安装包

在目标平台测试生成的安装包。

## 4. 发布

```bash
git tag -a v{version} -m "Release v{version}"
git push origin v{version}
```

在 GitHub 创建 Release + 上传安装包 + Release Notes。

## 自动更新

应用内置 Tauri 更新器，启动时自动检查更新。
相关文件: `src/hooks/useUpdater.ts`, `src/components/UpdaterDialogs.tsx`
```

- [ ] **Step 4: Write reference/data-types.md**

Migrate from current `CLAUDE.md` (关键数据类型):

```markdown
---
tags: [reference, types]
aliases: [数据类型]
---

# 数据类型

> [!tip] 源码
> 完整定义见 `src/types.ts`。以下为核心类型摘要。

## 工作区

```typescript
interface WorkspaceConfig {
  name: string;
  worktrees_dir: string;             // 默认 "worktrees"
  projects: ProjectConfig[];
  linked_workspace_items: string[];   // 全局共享文件，如 [".claude", "CLAUDE.md"]
}

interface ProjectConfig {
  name: string;
  base_branch: string;      // 如 "main"
  test_branch: string;      // 如 "test"
  merge_strategy: string;   // "merge" | "rebase"
  linked_folders: string[]; // 如 ["node_modules", ".next"]
}
```

## Worktree

```typescript
interface WorktreeListItem {
  name: string;
  path: string;
  is_archived: boolean;
  projects: ProjectStatus[];
}

interface ProjectStatus {
  name: string;
  path: string;
  current_branch: string;
  base_branch: string;
  test_branch: string;
  has_uncommitted: boolean;
  uncommitted_count: number;
  is_merged_to_test: boolean;
  ahead_of_base: number;
  behind_base: number;
}
```

## 终端

```typescript
interface TerminalTab {
  name: string;
  path: string;
  isRoot: boolean;        // worktree 根终端
  isDuplicate: boolean;   // 复制的标签
}
```

## 其他

```typescript
type EditorType = 'vscode' | 'cursor' | 'idea';
type ViewMode = 'main' | 'settings';
```
```

- [ ] **Step 5: Write reference/config-files.md**

```markdown
---
tags: [reference, config]
aliases: [配置文件]
---

# 配置文件

## 全局配置

路径: `~/.config/worktree-manager/global.json`

```json
{
  "workspaces": [
    { "name": "项目A", "path": "/path/to/workspace-a" },
    { "name": "项目B", "path": "/path/to/workspace-b" }
  ],
  "current_workspace": "/path/to/workspace-a",
  "ngrok_token": "xxx",
  "share_port": 3000,
  "share_password": "abc123"
}
```

## 工作区配置

路径: `{workspace_root}/.worktree-manager.json`

```json
{
  "name": "项目A",
  "worktrees_dir": "worktrees",
  "linked_workspace_items": [".claude", "CLAUDE.md"],
  "projects": [
    {
      "name": "frontend",
      "base_branch": "main",
      "test_branch": "test",
      "merge_strategy": "merge",
      "linked_folders": ["node_modules", ".next"]
    }
  ]
}
```

详见 [[reference/data-types#工作区]] 了解完整类型定义。
```

- [ ] **Step 6: Write reference/directory-conventions.md**

```markdown
---
tags: [reference, directory, symlink]
aliases: [目录约定]
---

# 目录约定

## 工作区目录结构

```
workspace_root/
├── .worktree-manager.json        # [[reference/config-files|工作区配置]]
├── projects/                     # 主项目仓库（git clone 目的地）
│   ├── repo-a/
│   └── repo-b/
└── worktrees/                    # worktrees_dir（可配置名称）
    ├── feature-1/                # 活跃 [[features/worktree-lifecycle|worktree]]
    │   └── projects/
    │       ├── repo-a/           # git worktree (分支=feature-1)
    │       └── repo-b/
    ├── old-feature.archive/      # 已归档（.archive 后缀）
    └── ...
```

## Symlink 策略

### 项目级链接文件夹

配置在 `ProjectConfig.linked_folders` 中:
- `node_modules/`, `.next/`, `vendor/`, `target/` 等
- 通过 symlink 指向主项目对应目录，节省磁盘空间
- 创建 worktree 时自动建立

### 工作区级链接

配置在 `WorkspaceConfig.linked_workspace_items` 中:
- `.claude/`, `CLAUDE.md`, `requirement-docs/` 等
- 在所有 worktree 中保持一致
- symlink 指向 workspace_root 下的同名文件/目录

### 路径显示

超长路径通过 `min-w-0` + `truncate` 截断，hover 时 tooltip 显示完整路径。
```

---

### Task 10: Delete old docs/ files and verify

**Files:**
- Delete: `docs/ARCHITECTURE.md`
- Delete: `docs/FEATURES.md`
- Delete: `docs/API.md`
- Delete: `docs/DEVELOPMENT.md`
- Delete: `docs/PROJECT_OVERVIEW.md`
- Delete: `docs/NEW_FEATURES.md`
- Delete: `CLAUDE.md.bak` (backup from Task 1)

- [ ] **Step 1: Verify contracts are not affected**

```bash
npm run verify:contracts
```

Expected: PASS (the contracts script reads `src/lib/backend.ts`, `src-tauri/src/lib.rs`, and `src-tauri/src/http_server.rs` — none of which we changed).

- [ ] **Step 2: Delete old docs files**

```bash
rm docs/ARCHITECTURE.md docs/FEATURES.md docs/API.md docs/DEVELOPMENT.md docs/PROJECT_OVERVIEW.md docs/NEW_FEATURES.md
rm CLAUDE.md.bak
```

- [ ] **Step 3: Verify remaining docs/ structure**

```bash
ls -R docs/
```

Expected remaining:
```
docs/COMMAND_CONTRACTS.md
docs/claude/backend-state.md
docs/claude/dual-mode.md
docs/claude/terminal-architecture.md
docs/design-system.html
docs/generated/command-contracts.md
docs/superpowers/...
docs/icons/...
docs/en/...
docs/guide.html
docs/index.html
```

- [ ] **Step 4: Commit all changes**

```bash
git add -A
git commit -m "docs: remove old documentation files migrated to Obsidian vault

Content from ARCHITECTURE.md, FEATURES.md, API.md, DEVELOPMENT.md,
PROJECT_OVERVIEW.md, NEW_FEATURES.md has been migrated to:
/Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/

Remaining in docs/:
- COMMAND_CONTRACTS.md (contract verification)
- claude/ (on-demand Claude reference)
- superpowers/ (specs and plans)
- generated/ (auto-generated docs)
- HTML guide files"
```

- [ ] **Step 5: Final verification — read new CLAUDE.md**

```bash
cat CLAUDE.md
```

Verify it's ~40 lines and contains only: project overview, dev commands, file structure, core constraints, and @see references.
