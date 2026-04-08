# MCP Integration Design — Worktree Manager

**Date:** 2026-04-07
**Status:** Draft
**Author:** Claude

## 1. Overview

Integrate Worktree Manager as a MCP (Model Context Protocol) server, enabling AI coding assistants (Claude Code, Codex, Cursor) to query workspace state and perform operations through a standardized protocol.

### Goals

- AI assistants can discover current workspace, worktrees, and project status
- Progressive disclosure of capabilities based on context
- Seamless auto-installation via `npx @worktree-manager/mcp install`
- Dual-mode: works when Tauri app is running (desktop mode) or independently via config file polling

### Non-Goals

- Full remote access (browser mode tunnel is separate concern)
- Replacing the Tauri app UI — MCP augments, not replaces
- Real-time terminal/PTY operations via MCP

---

## 2. Architecture

### 2.1 Component Overview

```
┌──────────────────────────────────────────────────────────────┐
│  AI Assistants (Claude Code, Codex, Cursor)                   │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ MCP Protocol (JSON-RPC over stdio)                     │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  @worktree-manager/mcp  (Node.js MCP Server)           │ │
│  │                                                          │ │
│  │  - MCP Protocol handler                                 │ │
│  │  - Layered tools (Core → Details → Advanced)           │ │
│  │  - Progressive disclosure via initialize.capabilities   │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│            HTTP (localhost:42819) or config file polling    │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Tauri Desktop App (Worktree Manager)                   │ │
│  │                                                          │ │
│  │  ┌──────────────────┐  ┌───────────────────────────┐  │ │
│  │  │  HTTP Server      │  │  Config File Monitor      │  │ │
│  │  │  (localhost:42819)│  │  (~/.config/worktree-    │  │ │
│  │  │  via http_server  │  │   manager/global.json)   │  │ │
│  │  └──────────────────┘  └───────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Communication Modes

**Mode A: App Running (Primary)**
- MCP server connects to `http://localhost:42819`
- Tauri app starts internal HTTP server when MCP connection detected
- Low latency, real-time data

**Mode B: App Not Running (Fallback)**
- MCP server reads `~/.config/worktree-manager/global.json` directly
- Polls every 5 seconds for changes
- Higher latency, eventual consistency

### 2.3 Port Selection

- **Default MCP port:** 42819
- Avoids common ports (3000, 8080, etc.)
- Configurable via `WORKTREE_MCP_PORT` environment variable

---

## 3. MCP Protocol Implementation

### 3.1 Server Structure

```
@worktree-manager/mcp/
├── src/
│   ├── index.ts           # Entry point, MCP server setup
│   ├── server.ts          # MCP protocol handler
│   ├── tools/
│   │   ├── core.ts        # Layer 1: Core tools (always exposed)
│   │   ├── details.ts     # Layer 2: Detail tools
│   │   └── advanced.ts     # Layer 3: Advanced tools
│   ├── transport/
│   │   ├── http.ts        # HTTP transport to Tauri app
│   │   └── config.ts      # Config file fallback
│   └── progressive.ts    # Progressive disclosure logic
├── package.json
└── README.md
```

### 3.2 Tool Categories

#### Layer 1 — Core (Always Exposed)

| Tool | Arguments | Returns |
|------|-----------|---------|
| `workspace_list` | — | `{ workspaces: WorkspaceRef[] }` |
| `workspace_get_current` | — | `{ workspace: WorkspaceRef }` |
| `worktree_list` | `workspace_path?` | `{ worktrees: WorktreeListItem[] }` |
| `worktree_get_status` | `worktree_name` | `{ status: WorktreeListItem }` |

#### Layer 2 — Details (Exposed on Demand)

| Tool | Arguments | Returns |
|------|-----------|---------|
| `project_get_branches` | `project_path` | `{ branches: BranchInfo[] }` |
| `project_get_diff_stats` | `project_path, base_branch` | `{ ahead, behind, changed_files }` |
| `project_get_changed_files` | `project_path` | `{ files: ChangedFile[] }` |
| `project_get_remote_branches` | `project_path` | `{ branches: string[] }` |

#### Layer 3 — Advanced (Wrapped by Skills for Complex Ops)

| Tool | Arguments | Returns |
|------|-----------|---------|
| `worktree_create` | `name, projects[], base_branch?` | `{ path: string }` |
| `worktree_archive` | `worktree_name` | `{ success: boolean }` |
| `worktree_delete_archived` | `worktree_name` | `{ success: boolean }` |
| `git_commit` | `project_path, message` | `{ success: boolean }` |
| `git_push` | `project_path` | `{ success: boolean }` |
| `git_create_branch` | `project_path, branch_name, base_branch` | `{ success: boolean }` |

### 3.3 Progressive Disclosure

**Mechanism:** The MCP server's `initialize` response declares capabilities:

```typescript
const serverCapabilities = {
  tools: {
    // Layer 1 always included
    core: true,
    // Layer 2 and 3 requested via hints in clientInit
  }
};
```

**Dynamic Tool Loading:**
1. On `initialize`, client can pass `hints.capabilities[]` 
2. Server responds with appropriate tool subset
3. Client can call `tools/list` to refresh tool catalog

**Error-Guided Discovery:**
- Calling an unexposed tool returns a helpful error:
  ```json
  {
    "error": {
      "code": -32601,
      "message": "Tool not exposed. Hint: This tool requires 'advanced' capability. Try: claude mcp update --capability advanced"
    }
  }
  ```

---

## 4. MCP Server Lifecycle

### 4.1 Initialization Flow

```
1. MCP Server starts
2. Load config (~/.config/worktree-manager/global.json)
3. Check if Tauri app is running (connect to localhost:42819)
   - If running: Use HTTP transport
   - If not: Use config file fallback, start polling
4. Register tools based on capability level
5. Send initialize response to client
6. Enter ready state
```

