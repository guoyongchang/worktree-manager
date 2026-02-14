# Worktree Manager

Git worktree 管理工具，基于 Tauri 2 + React 19 + Rust，支持桌面端和浏览器远程访问双模式。

## 技术栈

- **后端**: Rust, Tauri 2, Axum (HTTP/WebSocket), git2, portable-pty
- **前端**: React 19, TypeScript, Tailwind CSS 4, Radix UI, xterm.js
- **双模式**: 桌面端通过 Tauri IPC 通信，浏览器端通过 HTTP + WebSocket 通信
- **前端统一入口**: `callBackend(command, args)` 自动判断运行环境路由到 IPC 或 HTTP

## 开发命令

```bash
npm install
npm run dev          # Vite dev server (localhost:1420)
cargo tauri dev      # 启动 Tauri 桌面应用（自动连接 Vite）
npm run build        # tsc + vite build → dist/
cargo tauri build    # 构建发布包
```

## 项目结构

```
src-tauri/src/
├── main.rs              # 入口，调用 lib.rs::run()
├── lib.rs               # (~2770行) 核心业务逻辑，所有 Tauri commands，全局状态管理
├── git_ops.rs           # (~800行) Git 操作（git2 读取 + Command 写入）
├── pty_manager.rs       # (~270行) PTY 伪终端管理（shell 会话生命周期）
└── http_server.rs       # (~1240行) Axum HTTP/WS 服务器（浏览器模式）

src/
├── App.tsx              # (~1230行) 主组件，所有模态框和全局状态编排
├── types.ts             # 所有 TypeScript 类型定义
├── constants.ts         # 终端常量（高度/轮询间隔/滚动缓冲等）
├── index.css            # 全局样式（动画、滚动条、禁用浏览器默认行为）
├── components/
│   ├── Terminal.tsx          # xterm.js 终端（PTY 会话、输入输出、自适应大小）
│   ├── TerminalPanel.tsx     # 终端面板容器（标签页、拖拽调整高度、全屏）
│   ├── WorktreeSidebar.tsx   # 左侧边栏（工作区列表、归档切换、锁定状态）
│   ├── WorktreeDetail.tsx    # 右侧详情（项目状态、Git 操作、分支管理）
│   ├── SettingsView.tsx      # 设置页（项目配置、链接文件夹、更新检查）
│   ├── ArchiveConfirmationModal.tsx  # 归档确认（警告/错误逐项确认）
│   ├── CreateWorktreeModal.tsx       # 创建 worktree 表单
│   ├── AddProjectModal.tsx           # 克隆新项目（含链接文件夹扫描）
│   ├── AddProjectToWorktreeModal.tsx # 向已有 worktree 添加项目
│   ├── AddWorkspaceModal.tsx          # 添加工作区弹窗
│   ├── BranchCombobox.tsx             # 分支选择下拉搜索
│   ├── ContextMenus.tsx               # 右键上下文菜单
│   ├── GitOperations.tsx     # Git 操作按钮组件
│   ├── WelcomeView.tsx       # 无工作区时的引导页
│   ├── UpdaterDialogs.tsx             # 应用更新提示弹窗
│   ├── Icons.tsx             # SVG 图标组件
│   └── ui/                   # shadcn/Radix UI 基础组件
├── hooks/
│   ├── useWorkspace.ts  # (~340行) 工作区状态管理（CRUD、Git操作、锁定）
│   ├── useTerminal.ts   # (~380行) 终端状态与多窗口同步（广播、防抖、去重）
│   └── useUpdater.ts    # 应用更新器状态
└── lib/
    ├── backend.ts       # (~350行) API 适配层（Tauri IPC / HTTP 自动切换）
    └── websocket.ts     # (~218行) WebSocket 管理器（PTY流、锁同步、终端状态）
```

## 后端全局状态 (lib.rs)

| 变量 | 类型 | 用途 |
|------|------|------|
| `PTY_MANAGER` | `Arc<Mutex<PtyManager>>` | PTY 会话池 |
| `WINDOW_WORKSPACES` | `HashMap<window_label, path>` | 窗口→工作区绑定 |
| `WORKTREE_LOCKS` | `HashMap<(ws_path, wt_name), label>` | worktree 排他锁 |
| `TERMINAL_STATES` | `HashMap<(ws_path, wt_name), state>` | 终端状态同步 |
| `SHARE_STATE` | `ShareState` | HTTP 分享状态 |
| `AUTHENTICATED_SESSIONS` | `HashSet<session_id>` | 已认证浏览器会话 |
| `CONNECTED_CLIENTS` | `HashMap<session_id, client>` | 连接客户端追踪 |
| `LOCK_BROADCAST` / `TERMINAL_STATE_BROADCAST` | broadcast::Channel | WebSocket 广播通道 |

## Tauri Commands 分类 (~61个)

