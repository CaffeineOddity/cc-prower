import type {
  IRouter,
  IncomingMessage,
  OutgoingMessage,
  MessageRoute,
  ProviderConfig,
  ProjectConfig,
  IProvider,
} from '../types/index.js';

// MCP 相关类型（本地定义，因为这些是 MCP 特定的）
interface SendMessageArgs {
  provider: string;
  chat_id: string;
  content: string;
  project_id?: string;
}

interface ListChatsArgs {
  provider: string;
  project_id?: string;
}

interface GetStatusArgs {
  provider?: string;
}

interface GetIncomingMessagesArgs {
  project_id: string;
  since?: number;
}
import { ConfigManager } from './config.js';
import { Logger } from './logger.js';
import { MessageLogger, type MessageLogEntry } from './message-logger.js';

/**
 * 路由器
 * 负责消息路由和 Provider 管理
 */
export class Router implements IRouter {
  private providers = new Map<string, IProvider>(); // projectId → Provider
  private projectRoutes = new Map<string, MessageRoute>(); // chatId → MessageRoute
  private configManager: ConfigManager;
  private logger: Logger;
  private messageLogger: MessageLogger;

  // 心跳跟踪
  private heartbeats = new Map<string, number>(); // projectId → lastHeartbeatTime
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_TIMEOUT = 60000; // 60秒无心跳则认为项目已死
  private readonly HEARTBEAT_CHECK_INTERVAL = 10000; // 每10秒检查一次心跳

  // 入站消息队列（用于 HTTP 模式）
  private incomingMessageQueue = new Map<string, IncomingMessage[]>(); // projectId → messages

  // 通知发送器（用于 HTTP 模式）
  private notificationSender: ((message: any) => Promise<void>) | null = null;

  constructor(configManager: ConfigManager, logger: Logger, messageLogger?: MessageLogger) {
    this.configManager = configManager;
    this.logger = logger;
    this.messageLogger = messageLogger || new MessageLogger('./logs/messages');

    // 启动心跳检查
    this.startHeartbeatChecker();
  }

