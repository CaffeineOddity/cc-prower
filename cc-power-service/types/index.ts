// 导出所有类型
export * from './config.js';
export * from './message.js';

import {
  IncomingMessage,
  OutgoingMessage,
} from './message.js';

import {
  ProjectConfig,
  ProviderConfig
} from './config.js';

// Provider 基类接口
export interface IProvider {
  connect(config: ProviderConfig): Promise<void>;
  sendMessage(chatId: string, content: string): Promise<void>;
  onMessage(callback: (message: IncomingMessage) => void): void;
  isHealthy(): boolean;
  disconnect(): Promise<void>;
  getProjectId(): string;  // 新增：获取自动生成的 projectId
  getProjectName(): string | undefined;  // 新增：获取项目名称
}

// 路由器接口
export interface IRouter {
  registerProject(projectId: string, config: ProjectConfig): Promise<void>;
  unregisterProject(projectId: string): Promise<void>;
  route(message: IncomingMessage | OutgoingMessage): Promise<void>;
}

// 日志器接口
export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}