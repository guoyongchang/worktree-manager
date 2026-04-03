# 左侧面板改进设计文档

**日期：** 2026-04-03  
**项目：** worktree-manager  
**功能：** 左侧面板可调整宽度、文本换行、名称排序

---

## 需求概述

为 worktree-manager 的左侧面板添加三项改进：

1. **可调整宽度** - 通过拖拽边框调整面板宽度（200-500px）
2. **文本换行** - Worktree 显示名称支持最多 2 行换行显示
3. **名称排序** - Worktree 列表按名称字母顺序排序

---

## 技术方案

### 方案选择：React 状态 + 鼠标事件

**选择理由：**
- 与现有 TerminalPanel 的拖拽实现保持一致
- 零外部依赖，保持项目轻量化
- 完全可控，便于后续扩展
- Tailwind CSS 原生支持所需样式

---

## 详细设计

### 1. 组件架构

**改动文件：**
- `src/components/WorktreeSidebar.tsx` - 添加宽度状态管理和持久化
- `src/components/worktree-sidebar/ExpandedSidebar.tsx` - 实现拖拽逻辑、排序、文本换行

**新增状态管理：**

在 `WorktreeSidebar.tsx` 中添加宽度状态：

```typescript
const [sidebarWidth, setSidebarWidth] = useState<number>(288) // 默认 288px (w-72)

// 从 localStorage 恢复宽度
useEffect(() => {
  const saved = localStorage.getItem('sidebar-width')
  if (saved) {
    const width = Number(saved)
    if (width >= 200 && width <= 500) {
      setSidebarWidth(width)
    }
  }
}, [])

// 持久化宽度到 localStorage
useEffect(() => {
  localStorage.setItem('sidebar-width', String(sidebarWidth))
}, [sidebarWidth])
```

**Props 传递：**

将 `sidebarWidth` 和 `setSidebarWidth` 通过 props 传递给 `ExpandedSidebar` 组件。

---

### 2. 拖拽交互实现

**拖拽手柄设计：**

在 `ExpandedSidebar.tsx` 的右边框添加拖拽区域：

- **位置：** 面板右边框，宽度 4px 的可交互区域
- **视觉反馈：**
  - 默认：透明边框
  - 鼠标悬停：显示蓝色高亮（`border-blue-500`）
  - 拖拽中：光标变为 `col-resize`，边框保持高亮
  - 拖拽手柄图标：3 条竖线（`|||`），悬停时显示

**事件处理逻辑：**

```typescript
const [isDragging, setIsDragging] = useState(false)

const handleMouseDown = (e: React.MouseEvent) => {
  e.preventDefault()
  setIsDragging(true)
}

useEffect(() => {
  if (!isDragging) return

  const handleMouseMove = (e: MouseEvent) => {
    const newWidth = e.clientX
    // 限制在 200-500px 范围内
    const clampedWidth = Math.max(200, Math.min(500, newWidth))
    setSidebarWidth(clampedWidth)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  return () => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }
}, [isDragging, setSidebarWidth])
```

**边界处理：**
- 最小宽度：200px（保证内容可读）
- 最大宽度：500px（避免占用过多空间）
- 拖拽时禁用文本选择（添加 `select-none` 到 body）
- 移动端：禁用拖拽功能，保持固定宽度 288px

**样式实现：**

```tsx
<div 
  style={{ width: `${sidebarWidth}px` }}
  className="bg-slate-800/50 border-r border-slate-700/50 flex flex-col shrink-0 relative"
>
  {/* 侧边栏内容 */}
  
  {/* 拖拽手柄 */}
  <div
    onMouseDown={handleMouseDown}
    className={cn(
      "absolute right-0 top-0 bottom-0 w-1 cursor-col-resize",
      "hover:bg-blue-500/50 transition-colors",
      isDragging && "bg-blue-500/50",
      "max-sm:hidden" // 移动端隐藏
    )}
  >
    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-12 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
      <GripVertical className="w-3 h-3 text-slate-400" />
    </div>
  </div>
</div>
```

---

### 3. Worktree 列表排序

**排序逻辑：**

在 `ExpandedSidebar.tsx` 中，对活跃和归档的 worktree 列表分别排序：

```typescript
const sortedActiveWorktrees = useMemo(() => {
  return [...activeWorktrees].sort((a, b) => 
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}, [activeWorktrees])

const sortedArchivedWorktrees = useMemo(() => {
  return [...archivedWorktrees].sort((a, b) => 
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}, [archivedWorktrees])
```

**排序规则：**
- 按 `name` 字段字母顺序升序排序
- 使用 `localeCompare()` 支持多语言字符（中文、英文等）
- `sensitivity: 'base'` 实现大小写不敏感排序
- 活跃和归档列表独立排序，不混合
- 使用 `useMemo` 避免每次渲染都重新排序
- 使用扩展运算符 `[...]` 创建新数组，避免修改原数组

**渲染更新：**

将原有的 `activeWorktrees` 和 `archivedWorktrees` 替换为排序后的版本：

```typescript
{sortedActiveWorktrees.map((worktree) => (
  <WorktreeListItem key={worktree.name} worktree={worktree} />
))}

{sortedArchivedWorktrees.map((worktree) => (
  <WorktreeListItem key={worktree.name} worktree={worktree} />
))}
```

