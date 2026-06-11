# Worktree 颜色标记（Color Tag）设计

## 背景

之前实现的 worktree 状态系统（进行中/评审中/已完成/暂停）已被用户否决。用户希望改为类似 macOS Finder 标签的自由颜色标记系统：
- 右键 worktree → 选择颜色（6 种固定色）
- Branch Icon 随颜色染色
- 无颜色 = 默认态（不显示任何标记）

## 设计

### 数据模型

**Rust (`src-tauri/src/types.rs`)**
- 删除 `WorktreeStatus` 枚举
- 新增 `WorktreeColor` 枚举：`red` | `orange` | `yellow` | `green` | `blue` | `purple`
- `WorkspaceConfig.worktree_statuses` → `worktree_colors: HashMap<String, WorktreeColor>`
- `WorktreeListItem.status: Option<WorktreeStatus>` → `color: Option<WorktreeColor>`

**TypeScript (`src/types.ts`)**
- 删除 `WorktreeStatus` 类型
- 新增 `WorktreeColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'`
- `WorktreeListItem.status` → `color?: WorktreeColor`

### 颜色定义（macOS Finder 风格）

| 颜色 | Hex | Tailwind 映射 |
|------|-----|--------------|
| red | #FF453A | `text-red-400` |
| orange | #FF9500 | `text-orange-400` |
| yellow | #FFCC00 | `text-yellow-400` |
| green | #30D158 | `text-emerald-400` |
| blue | 主题 accent | `text-[var(--color-accent)]` |
| purple | #BF5AF2 | `text-purple-400` |

### UI 交互

**ExpandedSidebar**
- 移除 `WorktreeStatusBadge` DropdownMenu 组件
- Branch Icon (`GitBranch`) 根据 `worktree.color` 染色
  - 无颜色时保持默认 `text-[var(--color-accent)]`
  - 有颜色时使用对应 Tailwind class
- 右键菜单（ContextMenus）添加颜色选择区域

**CollapsedSidebar**
- Branch Icon 同样根据 `worktree.color` 染色
- 无颜色时保持默认

**右键菜单**
```
[归档]  ← 已有
─────────
🎨 标记颜色
● ● ●  ● ● ●  [清除]
```
- 菜单中新增"标记颜色"区域（或直接使用圆点行）
- 6 个颜色圆点横排 + "清除"按钮
- 点击后关闭菜单并更新颜色

### 后端命令

**`update_worktree_color`**（替换 `update_worktree_status`）
- 参数：`workspace_path?: string`, `worktree_name: string`, `color: WorktreeColor | null`
- 行为：读取 workspace config → 更新 `worktree_colors` 映射（`null` 则删除 key）→ 保存 config

### 双模式同步

修改已有命令：
- `backend.ts`：`updateWorktreeStatus()` → `updateWorktreeColor()`
- `lib.rs`：`update_worktree_status` → `update_worktree_color`
- `http_server.rs`：`h_update_worktree_status` → `h_update_worktree_color`
- `routing.rs`：路由同步更新

### 持久化

`worktree_colors` 字段存于 `.worktree-manager.json` 中。

示例：
```json
{
  "name": "My Workspace",
  "worktrees_dir": "worktrees",
  "projects": [...],
  "archived_worktrees": ["wt-old"],
  "worktree_colors": {
    "feature-123": "green",
    "feature-456": "purple"
  }
}
```

### 国际化

新增翻译 key：
- `contextMenu.setColor`: "标记颜色" / "Set Color"
- `contextMenu.removeColor`: "清除标记" / "Remove Color"

删除翻译 key（不再使用）：
- `sidebar.statusInProgress` 及其 tooltip
- `sidebar.statusInReview` 及其 tooltip
- `sidebar.statusCompleted` 及其 tooltip
- `sidebar.statusPaused` 及其 tooltip

### 涉及文件

| 文件 | 修改内容 |
|------|---------|
| `src-tauri/src/types.rs` | `WorktreeStatus` → `WorktreeColor`，字段重命名 |
| `src-tauri/src/commands/worktree.rs` | `update_worktree_status` → `update_worktree_color`，读取 color |
| `src-tauri/src/lib.rs` | handler 重命名 |
| `src-tauri/src/http_server.rs` | handler 重命名 |
| `src-tauri/src/http_server/routing.rs` | 路由重命名 |
| `src/types.ts` | `WorktreeStatus` → `WorktreeColor` |
| `src/lib/backend.ts` | `updateWorktreeStatus` → `updateWorktreeColor` |
| `src/hooks/useWorkspace.ts` | hook 方法重命名，乐观更新 |
| `src/components/worktree-sidebar/ExpandedSidebar.tsx` | 移除 StatusBadge，Icon 染色，右键菜单透传 color setter |
| `src/components/worktree-sidebar/CollapsedSidebar.tsx` | Icon 染色 |
| `src/components/ContextMenus.tsx` | 右键菜单添加颜色选择区域 |
| `src/components/WorktreeSidebar.tsx` | prop 透传 |
| `src/components/WorkspaceCell.tsx` | 连接 color setter |
| `src/components/worktree-sidebar/types.ts` | prop 重命名 |
| `src/locales/zh-CN.json` | 翻译调整 |
| `src/locales/en-US.json` | 翻译调整 |
| `docs/generated/command-contracts.md` | 命令名更新 |

### 兼容处理

- `serde(default)` 保证旧 config 无 `worktree_colors` 字段时不报错
- 旧 `worktree_statuses` 字段保留 `#[serde(default)]` 和 `skip_serializing_if`，读取时忽略，不写入
