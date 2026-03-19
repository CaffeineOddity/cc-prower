import * as lark from '@larksuiteoapi/node-sdk';
import { Logger } from './logger.js';

/**
 * Provider 注册信息
 */
interface ProviderRegistration {
  projectId: string;
  chatId: string;
  priority: number;
  keyword?: string;
  onMessage: (message: any) => void;
}

/**
 * WebSocket 连接信息
 */
interface WSConnection {
  client: lark.WSClient | null;
  apiClient: lark.Client;
  eventDispatcher: lark.EventDispatcher;
  providers: Set<string>; // providerId set
  secret: string;
  // 重连状态
  reconnectAttempts: number;
  reconnectTimer?: NodeJS.Timeout;
  isReconnecting: boolean;
  // 连接状态
  connected: boolean;
}

/**
 * 飞书连接管理器
 * 单例模式，负责管理 WebSocket 连接和消息路由
 */
export class FeishuConnectionManager {
  private static instance: FeishuConnectionManager;

  // app_id -> WSConnection
  private connections = new Map<string, WSConnection>();

  // chat_id -> ProviderRegistration[]
  private chatRoutes = new Map<string, ProviderRegistration[]>();

  // providerId -> { app_id, chat_id } 用于清理
  private providerToApp = new Map<string, { appId: string; chatId: string }>();

  private logger: Logger;
  private nextProviderId = 0;

  // 重连配置
  private readonly MAX_RECONNECT_ATTEMPTS = 20;
  private readonly INITIAL_RECONNECT_DELAY = 2000; // 2秒
  private readonly MAX_RECONNECT_DELAY = 60000; // 60秒

  private constructor(logger?: Logger) {
    this.logger = logger || new Logger({ level: 'info' });
  }

  /**
   * 获取单例实例
   */
  static getInstance(logger?: Logger): FeishuConnectionManager {
    if (!FeishuConnectionManager.instance) {
      FeishuConnectionManager.instance = new FeishuConnectionManager(logger);
    }
    return FeishuConnectionManager.instance;
  }

  /**
   * 计算重连延迟（指数退避）
   */
  private getReconnectDelay(attempts: number): number {
    const delay = this.INITIAL_RECONNECT_DELAY * Math.pow(2, attempts);
    return Math.min(delay, this.MAX_RECONNECT_DELAY);
  }

