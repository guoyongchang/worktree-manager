# 前端优化 + 移动端适配 实施计划

## 方案总览

- **移动端导航**：底部标签栏（Worktrees | 详情 | 终端 | 设置）
- **移动端终端**：全屏独立页面
- **桌面端**：视觉细节优化
- **断点**：`md:` (768px) — 以下为移动端布局

---

## 文件改动清单

### 1. `src/hooks/useMobile.ts` — 新建，移动端检测 hook

```ts
export function useMobile(): boolean
```
- 监听 `window.matchMedia('(max-width: 767px)')` 变化
- 返回 `isMobile` boolean

### 2. `src/components/MobileTabBar.tsx` — 新建，底部标签栏

4 个标签：
| 标签 | 图标 | 对应视图 |
|------|------|---------|
| Worktrees | FolderIcon | worktree 列表（复用 WorktreeSidebar 内容） |
| 详情 | GitBranchIcon | WorktreeDetail |
| 终端 | TerminalIcon | 全屏 TerminalPanel |
| 设置 | SettingsIcon | SettingsView |

固定在底部：`fixed bottom-0 inset-x-0 h-14 bg-slate-800 border-t border-slate-700`
安全区适配：`pb-[env(safe-area-inset-bottom)]`

### 3. `src/App.tsx` — 主布局重构

**移动端布局**（`isMobile` 时）：
```
<div class="h-screen flex flex-col">
  <div class="flex-1 overflow-hidden">
    {activeTab === 'worktrees' && <WorktreeSidebar mobile />}
    {activeTab === 'detail' && <WorktreeDetail />}
    {activeTab === 'terminal' && <TerminalPanel fullscreen />}
    {activeTab === 'settings' && <SettingsView />}
  </div>
  <MobileTabBar activeTab={activeTab} onChange={setActiveTab} />
</div>
```

**桌面端布局**：保持现有三栏结构，无结构性变更

**新增状态**：
- `mobileTab: 'worktrees' | 'detail' | 'terminal' | 'settings'`
- 选择 worktree 后自动切到 'detail' 标签

### 4. `src/components/WorktreeSidebar.tsx` — 移动端适配

新增 `mobile?: boolean` prop：
- 移动端：去掉 `w-72` 固定宽度，改为 `w-full h-full`
- 去掉 collapsed 模式
- 工作区选择器全宽
- Worktree 列表项增大触摸面积：`py-3.5`
- 底部栏隐藏（已有 MobileTabBar）

### 5. `src/components/WorktreeDetail.tsx` — 响应式优化

- 头部操作栏：移动端按钮换行 `flex-wrap`
- 项目卡片：移动端单列（去掉 `grid-cols-2`）
- Git 操作按钮：移动端 `grid grid-cols-2`
- 触摸优化：操作按钮始终可见（不再 hover 显示）

### 6. `src/components/TerminalPanel.tsx` — 移动端全屏

新增 `mobileFullscreen?: boolean` prop：
- 移动端：`fixed inset-0 z-40`
- 标签栏标签更大触摸面积
- 隐藏全屏/折叠按钮

### 7. `src/components/SettingsView.tsx` — 响应式

- 容器 padding：移动端 `p-4`
- 表单输入全宽
- 按钮组 `flex-wrap`

### 8. `src/components/GitOperations.tsx` — 响应式按钮

- 移动端：`grid grid-cols-2` 替代 `flex`
- 按钮始终可见

### 9. 模态框响应式

`dialog.tsx` 中 DialogContent 加移动端 `max-w-[calc(100vw-2rem)]`

### 10. `src/index.css` — 移动端样式

- 安全区 padding
- 禁止 overscroll bounce

### 11. `index.html` — viewport meta

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no" />
```

### 12. 桌面端视觉优化

- 项目卡片更精致的阴影和渐变
- 侧边栏 hover 动效
- 空状态视觉优化
- Git 进度条增强

---

## 不变动

- 后端 Rust 代码
- Terminal.tsx 内部
- 终端状态架构
- WebSocket/backend.ts
- hooks/useTerminal.ts、hooks/useWorkspace.ts

## 验证

1. `npx tsc --noEmit` 通过
2. 桌面端布局不受影响
3. 移动端底部标签栏正常
4. 移动端终端全屏可用
5. 模态框不溢出
