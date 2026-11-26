import axios from 'axios';
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

// 从错误里提取给用户看的信息。axios 错误优先透传后端响应体（后端 400 里的真实 git 报错），
// 否则回退到 error.message。
export function extractErrorMessage(e: unknown): string {
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
