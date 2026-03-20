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
  private botToken: string = '';
  private chatId: string = '';

  constructor() {
    super('telegram');
  }

  /**
   * 生成 projectId: ${bot_token_prefix}_${chat_id}
   * 使用 token 的前 8 位作为前缀，避免过长的 projectId
   */
  getProjectId(): string {
    const tokenPrefix = this.botToken.substring(0, 8);
    return `${tokenPrefix}_${this.chatId}`;
  }

  async connect(config: ProviderConfig): Promise<void> {
    this.config = config;
    const telegramConfig = config as TelegramConfig;

    const { bot_token: token, chat_id: chatId } = telegramConfig;

    if (!token) {
      throw new Error('Telegram configuration missing bot_token');
    }

    // 保存 bot_token 和 chatId
    this.botToken = token;
    this.chatId = chatId || '';

    // 保存项目名称
    this.projectName = config.project_name;

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
      projectId: this.getProjectId(),  // 使用自动生成的 projectId
      chatId: msg.chat.id.toString(),
      userId: msg.from?.id?.toString() || 'unknown',
      userName: msg.from?.username || msg.from?.first_name || 'unknown',
      content: msg.text || '',
      timestamp: Date.now(),
      metadata: {
        project_name: this.projectName,  // 添加项目名称到元数据
        bot_token_prefix: this.botToken.substring(0, 8),
        chat_id: this.chatId || msg.chat.id.toString(),
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