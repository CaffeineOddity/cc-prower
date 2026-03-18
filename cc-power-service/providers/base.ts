/**
 * Provider 基类
 * 所有平台适配器都应该继承这个基类
 */
import type {
  IProvider,
  IncomingMessage,
  ProviderConfig,
} from '../types/index.js';

export abstract class BaseProvider implements IProvider {
  protected config: ProviderConfig | null = null;
  protected connected: boolean = false;
  protected name: string;
  protected messageCallback: ((message: IncomingMessage) => void) | null = null;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * 连接到平台
   */
  abstract connect(config: ProviderConfig): Promise<void>;

  /**
   * 发送消息到平台
   */
  abstract sendMessage(chatId: string, content: string): Promise<void>;

  /**
   * 注册消息回调
   */
  onMessage(callback: (message: IncomingMessage) => void): void {
    this.messageCallback = callback;
  }

  /**
   * 健康检查
   */
  isHealthy(): boolean {
    return this.connected;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.messageCallback = null;
  }

  /**
   * 获取 Provider 名称
   */
  getName(): string {
    return this.name;
  }

  /**
   * 获取配置
   */
  getConfig(): ProviderConfig | null {
    return this.config;
  }

  /**
   * 触发消息事件
   */
  protected emitMessage(message: IncomingMessage): void {
    if (this.messageCallback) {
      this.messageCallback(message);
    }
  }
}