# 架构文档

## 整体架构设计

Git Worktree Manager 采用 Tauri 2 框架构建，结合了 Rust 后端的高性能和 React 前端的灵活性。应用支持两种运行模式：

1. **桌面模式**：通过 Tauri 运行的原生桌面应用
2. **浏览器模式**：通过内置 HTTP 服务器提供的 Web 访问

### 架构分层

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
│  │  Management  │  │   Operations │  │   (git2-rs)      │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Terminal    │  │   Share      │  │   NGROK          │  │
│  │  (PTY)       │  │   Service    │  │   Tunnel         │  │
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

## 前端架构

### 组件结构

```
src/
├── App.tsx                          # 主应用组件
├── main.tsx                         # 应用入口
├── types.ts                         # TypeScript 类型定义
├── components/
│   ├── WorktreeSidebar.tsx         # 工作树侧边栏
│   ├── WorktreeDetail.tsx          # 工作树详情
│   ├── TerminalPanel.tsx           # 终端面板
│   ├── Terminal.tsx                # 终端组件
│   ├── GitOperations.tsx           # Git 操作组件
│   ├── SettingsView.tsx            # 设置视图
│   ├── WelcomeView.tsx             # 欢迎视图
│   ├── CreateWorktreeModal.tsx     # 创建工作树模态框
│   ├── AddWorkspaceModal.tsx       # 添加工作区模态框
│   ├── AddProjectModal.tsx         # 添加项目模态框
│   ├── AddProjectToWorktreeModal.tsx # 添加项目到工作树
│   ├── ArchiveConfirmationModal.tsx # 归档确认模态框
│   ├── ContextMenus.tsx            # 上下文菜单
│   ├── Icons.tsx                   # 图标组件
│   ├── UpdaterDialogs.tsx          # 更新对话框
│   └── ui/                         # UI 基础组件 (Radix UI)
│       ├── button.tsx
│       ├── dialog.tsx
│       ├── dropdown-menu.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── tooltip.tsx
│       └── ...
├── hooks/
│   ├── useWorkspace.ts             # 工作区状态管理
│   ├── useTerminal.ts              # 终端状态管理
│   └── useUpdater.ts               # 更新器状态管理
├── lib/
│   ├── backend.ts                  # 后端 API 调用
│   ├── websocket.ts                # WebSocket 管理
│   └── utils.ts                    # 工具函数
└── utils/
    └── updater.ts                  # 更新器工具
```

### 状态管理

应用使用 React Hooks 进行状态管理，主要的自定义 Hooks：

#### useWorkspace
管理工作区相关状态：
- 工作区列表
- 当前工作区
- 工作树列表
- 主工作区状态
- 工作区配置

#### useTerminal
管理终端相关状态：
- 终端标签页
- 活动终端
- 终端实例
- WebSocket 连接

#### useUpdater
管理应用更新状态：
- 检查更新
- 下载更新
- 安装更新
- 更新进度

### 数据流

```
User Action
    │
    ▼
Component Event Handler
    │
    ▼
Backend API Call (lib/backend.ts)
    │
    ├─► Tauri IPC (Desktop)
    │       │
    │       ▼
    │   Rust Command
    │
    └─► HTTP Request (Browser)
            │
            ▼
        Axum Handler
            │
            ▼
        Rust Command Implementation
            │
            ▼
        File System / Git / Process
            │
            ▼
        Response
            │
            ▼
        Update Component State
            │
            ▼
        Re-render UI
```

## 后端架构

### Rust 模块结构

```
src-tauri/src/
├── main.rs                 # 应用入口
├── lib.rs                  # 核心库，Tauri 命令定义
├── git_ops.rs              # Git 操作模块
├── pty_manager.rs          # 伪终端管理器
└── http_server.rs          # HTTP 服务器
```

### 核心模块

#### lib.rs - 核心库
- **全局状态管理**：
  - `PTY_MANAGER`：伪终端管理器
  - `WINDOW_WORKSPACES`：窗口与工作区绑定
  - `WORKTREE_LOCKS`：工作树锁定状态
  - `SHARE_STATE`：分享状态
  - `AUTHENTICATED_SESSIONS`：认证会话
  - `CONNECTED_CLIENTS`：连接的客户端

- **Tauri 命令**：
  - 工作区管理：`get_current_workspace`, `switch_workspace`, `add_workspace`, etc.
  - 工作树操作：`create_worktree`, `archive_worktree`, `restore_worktree`, etc.
  - Git 操作：`sync_with_base_branch`, `merge_to_test_branch`, `create_pull_request`, etc.
  - 终端管理：`create_terminal`, `write_to_terminal`, `resize_terminal`, etc.
  - 分享功能：`start_sharing`, `stop_sharing`, `get_share_state`, etc.
  - NGROK：`start_ngrok_tunnel`, `stop_ngrok_tunnel`, `get_ngrok_token`, etc.

#### git_ops.rs - Git 操作
- `get_worktree_info`：获取工作树信息（分支、提交数、合并状态）
- `get_branch_status`：获取分支状态（未提交、未推送、MR 状态）
- Git 命令执行封装

#### pty_manager.rs - 伪终端管理
- `PtyManager`：管理多个伪终端实例
- `create_terminal`：创建新终端
- `write_to_terminal`：写入数据到终端
- `resize_terminal`：调整终端大小
- `close_terminal`：关闭终端
- 使用 `portable-pty` 库实现跨平台支持

