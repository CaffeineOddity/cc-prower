import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { Router } from './router.js';
import { Logger } from './logger.js';

/**
 * MCP 服务器
 * 提供 MCP 工具供 Claude Code 调用
 */
export class MCPServer {
  private server: Server;
  private router: Router;
  private logger: Logger;
  private tools: Tool[];

  constructor(router: Router, logger: Logger) {
    this.router = router;
    this.logger = logger;
    this.server = new Server(
      {
        name: 'cc-connect-carry',
        version: '1.0.0',
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
    ];
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

      this.logger.debug(`MCP tool call: ${name}`, args);

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
        this.logger.error(`Tool call failed: ${name}`, error);
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
    await this.router.handleMCPMessage({
      method: 'tools/call',
      params: {
        name: 'send_message',
        arguments: args,
      },
    });

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
    const result = await this.router.handleMCPMessage({
      method: 'tools/call',
      params: {
        name: 'list_chats',
        arguments: args,
      },
    });

    return result;
  }

  /**
   * 处理 get_status 工具
   */
  private async getStatus(args: { provider?: string }): Promise<any> {
    const result = await this.router.handleMCPMessage({
      method: 'tools/call',
      params: {
        name: 'get_status',
        arguments: args,
      },
    });

    return result;
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

    this.logger.info(`Registering project via MCP: ${projectId} (${provider})`);

    try {
      // 构建项目配置
      const projectConfig: any = {
        provider,
        projectId,
        ...config,
      };

      // 注册项目
      await this.router.registerProject(projectId, projectConfig);

      this.logger.info(`Project ${projectId} registered successfully via MCP`);

      return {
        success: true,
        message: `Project ${projectId} registered successfully`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to register project ${projectId} via MCP: ${errorMessage}`);

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

    this.logger.info(`Unregistering project via MCP: ${projectId}`);

    try {
      await this.router.unregisterProject(projectId);

      this.logger.info(`Project ${projectId} unregistered successfully via MCP`);

      return {
        success: true,
        message: `Project ${projectId} unregistered successfully`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to unregister project ${projectId} via MCP: ${errorMessage}`);

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
    this.logger.info('MCP server started (stdio mode)');
  }

  /**
   * 启动服务器（WebSocket 模式）
   */
  async startWebSocket(port: number, host: string = '0.0.0.0'): Promise<void> {
    // Note: WebSocket transport is not yet fully implemented in MCP SDK
    // This is a placeholder for future implementation
    this.logger.info(`WebSocket transport not yet implemented (use stdio mode)`);
    throw new Error('WebSocket transport not yet implemented. Use stdio mode.');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    await this.server.close();
    this.logger.info('MCP server stopped');
  }
}