import type { McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '../transport/http.js';

export function registerAdvancedTools(
  server: McpServer,
  transport: Transport
): void {
  server.setRequestHandler(
    { method: 'tools/call' },
    async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      if (name === 'worktree_create') {
        const name = args?.name as string;
        const projects = args?.projects as Array<{ name: string; base_branch?: string }>;
        const folder_name = args?.folder_name as string | undefined;
        if (!name || !projects) {
          throw new Error('name and projects are required');
        }
        const result = await transport.createWorktree({ name, projects, folder_name });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'worktree_archive') {
        const name = args?.name as string;
        if (!name) {
          throw new Error('name is required');
        }
        const result = await transport.archiveWorktree(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'worktree_delete_archived') {
        const name = args?.name as string;
        if (!name) {
          throw new Error('name is required');
        }
        const result = await transport.deleteArchivedWorktree(name);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_commit') {
        const projectPath = args?.project_path as string;
        const message = args?.message as string;
        if (!projectPath || !message) {
          throw new Error('project_path and message are required');
        }
        const result = await transport.commitAll(projectPath, message);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_push') {
        const projectPath = args?.project_path as string;
        if (!projectPath) {
          throw new Error('project_path is required');
        }
        const result = await transport.pushToRemote(projectPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_switch_branch') {
        const projectPath = args?.project_path as string;
        const branchName = args?.branch_name as string;
        if (!projectPath || !branchName) {
          throw new Error('project_path and branch_name are required');
        }
        const result = await transport.switchBranch(projectPath, branchName);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      if (name === 'git_fetch') {
        const projectPath = args?.project_path as string;
        if (!projectPath) {
          throw new Error('project_path is required');
        }
        const result = await transport.fetchProjectRemote(projectPath);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      return null;
    }
  );
}

export const ADVANCED_TOOLS = [
  {
    name: 'worktree_create',
    description: 'Create a new worktree with specified projects',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Worktree/branch name' },
        folder_name: { type: 'string', description: 'Optional folder name (defaults to name)' },
        projects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              base_branch: { type: 'string' },
            },
          },
          description: 'Projects to include in worktree',
        },
      },
      required: ['name', 'projects'],
    },
  },
  {
    name: 'worktree_archive',
    description: 'Archive an existing worktree',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Worktree name to archive' },
      },
      required: ['name'],
    },
  },
  {
    name: 'worktree_delete_archived',
    description: 'Permanently delete an archived worktree',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Archived worktree name (with .archive suffix)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'git_commit',
    description: 'Stage all changes and commit with message',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['project_path', 'message'],
    },
  },
  {
    name: 'git_push',
    description: 'Push current branch to remote',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'git_switch_branch',
    description: 'Switch to a different branch',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        branch_name: { type: 'string' },
      },
      required: ['project_path', 'branch_name'],
    },
  },
  {
    name: 'git_fetch',
    description: 'Fetch from remote origin',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
      },
      required: ['project_path'],
    },
  },
];
