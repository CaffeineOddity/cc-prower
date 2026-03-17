import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
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
     * 发送心跳
     */
    sendHeartbeat(projectId: string): Promise<void>;
    /**
     * 获取项目心跳状态
     */
    getProjectHeartbeatStatus(projectId: string): {
        lastHeartbeat: number;
        isAlive: boolean;
    };
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
export declare class MCPServer {
    private server;
    private backend;
    private tools;
    private transport;
    private expressApp;
    private expressServer;
    private config?;
    constructor(backend: BackendService, config?: MCPServerConfig);
    /**
     * 定义 MCP 工具
     */
    private defineTools;
    /**
     * 获取信号目录
     */
    private getSignalsDir;
    /**
     * 处理信号文件
     */
    private processSignalFiles;
    /**
     * 设置处理器
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
     * 处理 send_heartbeat 工具
     */
    private sendHeartbeat;
    /**
     * 处理 get_heartbeat_status 工具
     */
    private getHeartbeatStatus;
    /**
     * 处理 get_incoming_messages 工具
     */
    private getIncomingMessages;
    /**
     * 处理 auto_discover_projects 工具
     */
    private autoDiscoverProjects;
    /**
     * 启动服务器（stdio 模式）
     */
    startStdio(): Promise<void>;
    /**
     * 重置 MCP Server 和处理器
     * 用于在新的客户端连接时（如 Claude Code 重启）清除已初始化的状态，防止抛出 Server already initialized 错误。
     */
    private resetServer;
    /**
     * 启动服务器（HTTP/SSE 模式）
     */
    startHTTP(port?: number, host?: string): Promise<void>;
    /**
     * 清理占用指定端口的进程
     */
    private cleanupPort;
    /**
     * 获取完整状态信息
     */
    private getFullStatus;
    /**
     * 格式化时间间隔
     */
    private formatTimeSinceLast;
    /**
     * 格式化运行时间
     */
    private formatUptime;
    /**
     * 设置监控页面
     */
    private setupMonitoringPage;
    /**
     * 获取监控页面 HTML
     */
    private getMonitoringHTML;
    /**
     * 停止服务器
     */
    stop(): Promise<void>;
}
export { MCPServer as default };
//# sourceMappingURL=index.d.ts.map