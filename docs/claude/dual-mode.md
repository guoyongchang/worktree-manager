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
