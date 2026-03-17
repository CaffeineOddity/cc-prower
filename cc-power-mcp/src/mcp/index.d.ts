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
    getStatus(args: {
        provider?: string;
    }): Promise<any>;
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
export declare class MCPServer {
    private server;
    private backend;
    private tools;
    private config?;
    constructor(backend: BackendService, config?: MCPServerConfig);
    /**
     * 定义 MCP 工具
     */
    private defineTools;
    /**
     * 处理工具调用
     */
    private setupHandlers;
    /**
     * 处理 send_message 工具
     */
    private sendMessage;
    /**
     * 处理 list_chats 工具
     */
    private listChats;
    /**
     * 处理 get_status 工具
     */
    private getStatus;
    /**
     * 处理 register_project 工具
     */
    private registerProject;
    /**
     * 处理 unregister_project 工具
     */
    private unregisterProject;
    /**
     * 处理 get_incoming_messages 工具
     */
    private getIncomingMessages;
    /**
     * 启动服务器（stdio 模式）
     */
    startStdio(): Promise<void>;
    /**
     * 停止服务器
     */
    stop(): Promise<void>;
}
export { MCPServer as default };
//# sourceMappingURL=index.d.ts.map