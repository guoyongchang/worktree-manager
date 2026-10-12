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
      const certainty = evaluateDiffCertainty(stats, { fetched: fetchFirst, force });
      if (!certainty.allow) return errorResult(`合并到 base 被拦截：${certainty.reason}`);
      const gate = evaluateMergeGate(
        { ahead: stats.ahead, changed_files: stats.changed_files },
        gateOptsFromArgs(args)
      );
      if (!gate.allow) return errorResult(`合并到 base 被拦截：${gate.reason}`);
      await transport.requestConfirm('合并到基线', `将把 ${projectPath} 的当前分支合并到 ${baseBranch}。`);
      return textResult(await transport.mergeToBase(projectPath, baseBranch));
    },

    merge_to_uat: async (args) => {
      const projectPath = args?.project_path as string;
      const uatBranch = (args?.uat_branch as string) || 'uat';
      if (!projectPath) throw new Error('project_path is required');
      const fetchFirst = args?.fetch_first === true;
      if (fetchFirst) await transport.fetchProjectRemote(projectPath);
      await transport.requestConfirm('合并到 UAT', `将把 ${projectPath} 的当前分支合并到 ${uatBranch}。`);
      return textResult(await transport.mergeToBase(projectPath, uatBranch));
    },

    workspace_create: async (args) => {
      const name = args?.name as string;
      const path = args?.path as string;
      if (!name || !path) throw new Error('name and path are required');
      return textResult(await transport.createWorkspace(name, path));
    },

    workspace_remove: async (args) => {
      const path = args?.path as string;
      if (!path) throw new Error('path is required');
      await transport.requestConfirm('移除工作区', `将从应用中移除工作区 ${path}。这不删除磁盘上的仓库。`);
      return textResult(await transport.removeWorkspace(path));
    },

    worktree_restore: async (args) => {
      const name = args?.name as string;
      if (!name) throw new Error('name is required');
      return textResult(await transport.restoreWorktree(name));
    },

    deploy_to_main: async (args) => {
      const name = args?.worktree_name as string;
      if (!name) throw new Error('worktree_name is required');
      await transport.requestConfirm('部署到主工作区', `将把需求工作区 ${name} 部署到主工作区。`);
      return textResult(await transport.deployToMain(name));
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
    description: '归档需求工作区。后端会弹出桌面确认框，用户确认前不会执行。工具不能直接完成。',
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
    description: '永久删除已归档工作区。后端会弹出桌面确认框，用户确认前不会执行。工具不能直接完成。',
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
    description: '同步项目：把基线分支 fetch 后合并进当前分支。对应页面上的同步按钮。',
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
    description: '拉取当前分支：git pull origin 当前分支。对应页面上的拉取按钮。',
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
    description: '合并到 test。有提交数量和干净工作区护栏。对应页面上的合并到 test。',
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
    description: '合并到基线分支。会先在桌面端弹窗，等用户确认后才执行。',
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
  {
    name: 'merge_to_uat',
    description: '合并到 UAT。默认目标分支 uat，可用 uat_branch 覆盖。会先在桌面端弹窗，等用户确认后才执行。',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        uat_branch: { type: 'string', description: '默认 uat' },
        fetch_first: { type: 'boolean' },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'workspace_create',
    description: '新建工作区。对应页面上的新建工作区。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        path: { type: 'string', description: '工作区根目录绝对路径' },
      },
      required: ['name', 'path'],
    },
  },
  {
    name: 'workspace_remove',
    description: '从应用移除工作区，不删除磁盘文件。会先在桌面端弹窗，等用户确认后才执行。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'worktree_restore',
    description: '恢复已归档的需求工作区。后端会弹出桌面确认框，用户确认前不会执行。工具不能直接完成。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'deploy_to_main',
    description: '把需求工作区部署到主工作区。会先在桌面端弹窗，等用户确认后才执行。',
    inputSchema: {
      type: 'object',
      properties: { worktree_name: { type: 'string' } },
      required: ['worktree_name'],
    },
  },
];
