# API 文档

## Tauri 命令列表

Tauri 命令是前端调用后端的主要方式（桌面模式）。

### 工作区管理

#### `get_current_workspace`
获取当前工作区路径。

**参数**: 无

**返回**: `Result<Option<String>, String>`

**示例**:
```typescript
const workspace = await invoke<string | null>('get_current_workspace');
```

---

#### `switch_workspace`
切换到指定工作区。

**参数**:
- `path: String` - 工作区路径

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('switch_workspace', { path: '/path/to/workspace' });
```

---

#### `add_workspace`
添加新工作区。

**参数**:
- `name: String` - 工作区名称
- `path: String` - 工作区路径

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('add_workspace', {
  name: 'My Project',
  path: '/path/to/workspace'
});
```

---

#### `create_workspace`
创建新工作区。

**参数**:
- `name: String` - 工作区名称
- `path: String` - 工作区路径

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('create_workspace', {
  name: 'New Project',
  path: '/path/to/new/workspace'
});
```

---

#### `get_workspace_config`
获取工作区配置。

**参数**: 无

**返回**: `Result<WorkspaceConfig, String>`

**示例**:
```typescript
const config = await invoke<WorkspaceConfig>('get_workspace_config');
```

---

#### `save_workspace_config`
保存工作区配置。

**参数**:
- `config: WorkspaceConfig` - 工作区配置

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('save_workspace_config', { config });
```

---

### Worktree 管理

#### `list_worktrees`
列出所有 worktree。

**参数**: 无

**返回**: `Result<Vec<WorktreeListItem>, String>`

**示例**:
```typescript
const worktrees = await invoke<WorktreeListItem[]>('list_worktrees');
```

---

#### `create_worktree`
创建新 worktree。

**参数**:
- `name: String` - worktree 名称
- `projects: Vec<CreateProjectRequest>` - 项目列表

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('create_worktree', {
  name: 'feature-login',
  projects: [
    { name: 'frontend', baseBranch: 'main' },
    { name: 'backend', baseBranch: 'main' }
  ]
});
```

---

#### `archive_worktree`
归档 worktree。

**参数**:
- `name: String` - worktree 名称

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('archive_worktree', { name: 'feature-login' });
```

---

#### `restore_worktree`
恢复已归档的 worktree。

**参数**:
- `name: String` - worktree 名称

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('restore_worktree', { name: 'feature-login' });
```

---

#### `delete_archived_worktree`
删除已归档的 worktree。

**参数**:
- `name: String` - worktree 名称

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('delete_archived_worktree', { name: 'feature-login' });
```

---

#### `check_worktree_status`
检查 worktree 状态（用于归档前检查）。

**参数**:
- `name: String` - worktree 名称

**返回**: `Result<WorktreeArchiveStatus, String>`

**示例**:
```typescript
const status = await invoke<WorktreeArchiveStatus>('check_worktree_status', {
  name: 'feature-login'
});
```

---

### 项目管理

#### `clone_project`
克隆项目到工作区。

**参数**:
- `name: String` - 项目名称
- `repo_url: String` - 仓库 URL
- `base_branch: String` - 基础分支
- `test_branch: String` - 测试分支
- `merge_strategy: String` - 合并策略
- `linked_folders: Vec<String>` - 链接文件夹列表

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('clone_project', {
  name: 'frontend',
  repoUrl: 'https://github.com/user/repo.git',
  baseBranch: 'main',
  testBranch: 'test',
  mergeStrategy: 'merge',
  linkedFolders: ['node_modules', '.next']
});
```

---

#### `add_project_to_worktree`
添加项目到现有 worktree。

**参数**:
- `worktree_name: String` - worktree 名称
- `project_name: String` - 项目名称
- `base_branch: String` - 基础分支

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('add_project_to_worktree', {
  worktreeName: 'feature-login',
  projectName: 'backend',
  baseBranch: 'main'
});
```

---

#### `smart_scan_folders`
智能扫描项目目录，识别可链接的文件夹。

