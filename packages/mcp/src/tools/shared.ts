import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// 工具调用返回结构（MCP CallTool 的 content 形态）
export type ToolResult = CallToolResult;

// 单个工具的处理函数：接收 arguments，返回 ToolResult
export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// 把任意值包装成文本型 ToolResult
export function textResult(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

// 错误型 ToolResult
export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
