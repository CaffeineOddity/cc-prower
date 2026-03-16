import TelegramBot from 'node-telegram-bot-api';
import { BaseProvider } from './base.js';
import type { IncomingMessage, ProviderConfig, TelegramConfig } from '../types/index.js';

/**
 * Telegram Provider
 * 使用 Long Polling 接收消息（无需 Webhook）
 */
export class TelegramProvider extends BaseProvider {
  private bot: TelegramBot | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    super('telegram');
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.config = config;
    const telegramConfig = config as TelegramConfig;

    const { bot_token: token } = telegramConfig;

    // 创建 bot 实例
    this.bot = new TelegramBot(token, { polling: false });

    // 设置消息处理器
    this.bot.on('message', (msg) => {
      this.handleMessage(msg);
    });

    // 开始轮询
    await this.startPolling();

    this.connected = true;
    console.log('Telegram provider connected');
  }

  private async startPolling(): Promise<void> {
    if (!this.bot) {
      return;
    }

    // 启动轮询（无限期）
    this.bot.startPolling({});

    console.log('Telegram polling started');
  }

  private handleMessage(msg: TelegramBot.Message): void {
    if (!this.config) {
      return;
    }

    // 检查是否在允许的聊天列表中
    const telegramConfig = this.config as TelegramConfig;
    if (telegramConfig.allowed_chats) {
      if (!telegramConfig.allowed_chats.includes(msg.chat.id)) {
        console.log(`Ignoring message from unauthorized chat: ${msg.chat.id}`);
        return;
      }
    }

    const incomingMessage: IncomingMessage = {
      type: 'incoming',
      provider: 'telegram',
      projectId: this.config.projectId,
      chatId: msg.chat.id.toString(),
      userId: msg.from?.id?.toString() || 'unknown',
      userName: msg.from?.username || msg.from?.first_name || 'unknown',
      content: msg.text || '',
      timestamp: Date.now(),
      metadata: {
        message_id: msg.message_id,
        chat_type: msg.chat.type,
      },
    };

    if (this.messageCallback) {
      this.messageCallback(incomingMessage);
    }
  }

  async sendMessage(chatId: string, content: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot not connected');
    }

    try {
      await this.bot.sendMessage(chatId, content);
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
    }
    this.connected = false;
    super.disconnect();
  }
}

export default TelegramProvider;