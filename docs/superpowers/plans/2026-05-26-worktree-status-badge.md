# Worktree 可切换状态 Badge 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Sidebar 中 worktree 的状态 Badge 改为可点击的手动状态切换，支持 in_progress / in_review / completed / paused 四种状态。

**Architecture:** 状态存储在 workspace 的 `.worktree-manager.json` 中（`worktree_statuses` 字段）。后端提供 `update_worktree_status` 命令读写状态，前端将 `StatusBadge` 改为 DropdownMenu。

**Tech Stack:** Rust (Tauri), TypeScript/React, Tailwind CSS, Radix UI DropdownMenu

---

## 涉及文件总览

| 文件 | 职责 |
|------|------|
| `src-tauri/src/types.rs` | Rust 类型：`WorktreeStatus` 枚举，`WorkspaceConfig` / `WorktreeListItem` 扩展 |
| `src-tauri/src/commands/worktree.rs` | `update_worktree_status` 命令 + `scan_worktrees_dir` 读取状态 |
| `src-tauri/src/lib.rs` | `generate_handler!` 注册新命令 |
| `src-tauri/src/http_server.rs` | `h_update_worktree_status` HTTP handler |
| `src-tauri/src/http_server/routing.rs` | 注册 `/api/update_worktree_status` 路由 |
| `src/types.ts` | TypeScript 类型：`WorktreeStatus` + `WorktreeListItem` 扩展 |
| `src/lib/backend.ts` | `updateWorktreeStatus()` 前端调用函数 |
| `src/hooks/useWorkspace.ts` | `updateWorktreeStatus` hook 方法 |
| `src/components/worktree-sidebar/ExpandedSidebar.tsx` | `StatusBadge` 改为可点击 DropdownMenu |
| `src/locales/zh-CN.json` | 中文翻译 |
| `src/locales/en-US.json` | 英文翻译 |
| `docs/generated/command-contracts.md` | 命令契约文档更新 |

---

### Task 1: Rust 类型定义

**Files:**
- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: 添加 `WorktreeStatus` 枚举**

  在 `WorkspaceConfig` 定义之前插入：

  ```rust
  #[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
  #[serde(rename_all = "snake_case")]
  pub enum WorktreeStatus {
      InProgress,
      InReview,
      Completed,
      Paused,
  }
  ```

- [ ] **Step 2: `WorkspaceConfig` 添加 `worktree_statuses` 字段**

  在 `archived_worktrees` 字段之后添加：

  ```rust
      #[serde(default)]
      pub worktree_statuses: HashMap<String, WorktreeStatus>, // worktree_name -> status
  ```

- [ ] **Step 3: `WorkspaceConfig` Default 实现同步**

  在 `archived_worktrees: vec![],` 之后添加：

  ```rust
            worktree_statuses: HashMap::new(),
  ```

- [ ] **Step 4: `WorktreeListItem` 添加 `status` 字段**

  在 `is_archived` 之后添加：

  ```rust
      pub status: Option<WorktreeStatus>,
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src-tauri/src/types.rs
  git commit -m "feat(types): add WorktreeStatus enum and fields"
  ```

---

### Task 2: 后端命令实现

**Files:**
- Modify: `src-tauri/src/commands/worktree.rs`

- [ ] **Step 1: `scan_worktrees_dir` 读取状态**

  找到 `scan_worktrees_dir` 函数中创建 `WorktreeListItem` 的代码块（约第 578 行）：

  ```rust
          result.push(WorktreeListItem {
              name,
              display_name,
              path: normalize_path(&path.to_string_lossy()),
              is_archived,
              status: config.worktree_statuses.get(&name).cloned(),
              projects,
          });
  ```

  在 `is_archived` 之后、`projects` 之前添加 `status` 字段。

- [ ] **Step 2: 添加 `update_worktree_status_impl` 函数**

  在 `list_worktrees_impl` 函数之后（约第 431 行之后）添加：

  ```rust
  pub fn update_worktree_status_impl(
      window_label: &str,
      worktree_name: String,
      status: WorktreeStatus,
  ) -> Result<(), String> {
      let (workspace_path, mut config) =
          get_window_workspace_config(window_label).ok_or("No workspace selected")?;

      config.worktree_statuses.insert(worktree_name, status);

      crate::commands::workspace::save_workspace_config_impl(
          window_label,
          config,
      )
  }
  ```