**参数**:
- `project_path: String` - 项目路径

**返回**: `Result<Vec<ScannedFolder>, String>`

**示例**:
```typescript
const folders = await invoke<ScannedFolder[]>('smart_scan_folders', {
  projectPath: '/path/to/project'
});
```

---

### Git 操作

#### `sync_with_base_branch`
同步基础分支。

**参数**:
- `project_path: String` - 项目路径
- `base_branch: String` - 基础分支

**返回**: `Result<String, String>`

**示例**:
```typescript
const result = await invoke<string>('sync_with_base_branch', {
  projectPath: '/path/to/project',
  baseBranch: 'main'
});
```

---

#### `merge_to_test_branch`
合并到测试分支。

**参数**:
- `project_path: String` - 项目路径
- `test_branch: String` - 测试分支

**返回**: `Result<String, String>`

**示例**:
```typescript
const result = await invoke<string>('merge_to_test_branch', {
  projectPath: '/path/to/project',
  testBranch: 'test'
});
```

---

#### `create_pull_request`
创建 Pull Request。

**参数**:
- `project_path: String` - 项目路径
- `base_branch: String` - 目标分支
- `title: String` - PR 标题
- `body: String` - PR 描述

**返回**: `Result<String, String>` - PR URL

**示例**:
```typescript
const prUrl = await invoke<string>('create_pull_request', {
  projectPath: '/path/to/project',
  baseBranch: 'main',
  title: 'Add new feature',
  body: 'This PR adds...'
});
```

---

#### `get_branch_diff_stats`
获取分支差异统计。

**参数**:
- `project_path: String` - 项目路径
- `base_branch: String` - 基础分支

**返回**: `Result<BranchDiffStats, String>`

**示例**:
```typescript
const stats = await invoke<BranchDiffStats>('get_branch_diff_stats', {
  projectPath: '/path/to/project',
  baseBranch: 'main'
});
```

---

### 终端管理

#### `create_terminal`
创建新终端。

**参数**:
- `path: String` - 工作目录路径

**返回**: `Result<String, String>` - 终端 ID

**示例**:
```typescript
const terminalId = await invoke<string>('create_terminal', {
  path: '/path/to/directory'
});
```

---

#### `write_to_terminal`
写入数据到终端。

**参数**:
- `terminal_id: String` - 终端 ID
- `data: String` - 要写入的数据

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('write_to_terminal', {
  terminalId: 'term-123',
  data: 'ls\n'
});
```

---

#### `resize_terminal`
调整终端大小。

**参数**:
- `terminal_id: String` - 终端 ID
- `cols: u16` - 列数
- `rows: u16` - 行数

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('resize_terminal', {
  terminalId: 'term-123',
  cols: 80,
  rows: 24
});
```

---

#### `close_terminal`
关闭终端。

**参数**:
- `terminal_id: String` - 终端 ID

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('close_terminal', { terminalId: 'term-123' });
```

---

### 分享功能

#### `start_sharing`
启动分享服务。

**参数**:
- `port: u16` - 端口号
- `password: String` - 访问密码

**返回**: `Result<ShareInfo, String>`

**示例**:
```typescript
const shareInfo = await invoke<ShareInfo>('start_sharing', {
  port: 3000,
  password: 'abc123'
});
```

---

#### `stop_sharing`
停止分享服务。

**参数**: 无

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('stop_sharing');
```

---

#### `get_share_state`
获取分享状态。

**参数**: 无

**返回**: `Result<ShareState, String>`

**示例**:
```typescript
const state = await invoke<ShareState>('get_share_state');
```

---

#### `get_share_info`
获取分享信息。

**参数**: 无

**返回**: `Result<ShareInfo, String>`

**示例**:
```typescript
const info = await invoke<ShareInfo>('get_share_info');
```

---

#### `update_share_password`
更新分享密码。

