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

## Capability Levels

The desktop app exposes two permissions. The MCP process reads `capability_level` from `~/.config/worktree-manager/mcp.json`.

| Level | What's available | Requires |
|-------|-----------------|----------|
| `read` | Workspace, worktree, branch, and diff reads | Desktop app for branch/diff tools |
| `operate` | Everything in `read`, plus create, commit, merge, and other writes | Desktop app. Archive, restore, and delete wait for the desktop confirmation dialog |

Older configs may still say `core`, `details`, or `advanced`. Those are read as `read`, `read`, and `operate`.

### Changing the Capability Level

**Option A — Edit the config file directly:**

```json
// ~/.config/worktree-manager/mcp.json
{
  "capability_level": "operate",
  "http_port": 42819
}
```

Valid values: `"read"`, `"operate"`. The server reads this file on startup; restart the MCP server after editing. `http_port` defaults to `42819` and can be changed in the desktop app. The MCP process uses the saved port and does not reset it on startup.

**Option B — Via the Worktree Manager desktop app:**

Use the MCP settings page, or call the REST endpoint while the app is running:

```bash
curl -X POST http://127.0.0.1:42819/api/mcp/set_capability \
  -H 'Content-Type: application/json' \
  -d '{"capability_level": "operate"}'
```

> The capability setting is **preserved** across desktop app restarts and MCP server reinstalls — it is never silently reset.

## Available Tools

### Layer 1 — Core (Always Available)

Available with any transport (stdio fallback or HTTP). No special configuration needed.

| Tool | Description |
|------|-------------|
| `workspace_list` | List all configured workspaces |
| `workspace_get_current` | Get the currently selected workspace |
| `worktree_list` | List all worktrees in current workspace |
| `worktree_get_status` | Get detailed status of a specific worktree |
| `workspace_get_status` | Get main workspace status |
| `get_active_workspace` | Resolve which workspace/worktree/project the current directory belongs to |

#### `get_active_workspace` — Usage Notes

The caller **must** pass the current absolute working directory as `cwd`. The server has no session context and cannot infer it automatically.

```json
{ "cwd": "/Users/you/work/my-workspace/worktrees/feature-42/projects/api" }
```

Returns:
```json
{
  "workspace": { "name": "my-workspace", "path": "/Users/you/work/my-workspace" },
  "worktree_name": "feature-42",
  "project_name": "api",
  "matched_by": "prefix"
}
```

Returns `null` fields when the directory is not inside any configured workspace.

---

### Layer 2 — Details (Requires HTTP Transport)

Requires the Worktree Manager desktop app to be running (`capability_level` = `read` or `operate`).

| Tool | Description |
|------|-------------|
| `project_get_branches` | List remote branches for a project |
| `project_get_diff_stats` | Get diff statistics vs base branch |
| `project_get_changed_files` | List uncommitted files in a project |
| `list_projects` | List projects (with branch info) across all worktrees, optionally filtered by worktree name |
| `get_branch_status` | Get ahead/behind/changed-file count for a project branch |

#### `get_branch_status` — Return Shape

```json
{
  "ahead": 3,
  "behind": 0,
  "changed_files": 1,
  "unpushed_commits": 3,
  "ahead_of_test": 2
}
```

- `ahead` / `behind`: commits relative to `origin/<base_branch>`
- `ahead_of_test`: commits ahead of the test branch (requires `test_branch` parameter)
- `changed_files`: uncommitted working-tree changes
- Data is computed from **local git references** — pass `fetch_first: true` to refresh from remote first

```json
{
  "project_path": "/abs/path/to/project",
  "base_branch": "main",
  "test_branch": "test",
  "fetch_first": true
}
```

---

### Layer 3 — Operate (Requires HTTP Transport + `capability_level: operate`)

