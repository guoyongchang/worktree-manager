# @worktree-manager/mcp

MCP server for Worktree Manager — enables AI assistants (Claude Code, Codex, Cursor) to query workspace state and perform operations.

## What is This?

This MCP server lets AI coding assistants understand and interact with your Git worktrees managed by Worktree Manager. Ask questions like:

- "What worktrees do I have?"
- "What's the status of my feature-xyz worktree?"
- "Create a new worktree for my next feature"

## Installation

```bash
npx -y @worktree-manager/mcp install
```

This auto-configures Claude Code. Restart Claude Code or run `claude mcp restart`.

## Usage

```bash
# Start MCP server manually
npx -y @worktree-manager/mcp start

# Install to Claude Code (auto-configures ~/.claude.json)
npx -y @worktree-manager/mcp install

# Uninstall from Claude Code
npx -y @worktree-manager/mcp uninstall
```

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

## How It Works

```
Claude Code/Codex ←→ MCP Protocol ←→ @worktree-manager/mcp ←→ Worktree Manager App
                              (HTTP:42819)
```

When Worktree Manager desktop app is running → real-time data via HTTP.
When app is not running → reads from config file fallback.

## Requirements

- Worktree Manager desktop app
- Node.js 18+
- Claude Code or any MCP-compatible AI assistant

## License

MIT
