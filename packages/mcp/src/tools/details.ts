import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '../transport/http.js';

export function registerDetailsTools(
  server: Server,
  transport: Transport
): void {
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
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

      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
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
