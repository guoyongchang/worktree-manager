# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现四项 UX 改进：IDE 图标右键选择器、主工作区补全 IDE 图标、Worktree 搜索高亮+拼音、操作日志面板（Monaco 查看器）。

**Architecture:** 
- 日志使用模块级单例 `operationLog.ts`，以 `projectPath` 为 key，在 `GitOperations.tsx` / `CreatePRModal.tsx` / `useWorkspaceActions.ts` 插桩
- IDE 右键选择器提取为 `IdeIconButton` + `IdePickerContextMenu` 组件，仅 Tauri 模式显示
- 搜索逻辑提取为纯函数 `matchWorktree()`，支持英文子串/全拼/声母三种匹配，结果高亮渲染

**Tech Stack:** React 19 + TypeScript + Vitest + @testing-library/react + pinyin-pro + @monaco-editor/react

---

## File Map

| 操作 | 文件 |
|------|------|
| 新建 | `src/lib/operationLog.ts` |
| 新建 | `src/lib/operationLog.test.ts` |
| 修改 | `src/components/ContextMenus.tsx` |
| 修改 | `src/components/WorktreeDetail.tsx` |
| 修改 | `src/components/worktree-sidebar/ExpandedSidebar.tsx` |
| 修改 | `src/components/GitOperations.tsx` |
| 修改 | `src/components/CreatePRModal.tsx` |
| 修改 | `src/hooks/useWorkspaceActions.ts` |
| 修改 | `src/locales/en-US.json` |
| 修改 | `src/locales/zh-CN.json` |
| 修改 | `package.json` |

---

## Task 1: 安装依赖 + 补充 i18n key

**Files:**
- Modify: `package.json`
- Modify: `src/locales/en-US.json`
- Modify: `src/locales/zh-CN.json`

- [ ] **Step 1: 安装依赖**

```bash
cd /path/to/worktree-manager
npm install pinyin-pro @monaco-editor/react
```

预期输出：`added N packages`（无报错）

- [ ] **Step 2: 在 `src/locales/en-US.json` 追加 key**

在文件末尾 `}` 前添加（找到末尾最后一个属性后追加）：

```json
"logs": {
  "button": "Logs",
  "title": "Logs — {{name}}",
  "clear": "Clear",
  "empty": "No logs yet."
},
"contextMenu": {
  "openInEditorPicker": "Choose IDE"
}
```

> 注意：如果 `contextMenu` key 已存在，只在其内部追加 `openInEditorPicker`。

- [ ] **Step 3: 在 `src/locales/zh-CN.json` 追加对应 key**

```json
"logs": {
  "button": "日志",
  "title": "日志 — {{name}}",
  "clear": "清空",
  "empty": "暂无日志"
},
"contextMenu": {
  "openInEditorPicker": "选择 IDE"
}
```

- [ ] **Step 4: 验证 i18n 同步**

```bash
node scripts/check-i18n.mjs
```

预期输出：无报错。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/locales/en-US.json src/locales/zh-CN.json
git commit -m "feat: install pinyin-pro and monaco-editor, add i18n keys for logs and IDE picker"
```

---

## Task 2: 创建操作日志单例 `operationLog.ts`（TDD）

**Files:**
- Create: `src/lib/operationLog.test.ts`
- Create: `src/lib/operationLog.ts`

- [ ] **Step 1: 先写测试**

新建 `src/lib/operationLog.test.ts`：

```typescript
import { beforeEach, describe, expect, it } from 'vitest';

// 每次 import 都是同一单例，用 clearLogs 重置
import {
  addLog,
  clearLogs,
  getLogs,
  getUnreadErrorCount,
  markAsRead,
} from './operationLog';

const PATH = '/test/project';

beforeEach(() => {
  clearLogs(PATH);
});

