import axios, { AxiosInstance } from 'axios';
import type { TransportMode } from '../types.js';

const DEFAULT_PORT = 42819;

export class HttpTransport {
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
    const res = await this.client.post('/archive_worktree', { name });
    return res.data;
  }

  async deleteArchivedWorktree(name: string): Promise<unknown> {
    const res = await this.client.post('/delete_archived_worktree', { name });
    return res.data;
  }

  async checkWorktreeStatus(name: string): Promise<unknown> {
    const res = await this.client.post('/check_worktree_status', { name });
    return res.data;
  }

  // Project/Git operations
  async getBranchDiffStats(projectPath: string, baseBranch: string): Promise<unknown> {
    const res = await this.client.post('/get_branch_diff_stats', {
      path: projectPath,
      base_branch: baseBranch,
    });
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

  async commitAll(projectPath: string, message: string): Promise<unknown> {
    const res = await this.client.post('/commit_all', { path: projectPath, message });
    return res.data;
  }

  async pushToRemote(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/push_to_remote', { path: projectPath });
    return res.data;
  }

  async switchBranch(projectPath: string, branchName: string): Promise<unknown> {
    const res = await this.client.post('/switch_branch', { path: projectPath, branch: branchName });
    return res.data;
  }

  async fetchProjectRemote(projectPath: string): Promise<unknown> {
    const res = await this.client.post('/fetch_project_remote', { path: projectPath });
    return res.data;
  }
}
