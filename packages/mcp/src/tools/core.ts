import type { BaseTransport } from '../transport/config.js';
import { type ToolHandler, textResult } from './shared.js';
import type { ActiveWorkspaceResult, WorkspaceRef } from '../types.js';

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
    return { workspace: null, worktree_name: null, project_name: null, matched_by: 'prefix' };
  }
  const rel = normCwd.slice(bestLen).replace(/^\/+/, '');
  const segs = rel.split('/').filter(Boolean);
  const pjIdx = segs.indexOf('projects');
  const project_name = pjIdx >= 0 && segs.length > pjIdx + 1 ? segs[pjIdx + 1] : null;
  // 结构 <ws>/<worktrees_dir>/<worktree>/projects/<project> → worktree = projects 前一段；
  // 主工作区 <ws>/projects/... 无 worktree（list_workspaces 不返回 worktrees_dir，按单层处理）。
  const worktree_name = pjIdx >= 2 ? segs[pjIdx - 1] : null;
  return { workspace: best, worktree_name, project_name, matched_by: 'prefix' };
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
      // HTTP 模式返回裸数组，ConfigTransport 返回 {workspaces:[...]}，两种形状都要兼容
      const raw = await transport.listWorkspaces();
      const workspaces: WorkspaceRef[] = Array.isArray(raw)
        ? (raw as WorkspaceRef[])
        : ((raw as { workspaces?: WorkspaceRef[] })?.workspaces ?? []);
      return textResult(deriveActiveWorkspace(cwd, workspaces));
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
