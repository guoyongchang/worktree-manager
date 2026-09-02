# Worktree Manager

Git worktree 管理工具 | Tauri 2 + React 19 + Rust | 桌面端 + 浏览器双模式

## 开发命令

npm install / npm run dev / cargo tauri dev / npm run build / cargo tauri build

### 重启 dev 流程
必须先构建前端再启动 Tauri，否则会因缓存过期报错：
```bash
pnpm run build && npm run tauri dev
```
**不要**直接运行 `npx tauri dev` 或 `cargo tauri dev`。

## 项目结构

```
src-tauri/src/: main.rs, lib.rs(核心~2770行), git_ops.rs(~800行), pty_manager.rs(~270行), http_server.rs(~1240行)
src/: App.tsx(~1230行), types.ts, constants.ts, index.css
  components/: WorktreeSidebar, WorktreeDetail, Terminal, TerminalPanel, GitOperations, SettingsView, CreateWorktreeModal, ArchiveConfirmationModal, AddProjectModal, AddProjectToWorktreeModal, AddWorkspaceModal, BranchCombobox, ContextMenus, WelcomeView, UpdaterDialogs, Icons, ui/
  hooks/: useWorkspace(~340行), useTerminal(~380行), useUpdater
  lib/: backend(~350行), websocket(~218行)
```

## 设计规范

所有 UI 工作先读 `designs/readme.md`（tokens、组件、UI kit、字体、参考截图都在 `designs/` 下），严格按其中的颜色/字体/间距执行。做 UI/设计相关任务时也可触发 `worktree-manager-design` skill（`.claude/skills/`）。设计系统的唯一来源是 `designs/`，同步更新只改这里。

## 核心约束（必须遵守）

### 终端状态分离
activatedTerminals（标签栏显示）和 mountedTerminals（组件挂载/PTY 生命周期）必须分离，绝对不能合并。
- Terminal 组件卸载会调用 pty_close 销毁后端 PTY 会话
- 切换 worktree 时用 display:none + visible:false 隐藏，**不卸载**
- 归档 worktree 时必须调用 cleanupTerminalsForPath() 清理 mountedTerminals
- 语音输入在切换 worktree 或终端标签时自动关闭

### Git 操作混用规则
读取用 git2 crate，写入用 Command。Command 更安全不会锁库。
- 合并到 test/uat 走 `merge_current_branch_into_remote_target`：先 fetch，再在 detached HEAD 上基于 `origin/<target>` 合并并 `push HEAD:<target>`，绝不 checkout 本地 test/uat 分支（避免与主工作区/其他 worktree 的分支冲突、避免本地分支陈旧/分叉）。
- 所有 `git pull` 必须带 `--no-rebase --no-edit`；所有 git 子进程通过 `utils::git_command()`（stdin=null、GIT_TERMINAL_PROMPT=0），长操作使用 `run_git_command_with_timeout_secs`。

### Windows 稳定性规则（tauri-apps/tauri#15408）
- **禁止在非主线程 clone / drop `AppHandle` / `Window` / `Webview`**：tao 在 Windows 上用非原子 `Rc` 管理事件循环，跨线程引用计数会导致 ILLEGAL_INSTRUCTION / ACCESS_VIOLATION 崩溃。工作线程、tokio 任务、HTTP handler 一律用 `state::with_app_handle(|h| h.emit(...))` 借用，不要 `APP_HANDLE.lock().clone()`。PTY 读线程不得触碰 AppHandle（桌面端走轮询）。
- 归档/恢复只改 `archived_worktrees` 配置，不做任何 git / 文件操作（恢复仅修复 git 已无法打开的残缺项目目录，健康目录即使切了分支/有未提交改动也不碰）；`git worktree remove`、目录删除、`branch -D` 只发生在删除已归档 worktree 时。Restart Manager 文件占用检查只是诊断（只注册普通文件、限批次/长度/时长），仅在删除失败时用于提示占用进程。
- Worktree 生命周期锁必须用 `state::lock_lifecycle_with_timeout` 获取，禁止无限期 `.lock()`。恢复归档 worktree 不做任何网络操作（upstream 用 `branch --set-upstream-to` 本地设置）。

### 双模式命令同步
前端统一入口 callBackend(command, args)，自动路由到 IPC 或 HTTP。
新增命令须同步三处: backend.ts + lib.rs generate_handler + HTTP 路由。
运行 npm run contracts 验证同步。

### 性能约束
- Git 操作两阶段加载：先显示本地数据（毫秒级），后台 fetch 远程（3-6s），fetch 期间按钮禁用并显示进度条
- Loading 状态用 fixed overlay 而非 early return，避免组件卸载/重挂载风暴
- check_remote_branch_exists 使用 git branch -r --list（本地检查），不触发网络请求

## 按需参考（需要时读取）

- 后端全局状态 + 命令分类 → /Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/claude-reference/backend-state.md
- 终端系统架构详情 → /Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/claude-reference/terminal-architecture.md
- 双模式通信详情 → /Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/claude-reference/dual-mode.md
- 命令契约同步规则 → /Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/claude-reference/COMMAND_CONTRACTS.md
- 完整知识库(Obsidian) → /Users/guo/Work/GuoVault/Guo/workspaces/worktree-manager/CLAUDE.md
- 数据类型定义 → src/types.ts
