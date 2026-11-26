import type { Transport } from '../transport/http.js';
import { type ToolHandler, textResult, errorResult, extractErrorMessage } from './shared.js';
import {
  evaluateMergeGate,
  evaluateDiffCertainty,
  gateOptsFromArgs,
  validateMergeSourceBranch,
} from './safety.js';
import type { BranchDiffStats } from '../types.js';

interface MatchedProjectStatus {
  name?: string;
  path: string;
  current_branch?: string;
  base_branch?: string;
  test_branch?: string;
  has_uncommitted?: boolean;
  uncommitted_count?: number;
}

function normalizePathForMatch(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function isMatchedProject(item: unknown): item is MatchedProjectStatus {
  return (
    typeof item === 'object' &&
    item !== null &&
    'path' in item &&
    typeof item.path === 'string'
  );
}

function extractProjectsFromWorktree(item: unknown): MatchedProjectStatus[] {
  if (typeof item !== 'object' || item === null || !('projects' in item) || !Array.isArray(item.projects)) {
    return [];
  }
  return item.projects.filter(isMatchedProject);
}

function extractWorktreeList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && 'worktrees' in raw && Array.isArray(raw.worktrees)) {
    return raw.worktrees;
  }
  return [];
}

async function resolveProjectStatus(
  transport: Transport,
  projectPath: string
): Promise<{ project: MatchedProjectStatus | null; lookupError?: string }> {
  const target = normalizePathForMatch(projectPath);
  const candidates: MatchedProjectStatus[] = [];
  const errors: string[] = [];

  try {
    const raw = await transport.listWorktrees(false);
    for (const wt of extractWorktreeList(raw)) {
      candidates.push(...extractProjectsFromWorktree(wt));
    }
  } catch (e) {
    errors.push(extractErrorMessage(e));
  }

  try {
    const mainStatus = await transport.getMainWorkspaceStatus();
    candidates.push(...extractProjectsFromWorktree(mainStatus));
  } catch (e) {
    errors.push(extractErrorMessage(e));
  }

  const matched = candidates.find((p) => normalizePathForMatch(p.path) === target) ?? null;
  if (!matched && candidates.length === 0 && errors.length > 0) {
    return { project: null, lookupError: errors[0] };
  }
  return { project: matched };
}

interface PrepareMergeOk {
  ok: true;
  currentBranch: string | null;
  syncBaseBranch: string;
  syncResult: unknown;
  stats: BranchDiffStats;
}

