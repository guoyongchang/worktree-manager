import type { Transport } from '../transport/http.js';
import { type ToolHandler, textResult } from './shared.js';

export function buildAdvancedHandlers(transport: Transport): Record<string, ToolHandler> {
  return {
    worktree_create: async (args) => {
      const name = args?.name as string;
      const projects = args?.projects as Array<{ name: string; base_branch?: string }>;
      const folder_name = args?.folder_name as string | undefined;
      if (!name || !projects) throw new Error('name and projects are required');
      return textResult(await transport.createWorktree({ name, projects, folder_name }));
    },

    worktree_archive: async (args) => {
      const name = args?.name as string;
      if (!name) throw new Error('name is required');
      return textResult(await transport.archiveWorktree(name));
    },

    worktree_delete_archived: async (args) => {
      const name = args?.name as string;
      if (!name) throw new Error('name is required');
      return textResult(await transport.deleteArchivedWorktree(name));
    },

    git_commit: async (args) => {
      const projectPath = args?.project_path as string;
      const message = args?.message as string;
      if (!projectPath || !message) throw new Error('project_path and message are required');
      return textResult(await transport.commitAll(projectPath, message));
    },

    git_push: async (args) => {
      const projectPath = args?.project_path as string;
      if (!projectPath) throw new Error('project_path is required');
      return textResult(await transport.pushToRemote(projectPath));
    },

    git_switch_branch: async (args) => {
      const projectPath = args?.project_path as string;
      const branchName = args?.branch_name as string;
      if (!projectPath || !branchName) throw new Error('project_path and branch_name are required');
      return textResult(await transport.switchBranch(projectPath, branchName));
    },

    git_fetch: async (args) => {
      const projectPath = args?.project_path as string;
      if (!projectPath) throw new Error('project_path is required');
      return textResult(await transport.fetchProjectRemote(projectPath));
    },
  };
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
