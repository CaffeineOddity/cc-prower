// MCP 类型定义
import { Tool } from '@modelcontextprotocol/sdk/types.js';

// MCP 工具定义
export interface MCPTools {
  send_message: Tool;
  list_chats: Tool;
  get_status: Tool;
}

// send_message 工具参数
export interface SendMessageArgs {
  provider: string;
  chat_id: string;
  content: string;
  project_id?: string;
}

// list_chats 工具参数
export interface ListChatsArgs {
  provider: string;
  project_id?: string;
}

// get_status 工具参数
export interface GetStatusArgs {
  provider?: string;
}

// MCP 消息
export interface MCPMessage {
  method: string;
  params?: Record<string, any>;
  id?: number | string;
}

// MCP 工具调用响应
export interface MCPToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// MCP 服务器配置
export interface MCPServerConfig {
  transport: 'stdio' | 'websocket';
  port?: number;
  host?: string;
}

// MCP 客户端信息
export interface MCPClient {
  projectId: string;
  connected: boolean;
  lastSeen: number;
}