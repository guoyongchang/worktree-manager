import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { watch } from 'chokidar';
import type { CapabilityLevel, TransportMode, WorkspaceRef } from '../types.js';

const GLOBAL_CONFIG_PATH = '.config/worktree-manager/global.json';

// mcp.json 路径 + capability_level / http_port 的读取（server.ts 与 index.ts 共用）
export const MCP_CONFIG_PATH = join(homedir(), '.config', 'worktree-manager', 'mcp.json');
const DEFAULT_HTTP_PORT = 42819;

export function normalizeCapability(value: unknown): CapabilityLevel | null {
  if (value === 'operate' || value === 'advanced') return 'operate';
  if (value === 'read' || value === 'core' || value === 'details') return 'read';
  return null;
}

export function isCapabilityLevel(v: unknown): v is CapabilityLevel {
  return normalizeCapability(v) !== null;
}

export function readCapabilityLevel(fallback: CapabilityLevel = 'read'): CapabilityLevel {
  try {
    if (existsSync(MCP_CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      return normalizeCapability(cfg?.capability_level) ?? fallback;
    }
  } catch {}
  return fallback;
}

export function readSavedHttpPort(fallback = DEFAULT_HTTP_PORT): number {
  try {
    if (existsSync(MCP_CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      const port = Number(cfg?.http_port);
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port;
    }
  } catch {}
  return fallback;
}

export function readHttpPort(fallback = DEFAULT_HTTP_PORT): number {
  const index = process.argv.indexOf('--port');
  const fromArg = index < 0 ? Number.NaN : Number(process.argv[index + 1]);
  if (Number.isInteger(fromArg) && fromArg >= 1024 && fromArg <= 65535) return fromArg;
  return readSavedHttpPort(fallback);
}

// Base transport interface for common operations
export interface BaseTransport {
  getMode(): TransportMode;
  isAvailable(): Promise<boolean>;
  listWorkspaces(): Promise<unknown>;
  getCurrentWorkspace(): Promise<unknown>;
  listWorktrees(includeArchived?: boolean): Promise<unknown>;
  getMainWorkspaceStatus(): Promise<unknown>;
  checkWorktreeStatus(name: string): Promise<unknown>;
}

// Extended transport interface for HTTP transport operations
export interface Transport extends BaseTransport {
  createWorktree(request: {
    name: string;
    folder_name?: string;
    projects: Array<{ name: string; base_branch?: string }>;
  }): Promise<unknown>;
  archiveWorktree(name: string): Promise<unknown>;
  deleteArchivedWorktree(name: string): Promise<unknown>;
  getBranchDiffStats(projectPath: string, baseBranch: string, testBranch?: string): Promise<unknown>;
  getChangedFiles(projectPath: string): Promise<unknown>;
  getRemoteBranches(projectPath: string): Promise<unknown>;
  commitAll(
    projectPath: string,
    message: string,
    authorName?: string,
    authorEmail?: string,
    skipHooks?: boolean
  ): Promise<unknown>;
  pushToRemote(projectPath: string): Promise<unknown>;
  switchBranch(projectPath: string, branchName: string): Promise<unknown>;
  fetchProjectRemote(projectPath: string): Promise<unknown>;
  // 新增写/同步方法
  pullCurrentBranch(projectPath: string): Promise<unknown>;
  syncWithBase(projectPath: string, baseBranch: string): Promise<unknown>;
  mergeToTest(projectPath: string, testBranch: string): Promise<unknown>;
  mergeToBase(projectPath: string, baseBranch: string): Promise<unknown>;
  requestConfirm(action: string, summary: string): Promise<void>;
  createWorkspace(name: string, path: string): Promise<unknown>;
  removeWorkspace(path: string): Promise<unknown>;
  restoreWorktree(name: string): Promise<unknown>;
  deployToMain(worktreeName: string): Promise<unknown>;
}

export class ConfigTransport implements BaseTransport {
  private configPath: string;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor() {
    this.configPath = join(homedir(), GLOBAL_CONFIG_PATH);
  }

  async isAvailable(): Promise<boolean> {
    return existsSync(this.configPath);
  }

  getMode(): TransportMode {
    return 'config';
  }

  private loadConfig(): any {
    try {
      const content = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { workspaces: [] };
    }
  }

  async listWorkspaces(): Promise<unknown> {
    const config = this.loadConfig();
    return { workspaces: config.workspaces || [] };
  }

  async getCurrentWorkspace(): Promise<unknown> {
    const config = this.loadConfig();
    const currentPath = config.current_workspace;
    const workspace = config.workspaces?.find((w: WorkspaceRef) => w.path === currentPath) || null;
    return { workspace };
  }

  async listWorktrees(): Promise<unknown> {
    // Config file doesn't store worktree data - return empty
    // This is a limitation of fallback mode
    return { worktrees: [] };
  }

  async getMainWorkspaceStatus(): Promise<unknown> {
    throw new Error('Not available in config transport mode');
  }

  async checkWorktreeStatus(name: string): Promise<unknown> {
    throw new Error('Not available in config transport mode');
  }

  watch(callback: () => void): void {
    if (this.watcher) return;
    this.watcher = watch(this.configPath, { persistent: true });
    this.watcher.on('change', callback);
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}