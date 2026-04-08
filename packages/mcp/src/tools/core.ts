import type { McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '../transport/http.js';

export function registerCoreTools(server: McpServer, transport: Transport): void {
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
