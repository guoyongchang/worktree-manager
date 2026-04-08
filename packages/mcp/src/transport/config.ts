import { readFileSync, existsSync } from 'fs';
import { join, homedir } from 'path';
import { watch } from 'chokidar';
import type { TransportMode, WorkspaceRef } from '../types.js';

const GLOBAL_CONFIG_PATH = '.config/worktree-manager/global.json';

export class ConfigTransport {
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

  async listWorkspaces(): Promise<{ workspaces: WorkspaceRef[] }> {
    const config = this.loadConfig();
    return { workspaces: config.workspaces || [] };
  }

  async getCurrentWorkspace(): Promise<{ workspace: WorkspaceRef | null }> {
    const config = this.loadConfig();
    const currentPath = config.current_workspace;
    const workspace = config.workspaces?.find((w: WorkspaceRef) => w.path === currentPath) || null;
    return { workspace };
  }

  async listWorktrees(): Promise<{ worktrees: any[] }> {
    // Config file doesn't store worktree data - return empty
    // This is a limitation of fallback mode
    return { worktrees: [] };
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