import type { Transport } from '../transport/http.js';
import { type ToolHandler, textResult } from './shared.js';

export function buildDetailsHandlers(transport: Transport): Record<string, ToolHandler> {
  return {
    project_get_branches: async (args) => {
      const projectPath = args?.project_path as string;
      if (!projectPath) throw new Error('project_path is required');
      return textResult(await transport.getRemoteBranches(projectPath));
    },

    project_get_diff_stats: async (args) => {
      const projectPath = args?.project_path as string;
      const baseBranch = args?.base_branch as string;
      if (!projectPath || !baseBranch) throw new Error('project_path and base_branch are required');
      return textResult(await transport.getBranchDiffStats(projectPath, baseBranch));
    },

    project_get_changed_files: async (args) => {
      const projectPath = args?.project_path as string;
      if (!projectPath) throw new Error('project_path is required');
      return textResult(await transport.getChangedFiles(projectPath));
    },
  };
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
