# UX Improvements Design Spec
Date: 2026-04-14  
Rev: 2 (post code-review fixes)

## Overview

四项 UX 改进：IDE 图标右键选择器、主工作区 IDE 图标补全、Worktree 搜索优化（高亮 + 拼音）、操作日志面板。

---

## Feature 1+2: IDE 图标右键选择器

### 背景

- Worktree 详情页项目列表已有 IDE 图标（单击用默认 IDE 打开），但无右键选 IDE 功能
- 主工作区详情页项目列表**没有** IDE 图标，需补全
- 两处统一支持：单击=默认 IDE，右键=弹出 IDE 选择器
- 仅 Tauri 桌面模式显示（与现有 IDE 按钮一致，加 `isTauri()` guard）
- 移动端 / 浏览器模式不显示（`onContextMenu` 在移动端不可靠）

### 组件设计

**新增 `IdePickerContextMenu`**（`src/components/ContextMenus.tsx`）

```tsx
interface IdePickerContextMenuProps {
  x: number;
  y: number;
  editors: Array<{ id: string; name: string }>;  // 匹配 detectedEditors 实际类型
  onSelect: (editorId: string) => void;
  onClose: () => void;
}
```

- 样式与现有 `WorktreeContextMenu` 一致（slate-800 背景、rounded-lg、shadow-xl）
- 每行显示 IDE 名称（图标通过 `EditorIcon` 组件从 localStorage 读取，与现有实现一致）
- 关闭逻辑：点击外部 overlay 关闭

**提取 `IdeIconButton`**（内联于 `WorktreeDetail.tsx`）

```tsx
interface IdeIconButtonProps {
  projectPath: string;
  projectName: string;
  editors: Array<{ id: string; name: string }>;  // detectedEditors 实际类型
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
| `src/components/WorktreeDetail.tsx` | 提取 `IdeIconButton`；Worktree 项目列表替换现有 IDE 按钮；主工作区项目列表补充 `IdeIconButton`（加 `isTauri()` guard） |
| `src/locales/en-US.json` | 新增 i18n key（见下方清单） |
| `src/locales/zh-CN.json` | 新增 i18n key（见下方清单） |

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

- 有搜索词时，列表**全量显示，保持原排序**，匹配项名称中高亮匹配片段
- 高亮样式：`<span className="text-blue-300 bg-blue-900/40 rounded-sm px-px">`
- 无匹配项时不显示空状态提示，列表正常展示（只是无高亮）
- 移除原有"无搜索结果"空状态 UI；**保留**"无 worktree"空状态 UI（`sortedActiveWorktrees.length === 0` 时）

### 拼音搜索

引入 `pinyin-pro` 库。匹配优先级（任一命中即高亮）：

1. **英文子串**：`name.toLowerCase().includes(query)`（兜底，无需转换）
2. **全拼匹配**：`pinyin(name, { toneType: 'none', type: 'array' }).join('').includes(query)`
3. **声母缩写**：`pinyin(name, { pattern: 'initial', type: 'array' }).join('').includes(query)`

> 注意：`pinyin-pro` 的 `pinyin()` 需传 `{ type: 'array' }` 才返回数组，否则返回字符串，`.join('')` 无意义。实现前验证安装版本的 API。

**性能保障**：
- `useMemo` 缓存 `[searchQuery, sortedActiveWorktrees]`，依赖固定，不触发额外 state 更新
- 搜索 input 加 **100ms debounce**，避免 pinyin 转换在每次按键时阻塞渲染
- pinyin 转换结果与高亮 ranges 一并在 `useMemo` 内计算，不在渲染函数内重复执行

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/components/worktree-sidebar/ExpandedSidebar.tsx` | 布局调整；搜索逻辑改为高亮；新增 `highlightText` 渲染函数；input debounce |
| `package.json` | 新增 `pinyin-pro` 依赖 |

---

## Feature 4: 操作日志面板

### 背景

Worktree 操作（PR/MR、Sync、Push、Merge 等）缺乏可见日志，无法排查失败原因。

### 约束

- **仅 Tauri 桌面模式**：Logs 按钮加 `isTauri()` guard。浏览器模式页面刷新会丢失内存日志，且 WS 重连也会导致 React 重载，内存日志不可靠。
- 内存存储，不持久化到磁盘。

### 日志存储

**新文件 `src/lib/operationLog.ts`**（模块级单例）：

```ts
export type LogLevel = 'info' | 'success' | 'warn' | 'error'

export interface LogEntry {
  id: string           // `${Date.now()}-${counter++}` 模块内计数器
  timestamp: Date
  level: LogLevel
  operation: string    // ASCII-only: 'refresh' | 'sync' | 'push' | 'pr' | 'merge' | 'open_ide'
  message: string      // 简短描述
  detail?: string      // 完整命令输出 / 错误堆栈
}

const store = new Map<string, LogEntry[]>()   // key: projectPath
const MAX_ENTRIES = 500                        // 每个 project 上限，超出时移除最旧的

export function addLog(projectPath: string, entry: Omit<LogEntry, 'id' | 'timestamp'>): void
export function getLogs(projectPath: string): LogEntry[]
export function clearLogs(projectPath: string): void
export function getUnreadErrorCount(projectPath: string): number  // 未读 error 数
export function markAsRead(projectPath: string): void             // 打开 Dialog 时调用
```

