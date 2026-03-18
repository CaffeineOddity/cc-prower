import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
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
   * 获取入站消息
   */
  getIncomingMessages(args: {
    project_id: string;
    since?: number;
  }): Promise<any[]>;
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
   * 传输方式
   */
  transport?: 'stdio';
}

/**
 * MCP 服务器
 * 提供 MCP 工具供 Claude Code 调用
 */
export class MCPServer {
  private server: Server;
  private backend: BackendService;
  private tools: Tool[];
  private config?: MCPServerConfig;

  constructor(backend: BackendService, config?: MCPServerConfig) {
    this.backend = backend;
    this.config = config;
    this.server = new Server(
      {
        name: config?.name || 'cc-power-mcp',
        version: config?.version || '1.0.0',
      },
      {
        capabilities: {
          tools: {},
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
      }
    ];
  }

  /**
   * 处理工具调用
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

          case 'get_incoming_messages':
            result = await this.getIncomingMessages(args as any);
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
   * 尝试从当前目录推断 Project ID
   */
  private async inferProjectId(): Promise<string | undefined> {
    try {
      const cwd = process.cwd();
      // 检查当前目录下是否有项目配置文件，避免在非项目目录下误判
      const hasConfig = fs.existsSync(path.join(cwd, '.cc-power.yaml')) || 
                        fs.existsSync(path.join(cwd, 'config.yaml'));
      
      if (!hasConfig) {
        return undefined;
      }

      const crypto = await import('crypto');
      // 必须与 cli 中的生成规则保持绝对一致，使用 path.resolve
      const normalizedPath = path.resolve(cwd).replace(/\/$/, '');
      const projectId = crypto.createHash('md5').update(normalizedPath).digest('hex').substring(0, 8);
      return projectId;
    } catch (error) {
      this.backend.logWarn('Failed to infer project ID from CWD:', error);
      return undefined;
    }
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
    if (!args.project_id) {
      args.project_id = await this.inferProjectId();
      if (args.project_id) {
        this.backend.logInfo(`Auto-inferred project ID for sendMessage: ${args.project_id}`);
      }
    }
    
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
    if (!args.project_id) {
      args.project_id = await this.inferProjectId();
      if (args.project_id) {
        this.backend.logInfo(`Auto-inferred project ID for listChats: ${args.project_id}`);
      }
    }
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
   * 处理 get_incoming_messages 工具
   */
  private async getIncomingMessages(args: {
    project_id: string;
    since?: number;
  }): Promise<any> {
    if (!args.project_id) {
      args.project_id = (await this.inferProjectId()) || '';
      if (args.project_id) {
        this.backend.logInfo(`Auto-inferred project ID for getIncomingMessages: ${args.project_id}`);
      }
    }
    
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
   * 启动服务器（stdio 模式）
   */
  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.backend.logInfo('MCP server started (stdio mode)');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    // 先关闭 MCP server
    await this.server.close();
    this.backend.logInfo('MCP server stopped');
  }
}

export { MCPServer as default };