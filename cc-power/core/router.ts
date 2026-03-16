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

  constructor(configManager: ConfigManager, logger: Logger, messageLogger?: MessageLogger) {
    this.configManager = configManager;
    this.logger = logger;
    this.messageLogger = messageLogger || new MessageLogger('./logs/messages');
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
   */
  private async ensureProjectRegistered(projectId: string): Promise<IProvider | null> {
    // 检查是否已注册
    const existingProvider = this.providers.get(projectId);
    if (existingProvider) {
      return existingProvider;
    }

    // 尝试加载项目配置
    const projectConfig = await this.configManager.loadProject(projectId);
    if (!projectConfig) {
      this.logger.warn(`Project ${projectId} not found`);
      return null;
    }

    // 注册项目
    try {
      await this.registerProject(projectId, projectConfig);
      return this.providers.get(projectId) || null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to register project ${projectId}: ${errorMessage}`);
      return null;
    }
  }

  /**
   * 注册项目
   */
  async registerProject(projectId: string, config: ProjectConfig): Promise<void> {
    const { provider } = config;
    const providerType = provider;

    this.logger.info(`Registering project: ${projectId} (${providerType})`);

    try {
      // 动态导入 Provider
      const ProviderModule = await this.loadProvider(providerType);
      const providerInstance = new ProviderModule() as IProvider;

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

    // 清理相关路由
    for (const [chatId, route] of this.projectRoutes) {
      if (route.projectId === projectId) {
        this.projectRoutes.delete(chatId);
      }
    }

    this.logger.info(`Project ${projectId} unregistered`);
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
      await this.sendMessage(message);
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

      default:
        this.logger.warn(`Unknown tool: ${name}`);
        return { error: `Unknown tool: ${name}` };
    }
  }

  /**
   * 处理 send_message 工具调用
   */
  private async handleSendMessage(args: SendMessageArgs): Promise<void> {
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

    await this.sendMessage(outgoingMessage);

    this.logger.info(`Message sent to ${provider}:${chatId}`);
  }

  /**
   * 处理 list_chats 工具调用
   */
  private async handleListChats(args: ListChatsArgs): Promise<any> {
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
  private async handleGetStatus(args: GetStatusArgs): Promise<any> {
    const { provider } = args;

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

    return status;
  }

  /**
   * 发送消息到 Provider
   */
  private async sendMessage(message: OutgoingMessage): Promise<void> {
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
}