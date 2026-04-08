import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HttpTransport } from './transport/http.js';
import { ConfigTransport } from './transport/config.js';
import { registerCoreTools, CORE_TOOLS } from './tools/core.js';
import { registerDetailsTools, DETAILS_TOOLS } from './tools/details.js';
import { registerAdvancedTools, ADVANCED_TOOLS } from './tools/advanced.js';
import type { CapabilityLevel } from './types.js';

export class WorktreeMcpServer {
  private server: Server | null = null;
  private transport: HttpTransport | ConfigTransport | null = null;
  private capabilityLevel: CapabilityLevel = 'core';

  constructor() {}

  async initialize(): Promise<void> {
    // Try HTTP transport first
    const httpTransport = new HttpTransport();
    if (await httpTransport.isAvailable()) {
      this.transport = httpTransport;
      console.error('[MCP] Using HTTP transport (Tauri app running)');
    } else {
      // Fall back to config transport
      const configTransport = new ConfigTransport();
      if (await configTransport.isAvailable()) {
        this.transport = configTransport;
        console.error('[MCP] Using config file transport (fallback mode)');
      } else {
        throw new Error('No transport available. Ensure Tauri app is running or global config exists.');
      }
    }

    // Initialize MCP server
    this.server = new Server(
      {
        name: 'worktree-manager',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Register tools based on capability level
    this.registerTools();
  }

  private registerTools(): void {
    if (!this.server || !this.transport) return;

    const transport = this.transport as HttpTransport;

    // Core tools always registered
    registerCoreTools(this.server, transport);

    // Details tools
    if (this.capabilityLevel === 'details' || this.capabilityLevel === 'advanced') {
      registerDetailsTools(this.server, transport);
    }

    // Advanced tools
    if (this.capabilityLevel === 'advanced') {
      registerAdvancedTools(this.server, transport);
    }

    // Set tool list handler
    this.server.setRequestHandler(
      { method: 'tools/list' },
      async () => {
        let tools = [...CORE_TOOLS];
        if (this.capabilityLevel === 'details' || this.capabilityLevel === 'advanced') {
          tools = tools.concat(DETAILS_TOOLS);
        }
        if (this.capabilityLevel === 'advanced') {
          tools = tools.concat(ADVANCED_TOOLS);
        }
        return { tools };
      }
    );
  }

  setCapabilityLevel(level: CapabilityLevel): void {
    this.capabilityLevel = level;
  }

  async run(): Promise<void> {
    if (!this.server) {
      throw new Error('Server not initialized. Call initialize() first.');
    }
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP] Server running on stdio');
  }
}