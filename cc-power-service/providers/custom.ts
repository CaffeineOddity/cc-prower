import { BaseProvider } from './base.js';
import type { IncomingMessage, CustomTemplateConfig,CustomConfig } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage as HttpIncomingMessage } from 'http';
import { ConfigManager } from '../core/config.js';

// WebSocket 消息结构
interface WebSocketMessage<T = Record<string, any>> {
  type: 'heartbeat' | 'connected' | 'llm' | 'error';
  project_name: string;
  provider: CustomConfig;
  data?: T;
  timestamp: number;
}

// WebSocket 客户端连接信息
interface ClientConnection {
  app_id: string;
  ws: WebSocket;
  connectedAt: number;
  lastHeartbeat: number;
}

/**
 * Custom Provider
 * 为自定义应用提供 WebSocket 接入 Claude Code 的能力
 */
export class CustomProvider extends BaseProvider {
  private server: WebSocketServer | null = null;
  private port!: number;
  private apiKey!: string;
  private clients = new Map<string, ClientConnection>();  // app_id → connection
  private configManager: ConfigManager;

  private logger: Logger;

  // 心跳配置
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000;  // 30 秒
  private readonly CLIENT_TIMEOUT = 90000;      // 90 秒无心跳则断开

  constructor(configManager: ConfigManager, logger?: Logger) {
    super('custom');
    this.configManager = configManager;
    this.logger = logger || new Logger({ level: 'info' });
  }

  async connect(config: CustomTemplateConfig): Promise<void> {
    this.config = config;
    this.projectName = config.project_name;
    const { provider } = config;
    this.apiKey = provider.api_key;

    // 从全局配置读取 WebSocket 端口
    const globalConfig = this.configManager.getGlobalConfig();
    if (!globalConfig?.WebSocket) {
      throw new Error('WebSocket configuration not found in global config');
    }
    this.port = globalConfig.WebSocket.port || 8080;

    // 启动前 kill 掉占用该端口的进程
    await this.killPortProcess(this.port);

    await this.startWebSocketServer();
    this.startHeartbeat();
    this.connected = true;

    this.logger.info(`Custom provider started: ws://127.0.0.1:${this.port}`);
    console.log(`Custom provider started: ws://127.0.0.1:${this.port}`);
  }

  /**
   * 杀掉占用指定端口的进程
   */
  private async killPortProcess(port: number): Promise<void> {
    try {
      const { exec } = await import('child_process');
      await new Promise<void>((resolve) => {
        const command = `lsof -ti :${port} 2>/dev/null | xargs kill -9 2>/dev/null || true`;
        exec(command, () => {
          this.logger.debug(`Checked and cleared port ${port}`);
          resolve();
        });
      });
    } catch (error) {
      this.logger.warn(`Failed to kill process on port ${port}:`, error);
    }
  }

  private async startWebSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = new WebSocketServer({ port: this.port });

        this.server.on('listening', () => {
          this.logger.debug(`WebSocket server listening on port ${this.port}`);
          resolve(void 0);
        });

        this.server.on('error', (error) => {
          this.logger.error(`WebSocket server error:`, error);
          reject(error);
        });

        this.server.on('connection', (ws: WebSocket, req: HttpIncomingMessage) => {
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const apiKey = url.searchParams.get('api_key');
          if (apiKey !== this.apiKey) {
            this.logger.warn(`Unauthorized connection attempt with api_key: ${apiKey}`);
            ws.close(1008, 'Unauthorized');
            return;
          }
          const app_id = url.searchParams.get('app_id') || 'unknown';
          this.handleClientConnect(app_id, ws);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleClientConnect(app_id: string, ws: WebSocket): void {
    const connection: ClientConnection = {
      app_id,
      ws,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.clients.set(app_id, connection);
    this.logger.info(`Client connected: ${app_id}`);
    // 发送连接确认
    this.sendToClient(app_id, {
      type: 'connected',
      data: {
        app_id,
        server_version: '1.0.0'
      },
      timestamp: Date.now(),
      project_name: this.projectName || '',
      provider: (this.config!.provider as CustomConfig) || { name: 'custom', app_id, api_key: '' },
    });

    ws.on('message', (rawMessage: Buffer) => {
      this.handleClientMessage(ws, rawMessage);
    });

    ws.on('close', () => {
      this.handleClientDisconnect(app_id);
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket error for ${app_id}:`, error);
    });
  }

  private handleClientMessage(ws: WebSocket, rawMessage: Buffer): void {
    try {
      const message: WebSocketMessage = JSON.parse(rawMessage.toString());

      // 处理不同类型的消息
      switch (message.type) {
        case 'llm':
          this.handleLLMMessage(message);
          break;
        case 'heartbeat':
          // 客户端发送 pong
          if (message.data?.action === 'pong') {
            const client = this.clients.get(message.provider.app_id!);
            if (client) {
              client.lastHeartbeat = Date.now();
            }
          }
          break;
        default:
          this.logger.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.logger.error('Failed to handle client message:', error);
    }
  }

  private handleLLMMessage(message: WebSocketMessage): void {
    if (!message.provider.app_id) {
      this.logger.warn(`LLM message missing app_id in metadata: ${JSON.stringify(message)}`);
      return;
    }

    const incomingMessage: IncomingMessage = {
      type: 'incoming',
      provider: 'custom',
      projectId: this.getProjectId(),
      chatId: message.provider.app_id || '',
      userId: message.provider.app_id || '',
      content: message.data?.content || '',
      timestamp: message.timestamp,
      metadata: {
        project_name: this.projectName,
        ...message.data?.metadata,
      },
    };

    if (this.messageCallback) {
      this.messageCallback(incomingMessage);
    }
    this.logger.info(`LLM message received from ${message.provider.app_id}: ${incomingMessage.content.substring(0, 50)}...`);
  }

  private sendToClient(app_id: string, message: WebSocketMessage): void {
    const client = this.clients.get(app_id);
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
    }
  }
  
  private handleClientDisconnect(app_id: string): void {
    this.clients.delete(app_id);
    this.logger.info(`Client disconnected: ${app_id}`);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.CLIENT_TIMEOUT;

      for (const [app_id, connection] of this.clients.entries()) {
        if (now - connection.lastHeartbeat > timeout) {
          this.logger.info(`Client timeout, disconnecting: ${app_id}`);
          connection.ws.close();
          this.clients.delete(app_id);
          continue;
        }

        if (connection.ws.readyState === 1) {
          const template: CustomTemplateConfig = this.config as CustomTemplateConfig;
          connection.ws.send(JSON.stringify({
            type: 'heartbeat',
            app_id:template?.provider?.app_id || '',
            data: { action: 'ping' },
            timestamp: now,
          }));
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  async sendMessage(chatId: string, content: string, metadata?: any): Promise<void> {
    const app_id = chatId;
    this.sendToClient(app_id, {
      type: 'llm',
      project_name: this.projectName || '',
      provider: (this.config!.provider as CustomConfig) || { name: 'custom', app_id, api_key: '' },
      data: {
        success: true,
        content,
        metadata: {
          duration: metadata?.duration,
          transcript_path: metadata?.transcript_path,
        }
      },
      timestamp: Date.now(),
    });
    this.logger.info(`LLM response sent to ${app_id}`);
  }

  async disconnect(): Promise<void> {
    for (const [app_id, connection] of this.clients.entries()) {
      connection.ws.close();
    }
    this.clients.clear();

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.server?.close();
    this.connected = false;
    this.logger.info('Custom provider disconnected');
    console.log('Custom provider disconnected');
  }
}