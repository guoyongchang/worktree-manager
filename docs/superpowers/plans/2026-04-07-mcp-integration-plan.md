# MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `@worktree-manager/mcp` npm package that exposes Worktree Manager functionality via MCP protocol, enabling AI assistants (Claude Code, Codex, Cursor) to query workspace state.

**Architecture:**
- Node.js MCP server using `@modelcontextprotocol/sdk`
- Dual transport: HTTP (when Tauri app running) or config file polling (fallback)
- Layered tools: Core (L1) → Details (L2) → Advanced (L3)
- Auto-install via `npx @worktree-manager/mcp install` writing to `~/.claude.json`

**Tech Stack:** Node.js, TypeScript, `@modelcontextprotocol/sdk`, Axum (existing Tauri HTTP server), fs (config polling)

---

## File Structure

### New Files to Create

```
projects/worktree-manager/
├── packages/mcp/                          # NEW: npm package
│   ├── src/
│   │   ├── index.ts                       # CLI entry (start/install/uninstall commands)
│   │   ├── server.ts                      # MCP server initialization
│   │   ├── tools/
│   │   │   ├── core.ts                    # Layer 1: workspace_list, worktree_list, etc.
│   │   │   ├── details.ts                 # Layer 2: project_get_branches, etc.
│   │   │   └── advanced.ts                # Layer 3: worktree_create, git_commit, etc.
│   │   ├── transport/
│   │   │   ├── http.ts                    # HTTP transport to Tauri app
│   │   │   └── config.ts                  # Config file fallback transport
│   │   ├── types.ts                       # Shared TypeScript types
│   │   └── package.json
│   ├── tsconfig.json
│   └── README.md
```

### Existing Files to Modify

```
projects/worktree-manager/src-tauri/src/
├── http_server.rs                          # Add MCP HTTP endpoints
├── http_server/routing.rs                 # Register /api/mcp/* routes
├── config.rs                              # Add mcp_config module + MCP JSON writing
├── lib.rs                                 # Register mcp_config commands
```

---

## Task 1: Create MCP Package Scaffold

**Files:**
- Create: `projects/worktree-manager/packages/mcp/package.json`
- Create: `projects/worktree-manager/packages/mcp/tsconfig.json`
- Create: `projects/worktree-manager/packages/mcp/README.md`

- [ ] **Step 1: Create packages/mcp directory**

```bash
mkdir -p projects/worktree-manager/packages/mcp/src/{tools,transport}
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@worktree-manager/mcp",
  "version": "1.0.0",
  "description": "MCP server for Worktree Manager",
  "type": "module",
  "bin": {
    "worktree-manager-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "prepublish": "npm run build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "axios": "^1.7.0",
    "chokidar": "^3.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create README.md**

```markdown
# @worktree-manager/mcp

MCP server for Worktree Manager

## Installation

```bash
npx -y @worktree-manager/mcp install
```

## Usage

```bash
# Start MCP server
npx -y @worktree-manager/mcp start

# Install to Claude Code
npx -y @worktree-manager/mcp install

# Uninstall from Claude Code
npx -y @worktree-manager/mcp uninstall
```

## Available Tools

### Layer 1 (Core)
- `workspace_list` - List all workspaces
- `workspace_get_current` - Get current workspace
- `worktree_list` - List worktrees in current workspace
- `worktree_get_status` - Get worktree status

### Layer 2 (Details)
- `project_get_branches` - Get project branches
- `project_get_diff_stats` - Get diff stats vs base branch
- `project_get_changed_files` - Get uncommitted files

### Layer 3 (Advanced)
- `worktree_create` - Create new worktree
- `git_commit` - Commit changes
- `git_push` - Push to remote
```

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/
git commit -m "feat(mcp): create @worktree-manager/mcp package scaffold"
```

---

## Task 2: Implement Shared Types

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// Workspace reference
export interface WorkspaceRef {
  name: string;
  path: string;
}

// Worktree list item
export interface WorktreeListItem {
  name: string;
  path: string;
  is_archived: boolean;
  display_name?: string;
  projects: ProjectStatus[];
}