async function prepareMerge(
  transport: Transport,
  params: {
    label: string;
    projectPath: string;
    syncBaseBranch?: string;
    fallbackSyncBase?: string;
    targetBranch: string;
    diffBaseBranch?: string;
    diffTestBranch?: string;
    needRemoteFetchAfterSync: boolean;
    args: Record<string, unknown>;
  }
): Promise<PrepareMergeOk | { ok: false; error: string }> {
  const opts = gateOptsFromArgs(params.args);

  // 1. 分支检查：从当前工作区解析项目实时状态并校验源分支
  const { project, lookupError } = await resolveProjectStatus(transport, params.projectPath);
  if (!project && !opts.force) {
    const detail = lookupError ? `（查询失败：${lookupError}）` : '';
    return {
      ok: false,
      error: `合并到 ${params.label} 被拦截：无法在当前工作区找到项目路径「${params.projectPath}」，无法确认当前分支${detail}。请先确认工作区（workspace_get_current / workspace_switch）或路径是否正确（确属预期可传 force:true 跳过）`,
    };
  }

  const currentBranch = project?.current_branch ?? null;
  if (project) {
    const branchCheck = validateMergeSourceBranch(currentBranch, params.targetBranch, [
      project.base_branch,
      project.test_branch,
      params.syncBaseBranch,
      params.diffTestBranch,
    ]);
    if (!branchCheck.allow) {
      return { ok: false, error: `合并到 ${params.label} 被拦截：${branchCheck.reason}` };
    }
  }

  // 2. 同步 base 前先拦截未提交改动，避免 git merge origin/<base> 与脏工作区冲突
  if (
    opts.require_clean_worktree &&
    !opts.force &&
    (project?.has_uncommitted || (project?.uncommitted_count ?? 0) > 0)
  ) {
    const count = project?.uncommitted_count ?? 0;
    const countText = count > 0 ? `${count} 个` : '';
    return {
      ok: false,
      error: `合并到 ${params.label} 被拦截：工作区有 ${countText}未提交变更，合并前同步 base 要求干净工作区，请先提交或 stash（确属预期可传 force:true 跳过）`,
    };
  }

  // 3. 合并前先同步 base 分支
  const syncBaseBranch = (
    params.syncBaseBranch ||
    project?.base_branch ||
    params.fallbackSyncBase ||
    ''
  ).trim();
  if (!syncBaseBranch) {
    return {
      ok: false,
      error: `合并到 ${params.label} 被拦截：缺少 base_branch，无法在合并前执行同步 base`,
    };
  }

  let syncResult: unknown;
  try {
    syncResult = await transport.syncWithBase(params.projectPath, syncBaseBranch);
  } catch (e) {
    return {
      ok: false,
      error: `合并到 ${params.label} 已中止：合并前同步基线分支「${syncBaseBranch}」失败（请先解决冲突或检查网络）：${extractErrorMessage(e)}`,
    };
  }

  // 4. 若目标分支不同于刚同步的 base（如 test，或项目 base 非 uat 时合并到 uat），再 fetch 刷新目标远端 ref
  if (params.needRemoteFetchAfterSync || syncBaseBranch !== params.targetBranch) {
    await transport.fetchProjectRemote(params.projectPath);
  }

  // 5. diff 确定性 + 提交量/工作区护栏
  const diffBaseBranch = (params.diffBaseBranch || syncBaseBranch).trim();
  const stats = (await transport.getBranchDiffStats(
    params.projectPath,
    diffBaseBranch,
    params.diffTestBranch
  )) as BranchDiffStats;
  const certainty = evaluateDiffCertainty(stats, { fetched: true, force: opts.force });
  if (!certainty.allow) {
    return { ok: false, error: `合并到 ${params.label} 被拦截：${certainty.reason}` };
  }
  const ahead = params.diffTestBranch ? stats.ahead_of_test : stats.ahead;
  const gate = evaluateMergeGate({ ahead, changed_files: stats.changed_files }, opts);
  if (!gate.allow) {
    return { ok: false, error: `合并到 ${params.label} 被拦截：${gate.reason}` };
  }

  return { ok: true, currentBranch, syncBaseBranch, syncResult, stats };
}

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
          `已提交但推送失败（需手动 push）。\ncommit: ${JSON.stringify(committed)}\npush error: ${extractErrorMessage(e)}`
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
      const prep = await prepareMerge(transport, {
        label: 'test',
        projectPath,
        syncBaseBranch: baseBranch,
        targetBranch: testBranch,
        diffBaseBranch: baseBranch,
        diffTestBranch: testBranch,
        needRemoteFetchAfterSync: true,
        args,
      });
      if (!prep.ok) return errorResult(prep.error);
      const mergeResult = await transport.mergeToTest(projectPath, testBranch);
      return textResult({
        checked_branch: prep.currentBranch,
        synced_base: prep.syncBaseBranch,
        sync_result: prep.syncResult,
        merge_result: mergeResult,
      });
    },

    merge_to_base: async (args) => {
      const projectPath = args?.project_path as string;
      const baseBranch = args?.base_branch as string;
      if (!projectPath || !baseBranch) throw new Error('project_path and base_branch are required');
      const prep = await prepareMerge(transport, {
        label: baseBranch,
        projectPath,
        syncBaseBranch: baseBranch,
        targetBranch: baseBranch,
        diffBaseBranch: baseBranch,
        needRemoteFetchAfterSync: false,
        args,
      });
      if (!prep.ok) return errorResult(prep.error);
      // 桌面端确认框由服务端 /api/merge_to_base_branch 统一弹出
      const mergeResult = await transport.mergeToBase(projectPath, baseBranch);
      return textResult({
        checked_branch: prep.currentBranch,
        synced_base: prep.syncBaseBranch,
        sync_result: prep.syncResult,
        merge_result: mergeResult,
      });
    },

    merge_to_uat: async (args) => {
      const projectPath = args?.project_path as string;
      const uatBranch = ((args?.uat_branch as string) || 'uat').trim();
      const baseBranch = (args?.base_branch as string | undefined)?.trim();
      if (!projectPath) throw new Error('project_path is required');
      const prep = await prepareMerge(transport, {
        label: 'UAT',
        projectPath,
        syncBaseBranch: baseBranch,
        fallbackSyncBase: uatBranch,
        targetBranch: uatBranch,
        diffBaseBranch: uatBranch,
        needRemoteFetchAfterSync: false,
        args,
      });
      if (!prep.ok) return errorResult(prep.error);
      // 桌面端确认框由服务端 /api/merge_to_base_branch 统一弹出
      const mergeResult = await transport.mergeToBase(projectPath, uatBranch);
      return textResult({
        checked_branch: prep.currentBranch,
        synced_base: prep.syncBaseBranch,
        sync_result: prep.syncResult,
        merge_result: mergeResult,
      });
    },

    workspace_switch: async (args) => {
      const path = args?.path as string;
      if (!path) throw new Error('path is required');
      return textResult(await transport.switchWorkspace(path));
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
      // 桌面端确认框由服务端 /api/deploy_to_main 统一弹出
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
    description: '合并到 test（无需桌面确认弹窗）。合并前会自动检查当前分支、先同步 base 分支，并执行提交数量与干净工作区护栏。',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        base_branch: { type: 'string', description: '合并前会先同步该基线分支，并用于计算差异统计' },
        test_branch: { type: 'string' },
        max_ahead: { type: 'number', description: 'Max commits ahead of test allowed (default 50)' },
        require_clean_worktree: { type: 'boolean', description: 'Block if uncommitted changes (default true)' },
        force: { type: 'boolean', description: 'Bypass threshold/clean-tree guards (never bypasses protected/target branch checks)' },
      },
      required: ['project_path', 'base_branch', 'test_branch'],
    },
  },
  {
    name: 'merge_to_base',
    description: '合并到基线分支。合并前自动检查当前分支、先同步 base 分支并执行护栏，最终在桌面端弹窗确认后才执行。',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        base_branch: { type: 'string' },
        max_ahead: { type: 'number', description: 'Max commits ahead of base allowed (default 50)' },
        require_clean_worktree: { type: 'boolean', description: 'Block if uncommitted changes (default true)' },
        force: { type: 'boolean', description: 'Bypass threshold/clean-tree guards (never bypasses protected/target branch checks)' },
      },
      required: ['project_path', 'base_branch'],
    },
  },
  {
    name: 'merge_to_uat',
    description: '合并到 UAT（默认目标分支 uat，可用 uat_branch 覆盖）。合并前自动检查当前分支、先同步 base 分支并执行护栏，最终在桌面端弹窗确认后才执行。',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: { type: 'string' },
        uat_branch: { type: 'string', description: '默认 uat' },
        base_branch: { type: 'string', description: '合并前要同步的基线分支（缺省使用项目配置的 base_branch 或 uat_branch）' },
        max_ahead: { type: 'number', description: 'Max commits ahead of UAT allowed (default 50)' },
        require_clean_worktree: { type: 'boolean', description: 'Block if uncommitted changes (default true)' },
        force: { type: 'boolean', description: 'Bypass threshold/clean-tree guards (never bypasses protected/target branch checks)' },
      },
      required: ['project_path'],
    },
  },
  {
    name: 'workspace_switch',
    description: '切换当前活动工作区。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目标工作区根目录路径' },
      },
      required: ['path'],
    },
  },
  {
    name: 'workspace_create',
    description: '新建工作区。后端会弹出桌面确认框，用户确认前不会执行。',
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
