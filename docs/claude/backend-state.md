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