- [ ] **Step 3: 添加 `update_worktree_status` Tauri command**

  在 `update_worktree_status_impl` 之后添加：

  ```rust
  #[tauri::command]
  pub(crate) async fn update_worktree_status(
      window: tauri::Window,
      worktree_name: String,
      status: WorktreeStatus,
      workspace_path: Option<String>,
  ) -> Result<(), String> {
      if let Some(path) = workspace_path {
          let mut config = crate::config::load_workspace_config(&path);
          config.worktree_statuses.insert(worktree_name, status);
          crate::commands::workspace::save_workspace_config_by_path(path, config)
      } else {
          let label = window.label().to_string();
          tokio::task::spawn_blocking(move || {
              update_worktree_status_impl(&label, worktree_name, status)
          })
          .await
          .map_err(|e| format!("Task join error: {}", e))?
      }
  }
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/src/commands/worktree.rs
  git commit -m "feat(backend): add update_worktree_status command"
  ```

---

### Task 3: Tauri 命令注册

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 导入 `update_worktree_status`**

  在 `src-tauri/src/lib.rs` 中找到 `use crate::commands::worktree::` 导入块，确认 `update_worktree_status` 是否在导入列表中。如果不存在，添加它。

  查找模式：`update_worktree_status` 是否已经在 `use crate::commands::worktree::{` 中。如果没有，添加。

  在 `generate_handler!` 宏中，在 `get_main_workspace_status,` 之后添加：

  ```rust
              update_worktree_status,
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src-tauri/src/lib.rs
  git commit -m "feat(tauri): register update_worktree_status command"
  ```

---

### Task 4: HTTP 服务器支持

**Files:**
- Modify: `src-tauri/src/http_server.rs`
- Modify: `src-tauri/src/http_server/routing.rs`

- [ ] **Step 1: HTTP server 添加 handler**

  在 `src-tauri/src/http_server.rs` 中，找到 `-- Worktree operations --` 区域（约第 299 行之后），在 `h_list_worktrees` 之后添加：

  ```rust
  async fn h_update_worktree_status(headers: HeaderMap, Json(args): Json<Value>) -> Response {
      let sid = session_id(&headers);
      let worktree_name = args["worktree_name"].as_str().unwrap_or("").to_string();
      let status: crate::types::WorktreeStatus = match serde_json::from_value(args["status"].clone()) {
          Ok(s) => s,
          Err(e) => {
              return (StatusCode::BAD_REQUEST, format!("Invalid status: {}", e)).into_response()
          }
      };
      result_ok(crate::commands::worktree::update_worktree_status_impl(
          &sid, worktree_name, status,
      ))
  }
  ```

  同时确认 `http_server.rs` 顶部导入了 `update_worktree_status_impl`。在 `use crate::{` 块中添加：

  ```rust
      update_worktree_status_impl,
  ```

- [ ] **Step 2: HTTP routing 注册路由**

  在 `src-tauri/src/http_server/routing.rs` 中：

  1. 导入列表中添加 `h_update_worktree_status`
  2. `build_api_router` 函数中，在 `.route("/api/list_worktrees", post(h_list_worktrees))` 之后添加：

  ```rust
          .route("/api/update_worktree_status", post(h_update_worktree_status))
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src-tauri/src/http_server.rs src-tauri/src/http_server/routing.rs
  git commit -m "feat(http): add update_worktree_status endpoint"
  ```

---

### Task 5: 前端类型定义

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: 添加 `WorktreeStatus` 类型**

  在 `WorktreeListItem` 定义之前添加：

  ```typescript
  export type WorktreeStatus = 'in_progress' | 'in_review' | 'completed' | 'paused';
  ```

- [ ] **Step 2: `WorktreeListItem` 添加 `status` 字段**

  在 `is_archived: boolean;` 之后添加：

  ```typescript
    status?: WorktreeStatus;
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/types.ts
  git commit -m "feat(types): add WorktreeStatus frontend type"
  ```

---

### Task 6: 前端 Backend 调用

**Files:**
- Modify: `src/lib/backend.ts`

- [ ] **Step 1: 添加 `updateWorktreeStatus` 函数**

  在文件末尾（或与其他 worktree 函数一起）添加：

  ```typescript
  export async function updateWorktreeStatus(
    worktreeName: string,
    status: import('../types').WorktreeStatus,
    workspacePath?: string,
  ): Promise<void> {
    const extra = workspacePath ? { workspacePath } : {};
    return callBackend<void>('update_worktree_status', {
      worktreeName,
      status,
      ...extra,
    });
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/lib/backend.ts
  git commit -m "feat(backend): add updateWorktreeStatus frontend call"
  ```

