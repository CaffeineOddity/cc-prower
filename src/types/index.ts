// 导出所有类型
export * from './config.js';
export * from './message.js';
export * from './mcp.js';

import {
  IncomingMessage,
  OutgoingMessage,
  Message,
  MessageType,
  MessageRoute,
  QueueItem,
} from './message.js';

import {
  GlobalConfig,
  MCPConfig,
  LoggingConfig,
  ProvidersConfig,
  ProjectConfig,
  SessionConfig,
  ProviderConfig,
  ProviderType,
  FeishuConfig,
  TelegramConfig,
  WhatsAppConfig,
  IConfigManager,
} from './config.js';

import {
  MCPTools,
  SendMessageArgs,
  ListChatsArgs,
  GetStatusArgs,
  MCPMessage,
  MCPToolResponse,
  MCPServerConfig,
  MCPClient,
} from './mcp.js';

// Provider 基类接口
export interface IProvider {
  connect(config: ProviderConfig): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<void>;
  onMessage(callback: (message: IncomingMessage) => void): void;
  isHealthy(): boolean;
  disconnect(): Promise<void>;
}

// 路由器接口
export interface IRouter {
  registerProject(projectId: string, config: ProjectConfig): Promise<void>;
  unregisterProject(projectId: string): Promise<void>;
  route(message: IncomingMessage | OutgoingMessage): Promise<void>;
  handleMCPMessage(message: MCPMessage): Promise<void>;
  getProject(provider: string, chatId: string): string | null;
}

// 日志器接口
export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}