// Project status
export interface ProjectStatus {
  name: string;
  path: string;
  current_branch: string;
  base_branch: string;
  test_branch: string;
  has_uncommitted: boolean;
  uncommitted_count: number;
  is_merged_to_test: boolean;
  is_merged_to_base: boolean;
  ahead_of_base: number;
  behind_base: number;
}

// Branch diff stats
export interface BranchDiffStats {
  ahead: number;
  behind: number;
  changed_files: number;
}

// Changed file
export interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
}

// MCP error response
export interface McpError {
  code: number;
  message: string;
  data?: unknown;
}

// Transport mode
export type TransportMode = 'http' | 'config';

// Capability levels
export type CapabilityLevel = 'core' | 'details' | 'advanced';

// MCP config
export interface McpConfig {
  version: string;
  http_port: number;
  installed_at: string;
  capability_level: CapabilityLevel;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/types.ts
git commit -m "feat(mcp): add shared TypeScript types"
```

---

## Task 3: Implement HTTP Transport

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/transport/http.ts`

- [ ] **Step 1: Create transport/http.ts**

```typescript
import axios, { AxiosInstance } from 'axios';
import type { TransportMode } from '../types.js';

const DEFAULT_PORT = 42819;
const MCP_CONFIG_PATH = '.config/worktree-manager/mcp.json';

export class HttpTransport {
  private client: AxiosInstance;
  private port: number;
  private baseUrl: string;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
    this.baseUrl = `http://localhost:${this.port}`;
    this.client = axios.create({
      baseURL: `${this.baseUrl}/api`,
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.client.post('/get_current_workspace', {});
      return response.status === 200;
    } catch {
      return false;
    }
  }

  getMode(): TransportMode {
    return 'http';
  }

  // Workspace operations
  async listWorkspaces(): Promise<unknown> {
    const res = await this.client.post('/list_workspaces', {});
    return res.data;
  }

  async getCurrentWorkspace(): Promise<unknown> {
    const res = await this.client.post('/get_current_workspace', {});
    return res.data;
  }

  async switchWorkspace(path: string): Promise<unknown> {
    const res = await this.client.post('/switch_workspace', { path });
    return res.data;
  }

  // Worktree operations
  async listWorktrees(includeArchived: boolean = false): Promise<unknown> {
    const res = await this.client.post('/list_worktrees', { include_archived: includeArchived });
    return res.data;
  }

  async getMainWorkspaceStatus(): Promise<unknown> {
    const res = await this.client.post('/get_main_workspace_status', {});
    return res.data;
  }

  async createWorktree(request: {
    name: string;
    folder_name?: string;
    projects: Array<{ name: string; base_branch?: string }>;
  }): Promise<unknown> {
    const res = await this.client.post('/create_worktree', request);
    return res.data;
  }

  async archiveWorktree(name: string): Promise<unknown> {
    const res = await this.client.post('/archive_worktree', { name });
    return res.data;
  }

  async deleteArchivedWorktree(name: string): Promise<unknown> {
    const res = await this.client.post('/delete_archived_worktree', { name });
    return res.data;
  }

  async checkWorktreeStatus(name: string): Promise<unknown> {
    const res = await this.client.post('/check_worktree_status', { name });
    return res.data;
  }

  // Project/Git operations
  async getBranchDiffStats(projectPath: string, baseBranch: string): Promise<unknown> {
    const res = await this.client.post('/get_branch_diff_stats', {
      path: projectPath,
      base_branch: baseBranch,
    });
    return res.data;
  }

  async getChangedFiles(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/get_changed_files', { path: projectPath });
    return res.data;
  }

  async getRemoteBranches(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/get_remote_branches', { path: projectPath });
    return res.data;
  }

  async commitAll(projectPath: string, message: string): Promise<unknown> {
    const res = await this.client.post('/commit_all', { path: projectPath, message });
    return res.data;
  }

  async pushToRemote(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/push_to_remote', { path: projectPath });
    return res.data;
  }

  async switchBranch(projectPath: string, branchName: string): Promise<unknown> {
    const res = await this.client.post('/switch_branch', { path: projectPath, branch: branchName });
    return res.data;
  }

