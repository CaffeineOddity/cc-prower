import type {
  IRouter,
  IncomingMessage,
  OutgoingMessage,
  MessageRoute,
  ProviderConfig,
  ProjectConfig,
  IProvider,
} from '../types/index.js';
import { ConfigManager } from './config.js';
import { Logger } from './logger.js';
import { MessageLogger} from './message-logger.js';

/**
 * 路由器
 * 负责消息路由和 Provider 管理
 */
export class Router implements IRouter {
  private providers = new Map<string, IProvider>(); // projectId → Provider
  private projectRoutes = new Map<string, MessageRoute>(); // chatId → MessageRoute
  private projectTmuxSessions = new Map<string, string>(); // projectId → tmuxPane
  private projectTmuxSessionsByProjectName = new Map<string, string>(); // projectName (normalized) → tmuxPane
  private configManager: ConfigManager;
  private logger: Logger;
  private messageLogger: MessageLogger;

  // 入站消息队列
  private incomingMessageQueue = new Map<string, IncomingMessage[]>(); // projectId → messages

  // 队列最大长度限制（防止内存泄漏）
  protected MAX_QUEUE_LENGTH = 50; // Changed from readonly to allow testing

  // 消息生存时间（毫秒），超过此时间的消息将被丢弃
  private readonly MESSAGE_TTL = 5 * 60 * 1000; // 5分钟

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
    // this.logger.debug('Polling tmux sessions for health check...');

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
        //   this.logger.debug(`Tmux session ${sessionName} for project ${projectId} is alive`);
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
   * 注册项目
   */
  async registerProject(projectId?: string, config?: ProjectConfig): Promise<void> {
    if (!config) {
      throw new Error('Project config is required for registration');
    }

    const { provider, project_name } = config;
    let providerType: string;
    let providerSpecificConfig: any = {};

    if (provider && typeof provider === 'object' && 'name' in provider) {
      // 新格式: provider: { name: "feishu", app_id: "...", ... }
      providerType = provider.name;
      providerSpecificConfig = provider;
    } else {
      throw new Error(`Invalid provider configuration`);
    }

    // 验证 Provider 是否启用
    if (!this.configManager.isProviderEnabled(providerType as any)) {
      throw new Error(`Provider ${providerType} is not enabled in global config`);
    }

    // 动态导入 Provider
    const ProviderModule = await this.loadProvider(providerType);
    const providerInstance = new ProviderModule() as IProvider;

    // 构建 ProviderConfig
    const providerConfig: ProviderConfig = {
      type: providerType,
      projectId: '',  // 将在 connect 后由 Provider 生成
      project_name,
      ...providerSpecificConfig,
    };

    // 先调用 connect，让 Provider 生成自己的 projectId
    try {
      this.logger.info(`Attempting to connect provider...`);
      await providerInstance.connect(providerConfig);
      this.logger.info(`Provider connection successful`);
    } catch (connectionError) {
      const errorMessage = connectionError instanceof Error ? connectionError.message : String(connectionError);
      this.logger.error(`Failed to connect to provider: ${errorMessage}`);
      this.logger.error(`Stack: ${connectionError instanceof Error ? connectionError.stack : 'No stack'}`);
      throw connectionError; // 连接失败，不继续注册
    }

    // 获取 Provider 生成的 projectId
    const actualProjectId = providerInstance.getProjectId();
    const actualProjectName = providerInstance.getProjectName();

    this.logger.info(`Registering project: ${actualProjectId} (${providerType})${actualProjectName ? ` [${actualProjectName}]` : ''}`);

    // 缓存项目配置（使用实际的 projectId）
    this.configManager.cacheProjectConfig(actualProjectId, config);

    // Store tmux session info if provided
    if (config.tmuxPane) {
      this.projectTmuxSessions.set(actualProjectId, config.tmuxPane);
      this.logger.debug(`Stored tmux session for project ${actualProjectId}: ${config.tmuxPane}`);

      // 同时按项目名称存储
      if (actualProjectName) {
        const normalizedName = actualProjectName.replace(/[^a-zA-Z0-9_-]/g, '_');
        this.projectTmuxSessionsByProjectName.set(normalizedName, config.tmuxPane);
        this.logger.debug(`Stored tmux session by project name: ${normalizedName}`);
      }
    }

    // 存储 Provider
    this.providers.set(actualProjectId, providerInstance);

    // 设置消息监听
    providerInstance.onMessage((message: IncomingMessage) => {
      this.handleIncomingMessage(message);
    });

    this.logger.info(`Project ${actualProjectId} registered successfully`);
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

    // 清理 projectTmuxSessionsByProjectName
    const projectName = provider.getProjectName();
    if (projectName) {
      const normalizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
      this.projectTmuxSessionsByProjectName.delete(normalizedName);
    }

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
  private async injectMessageViaTmux(message: IncomingMessage): Promise<void> {
    // 从消息元数据获取 project_name
    const projectName = message.metadata?.project_name;

    if (!projectName) {
      this.logger.warn(`No project_name found in message metadata for ${message.projectId}`);
      return;
    }

    // 规范化项目名称
    const normalizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');

    // 使用 project_name 查找 tmux session
    const tmuxPane = this.projectTmuxSessionsByProjectName.get(normalizedName);
    if (!tmuxPane) {
      this.logger.warn(`No tmux session found for project: ${normalizedName}`);
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
        this.logger.warn(`Tmux session ${sessionName} for project ${normalizedName} is dead, unregistering project`);
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
      // 格式: session:window_index pane_index:pane_pid:pane_current_command
      // tmuxPane 格式如 cc-p-space-ship:0 (session:window，pane 默认为 0)
      const paneInfoResult = await execAsync(`tmux list-panes -a -F '#{session_name}:#{window_index} #{pane_index}:#{pane_pid}:#{pane_current_command}' 2>/dev/null || true`);
      const paneInfo = paneInfoResult.stdout.toString().trim();

      // 提取当前命令（通常是前台进程名）
      const lines = paneInfo.split('\n');

      // 解析 tmuxPane: session:window
      const [sessionTarget, windowTarget] = tmuxPane.split(':');
      const paneTarget = '0'; // 默认使用第一个 pane

      this.logger.debug(`Looking for tmux pane: session=${sessionTarget}, window=${windowTarget}, pane=${paneTarget}`);

      // 查找匹配的 pane 信息行
      const currentCommandLine = lines.find(line => {
        const [sessionWindow, paneInfo] = line.split(' ');
        const [sessionName, windowIndex] = sessionWindow.split(':');
        const [paneIndex] = paneInfo.split(':');
        return sessionName === sessionTarget && windowIndex === windowTarget && paneIndex === paneTarget;
      });

      if (currentCommandLine) {
        const parts = currentCommandLine.split(' ');
        if (parts.length > 1) {
          const currentCommand = parts[3].split(':')[1]?.toLowerCase() || '';

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

    this.logger.info(`Injecting message to tmux pane ${tmuxPane} for project ${normalizedName}`);

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // 使用 tmux send-keys 注入文本并模拟按下回车
      // 对于长文本，使用单引号包裹 prompt 并进行适当转义
      const escapedPrompt = prompt.replace(/'/g, "'\\''");

      // 构建 send-keys 命令，精确指定目标 pane
      // tmuxPane 格式: "session:window.pane" (e.g., "cc-p-space-ship:0")
      const sendKeysCmd = `tmux send-keys -t ${tmuxPane} '${escapedPrompt}' Enter`;

      this.logger.debug(`Send-keys command: ${sendKeysCmd}`);

      await execAsync(sendKeysCmd);
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
   * 获取入站消息（用于测试）
   */
  getIncomingMessages(projectId: string): IncomingMessage[] {
    return this.incomingMessageQueue.get(projectId) || [];
  }
}