**参数**:
- `password: String` - 新密码

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('update_share_password', { password: 'newpass123' });
```

---

#### `get_connected_clients`
获取连接的客户端列表。

**参数**: 无

**返回**: `Result<Vec<ConnectedClient>, String>`

**示例**:
```typescript
const clients = await invoke<ConnectedClient[]>('get_connected_clients');
```

---

#### `kick_client`
踢出客户端。

**参数**:
- `session_id: String` - 会话 ID

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('kick_client', { sessionId: 'session-123' });
```

---

### NGROK 隧道

#### `start_ngrok_tunnel`
启动 NGROK 隧道。

**参数**: 无

**返回**: `Result<String, String>` - 公网 URL

**示例**:
```typescript
const url = await invoke<string>('start_ngrok_tunnel');
```

---

#### `stop_ngrok_tunnel`
停止 NGROK 隧道。

**参数**: 无

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('stop_ngrok_tunnel');
```

---

#### `get_ngrok_token`
获取 NGROK Token。

**参数**: 无

**返回**: `Result<Option<String>, String>`

**示例**:
```typescript
const token = await invoke<string | null>('get_ngrok_token');
```

---

#### `set_ngrok_token`
设置 NGROK Token。

**参数**:
- `token: String` - NGROK Token

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('set_ngrok_token', { token: 'your-token' });
```

---

### 其他命令

#### `open_editor`
用指定编辑器打开路径。

**参数**:
- `path: String` - 路径
- `editor: String` - 编辑器类型 ('vscode' | 'cursor' | 'idea')

**返回**: `Result<(), String>`

**示例**:
```typescript
await invoke('open_editor', {
  path: '/path/to/project',
  editor: 'vscode'
});
```

---

#### `get_main_workspace_status`
获取主工作区状态。

**参数**: 无

**返回**: `Result<MainWorkspaceStatus, String>`

**示例**:
```typescript
const status = await invoke<MainWorkspaceStatus>('get_main_workspace_status');
```

---

## HTTP API 端点

HTTP API 用于浏览器客户端访问（分享模式）。

### 认证

#### `POST /api/auth`
认证并获取会话。

**请求体**:
```json
{
  "password": "abc123"
}
```

**响应**:
```json
{
  "session_id": "session-123",
  "workspace_path": "/path/to/workspace"
}
```

---

### 工作区管理

#### `GET /api/workspaces`
获取工作区列表。

**响应**:
```json
[
  { "name": "Project A", "path": "/path/to/a" },
  { "name": "Project B", "path": "/path/to/b" }
]
```

---

#### `POST /api/workspaces`
添加工作区。

**请求体**:
```json
{
  "name": "New Project",
  "path": "/path/to/project"
}
```

**响应**: `204 No Content`

---

#### `GET /api/workspace/current`
获取当前工作区。

**Headers**:
- `X-Session-Id: session-123`

**响应**:
```json
{
  "path": "/path/to/workspace"
}
```

---

#### `POST /api/workspace/switch`
切换工作区。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "path": "/path/to/workspace"
}
```

**响应**: `204 No Content`

---

### Worktree 管理

#### `GET /api/worktrees`
获取 worktree 列表。

**Headers**:
- `X-Session-Id: session-123`

**响应**:
```json
[
  {
    "name": "feature-login",
    "path": "/path/to/worktree",
    "is_archived": false,
    "projects": [...]
  }
]
```

---

#### `POST /api/worktrees`
创建 worktree。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "name": "feature-login",
  "projects": [
    { "name": "frontend", "base_branch": "main" }
  ]
}
```

**响应**: `204 No Content`

---

#### `POST /api/worktrees/{name}/archive`
归档 worktree。

**Headers**:
- `X-Session-Id: session-123`

**响应**: `204 No Content`

---

### Git 操作

#### `POST /api/git/sync`
同步基础分支。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "project_path": "/path/to/project",
  "base_branch": "main"
}
```

**响应**:
```json
{
  "message": "Successfully synced with main"
}
```

---

#### `POST /api/git/merge`
合并到测试分支。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "project_path": "/path/to/project",
  "test_branch": "test"
}
```

