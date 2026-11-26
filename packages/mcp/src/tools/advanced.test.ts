import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvancedHandlers } from './advanced.js';
import type { Transport } from '../transport/config.js';
import type { BranchDiffStats } from '../types.js';

interface MockProject {
  name: string;
  path: string;
  current_branch: string;
  base_branch: string;
  test_branch: string;
  has_uncommitted?: boolean;
  uncommitted_count?: number;
}

function createMockTransport(opts: {
  projects?: MockProject[];
  mainProjects?: MockProject[];
  stats?: BranchDiffStats;
  syncError?: Error;
}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const defaultStats: BranchDiffStats = opts.stats ?? {
    ahead: 2,
    behind: 0,
    changed_files: 0,
    unpushed_commits: 1,
    ahead_of_test: 2,
  };

  const transport: Transport = {
    getMode: () => 'http',
    isAvailable: async () => true,
    listWorkspaces: async () => [],
    getCurrentWorkspace: async () => null,
    switchWorkspace: async (path) => {
      calls.push({ method: 'switchWorkspace', args: [path] });
      return { ok: true };
    },
    listWorktrees: async (includeArchived) => {
      calls.push({ method: 'listWorktrees', args: [includeArchived] });
      return [{ name: 'feat-req', projects: opts.projects ?? [] }];
    },
    getMainWorkspaceStatus: async () => {
      calls.push({ method: 'getMainWorkspaceStatus', args: [] });
      return { projects: opts.mainProjects ?? [] };
    },
    checkWorktreeStatus: async () => ({}),
    createWorktree: async () => ({}),
    archiveWorktree: async () => ({}),
    deleteArchivedWorktree: async () => ({}),
    getBranchDiffStats: async (projectPath, baseBranch, testBranch) => {
      calls.push({ method: 'getBranchDiffStats', args: [projectPath, baseBranch, testBranch] });
      return defaultStats;
    },
    getChangedFiles: async () => [],
    getRemoteBranches: async () => [],
    commitAll: async () => ({}),
    pushToRemote: async () => ({}),
    switchBranch: async (projectPath, branchName) => {
      calls.push({ method: 'switchBranch', args: [projectPath, branchName] });
      return { ok: true };
    },
    fetchProjectRemote: async (projectPath) => {
      calls.push({ method: 'fetchProjectRemote', args: [projectPath] });
      return 'fetched';
    },
    pullCurrentBranch: async () => 'pulled',
    syncWithBase: async (projectPath, baseBranch) => {
      calls.push({ method: 'syncWithBase', args: [projectPath, baseBranch] });
      if (opts.syncError) throw opts.syncError;
      return `Successfully synced with ${baseBranch}`;
    },
    mergeToTest: async (projectPath, testBranch) => {
      calls.push({ method: 'mergeToTest', args: [projectPath, testBranch] });
      return `merged to ${testBranch}`;
    },
    mergeToBase: async (projectPath, baseBranch) => {
      calls.push({ method: 'mergeToBase', args: [projectPath, baseBranch] });
      return `merged to ${baseBranch}`;
    },
    requestConfirm: async (action, summary) => {
      calls.push({ method: 'requestConfirm', args: [action, summary] });
    },
    createWorkspace: async () => ({}),
    removeWorkspace: async () => ({}),
    restoreWorktree: async () => ({}),
    deployToMain: async (name) => {
      calls.push({ method: 'deployToMain', args: [name] });
      return { ok: true };
    },
  };

  return { transport, calls };
}

function getResultText(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first && 'text' in first && typeof first.text === 'string' ? first.text : '';
}

test('merge_to_test checks branch, syncs base, fetches remote, and merges without confirmation dialog', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/api';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'feat/req-1',
        base_branch: 'uat',
        test_branch: 'test',
        has_uncommitted: false,
      },
    ],
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_test({
    project_path: projectPath,
    base_branch: 'uat',
    test_branch: 'test',
  });

  assert.equal(res.isError, undefined);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      'listWorktrees',
      'getMainWorkspaceStatus',
      'syncWithBase',
      'fetchProjectRemote',
      'getBranchDiffStats',
      'mergeToTest',
    ]
  );
  assert.deepEqual(calls[2].args, [projectPath, 'uat']);
  assert.deepEqual(calls[5].args, [projectPath, 'test']);
  assert.equal(calls.some((c) => c.method === 'requestConfirm'), false);
  const body = JSON.parse(getResultText(res));
  assert.equal(body.checked_branch, 'feat/req-1');
  assert.equal(body.synced_base, 'uat');
});

test('merge_to_test blocks protected branch before syncing base', async () => {
  const projectPath = '/ws/projects/api';
  const { transport, calls } = createMockTransport({
    mainProjects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'uat',
        base_branch: 'uat',
        test_branch: 'test',
        has_uncommitted: false,
      },
    ],
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_test({
    project_path: projectPath,
    base_branch: 'uat',
    test_branch: 'test',
  });

  assert.equal(res.isError, true);
  assert.match(getResultText(res), /受保护分支/);
  assert.equal(calls.some((c) => c.method === 'syncWithBase'), false);
  assert.equal(calls.some((c) => c.method === 'mergeToTest'), false);
});

test('merge_to_test blocks dirty worktree before syncing base', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/api';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'feat/req-1',
        base_branch: 'uat',
        test_branch: 'test',
        has_uncommitted: true,
        uncommitted_count: 3,
      },
    ],
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_test({
    project_path: projectPath,
    base_branch: 'uat',
    test_branch: 'test',
  });

  assert.equal(res.isError, true);
  assert.match(getResultText(res), /未提交变更/);
  assert.equal(calls.some((c) => c.method === 'syncWithBase'), false);
  assert.equal(calls.some((c) => c.method === 'mergeToTest'), false);
});

