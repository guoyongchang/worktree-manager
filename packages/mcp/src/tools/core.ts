import type { BaseTransport } from '../transport/config.js';
import { type ToolHandler, textResult } from './shared.js';

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
      const wsResult = (await transport.listWorkspaces()) as { workspaces?: Array<{ name: string; path: string }> };
      const workspaces = wsResult?.workspaces ?? [];
      const norm = (p: string) => p.replace(/\/+$/, '');
      const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + '/');
      let best: { name: string; path: string } | null = null;
      for (const w of workspaces) {
        const wp = norm(w.path);
        if (inside(cwd, wp) && (!best || wp.length > norm(best.path).length)) best = w;
      }
      if (!best) {
        return textResult({ workspace: null, worktree_name: null, project_name: null, matched_by: 'prefix' });
      }
      const rel = cwd.slice(norm(best.path).length).replace(/^\/+/, '');
      const segs = rel.split('/').filter(Boolean);
      const pjIdx = segs.indexOf('projects');
      const project_name = pjIdx >= 0 && segs.length > pjIdx + 1 ? segs[pjIdx + 1] : null;
      // 结构 <ws>/<worktrees_dir>/<worktree>/projects/<project> → worktree = projects 前一段；主工作区 <ws>/projects/... 无 worktree
      const worktree_name = pjIdx >= 2 ? segs[pjIdx - 1] : null;
      return textResult({ workspace: best, worktree_name, project_name, matched_by: 'prefix' });
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
    description: 'Resolve which workspace (and worktree/project, if any) a given absolute directory belongs to, by longest-prefix match against configured workspace paths. Pass the current shell working directory as cwd.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Absolute path of the current working directory' },
      },
      required: ['cwd'],
    },
  },
];
