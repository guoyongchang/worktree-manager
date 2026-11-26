import { watch, type FSWatcher } from 'chokidar';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HttpTransport, discoverHttpPort } from './transport/http.js';
import { ConfigTransport, MCP_CONFIG_PATH, readCapabilityLevel, readHttpPort } from './transport/config.js';
import { buildCoreHandlers, CORE_TOOLS } from './tools/core.js';
import { buildDetailsHandlers, DETAILS_TOOLS } from './tools/details.js';
import { buildAdvancedHandlers, ADVANCED_TOOLS } from './tools/advanced.js';
import { type ToolHandler, errorResult, extractErrorMessage } from './tools/shared.js';
import type { CapabilityLevel } from './types.js';

export class WorktreeMcpServer {
  private server: Server | null = null;
  private transport: HttpTransport | ConfigTransport | null = null;
  private capabilityLevel: CapabilityLevel = 'read';
  private handlers: Record<string, ToolHandler> = {};
  private configWatcher: FSWatcher | null = null;
  private connected = false;

  constructor() {}

  async initialize(): Promise<void> {
    // 先读登记端口，不通再扫 42800-42900。
    const httpTransport = new HttpTransport(await discoverHttpPort(readHttpPort()));
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
          tools: { listChanged: true },
        },
      }
    );

    // 读取 mcp.json 的 capability_level（缺省 read）
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

    if (httpOnly) {
      handlers = { ...handlers, ...buildDetailsHandlers(transport) };
      tools = tools.concat(DETAILS_TOOLS);
    }
    if (this.capabilityLevel === 'operate' && httpOnly) {
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
    if (this.server && this.transport) {
      this.registerTools();
      if (this.connected) {
        void this.server.sendToolListChanged().catch(() => {});
      }
    }
  }

  private watchCapabilityConfig(): void {
    if (this.configWatcher) return;
    // persistent: false 确保 stdio 关闭后 watcher 不会阻止 Node 进程退出
    const watcher = watch(MCP_CONFIG_PATH, { persistent: false, ignoreInitial: true });
    const reload = () => {
      const next = readCapabilityLevel(this.capabilityLevel);
      if (next !== this.capabilityLevel) {
        console.error(`[MCP] capability_level updated: ${this.capabilityLevel} -> ${next}`);
        this.setCapabilityLevel(next);
      }
    };
    watcher.on('change', reload);
    watcher.on('add', reload);
    watcher.on('error', () => {});
    this.configWatcher = watcher;
  }

  async run(): Promise<void> {
    if (!this.server) {
      throw new Error('Server not initialized. Call initialize() first.');
    }
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.connected = true;
    this.watchCapabilityConfig();
    this.server.onclose = () => {
      this.connected = false;
      void this.configWatcher?.close();
      this.configWatcher = null;
    };
    console.error('[MCP] Server running on stdio');
  }
}