**Key 设计**：使用 `projectPath` 而非 `workspacePath` 作为 store key，避免 `workspacePath` 需要透传多层组件。`GitOperations` 已有 `projectPath` prop。

**已读状态**：每个 projectPath 维护一个 `lastReadIndex`，`markAsRead` 更新为当前日志长度，`getUnreadErrorCount` 只统计 `lastReadIndex` 之后的 error 条目。打开 Dialog 时调用 `markAsRead`，角标立即消失。

### 插桩位置

**目标文件：`src/components/GitOperations.tsx`**（而非 `useWorkspaceActions.ts`，后者不包含 git 操作）

实际插桩位置（`GitOperations.tsx` 中的函数）：

| 函数 | 操作 | 记录内容 |
|------|------|---------|
| `handleRefresh` | refresh | `success` + worktree 数量；`error` + 错误信息 |
| `runGitAction` → sync | sync | `info` 开始；`success`/`error` + 命令输出 |
| `runGitAction` → push | push | `info` 开始；`success` + 分支；`error` + stderr |
| PR 创建回调 | pr | `info` 尝试；`success` + PR URL；`error` + 完整错误 |
| `runGitAction` → merge TEST/UAT | merge | `info` 开始；`success`/`error` + 分支名 |

Open in IDE 在 `WorktreeDetail.tsx` 的 `onOpenInEditor` 调用处插桩：`info` + 项目名 + IDE 名。

### 日志格式

```
[14:23:01] [INFO]    refresh   Loaded 5 worktrees
[14:23:45] [SUCCESS] push      Pushed branch feature/foo to origin
[14:24:10] [ERROR]   pr        Failed to create PR: gh: pull request create failed
                               Full output: <stderr content>
```

操作名均为 ASCII（无中文），避免等宽字体 CJK 双宽字符导致列对齐错乱。

### UI 设计

**Logs 按钮**（`WorktreeDetail.tsx` Header 区域，仅 `isTauri()` 时显示）：
- 文字按钮 `Logs`，ghost variant
- 有**未读** `error` 日志时：右上角红色数字角标（`getUnreadErrorCount()`）
- 打开 Dialog 时调用 `markAsRead(projectPath)`，角标立即清零

**日志查看器 Dialog**：
- 标题：`Logs — {projectName}`
- 右上角：清空按钮（`clearLogs(projectPath)` + 关闭 Dialog）
- 内容区：**Monaco Editor**（`@monaco-editor/react`，懒加载）
  - 主题：`vs-dark`
  - `readOnly: true`，`language: "plaintext"`
  - 后续可注册自定义 tokenizer 给 `[ERROR]`/`[SUCCESS]` 上色
  - Dialog 尺寸：`max-w-4xl`，内容区高度 `60vh`
- Dialog 关闭后日志不丢失（存于模块单例，不依赖组件生命周期）

### 文件变更

| 文件 | 变更 |
|------|------|
| `src/lib/operationLog.ts` | 新增（日志单例，含已读状态） |
| `src/components/WorktreeDetail.tsx` | Header 加 Logs 按钮（`isTauri()` guard）；新增 `LogsDialog` 组件 |
| `src/components/GitOperations.tsx` | 各操作前后插桩 `addLog` |
| `package.json` | 新增 `@monaco-editor/react` |
| `src/locales/en-US.json` | 新增 i18n key（见下方清单） |
| `src/locales/zh-CN.json` | 新增 i18n key（见下方清单） |

---

## i18n Key 清单

| Key | en-US | zh-CN |
|-----|-------|-------|
| `logs.button` | `Logs` | `日志` |
| `logs.title` | `Logs — {{name}}` | `日志 — {{name}}` |
| `logs.clear` | `Clear` | `清空` |
| `logs.empty` | `No logs yet.` | `暂无日志` |
| `contextMenu.openInIde` | `Open in IDE` | `用 IDE 打开` |
| `detail.openInEditorPicker` | `Choose IDE` | `选择 IDE` |

---

## 依赖清单

| 包 | 用途 | 大小 |
|----|------|------|
| `pinyin-pro` | 拼音搜索转换 | ~30KB gzip |
| `@monaco-editor/react` | 日志查看器（懒加载） | ~4MB 懒加载，Tauri 内嵌资源，不影响首屏 |

---

## 测试要点

- IDE 右键菜单在 Worktree 项目、主工作区项目两处均可触发（Tauri 模式）
- 右键选择 IDE 后，调用正确的 `open_in_editor` 并传入选中 editor id
- 浏览器模式下 IDE 图标和 Logs 按钮不显示
- 搜索高亮：英文子串、全拼、声母缩写均能触发高亮；搜索时列表不过滤、不重排序
- "无 worktree"空状态在无内容时仍正常显示
- 拼音搜索不产生无限 re-render（useMemo 依赖稳定，input debounce 生效）
- Logs 未读角标：有 error 日志时显示；打开 Dialog 后消失；清空后消失
- Monaco 日志查看器正确展示各级别日志；Dialog 关闭后重新打开日志仍在
- `GitOperations.tsx` 插桩：每个 git 操作成功/失败均有对应日志条目
