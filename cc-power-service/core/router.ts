import type {
  IRouter,
  IncomingMessage,
  OutgoingMessage,
  MessageRoute,
  ProviderConfig,
  ProjectConfig,
  IProvider,
  MCPRequest,
  MCPCallRequest,
  MCCToolCall,
  MCCToolResult,
} from '../types/index.js';

import * as fs from 'fs/promises';
import * as path from 'path';

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
  private projectTmuxSessions = new Map<string, string>(); // projectId → tmuxPane
  private configManager: ConfigManager;
  private logger: Logger;
  private messageLogger: MessageLogger;

  // 入站消息队列（用于 HTTP 模式）
  private incomingMessageQueue = new Map<string, IncomingMessage[]>(); // projectId → messages

  // 队列最大长度限制（防止内存泄漏）
  protected MAX_QUEUE_LENGTH = 50; // Changed from readonly to allow testing

  // 消息生存时间（毫秒），超过此时间的消息将被丢弃
  private readonly MESSAGE_TTL = 5 * 60 * 1000; // 5分钟

  // 通知发送器（用于 HTTP 模式）
  private notificationSender: ((message: any) => Promise<void>) | null = null;

  // 定时检查间隔（毫秒）
  private readonly SESSION_POLL_INTERVAL = 60000; // 1 minute

  // 定时检查任务句柄
  private sessionPollTimer: NodeJS.Timeout | null = null;

  constructor(configManager: ConfigManager, logger: Logger, messageLogger?: MessageLogger) {
    this.configManager = configManager;
    this.logger = logger;
    this.messageLogger = messageLogger || new MessageLogger('./logs/messages');

    // Start the session polling mechanism
    this.startSessionPolling();
  }

  /**
   * 开始 Tmux 会话轮询检查
   */
  private startSessionPolling(): void {
    this.sessionPollTimer = setInterval(() => {
      this.pollTmuxSessions().catch(error => {
        this.logger.error('Error during tmux session polling:', error);
      });
    }, this.SESSION_POLL_INTERVAL);

    this.logger.info(`Started tmux session polling every ${this.SESSION_POLL_INTERVAL / 1000} seconds`);
  }

  /**
   * 停止 Tmux 会话轮询检查
   */
  private stopSessionPolling(): void {
    if (this.sessionPollTimer) {
      clearInterval(this.sessionPollTimer);
      this.sessionPollTimer = null;
      this.logger.info('Stopped tmux session polling');
    }
  }

  /**
   * 轮询检查所有注册项目的 Tmux 会话状态
   */
  private async pollTmuxSessions(): Promise<void> {
    this.logger.debug('Polling tmux sessions for health check...');

    // Get all registered project IDs
    const projectIds = Array.from(this.projectTmuxSessions.keys());

    if (projectIds.length === 0) {
      this.logger.debug('No tmux sessions to poll');
      return;
    }

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    for (const projectId of projectIds) {
      const tmuxPane = this.projectTmuxSessions.get(projectId);
      if (!tmuxPane) {
        continue;
      }

      try {
        // Extract session name from pane identifier (format: session:window.pane)
        const sessionName = tmuxPane.split(':')[0];

        // Check if the session exists
        const result = await execAsync(`tmux has-session -t '${sessionName}' 2>/dev/null || echo "not found"`);
        const output = result.stdout.toString().trim();

        // If session doesn't exist, unregister the project
        if (output.includes("not found") || result.stderr?.toString()?.includes("no server running")) {
          this.logger.warn(`Tmux session ${sessionName} for project ${projectId} is dead, unregistering project`);

          // Unregister the project to trigger cleanup
          await this.unregisterProject(projectId);
        } else {
          this.logger.debug(`Tmux session ${sessionName} for project ${projectId} is alive`);
        }
      } catch (error) {
        this.logger.error(`Failed to check tmux session ${tmuxPane} for project ${projectId}:`, error);
      }
    }
  }

  /**
   * 初始化消息日志器
   */
  async initializeMessageLogger(): Promise<void> {
    await this.messageLogger.initialize();
    this.logger.info('Message logger initialized');
  }

  /**
   * 确保项目已注册，如果未注册则尝试从 CWD 加载
   */
  private async ensureProjectRegistered(projectId: string): Promise<IProvider | null> {
    if (this.providers.has(projectId)) {
      return this.providers.get(projectId)!;
    }

    // 如果没找到，尝试从 CWD 自动注册
    try {
      const cwd = process.cwd();
      const crypto = await import('crypto');
      const path = await import('path');
      const fs = await import('fs/promises');
      
      const normalizedPath = path.resolve(cwd).replace(/\/$/, '');
      const inferredProjectId = crypto.createHash('md5').update(normalizedPath).digest('hex').substring(0, 8);

      if (projectId === inferredProjectId) {
        // 尝试加载配置并注册
        let projectConfig: any = null;
        const configPaths = [
          path.join(cwd, '.cc-power.yaml'),
          path.join(cwd, 'config.yaml'),
        ];

        for (const candidate of configPaths) {
          try {
            const content = await fs.readFile(candidate, 'utf-8');
            const yaml = await import('yaml');
            projectConfig = yaml.parse(content);
            break;
          } catch (error) {
            continue;
          }
        }

        if (projectConfig && projectConfig.provider) {
          this.logger.info(`Auto-registering project ${projectId} from CWD`);
          await this.registerProject(projectId, projectConfig);
          return this.providers.get(projectId) || null;
        }
      }
    } catch (error) {
      this.logger.error(`Failed to auto-register project ${projectId}:`, error);
    }

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

    // 动态导入 Provider
    const ProviderModule = await this.loadProvider(providerType);
    const providerInstance = new ProviderModule() as IProvider;

    // 缓存项目配置
    this.configManager.cacheProjectConfig(projectId, config);

    // Store tmux session info if provided
    if (config.tmuxPane) {
      this.projectTmuxSessions.set(projectId, config.tmuxPane);
      this.logger.debug(`Stored tmux session for project ${projectId}: ${config.tmuxPane}`);
    }

    // 构建 ProviderConfig
    // 我们需要将特定的 provider 配置（例如 config.feishu）展开到顶层
    const providerSpecificConfig = config[providerType] || {};
    const providerConfig: ProviderConfig = {
      type: providerType,
      projectId,
      ...config,
      ...providerSpecificConfig,
    };

    // 存储 Provider first to indicate the project is registered
    this.providers.set(projectId, providerInstance);

    // 设置消息监听
    providerInstance.onMessage((message: IncomingMessage) => {
      this.handleIncomingMessage(message);
    });

    // Try to connect to the provider but don't let connection errors prevent registration
    try {
      this.logger.info(`Attempting to connect provider for project ${projectId}...`);
      await providerInstance.connect(providerConfig);
      this.logger.info(`Provider connection successful for project ${projectId}`);
      this.logger.info(`Project ${projectId} registered successfully`);
    } catch (connectionError) {
      const errorMessage = connectionError instanceof Error ? connectionError.message : String(connectionError);
      this.logger.error(`Failed to connect to provider for project ${projectId}: ${errorMessage}`);
      this.logger.error(`Stack: ${connectionError instanceof Error ? connectionError.stack : 'No stack'}`);
      // Still consider the registration successful but with failed connection
      // This allows the project to be tracked even with connection issues
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

    // Remove tmux session info
    this.projectTmuxSessions.delete(projectId);

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

    // 停止会话轮询
    this.stopSessionPolling();

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

    // 添加时间戳用于TTL处理
    (message as any).receivedAt = Date.now();
    queue.push(message);

    // 应用队列长度限制
    if (queue.length > this.MAX_QUEUE_LENGTH) {
      // 丢弃最旧的消息并记录警告
      const removedMessage = queue.shift();
      this.logger.warn(`Message queue for project ${message.projectId} exceeded max length, removed oldest message: ${removedMessage?.content?.substring(0, 50)}...`);
    }

    // 清理过期消息
    this.cleanupExpiredMessages(queue);

    this.incomingMessageQueue.set(message.projectId, queue);

    // 基于 Tmux 的输入注入
    this.injectMessageViaTmux(message).catch(err => {
      this.logger.error(`Failed to inject message via Tmux for project ${message.projectId}:`, err);
    });

    // 如果有通知发送器，立即推送通知
    if (this.notificationSender) {
      this.sendIncomingMessageNotification(message).catch(error => {
        this.logger.error('Failed to send incoming message notification:', error);
      });
    }

    this.logger.info(`Incoming message queued for ${message.projectId}: ${message.content}`);
  }

  /**
   * 清理过期消息
   */
  private cleanupExpiredMessages(queue: IncomingMessage[]) {
    const now = Date.now();
    const initialLength = queue.length;

    // 过滤掉超时的消息
    const filteredQueue = queue.filter(msg => {
      const receivedAt = (msg as any).receivedAt || now;
      return (now - receivedAt) <= this.MESSAGE_TTL;
    });

    // 如果有过期消息被清理，记录警告
    if (filteredQueue.length < initialLength) {
      this.logger.warn(`Cleaned up ${initialLength - filteredQueue.length} expired messages from queue`);
    }

    // 更新队列（通过引用传递，所以这里会修改原始队列）
    while (queue.length > 0) {
      queue.pop();
    }
    filteredQueue.forEach(msg => queue.push(msg));
  }

  /**
   * 基于 Tmux 的输入注入，反向驱动 Claude Code
   */
  /**
   * 基于 Tmux 的输入注入，反向驱动 Claude Code
   */
  private async injectMessageViaTmux(message: IncomingMessage): Promise<void> {
    const tmuxPane = this.projectTmuxSessions.get(message.projectId);
    if (!tmuxPane) {
      this.logger.warn(`No tmux session found for project ${message.projectId}`);
      return;
    }

    // 首先检查 Tmux 会话是否仍然存活
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // 使用 tmux has-session 检查会话是否存在
      const sessionName = tmuxPane.split(':')[0]; // Extract session name from pane identifier
      const checkResult = await execAsync(`tmux has-session -t ${sessionName} 2>/dev/null || true`);

      // If the session doesn't exist, unregister the project to trigger cleanup
      if (checkResult.stdout.toString().includes("no server running") ||
          checkResult.stderr.toString().includes("no server running") ||
          checkResult.stdout.toString().includes("doesn't exist")) {
        this.logger.warn(`Tmux session ${sessionName} for project ${message.projectId} is dead, unregistering project`);
        await this.unregisterProject(message.projectId);
        return;
      }
    } catch (error) {
      this.logger.error(`Failed to check tmux session status for ${tmuxPane}:`, error);
      // Continue with injection despite status check failure
    }

    // 防误触安全检查：检查当前前台进程是否为安全的 Claude 进程
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // 获取所有面板的信息并找到匹配的
      // -a 列表所有会话
      // tmuxPane 格式如 cc-p-e35341e7:0
      const paneInfoResult = await execAsync(`tmux list-panes -a -F '#{session_name}:#{window_index} #{pane_pid}:#{pane_current_command}' 2>/dev/null || true`);
      const paneInfo = paneInfoResult.stdout.toString().trim();

      // 提取当前命令（通常是前台进程名）
      const lines = paneInfo.split('\n');
      const currentCommandLine = lines.find(line => line.startsWith(tmuxPane));

      if (currentCommandLine) {
        // currentCommandLine 类似: cc-p-e35341e7:0 96915:node
        const parts = currentCommandLine.split(' ');
        if (parts.length > 1) {
          const currentCommand = parts[1].split(':')[1]?.toLowerCase() || '';

          // node 环境运行的可能是 claude，所以我们需要包含 node
          // 在 Claude Code 运行时，某些系统的 pane_current_command 会直接返回 Claude 的版本号（例如 '2.1.78'）
          // 因此我们使用正则来匹配类似数字开头的版本号格式
          const isClaudeVersion = /^\d+\.\d+\.\d+/.test(currentCommand.trim());
          
          if (!['claude', 'node', 'bash', 'zsh', 'sh'].includes(currentCommand.trim()) && !isClaudeVersion) {
            this.logger.warn(`Unsafe process detected in tmux pane ${tmuxPane}. Current command: ${currentCommand}. Injection paused for safety.`);
            return;
          }

          this.logger.debug(`Safe process check passed for tmux pane ${tmuxPane}. Current command: ${currentCommand}`);
        } else {
          this.logger.warn(`Could not parse process info in tmux pane ${tmuxPane}: ${currentCommandLine}`);
          return;
        }
      } else {
        // If we can't determine the process, default to safe behavior
        this.logger.warn(`Could not determine current process in tmux pane ${tmuxPane}, defaulting to safe mode. Injection paused.`);
        return;
      }
    } catch (error) {
      this.logger.error(`Failed to check current process in tmux pane ${tmuxPane}:`, error);
      // If we can't verify safety, don't inject for security
      return;
    }

    const content = message.content;

    // 构建注入的 prompt。告诉 Claude Code 处理新消息并调用 send_message 回传结果
    const prompt = ` ${content}\n 处理完成后，务必调用'send_message'工具将结果发回给 chat_id: ${message.chatId}.`;

    this.logger.info(`Injecting message to tmux pane ${tmuxPane} for project ${message.projectId}`);

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // 使用 tmux send-keys 注入文本并模拟按下回车
      // 对于长文本，使用单引号包裹 prompt 并进行适当转义
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      await execAsync(`tmux send-keys -t ${tmuxPane} '${escapedPrompt}' Enter`);
      this.logger.info(`Successfully injected message to tmux pane ${tmuxPane}`);
    } catch (error) {
      this.logger.error(`Tmux injection failed for pane ${tmuxPane}:`, error);
    }
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
  async handleMCPMessage(message: MCPRequest): Promise<void> {
    this.logger.debug(`MCP message: ${JSON.stringify(message)}`);

    const { method, params } = message;

    switch (method) {
      case 'tools/call':
        await this.handleToolCall(params as MCPCallRequest['params']);
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

      // 获取当前项目在队列中的待处理消息数
      const queueLength = this.incomingMessageQueue.get(projectId)?.length || 0;

      status[projectId] = {
        provider: provName,
        connected: true, // Assuming true if it's in the providers map
        queueLength,
        tmuxPane: this.projectTmuxSessions.get(projectId),
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

    // 创建副本避免修改原队列
    let messages = [...queue];

    // 如果指定了 since 时间戳，只返回该时间之后的消息
    if (since) {
      messages = messages.filter(msg => msg.timestamp > since);
    }

    // 清理过期消息
    this.cleanupExpiredMessages(queue);

    // 清空队列（返回的消息已被消费）
    this.incomingMessageQueue.set(projectId, []);

    return messages;
  }
}