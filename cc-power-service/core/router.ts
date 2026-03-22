import type {
  IRouter,
  IncomingMessage,
  OutgoingMessage,
  IProvider,
  MessageRoute,
} from '../types/index.js';
import { ConfigManager } from './config.js';
import { Logger } from '../utils/logger.js';
import { MessageLogger } from '../utils/message-logger.js';
import { RegisterSignal } from '../utils/signals.js';
import { TmuxSessionPoller } from './tmux-session-poller.js';
import { ProviderRegistry } from './provider-registry.js';
import { MessageQueue } from './message-queue.js';
import { MessageInjector } from './message-injector.js';

/**
 * 路由器
 * 负责消息路由和 Provider 管理
 *
 * 架构：
 * - ProviderRegistry: 管理 Provider 的注册、注销和生命周期
 * - MessageQueue: 管理入站消息队列（TTL、长度限制）
 * - MessageInjector: 负责将消息注入到 tmux 会话
 * - TmuxSessionPoller: 定期检查 tmux 会话健康状态
 * - MessageLogger: 记录消息日志
 */
export class Router implements IRouter {
  // 路由映射
  private projectRoutes = new Map<string, MessageRoute>(); // chatId → MessageRoute

  // 依赖
  private configManager: ConfigManager;
  private logger: Logger;
  private messageLogger: MessageLogger;

  // 组件
  private providerRegistry: ProviderRegistry;
  private messageQueue: MessageQueue;
  private messageInjector: MessageInjector;
  private sessionPoller: TmuxSessionPoller;

  constructor(configManager: ConfigManager, logger: Logger, messageLogger?: MessageLogger) {
    this.configManager = configManager;
    this.logger = logger;
    this.messageLogger = messageLogger || new MessageLogger('./logs/messages');

    // 初始化各组件
    this.providerRegistry = new ProviderRegistry(configManager, logger);
    this.messageQueue = new MessageQueue(logger);

    // 创建会话轮询器
    this.sessionPoller = new TmuxSessionPoller(logger, async (projectId: string) => {
      await this.unregisterProject(projectId);
    });

    // 创建消息注入器
    this.messageInjector = new MessageInjector(
      logger,
      (projectName: string) => this.providerRegistry.getTmuxPaneByProjectName(projectName),
      (projectId: string) => this.unregisterProject(projectId)
    );

    // 设置 ProviderRegistry 的 tmux session 回调
    this.providerRegistry.setTmuxSessionCallbacks(
      (projectId: string, tmuxPane: string) => {
        this.sessionPoller.registerSession(projectId, tmuxPane);
      },
      (projectId: string) => {
        this.sessionPoller.unregisterSession(projectId);
      }
    );

    // 启动会话轮询
    this.sessionPoller.start();
  }

  /**
   * 初始化消息日志器
   */
  async initializeMessageLogger(): Promise<void> {
    await this.messageLogger.initialize();
    this.logger.info('Message logger initialized');
  }

  /**
   * 注册项目
   */
  async registerProject(signal: RegisterSignal): Promise<void> {
    if (!signal) {
      throw new Error('Project config is required for registration');
    }

    const { config, projectName, tmuxPane } = signal;

    this.logger.info(`registerProject called with: project_name=${projectName}, tmuxPane=${tmuxPane}, config=${JSON.stringify(config).substring(0, 200)}...`);

    // 验证配置
    if (!config.provider || typeof config.provider !== 'object' || !('name' in config.provider)) {
      throw new Error(`Invalid provider configuration: ${JSON.stringify(config)}`);
    }

    const providerType = config.provider.name;

    // 构建 TemplateProviderConfig
    const templateConfig = {
      project_name: projectName || 'unnamed',
      provider: config.provider,
    };

    this.logger.info(`Calling providerRegistry.registerProject with providerType=${providerType}, tmuxPane=${tmuxPane}`);

    // 注册 Provider
    const { projectId } = await this.providerRegistry.registerProject(
      providerType,
      templateConfig,
      tmuxPane
    );

    // 设置消息监听
    const provider = this.providerRegistry.getProvider(projectId);
    if (provider) {
      provider.onMessage((message: IncomingMessage) => {
        this.handleIncomingMessage(message);
      });
    }
  }

  /**
   * 取消注册项目
   */
  async unregisterProject(projectId: string): Promise<void> {
    const { projectName } = await this.providerRegistry.unregisterProject(projectId);

    // 清理消息队列
    this.messageQueue.clearQueue(projectId);

    // 清理相关路由
    for (const [chatId, route] of this.projectRoutes) {
      if (route.projectId === projectId) {
        this.projectRoutes.delete(chatId);
      }
    }
  }

  /**
   * 清理所有资源
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up router...');

    // 停止会话轮询
    this.sessionPoller.cleanup();

    // 注销所有项目
    await this.providerRegistry.cleanup();

    // 清空消息队列
    this.messageQueue.clearAll();

    this.logger.info('Router cleanup complete');
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
    this.messageQueue.enqueue(message.projectId, message);

    // 注入消息到 tmux
    this.messageInjector.inject(message).catch(err => {
      this.logger.error(`Failed to inject message via Tmux for project ${message.projectId}:`, err);
    });

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
   * 内部发送消息到 Provider
   */
  private async _sendMessageToProvider(message: OutgoingMessage): Promise<void> {
    const { projectId, chatId, content } = message;
    const provider = this.providerRegistry.getProvider(projectId);

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
    return this.providerRegistry.getRegisteredProjects();
  }

  /**
   * 获取 Provider 实例
   */
  getProvider(projectId: string): IProvider | undefined {
    return this.providerRegistry.getProvider(projectId);
  }

  /**
   * 获取入站消息（用于测试）
   */
  getIncomingMessages(projectId: string): IncomingMessage[] {
    return this.messageQueue.getQueue(projectId);
  }
}