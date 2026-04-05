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