**响应**:
```json
{
  "message": "Successfully merged to test"
}
```

---

#### `POST /api/git/pr`
创建 Pull Request。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "project_path": "/path/to/project",
  "base_branch": "main",
  "title": "Add new feature",
  "body": "Description"
}
```

**响应**:
```json
{
  "url": "https://github.com/user/repo/pull/123"
}
```

---

#### `GET /api/git/diff-stats`
获取分支差异统计。

**Headers**:
- `X-Session-Id: session-123`

**Query**:
- `project_path`: 项目路径
- `base_branch`: 基础分支

**响应**:
```json
{
  "files_changed": 5,
  "insertions": 120,
  "deletions": 30,
  "ahead": 3,
  "behind": 1
}
```

---

### 终端管理

#### `POST /api/terminals`
创建终端。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "path": "/path/to/directory"
}
```

**响应**:
```json
{
  "terminal_id": "term-123"
}
```

---

#### `POST /api/terminals/{id}/write`
写入数据到终端。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "data": "ls\n"
}
```

**响应**: `204 No Content`

---

#### `POST /api/terminals/{id}/resize`
调整终端大小。

**Headers**:
- `X-Session-Id: session-123`

**请求体**:
```json
{
  "cols": 80,
  "rows": 24
}
```

**响应**: `204 No Content`

---

#### `DELETE /api/terminals/{id}`
关闭终端。

**Headers**:
- `X-Session-Id: session-123`

**响应**: `204 No Content`

---

## WebSocket 消息格式

WebSocket 用于实时双向通信，主要用于终端和状态同步。

### 连接

```
ws://localhost:3000/ws
```

### 消息类型

#### 终端输出

**服务器 → 客户端**:
```json
{
  "type": "terminal_output",
  "terminal_id": "term-123",
  "data": "output text"
}
```

---

#### 终端输入

**客户端 → 服务器**:
```json
{
  "type": "terminal_input",
  "terminal_id": "term-123",
  "data": "input text"
}
```

---

#### Worktree 锁定

**服务器 → 客户端**:
```json
{
  "type": "worktree_lock",
  "workspace": "/path/to/workspace",
  "worktree": "feature-login",
  "locked_by": "session-123"
}
```

---

#### Worktree 解锁

**服务器 → 客户端**:
```json
{
  "type": "worktree_unlock",
  "workspace": "/path/to/workspace",
  "worktree": "feature-login"
}
```

---

#### 客户端被踢出

**服务器 → 客户端**:
```json
{
  "type": "kick",
  "session_id": "session-123"
}
```

---

#### 终端状态广播

**服务器 → 客户端**:
```json
{
  "type": "terminal_state",
  "terminals": {
    "term-123": {
      "path": "/path/to/directory",
      "active": true
    }
  }
}
```

---

## 前端 API 函数

前端封装的 API 调用函数（`src/lib/backend.ts`）。

### 工作区管理

```typescript
// 获取当前工作区
async function getCurrentWorkspace(): Promise<string | null>

// 切换工作区
async function switchWorkspace(path: string): Promise<void>

// 添加工作区
async function addWorkspace(name: string, path: string): Promise<void>

// 获取工作区配置
async function getWorkspaceConfig(): Promise<WorkspaceConfig>

// 保存工作区配置
async function saveWorkspaceConfig(config: WorkspaceConfig): Promise<void>
```

### Worktree 管理

```typescript
// 列出 worktree
async function listWorktrees(): Promise<WorktreeListItem[]>

// 创建 worktree
async function createWorktree(
  name: string,
  projects: CreateProjectRequest[]
): Promise<void>

// 归档 worktree
async function archiveWorktree(name: string): Promise<void>

// 恢复 worktree
async function restoreWorktree(name: string): Promise<void>

// 删除已归档的 worktree
async function deleteArchivedWorktree(name: string): Promise<void>

