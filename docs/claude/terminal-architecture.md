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
