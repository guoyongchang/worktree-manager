import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { BaseTransport } from '../transport/config.js';
import { type ToolHandler, textResult } from './shared.js';
import type { ActiveWorkspaceResult, WorkspaceRef } from '../types.js';

function withWorktreesDir(workspaces: WorkspaceRef[]): WorkspaceRef[] {
  return workspaces.map((workspace) => {
    try {
      const file = join(workspace.path, '.worktree-manager.json');
      if (!existsSync(file)) return { ...workspace, worktrees_dir: workspace.worktrees_dir || 'worktrees' };
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const dir = parsed && typeof parsed === 'object' && 'worktrees_dir' in parsed && typeof parsed.worktrees_dir === 'string' && parsed.worktrees_dir
        ? parsed.worktrees_dir
        : 'worktrees';
      return { ...workspace, worktrees_dir: dir };
    } catch {
      return { ...workspace, worktrees_dir: workspace.worktrees_dir || 'worktrees' };
    }
  });
}

function workspacesFrom(raw: unknown): WorkspaceRef[] {
  if (!raw || typeof raw !== 'object' || !('workspaces' in raw) || !Array.isArray(raw.workspaces)) return [];
  return raw.workspaces.filter((item): item is WorkspaceRef => !!item && typeof item === 'object' && 'path' in item && typeof item.path === 'string' && 'name' in item && typeof item.name === 'string');
}

function readWorktreeLocal(cwd: string): Record<string, unknown> | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  let dir = norm(cwd);
  for (let i = 0; i < 8; i += 1) {
    const file = join(dir, '.worktree.local.json');
    if (existsSync(file)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || !('path' in parsed) || typeof parsed.path !== 'string') return null;
        const openAtRoot = norm(cwd) === norm(parsed.path);
        const guidance = 'guidance' in parsed && typeof parsed.guidance === 'string'
          ? parsed.guidance
          : `请在 ${parsed.path} 打开 AI 工具，不要进入 projects/。`;
        return { ...parsed, open_at_root: openAtRoot, guidance: openAtRoot ? null : guidance };
      } catch {
        return null;
      }
    }
    const next = norm(join(dir, '..'));
    if (next === dir) break;
    dir = next;
  }
  return null;
}

// 纯函数：从 cwd 与工作区列表推导所属 workspace/worktree/project（最长前缀匹配）。
// 路径统一把反斜杠归一化为 '/' 再比较，避免 Windows 路径匹配失败。
export function deriveActiveWorkspace(
  cwd: string,
  workspaces: WorkspaceRef[]
): ActiveWorkspaceResult {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const inside = (child: string, parent: string) =>
    child === parent || child.startsWith(parent + '/');
  const normCwd = norm(cwd);
  let best: WorkspaceRef | null = null;
  let bestLen = -1;
  for (const w of workspaces) {
    const wp = norm(w.path);
    if (inside(normCwd, wp) && wp.length > bestLen) {
      best = w;
      bestLen = wp.length;
    }
  }
  if (!best) {
    return {
      workspace: null,
      worktree_name: null,
      project_name: null,
      recommended_cwd: null,
      open_at_root: false,
      guidance: null,
      matched_by: 'prefix',
    };
  }
  const root = norm(best.path);
  const rel = normCwd.slice(root.length).replace(/^\/+/, '');
  const segs = rel.split('/').filter(Boolean);
  const trees = norm(best.worktrees_dir || 'worktrees');
  const inWorktree = segs[0] === trees && segs.length >= 2;
  const worktree_name = inWorktree ? segs[1] : null;
  const recommended_cwd = inWorktree ? `${root}/${trees}/${worktree_name}` : root;
  const projectIdx = segs.indexOf('projects');
  const project_name = projectIdx >= 0 && segs.length > projectIdx + 1 ? segs[projectIdx + 1] : null;
  const open_at_root = normCwd === recommended_cwd;
  const guidance = open_at_root
    ? null
    : inWorktree
      ? `请在 ${recommended_cwd} 打开 AI 工具，不要进入 projects 或其他子目录。文档和 projects 平级。`
      : segs[0] === trees
        ? `请进入 ${root}/${trees}/<需求> 再打开 AI 工具，不要停在 worktree 列表目录。`
        : `请在 ${recommended_cwd} 打开 AI 工具，不要进入 projects 子目录。文档和 projects 平级。`;
  return {
    workspace: best,
    worktree_name,
    project_name,
    recommended_cwd,
    open_at_root,
    guidance,
    matched_by: 'prefix',
  };
}

export function buildCoreHandlers(transport: BaseTransport): Record<string, ToolHandler> {
  return {
    workspace_list: async () => textResult(await transport.listWorkspaces()),

    workspace_get_current: async () => textResult(await transport.getCurrentWorkspace()),

    worktree_list: async (args) =>
      textResult(await transport.listWorktrees(args?.include_archived === true)),

    worktree_get_status: async (args) => {
      const name = args?.name as string;
      if (!name) throw new Error('worktree name is required');
      return textResult(await transport.checkWorktreeStatus(name));
    },

    workspace_get_status: async () => textResult(await transport.getMainWorkspaceStatus()),

    get_active_workspace: async (args) => {
      const cwd = args?.cwd as string;
      if (!cwd) throw new Error('cwd is required');
      const local = readWorktreeLocal(cwd);
      if (local) return textResult(local);
      const raw = await transport.listWorkspaces();
      const listed = Array.isArray(raw) ? raw : workspacesFrom(raw);
      return textResult(deriveActiveWorkspace(cwd, withWorktreesDir(listed)));
    },
  };
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
  {
    name: 'get_active_workspace',
    description: 'Resolve the workspace and requirement worktree for cwd. Development happens at <workspace>/<worktrees_dir>/<name>, where docs sit beside projects. If open_at_root is false, ask the user to reopen the agent at recommended_cwd instead of a project subdirectory.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Absolute path of the current working directory' },
      },
      required: ['cwd'],
    },
  },
];
