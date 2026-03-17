import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * MCP 服务器需要调用的后端服务接口
 */
export interface BackendService {
  /**
   * 注册项目
   */
  registerProject(projectId: string, config: any): Promise<void>;

  /**
   * 取消注册项目
   */
  unregisterProject(projectId: string): Promise<void>;

  /**
   * 发送消息
   */
  sendMessage(args: {
    provider: string;
    chat_id: string;
    content: string;
    project_id?: string;
  }): Promise<any>;

  /**
   * 列出聊天
   */
  listChats(args: {
    provider: string;
    project_id?: string;
  }): Promise<any>;

  /**
   * 获取状态
   */
  getStatus(args: { provider?: string }): Promise<any>;

  /**
   * 获取已注册的项目
   */
  getRegisteredProjects(): string[];

  /**
   * 日志记录
   */
  logDebug(message: string, ...args: any[]): void;
  logInfo(message: string, ...args: any[]): void;
  logWarn(message: string, ...args: any[]): void;
  logError(message: string, ...args: any[]): void;

  /**
   * 发送心跳
   */
  sendHeartbeat(projectId: string): Promise<void>;

  /**
   * 获取项目心跳状态
   */
  getProjectHeartbeatStatus(projectId: string): { lastHeartbeat: number; isAlive: boolean };

  /**
   * 获取入站消息
   */
  getIncomingMessages(args: {
    project_id: string;
    since?: number;
  }): Promise<any[]>;

  /**
   * 设置通知发送器（用于 HTTP 模式）
   */
  setNotificationSender(sender: (message: JSONRPCMessage) => Promise<void>): void;
}

/**
 * MCP 服务器配置
 */
export interface MCPServerConfig {
  /**
   * 服务器名称
   */
  name?: string;

  /**
   * 服务器版本
   */
  version?: string;

  /**
   * HTTP 传输配置
   */
  http?: {
    port?: number;
    host?: string;
  };
}

/**
 * MCP 服务器
 * 提供 MCP 工具供 Claude Code 调用
 */
export class MCPServer {
  private server: Server;
  private backend: BackendService;
  private tools: Tool[];
  private transport: StreamableHTTPServerTransport | null = null;
  private expressApp: express.Express | null = null;
  private expressServer: any = null;
  private config?: MCPServerConfig;

  constructor(backend: BackendService, config?: MCPServerConfig) {
    this.backend = backend;
    this.config = config;
    this.server = new Server(
      {
        name: config?.name || 'cc-connect-carry',
        version: config?.version || '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          // Enable notifications for HTTP transport
          ...(config?.http ? { experimental: { notifications: {} } } : {}),
        },
      }
    );

