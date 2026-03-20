/**
 * Provider 基类
 * 所有平台适配器都应该继承这个基类
 */
import type {
  IProvider,
  IncomingMessage,
  TemplateProviderConfig,
} from '../types/index.js';
import { get_project_id } from '../types/provider.config.js';
export abstract class BaseProvider implements IProvider {
  protected config: TemplateProviderConfig | null = null;
  protected connected: boolean = false;
  protected name: string;
  protected messageCallback: ((message: IncomingMessage) => void) | null = null;
  protected projectName?: string;  // 新增：项目名称

  constructor(name: string) {
    this.name = name;
  }

  /**
   * 连接到平台
   */
  abstract connect(config: TemplateProviderConfig): Promise<void>;

  /**
   * 发送消息到平台
   */
  abstract sendMessage(chatId: string, content: string): Promise<void>;

  /**
   * 获取项目名称
   */
  getProjectName(): string | undefined {
    return this.projectName;
  }

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
  getConfig(): TemplateProviderConfig | null {
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

    /**
     * 生成 projectId: ${app_id}_${chat_id}
     */
    getProjectId(): string {
        if (!this.config) {
        throw new Error('Feishu provider not connected');
        }
        return get_project_id(this.config);
    }
}
