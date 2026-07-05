import type { Transport } from '../transport/http.js';
import { type ToolHandler, textResult, errorResult } from './shared.js';
import { evaluateMergeGate, evaluateDiffCertainty, gateOptsFromArgs } from './safety.js';
import type { BranchDiffStats } from '../types.js';

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

    sync_base: async (args) => {
      const projectPath = args?.project_path as string;
      const baseBranch = args?.base_branch as string;
      if (!projectPath || !baseBranch) throw new Error('project_path and base_branch are required');
      return textResult(await transport.syncWithBase(projectPath, baseBranch));
    },

    pull: async (args) => {
      const projectPath = args?.project_path as string;
      if (!projectPath) throw new Error('project_path is required');
      return textResult(await transport.pullCurrentBranch(projectPath));
    },

    commit_and_push: async (args) => {
      const projectPath = args?.project_path as string;
      const message = args?.message as string;
      if (!projectPath || !message) throw new Error('project_path and message are required');
      const authorName = args?.author_name as string | undefined;
      const authorEmail = args?.author_email as string | undefined;
      const skipHooks = typeof args?.skip_hooks === 'boolean' ? (args.skip_hooks as boolean) : undefined;
      const committed = await transport.commitAll(projectPath, message, authorName, authorEmail, skipHooks);
      try {
        const pushed = await transport.pushToRemote(projectPath);
        return textResult({ committed, pushed });
      } catch (e) {
        return errorResult(
          `已提交但推送失败（需手动 push）。\ncommit: ${JSON.stringify(committed)}\npush error: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    },

    merge_to_test: async (args) => {
      const projectPath = args?.project_path as string;
      const baseBranch = args?.base_branch as string;
      const testBranch = args?.test_branch as string;
      if (!projectPath || !baseBranch || !testBranch) {
        throw new Error('project_path, base_branch and test_branch are required');
      }
      const fetchFirst = args?.fetch_first === true;
      const force = args?.force === true;
      if (fetchFirst) await transport.fetchProjectRemote(projectPath);
      const stats = (await transport.getBranchDiffStats(projectPath, baseBranch, testBranch)) as BranchDiffStats;
      // fail-closed：diff 全 0 且未 fetch 时视为「算不出」，拒绝而非放行
      const certainty = evaluateDiffCertainty(stats, { fetched: fetchFirst, force });
      if (!certainty.allow) return errorResult(`合并到 test 被拦截：${certainty.reason}`);
      const gate = evaluateMergeGate(
        { ahead: stats.ahead_of_test, changed_files: stats.changed_files },
        gateOptsFromArgs(args)
      );
      if (!gate.allow) return errorResult(`合并到 test 被拦截：${gate.reason}`);
      return textResult(await transport.mergeToTest(projectPath, testBranch));
    },

    merge_to_base: async (args) => {
      const projectPath = args?.project_path as string;
      const baseBranch = args?.base_branch as string;
      if (!projectPath || !baseBranch) throw new Error('project_path and base_branch are required');
      const fetchFirst = args?.fetch_first === true;
      const force = args?.force === true;
      if (fetchFirst) await transport.fetchProjectRemote(projectPath);
      const stats = (await transport.getBranchDiffStats(projectPath, baseBranch)) as BranchDiffStats;
      // fail-closed：diff 全 0 且未 fetch 时视为「算不出」，拒绝而非放行
      const certainty = evaluateDiffCertainty(stats, { fetched: fetchFirst, force });
      if (!certainty.allow) return errorResult(`合并到 base 被拦截：${certainty.reason}`);
      const gate = evaluateMergeGate(
        { ahead: stats.ahead, changed_files: stats.changed_files },
        gateOptsFromArgs(args)
      );
      if (!gate.allow) return errorResult(`合并到 base 被拦截：${gate.reason}`);
      return textResult(await transport.mergeToBase(projectPath, baseBranch));
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
  {
    name: 'sync_base',
    description: 'Sync the latest base branch into the current branch (fetch origin/base + merge). Requires advanced capability.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        base_branch: { type: 'string' },
      },
      required: ['project_path', 'base_branch'],
    },
  },
  {
    name: 'pull',
    description: 'git pull the current branch from origin (fetch + merge into working branch). Unlike git_fetch (which only downloads refs without touching the working tree), this updates the checked-out branch. To push, use git_push. Requires advanced capability.',
    inputSchema: {
      type: 'object',
      properties: { project_path: { type: 'string' } },
      required: ['project_path'],
    },
  },
  {
    name: 'commit_and_push',
    description: 'Stage all changes, commit with message, then push. Non-atomic: if commit succeeds but push fails, returns isError with a "committed but not pushed" message. Requires advanced capability.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        message: { type: 'string' },
        author_name: { type: 'string' },
        author_email: { type: 'string' },
        skip_hooks: { type: 'boolean' },
      },
      required: ['project_path', 'message'],
    },
  },
  {
    name: 'merge_to_test',
    description: 'Merge the current branch into the test branch, guarded by a "not too many commits" threshold. Blocks if ahead_of_test > max_ahead (default 50) or worktree is dirty. Also blocks (fail-closed) when all diff stats are 0 and no fetch was done, since the backend cannot tell "no diff" from "could not compute" (e.g. test ref not fetched) — pass fetch_first:true. All guards bypassable with force:true. Requires advanced capability.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        base_branch: { type: 'string', description: 'Needed to compute ahead/behind stats' },
        test_branch: { type: 'string' },
        max_ahead: { type: 'number', description: 'Max commits ahead of test allowed (default 50)' },
        require_clean_worktree: { type: 'boolean', description: 'Block if uncommitted changes (default true)' },
        fetch_first: { type: 'boolean', description: 'Fetch remote before computing diff. Recommended: without it, if the test ref is stale/unfetched all diff stats read 0 and the merge is blocked as "unverifiable"' },
        force: { type: 'boolean', description: 'Bypass all guards (threshold + unverifiable-diff check)' },
      },
      required: ['project_path', 'base_branch', 'test_branch'],
    },
  },
  {
    name: 'merge_to_base',
    description: 'Merge the current branch into the base branch, guarded by a "not too many commits" threshold. Blocks if ahead (of base) > max_ahead (default 50) or worktree is dirty. Also blocks (fail-closed) when all diff stats are 0 and no fetch was done, since the backend cannot tell "no diff" from "could not compute" (e.g. base ref not fetched) — pass fetch_first:true. All guards bypassable with force:true. Requires advanced capability.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        base_branch: { type: 'string' },
        max_ahead: { type: 'number', description: 'Max commits ahead of base allowed (default 50)' },
        require_clean_worktree: { type: 'boolean', description: 'Block if uncommitted changes (default true)' },
        fetch_first: { type: 'boolean', description: 'Fetch remote before computing diff. Recommended: without it, if the base ref is stale/unfetched all diff stats read 0 and the merge is blocked as "unverifiable"' },
        force: { type: 'boolean', description: 'Bypass all guards (threshold + unverifiable-diff check)' },
      },
      required: ['project_path', 'base_branch'],
    },
  },
];
