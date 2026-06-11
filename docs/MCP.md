# MCP Integration — Worktree Manager

Enable AI assistants (Claude Code, Codex, Cursor) to interact with Worktree Manager through the Model Context Protocol (MCP).

## What is MCP?

[MCP](https://modelcontextprotocol.io) is an open protocol that enables AI assistants to connect with external tools and data sources. By implementing an MCP server, Worktree Manager becomes accessible to any MCP-compatible AI client.

## Installation

### Auto Install (Recommended)

```bash
npx -y @worktree-manager/mcp install
```

This command:
1. Installs the MCP server package
2. Configures Claude Code to use it automatically

### Manual Install

Add to your `~/.claude.json`:

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

## Usage

After installation, restart Claude Code or run:

```bash
claude mcp restart
```

The MCP server will automatically start when needed.

## Available Tools

### Layer 1 — Core (Always Available)

| Tool | Description |
|------|-------------|
| `workspace_list` | List all configured workspaces |
| `workspace_get_current` | Get the currently selected workspace |
| `worktree_list` | List all worktrees in current workspace |
| `worktree_get_status` | Get detailed status of a specific worktree |
| `workspace_get_status` | Get main workspace status |

### Layer 2 — Details (On Demand)

| Tool | Description |
|------|-------------|
| `project_get_branches` | Get list of branches for a project |
| `project_get_diff_stats` | Get diff statistics vs base branch |
| `project_get_changed_files` | List uncommitted files |

### Layer 3 — Advanced (Wrapped by Skills)

| Tool | Description |
|------|-------------|
| `worktree_create` | Create a new worktree |
| `worktree_archive` | Archive an existing worktree |
| `git_commit` | Stage and commit changes |
| `git_push` | Push to remote |

## Examples

### List all worktrees

```
List all worktrees in my current workspace
```

### Check worktree status

```
What's the status of my feature-xyz worktree?
```

### Create a new worktree

```
Create a new worktree called feature-abc with all projects
```

## How It Works

```
┌─────────────────────┐     MCP Protocol      ┌─────────────────────┐
│  Claude Code/Codex  │◄───────────────────►│  @worktree-manager  │
│  / Cursor            │     (stdio)         │       /mcp         │
└─────────────────────┘                      └────────┬────────────┘
                                                     │
                                            HTTP (localhost:42819)
                                                     │
                                                     ▼
                                            ┌─────────────────────┐
                                            │  Worktree Manager   │
                                            │  (Tauri Desktop)    │
                                            └─────────────────────┘
```

When the Worktree Manager desktop app is running, the MCP server connects via HTTP for real-time data. When the app is not running, it falls back to reading the config file.

## Requirements

- [Worktree Manager](https://github.com/your-repo/worktree-manager) desktop app
- Node.js 18+ (for running via npx)
- Claude Code, Codex, or any MCP-compatible AI assistant

## Troubleshooting

### "No transport available"

Ensure the Worktree Manager desktop app is running, or that `~/.config/worktree-manager/global.json` exists.

### Tools not responding

Try restarting the MCP server:

```bash
claude mcp stop worktree-manager
claude mcp start worktree-manager
```

## Uninstall

```bash
npx -y @worktree-manager/mcp uninstall
```

Or manually remove the `worktree-manager` entry from `~/.claude.json`.