### 4.2 Shutdown Flow

```
1. Receive shutdown request
2. Close HTTP connections
3. Stop config file watchers
4. Exit process with code 0
```

---

## 5. Auto-Installation

### 5.1 Package Distribution

```bash
npm publish @worktree-manager/mcp
```

### 5.2 Installation Flow

**Command:** `npx -y @worktree-manager/mcp install`

**What it does:**

1. **Detect Tauri app location**
   ```bash
   # macOS
   open -R "Worktree Manager.app" 2>/dev/null || echo "not found"
   # Extract app path
   ```

2. **Write Claude config** to `~/.claude.json`
   ```json
   {
     "mcpServers": {
       "worktree-manager": {
         "command": "npx",
         "args": ["-y", "@worktree-manager/mcp", "start"]
       }
     }
   }
   ```

3. **Verify installation**
   ```bash
   claude mcp list | grep worktree-manager
   ```

### 5.3 Tauri App Integration

**First Launch Detection:**
- Tauri app stores `mcp_installed` flag in config
- On first launch (flag absent):
  1. Show dialog: "Enable Claude Code integration?"
  2. User confirms → run `npx -y @worktree-manager/mcp install`
  3. Set `mcp_installed: true`

**App Startup:**
- Start HTTP server on port 42819 (if not already running)
- Write `~/.config/worktree-manager/mcp.json` with server info:
  ```json
  {
    "version": "1.0.0",
    "http_port": 42819,
    "installed_at": "2026-04-07T00:00:00Z"
  }
  ```

### 5.4 Uninstallation

**Command:** `npx -y @worktree-manager/mcp uninstall`

- Remove entry from `~/.claude.json`
- Set `mcp_installed: false` in Tauri app config
- Does NOT remove the npm package (user can reinstall)

---

## 6. HTTP API (MCP ↔ Tauri)

### 6.1 Endpoint Base

```
http://localhost:42819/api/
```

### 6.2 Auth

- No auth required for localhost
- Tauri app validates via process ownership (desktop mode only)

### 6.3 Endpoints Used by MCP

| Method | Endpoint | Maps to Tauri Command |
|--------|----------|---------------------|
| POST | `/api/list_workspaces` | `list_workspaces` |
| POST | `/api/get_current_workspace` | `get_current_workspace` |
| POST | `/api/list_worktrees` | `list_worktrees` |
| POST | `/api/get_main_workspace_status` | `get_main_workspace_status` |
| POST | `/api/get_branch_diff_stats` | `get_branch_diff_stats` |
| POST | `/api/get_changed_files` | `get_changed_files` |
| POST | `/api/switch_workspace` | `switch_workspace` |
| POST | `/api/create_worktree` | `create_worktree` |

### 6.4 Error Responses

```typescript
interface ErrorResponse {
  error: {
    code: number;      // HTTP status or MCP error code
    message: string;    // Human-readable error
    data?: unknown;    // Additional context
  }
}
```

---

## 7. Configuration Files

### 7.1 Global Config

**Path:** `~/.config/worktree-manager/global.json`

```typescript
interface GlobalConfig {
  workspaces: WorkspaceRef[];
  current_workspace?: string;
  mcp_installed?: boolean;       // New: MCP installation flag
  mcp_port?: number;             // New: Override default MCP port
}
```

### 7.2 MCP Config

**Path:** `~/.config/worktree-manager/mcp.json`

```typescript
interface McpConfig {
  version: string;
  http_port: number;
  installed_at: string;
  capability_level: 'core' | 'details' | 'advanced';
}
```

---

## 8. Error Handling

### 8.1 Transport Errors

| Scenario | Behavior |
|----------|----------|
| Tauri app not running | Fall back to config file polling |
| HTTP timeout (5s) | Retry 3x, then switch to config fallback |
| Invalid response | Log error, return MCP error response |

### 8.2 Tool Errors

| Scenario | MCP Error Code | Message |
|----------|---------------|---------|
| Workspace not found | -32602 | "No workspace selected. Use workspace_list first." |
| Worktree not found | -32602 | "Worktree '{name}' not found." |
| Git operation failed | -32603 | "Git operation failed: {details}" |
| Permission denied | -32603 | "Permission denied. Is the Tauri app running?" |

---

## 9. Security Considerations

1. **Localhost only** — HTTP server binds to 127.0.0.1 only
2. **No authentication** — Assumes localhost is trusted
3. **Process isolation** — MCP server is separate process from Tauri app
4. **Config file access** — Read-only access to global.json

---

## 10. Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create `@worktree-manager/mcp` npm package
- [ ] Implement MCP server with Layer 1 tools
- [ ] Add HTTP server to Tauri app (port 42819)
- [ ] Basic auto-install script

### Phase 2: Extended Tools
- [ ] Add Layer 2 tools (details)
- [ ] Implement config file fallback mode
- [ ] Progressive disclosure mechanism

### Phase 3: Advanced Operations
- [ ] Add Layer 3 tools (operations)
- [ ] Skills wrappers for complex workflows
- [ ] Full installation UX (dialogs, verification)

---

## 11. Open Questions

1. **Should MCP server auto-start when Tauri app starts?**
   - Pro: Seamless experience
   - Con: Resource usage even when not needed

2. **How to handle multiple Tauri windows?**
   - Each window has own workspace context
   - MCP should connect to window-specific context or use "main" window

3. **Browser mode support?**
   - When accessed via tunnel, MCP won't work (different machine)
   - Could expose MCP over WMS tunnel in future

---

## 12. References

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [MCP SDK (TypeScript)](https://github.com/modelcontextprotocol/typescript-sdk)
- [Worktree Manager Architecture](../ARCHITECTURE.md)
