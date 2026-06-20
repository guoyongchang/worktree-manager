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
];
