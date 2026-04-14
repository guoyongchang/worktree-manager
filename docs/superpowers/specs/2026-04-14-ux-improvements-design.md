# UX Improvements Design Spec
Date: 2026-04-14

## Overview

四项 UX 改进：IDE 图标右键选择器、主工作区 IDE 图标补全、Worktree 搜索优化（高亮 + 拼音）、操作日志面板。

---

## Feature 1+2: IDE 图标右键选择器

### 背景

- Worktree 详情页项目列表已有 IDE 图标（单击用默认 IDE 打开），但无右键选 IDE 功能
- 主工作区详情页项目列表**没有** IDE 图标，需补全
- 两处统一支持：单击=默认 IDE，右键=弹出 IDE 选择器

### 组件设计

**新增 `IdePickerContextMenu`**（`src/components/ContextMenus.tsx`）

```tsx
interface IdePickerContextMenuProps {
  x: number;
  y: number;
  editors: EditorConfig[];
  onSelect: (editorId: string) => void;
  onClose: () => void;
}
```

- 样式与现有 `WorktreeContextMenu` 一致（slate-800 背景、rounded-lg、shadow-xl）
- 每行显示 IDE 图标 + 名称
- 关闭逻辑：点击外部 overlay 关闭

**提取 `IdeIconButton`**（内联于 `WorktreeDetail.tsx`）

```tsx
interface IdeIconButtonProps {
  projectPath: string;
  projectName: string;
  editors: EditorConfig[];
  defaultEditorId: string;
  onOpen: (path: string, editorId: string) => void;
}
```

- 单击调用 `onOpen(projectPath, defaultEditorId)`
- `onContextMenu` 记录坐标，展示 `IdePickerContextMenu`
- 选中某 IDE 后调用 `onOpen(projectPath, selectedId)` 并关闭菜单

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/ContextMenus.tsx` | 新增 `IdePickerContextMenu` |
| `src/components/WorktreeDetail.tsx` | 提取 `IdeIconButton`；Worktree 项目列表替换现有 IDE 按钮；主工作区项目列表补充 `IdeIconButton` |

---

## Feature 3: Worktree 搜索优化

### 背景

- 搜索框紧贴 "ACTIVE (N)" 标签（无间距）
- 当前行为：过滤列表（无匹配则显示空状态）
- 不支持中文拼音

### 布局变更

将 `WorktreeList` 的标题行从：
```tsx
<div className="flex items-center gap-2">
  <span>ACTIVE (N)</span>
  <Input ... className="max-w-[180px]" />
</div>
```
改为：
```tsx
<div className="flex items-center justify-between">
  <span>ACTIVE (N)</span>
  <Input ... className="w-[160px]" />
</div>
```

两端对齐，搜索框靠右，与标签有自然间距。

### 行为变更：高亮取代过滤

- 有搜索词时，列表**全量显示**，匹配项在名称文字中高亮匹配片段
- 高亮样式：`<span className="text-blue-300 bg-blue-900/40 rounded-sm px-px">`
- 无匹配项时不显示空状态提示，列表正常展示（只是无高亮）
- 移除原有"无搜索结果"空状态 UI

### 拼音搜索

引入 `pinyin-pro` 库。匹配优先级（任一命中即高亮）：

1. **英文子串**：`name.toLowerCase().includes(query)`（兜底，无需转换）
2. **全拼匹配**：`pinyin(name, { toneType: 'none' }).join('').includes(query)`
3. **声母缩写**：`pinyin(name, { pattern: 'initial' }).join('').includes(query)`

**性能保障**：
- `useMemo` 缓存 `[searchQuery, sortedActiveWorktrees]`，依赖固定，不触发额外 state 更新
- pinyin 转换结果不在渲染函数内重复计算，高亮 ranges 与转换结果一并缓存

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/worktree-sidebar/ExpandedSidebar.tsx` | 布局调整；搜索逻辑改为高亮；新增 `highlightText` 渲染函数 |
| `package.json` | 新增 `pinyin-pro` 依赖 |

---

## Feature 4: 操作日志面板

### 背景