    this.tools = this.defineTools();
    this.setupHandlers();
  }

  /**
   * 定义 MCP 工具
   */
  private defineTools(): Tool[] {
    return [
      {
        name: 'send_message',
        description: 'Send a message to a chat platform (Feishu, Telegram, WhatsApp)',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['feishu', 'telegram', 'whatsapp'],
              description: 'The chat platform to send to',
            },
            chat_id: {
              type: 'string',
              description: 'The chat ID to send the message to',
            },
            content: {
              type: 'string',
              description: 'The message content to send',
            },
            project_id: {
              type: 'string',
              description: 'Optional project ID (auto-detected if not provided)',
            },
          },
          required: ['provider', 'chat_id', 'content'],
        },
      },
      {
        name: 'list_chats',
        description: 'List available chats for a provider',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['feishu', 'telegram', 'whatsapp'],
              description: 'The chat platform',
            },
            project_id: {
              type: 'string',
              description: 'Optional project ID',
            },
          },
          required: ['provider'],
        },
      },
      {
        name: 'get_status',
        description: 'Get the status of registered providers',
        inputSchema: {
          type: 'object',
          properties: {
            provider: {
              type: 'string',
              enum: ['feishu', 'telegram', 'whatsapp'],
              description: 'Optional provider name to check',
            },
          },
        },
      },
      {
        name: 'register_project',
        description: 'Register a project with its chat provider configuration',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project ID to register',
            },
            provider: {
              type: 'string',
              enum: ['feishu', 'telegram', 'whatsapp'],
              description: 'The chat platform provider',
            },
            config: {
              type: 'object',
              description: 'Provider configuration (app_id, app_secret, etc.)',
            },
          },
          required: ['project_id', 'provider', 'config'],
        },
      },
      {
        name: 'unregister_project',
        description: 'Unregister a project and disconnect its provider',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project ID to unregister',
            },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'send_heartbeat',
        description: 'Send a heartbeat to keep a project alive. Should be called periodically by the client.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project ID to send heartbeat for',
            },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'get_heartbeat_status',
        description: 'Get the heartbeat status of a registered project',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project ID to check',
            },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'get_incoming_messages',
        description: 'Get incoming messages from chat platforms (Feishu, WhatsApp, Telegram) for a project',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project ID to get messages for',
            },
            since: {
              type: 'number',
              description: 'Get messages since this timestamp (optional)',
            },
          },
          required: ['project_id'],
        },
      },
      {
        name: 'auto_discover_projects',
        description: 'Auto-discover and register projects based on signal files from Claude Code hooks',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ];
  }

  /**
   * 获取信号目录
   */
  private getSignalsDir(): string {
    return path.join(os.homedir(), '.cc-power', 'signals');
  }

  /**
   * 处理信号文件
   */
  private async processSignalFiles(): Promise<{ registered: string[]; unregistered: string[] }> {
    const signalsDir = this.getSignalsDir();
    const registered: string[] = [];
    const unregistered: string[] = [];

    try {
      // 确保信号目录存在
      if (!fs.existsSync(signalsDir)) {
        fs.mkdirSync(signalsDir, { recursive: true });
        return { registered, unregistered };
      }

      // 读取所有信号文件
      const files = fs.readdirSync(signalsDir);

      for (const file of files) {
        const filePath = path.join(signalsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const signal = JSON.parse(content);

          if (signal.type === 'register') {
            // 处理注册信号
            const projectConfig: any = {
              provider: signal.provider,
              projectId: signal.projectId,
              ...signal.config,
            };

            await this.backend.registerProject(signal.projectId, projectConfig);
            registered.push(signal.projectId);
            this.backend.logInfo(`Auto-registered project: ${signal.projectId} (${signal.provider})`);

            // 删除信号文件
            fs.unlinkSync(filePath);
          } else if (signal.type === 'unregister') {
            // 处理取消注册信号
            await this.backend.unregisterProject(signal.projectId);
            unregistered.push(signal.projectId);
            this.backend.logInfo(`Auto-unregistered project: ${signal.projectId}`);

            // 删除信号文件
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          this.backend.logError(`Failed to process signal file ${file}:`, error);
        }
      }
    } catch (error) {
      this.backend.logError('Failed to process signal files:', error);
    }

    return { registered, unregistered };
  }

  /**
   * 设置处理器
   */
  private setupHandlers(): void {
    // 列出工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.tools,
      };
    });

    // 调用工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      this.backend.logDebug(`MCP tool call: ${name}`, args);

      try {
        let result: any;

        switch (name) {
          case 'send_message':
            result = await this.sendMessage(args as any);
            break;

          case 'list_chats':
            result = await this.listChats(args as any);
            break;

          case 'get_status':
            result = await this.getStatus(args as any);
            break;

          case 'register_project':
            result = await this.registerProject(args as any);
            break;

          case 'unregister_project':
            result = await this.unregisterProject(args as any);
            break;

          case 'send_heartbeat':
            result = await this.sendHeartbeat(args as any);
            break;

          case 'get_heartbeat_status':
            result = await this.getHeartbeatStatus(args as any);
            break;

          case 'get_incoming_messages':
            result = await this.getIncomingMessages(args as any);
            break;

          case 'auto_discover_projects':
            result = await this.autoDiscoverProjects();
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        this.backend.logError(`Tool call failed: ${name}`, error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: String(error) }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 处理 send_message 工具
   */
  private async sendMessage(args: {
    provider: string;
    chat_id: string;
    content: string;
    project_id?: string;
  }): Promise<any> {
    await this.backend.sendMessage(args);

    return {
      success: true,
      message: 'Message sent successfully',
    };
  }

  /**
   * 处理 list_chats 工具
   */
  private async listChats(args: {
    provider: string;
    project_id?: string;
  }): Promise<any> {
    return await this.backend.listChats(args);
  }

  /**
   * 处理 get_status 工具
   */
  private async getStatus(args: { provider?: string }): Promise<any> {
    return await this.backend.getStatus(args);
  }

  /**
   * 处理 register_project 工具
   */
  private async registerProject(args: {
    project_id: string;
    provider: string;
    config: any;
  }): Promise<any> {
    const { project_id: projectId, provider, config } = args;

    this.backend.logInfo(`Registering project via MCP: ${projectId} (${provider})`);

    try {
      // 构建项目配置
      const projectConfig: any = {
        provider,
        projectId,
        ...config,
      };

      // 注册项目
      await this.backend.registerProject(projectId, projectConfig);

      this.backend.logInfo(`Project ${projectId} registered successfully via MCP`);

      return {
        success: true,
        message: `Project ${projectId} registered successfully`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backend.logError(`Failed to register project ${projectId} via MCP: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 处理 unregister_project 工具
   */
  private async unregisterProject(args: {
    project_id: string;
  }): Promise<any> {
    const { project_id: projectId } = args;

    this.backend.logInfo(`Unregistering project via MCP: ${projectId}`);

    try {
      await this.backend.unregisterProject(projectId);

      this.backend.logInfo(`Project ${projectId} unregistered successfully via MCP`);

      return {
        success: true,
        message: `Project ${projectId} unregistered successfully`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backend.logError(`Failed to unregister project ${projectId} via MCP: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 处理 send_heartbeat 工具
   */
  private async sendHeartbeat(args: {
    project_id: string;
  }): Promise<any> {
    const { project_id: projectId } = args;

    try {
      await this.backend.sendHeartbeat(projectId);

      return {
        success: true,
        message: `Heartbeat sent for project ${projectId}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backend.logError(`Failed to send heartbeat for ${projectId}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 处理 get_heartbeat_status 工具
   */
  private async getHeartbeatStatus(args: {
    project_id: string;
  }): Promise<any> {
    const { project_id: projectId } = args;

    try {
      const status = this.backend.getProjectHeartbeatStatus(projectId);

      return {
        project_id: projectId,
        last_heartbeat: status.lastHeartbeat,
        is_alive: status.isAlive,
        time_since_last: status.lastHeartbeat > 0 ? Date.now() - status.lastHeartbeat : 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backend.logError(`Failed to get heartbeat status for ${projectId}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 处理 get_incoming_messages 工具
   */
  private async getIncomingMessages(args: {
    project_id: string;
    since?: number;
  }): Promise<any> {
    const { project_id: projectId, since } = args;

    try {
      const messages = await this.backend.getIncomingMessages({ project_id: projectId, since });

      this.backend.logDebug(`Retrieved ${messages.length} incoming messages for ${projectId}`);

      return {
        project_id: projectId,
        messages,
        count: messages.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backend.logError(`Failed to get incoming messages for ${projectId}: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 处理 auto_discover_projects 工具
   */
  private async autoDiscoverProjects(): Promise<any> {
    this.backend.logInfo('Auto-discovering projects from signal files...');

    try {
      const { registered, unregistered } = await this.processSignalFiles();

      this.backend.logInfo(
        `Auto-discovery complete: ${registered.length} registered, ${unregistered.length} unregistered`
      );

      return {
        success: true,
        registered,
        unregistered,
        message: `Processed ${registered.length} registrations and ${unregistered.length} unregistrations`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.backend.logError(`Failed to auto-discover projects: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 启动服务器（stdio 模式）
   */
  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.backend.logInfo('MCP server started (stdio mode)');
  }

  /**
   * 重置 MCP Server 和处理器
   * 用于在新的客户端连接时（如 Claude Code 重启）清除已初始化的状态，防止抛出 Server already initialized 错误。
   */
  private resetServer(): void {
    this.server = new Server(
      {
        name: this.config?.name || 'cc-connect-carry',
        version: this.config?.version || '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          // Enable notifications for HTTP transport
          ...(this.config?.http ? { experimental: { notifications: {} } } : {}),
        },
      }
    );
    this.setupHandlers();
  }

  /**
   * 启动服务器（HTTP/SSE 模式）
   */
  async startHTTP(port: number = 8080, host: string = '127.0.0.1'): Promise<void> {
    // Create Express app with MCP support
    this.expressApp = createMcpExpressApp();

    // Create StreamableHTTPServerTransport
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true, // Enable simple JSON response for compatibility
    });

    // Connect server to transport
    await this.server.connect(this.transport as any);

    // Set up notification sender in backend
    this.backend.setNotificationSender(async (message: JSONRPCMessage) => {
      if (this.transport) {
        await this.transport.send(message);
      }
    });

    // Set up MCP endpoint with middleware for health checks
    this.expressApp.all('/mcp', async (req: any, res: any, next: any) => {
      // Handle simple GET requests for health checks (without SSE requirement)
      if (req.method === 'GET' && !req.headers.accept?.includes('text/event-stream')) {
        this.backend.logDebug(`Simple GET request to /mcp - returning OK for health check`);
        res.status(200).json({
          status: 'ok',
          server: 'cc-power-mcp',
          transport: 'http',
          protocol: 'mcp',
        });
        return;
      }

      // Debug: log incoming requests
      this.backend.logDebug(`MCP request: ${req.method} ${req.url}`);
      this.backend.logDebug(`Accept header: ${req.headers.accept || 'none'}`);
      this.backend.logDebug(`Content-Type header: ${req.headers['content-type'] || 'none'}`);
      this.backend.logDebug(`Mcp-Session-Id header: ${req.headers['mcp-session-id'] || 'none'}`);

      // Log request body for POST requests
      if (req.method === 'POST' && req.body) {
        this.backend.logDebug(`Request body: ${JSON.stringify(req.body)}`);
      }

      // Check if this is an initialization request (client reconnecting)
      // Claude Code sends a POST request with method="initialize" and no session ID on first connect
      if (req.method === 'POST' && req.body && req.body.method === 'initialize' && !req.headers['mcp-session-id']) {
        this.backend.logInfo('New initialize request received, resetting MCP server and transport...');
        
        // Close old transport
        if (this.transport) {
          try { await this.transport.close(); } catch (e) {}
        }
        
        // Recreate Server instance to clear internal initialized state
        this.resetServer();
        
        // Recreate Transport instance
        this.transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
        });
        
        // Reconnect
        await this.server.connect(this.transport as any);
      }

      // Pass parsed body if available (for POST requests)
      try {
        await this.transport?.handleRequest(req, res, req.body);
        this.backend.logDebug(`Request handled successfully`);
      } catch (error) {
        this.backend.logError(`Error handling MCP request:`, error);
      }
    });

    // Set up monitoring page
    this.setupMonitoringPage();

    // Set up health check endpoint (for MCP client health checks)
    this.expressApp.get('/health', (req: any, res: any) => {
      this.backend.logDebug(`Health check request from ${req.ip || 'unknown'}`);
      res.status(200).json({ status: 'ok', server: 'cc-power-mcp', timestamp: Date.now() });
    });

    // Set up root endpoint
    this.expressApp.get('/', (req: any, res: any) => {
      this.backend.logDebug(`Root request from ${req.ip || 'unknown'}`);
      res.redirect('/status');
    });

    // Set up status API endpoint
    this.expressApp.get('/api/status', (req: any, res: any) => {
      const status = this.getFullStatus();
      res.json(status);
    });

    // Start Express server with port cleanup and retry logic
    const startWithRetry = async (attempt: number = 1): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        this.expressServer = this.expressApp!.listen(port, host);

        const errorHandler = (err: any) => {
          if (err.code === 'EADDRINUSE') {
            this.expressServer?.removeAllListeners('listening');
            this.expressServer?.removeAllListeners('error');
            this.expressServer?.close();

            this.backend.logWarn(`Port ${port} is in use, attempting to cleanup... (attempt ${attempt}/3)`);

            // Try to cleanup the port
            this.cleanupPort(port)
              .then(() => {
                // Wait a bit for port to be released
                setTimeout(() => {
                  if (attempt < 3) {
                    // Retry
                    startWithRetry(attempt + 1).then(resolve).catch(reject);
                  } else {
                    reject(new Error(`Port ${port} is still in use after ${attempt} attempts. Please manually kill the process using this port.`));
                  }
                }, 1000);
              })
              .catch((cleanupErr) => {
                reject(new Error(`Port ${port} is already in use and cleanup failed: ${cleanupErr}`));
              });
          } else {
            reject(err);
          }
        };

        this.expressServer!.once('listening', () => {
          this.backend.logInfo(`MCP server started (HTTP mode) on http://${host}:${port}`);
          this.backend.logInfo(`Monitoring dashboard available at http://${host}:${port}/status`);
          resolve();
        });

        this.expressServer!.once('error', errorHandler);
      });
    };

    return startWithRetry();
  }

  /**
   * 清理占用指定端口的进程
   */
  private async cleanupPort(port: number): Promise<void> {
    const { execSync } = await import('child_process');

    try {
      // 获取占用端口的进程 PID
      const result = execSync(`lsof -ti:${port}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pids = result.trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        return;
      }

      this.backend.logInfo(`Found ${pids.length} process(es) using port ${port}: ${pids.join(', ')}`);

      // 杀掉所有占用端口的进程
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: ['ignore', 'pipe', 'ignore'] });
          this.backend.logInfo(`Killed process ${pid}`);
        } catch (error) {
          this.backend.logWarn(`Failed to kill process ${pid}:`, error);
        }
      }
    } catch (error) {
      // lsof 返回非 0 表示没有找到进程，忽略错误
      const err = error as any;
      if (err.status !== 1) {
        throw error;
      }
    }
  }

  /**
   * 获取完整状态信息
   */
  private getFullStatus(): any {
    const projects = this.backend.getRegisteredProjects();
    const projectStatuses: any[] = [];

    for (const projectId of projects) {
      const heartbeatStatus = this.backend.getProjectHeartbeatStatus(projectId);
      const timeSinceLast = Date.now() - heartbeatStatus.lastHeartbeat;

      projectStatuses.push({
        project_id: projectId,
        is_alive: heartbeatStatus.isAlive,
        last_heartbeat: heartbeatStatus.lastHeartbeat,
        time_since_last_ms: timeSinceLast,
        time_since_last_text: this.formatTimeSinceLast(heartbeatStatus.lastHeartbeat),
      });
    }

    return {
      server: {
        name: 'cc-power',
        version: '1.0.0',
        uptime: process.uptime(),
        uptime_text: this.formatUptime(process.uptime()),
        timestamp: Date.now(),
      },
      transport: 'http',
      projects: projectStatuses,
      total_projects: projects.length,
      alive_projects: projectStatuses.filter(p => p.is_alive).length,
    };
  }

  /**
   * 格式化时间间隔
   */
  private formatTimeSinceLast(lastHeartbeat: number): string {
    if (lastHeartbeat === 0) {
      return '从未';
    }

    const diff = Date.now() - lastHeartbeat;

    if (diff < 1000) {
      return `${diff}ms 前`;
    } else if (diff < 60000) {
      return `${Math.floor(diff / 1000)}秒前`;
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)}分钟前`;
    } else {
      return `${Math.floor(diff / 3600000)}小时前`;
    }
  }

  /**
   * 格式化运行时间
   */
  private formatUptime(uptime: number): string {
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    if (hours > 0) {
      return `${hours}小时 ${minutes}分钟 ${seconds}秒`;
    } else if (minutes > 0) {
      return `${minutes}分钟 ${seconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * 设置监控页面
   */
  private setupMonitoringPage(): void {
    if (!this.expressApp) return;

    this.expressApp.get('/', (req: any, res: any) => {
      res.redirect('/status');
    });

    this.expressApp.get('/status', (req: any, res: any) => {
      const html = this.getMonitoringHTML();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  }

  /**
   * 获取监控页面 HTML
   */
  private getMonitoringHTML(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CC-Power 服务监控</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
        'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .header p {
      color: #666;
      font-size: 14px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }

    .stat-card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .stat-card h3 {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }

    .stat-card .value {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .stat-card .sub {
      font-size: 12px;
      color: #999;
      margin-top: 4px;
    }

    .projects-section {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .projects-section h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .project-table {
      width: 100%;
      border-collapse: collapse;
    }

    .project-table th {
      text-align: left;
      padding: 12px;
      font-size: 12px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
      border-bottom: 2px solid #f0f0f0;
    }

    .project-table td {
      padding: 16px 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .project-table tr:hover {
      background: #f9f9f9;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .status-alive {
      background: #e6fffa;
      color: #00b894;
    }

    .status-dead {
      background: #fff5f5;
      color: #e74c3c;
    }

    .last-updated {
      text-align: center;
      padding: 16px;
      color: #999;
      font-size: 14px;
    }

    .empty-state {
      text-align: center;
      padding: 40px;
      color: #999;
    }

    .empty-state svg {
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .pulse {
      animation: pulse 2s infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 CC-Power 服务监控</h1>
      <p>实时监控服务状态、项目注册和心跳信息</p>
    </div>

    <div class="stats">
      <div class="stat-card">
        <h3>服务状态</h3>
        <div class="value">运行中</div>
        <div class="sub" id="uptime">加载中...</div>
      </div>
      <div class="stat-card">
        <h3>已注册项目</h3>
        <div class="value" id="total-projects">-</div>
        <div class="sub">总计</div>
      </div>
      <div class="stat-card">
        <h3>活跃项目</h3>
        <div class="value" id="alive-projects">-</div>
        <div class="sub">心跳正常</div>
      </div>
      <div class="stat-card">
        <h3>传输方式</h3>
        <div class="value">HTTP</div>
        <div class="sub">MCP 服务器</div>
      </div>
    </div>

    <div class="projects-section">
      <h2>📋 项目列表</h2>
      <table class="project-table">
        <thead>
          <tr>
            <th>项目 ID</th>
            <th>状态</th>
            <th>最后心跳</th>
            <th>心跳间隔</th>
          </tr>
        </thead>
        <tbody id="projects-body">
          <tr>
            <td colspan="4" class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <p>暂无注册项目</p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="last-updated">
      <span class="pulse">●</span> 自动刷新中 · 最后更新: <span id="last-updated">-</span>
    </div>
  </div>

  <script>
    // 获取状态并更新页面
    async function updateStatus() {
      try {
        const response = await fetch('/api/status');
        const data = await response.json();

        // 更新运行时间
        document.getElementById('uptime').textContent = data.server.uptime_text;

        // 更新项目统计
        document.getElementById('total-projects').textContent = data.total_projects;
        document.getElementById('alive-projects').textContent = data.alive_projects;

        // 更新项目列表
        const tbody = document.getElementById('projects-body');
        if (data.projects.length === 0) {
          tbody.innerHTML = \`
            <tr>
              <td colspan="4" class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <p>暂无注册项目</p>
              </td>
            </tr>
          \`;
        } else {
          tbody.innerHTML = data.projects.map(project => \`
            <tr>
              <td>
                <strong>\${escapeHtml(project.project_id)}</strong>
              </td>
              <td>
                <span class="status-badge \${project.is_alive ? 'status-alive' : 'status-dead'}">
                  \${project.is_alive ? '● 活跃' : '○ 离线'}
                </span>
              </td>
              <td>\${project.time_since_last_text}</td>
              <td>\${formatDuration(project.time_since_last_ms)}</td>
            </tr>
          \`).join('');
        }

        // 更新最后更新时间
        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString('zh-CN');
      } catch (error) {
        console.error('Failed to fetch status:', error);
      }
    }

    // 格式化持续时间
    function formatDuration(ms) {
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
      if (ms < 3600000) return (ms / 60000).toFixed(1) + 'min';
      return (ms / 3600000).toFixed(1) + 'h';
    }

    // 转义 HTML
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // 初始化
    updateStatus();
    setInterval(updateStatus, 3000); // 每3秒更新一次
  </script>
</body>
</html>`;
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    // 先关闭 MCP server
    await this.server.close();

    // 关闭 Express 服务器
    if (this.expressServer) {
      await new Promise<void>((resolve, reject) => {
        // 设置超时，防止 close 回调不被调用
        const timeout = setTimeout(() => {
          this.expressServer?.removeAllListeners();
          resolve();
        }, 5000);

        this.expressServer.close((err?: any) => {
          clearTimeout(timeout);
          if (err) {
            this.backend.logWarn('Express server close warning:', err);
          }
          resolve();
        });
      });
      this.expressServer = null;
    }

    // 关闭 transport
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }

    this.expressApp = null;
    this.backend.logInfo('MCP server stopped');
  }
}

export { MCPServer as default };