// 检查 worktree 状态
async function checkWorktreeStatus(name: string): Promise<WorktreeArchiveStatus>
```

### Git 操作

```typescript
// 同步基础分支
async function syncWithBaseBranch(
  projectPath: string,
  baseBranch: string
): Promise<string>

// 合并到测试分支
async function mergeToTestBranch(
  projectPath: string,
  testBranch: string
): Promise<string>

// 创建 Pull Request
async function createPullRequest(
  projectPath: string,
  baseBranch: string,
  title: string,
  body: string
): Promise<string>

// 获取分支差异统计
async function getBranchDiffStats(
  projectPath: string,
  baseBranch: string
): Promise<BranchDiffStats>
```

### 终端管理

```typescript
// 创建终端
async function createTerminal(path: string): Promise<string>

// 写入终端
async function writeToTerminal(terminalId: string, data: string): Promise<void>

// 调整终端大小
async function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number
): Promise<void>

// 关闭终端
async function closeTerminal(terminalId: string): Promise<void>
```

### 分享功能

```typescript
// 启动分享
async function startSharing(port: number, password: string): Promise<ShareInfo>

// 停止分享
async function stopSharing(): Promise<void>

// 获取分享状态
async function getShareState(): Promise<ShareState>

// 获取分享信息
async function getShareInfo(): Promise<ShareInfo>

// 更新密码
async function updateSharePassword(password: string): Promise<void>

// 获取连接的客户端
async function getConnectedClients(): Promise<ConnectedClient[]>

// 踢出客户端
async function kickClient(sessionId: string): Promise<void>
```

### NGROK

```typescript
// 启动 NGROK 隧道
async function startNgrokTunnel(): Promise<string>

// 停止 NGROK 隧道
async function stopNgrokTunnel(): Promise<void>

// 获取 NGROK Token
async function getNgrokToken(): Promise<string | null>

// 设置 NGROK Token
async function setNgrokToken(token: string): Promise<void>
```

---

## 类型定义

### WorkspaceConfig

```typescript
interface WorkspaceConfig {
  name: string;
  worktrees_dir: string;
  projects: ProjectConfig[];
  linked_workspace_items: string[];
}
```

### ProjectConfig

```typescript
interface ProjectConfig {
  name: string;
  base_branch: string;
  test_branch: string;
  merge_strategy: string;
  linked_folders: string[];
}
```

### WorktreeListItem

```typescript
interface WorktreeListItem {
  name: string;
  path: string;
  is_archived: boolean;
  projects: ProjectStatus[];
}
```

### ProjectStatus

```typescript
interface ProjectStatus {
  name: string;
  path: string;
  current_branch: string;
  base_branch: string;
  test_branch: string;
  has_uncommitted: boolean;
  uncommitted_count: number;
  is_merged_to_test: boolean;
  ahead_of_base: number;
  behind_base: number;
}
```

### BranchDiffStats

```typescript
interface BranchDiffStats {
  files_changed: number;
  insertions: number;
  deletions: number;
  ahead: number;
  behind: number;
}
```

### ShareInfo

```typescript
interface ShareInfo {
  local_url: string;
  lan_url: string;
  password: string;
  ngrok_url?: string;
}
```

### ConnectedClient

```typescript
interface ConnectedClient {
  session_id: string;
  ip_address: string;
  connected_at: string;
  user_agent: string;
}
```

---

## 错误处理

所有 API 调用都返回 `Result<T, String>` 类型，错误信息为字符串格式。

### 常见错误

- `"Workspace not found"` - 工作区不存在
- `"Worktree already exists"` - Worktree 已存在
- `"Git operation failed"` - Git 操作失败
- `"Terminal not found"` - 终端不存在
- `"Authentication failed"` - 认证失败
- `"Permission denied"` - 权限不足

### 错误处理示例

```typescript
try {
  await createWorktree('feature-login', projects);
} catch (error) {
  console.error('Failed to create worktree:', error);
  alert(`Error: ${error}`);
}
```