---

### Task 7: useWorkspace Hook

**Files:**
- Modify: `src/hooks/useWorkspace.ts`

- [ ] **Step 1: 导入 `updateWorktreeStatus`**

  在 `callBackend, fetchProjectRemote, isTauri` 导入之后添加：

  ```typescript
  import { updateWorktreeStatus as updateWorktreeStatusBackend } from '../lib/backend';
  ```

  或者在已有的 `callBackend` 导入行后添加 `updateWorktreeStatus`。

- [ ] **Step 2: 在接口定义中添加方法**

  在 `UseWorkspaceReturn` 接口中，在 `getLockedWorktrees` 之后添加：

  ```typescript
    updateWorktreeStatus: (worktreeName: string, status: import('../types').WorktreeStatus) => Promise<void>;
  ```

- [ ] **Step 3: 在 hook 中实现方法**

  在 `getLockedWorktrees` 回调之后、`return` 之前添加：

  ```typescript
  const updateWorktreeStatus = useCallback(async (worktreeName: string, status: import('../types').WorktreeStatus) => {
    try {
      const extra = explicitPath ? { workspacePath: explicitPath } : {};
      await updateWorktreeStatusBackend(worktreeName, status, explicitPath);
      await loadData();
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, [explicitPath, loadData]);
  ```

  注意：如果 Step 1 选择了直接导入 `updateWorktreeStatus`，则这里需要避免命名冲突，用不同的变量名。

- [ ] **Step 4: 在返回值中添加**

  在 `getLockedWorktrees,` 之后添加：

  ```typescript
    updateWorktreeStatus,
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/hooks/useWorkspace.ts
  git commit -m "feat(hook): add updateWorktreeStatus to useWorkspace"
  ```

---

### Task 8: Sidebar UI 组件

**Files:**
- Modify: `src/components/worktree-sidebar/ExpandedSidebar.tsx`

- [ ] **Step 1: 导入 DropdownMenu 组件**

  在现有的 DropdownMenu 导入块中确认已有 `DropdownMenuItem`，如果没有则添加：

  ```typescript
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  } from '@/components/ui/dropdown-menu';
  ```

  注意：`DropdownMenuItem` 可能还不存在，需要确认并添加。

