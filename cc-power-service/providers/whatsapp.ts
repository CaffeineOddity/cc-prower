import { BaseProvider } from './base.js';
import type { IncomingMessage, ProviderConfig, WhatsAppConfig } from '../types/index.js';

/**
 * WhatsApp Provider
 * 使用 WhatsApp Business API
 */
export class WhatsAppProvider extends BaseProvider {
  private baseUrl: string;
  private phoneNumber!: string;
  private apiKey!: string;
  private accessToken: string | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastMessageTimestamp: number = 0;
  private chatId: string = '';

  constructor() {
    super('whatsapp');
    this.baseUrl = 'https://graph.facebook.com/v19.0';
  }

  /**
   * 生成 projectId: ${phone_number}_${chat_id}
   */
  getProjectId(): string {
    return `${this.phoneNumber}_${this.chatId}`;
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.config = config;
    const whatsappConfig = config as WhatsAppConfig;

    this.phoneNumber = whatsappConfig.phone_number;
    this.apiKey = whatsappConfig.api_key;
    this.chatId = whatsappConfig.chat_id || '';

    // 保存项目名称
    this.projectName = config.project_name;

    // 获取 access token
    await this.authenticate();

    // 开始轮询消息
    await this.startPolling();

    this.connected = true;
    console.log('WhatsApp provider connected');
  }

  private async authenticate(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${this.phoneNumber}/messages`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`WhatsApp auth failed: ${response.statusText}`);
    }

    this.accessToken = this.apiKey;
    console.log('WhatsApp authenticated successfully');
  }

  private async startPolling(): Promise<void> {
    // 轮询检查新消息
    this.pollInterval = setInterval(async () => {
      await this.checkMessages();
    }, 5000); // 每 5 秒检查一次

    console.log('WhatsApp polling started');
  }

  private async checkMessages(): Promise<void> {
    if (!this.accessToken) {
      return;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/${this.phoneNumber}/messages?limit=20`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
        }
      );

      if (!response.ok) {
        console.error('Failed to check messages:', response.statusText);
        return;
      }

      const data = (await response.json()) as any;

      if (!data.data) {
        return;
      }

      // 处理消息
      for (const message of data.data as any[]) {
        // 只处理入站消息（来自用户）
        if (message.direction !== 'inbound') {
          continue;
        }

        // 跳过已处理的消息
        const messageTimestamp = new Date(message.timestamp).getTime();
        if (messageTimestamp <= this.lastMessageTimestamp) {
          continue;
        }

        this.lastMessageTimestamp = messageTimestamp;
        await this.handleMessage(message);
      }
    } catch (error) {
      console.error('Error checking messages:', error);
    }
  }

  private async handleMessage(message: any): Promise<void> {
    const {
      id,
      from,
      to,
      timestamp,
      text,
      type,
    } = message;

    // 检查是否在允许的号码列表中
    const whatsappConfig = this.config as WhatsAppConfig;
    if (whatsappConfig.allowed_numbers) {
      if (!whatsappConfig.allowed_numbers.includes(from)) {
        console.log(`Ignoring message from unauthorized number: ${from}`);
        return;
      }
    }

    const incomingMessage: IncomingMessage = {
      type: 'incoming',
      provider: 'whatsapp',
      projectId: this.getProjectId(),  // 使用自动生成的 projectId
      chatId: from,
      userId: from,
      content: text?.body || '',
      timestamp: Date.now(),
      metadata: {
        project_name: this.projectName,  // 添加项目名称到元数据
        phone_number: this.phoneNumber,
        chat_id: this.chatId || from,
        message_id: id,
        message_type: type,
        to,
      },
    };

    this.emitMessage(incomingMessage);
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('WhatsApp not authenticated');
    }

    const response = await fetch(
      `${this.baseUrl}/${this.phoneNumber}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: chatId,
          type: 'text',
          text: {
            preview_url: false,
            body: content,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send WhatsApp message: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.connected = false;
    this.accessToken = null;
    super.disconnect();
  }
}

export default WhatsAppProvider;