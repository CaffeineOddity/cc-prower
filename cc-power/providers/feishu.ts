import WebSocket from 'ws';
import { BaseProvider } from './base.js';
import type { IncomingMessage, ProviderConfig, FeishuConfig } from '../types/index.js';

/**
 * 飞书 (Feishu/Lark) Provider
 * 使用 WebSocket 长连接接收消息
 */
export class FeishuProvider extends BaseProvider {
  private ws: WebSocket | null = null;
  private clientId: string;
  private accessToken: string | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super('feishu');
    this.clientId = `feishu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.config = config;
    const feishuConfig = config as FeishuConfig;

    const { app_id: appId, app_secret: appSecret } = feishuConfig;

    // Get tenant_access_token
    await this.authenticate(appId, appSecret);

    // Start polling for messages (fallback for WebSocket issues)
    this.startPolling();

    // Try to connect WebSocket
    try {
      await this.connectWebSocket();
    } catch (error) {
      console.log('WebSocket connection failed, using polling mode:', error);
      // Polling mode is already started, continue with that
    }

    this.connected = true;
    console.log('Feishu provider connected (polling mode)');
  }

  private async authenticate(appId: string, appSecret: string): Promise<void> {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret,
      }),
    });

    const data = (await response.json()) as any;

    if (data.code !== 0) {
      throw new Error(`Feishu auth failed: ${data.msg}`);
    }

    this.accessToken = data.tenant_access_token;
    console.log('Feishu authenticated successfully');
  }

  private async connectWebSocket(): Promise<void> {
    // Note: Feishu WebSocket requires proper authentication and specific URL format
    // For now, we'll use polling as it's more reliable
    throw new Error('WebSocket not implemented, using polling mode');
  }

  private startPolling(): void {
    // Poll for new messages every 5 seconds
    this.pollingInterval = setInterval(async () => {
      await this.pollMessages();
    }, 5000);
  }

  private async pollMessages(): Promise<void> {
    if (!this.accessToken) {
      return;
    }

    try {
      // List recent messages
      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages/list?container_id_type=chat&page_size=50', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const data = (await response.json()) as any;

      if (data.code === 99991668 || data.code === 99991663 || data.code === 99991664) {
        // Token expired, re-authenticate
        console.log('Feishu token expired, re-authenticating...');
        const feishuConfig = this.config as FeishuConfig;
        await this.authenticate(feishuConfig.app_id, feishuConfig.app_secret);
        return;
      }

      if (data.code === 0 && data.data?.items) {
        for (const item of data.data.items) {
          // Process only text messages
          if (item.msg_type === 'text') {
            await this.handleIncomingMessage(item);
          }
        }
      }
    } catch (error) {
      console.error('Error polling messages:', error);
    }
  }

  private async handleIncomingMessage(message: any): Promise<void> {
    try {
      const content = JSON.parse(message.content);
      const textContent = content.text || '';

      if (!textContent) {
        return;
      }

      const incomingMessage: IncomingMessage = {
        type: 'incoming',
        provider: 'feishu',
        projectId: this.config?.projectId || '',
        chatId: message.chat_id,
        userId: message.sender?.id || 'unknown',
        userName: message.sender?.name || 'Unknown',
        content: textContent,
        timestamp: message.create_time || Date.now(),
        metadata: {
          message_id: message.message_id,
          message_type: message.msg_type,
        },
      };

      if (this.messageCallback) {
        this.messageCallback(incomingMessage);
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        receive_id_type: 'chat_id',
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      }),
    });

    const data = (await response.json()) as any;

    if (data.code !== 0) {
      throw new Error(`Failed to send message: ${data.msg}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    this.connected = false;
    this.accessToken = null;
    super.disconnect();
  }
}

export default FeishuProvider;