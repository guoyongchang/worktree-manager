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

    list_projects: async (args) => {
      const worktreeName = args?.worktree_name as string | undefined;
      const result = (await transport.listWorktrees(false)) as {
        worktrees?: Array<{ name: string; projects?: Array<Record<string, unknown>> }>;
      };
      const worktrees = result?.worktrees ?? [];
      const filtered = worktreeName ? worktrees.filter((w) => w.name === worktreeName) : worktrees;
      const projects = filtered.flatMap((w) =>
        (w.projects ?? []).map((p) => ({
          worktree: w.name,
          name: p.name,
          path: p.path,
          current_branch: p.current_branch,
          base_branch: p.base_branch,
          test_branch: p.test_branch,
        }))
      );
      return textResult(projects);
    },

    get_branch_status: async (args) => {
      const projectPath = args?.project_path as string;
      const baseBranch = args?.base_branch as string;
      const testBranch = args?.test_branch as string | undefined;
      const fetchFirst = args?.fetch_first === true;
      if (!projectPath || !baseBranch) throw new Error('project_path and base_branch are required');
      if (fetchFirst) await transport.fetchProjectRemote(projectPath);
      const stats = await transport.getBranchDiffStats(projectPath, baseBranch, testBranch);
      return textResult(stats);
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
  {
    name: 'list_projects',
    description: 'List projects (and their current/base/test branches) in the current workspace, optionally filtered to a single worktree by name.',
    inputSchema: {
      type: 'object',
      properties: {
        worktree_name: { type: 'string', description: 'Optional: only list projects in this worktree' },
      },
    },
  },
  {
    name: 'get_branch_status',
    description: 'Get how far a project branch is ahead/behind base and ahead of test, plus changed-file count. Returns {ahead, behind, changed_files, unpushed_commits, ahead_of_test}. ahead/behind are vs origin/<base_branch>; data is from local refs (pass fetch_first:true to refresh first).',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string', description: 'Absolute path to the project directory' },
        base_branch: { type: 'string', description: 'Base branch to compare against' },
        test_branch: { type: 'string', description: 'Optional test branch for ahead_of_test' },
        fetch_first: { type: 'boolean', description: 'Fetch remote before computing (default false)' },
      },
      required: ['project_path', 'base_branch'],
    },
  },
];
