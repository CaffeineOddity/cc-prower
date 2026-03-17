import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
/**
 * MCP 服务器
 * 提供 MCP 工具供 Claude Code 调用
 */
export class MCPServer {
    server;
    backend;
    tools;
    config;
    constructor(backend, config) {
        this.backend = backend;
        this.config = config;
        this.server = new Server({
            name: config?.name || 'cc-power-mcp',
            version: config?.version || '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.tools = this.defineTools();
        this.setupHandlers();
    }
    /**
     * 定义 MCP 工具
     */
    defineTools() {
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
    setupHandlers() {
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
                let result;
                switch (name) {
                    case 'send_message':
                        result = await this.sendMessage(args);
                        break;
                    case 'list_chats':
                        result = await this.listChats(args);
                        break;
                    case 'get_status':
                        result = await this.getStatus(args);
                        break;
                    case 'register_project':
                        result = await this.registerProject(args);
                        break;
                    case 'unregister_project':
                        result = await this.unregisterProject(args);
                        break;
                    case 'get_incoming_messages':
                        result = await this.getIncomingMessages(args);
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
            }
            catch (error) {
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
    async sendMessage(args) {
        await this.backend.sendMessage(args);
        return {
            success: true,
            message: 'Message sent successfully',
        };
    }
    /**
     * 处理 list_chats 工具
     */
    async listChats(args) {
        return await this.backend.listChats(args);
    }
    /**
     * 处理 get_status 工具
     */
    async getStatus(args) {
        return await this.backend.getStatus(args);
    }
    /**
     * 处理 register_project 工具
     */
    async registerProject(args) {
        const { project_id: projectId, provider, config } = args;
        this.backend.logInfo(`Registering project via MCP: ${projectId} (${provider})`);
        try {
            // 构建项目配置
            const projectConfig = {
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
        }
        catch (error) {
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
    async unregisterProject(args) {
        const { project_id: projectId } = args;
        this.backend.logInfo(`Unregistering project via MCP: ${projectId}`);
        try {
            await this.backend.unregisterProject(projectId);
            this.backend.logInfo(`Project ${projectId} unregistered successfully via MCP`);
            return {
                success: true,
                message: `Project ${projectId} unregistered successfully`,
            };
        }
        catch (error) {
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
    async getIncomingMessages(args) {
        const { project_id: projectId, since } = args;
        try {
            const messages = await this.backend.getIncomingMessages({ project_id: projectId, since });
            this.backend.logDebug(`Retrieved ${messages.length} incoming messages for ${projectId}`);
            return {
                project_id: projectId,
                messages,
                count: messages.length,
            };
        }
        catch (error) {
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
    async startStdio() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        this.backend.logInfo('MCP server started (stdio mode)');
    }
    /**
     * 停止服务器
     */
    async stop() {
        // 先关闭 MCP server
        await this.server.close();
        this.backend.logInfo('MCP server stopped');
    }
}
export { MCPServer as default };
//# sourceMappingURL=index.js.map