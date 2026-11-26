#!/usr/bin/env node

import { WorktreeMcpServer } from './server.js';
import { MCP_CONFIG_PATH, readCapabilityLevel, readSavedHttpPort } from './transport/config.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const CLAUDE_CONFIG_PATH = join(homedir(), '.claude.json');
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
    if (existsSync(MCP_CONFIG_PATH)) {
      // 已有合法配置时不再覆写，避免覆盖桌面端写入的 version / installed_at / http_port / capability_level
      try {
        const parsed = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'));
        if (parsed && typeof parsed === 'object') return;
      } catch {
        // 文件损坏时重建默认配置
      }
    }
    const dir = dirname(MCP_CONFIG_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const capabilityLevel = readCapabilityLevel('read');
    const mcpConfig = {
      version: '1.0.1',
      http_port: readSavedHttpPort(),
      installed_at: new Date().toISOString(),
      capability_level: capabilityLevel,
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