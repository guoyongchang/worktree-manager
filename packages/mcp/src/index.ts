#!/usr/bin/env node

import { WorktreeMcpServer } from './server.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');
const MCP_CONFIG_DIR = '.config/worktree-manager';
const MCP_CONFIG_PATH = join(homedir(), MCP_CONFIG_DIR, 'mcp.json');

async function startServer() {
  const server = new WorktreeMcpServer();
  await server.initialize();
  await server.run();
}

function loadClaudeConfig(): any {
  try {
    if (existsSync(CLAUDE_CONFIG_PATH)) {
      return JSON.parse(readFileSync(CLAUDE_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveClaudeConfig(config: any): void {
  writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function install() {
  console.error('Installing @worktree-manager/mcp to Claude Code...');

  const config = loadClaudeConfig();
  config.mcpServers = config.mcpServers || {};
  config.mcpServers['worktree-manager'] = {
    command: 'npx',
    args: ['-y', '@worktree-manager/mcp', 'start'],
  };
  saveClaudeConfig(config);

  console.error('Installed! Claude Code will now have access to Worktree Manager.');
  console.error('Restart Claude Code or run: claude mcp restart');
}

async function uninstall() {
  console.error('Uninstalling @worktree-manager/mcp from Claude Code...');

  const config = loadClaudeConfig();
  if (config.mcpServers?.['worktree-manager']) {
    delete config.mcpServers['worktree-manager'];
    saveClaudeConfig(config);
    console.error('Uninstalled. Restart Claude Code to apply changes.');
  } else {
    console.error('Not found in Claude config.');
  }
}

function writeMcpConfig(): void {
  try {
    const dir = join(homedir(), MCP_CONFIG_DIR);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const mcpConfig = {
      version: '1.0.0',
      http_port: 42819,
      installed_at: new Date().toISOString(),
      capability_level: 'core',
    };
    writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2));
  } catch (e) {
    console.error('Warning: Could not write MCP config:', e);
  }
}

const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    writeMcpConfig();
    await startServer();
    break;
  case 'install':
    await install();
    break;
  case 'uninstall':
    await uninstall();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: worktree-manager-mcp [start|install|uninstall]');
    process.exit(1);
}