- **工作区 (9)**: list/get/switch/add/remove/create_workspace, get/save_config, get_config_path
- **Worktree (8)**: list/create/archive/restore/delete_archived, check_status, add_project, get_main_status
- **Git (11)**: switch_branch, clone_project, sync_base, push, merge_test/base, diff_stats, create_pr, fetch_remote, check/get_branches
- **PTY (7)**: create/write/read/resize/close/exists/close_by_path
- **多窗口 (6)**: set_workspace, get_opened, unregister, lock/unlock/get_locked
- **系统 (4)**: open_terminal/editor/finder/log_dir
- **分享 (6)**: start/stop_sharing, get_state, update_password, get/kick_clients
- **ngrok (4)**: get/set_token, start/stop_tunnel
- **其他**: broadcast_terminal_state, scan_linked_folders, open_workspace_window

## HTTP API (浏览器模式)

- 路由模式: `POST /api/{command}` + JSON body
- 认证: `x-session-id` header, 限流 5次/60秒/IP
- WebSocket: `/ws?session_id=xxx`，复用 PTY 输出 / 锁更新 / 终端状态
- 安全: localhost-only 限制（terminal/editor/finder 操作）, CSP headers

## 配置文件

- **全局配置**: `~/.config/worktree-manager/global.json` (workspaces[], ngrok_token, 分享设置)
- **工作区配置**: `{workspace_root}/.worktree-manager.json` (projects[], linked_workspace_items)

## 目录约定

```
workspace_root/
├── .worktree-manager.json        # 工作区配置
├── projects/                     # 主项目仓库（git clone 目的地）
│   ├── repo-a/
│   └── repo-b/
└── worktrees/                    # worktrees_dir（可配置名称）
    ├── feature-1/                # 活跃 worktree
    │   └── projects/
    │       ├── repo-a/           # git worktree (分支=feature-1)
    │       └── repo-b/
    ├── old-feature.archive/      # 已归档（.archive 后缀）
    └── ...
```

- **链接文件夹**: `node_modules/`, `.next/` 等大目录通过 symlink 共享，节省磁盘
- **工作区级链接**: `.claude/`, `CLAUDE.md` 等通过 linked_workspace_items 配置
- **归档**: 重命名为 `.archive` 后缀，归档前关闭 PTY 并移除 git worktree 注册

## 终端系统

- **桌面端**: Tauri IPC 调用 pty_* 命令，前端 100ms 轮询 pty_read
- **浏览器端**: WebSocket 实时推送 PTY 输出
- **会话 ID**: `pty-{path-with-dashes}` 格式，复制标签用 `path#timestamp`
- **同步**: 多窗口/多客户端通过 broadcast channel + 序列号去重 + 防抖
- **默认高度**: 280px (MIN: 100, MAX: 600), 窗口默认 1100x700
- **状态隔离**: 终端标签按 worktree 保存/恢复，切换 worktree 时互不干扰

## 关键数据类型

```typescript
// 工作区
WorkspaceConfig { name, worktrees_dir, projects: ProjectConfig[], linked_workspace_items: string[] }
ProjectConfig { name, base_branch, test_branch, merge_strategy, linked_folders: string[] }

// Worktree
WorktreeListItem { name, path, is_archived, projects: ProjectStatus[] }
ProjectStatus { name, path, current_branch, base_branch, test_branch,
                has_uncommitted, uncommitted_count, is_merged_to_test, ahead_of_base, behind_base }

// 终端
TerminalTab { name, path, isRoot, isDuplicate }

// 编辑器
EditorType = 'vscode' | 'cursor' | 'idea'
ViewMode = 'main' | 'settings'
```

## 多窗口/多客户端同步

1. **Worktree 锁定**: 桌面端选择 worktree 时获取排他锁，其他窗口/客户端显示为锁定
2. **终端状态同步**: 通过 Tauri event (桌面) / WebSocket (浏览器) 广播，带序列号防重复
3. **锁广播**: LOCK_BROADCAST channel → WebSocket 推送给所有浏览器客户端
4. **浏览器端不锁定**: 浏览器客户端只读查看，不获取锁

## 性能优化

- **Git 操作两阶段加载**: 先显示本地数据（毫秒级），后台 fetch 远程仓库（3-6s），fetch 期间按钮禁用并显示进度条
- **fetch_project_remote**: 独立的 `spawn_blocking` 命令，避免阻塞 tokio runtime
- **check_remote_branch_exists**: 使用 `git branch -r --list`（本地检查），不再触发网络请求
- **Loading overlay**: 加载状态使用 fixed overlay 而非 early return，避免组件卸载/重挂载风暴
- **IPC 计时日志**: callBackend 自动记录每次调用耗时，便于性能调优

## 注意事项

- Git 操作混用 git2 crate (读取) 和 Command (写入)，Command 更安全不会锁库
- `archive_worktree` 归档前会检查并删除已存在的 `.archive` 目录
- `restore_worktree` 恢复时会重新注册 git worktree 和重建 symlink
- HTTP 模式下 open_terminal/open_editor/reveal_finder 仅限 localhost 调用
- 认证使用常量时间比较防止时序攻击
- ngrok token 目前明文存储（TODO: 使用 OS keychain）
- 超长路径通过 min-w-0 + truncate 截断，hover 时 tooltip 显示完整路径