---

### 4. Display Name 文本换行

**样式实现：**

在 `ExpandedSidebar.tsx` 的 worktree 列表项中，修改 display name 的样式：

**修改前：**
```tsx
<span className="truncate text-slate-100">
  {displayName}
</span>
```

**修改后：**
```tsx
<span className="line-clamp-2 break-words text-slate-100">
  {displayName}
</span>
```

**样式说明：**
- `line-clamp-2`：限制最多显示 2 行，超出部分显示省略号（`...`）
- `break-words`：允许在单词内部换行，避免超长单词溢出
- 保持现有的深色主题样式（`text-slate-100`）

**Tooltip 保留：**

保持现有的 Radix UI Tooltip 功能：
- 当文本被截断时，鼠标悬停显示完整内容
- Tooltip 内容使用完整的 `displayName` 或 `name`

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <span className="line-clamp-2 break-words text-slate-100">
      {displayName}
    </span>
  </TooltipTrigger>
  <TooltipContent>
    {displayName}
  </TooltipContent>
</Tooltip>
```

---

## 实现细节

### 响应式处理

**桌面端（≥640px）：**
- 支持拖拽调整宽度
- 宽度范围：200-500px
- 显示拖拽手柄

**移动端（<640px）：**
- 禁用拖拽功能（`max-sm:hidden`）
- 固定宽度 288px（保持现有行为）
- 保持现有的 overlay 模式

### 性能优化

1. **排序优化：** 使用 `useMemo` 缓存排序结果，仅在 worktree 列表变化时重新排序
2. **事件监听优化：** 仅在拖拽状态时添加全局 `mousemove` 和 `mouseup` 监听器
3. **持久化节流：** localStorage 写入在 `useEffect` 中自动批处理，无需额外节流

### 可访问性

1. **键盘导航：** 拖拽手柄不支持键盘操作（非关键功能）
2. **屏幕阅读器：** 拖拽手柄添加 `aria-label="调整侧边栏宽度"`
3. **视觉反馈：** 拖拽时提供清晰的视觉反馈（光标、边框高亮）

---

## 测试计划

### 功能测试

1. **拖拽调整宽度：**
   - 拖拽边框可以调整宽度
   - 宽度限制在 200-500px 范围内
   - 拖拽时光标变为 `col-resize`
   - 释放鼠标后宽度保持

2. **持久化：**
   - 刷新页面后宽度保持
   - 切换 worktree 后宽度保持
   - 关闭应用后重新打开宽度保持

3. **文本换行：**
   - 短名称单行显示
   - 长名称最多显示 2 行
   - 超长名称显示省略号
   - Tooltip 显示完整名称

4. **排序：**
   - 活跃 worktree 按名称排序
   - 归档 worktree 按名称排序
   - 中英文混合排序正确
   - 大小写不敏感

### 边界测试

1. **极端宽度：**
   - 拖拽到小于 200px 时停止
   - 拖拽到大于 500px 时停止

2. **极端名称：**
   - 单字符名称正常显示
   - 超长单词（无空格）正确换行
   - 特殊字符名称正常显示

3. **移动端：**
   - 拖拽手柄不显示
   - 宽度固定为 288px
   - 其他功能正常

---

## 风险与限制

### 已知限制

1. **移动端不支持拖拽：** 移动端屏幕空间有限，保持固定宽度
2. **最小宽度限制：** 200px 以下内容可读性差，不支持更窄的宽度
3. **排序不可配置：** 当前仅支持按名称升序排序，不支持自定义排序规则

### 潜在风险

1. **性能风险：** 如果 worktree 列表非常大（>100 项），排序可能影响性能
   - **缓解措施：** 使用 `useMemo` 缓存排序结果
2. **兼容性风险：** `line-clamp-2` 在旧版浏览器中可能不支持
   - **缓解措施：** Tauri 使用现代 WebView，无需担心旧浏览器

---

## 后续扩展

### 可选功能（不在本次实现范围）

1. **双击重置宽度：** 双击拖拽手柄恢复默认宽度 288px
2. **自定义排序规则：** 支持按修改时间、创建时间等排序
3. **宽度预设：** 提供"窄/中/宽"三个预设宽度快捷按钮
4. **拖拽动画：** 添加平滑的宽度过渡动画

---

## 实现检查清单

- [ ] 在 `WorktreeSidebar.tsx` 中添加宽度状态管理
- [ ] 在 `WorktreeSidebar.tsx` 中添加 localStorage 持久化
- [ ] 在 `ExpandedSidebar.tsx` 中实现拖拽逻辑
- [ ] 在 `ExpandedSidebar.tsx` 中添加拖拽手柄 UI
- [ ] 在 `ExpandedSidebar.tsx` 中实现 worktree 列表排序
- [ ] 在 `ExpandedSidebar.tsx` 中修改 display name 样式为 `line-clamp-2`
- [ ] 测试桌面端拖拽功能
- [ ] 测试移动端固定宽度
- [ ] 测试持久化功能
- [ ] 测试文本换行和 tooltip
- [ ] 测试排序功能
- [ ] 更新国际化文件（如需要）
