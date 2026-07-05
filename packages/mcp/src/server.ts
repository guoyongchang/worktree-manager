import axios from 'axios';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HttpTransport } from './transport/http.js';
import { ConfigTransport, readCapabilityLevel } from './transport/config.js';
import { buildCoreHandlers, CORE_TOOLS } from './tools/core.js';
import { buildDetailsHandlers, DETAILS_TOOLS } from './tools/details.js';
import { buildAdvancedHandlers, ADVANCED_TOOLS } from './tools/advanced.js';
import { type ToolHandler, errorResult } from './tools/shared.js';
import type { CapabilityLevel } from './types.js';

// 从错误里提取给用户看的信息。axios 错误优先透传后端响应体（后端 400 里的真实 git 报错），
// 否则回退到 error.message。
function extractErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data;
    if (typeof data === 'string' && data) return data;
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const msg = obj.error ?? obj.message;
      if (typeof msg === 'string' && msg) return msg;
      return JSON.stringify(data);
    }
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export class WorktreeMcpServer {
  private server: Server | null = null;
  private transport: HttpTransport | ConfigTransport | null = null;
  private capabilityLevel: CapabilityLevel = 'core';
  private handlers: Record<string, ToolHandler> = {};

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

    // 读取 mcp.json 的 capability_level（缺省 details，共享自 transport/config）
    this.capabilityLevel = readCapabilityLevel();

    // Register tools based on capability level
    this.registerTools();
  }

  private registerTools(): void {
    if (!this.server || !this.transport) return;
    const transport = this.transport;
    const httpOnly = transport instanceof HttpTransport;

    // 按 capability + transport 聚合 handler map（高层覆盖不再丢失低层）
    let handlers: Record<string, ToolHandler> = { ...buildCoreHandlers(transport) };
    let tools: any[] = [...CORE_TOOLS];

    if ((this.capabilityLevel === 'details' || this.capabilityLevel === 'advanced') && httpOnly) {
      handlers = { ...handlers, ...buildDetailsHandlers(transport) };
      tools = tools.concat(DETAILS_TOOLS);
    }
    if (this.capabilityLevel === 'advanced' && httpOnly) {
      handlers = { ...handlers, ...buildAdvancedHandlers(transport) };
      tools = tools.concat(ADVANCED_TOOLS);
    }
    this.handlers = handlers;

    // 单一 CallTool dispatcher
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handler = this.handlers[name];
      if (!handler) return errorResult(`Unknown tool: ${name}`);
      try {
        return await handler((args ?? {}) as Record<string, unknown>);
      } catch (e) {
        return errorResult(`Error: ${extractErrorMessage(e)}`);
      }
    });

    // 单一 ListTools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  }

  setCapabilityLevel(level: CapabilityLevel): void {
    if (level === this.capabilityLevel) return;
    this.capabilityLevel = level;
    // 重新注册工具，让 capability 切换真正生效（否则 handlers/tools 仍是旧集合，setter 形同死代码）
    if (this.server && this.transport) this.registerTools();
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
