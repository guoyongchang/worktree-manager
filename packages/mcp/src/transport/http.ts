import axios, { AxiosInstance } from 'axios';
import type { TransportMode } from '../types.js';
import type { Transport } from './config.js';

const DEFAULT_PORT = 42819;
const SCAN_START = 42800;
const SCAN_END = 42900;
const WRITE_TIMEOUT = 60000; // 写/网络操作（merge/push/pull/sync/commit）用更长超时
const FETCH_TIMEOUT = 30000; // git fetch 真实耗时 3-6s，默认 5s 易超时

export async function discoverHttpPort(preferred = DEFAULT_PORT): Promise<number> {
  if (await isWorktreeManager(preferred)) return preferred;
  for (let start = SCAN_START; start <= SCAN_END; start += 20) {
    const batch = Array.from({ length: Math.min(20, SCAN_END - start + 1) }, (_, index) => start + index);
    const found = (await Promise.all(batch.map(async (port) => (await isWorktreeManager(port) ? port : 0)))).find((port) => port > 0);
    if (found) return found;
  }
  return preferred;
}

async function isWorktreeManager(port: number): Promise<boolean> {
  try {
    const response = await axios.post(`http://127.0.0.1:${port}/api/mcp/config`, {}, { timeout: 150 });
    return response.status === 200 && typeof response.data?.http_port === 'number';
  } catch {
    return false;
  }
}
export { Transport } from './config.js';

export class HttpTransport implements Transport {
  private client: AxiosInstance;
  private port: number;
  private baseUrl: string;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
    this.baseUrl = `http://localhost:${this.port}`;
    this.client = axios.create({
      baseURL: `${this.baseUrl}/api`,
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.client.post('/get_current_workspace', {});
      return response.status === 200;
    } catch {
      return false;
    }
  }

  getMode(): TransportMode {
    return 'http';
  }

  // Workspace operations
  async listWorkspaces(): Promise<unknown> {
    const res = await this.client.post('/list_workspaces', {});
    return res.data;
  }

  async getCurrentWorkspace(): Promise<unknown> {
    const res = await this.client.post('/get_current_workspace', {});
    return res.data;
  }

  async switchWorkspace(path: string): Promise<unknown> {
    const res = await this.client.post('/switch_workspace', { path });
    return res.data;
  }

  // Worktree operations
  async listWorktrees(includeArchived: boolean = false): Promise<unknown> {
    const res = await this.client.post('/list_worktrees', { include_archived: includeArchived });
    return res.data;
  }

  async getMainWorkspaceStatus(): Promise<unknown> {
    const res = await this.client.post('/get_main_workspace_status', {});
    return res.data;
  }

  async createWorktree(request: {
    name: string;
    folder_name?: string;
    projects: Array<{ name: string; base_branch?: string }>;
  }): Promise<unknown> {
    const res = await this.client.post('/create_worktree', request);
    return res.data;
  }

  async archiveWorktree(name: string): Promise<unknown> {
    const res = await this.client.post('/mcp/archive_worktree', { name }, { timeout: 130000 });
    return res.data;
  }

  async deleteArchivedWorktree(name: string): Promise<unknown> {
    const res = await this.client.post('/mcp/delete_archived_worktree', { name }, { timeout: 130000 });
    return res.data;
  }

  async checkWorktreeStatus(name: string): Promise<unknown> {
    const res = await this.client.post('/check_worktree_status', { name });
    return res.data;
  }

  // Project/Git operations
  async getBranchDiffStats(projectPath: string, baseBranch: string, testBranch?: string): Promise<unknown> {
    const body: Record<string, unknown> = { path: projectPath, base_branch: baseBranch };
    if (testBranch) body.test_branch = testBranch;
    const res = await this.client.post('/get_branch_diff_stats', body);
    return res.data;
  }

  async getChangedFiles(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/get_changed_files', { path: projectPath });
    return res.data;
  }

  async getRemoteBranches(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/get_remote_branches', { path: projectPath });
    return res.data;
  }

  async commitAll(
    projectPath: string,
    message: string,
    authorName?: string,
    authorEmail?: string,
    skipHooks?: boolean
  ): Promise<unknown> {
    const body: Record<string, unknown> = { path: projectPath, message };
    if (authorName) body.author_name = authorName;
    if (authorEmail) body.author_email = authorEmail;
    if (typeof skipHooks === 'boolean') body.skip_hooks = skipHooks;
    const res = await this.client.post('/commit_all', body, { timeout: WRITE_TIMEOUT });
    return res.data;
  }

  async pushToRemote(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/push_to_remote', { path: projectPath }, { timeout: WRITE_TIMEOUT });
    return res.data;
  }

  async switchBranch(projectPath: string, branchName: string): Promise<unknown> {
    const res = await this.client.post('/switch_branch', { path: projectPath, branch: branchName });
    return res.data;
  }

  async fetchProjectRemote(projectPath: string): Promise<unknown> {
    const res = await this.client.post(
      '/fetch_project_remote',
      { path: projectPath },
      { timeout: FETCH_TIMEOUT }
    );
    return res.data;
  }

  async pullCurrentBranch(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/pull_current_branch', { path: projectPath }, { timeout: WRITE_TIMEOUT });
    return res.data;
  }

  async syncWithBase(projectPath: string, baseBranch: string): Promise<unknown> {
    const res = await this.client.post(
      '/sync_with_base_branch',
      { path: projectPath, base_branch: baseBranch },
      { timeout: WRITE_TIMEOUT }
    );
    return res.data;
  }

  async mergeToTest(projectPath: string, testBranch: string): Promise<unknown> {
    const res = await this.client.post(
      '/merge_to_test_branch',
      { path: projectPath, test_branch: testBranch },
      { timeout: WRITE_TIMEOUT }
    );
    return res.data;
  }

  async mergeToBase(projectPath: string, baseBranch: string): Promise<unknown> {
    const res = await this.client.post(
      '/merge_to_base_branch',
      { path: projectPath, base_branch: baseBranch },
      { timeout: WRITE_TIMEOUT }
    );
    return res.data;
  }

  async requestConfirm(action: string, summary: string): Promise<void> {
    await this.client.post('/mcp/request_confirm', { action, summary }, { timeout: 130000 });
  }

  async createWorkspace(name: string, path: string): Promise<unknown> {
    const res = await this.client.post('/create_workspace', { name, path });
    return res.data;
  }

  async removeWorkspace(path: string): Promise<unknown> {
    const res = await this.client.post('/remove_workspace', { path });
    return res.data;
  }

  async restoreWorktree(name: string): Promise<unknown> {
    const res = await this.client.post('/mcp/restore_worktree', { name }, { timeout: 130000 });
    return res.data;
  }

  async deployToMain(worktreeName: string): Promise<unknown> {
    const res = await this.client.post('/deploy_to_main', { worktree_name: worktreeName }, { timeout: WRITE_TIMEOUT });
    return res.data;
  }
}