  async fetchProjectRemote(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/fetch_project_remote', { path: projectPath });
    return res.data;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/transport/http.ts
git commit -m "feat(mcp): implement HTTP transport for Tauri communication"
```

---

## Task 4: Implement Config File Fallback Transport

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/transport/config.ts`

- [ ] **Step 1: Create transport/config.ts**

```typescript
import { readFileSync, existsSync } from 'fs';
import { join, homedir } from 'path';
import { watch } from 'chokidar';
import type { TransportMode, WorkspaceRef, WorktreeListItem } from '../types.js';

const GLOBAL_CONFIG_PATH = '.config/worktree-manager/global.json';

export class ConfigTransport {
  private configPath: string;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor() {
    this.configPath = join(homedir(), GLOBAL_CONFIG_PATH);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.configPath);
  }

  getMode(): TransportMode {
    return 'config';
  }

  private loadConfig(): any {
    try {
      const content = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { workspaces: [] };
    }
  }

  async listWorkspaces(): Promise<{ workspaces: WorkspaceRef[] }> {
    const config = this.loadConfig();
    return { workspaces: config.workspaces || [] };
  }

  async getCurrentWorkspace(): Promise<{ workspace: WorkspaceRef | null }> {
    const config = this.loadConfig();
    const currentPath = config.current_workspace;
    const workspace = config.workspaces?.find((w: WorkspaceRef) => w.path === currentPath) || null;
    return { workspace };
  }

  async listWorktrees(): Promise<{ worktrees: WorktreeListItem[] }> {
    // Config file doesn't store worktree data - return empty
    // This is a limitation of fallback mode
    return { worktrees: [] };
  }

  watch(callback: () => void): void {
    if (this.watcher) return;
    this.watcher = watch(this.configPath, { persistent: true });
    this.watcher.on('change', callback);
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/transport/config.ts
git commit -m "feat(mcp): implement config file fallback transport"
```

---

## Task 5: Implement Layer 1 Core Tools

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/tools/core.ts`

- [ ] **Step 1: Create tools/core.ts**

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '../transport/http.js';

export function registerCoreTools(server: McpServer, transport: Transport): void {
  // workspace_list
  server.setRequestHandler(
    { method: 'tools/call' },
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      if (name === 'workspace_list') {
        const result = await transport.listWorkspaces();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'workspace_get_current') {
        const result = await transport.getCurrentWorkspace();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'worktree_list') {
        const includeArchived = args?.include_archived === true;
        const result = await transport.listWorktrees(includeArchived);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'worktree_get_status') {
        const name = args?.name as string;
        if (!name) {
          throw new Error('worktree name is required');
        }
        const status = await transport.checkWorktreeStatus(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      }

      if (name === 'workspace_get_status') {
        const result = await transport.getMainWorkspaceStatus();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      return null;
    }
  );
}

export const CORE_TOOLS = [
  {
    name: 'workspace_list',
    description: 'List all workspaces configured in Worktree Manager',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'workspace_get_current',
    description: 'Get the currently selected workspace',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'worktree_list',
    description: 'List all worktrees in the current workspace',
    inputSchema: {
      type: 'object',
      properties: {
        include_archived: {
          type: 'boolean',
          description: 'Include archived worktrees',
          default: false,
        },
      },
    },
  },
  {
    name: 'worktree_get_status',
    description: 'Get detailed status of a specific worktree',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Worktree name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'workspace_get_status',
    description: 'Get status of the main workspace (projects in projects/ directory)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/tools/core.ts
git commit -m "feat(mcp): implement Layer 1 core tools"
```

---

## Task 6: Implement Layer 2 Details Tools

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/tools/details.ts`

- [ ] **Step 1: Create tools/details.ts**

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '../transport/http.js';

export function registerDetailsTools(
  server: McpServer,
  transport: Transport
): void {
  server.setRequestHandler(
    { method: 'tools/call' },
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      if (name === 'project_get_branches') {
        const projectPath = args?.project_path as string;
        if (!projectPath) {
          throw new Error('project_path is required');
        }
        const result = await transport.getRemoteBranches(projectPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'project_get_diff_stats') {
        const projectPath = args?.project_path as string;
        const baseBranch = args?.base_branch as string;
        if (!projectPath || !baseBranch) {
          throw new Error('project_path and base_branch are required');
        }
        const result = await transport.getBranchDiffStats(projectPath, baseBranch);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'project_get_changed_files') {
        const projectPath = args?.project_path as string;
        if (!projectPath) {
          throw new Error('project_path is required');
        }
        const result = await transport.getChangedFiles(projectPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      return null;
    }
  );
}

export const DETAILS_TOOLS = [
  {
    name: 'project_get_branches',
    description: 'Get list of remote branches for a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Full path to the project directory',
        },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'project_get_diff_stats',
    description: 'Get diff statistics between current branch and base branch',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Full path to the project' },
        base_branch: { type: 'string', description: 'Base branch to compare against' },
      },
      required: ['project_path', 'base_branch'],
    },
  },
  {
    name: 'project_get_changed_files',
    description: 'Get list of files with uncommitted changes',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Full path to the project' },
      },
      required: ['project_path'],
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/tools/details.ts
git commit -m "feat(mcp): implement Layer 2 details tools"
```

---

## Task 7: Implement Layer 3 Advanced Tools

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/tools/advanced.ts`

- [ ] **Step 1: Create tools/advanced.ts**

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '../transport/http.js';

export function registerAdvancedTools(
  server: McpServer,
  transport: Transport
): void {
  server.setRequestHandler(
    { method: 'tools/call' },
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      if (name === 'worktree_create') {
        const name = args?.name as string;
        const projects = args?.projects as Array<{ name: string; base_branch?: string }>;
        const folder_name = args?.folder_name as string | undefined;
        if (!name || !projects) {
          throw new Error('name and projects are required');
        }
        const result = await transport.createWorktree({ name, projects, folder_name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'worktree_archive') {
        const name = args?.name as string;
        if (!name) {
          throw new Error('name is required');
        }
        const result = await transport.archiveWorktree(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'worktree_delete_archived') {
        const name = args?.name as string;
        if (!name) {
          throw new Error('name is required');
        }
        const result = await transport.deleteArchivedWorktree(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_commit') {
        const projectPath = args?.project_path as string;
        const message = args?.message as string;
        if (!projectPath || !message) {
          throw new Error('project_path and message are required');
        }
        const result = await transport.commitAll(projectPath, message);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_push') {
        const projectPath = args?.project_path as string;
        if (!projectPath) {
          throw new Error('project_path is required');
        }
        const result = await transport.pushToRemote(projectPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_switch_branch') {
        const projectPath = args?.project_path as string;
        const branchName = args?.branch_name as string;
        if (!projectPath || !branchName) {
          throw new Error('project_path and branch_name are required');
        }
        const result = await transport.switchBranch(projectPath, branchName);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_fetch') {
        const projectPath = args?.project_path as string;
        if (!projectPath) {
          throw new Error('project_path is required');
        }
        const result = await transport.fetchProjectRemote(projectPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      return null;
    }
  );
}

export const ADVANCED_TOOLS = [
  {
    name: 'worktree_create',
    description: 'Create a new worktree with specified projects',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Worktree/branch name' },
        folder_name: { type: 'string', description: 'Optional folder name (defaults to name)' },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              base_branch: { type: 'string' },
            },
          },
          description: 'Projects to include in worktree',
        },
      },
      required: ['name', 'projects'],
    },
  },
  {
    name: 'worktree_archive',
    description: 'Archive an existing worktree',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Worktree name to archive' },
      },
      required: ['name'],
    },
  },
  {
    name: 'worktree_delete_archived',
    description: 'Permanently delete an archived worktree',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Archived worktree name (with .archive suffix)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and commit with message',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['project_path', 'message'],
    },
  },
  {
    name: 'git_push',
    description: 'Push current branch to remote',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'git_switch_branch',
    description: 'Switch to a different branch',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        branch_name: { type: 'string' },
      },
      required: ['project_path', 'branch_name'],
    },
  },
  {
    name: 'git_fetch',
    description: 'Fetch from remote origin',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
      },
      required: ['project_path'],
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/tools/advanced.ts
git commit -m "feat(mcp): implement Layer 3 advanced tools"
```

---

## Task 8: Implement MCP Server

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/server.ts`

- [ ] **Step 1: Create server.ts**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpTransport } from './transport/http.js';
import { ConfigTransport } from './transport/config.js';
import { registerCoreTools, CORE_TOOLS } from './tools/core.js';
import { registerDetailsTools, DETAILS_TOOLS } from './tools/details.js';
import { registerAdvancedTools, ADVANCED_TOOLS } from './tools/advanced.js';
import type { Transport, CapabilityLevel } from './types.js';

export class WorktreeMcpServer {
  private server: Server;
  private transport: Transport | null = null;
  private capabilityLevel: CapabilityLevel = 'core';

  constructor() {
    this.server = new Server(
      {
        name: 'worktree-manager',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  async initialize(): Promise<void> {
    // Try HTTP transport first
    const httpTransport = new HttpTransport();
    if (await httpTransport.isAvailable()) {
      this.transport = httpTransport;
      console.error('[MCP] Using HTTP transport (Tauri app running)');
    } else {
      // Fall back to config transport
      const configTransport = new ConfigTransport();
      if (await configTransport.isAvailable()) {
        this.transport = configTransport;
        console.error('[MCP] Using config file transport (fallback mode)');
      } else {
        throw new Error('No transport available. Ensure Tauri app is running or global config exists.');
      }
    }

    // Register tools based on capability level
    this.registerTools();
  }

  private registerTools(): void {
    if (!this.transport) return;

    // Core tools always registered
    registerCoreTools(this.server, this.transport);

    // Details tools
    if (this.capabilityLevel === 'details' || this.capabilityLevel === 'advanced') {
      registerDetailsTools(this.server, this.transport);
    }

    // Advanced tools
    if (this.capabilityLevel === 'advanced') {
      registerAdvancedTools(this.server, this.transport);
    }

    // Set tool list handler
    this.server.setRequestHandler(
      { method: 'tools/list' },
      async () => {
        let tools = [...CORE_TOOLS];
        if (this.capabilityLevel === 'details' || this.capabilityLevel === 'advanced') {
          tools = tools.concat(DETAILS_TOOLS);
        }
        if (this.capabilityLevel === 'advanced') {
          tools = tools.concat(ADVANCED_TOOLS);
        }
        return { tools };
      }
    );
  }

  setCapabilityLevel(level: CapabilityLevel): void {
    this.capabilityLevel = level;
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP] Server running on stdio');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp/src/server.ts
git commit -m "feat(mcp): implement MCP server with layered tools"
```

---

## Task 9: Implement CLI Entry Point

**Files:**
- Create: `projects/worktree-manager/packages/mcp/src/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
#!/usr/bin/env node

import { WorktreeMcpServer } from './server.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, homedir } from 'path';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');
const MCP_CONFIG_DIR = '.config/worktree-manager';
const MCP_CONFIG_PATH = join(homedir(), MCP_CONFIG_DIR, 'mcp.json');

async function startServer() {
  const server = new WorktreeMcpServer();
  await server.initialize();
  await server.run();
}

function loadClaudeConfig(): any {
  try {
    if (existsSync(CLAUDE_CONFIG_PATH)) {
      return JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveClaudeConfig(config: any): void {
  writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function install() {
  console.error('Installing @worktree-manager/mcp to Claude Code...');

  const config = loadClaudeConfig();
  config.mcpServers = config.mcpServers || {};
  config.mcpServers['worktree-manager'] = {
    command: 'npx',
    args: ['-y', '@worktree-manager/mcp', 'start'],
  };
  saveClaudeConfig(config);

  console.error('Installed! Claude Code will now have access to Worktree Manager.');
  console.error('Restart Claude Code or run: claude mcp restart');
}

async function uninstall() {
  console.error('Uninstalling @worktree-manager/mcp from Claude Code...');

  const config = loadClaudeConfig();
  if (config.mcpServers?.['worktree-manager']) {
    delete config.mcpServers['worktree-manager'];
    saveClaudeConfig(config);
    console.error('Uninstalled. Restart Claude Code to apply changes.');
  } else {
    console.error('Not found in Claude config.');
  }
}

function writeMcpConfig(): void {
  try {
    const dir = join(homedir(), MCP_CONFIG_DIR);
    if (!existsSync(dir)) {
      import('fs').then(({ mkdirSync }) => mkdirSync(dir, { recursive: true }));
    }
    const mcpConfig = {
      version: '1.0.0',
      http_port: 42819,
      installed_at: new Date().toISOString(),
      capability_level: 'core',
    };
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2));
  } catch (e) {
    console.error('Warning: Could not write MCP config:', e);
  }
}

const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    writeMcpConfig();
    await startServer();
    break;
  case 'install':
    await install();
    break;
  case 'uninstall':
    await uninstall();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: worktree-manager-mcp [start|install|uninstall]');
    process.exit(1);
}
```

- [ ] **Step 2: Update package.json bin field verification**

The bin field in package.json points to `dist/index.js` but TypeScript compiles to `dist/`. Update the source to match:

```json
{
  "bin": {
    "worktree-manager-mcp": "./dist/index.js"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/index.ts
git commit -m "feat(mcp): add CLI entry point with start/install/uninstall commands"
```

---

## Task 10: Add HTTP Server Endpoints to Tauri

**Files:**
- Modify: `src-tauri/src/http_server.rs` (add MCP config writing)
- Modify: `src-tauri/src/http_server/routing.rs` (add mcp endpoints)
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Check existing http_server structure**

```bash
# Read more of http_server.rs to understand the structure
head -200 src-tauri/src/http_server.rs
```

- [ ] **Step 2: Add MCP config handler to http_server.rs**

Add near the end of http_server.rs, before the closing:

```rust
// MCP config management
#[derive(Debug, Serialize, Deserialize)]
pub struct McpConfig {
    pub version: String,
    pub http_port: u16,
    pub installed_at: String,
    pub capability_level: String,
}

pub fn get_mcp_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".config")
        .join("worktree-manager")
        .join("mcp.json")
}

pub fn load_mcp_config() -> Option<McpConfig> {
    let path = get_mcp_config_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    } else {
        None
    }
}

pub fn save_mcp_config(config: &McpConfig) -> Result<(), String> {
    let path = get_mcp_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Add MCP config handler function to routing.rs**

Add handler in routing.rs:

```rust
// h_mcp_config - get MCP configuration
pub async fn h_mcp_config() -> Response {
    match load_mcp_config() {
        Some(config) => (StatusCode::OK, Json(json!(config))).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "MCP not configured"})),
        ).into_response(),
    }
}

