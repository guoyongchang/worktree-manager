# Worktree 可切换状态 Badge 设计

## 背景

当前 Sidebar 中每个 active worktree 右侧的状态 Badge（"进行中"/"已完成"）是基于 `is_merged_to_base` 自动判断的。这个逻辑存在两个问题：
1. 刚创建的 worktree 还没合并任何项目，会被错误标记
2. 一个 worktree 里有多个项目时，可能只开发其中一个，自动判断会要求所有项目都 merged

因此状态应该是用户主观的工作流标记，而不是基于 git 状态的自动推断。

## 设计

### 数据模型

**Rust (`src-tauri/src/types.rs`)**
- 新增 `WorktreeStatus` 枚举：`in_progress` | `in_review` | `completed` | `paused`
- `WorkspaceConfig` 添加 `worktree_statuses: HashMap<String, WorktreeStatus>`（与现有 `archived_worktrees` 同级，存于 `.worktree-manager.json`）
- `WorktreeListItem` 添加 `status: Option<WorktreeStatus>`

**TypeScript (`src/types.ts`)**
- 新增 `WorktreeStatus = 'in_progress' | 'in_review' | 'completed' | 'paused'`
- `WorktreeListItem` 同步添加 `status?: WorktreeStatus`

### UI 交互

Sidebar 中每个 active worktree 右侧的 `StatusBadge` 改为可点击的 `DropdownMenu`：
- 点击 Badge 弹出下拉，列出 4 个状态选项（每个带对应颜色圆点标识）
- 选中后立即调用 `update_worktree_status` 命令更新
- 成功后刷新 worktree 列表
- 从未设置过状态的 worktree 默认显示为"进行中"

颜色映射：
- `in_progress` — 蓝色（`var(--color-accent)`）
- `in_review` — 紫色（`#a855f7`）
- `completed` — 绿色（`emerald-400`）
- `paused` — 灰色（`gray-400`）

### 后端命令

**`update_worktree_status`**
- 参数：`workspace_path?: string`, `worktree_name: string`, `status: WorktreeStatus`
- 行为：读取 workspace config → 更新 `worktree_statuses` 映射 → 保存 config
- 返回：`void`

**`scan_worktrees_dir`**（已有命令，修改）
- 在构建 `WorktreeListItem` 时，从 `config.worktree_statuses` 中查找对应 worktree 的状态
- 如果找到则填充到 `WorktreeListItem.status`，否则为 `None`

### 双模式同步

新增命令需同步三处：
1. `src/lib/backend.ts` — 添加 `updateWorktreeStatus()` 调用函数
2. `src-tauri/src/lib.rs` — `generate_handler!` 宏中注册
3. `src-tauri/src/http_server.rs` + `routing.rs` — 添加 HTTP handler 和路由

### 持久化

状态存储在 workspace 根目录的 `.worktree-manager.json` 中，与 `archived_worktrees` 同级字段 `worktree_statuses`。

示例：
```json
{
  "name": "My Workspace",
  "worktrees_dir": "worktrees",
  "projects": [...],
  "archived_worktrees": ["wt-old"],
  "worktree_statuses": {
    "feature-123": "in_review",
    "feature-456": "completed"
  }
}
```

### 国际化

新增翻译 key：
- `sidebar.statusInProgress` / `sidebar.statusInProgressTooltip`
- `sidebar.statusInReview` / `sidebar.statusInReviewTooltip`
- `sidebar.statusCompleted` / `sidebar.statusCompletedTooltip`
- `sidebar.statusPaused` / `sidebar.statusPausedTooltip`

### 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src-tauri/src/types.rs` | 新增 `WorktreeStatus` 枚举，修改 `WorkspaceConfig` 和 `WorktreeListItem` |
| `src-tauri/src/commands/worktree.rs` | `scan_worktrees_dir` 读取状态，新增 `update_worktree_status` 命令 |
| `src-tauri/src/lib.rs` | `generate_handler!` 注册新命令 |
| `src-tauri/src/http_server.rs` | 新增 `h_update_worktree_status` handler |
| `src-tauri/src/http_server/routing.rs` | 注册 `/api/update_worktree_status` 路由 |
| `src/types.ts` | 新增 `WorktreeStatus` 类型，修改 `WorktreeListItem` |
| `src/lib/backend.ts` | 新增 `updateWorktreeStatus()` 函数 |
| `src/hooks/useWorkspace.ts` | 新增 `updateWorktreeStatus` 方法 |
| `src/components/worktree-sidebar/ExpandedSidebar.tsx` | `StatusBadge` 改为可点击 DropdownMenu |
| `src/locales/zh-CN.json` | 新增状态相关翻译 |
| `src/locales/en-US.json` | 新增状态相关翻译 |
| `docs/generated/command-contracts.md` | 更新命令契约文档 |