Worktree 操作（PR/MR、Sync、Push、Merge 等）缺乏可见日志，无法排查失败原因。

### 日志存储

**新文件 `src/lib/operationLog.ts`**（模块级单例）：

```ts
export type LogLevel = 'info' | 'success' | 'warn' | 'error'

export interface LogEntry {
  id: string           // `${Date.now()}-${counter++}` 模块内计数器
  timestamp: Date
  level: LogLevel
  operation: string    // 'refresh' | 'sync' | 'push' | 'pr' | 'merge' | 'open_ide' | ...
  message: string      // 简短描述
  detail?: string      // 完整命令输出 / 错误堆栈
}

// 内部存储
const store = new Map<string, LogEntry[]>()
const MAX_ENTRIES = 500  // 每个 workspace 上限

export function addLog(workspacePath: string, entry: Omit<LogEntry, 'id' | 'timestamp'>): void
export function getLogs(workspacePath: string): LogEntry[]
export function clearLogs(workspacePath: string): void
export function getErrorCount(workspacePath: string): number
```

### 插桩位置

在 `src/hooks/useWorkspaceActions.ts` 各操作的 try/catch 前后：

| 操作 | 记录内容 |
|------|---------|
| Refresh | `success` + worktree 数量；`error` + 错误信息 |
| Sync with base | `info` 开始；`success`/`error` + 命令输出 |
| Push to remote | `info` 开始；`success` + 分支；`error` + stderr |
| PR/MR 创建 | `info` 尝试；`success` + PR URL；`error` + 完整错误（包含 gh CLI 输出）|
| Merge to TEST/UAT | `info` 开始；`success`/`error` + 分支名 |
| Open in IDE | `info` + 项目名 + IDE 名 |

### UI 设计

**Logs 按钮**（`WorktreeDetail.tsx` Header 区域）：
- 文字按钮 `Logs`，ghost variant
- 有 `error` 级别未读日志时：按钮右上角显示红色数字角标（`getErrorCount()`）
- 已选 Worktree 或主工作区均显示（各自独立记录）

**日志查看器 Dialog**：
- 标题：`Logs — {worktreeName}`
- 右上角：清空按钮（`clearLogs` + 关闭）
- 内容区：**Monaco Editor**（`@monaco-editor/react`）
  - 主题：`vs-dark`
  - `readOnly: true`
  - `language: "plaintext"`（初始），后续可自定义 log tokenizer
  - 日志格式化为纯文本：
    ```
    [14:23:01] [INFO]    refresh        Loaded 5 worktrees
    [14:23:45] [SUCCESS] push           Pushed branch feature/foo to origin
    [14:24:10] [ERROR]   pr             Failed to create PR: gh: pull request create failed...
                                        Full output: ...
    ```
  - Monaco 懒加载（`@monaco-editor/react` 内部动态 import），不影响首屏
  - Dialog 尺寸：`max-w-4xl`，高度 `60vh`

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/operationLog.ts` | 新增（日志单例） |
| `src/components/WorktreeDetail.tsx` | Header 加 Logs 按钮；新增 `LogsDialog` 组件 |
| `src/hooks/useWorkspaceActions.ts` | 各操作前后插桩 `addLog` |
| `package.json` | 新增 `@monaco-editor/react` |

---

## 依赖清单

| 包 | 用途 | 大小 |
|----|------|------|
| `pinyin-pro` | 拼音搜索转换 | ~30KB gzip |
| `@monaco-editor/react` | 日志查看器（懒加载） | ~4MB 懒加载，不影响首屏 |

---

## 测试要点

- IDE 右键菜单在 Worktree 项目、主工作区项目两处均可触发
- 右键选择 IDE 后，调用正确的 `open_in_editor` 命令并传入选中 editor id
- 搜索高亮：英文子串、全拼、声母缩写均能触发高亮；搜索时无列表过滤
- 拼音搜索不产生无限 re-render（useMemo 依赖稳定）
- Logs 按钮角标在有 error 日志时显示，清空后消失
- Monaco 日志查看器正确展示各级别日志，Dialog 关闭后日志不丢失
