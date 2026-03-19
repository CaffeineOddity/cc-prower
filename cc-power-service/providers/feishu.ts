import * as lark from '@larksuiteoapi/node-sdk';
import { BaseProvider } from './base.js';
import type { IncomingMessage, ProviderConfig, FeishuConfig } from '../types/index.js';
import { FeishuConnectionManager } from './feishu-connection-manager.js';
import { Logger } from '../core/logger.js';

/**
 * 飞书 (Feishu/Lark) Provider
 * 使用官方 SDK 建立 WebSocket 长连接接收消息
 */
export class FeishuProvider extends BaseProvider {
  private apiClient: lark.Client | null = null;
  private connectionManager: FeishuConnectionManager;
  private providerId: string | null = null;
  private logger: Logger;
  private userNameCache: Map<string, string> = new Map();
  private appId: string = '';
  private chatId: string = '';

  constructor() {
    super('feishu');
    this.logger = new Logger({ level: 'info' });
    this.connectionManager = FeishuConnectionManager.getInstance(this.logger);
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.config = config;
    const feishuConfig = config as FeishuConfig;

    const { app_id: appId, app_secret: appSecret, chat_id: chatId, priority = 0, keyword } = feishuConfig;

    if (!appId || !appSecret) {
      throw new Error('Feishu configuration missing app_id or app_secret');
    }

    if (!chatId) {
      throw new Error('Feishu configuration missing chat_id');
    }

    // 保存 appId 和 chatId 供后续使用
    this.appId = appId;
    this.chatId = chatId;

    // 使用连接管理器获取 WebSocket 连接和 API Client
    this.logger.info(`Attempting to get or connect WebSocket for app_id: ${appId}`);
    const { apiClient, eventDispatcher } = await this.connectionManager.getOrConnect(appId, appSecret);
    this.apiClient = apiClient;
    this.logger.info(`WebSocket connection obtained for app_id: ${appId}`);

    // 注册 Provider 到路由表
    this.providerId = this.connectionManager.registerProvider(
      appId,
      config.projectId,
      chatId,
      priority,
      keyword,
      (data) => this.handleWsMessage(data, config)
    );

    this.connected = true;
    this.logger.info(`Feishu provider connected (chat_id: ${chatId}, priority: ${priority}${keyword ? `, keyword: ${keyword}` : ''})`);
  }

  private async getUserName(userId: string): Promise<string> {
    if (this.userNameCache.has(userId)) {
      return this.userNameCache.get(userId)!;
    }

    if (this.apiClient && userId !== 'unknown') {
      try {
        const resp = await this.apiClient.contact.user.get({
          path: { user_id: userId },
          params: { user_id_type: 'open_id' }
        });

        if (resp.code === 0 && resp.data?.user?.name) {
          const name = resp.data.user.name;
          this.userNameCache.set(userId, name);
          return name;
        }
      } catch (error) {
        this.logger.debug(`[Feishu] Failed to get user name for ${userId}, might lack permissions:`, (error as Error).message);
      }
    }

    return 'Unknown';
  }

  private handleWsMessage(data: { message: any; sender?: any }, config?: any): void {
    const message = data.message;
    const sender = data.sender;

    if (message && (message.msg_type === 'text' || message.message_type === 'text')) {
      this.logger.info(`handleIncomingMessage: ${data}`);
      this.handleIncomingMessage(message, sender, config);
    } else {
        this.logger.info(`[Feishu] Ignoring non-text message: ${JSON.stringify(message)}`);
    }
  }

  private async handleIncomingMessage(message: any, sender?: any, config?: any): Promise<void> {
    try {

      const content = JSON.parse(message.content);
      let textContent = content.text || '';

      // 移除提及（mentions），例如 "@_user_1 "
      if (message.mentions && Array.isArray(message.mentions)) {
        message.mentions.forEach((mention: any) => {
          if (mention.key) {
            // 使用正则移除 mention key 及其后可能跟随的空格
            const mentionRegex = new RegExp(`${mention.key}\\s*`, 'g');
            textContent = textContent.replace(mentionRegex, '');
          }
        });
      }

      if (!textContent) {
        return;
      }

      // Extract sender info, either from sender arg or message.sender (for compatibility)
      const actualSender = sender || message.sender;
      const senderId = actualSender?.sender_id || actualSender?.id || {};
      const userId = senderId.open_id || senderId.union_id || 'unknown';

      const senderName = await this.getUserName(userId);
      this.logger.info(`[Feishu] Received message from ${senderName}: ${textContent}`);

      const incomingMessage: IncomingMessage = {
        type: 'incoming',
        provider: 'feishu',
        projectId: this.config?.projectId || config?.projectId || '',
        chatId: message.chat_id,
        userId: userId,
        userName: senderName,
        content: textContent,
        timestamp: message.create_time || Date.now(),
        metadata: {
          message_id: message.message_id,
          message_type: message.message_type || message.msg_type,
          app_id: config?.app_id || '',
        },
      };

      if (this.messageCallback) {
        this.messageCallback(incomingMessage);
      }
    } catch (error) {
      this.logger.error('Error handling incoming message:', error);
    }
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.apiClient) {
      throw new Error('Not authenticated');
    }

    try {
      this.logger.info(`[Feishu] Sending message to ${chatId}: ${content}`);

      const response = await this.apiClient.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        }
      });
      if (response.code !== 0) {
        throw new Error(`Failed to send message: ${response.msg}`);
      }
    } catch (error) {
      this.logger.error('Failed to send Feishu message:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.providerId) {
      this.connectionManager.unregisterProvider(this.providerId);
      this.providerId = null;
    }
    this.connected = false;
    this.apiClient = null;
    super.disconnect();
    this.logger.info('[Feishu] Disconnected');
  }
}

export default FeishuProvider;