- [ ] **Step 2: 修改 `StatusBadge` 组件为可点击**

  将现有的 `StatusBadge` 组件改为接收更多属性并支持点击：

  ```typescript
  const StatusBadge: FC<{
    label: string;
    tooltip: string;
    tone: 'amber' | 'blue' | 'green' | 'gray' | 'purple';
    clickable?: boolean;
    onClick?: () => void;
  }> = ({ label, tooltip, tone, clickable, onClick }) => {
    const toneClasses: Record<string, string> = {
      blue: 'text-[var(--color-accent)]/80 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20',
      amber: 'text-[var(--color-warning)]/80 bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20',
      green: 'text-emerald-400 bg-emerald-900/30 border border-emerald-800/30',
      gray: 'text-gray-400 bg-gray-800/50 border border-gray-700/30',
      purple: 'text-purple-400 bg-purple-900/30 border border-purple-800/30',
    };

    const badge = (
      <span
        className={`text-[10px] px-1 py-0 rounded-sm shrink-0 ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-help'} ${toneClasses[tone]}`}
        onClick={onClick}
      >{label}</span>
    );

    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent side="right">{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };
  ```

- [ ] **Step 3: 添加 `WorktreeStatusBadge` 组件**

  在 `StatusBadge` 之后添加新的状态切换组件：

  ```typescript
  const STATUS_CONFIG: Record<import('../../types').WorktreeStatus, { label: string; tooltip: string; tone: string }> = {
    in_progress: { label: 'sidebar.statusInProgress', tooltip: 'sidebar.statusInProgressTooltip', tone: 'blue' },
    in_review: { label: 'sidebar.statusInReview', tooltip: 'sidebar.statusInReviewTooltip', tone: 'purple' },
    completed: { label: 'sidebar.statusCompleted', tooltip: 'sidebar.statusCompletedTooltip', tone: 'green' },
    paused: { label: 'sidebar.statusPaused', tooltip: 'sidebar.statusPausedTooltip', tone: 'gray' },
  };

  const WorktreeStatusBadge: FC<{
    status?: import('../../types').WorktreeStatus;
    onStatusChange?: (status: import('../../types').WorktreeStatus) => void;
  }> = ({ status, onStatusChange }) => {
    const { t } = useTranslation();
    const effectiveStatus = status || 'in_progress';
    const config = STATUS_CONFIG[effectiveStatus];

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <span className={`text-[10px] px-1 py-0 rounded-sm shrink-0 cursor-pointer hover:opacity-80 ${
            config.tone === 'blue' ? 'text-[var(--color-accent)]/80 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20' :
            config.tone === 'purple' ? 'text-purple-400 bg-purple-900/30 border border-purple-800/30' :
            config.tone === 'green' ? 'text-emerald-400 bg-emerald-900/30 border border-emerald-800/30' :
            'text-gray-400 bg-gray-800/50 border border-gray-700/30'
          }`}>
            {t(config.label)}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[120px]">
          {(Object.keys(STATUS_CONFIG) as import('../../types').WorktreeStatus[]).map((s) => (
            <DropdownMenuItem
              key={s}
              className={`text-xs ${s === effectiveStatus ? 'bg-[var(--color-bg-elevated)]' : ''}`}
              onClick={() => onStatusChange?.(s)}
            >
              <span className={`w-2 h-2 rounded-full mr-2 ${
                STATUS_CONFIG[s].tone === 'blue' ? 'bg-[var(--color-accent)]' :
                STATUS_CONFIG[s].tone === 'purple' ? 'bg-purple-400' :
                STATUS_CONFIG[s].tone === 'green' ? 'bg-emerald-400' :
                'bg-gray-400'
              }`} />
              {t(STATUS_CONFIG[s].label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  ```

- [ ] **Step 4: 替换原有的状态 Badge 渲染逻辑**

  找到 active worktree 列表中的这段代码（约第 823-829 行）：

  ```tsx
                      {(() => {
                        const allMerged = worktree.projects.length > 0 && worktree.projects.every(p => p.is_merged_to_base);
                        if (allMerged) {
                          return <StatusBadge label={t('sidebar.completed')} tooltip={t('sidebar.completedTooltip')} tone="green" />;
                        }
                        return <StatusBadge label={t('sidebar.inProgress')} tooltip={t('sidebar.inProgressTooltip')} tone="blue" />;
                      })()}
  ```

  替换为：

  ```tsx
                      <WorktreeStatusBadge
                        status={worktree.status}
                        onStatusChange={(status) => onUpdateWorktreeStatus?.(worktree.name, status)}
                      />
  ```

- [ ] **Step 5: 添加 `onUpdateWorktreeStatus` prop**

  1. 在 `ExpandedSidebarProps` 接口中添加：

  ```typescript
    onUpdateWorktreeStatus?: (worktreeName: string, status: import('../../types').WorktreeStatus) => void;
  ```

  2. 在 `ExpandedSidebar` 组件解构参数中添加 `onUpdateWorktreeStatus`

  3. 在 `WorktreeList` 组件的 props 和解构参数中添加 `onUpdateWorktreeStatus`

  4. 在 `WorktreeList` 的 `SortableWorktreeItem` 渲染中传递该 prop

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/worktree-sidebar/ExpandedSidebar.tsx
  git commit -m "feat(ui): make status badge clickable with dropdown"
  ```

---

### Task 9: 连接 WorktreeSidebar 到 useWorkspace

**Files:**
- Modify: `src/components/WorktreeSidebar.tsx`（或 `App.tsx` 中 WorktreeSidebar 的使用处）

- [ ] **Step 1: 从 useWorkspace 中解构 `updateWorktreeStatus`**

  找到 `WorktreeSidebar` 组件（或 App.tsx 中使用 useWorkspace 的地方），在 `getLockedWorktrees` 之后解构：

  ```typescript
    updateWorktreeStatus,
  ```

- [ ] **Step 2: 将 `updateWorktreeStatus` 传递给 `ExpandedSidebar`（或 `WorktreeSidebar`）**

  在组件 props 中传递：

  ```tsx
    onUpdateWorktreeStatus={updateWorktreeStatus}
  ```

  如果 `WorktreeSidebar` 是一个 wrapper，确保它也透传了这个 prop 到 `ExpandedSidebar`。

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/WorktreeSidebar.tsx  # 或 App.tsx
  git commit -m "feat: wire up updateWorktreeStatus to sidebar"
  ```

---

### Task 10: 国际化翻译

**Files:**
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`

- [ ] **Step 1: 中文翻译**

  在 `src/locales/zh-CN.json` 中，在 `sidebar.pausedTooltip` 之后添加：

  ```json
  "sidebar.statusInProgress": "进行中",
  "sidebar.statusInProgressTooltip": "该工作区正在进行中",
  "sidebar.statusInReview": "评审中",
  "sidebar.statusInReviewTooltip": "该工作区正在评审中",
  "sidebar.statusCompleted": "已完成",
  "sidebar.statusCompletedTooltip": "该工作区已完成",
  "sidebar.statusPaused": "暂停",
  "sidebar.statusPausedTooltip": "该工作区已暂停"
  ```

- [ ] **Step 2: 英文翻译**

  在 `src/locales/en-US.json` 中，在 `sidebar.pausedTooltip` 之后添加：

  ```json
  "sidebar.statusInProgress": "In Progress",
  "sidebar.statusInProgressTooltip": "This worktree is in progress",
  "sidebar.statusInReview": "In Review",
  "sidebar.statusInReviewTooltip": "This worktree is in review",
  "sidebar.statusCompleted": "Completed",
  "sidebar.statusCompletedTooltip": "This worktree is completed",
  "sidebar.statusPaused": "Paused",
  "sidebar.statusPausedTooltip": "This worktree is paused"
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/locales/zh-CN.json src/locales/en-US.json
  git commit -m "feat(i18n): add worktree status translations"
  ```

---

### Task 11: 更新命令契约文档

**Files:**
- Modify: `docs/generated/command-contracts.md`

- [ ] **Step 1: 添加 `update_worktree_status` 命令文档**

  在文档的 Worktree 操作区域，在 `list_worktrees` 之后添加：

  ```markdown
  ### `update_worktree_status`

  **Type:** mutation  
  **Args:**
  - `worktree_name: string` — worktree 名称
  - `status: "in_progress" | "in_review" | "completed" | "paused"` — 新状态
  - `workspace_path?: string` — 可选，指定 workspace 路径（browser 模式用）

  **Returns:** `void`

  **Description:** 更新指定 worktree 的状态标记。状态持久化到 workspace 的 `.worktree-manager.json` 中。

  **前端调用:**
  ```typescript
  updateWorktreeStatus(worktreeName, status, workspacePath?)
  ```
  ```

  注意：此文档由 `npm run contracts` 自动生成或手动维护，确认格式与其他命令一致。

- [ ] **Step 2: Commit**

  ```bash
  git add docs/generated/command-contracts.md
  git commit -m "docs: add update_worktree_status to command contracts"
  ```

---

### Task 12: 编译验证

**Files:**
- N/A

- [ ] **Step 1: Rust 编译检查**

  ```bash
  cd src-tauri && cargo check
  ```

  Expected: 0 errors, 0 warnings related to our changes

- [ ] **Step 2: TypeScript 编译检查**

  ```bash
  npx tsc --noEmit
  ```

  Expected: 0 errors

- [ ] **Step 3: Commit（如果无错误）**

  如果编译通过，无需额外 commit。如果有修复，单独 commit。

---

## Self-Review 检查清单

**Spec 覆盖检查：**
- [x] `WorktreeStatus` 枚举（4 种状态）— Task 1
- [x] `WorkspaceConfig.worktree_statuses` 存储 — Task 1
- [x] `WorktreeListItem.status` 字段 — Task 1, Task 2
- [x] `update_worktree_status` 后端命令 — Task 2
- [x] Tauri handler 注册 — Task 3
- [x] HTTP 端点 — Task 4
- [x] 前端类型 — Task 5
- [x] 前端 backend 调用 — Task 6
- [x] useWorkspace hook — Task 7
- [x] 可点击 DropdownMenu Badge — Task 8
- [x] 状态透传连接 — Task 9
- [x] i18n 翻译 — Task 10
- [x] 命令契约文档 — Task 11

**Placeholder 扫描：** 无 TBD/TODO/"implement later"

**类型一致性检查：**
- Rust `WorktreeStatus` 序列化为 snake_case（`in_progress` 等）
- TypeScript `WorktreeStatus` 使用相同的字符串值
- HTTP handler 使用 `serde_json::from_value` 反序列化
- 所有地方的 `tone` 值为 `'amber' | 'blue' | 'green' | 'gray' | 'purple'`，与 CSS class 映射一致
