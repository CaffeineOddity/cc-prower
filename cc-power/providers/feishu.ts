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

  // Retry mechanism constants
  private retryAttempts: number = 0;
  private maxRetryAttempts: number = 5;
  private baseRetryDelay: number = 1000; // 1 second
  private maxRetryDelay: number = 30000; // 30 seconds

  constructor() {
    super('feishu');
    this.clientId = `feishu_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.config = config;
    const feishuConfig = config as FeishuConfig;

    const { app_id: appId, app_secret: appSecret } = feishuConfig;

    // Get tenant_access_token
    await this.authenticateWithRetry(appId, appSecret);

    // Try to connect WebSocket with retry mechanism
    await this.connectWebSocketWithRetry();

    this.connected = true;
    console.log('Feishu provider connected (WebSocket mode)');
  }

  /**
   * Authenticate with retry mechanism
   */
  private async authenticateWithRetry(appId: string, appSecret: string): Promise<void> {
    let attempts = 0;

    while (attempts < this.maxRetryAttempts) {
      try {
        await this.authenticate(appId, appSecret);
        this.retryAttempts = 0; // Reset on success
        return;
      } catch (error) {
        attempts++;
        this.retryAttempts = attempts;

        if (attempts >= this.maxRetryAttempts) {
          console.error(`Feishu authentication failed after ${this.maxRetryAttempts} attempts:`, error);
          throw error;
        }

        const delay = this.calculateExponentialBackoffDelay();
        console.log(`Authentication attempt ${attempts} failed, retrying in ${delay}ms...`);

        await this.sleep(delay);
      }
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateExponentialBackoffDelay(): number {
    const baseDelay = this.baseRetryDelay * Math.pow(2, this.retryAttempts);
    const cappedDelay = Math.min(baseDelay, this.maxRetryDelay);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * cappedDelay;
    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async authenticate(appId: string, appSecret: string): Promise<void> {
    const response = await this.fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
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

  /**
   * Fetch with retry mechanism
   */
  private async fetchWithRetry(url: string, options: RequestInit, maxRetries: number = 3): Promise<Response> {
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // If successful, return response
        if (response.ok) {
          return response;
        }

        // If it's the last attempt, throw the error
        if (attempt === maxRetries - 1) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Wait before retry with exponential backoff
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
        console.log(`Request failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await this.sleep(delay);
      } catch (error) {
        lastError = error;

        if (attempt === maxRetries - 1) {
          throw lastError;
        }

        // Wait before retry with exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Request failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await this.sleep(delay);
      }
    }

    throw lastError; // This line should never be reached, but added for TypeScript
  }

  private async connectWebSocketWithRetry(): Promise<void> {
    let attempts = 0;

    while (attempts < this.maxRetryAttempts) {
      try {
        await this.connectWebSocket();
        this.retryAttempts = 0; // Reset on success
        return;
      } catch (error) {
        attempts++;
        this.retryAttempts = attempts;

        if (attempts >= this.maxRetryAttempts) {
          console.error(`WebSocket connection failed after ${this.maxRetryAttempts} attempts, falling back to polling:`, error);

          // Fall back to polling if WebSocket connection fails
          this.startPolling();
          return;
        }

        const delay = this.calculateExponentialBackoffDelay();
        console.log(`WebSocket connection attempt ${attempts} failed, retrying in ${delay}ms...`);

        await this.sleep(delay);
      }
    }
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.accessToken) {
      throw new Error('No access token available for WebSocket connection');
    }

    // Get WebSocket URL from Feishu API
    const wsUrlResponse = await this.fetchWithRetry('https://open.feishu.cn/open-apis/im/v1/websocket_infos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: (this.config as FeishuConfig).app_id,
      }),
    });

    const wsUrlData: any = await wsUrlResponse.json();
    if (wsUrlData.code !== 0) {
      throw new Error(`Failed to get WebSocket URL: ${wsUrlData.msg}`);
    }

    const wsUrl = wsUrlData.data.url;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('Feishu WebSocket connected');
      this.retryAttempts = 0; // Reset retry count on successful connection
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWsMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    this.ws.on('close', (code, reason) => {
      console.log(`Feishu WebSocket closed: ${code} ${reason}`);

      // Try to reconnect after a delay
      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
      }

      this.reconnectInterval = setInterval(() => {
        this.connectWebSocketWithRetry()
          .catch(error => {
            console.error('Failed to reconnect to Feishu WebSocket:', error);
          });
      }, 5000);
    });

    this.ws.on('error', (error) => {
      console.error('Feishu WebSocket error:', error);
    });
  }

  private handleWsMessage(message: any): void {
    if (message.header?.event_type === 'im.message.receive_v1') {
      const msgData = message.event?.message;
      if (msgData && msgData.msg_type === 'text') {
        this.handleIncomingMessage(msgData);
      }
    }
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
      const response = await this.fetchWithRetry('https://open.feishu.cn/open-apis/im/v1/messages/list?container_id_type=chat&page_size=50', {
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
        await this.authenticateWithRetry(feishuConfig.app_id, feishuConfig.app_secret);
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

    const response = await this.fetchWithRetry('https://open.feishu.cn/open-apis/im/v1/messages', {
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