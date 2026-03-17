import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
/**
 * MCP 服务器
 * 提供 MCP 工具供 Claude Code 调用
 */
export class MCPServer {
    server;
    backend;
    tools;
    transport = null;
    expressApp = null;
    expressServer = null;
    constructor(backend, config) {
        this.backend = backend;
        this.server = new Server({
            name: config?.name || 'cc-connect-carry',
            version: config?.version || '1.0.0',
        }, {
            capabilities: {
                tools: {},
                // Enable notifications for HTTP transport
                ...(config?.http ? { experimental: { notifications: {} } } : {}),
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
    getSignalsDir() {
        return path.join(os.homedir(), '.cc-power', 'signals');
    }
    /**
     * 处理信号文件
     */
    async processSignalFiles() {
        const signalsDir = this.getSignalsDir();
        const registered = [];
        const unregistered = [];
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
                        const projectConfig = {
                            provider: signal.provider,
                            projectId: signal.projectId,
                            ...signal.config,
                        };
                        await this.backend.registerProject(signal.projectId, projectConfig);
                        registered.push(signal.projectId);
                        this.backend.logInfo(`Auto-registered project: ${signal.projectId} (${signal.provider})`);
                        // 删除信号文件
                        fs.unlinkSync(filePath);
                    }
                    else if (signal.type === 'unregister') {
                        // 处理取消注册信号
                        await this.backend.unregisterProject(signal.projectId);
                        unregistered.push(signal.projectId);
                        this.backend.logInfo(`Auto-unregistered project: ${signal.projectId}`);
                        // 删除信号文件
                        fs.unlinkSync(filePath);
                    }
                }
                catch (error) {
                    this.backend.logError(`Failed to process signal file ${file}:`, error);
                }
            }
        }
        catch (error) {
            this.backend.logError('Failed to process signal files:', error);
        }
        return { registered, unregistered };
    }
    /**
     * 设置处理器
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
                    case 'send_heartbeat':
                        result = await this.sendHeartbeat(args);
                        break;
                    case 'get_heartbeat_status':
                        result = await this.getHeartbeatStatus(args);
                        break;
                    case 'get_incoming_messages':
                        result = await this.getIncomingMessages(args);
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
     * 处理 send_heartbeat 工具
     */
    async sendHeartbeat(args) {
        const { project_id: projectId } = args;
        try {
            await this.backend.sendHeartbeat(projectId);
            return {
                success: true,
                message: `Heartbeat sent for project ${projectId}`,
            };
        }
        catch (error) {
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
    async getHeartbeatStatus(args) {
        const { project_id: projectId } = args;
        try {
            const status = this.backend.getProjectHeartbeatStatus(projectId);
            return {
                project_id: projectId,
                last_heartbeat: status.lastHeartbeat,
                is_alive: status.isAlive,
                time_since_last: status.lastHeartbeat > 0 ? Date.now() - status.lastHeartbeat : 0,
            };
        }
        catch (error) {
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
     * 处理 auto_discover_projects 工具
     */
    async autoDiscoverProjects() {
        this.backend.logInfo('Auto-discovering projects from signal files...');
        try {
            const { registered, unregistered } = await this.processSignalFiles();
            this.backend.logInfo(`Auto-discovery complete: ${registered.length} registered, ${unregistered.length} unregistered`);
            return {
                success: true,
                registered,
                unregistered,
                message: `Processed ${registered.length} registrations and ${unregistered.length} unregistrations`,
            };
        }
        catch (error) {
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
    async startStdio() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        this.backend.logInfo('MCP server started (stdio mode)');
    }
    /**
     * 启动服务器（HTTP/SSE 模式）
     */
    async startHTTP(port = 8080, host = '127.0.0.1') {
        // Create Express app with MCP support
        this.expressApp = createMcpExpressApp();
        // Create StreamableHTTPServerTransport
        this.transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
        });
        // Connect server to transport
        await this.server.connect(this.transport);
        // Set up notification sender in backend
        this.backend.setNotificationSender(async (message) => {
            if (this.transport) {
                await this.transport.send(message);
            }
        });
        // Set up MCP endpoint
        this.expressApp.all('/mcp', (req, res) => {
            this.transport?.handleRequest(req, res);
        });
        // Start Express server
        this.expressServer = this.expressApp.listen(port, host, () => {
            this.backend.logInfo(`MCP server started (HTTP mode) on http://${host}:${port}`);
        });
        return new Promise((resolve) => {
            this.expressServer.on('listening', resolve);
        });
    }
    /**
     * 停止服务器
     */
    async stop() {
        await this.server.close();
        if (this.transport) {
            await this.transport.close();
        }
        if (this.expressServer) {
            await new Promise((resolve) => {
                this.expressServer.close(() => resolve());
            });
        }
        this.backend.logInfo('MCP server stopped');
    }
}
export { MCPServer as default };
//# sourceMappingURL=index.js.map