describe('addLog / getLogs', () => {
  it('stores entry with auto id and timestamp', () => {
    addLog(PATH, { level: 'info', operation: 'refresh', message: 'ok' });
    const logs = getLogs(PATH);
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBeTruthy();
    expect(logs[0].timestamp).toBeInstanceOf(Date);
    expect(logs[0].level).toBe('info');
    expect(logs[0].operation).toBe('refresh');
  });

  it('returns empty array for unknown path', () => {
    expect(getLogs('/unknown')).toEqual([]);
  });

  it('preserves order of insertion', () => {
    addLog(PATH, { level: 'info', operation: 'a', message: '1' });
    addLog(PATH, { level: 'error', operation: 'b', message: '2' });
    const logs = getLogs(PATH);
    expect(logs[0].operation).toBe('a');
    expect(logs[1].operation).toBe('b');
  });
});

describe('getUnreadErrorCount / markAsRead', () => {
  it('errors before any markAsRead are all unread', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail' });
    addLog(PATH, { level: 'error', operation: 'sync', message: 'fail2' });
    expect(getUnreadErrorCount(PATH)).toBe(2);
  });

  it('info/success/warn do not count as unread errors', () => {
    addLog(PATH, { level: 'info', operation: 'refresh', message: 'ok' });
    addLog(PATH, { level: 'success', operation: 'push', message: 'done' });
    expect(getUnreadErrorCount(PATH)).toBe(0);
  });

  it('markAsRead clears unread count', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail' });
    markAsRead(PATH);
    expect(getUnreadErrorCount(PATH)).toBe(0);
  });

  it('errors added after markAsRead count as new unread', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail 1' });
    markAsRead(PATH);
    addLog(PATH, { level: 'error', operation: 'sync', message: 'fail 2' });
    expect(getUnreadErrorCount(PATH)).toBe(1);
  });
});