  /**
   * 重连 WebSocket
   */
  private async reconnect(appId: string, appSecret: string): Promise<void> {
    const connection = this.connections.get(appId);
    if (!connection || connection.isReconnecting) {
      return;
    }

    if (connection.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(`Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for app_id: ${appId}`);
      connection.isReconnecting = false;
      return;
    }

    connection.isReconnecting = true;
    connection.reconnectAttempts++;

    const delay = this.getReconnectDelay(connection.reconnectAttempts - 1);
    this.logger.info(`Attempting to reconnect ${appId} in ${delay}ms (attempt ${connection.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    connection.reconnectTimer = setTimeout(async () => {
      try {
        // 清理旧的连接
        if (connection.client) {
          try {
            // 尝试关闭旧客户端
            (connection.client as any)?.stop?.();
          } catch (e) {
            // 忽略关闭错误
          }
        }
        connection.client = null;

        // 创建新的连接
        const { client, apiClient, eventDispatcher } = await this.createWebSocket(appId, appSecret);

        // 更新连接信息
        connection.client = client;
        connection.apiClient = apiClient;
        connection.eventDispatcher = eventDispatcher;
        connection.reconnectAttempts = 0;
        connection.isReconnecting = false;
        connection.connected = true;

        this.logger.info(`Successfully reconnected to WebSocket for app_id: ${appId}`);
      } catch (error) {
        connection.isReconnecting = false;
        // 检查是否是飞书限流错误 (code: 1000040350)
        const errorMsg = String(error);
        this.logger.error(`Reconnect attempt ${connection.reconnectAttempts} failed for app_id ${appId}: ${errorMsg}`);
        if (errorMsg.includes('1000040350') || errorMsg.includes('system busy')) {
          // 对于限流错误，直接继续重连（指数退避）
          this.reconnect(appId, appSecret);
        } else if (errorMsg.includes('PingInterval')) {
          this.reconnect(appId, appSecret);
        } else {
          // 其他错误也继续重连
          this.reconnect(appId, appSecret);
        }
      }
    }, delay);
  }

  /**
   * 创建 WebSocket 连接
   */
  private async createWebSocket(appId: string, appSecret: string): Promise<{
    client: lark.WSClient;
    apiClient: lark.Client;
    eventDispatcher: lark.EventDispatcher;
  }> {
    // 创建 API Client
    const apiClient = new lark.Client({
      appId,
      appSecret,
    });

    // 创建事件分发器
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        this.logger.info(`createWebSocket Received message: ${JSON.stringify(data)}`);
        this.handleMessage(appId, data);
        return {};
      },
    });

    // 创建 WebSocket 客户端
    const client = new lark.WSClient({
      appId,
      appSecret,
      logger: {
        trace: (msg) => console.log(`[Feishu WS ${appId}]`, msg),
        debug: (msg) => console.log(`[Feishu WS ${appId}]`, msg),
        info: (msg) => console.log(`[Feishu WS ${appId}]`, msg),
        warn: (msg) => console.warn(`[Feishu WS ${appId}]`, msg),
        error: (msg) => console.error(`[Feishu WS ${appId}]`, msg),
      }
    });

    try {
      client.start({ eventDispatcher });
      this.logger.info(`WebSocket connection started for app_id: ${appId}`);

      // 等待连接建立
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 15000); // 15秒超时

        // 监听连接状态变化
        // 注意：SDK 可能没有直接的连接事件，这里简单等待
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, 2000); // 给SDK一些时间建立连接
      });

    } catch (error) {
      this.logger.error(`Failed to start WebSocket for app_id ${appId}:`, error);
      throw error;
    }

    return { client, apiClient, eventDispatcher };
  }

  /**
   * 获取或创建 WebSocket 连接
   */
  async getOrConnect(appId: string, appSecret: string): Promise<{
    client: lark.WSClient | null;
    apiClient: lark.Client;
    eventDispatcher: lark.EventDispatcher;
  }> {
    let connection = this.connections.get(appId);

    if (!connection) {
      this.logger.info(`Creating new WebSocket connection for app_id: ${appId}`);

      // 创建 WebSocket 连接
      const { client, apiClient, eventDispatcher } = await this.createWebSocket(appId, appSecret);

      connection = {
        client,
        apiClient,
        eventDispatcher,
        providers: new Set(),
        secret: appSecret,
        reconnectAttempts: 0,
        isReconnecting: false,
        connected: true,
      };

      this.connections.set(appId, connection);
    } else if (!connection.connected) {
      // 连接已断开，尝试重连
      this.logger.warn(`Connection ${appId} is disconnected, attempting reconnect...`);
      await this.reconnect(appId, appSecret);
    }

    return {
      client: connection.client,
      apiClient: connection.apiClient,
      eventDispatcher: connection.eventDispatcher,
    };
  }

  /**
   * 注册 Provider 到路由表
   */
  registerProvider(
    appId: string,
    projectId: string,
    chatId: string,
    priority: number,
    keyword: string | undefined,
    onMessage: (message: any) => void
  ): string {
    const providerId = `provider_${this.nextProviderId++}`;

    // 添加到连接
    const connection = this.connections.get(appId);
    if (connection) {
      connection.providers.add(providerId);
    }

    // 添加到路由表
    const registration: ProviderRegistration = {
      projectId,
      chatId,
      priority,
      keyword,
      onMessage,
    };

    let routes = this.chatRoutes.get(chatId);
    if (!routes) {
      routes = [];
      this.chatRoutes.set(chatId, routes);
    }

    routes.push(registration);

    // 按 priority 降序排序，相同 priority 时有 keyword 的排在前面
    routes.sort((a, b) => {
      // 如果一个有keyword一个没有，有keyword的优先检查
      const aHasKeyword = !!a.keyword;
      const bHasKeyword = !!b.keyword;
      if (aHasKeyword !== bHasKeyword) {
        return aHasKeyword ? -1 : 1;  // keyword first
      }
      // 否则按 priority 降序
      return b.priority - a.priority;
    });

    // 记录映射关系
    this.providerToApp.set(providerId, { appId, chatId });

    this.logger.info(`Registered provider ${providerId} for project ${projectId}, chat ${chatId}, priority ${priority}`);

    return providerId;
  }

  /**
   * 注销 Provider
   */
  unregisterProvider(providerId: string): void {
    const mapping = this.providerToApp.get(providerId);
    if (!mapping) {
      return;
    }

    const { appId, chatId } = mapping;

    // 从连接中移除
    const connection = this.connections.get(appId);
    if (connection) {
      connection.providers.delete(providerId);

      // 如果该连接没有 Provider 使用了，关闭连接
      if (connection.providers.size === 0) {
        this.logger.info(`Closing WebSocket connection for app_id: ${appId} (no more providers)`);
        connection.client = null;
        this.connections.delete(appId);
      }
    }

    // 从路由表中移除
    const routes = this.chatRoutes.get(chatId);
    if (routes) {
      const index = routes.findIndex(r => r.projectId === providerId);
      if (index !== -1) {
        routes.splice(index, 1);
      }

      // 如果没有路由了，删除条目
      if (routes.length === 0) {
        this.chatRoutes.delete(chatId);
      }
    }

    // 删除映射
    this.providerToApp.delete(providerId);

    this.logger.info(`Unregistered provider ${providerId}`);
  }

  /**
   * 处理来自 WebSocket 的消息
   */
  private handleMessage(appId: string, data: any): void {
    const message = data.message;
    const sender = data.sender;

    if (!message) {
      return;
    }

    const chatId = message.chat_id;

    // 获取该 chat_id 的所有 Provider
    const routes = this.chatRoutes.get(chatId);
    if (!routes || routes.length === 0) {
      this.logger.debug(`No routes found for chat ${chatId}`);
      return;
    }

    // 解析消息内容
    let content = '';
    try {
      const parsed = JSON.parse(message.content);
      content = parsed.text || '';
    } catch (error) {
      this.logger.warn(`Failed to parse message content:`, error);
      return;
    }

    // 遍历路由，找到第一个匹配的 Provider
    for (const route of routes) {
      // 检查关键词匹配
      if (route.keyword && !content.includes(route.keyword)) {
        this.logger.debug(`Keyword ${route.keyword} not matched, skipping`);
        continue;
      }

      // 找到匹配的 Provider
      this.logger.info(`Routing message to project ${route.projectId} (priority ${route.priority})`);
      route.onMessage({ message, sender });
      return; // 只触发一个
    }

    this.logger.debug(`No provider matched for message in chat ${chatId}`);
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): Record<string, any> {
    const status: Record<string, any> = {};

    for (const [appId, connection] of this.connections) {
      status[appId] = {
        connected: connection.connected,
        providerCount: connection.providers.size,
        reconnectAttempts: connection.reconnectAttempts,
        isReconnecting: connection.isReconnecting,
      };
    }

    return status;
  }

  /**
   * 获取路由状态
   */
  getRouteStatus(): Record<string, any> {
    const status: Record<string, any> = {};

    for (const [chatId, routes] of this.chatRoutes) {
      status[chatId] = routes.map(r => ({
        projectId: r.projectId,
        priority: r.priority,
        keyword: r.keyword || null,
      }));
    }

    return status;
  }

  /**
   * 清理所有连接
   */
  cleanup(): void {
    this.logger.info('Cleaning up FeishuConnectionManager...');

    for (const [appId, connection] of this.connections) {
      try {
        // 清除重连定时器
        if (connection.reconnectTimer) {
          clearTimeout(connection.reconnectTimer);
        }
        connection.client = null;
        this.logger.info(`Closed connection for app_id: ${appId}`);
      } catch (error) {
        this.logger.error(`Error closing connection for app_id ${appId}:`, error);
      }
    }

    this.connections.clear();
    this.chatRoutes.clear();
    this.providerToApp.clear();

    this.logger.info('FeishuConnectionManager cleanup complete');
  }
}