Write tools that can trigger destructive git operations. See the [Trust Boundary](#trust-boundary) section below before enabling.

| Tool | Description |
|------|-------------|
| `worktree_create` | Create a new worktree with specified projects |
| `worktree_archive` | Archive an existing worktree |
| `worktree_delete_archived` | Permanently delete an archived worktree |
| `git_commit` | Stage all changes and commit with a message |
| `git_push` | Push current branch to remote |
| `git_switch_branch` | Switch to a different branch |
| `git_fetch` | Fetch from remote origin |
| `sync_base` | Sync the latest base branch into the current branch (fetch + merge) |
| `pull` | `git pull` the current branch from origin (fetch + merge; unlike `git_fetch`, which only downloads refs) |
| `commit_and_push` | Stage, commit, then push in one step (non-atomic — see note) |
| `merge_to_test` | Merge current branch into the test branch (guarded by threshold + unverifiable-diff check) |
| `merge_to_base` | Merge current branch into the base branch (guarded by threshold + unverifiable-diff check) |

#### `commit_and_push` — Non-Atomic Behavior

If the commit succeeds but the push fails, the tool returns `isError: true` with a "committed but not pushed" message. The commit is **not** rolled back. You can then call `git_push` separately.

---

## Merge Threshold Gate

`merge_to_test` and `merge_to_base` include a safety gate to prevent accidental large merges.

### Default Thresholds

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_ahead` | `50` | Maximum commits ahead of the target branch allowed |
| `require_clean_worktree` | `true` | Block merge if there are uncommitted changes |
| `force` | `false` | Bypass all threshold checks when set to `true` |

### Per-Call Override

Thresholds are **not** persisted — pass them as arguments each time:

```json
{
  "project_path": "/abs/path/to/project",
  "base_branch": "main",
  "test_branch": "test",
  "max_ahead": 100,
  "require_clean_worktree": false
}
```

### Measurement

- `merge_to_test`: the `ahead_of_test` field from `get_branch_status` is used as the "ahead" count
- `merge_to_base`: the `ahead` field (commits ahead of `origin/<base_branch>`) is used

### Unverifiable-Diff Guard (fail-closed)

The backend returns all diff stats as `0` both when there is genuinely no diff **and** when it cannot compute one (e.g. the target/base ref was never fetched) — the two cases are indistinguishable. To avoid merging blindly, the gate **blocks** when every stat is `0` and no fetch was performed in the same call. Pass `fetch_first: true` to refresh refs first (recommended), or `force: true` to override.

### Bypassing the Gate

Pass `force: true` to skip all checks:

```json
{ "project_path": "...", "base_branch": "main", "test_branch": "test", "force": true }
```

> Note: The threshold gate is enforced in the MCP layer only. Calling the backend REST API directly bypasses it.

---

## Trust Boundary

> **Warning: No token authentication on the backend port.**

The MCP data backend runs at `127.0.0.1:42819` and is **bound to localhost with no token authentication**. Any process running on your machine can call it directly.

**Trust boundary = all local processes on your machine.**

This is an intentional design choice for local developer tooling. The practical implications:

- `read`: low risk — read-only data, no state changes
- `operate`: can trigger git commits, pushes, branch switches, and merges

**Only set `capability_level: operate` in trusted, single-user local environments.** Do not expose the MCP port to a network or run with operate permission on shared machines.

---

## How It Works

```
Claude Code/Codex ←→ MCP Protocol ←→ @worktree-manager/mcp ←→ Worktree Manager App
                        (HTTP: port registered in mcp.json, default 42819)
```

When Worktree Manager desktop app is running → real-time data via HTTP (read + operate tools available).
When app is not running → reads from config file fallback (read-only core tools, no write tools).

The MCP process reads the registered port from `~/.config/worktree-manager/mcp.json`; if that port is not answering, it scans `42800-42900` and connects to the app it finds. If the app has to move ports, it registers the new one.

### Versioning

The published package version follows the desktop release timestamp: `1.<YYYYMMDD>.<HHMMSS>`. The app itself is versioned `0.<YYYYMMDD>.<HHMMSS>`, so the package keeps its own `1.x` line instead of inheriting the app's `0.x`.

A release publishes this package only when `packages/mcp` changed since the previous release tag. If a publish run fails for infrastructure reasons, later runs will skip it; re-run the release workflow with the `force_mcp` input set to `true` to publish anyway.

### Confirmations

`worktree_archive`, `worktree_restore`, and `worktree_delete_archived` are gated by the desktop app. The tool call blocks until the user confirms in a dialog and fails on cancel or timeout. They cannot be executed without the desktop app running.

---

## Requirements

- Worktree Manager desktop app
- Node.js 18+
- Claude Code or any MCP-compatible AI assistant

## License

MIT