describe('clearLogs', () => {
  it('removes all entries', () => {
    addLog(PATH, { level: 'info', operation: 'refresh', message: 'x' });
    clearLogs(PATH);
    expect(getLogs(PATH)).toHaveLength(0);
  });

  it('resets unread error count', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail' });
    clearLogs(PATH);
    expect(getUnreadErrorCount(PATH)).toBe(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- --run operationLog
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/lib/operationLog.ts`**

```typescript
export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  operation: string;
  message: string;
  detail?: string;
}

let counter = 0;
const store = new Map<string, LogEntry[]>();
const lastReadIndex = new Map<string, number>();
const MAX_ENTRIES = 500;

export function addLog(
  projectPath: string,
  entry: Omit<LogEntry, 'id' | 'timestamp'>,
): void {
  const entries = store.get(projectPath) ?? [];
  entries.push({
    ...entry,
    id: `${Date.now()}-${counter++}`,
    timestamp: new Date(),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  store.set(projectPath, entries);
}

export function getLogs(projectPath: string): LogEntry[] {
  return store.get(projectPath) ?? [];
}

export function clearLogs(projectPath: string): void {
  store.delete(projectPath);
  lastReadIndex.delete(projectPath);
}

export function markAsRead(projectPath: string): void {
  const entries = store.get(projectPath) ?? [];
  lastReadIndex.set(projectPath, entries.length);
}

export function getUnreadErrorCount(projectPath: string): number {
  const entries = store.get(projectPath) ?? [];
  const readIdx = lastReadIndex.get(projectPath) ?? 0;
  return entries.slice(readIdx).filter((e) => e.level === 'error').length;
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test -- --run operationLog
```

预期：全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/operationLog.ts src/lib/operationLog.test.ts
git commit -m "feat: add operationLog singleton with unread error tracking"
```

---

## Task 3: 添加 `IdePickerContextMenu` 组件

**Files:**
- Modify: `src/components/ContextMenus.tsx`

- [ ] **Step 1: 在 `ContextMenus.tsx` 末尾追加 `IdePickerContextMenu`**

在文件最后一行之后添加：

```tsx
interface IdePickerContextMenuProps {
  x: number;
  y: number;
  editors: Array<{ id: string; name: string }>;
  onSelect: (editorId: string) => void;
  onClose: () => void;
}

export const IdePickerContextMenu: FC<IdePickerContextMenuProps> = ({
  x,
  y,
  editors,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation();
  const menuHeight = editors.length * 36 + 40;
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px]"
        style={{
          left: Math.min(x, window.innerWidth - 180),
          top: Math.min(y, window.innerHeight - menuHeight),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-1 text-xs text-slate-500 font-medium uppercase tracking-wider">
          {t('contextMenu.openInEditorPicker')}
        </div>
        {editors.map((editor) => (
          <button
            key={editor.id}
            onClick={() => {
              onSelect(editor.id);
              onClose();
            }}
            className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
          >
            {editor.name}
          </button>
        ))}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: 确认编译无报错**

```bash
npx tsc --noEmit
```

预期：无报错输出

- [ ] **Step 3: Commit**

```bash
git add src/components/ContextMenus.tsx
git commit -m "feat: add IdePickerContextMenu component"
```

---

## Task 4: 提取 `IdeIconButton` 并应用到 Worktree 项目列表 + 主工作区项目列表

**Files:**
- Modify: `src/components/WorktreeDetail.tsx`

### 4a: 在文件内定义 `IdeIconButton` 组件

- [ ] **Step 1: 在 `WorktreeDetail.tsx` 中找到 `getProjectStatus` 函数之前（约第 100 行），插入 `IdeIconButton` 组件**

在 `function getProjectStatus(...)` 定义之前插入：

```tsx
// --- IdeIconButton ---

interface IdeIconButtonProps {
  projectPath: string;
  projectName: string;
  editors: Array<{ id: string; name: string }>;
  defaultEditorId: string;
  onOpen: (path: string, editorId: string) => void;
}

const IdeIconButton: FC<IdeIconButtonProps> = ({
  projectPath,
  projectName,
  editors,
  defaultEditorId,
  onOpen,
}) => {
  const { t } = useTranslation();
  const [ideMenu, setIdeMenu] = useState<{ x: number; y: number } | null>(null);
  const currentEditor = editors.find((e) => e.id === defaultEditorId);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onOpen(projectPath, defaultEditorId)}
        onContextMenu={(e) => {
          e.preventDefault();
          setIdeMenu({ x: e.clientX, y: e.clientY });
        }}
        title={t('detail.openInEditorLabel', { editor: currentEditor?.name ?? defaultEditorId })}
        aria-label={t('detail.openInEditorProject', {
          editor: currentEditor?.name ?? defaultEditorId,
          name: projectName,
        })}
        className="h-7 w-7"
      >
        <EditorIcon editorId={defaultEditorId} className="w-4.5 h-4.5" />
      </Button>
      {ideMenu && (
        <IdePickerContextMenu
          x={ideMenu.x}
          y={ideMenu.y}
          editors={editors}
          onSelect={(editorId) => onOpen(projectPath, editorId)}
          onClose={() => setIdeMenu(null)}
        />
      )}
    </>
  );
};
```

- [ ] **Step 2: 在文件顶部的 import 中，从 `ContextMenus.tsx` 引入 `IdePickerContextMenu`**

找到已有的 `import` 行（例如 `import { WorktreeContextMenu }` 或类似），添加：

```tsx
import { IdePickerContextMenu } from './ContextMenus';
```

### 4b: 替换 Worktree 项目列表中的 IDE 按钮

- [ ] **Step 3: 替换约第 484-494 行的 IDE Button**

找到以下代码块（在 `isTauri() &&` 内的第一个 Button，用于打开编辑器）：

```tsx
<Button
  variant="ghost"
  size="icon"
  onClick={() => onOpenInEditor(projectPath, getProjectEditor(proj.name) as any)}
  title={t('detail.openInEditorLabel', { editor: detectedEditors.find(e => e.id === getProjectEditor(proj.name))?.name || selectedEditorName })}
  aria-label={t('detail.openInEditorProject', { editor: selectedEditorName, name: proj.name })}
  className="h-7 w-7"
>
  <EditorIcon editorId={getProjectEditor(proj.name)} className="w-4.5 h-4.5" />
</Button>
```

替换为：

```tsx
<IdeIconButton
  projectPath={projectPath}
  projectName={proj.name}
  editors={detectedEditors}
  defaultEditorId={getProjectEditor(proj.name)}
  onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
/>
```

### 4c: 在主工作区项目列表中添加 IDE 图标

- [ ] **Step 4: 在主工作区项目列表（约第 540 行的 `mainWorkspace.projects.map`）的按钮组中，在 Finder 按钮后添加 `IdeIconButton`**

找到：
```tsx
{isTauri() && (
  <button
    onClick={() => onRevealInFinder(projectPath)}
    ...
  >
    <FolderIcon className="w-3.5 h-3.5" />
  </button>
)}
```

在该 `{isTauri() && ...}` 块之后，`{onRemoveProject && ...}` 块之前，插入：

```tsx
{isTauri() && (
  <IdeIconButton
    projectPath={projectPath}
    projectName={proj.name}
    editors={detectedEditors}
    defaultEditorId={selectedEditor}
    onOpen={(path, editorId) => onOpenInEditor(path, editorId as any)}
  />
)}
```

- [ ] **Step 5: 确认编译无报错**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/WorktreeDetail.tsx src/components/ContextMenus.tsx
git commit -m "feat: add IdeIconButton with right-click IDE picker to worktree and main workspace project lists"
```

---

## Task 5: 搜索优化（布局 + 高亮 + 拼音）

**Files:**
- Modify: `src/components/worktree-sidebar/ExpandedSidebar.tsx`

### 5a: 提取并测试匹配逻辑

- [ ] **Step 1: 在 `ExpandedSidebar.tsx` 文件顶部（import 之后）添加 pinyin import 和匹配函数**

在 `import` 区块末尾后添加：

```tsx
import { pinyin } from 'pinyin-pro';
import type { ReactNode } from 'react';

// --- Search utilities ---

type MatchResult =
  | { matched: false }
  | { matched: true; type: 'substring'; index: number; length: number }
  | { matched: true; type: 'pinyin' };

export function matchWorktreeName(name: string, query: string): MatchResult {
  if (!query) return { matched: false };
  const lowerName = name.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // 1. English substring
  const idx = lowerName.indexOf(lowerQuery);
  if (idx !== -1) {
    return { matched: true, type: 'substring', index: idx, length: lowerQuery.length };
  }

  // 2. Full pinyin
  try {
    const fullPy = pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase();
    if (fullPy.includes(lowerQuery)) {
      return { matched: true, type: 'pinyin' };
    }
    // 3. Initials
    const initials = pinyin(name, { pattern: 'initial', type: 'array' }).join('').toLowerCase();
    if (initials.includes(lowerQuery)) {
      return { matched: true, type: 'pinyin' };
    }
  } catch {
    // pinyin conversion failed for non-Chinese text, skip
  }

  return { matched: false };
}

export function highlightWorktreeName(name: string, result: MatchResult): ReactNode {
  if (!result.matched) return name;
  if (result.type === 'pinyin') {
    return (
      <span className="text-blue-300 bg-blue-900/40 rounded-sm px-px">{name}</span>
    );
  }
  // substring
  const { index, length } = result;
  return (
    <>
      {name.slice(0, index)}
      <span className="text-blue-300 bg-blue-900/40 rounded-sm px-px">
        {name.slice(index, index + length)}
      </span>
      {name.slice(index + length)}
    </>
  );
}
```

- [ ] **Step 2: 新建测试文件 `src/components/worktree-sidebar/ExpandedSidebar.test.tsx` 中追加匹配函数测试**

在已有测试文件末尾（或在最后一个 `describe` block 之后）追加：

```tsx
import { highlightWorktreeName, matchWorktreeName } from './ExpandedSidebar';

describe('matchWorktreeName', () => {
  it('returns matched=false for empty query', () => {
    expect(matchWorktreeName('feature-foo', '')).toEqual({ matched: false });
  });

  it('matches English substring', () => {
    const result = matchWorktreeName('feature-foo', 'foo');
    expect(result).toMatchObject({ matched: true, type: 'substring', index: 8, length: 3 });
  });

  it('matches case-insensitively', () => {
    const result = matchWorktreeName('FeatureFoo', 'feature');
    expect(result).toMatchObject({ matched: true, type: 'substring' });
  });

  it('returns matched=false when no match', () => {
    expect(matchWorktreeName('feature-foo', 'xyz')).toEqual({ matched: false });
  });
});

describe('highlightWorktreeName', () => {
  it('returns plain string when not matched', () => {
    const node = highlightWorktreeName('feature-foo', { matched: false });
    expect(node).toBe('feature-foo');
  });
});
```

- [ ] **Step 3: 运行测试，确认通过**

```bash
npm test -- --run ExpandedSidebar
```

预期：全部 PASS

### 5b: 修改 `WorktreeList` 组件

- [ ] **Step 4: 在 `WorktreeList` 组件内，替换搜索 state 和 useMemo 逻辑**

找到组件内的：
```tsx
const [activeSearchQuery, setActiveSearchQuery] = useState('');

const filteredActiveWorktrees = useMemo(() => {
  const query = activeSearchQuery.trim().toLocaleLowerCase();
  if (!query) return sortedActiveWorktrees;
  return sortedActiveWorktrees.filter((worktree) => {
    ...
  });
}, [activeSearchQuery, sortedActiveWorktrees]);
```

替换为：

```tsx
const [activeSearchQuery, setActiveSearchQuery] = useState('');
const [debouncedQuery, setDebouncedQuery] = useState('');

useEffect(() => {
  const timer = setTimeout(() => setDebouncedQuery(activeSearchQuery.trim()), 100);
  return () => clearTimeout(timer);
}, [activeSearchQuery]);

const worktreesWithMatch = useMemo(() => {
  return sortedActiveWorktrees.map((wt) => {
    const displayName = wt.display_name || wt.name;
    const result = matchWorktreeName(displayName, debouncedQuery);
    return { wt, matchResult: result };
  });
}, [debouncedQuery, sortedActiveWorktrees]);
```

- [ ] **Step 5: 修改布局区：搜索框居右**

找到：
```tsx
<div className="flex items-center gap-2">
  <span className="shrink-0 text-[11px] font-medium text-slate-500 uppercase tracking-wider">
    {t('sidebar.active')} ({activeWorktrees.length})
  </span>
  <Input
    value={activeSearchQuery}
    onChange={(event) => setActiveSearchQuery(event.target.value)}
    placeholder={t('sidebar.searchWorktrees')}
    aria-label={t('sidebar.searchWorktrees')}
    className="h-7 min-w-0 max-w-[180px] text-xs"
  />
</div>
```

替换为：

```tsx
<div className="flex items-center justify-between">
  <span className="shrink-0 text-[11px] font-medium text-slate-500 uppercase tracking-wider">
    {t('sidebar.active')} ({activeWorktrees.length})
  </span>
  <Input
    value={activeSearchQuery}
    onChange={(event) => setActiveSearchQuery(event.target.value)}
    placeholder={t('sidebar.searchWorktrees')}
    aria-label={t('sidebar.searchWorktrees')}
    className="h-7 w-[160px] text-xs"
  />
</div>
```

- [ ] **Step 6: 修改列表渲染：移除过滤逻辑，改为高亮渲染**

找到渲染逻辑中 `filteredActiveWorktrees.length === 0` 的分支（"无搜索结果"空状态），将整个条件块：

```tsx
) : filteredActiveWorktrees.length === 0 ? (
  <div className="px-4 py-8 text-center">
    ...noSearchResults...
  </div>
) : (
  filteredActiveWorktrees.map((worktree) => {
```

改为只保留 `worktreesWithMatch.map`（移除"无搜索结果"分支），同时将 Worktree 名称文本替换为高亮渲染：

```tsx
) : (
  worktreesWithMatch.map(({ wt: worktree, matchResult }) => {
```

在 Worktree 名称渲染处（`{worktree.display_name || worktree.name}`），改为：

```tsx
{highlightWorktreeName(worktree.display_name || worktree.name, matchResult)}
```

（共两处：TooltipTrigger 内的 `span` 文本）

- [ ] **Step 7: 确认编译无报错**

```bash
npx tsc --noEmit
```

- [ ] **Step 8: 运行测试**

```bash
npm test -- --run ExpandedSidebar
```

预期：全部 PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/worktree-sidebar/ExpandedSidebar.tsx src/components/worktree-sidebar/ExpandedSidebar.test.tsx
git commit -m "feat: worktree search layout fix, highlight-instead-of-filter, pinyin support"
```

---

## Task 6: 添加 `LogsDialog` + Logs 按钮

**Files:**
- Modify: `src/components/WorktreeDetail.tsx`

- [ ] **Step 1: 在 WorktreeDetail.tsx 顶部 import 区块添加 Monaco 和 operationLog imports**

```tsx
import Editor from '@monaco-editor/react';
import {
  addLog,
  clearLogs,
  getLogs,
  getUnreadErrorCount,
  markAsRead,
} from '@/lib/operationLog';
import type { LogEntry } from '@/lib/operationLog';
```

- [ ] **Step 2: 在文件内（`IdeIconButton` 定义之后）添加 `LogsDialog` 组件**

```tsx
// --- LogsDialog ---

const LogsDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  projectName: string;
}> = ({ open, onOpenChange, projectPath, projectName }) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    if (open) {
      setLogs(getLogs(projectPath));
      markAsRead(projectPath);
    }
  }, [open, projectPath]);

  const content =
    logs.length === 0
      ? t('logs.empty')
      : logs
          .map((entry) => {
            const time = entry.timestamp.toLocaleTimeString('en-US', { hour12: false });
            const level = `[${entry.level.toUpperCase()}]`.padEnd(9);
            const op = entry.operation.padEnd(12);
            const line = `[${time}] ${level} ${op} ${entry.message}`;
            return entry.detail
              ? `${line}\n${' '.repeat(32)}${entry.detail.replace(/\n/g, `\n${' '.repeat(32)}`)}`
              : line;
          })
          .join('\n');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-slate-700/50">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium">
              {t('logs.title', { name: projectName })}
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-slate-400 hover:text-red-400"
              onClick={() => {
                clearLogs(projectPath);
                setLogs([]);
                onOpenChange(false);
              }}
            >
              {t('logs.clear')}
            </Button>
          </div>
        </DialogHeader>
        <div style={{ height: '60vh' }}>
          <Editor
            value={content}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              wordWrap: 'on',
              fontSize: 12,
              scrollBeyondLastLine: false,
              lineNumbers: 'off',
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

- [ ] **Step 3: 在 Worktree 详情页 Header 的按钮组中添加 Logs 按钮**

在 Worktree View 的 header 区（约第 710 行，`<div className="flex gap-2 items-center shrink-0 ml-3">`）内，找到 Archive/Restore 按钮逻辑之前，在整个 `<div className="flex gap-2...">` 内的第一个位置插入：

```tsx
{isTauri() && (() => {
  const [showLogs, setShowLogs] = useState(false);
  const unread = getUnreadErrorCount(/* projectPath 见下方说明 */);
  // ...
})()}
```

**注意**：直接在 JSX 中调用 hook 是不合法的，需要提取子组件。在 `WorktreeDetail` 组件函数内（而不是 JSX 里）添加 state：

在 `WorktreeDetail` 函数体顶部（现有 useState 附近）添加：

```tsx
const [showWorktreeLogs, setShowWorktreeLogs] = useState(false);
const [showMainLogs, setShowMainLogs] = useState(false);
```

然后在 Worktree View 的 header 按钮组（`<div className="flex gap-2 items-center shrink-0 ml-3">`）里，**在第一个子元素之前**插入：

```tsx
{isTauri() && (
  <>
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-xs"
        onClick={() => setShowWorktreeLogs(true)}
      >
        {t('logs.button')}
      </Button>
      {(() => {
        const count = getUnreadErrorCount(selectedWorktree.path);
        return count > 0 ? (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {count > 9 ? '9+' : count}
          </span>
        ) : null;
      })()}
    </div>
    <LogsDialog
      open={showWorktreeLogs}
      onOpenChange={setShowWorktreeLogs}
      projectPath={selectedWorktree.path}
      projectName={selectedWorktree.display_name || selectedWorktree.name}
    />
  </>
)}
```

> `selectedWorktree.path` 是 Worktree 路径，作为日志 key（与 GitOperations 收到的 projectPath 需对应，见 Task 7）。

- [ ] **Step 4: 在主工作区 View 的 header 按钮组中同样添加 Logs 按钮**

在主工作区 header（约第 372-440 行）的按钮区，在 `<Button variant="secondary" onClick={() => onOpenInTerminal(...)}>` 之前插入：

```tsx
{isTauri() && (
  <>
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-xs"
        onClick={() => setShowMainLogs(true)}
      >
        {t('logs.button')}
      </Button>
      {(() => {
        const count = mainWorkspace.projects.reduce(
          (acc, p) => acc + getUnreadErrorCount(p.path),
          0,
        );
        return count > 0 ? (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {count > 9 ? '9+' : count}
          </span>
        ) : null;
      })()}
    </div>
    <LogsDialog
      open={showMainLogs}
      onOpenChange={setShowMainLogs}
      projectPath={mainWorkspace.path}
      projectName={mainWorkspace.name}
    />
  </>
)}
```

- [ ] **Step 5: 确认编译无报错**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/WorktreeDetail.tsx
git commit -m "feat: add LogsDialog with Monaco viewer and Logs button with unread error badge"
```

---

## Task 7: 在 GitOperations + CreatePRModal + useWorkspaceActions 插桩日志

**Files:**
- Modify: `src/components/GitOperations.tsx`
- Modify: `src/components/CreatePRModal.tsx`
- Modify: `src/hooks/useWorkspaceActions.ts`

### 7a: GitOperations.tsx

- [ ] **Step 1: 在 `GitOperations.tsx` 顶部添加 import**

```tsx
import { addLog } from '@/lib/operationLog';
```

- [ ] **Step 2: 在 `runGitAction` 中添加日志（约第 214 行）**

找到：
```tsx
const runGitAction = async (
  action: typeof activeAction,
  operation: () => Promise<string>,
) => {
  setActiveAction(action);
  setErrorMsg(null);
  setSuccessWithAutoDismiss(null);
  try {
    setSuccessWithAutoDismiss(await operation());
    await loadStats();
    onRefresh?.();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setErrorMsg(msg, isConflictError(msg));
  } finally {
    setActiveAction(null);
  }
};
```

替换为：

```tsx
const runGitAction = async (
  action: typeof activeAction,
  operation: () => Promise<string>,
) => {
  setActiveAction(action);
  setErrorMsg(null);
  setSuccessWithAutoDismiss(null);
  addLog(projectPath, { level: 'info', operation: action, message: `Starting ${action}...` });
  try {
    const result = await operation();
    setSuccessWithAutoDismiss(result);
    addLog(projectPath, { level: 'success', operation: action, message: result || `${action} completed` });
    await loadStats();
    onRefresh?.();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(projectPath, { level: 'error', operation: action, message: msg, detail: msg });
    setErrorMsg(msg, isConflictError(msg));
  } finally {
    setActiveAction(null);
  }
};
```

- [ ] **Step 3: 在 `handleRefresh`（约第 234 行）中添加日志**

找到：
```tsx
const handleRefresh = async () => {
  await syncRemoteState();
  onRefresh?.();
};
```

替换为：

```tsx
const handleRefresh = async () => {
  try {
    await syncRemoteState();
    addLog(projectPath, { level: 'success', operation: 'refresh', message: 'Remote state synced' });
    onRefresh?.();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(projectPath, { level: 'error', operation: 'refresh', message: msg, detail: msg });
    throw err;
  }
};
```

### 7b: CreatePRModal.tsx

- [ ] **Step 4: 在 `CreatePRModal.tsx` 顶部添加 import**

```tsx
import { addLog } from '@/lib/operationLog';
```

- [ ] **Step 5: 在 `handleSubmit` 中添加日志**

找到：
```tsx
const handleSubmit = async () => {
  if (!title.trim()) return;
  setSubmitting(true);
  try {
    const prUrl = await createPullRequest(projectPath, baseBranch, title.trim(), body.trim());
    toast('success', t('createPR.success', { url: prUrl }));
    onOpenChange(false);
    setTitle('');
    setBody('');
    onSuccess?.();
  } catch (err) {
    toast('error', err instanceof Error ? err.message : String(err));
  } finally {
    setSubmitting(false);
  }
};
```

替换为：

```tsx
const handleSubmit = async () => {
  if (!title.trim()) return;
  setSubmitting(true);
  addLog(projectPath, { level: 'info', operation: 'pr', message: `Creating PR: ${title.trim()} → ${baseBranch}` });
  try {
    const prUrl = await createPullRequest(projectPath, baseBranch, title.trim(), body.trim());
    addLog(projectPath, { level: 'success', operation: 'pr', message: `PR created: ${prUrl}`, detail: prUrl });
    toast('success', t('createPR.success', { url: prUrl }));
    onOpenChange(false);
    setTitle('');
    setBody('');
    onSuccess?.();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(projectPath, { level: 'error', operation: 'pr', message: 'PR creation failed', detail: msg });
    toast('error', msg);
  } finally {
    setSubmitting(false);
  }
};
```

### 7c: useWorkspaceActions.ts — Open in IDE 日志

- [ ] **Step 6: 在 `useWorkspaceActions.ts` 顶部添加 import**

```tsx
import { addLog } from '@/lib/operationLog';
```

- [ ] **Step 7: 在 `handleOpenInEditor`（约第 476 行）中添加日志**

找到：
```tsx
const handleOpenInEditor = useCallback((path: string, editor?: EditorType) => {
  workspace.openInEditor(path, editor || selectedEditor);
}, [workspace, selectedEditor]);
```

替换为：

```tsx
const handleOpenInEditor = useCallback((path: string, editor?: EditorType) => {
  const editorId = editor || selectedEditor;
  addLog(path, { level: 'info', operation: 'open_ide', message: `Opened in ${editorId}` });
  workspace.openInEditor(path, editorId);
}, [workspace, selectedEditor]);
```

- [ ] **Step 8: 确认编译无报错**

```bash
npx tsc --noEmit
```

- [ ] **Step 9: 运行所有测试**

```bash
npm test -- --run
```

预期：全部 PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/GitOperations.tsx src/components/CreatePRModal.tsx src/hooks/useWorkspaceActions.ts
git commit -m "feat: instrument git operations, PR creation, and IDE open with operation logs"
```

---

## 最终验收

- [ ] **完整构建**

```bash
npm run build
```

预期：无报错，`dist/` 生成正常

- [ ] **Rust 检查**

```bash
cd src-tauri && cargo check && cargo clippy -- -D warnings
```

- [ ] **全量测试**

```bash
npm test -- --run
```

预期：全部 PASS

- [ ] **最终 Commit**

```bash
git add -A
git commit -m "feat: complete UX improvements - IDE picker, search highlight/pinyin, operation logs"
```