test('merge_to_test aborts merge when syncWithBase fails', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/api';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'feat/req-1',
        base_branch: 'uat',
        test_branch: 'test',
        has_uncommitted: false,
      },
    ],
    syncError: new Error('Git merge failed: CONFLICT in src/app.ts'),
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_test({
    project_path: projectPath,
    base_branch: 'uat',
    test_branch: 'test',
  });

  assert.equal(res.isError, true);
  assert.match(getResultText(res), /合并前同步基线分支「uat」失败/);
  assert.match(getResultText(res), /CONFLICT/);
  assert.equal(calls.some((c) => c.method === 'mergeToTest'), false);
});

test('merge_to_uat checks branch, syncs project base, enforces gate, and delegates confirmation to server mergeToBase', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/api';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'feat/req-1',
        base_branch: 'uat',
        test_branch: 'test',
        has_uncommitted: false,
      },
    ],
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_uat({ project_path: projectPath });

  assert.equal(res.isError, undefined);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      'listWorktrees',
      'getMainWorkspaceStatus',
      'syncWithBase',
      'getBranchDiffStats',
      'mergeToBase',
    ]
  );
  assert.deepEqual(calls[2].args, [projectPath, 'uat']);
  assert.deepEqual(calls[4].args, [projectPath, 'uat']);
  // Server-side /api/merge_to_base_branch triggers desktop confirm; client must not double-confirm
  assert.equal(calls.some((c) => c.method === 'requestConfirm'), false);
});

test('merge_to_uat fetches remote when project base differs from uat target', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/bpm';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'bpm',
        path: projectPath,
        current_branch: 'feat/workflow',
        base_branch: 'main',
        test_branch: 'test',
        has_uncommitted: false,
      },
    ],
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_uat({ project_path: projectPath });

  assert.equal(res.isError, undefined);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      'listWorktrees',
      'getMainWorkspaceStatus',
      'syncWithBase',
      'fetchProjectRemote',
      'getBranchDiffStats',
      'mergeToBase',
    ]
  );
  assert.deepEqual(calls[2].args, [projectPath, 'main']);
  assert.deepEqual(calls[4].args, [projectPath, 'uat', undefined]);
  assert.deepEqual(calls[5].args, [projectPath, 'uat']);
});

test('merge_to_uat blocks when ahead commits exceed max_ahead threshold', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/api';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'feat/req-1',
        base_branch: 'uat',
        test_branch: 'test',
        has_uncommitted: false,
      },
    ],
    stats: { ahead: 80, behind: 0, changed_files: 0, unpushed_commits: 0, ahead_of_test: 0 },
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_uat({ project_path: projectPath, max_ahead: 50 });

  assert.equal(res.isError, true);
  assert.match(getResultText(res), /超过阈值 50/);
  assert.equal(calls.some((c) => c.method === 'mergeToBase'), false);
});

test('merge_to_uat blocks merging from test branch even when force:true is passed', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/api';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'test',
        base_branch: 'uat',
        test_branch: 'test',
        has_uncommitted: false,
      },
    ],
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_uat({ project_path: projectPath, force: true });

  assert.equal(res.isError, true);
  assert.match(getResultText(res), /受保护分支/);
  assert.equal(calls.some((c) => c.method === 'syncWithBase'), false);
  assert.equal(calls.some((c) => c.method === 'mergeToBase'), false);
});

test('merge_to_uat blocks merging from custom configured test_branch (e.g. sit)', async () => {
  const projectPath = '/ws/worktrees/feat-1/projects/api';
  const { transport, calls } = createMockTransport({
    projects: [
      {
        name: 'api',
        path: projectPath,
        current_branch: 'sit',
        base_branch: 'uat',
        test_branch: 'sit',
        has_uncommitted: false,
      },
    ],
  });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_uat({ project_path: projectPath });

  assert.equal(res.isError, true);
  assert.match(getResultText(res), /受保护分支/);
  assert.equal(calls.some((c) => c.method === 'syncWithBase'), false);
  assert.equal(calls.some((c) => c.method === 'mergeToBase'), false);
});

test('merge_to_uat blocks when project path is not found in current workspace', async () => {
  const { transport, calls } = createMockTransport({ projects: [], mainProjects: [] });
  const handlers = buildAdvancedHandlers(transport);

  const res = await handlers.merge_to_uat({ project_path: '/other-ws/projects/api' });

  assert.equal(res.isError, true);
  assert.match(getResultText(res), /无法在当前工作区找到项目路径/);
  assert.equal(calls.some((c) => c.method === 'syncWithBase'), false);
  assert.equal(calls.some((c) => c.method === 'mergeToBase'), false);
});

test('workspace_switch and deploy_to_main forward cleanly without duplicate client confirm', async () => {
  const { transport, calls } = createMockTransport({});
  const handlers = buildAdvancedHandlers(transport);

  await handlers.workspace_switch({ path: '/ws/clp' });
  await handlers.deploy_to_main({ worktree_name: 'feat-1' });
  await handlers.git_switch_branch({ project_path: '/ws/clp/projects/api', branch_name: 'feat/x' });

  assert.deepEqual(calls, [
    { method: 'switchWorkspace', args: ['/ws/clp'] },
    { method: 'deployToMain', args: ['feat-1'] },
    { method: 'switchBranch', args: ['/ws/clp/projects/api', 'feat/x'] },
  ]);
});