#### http_server.rs - HTTP 服务器
- **路由**：
  - `/api/workspaces`：工作区管理
  - `/api/worktrees`：工作树操作
  - `/api/terminals`：终端管理
  - `/api/git`：Git 操作
  - `/api/auth`：认证
  - `/ws`：WebSocket 连接
  - `/`：静态文件服务

- **中间件**：
  - CORS 支持
  - 请求体大小限制
  - 认证检查
  - 速率限制

- **WebSocket**：
  - 终端输入/输出
  - 状态广播
  - 客户端管理

## 通信机制

### 1. Tauri IPC

桌面模式下，前端通过 Tauri IPC 与后端通信：

```typescript
// 前端调用
import { invoke } from '@tauri-apps/api/core';

const result = await invoke('create_worktree', {
  name: 'feature-branch',
  projects: [{ name: 'frontend', baseBranch: 'main' }]
});
```

```rust
// 后端命令
#[tauri::command]
async fn create_worktree(
    window: Window,
    name: String,
    projects: Vec<CreateProjectRequest>,
) -> Result<(), String> {
    // 实现逻辑
}
```

### 2. HTTP API

浏览器模式下，前端通过 HTTP API 与后端通信：

```typescript
// 前端调用
const response = await fetch('/api/worktrees', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Session-Id': sessionId,
  },
  body: JSON.stringify({ name, projects }),
});
```

```rust
// 后端路由
async fn h_create_worktree(
    headers: HeaderMap,
    Json(req): Json<CreateWorktreeRequest>,
) -> Response {
    let sid = session_id(&headers);
    result_ok(create_worktree_impl(&sid, req.name, req.projects).await)
}
```

### 3. WebSocket

实时双向通信，主要用于终端和状态同步：

```typescript
// 前端 WebSocket
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'terminal_output') {
    terminal.write(msg.data);
  }
};

ws.send(JSON.stringify({
  type: 'terminal_input',
  terminal_id: 'term-1',
  data: 'ls\n',
}));
```

```rust
// 后端 WebSocket 处理
async fn handle_socket(socket: WebSocket, who: SocketAddr) {
    let (mut sender, mut receiver) = socket.split();

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                // 处理消息
            }
            _ => {}
        }
    }
}
```

### 4. NGROK Tunnel

使用 NGROK 将本地服务暴露到公网：

```rust
// 启动 NGROK 隧道
let tunnel = ngrok::Session::builder()
    .authtoken(token)
    .connect()
    .await?
    .http_endpoint()
    .listen_and_forward(format!("http://localhost:{}", port))
    .await?;

let public_url = tunnel.url();
```

## 数据流和状态管理

### 工作区配置

#### 全局配置
位置：`~/.config/worktree-manager/global.json`

```json
{
  "workspaces": [
    { "name": "项目A", "path": "/path/to/workspace-a" },
    { "name": "项目B", "path": "/path/to/workspace-b" }
  ],
  "current_workspace": "/path/to/workspace-a"
}
```

#### 工作区配置
位置：`{workspace}/.worktree-manager.json`

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

### 状态同步

1. **桌面模式**：
   - 使用 Tauri 事件系统
   - 后端通过 `window.emit()` 发送事件
   - 前端通过 `listen()` 接收事件

2. **浏览器模式**：
   - 使用 WebSocket 广播
   - 后端通过 `LOCK_BROADCAST` 和 `TERMINAL_STATE_BROADCAST` 发送消息
   - 前端通过 WebSocket 接收消息

### 会话管理

浏览器模式下的会话管理：

1. **认证**：
   - 客户端提交密码
   - 服务器验证并生成会话 ID
   - 会话 ID 存储在 `AUTHENTICATED_SESSIONS`

2. **会话绑定**：
   - 每个会话绑定到一个工作区
   - 存储在 `WINDOW_WORKSPACES`

3. **客户端跟踪**：
   - 记录连接的客户端信息
   - 存储在 `CONNECTED_CLIENTS`
   - 支持踢出客户端

### 工作树锁定

防止多个窗口同时操作同一个工作树：

```rust
// 锁定工作树
pub static WORKTREE_LOCKS: Lazy<Mutex<HashMap<(String, String), String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// 锁定
fn lock_worktree(workspace: &str, worktree: &str, window: &str) -> Result<(), String> {
    let mut locks = WORKTREE_LOCKS.lock().unwrap();
    let key = (workspace.to_string(), worktree.to_string());

    if let Some(owner) = locks.get(&key) {
        if owner != window {
            return Err("Worktree is locked by another window".to_string());
        }
    }

    locks.insert(key, window.to_string());
    Ok(())
}
```

## 安全性

### 认证机制
- 密码保护的分享功能
- 会话管理
- 速率限制（防止暴力破解）

### 数据隔离
- 每个会话独立的工作区绑定
- 工作树锁定机制
- 客户端隔离

### 文件系统安全
- 路径验证
- 符号链接安全检查
- 权限检查

## 性能优化

### 前端优化
- React 组件懒加载
- 虚拟滚动（终端输出）
- 防抖和节流
- WebSocket 连接复用

### 后端优化
- 异步 I/O（Tokio）
- 连接池
- 缓存机制
- 增量更新

### Git 操作优化
- 使用 libgit2（git2-rs）而非命令行
- 批量操作
- 并行处理