// h_set_mcp_capability - update MCP capability level
pub async fn h_set_mcp_capability(
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let level = match payload.get("capability_level")
        .and_then(|v| v.as_str()) {
        Some("core") | Some("details") | Some("advanced") => payload["capability_level"].as_str().unwrap(),
        _ => return (StatusCode::BAD_REQUEST, "Invalid capability level").into_response(),
    };

    let mut config = load_mcp_config().unwrap_or(McpConfig {
        version: "1.0.0".to_string(),
        http_port: 42819,
        installed_at: chrono::Utc::now().to_rfc3339(),
        capability_level: "core".to_string(),
    });

    config.capability_level = level.to_string();

    match save_mcp_config(&config) {
        Ok(()) => (StatusCode::OK, Json(json!({"success": true}))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}
```

- [ ] **Step 4: Register routes in build_api_router**

In routing.rs, add these routes to `build_api_router`:

```rust
.route("/api/mcp/config", post(h_mcp_config))
.route("/api/mcp/set_capability", post(h_set_mcp_capability))
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server.rs src-tauri/src/http_server/routing.rs
git commit -m "feat(mcp): add HTTP endpoints for MCP config management"
```

---

## Task 11: Add MCP Port Startup Logic

**Files:**
- Modify: `src-tauri/src/http_server.rs` (start MCP server on port 42819)

- [ ] **Step 1: Add MCP server startup function**

Add to http_server.rs:

```rust
const MCP_DEFAULT_PORT: u16 = 42819;

/// Start the MCP HTTP server on the specified port
pub async fn start_mcp_server(port: u16) -> Result<(), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    // Save MCP config
    let config = McpConfig {
        version: env!("CARGO_PKG_VERSION").to_string(),
        http_port: port,
        installed_at: chrono::Utc::now().to_rfc3339(),
        capability_level: "core".to_string(),
    };
    save_mcp_config(&config)?;

    log::info!("[MCP] Starting HTTP server on {}", addr);

    let router = build_api_router(None);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind MCP server: {}", e))?;

    axum::serve(listener, router)
        .await
        .map_err(|e| format!("MCP server error: {}", e))?;

    Ok(())
}
```

- [ ] **Step 2: Add Tauri command to start MCP server**

Add to lib.rs:

```rust
#[tauri::command]
pub async fn start_mcp_server(port: Option<u16>) -> Result<(), String> {
    let port = port.unwrap_or(MCP_DEFAULT_PORT);
    start_mcp_server(port).await
}
```

- [ ] **Step 3: Register command in lib.rs**

In the Tauri builder, add:

```rust
.cmd("start_mcp_server", start_mcp_server)
```

- [ ] **Step 4: Auto-start MCP server on app launch**

In main.rs or lib.rs startup, add:

```rust
// Start MCP server on port 42819 in background
let mcp_port = 42819;
tokio::spawn(async move {
    if let Err(e) = start_mcp_server(mcp_port).await {
        log::error!("[MCP] Server failed: {}", e);
    }
});
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server.rs src-tauri/src/lib.rs
git commit -m "feat(mcp): add MCP HTTP server startup on port 42819"
```

---

## Task 12: Install & Test

**Files:**
- Test installation process

- [ ] **Step 1: Build the MCP package**

```bash
cd packages/mcp
npm install
npm run build
```

Expected: Compiles without errors, `dist/` directory created

- [ ] **Step 2: Test CLI help**

```bash
node dist/index.js
```

Expected: Shows usage message

- [ ] **Step 3: Test install command (dry run)**

```bash
# Don't actually run - just verify the code path exists
```

- [ ] **Step 4: Verify Tauri app has MCP endpoints**

Check that the routing includes `/api/mcp/*` routes

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mcp): complete MCP integration for Worktree Manager"
```

---

## Task 13: Create MCP Skills (Optional - Phase 3)

**Files:**
- Create: `src/.claude/skills/worktree-manager-skill.md`

This is for Phase 3 - Skills wrapper around advanced operations.

- [ ] **Step 1: Create skill definition**

```markdown
# Worktree Manager Skill

Use this skill when working with worktrees and workspaces.

## Context

The user is working with Worktree Manager, a Git worktree visualization tool.
Available operations:

- List workspaces
- List worktrees
- Check worktree status
- Create worktree
- Archive worktree
- Commit and push changes

## Usage

When the user wants to:
- "list my worktrees" → use workspace_list and worktree_list tools
- "create a new worktree for feature X" → use worktree_create tool
- "check status of feature branch" → use worktree_get_status tool

## Error Handling

If no workspace is selected, guide user to select one first.
```

- [ ] **Step 2: Commit**

```bash
git add src/.claude/skills/worktree-manager-skill.md
git commit -m "docs(skill): add Worktree Manager skill definition"
```

---

## Implementation Order

1. Task 1: Create MCP Package Scaffold
2. Task 2: Implement Shared Types
3. Task 3: Implement HTTP Transport
4. Task 4: Implement Config File Fallback Transport
5. Task 5: Implement Layer 1 Core Tools
6. Task 6: Implement Layer 2 Details Tools
7. Task 7: Implement Layer 3 Advanced Tools
8. Task 8: Implement MCP Server
9. Task 9: Implement CLI Entry Point
10. Task 10: Add HTTP Server Endpoints to Tauri
11. Task 11: Add MCP Port Startup Logic
12. Task 12: Install & Test
13. Task 13: Create MCP Skills (Optional)

---

## Spec Coverage Check

| Spec Section | Task(s) |
|--------------|---------|
| 2.1 Component Overview | Task 1, 8, 10, 11 |
| 2.2 Communication Modes | Task 3, 4 |
| 3.1 Server Structure | Task 1, 8 |
| 3.2 Tool Categories | Task 5, 6, 7 |
| 3.3 Progressive Disclosure | Task 8 (capability level) |
| 4.1 Initialization Flow | Task 8, 9 |
| 5.2 Installation Flow | Task 9 (install command) |
| 6.1 HTTP API | Task 3, 10 |
| 7.1 Global Config | Task 4 |
| 7.2 MCP Config | Task 10 |

---

## Self-Review Checklist

- [ ] All file paths are exact
- [ ] All code blocks contain actual code (no TODOs)
- [ ] All TypeScript code uses proper module syntax (.js extensions in imports)
- [ ] Rust code follows existing patterns in the codebase
- [ ] Each task is self-contained and can be committed independently
- [ ] Task order respects dependencies