  /**
   * 启动心跳检查器
   */
  private startHeartbeatChecker(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkDeadProjects();
    }, this.HEARTBEAT_CHECK_INTERVAL);

    this.logger.debug('Heartbeat checker started');
  }

  /**
   * 停止心跳检查器
   */
  private stopHeartbeatChecker(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.logger.debug('Heartbeat checker stopped');
    }
  }

  /**
   * 检查并清理已死的项目
   */
  private checkDeadProjects(): void {
    const now = Date.now();
    const deadProjects: string[] = [];

    for (const [projectId, lastHeartbeat] of this.heartbeats) {
      const timeSinceLast = now - lastHeartbeat;
      if (timeSinceLast > this.HEARTBEAT_TIMEOUT) {
        deadProjects.push(projectId);
      }
    }

    for (const projectId of deadProjects) {
      this.logger.warn(
        `Project ${projectId} heartbeat timeout (${(now - (this.heartbeats.get(projectId) || 0)) / 1000}s), unregistering`
      );
      this.unregisterProject(projectId).catch(error => {
        this.logger.error(`Failed to unregister dead project ${projectId}:`, error);
      });
    }
  }

  /**
   * 发送心跳
   */
  async sendHeartbeat(projectId: string): Promise<void> {
    const now = Date.now();
    this.heartbeats.set(projectId, now);

    this.logger.debug(`Heartbeat received from project ${projectId}`);
  }

  /**
   * 获取项目心跳状态
   */
  getProjectHeartbeatStatus(projectId: string): { lastHeartbeat: number; isAlive: boolean } {
    const lastHeartbeat = this.heartbeats.get(projectId) || 0;
    const isAlive = lastHeartbeat > 0 && (Date.now() - lastHeartbeat) < this.HEARTBEAT_TIMEOUT;

    return { lastHeartbeat, isAlive };
  }

  /**
   * 初始化消息日志器
   */
  async initializeMessageLogger(): Promise<void> {
    await this.messageLogger.initialize();
    this.logger.info('Message logger initialized');
  }

  /**
   * 确保项目已注册（按需加载）
   * 注意：此方法已废弃，项目配置现在由客户端通过 MCP 直接传递
   */
  private async ensureProjectRegistered(projectId: string): Promise<IProvider | null> {
    // 检查是否已注册
    const existingProvider = this.providers.get(projectId);
    if (existingProvider) {
      return existingProvider;
    }

    // 现在项目配置由客户端通过 MCP 传递，不再从文件系统加载
    this.logger.warn(`Project ${projectId} not registered. Use register_project MCP tool to register.`);
    return null;
  }

  /**
   * 注册项目
   */
  async registerProject(projectId: string, config: ProjectConfig): Promise<void> {
    const { provider } = config;
    const providerType = provider;

    // 验证 Provider 是否启用
    if (!this.configManager.isProviderEnabled(providerType as any)) {
      throw new Error(`Provider ${providerType} is not enabled in global config`);
    }

    this.logger.info(`Registering project: ${projectId} (${providerType})`);

    try {
      // 动态导入 Provider
      const ProviderModule = await this.loadProvider(providerType);
      const providerInstance = new ProviderModule() as IProvider;

      // 缓存项目配置
      this.configManager.cacheProjectConfig(projectId, config);

      // 构建 ProviderConfig
      const providerConfig: ProviderConfig = {
        type: providerType,
        projectId,
        ...config,
      };

      // 连接 Provider
      await providerInstance.connect(providerConfig);

      // 存储 Provider
      this.providers.set(projectId, providerInstance);

      // 初始化心跳（使用当前时间）
      this.heartbeats.set(projectId, Date.now());

      // 设置消息监听
      providerInstance.onMessage((message: IncomingMessage) => {
        this.handleIncomingMessage(message);
      });

      this.logger.info(`Project ${projectId} registered successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to register project ${projectId}: ${errorMessage}`);
      // Don't throw, just log the error so other projects can register
    }
  }

  /**
   * 取消注册项目
   */
  async unregisterProject(projectId: string): Promise<void> {
    const provider = this.providers.get(projectId);
    if (!provider) {
      return;
    }

    this.logger.info(`Unregistering project: ${projectId}`);

    await provider.disconnect();
    this.providers.delete(projectId);

    // 清理心跳数据
    this.heartbeats.delete(projectId);

    // 清理相关路由
    for (const [chatId, route] of this.projectRoutes) {
      if (route.projectId === projectId) {
        this.projectRoutes.delete(chatId);
      }
    }

    this.logger.info(`Project ${projectId} unregistered`);
  }

  /**
   * 清理所有资源
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up router...');

    // 停止心跳检查器
    this.stopHeartbeatChecker();

    // 注销所有项目
    const projectIds = Array.from(this.providers.keys());
    for (const projectId of projectIds) {
      await this.unregisterProject(projectId);
    }

    this.logger.info('Router cleanup complete');
  }

  /**
   * 加载 Provider 模块
   */
  private async loadProvider(type: string): Promise<any> {
    const providerPath = `../providers/${type}.js`;
    const module = await import(providerPath);
    return module.default || module[`${type.charAt(0).toUpperCase() + type.slice(1)}Provider`];
  }

  /**
   * 处理来自聊天平台的入站消息
   */
  private handleIncomingMessage(message: IncomingMessage): void {
    this.logger.debug(`Incoming message: ${JSON.stringify(message)}`);

    // 记录消息到日志
    this.messageLogger.logIncoming(
      message.projectId,
      message.provider,
      message.chatId,
      message.content,
      message.userId,
      message.userName,
      message.metadata?.message_id,
      message.metadata?.message_type,
      message.metadata
    ).catch(error => {
      this.logger.error('Failed to log incoming message:', error);
    });

    // 建立路由映射
    this.projectRoutes.set(message.chatId, {
      provider: message.provider,
      projectId: message.projectId,
      chatId: message.chatId,
      userId: message.userId,
    });

    // 将消息存入队列
    const queue = this.incomingMessageQueue.get(message.projectId) || [];
    queue.push(message);
    this.incomingMessageQueue.set(message.projectId, queue);

    // 如果有通知发送器，立即推送通知
    if (this.notificationSender) {
      this.sendIncomingMessageNotification(message).catch(error => {
        this.logger.error('Failed to send incoming message notification:', error);
      });
    }

    this.logger.info(`Incoming message queued for ${message.projectId}: ${message.content}`);
  }

  /**
   * 路由消息
   */
  async route(message: IncomingMessage | OutgoingMessage): Promise<void> {
    if (message.type === 'incoming') {
      // 入站消息：存储路由信息
      this.handleIncomingMessage(message);
    } else {
      // 出站消息：发送到 Provider
      await this._sendMessageToProvider(message);
    }
  }

  /**
   * 处理 MCP 消息
   */
  async handleMCPMessage(message: any): Promise<void> {
    this.logger.debug(`MCP message: ${JSON.stringify(message)}`);

    const { method, params } = message;

    switch (method) {
      case 'tools/call':
        await this.handleToolCall(params as any);
        break;

      default:
        this.logger.warn(`Unknown MCP method: ${method}`);
    }
  }

  /**
   * 处理 MCP 工具调用
   */
  private async handleToolCall(params: {
    name: string;
    arguments: Record<string, any>;
  }): Promise<any> {
    const { name, arguments: args } = params;

    this.logger.debug(`Tool call: ${name} with args: ${JSON.stringify(args)}`);

    switch (name) {
      case 'send_message':
        await this.handleSendMessage(args as SendMessageArgs);
        return { success: true, message: 'Message sent successfully' };

      case 'list_chats':
        return await this.handleListChats(args as ListChatsArgs);

      case 'get_status':
        return await this.handleGetStatus(args as GetStatusArgs);

      case 'get_incoming_messages':
        return await this.handleGetIncomingMessages(args as GetIncomingMessagesArgs);

      default:
        this.logger.warn(`Unknown tool: ${name}`);
        return { error: `Unknown tool: ${name}` };
    }
  }

  /**
   * 处理 send_message 工具调用
   */
  async handleSendMessage(args: SendMessageArgs): Promise<any> {
    const { provider, chat_id: chatId, content, project_id: projectId } = args;

    // 如果指定了项目 ID，确保项目已注册
    let targetProjectId = projectId;

    if (!targetProjectId) {
      // 根据聊天 ID 查找项目
      const route = this.projectRoutes.get(chatId);
      if (!route) {
        throw new Error(`No project found for chat: ${chatId}. Please specify project_id.`);
      }
      targetProjectId = route.projectId;
    }

    // 确保项目已注册
    const providerInstance = await this.ensureProjectRegistered(targetProjectId);
    if (!providerInstance) {
      throw new Error(`Failed to load provider for project: ${targetProjectId}`);
    }

    // 发送消息
    const outgoingMessage: OutgoingMessage = {
      type: 'outgoing',
      provider,
      projectId: targetProjectId,
      chatId,
      content,
      timestamp: Date.now(),
    };

    await this._sendMessageToProvider(outgoingMessage);

    this.logger.info(`Message sent to ${provider}:${chatId}`);

    return { success: true, message: 'Message sent successfully' };
  }

  /**
   * 处理 list_chats 工具调用
   */
  async handleListChats(args: ListChatsArgs): Promise<any> {
    const { provider, project_id: projectId } = args;

    // 获取指定项目的 Provider
    let targetProjectId = projectId;
    if (!targetProjectId) {
      // 如果没有指定项目 ID，尝试从已注册的项目中查找
      for (const [pid, prov] of this.providers) {
        const provName = (prov as any).name || 'unknown';
        if (provName === provider) {
          targetProjectId = pid;
          break;
        }
      }
    }

    if (!targetProjectId) {
      return {
        error: `No project found for provider: ${provider}. Please specify project_id.`,
      };
    }

    // 确保项目已注册
    const providerInstance = await this.ensureProjectRegistered(targetProjectId);
    if (!providerInstance) {
      return {
        error: `Failed to load provider for project: ${targetProjectId}`,
      };
    }

    // 返回路由列表
    const chats = Array.from(this.projectRoutes.values())
      .filter(route => route.provider === provider)
      .map(route => ({
        chat_id: route.chatId,
        project_id: route.projectId,
        user_id: route.userId,
      }));

    return { chats };
  }

  /**
   * 处理 get_status 工具调用
   */
  async handleGetStatus(args: GetStatusArgs): Promise<any> {
    const { provider } = args;
    this.logger.debug(`Tool call: get_status`, args);

    const status: Record<string, any> = {};

    for (const [projectId, prov] of this.providers) {
      const provName = (prov as any).name || 'unknown';
      if (provider && provName !== provider) {
        continue;
      }

      status[projectId] = {
        provider: provName,
        healthy: prov.isHealthy(),
      };
    }

    this.logger.info(`Retrieved status for ${Object.keys(status).length} projects`);
    return status;
  }

  /**
   * 处理 get_incoming_messages 工具调用
   */
  async handleGetIncomingMessages(args: GetIncomingMessagesArgs): Promise<any> {
    const { project_id: projectId, since } = args;

    const messages = await this.getIncomingMessages({ project_id: projectId, since });

    return {
      project_id: projectId,
      messages,
      count: messages.length,
    };
  }

  /**
   * 发送消息（BackendService 接口实现）
   */
  async sendMessage(args: {
    provider: string;
    chat_id: string;
    content: string;
    project_id?: string;
  }): Promise<any> {
    return await this.handleSendMessage(args);
  }

  /**
   * 内部发送消息到 Provider
   */
  async _sendMessageToProvider(message: OutgoingMessage): Promise<void> {
    const { projectId, chatId, content } = message;
    const provider = this.providers.get(projectId);

    if (!provider) {
      throw new Error(`Provider not found for project: ${projectId}`);
    }

    // 记录出站消息到日志
    const providerName = (provider as any).name || 'unknown';
    await this.messageLogger.logOutgoing(
      projectId,
      providerName,
      chatId,
      content,
      message.metadata?.message_id,
      message.metadata?.message_type,
      message.metadata
    ).catch(error => {
      this.logger.error('Failed to log outgoing message:', error);
    });

    await provider.sendMessage(chatId, content);
  }

  /**
   * 根据 Provider 和聊天 ID 获取项目 ID
   */
  getProject(provider: string, chatId: string): string | null {
    const route = this.projectRoutes.get(chatId);
    if (route && route.provider === provider) {
      return route.projectId;
    }
    return null;
  }

  /**
   * 获取所有已注册的项目
   */
  getRegisteredProjects(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 获取 Provider 实例
   */
  getProvider(projectId: string): IProvider | undefined {
    return this.providers.get(projectId);
  }

  /**
   * 设置通知发送器（用于 HTTP 模式）
   */
  setNotificationSender(sender: (message: any) => Promise<void>): void {
    this.notificationSender = sender;
    this.logger.debug('Notification sender set');
  }

  /**
   * 发送入站消息通知
   */
  private async sendIncomingMessageNotification(message: IncomingMessage): Promise<void> {
    if (!this.notificationSender) {
      return;
    }

    const notification = {
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: {
        type: 'incoming',
        provider: message.provider,
        project_id: message.projectId,
        chat_id: message.chatId,
        user_id: message.userId,
        user_name: message.userName,
        content: message.content,
        timestamp: message.timestamp,
        metadata: message.metadata,
      },
    };

    await this.notificationSender(notification);
    this.logger.debug(`Notification sent for message from ${message.chatId}`);
  }

  /**
   * 获取入站消息
   */
  async getIncomingMessages(args: GetIncomingMessagesArgs): Promise<any[]> {
    const { project_id: projectId, since } = args;
    const queue = this.incomingMessageQueue.get(projectId) || [];

    // 如果指定了 since 时间戳，只返回该时间之后的消息
    let messages = queue;
    if (since) {
      messages = queue.filter(msg => msg.timestamp > since);
    }

    // 清空队列（返回的消息已被消费）
    this.incomingMessageQueue.set(projectId, []);

    return messages;
  }


  /**
   * 列出聊天（BackendService 接口实现）
   */
  async listChats(args: {
    provider: string;
    project_id?: string;
  }): Promise<any> {
    return await this.handleListChats(args);
  }

  /**
   * 获取状态（BackendService 接口实现）
   */
  async getStatus(args: { provider?: string }): Promise<any> {
    return await this.handleGetStatus(args);
  }

  /**
   * 日志记录（BackendService 接口实现）
   */
  logDebug(message: string, ...args: any[]): void {
    this.logger.debug(message, ...args);
  }

  logInfo(message: string, ...args: any[]): void {
    this.logger.info(message, ...args);
  }

  logWarn(message: string, ...args: any[]): void {
    this.logger.warn(message, ...args);
  }

  logError(message: string, ...args: any[]): void {
    this.logger.error(message, ...args);
  }
}