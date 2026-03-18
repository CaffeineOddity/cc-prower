import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 消息日志条目
 */
export interface MessageLogEntry {
  timestamp: number;
  direction: 'inbound' | 'outbound';
  source: string; // feishu, telegram, whatsapp
  projectId: string;
  chatId: string;
  userId?: string;
  userName?: string;
  content: string;
  messageId?: string;
  messageType?: string;
  metadata?: Record<string, any>;
}

/**
 * 消息日志器 - 按项目记录消息收发
 */
export class MessageLogger {
  private logDir: string;
  private projectLogs = new Map<string, MessageLogEntry[]>();
  private maxEntriesPerProject: number;

  constructor(logDir: string = './logs/messages', maxEntriesPerProject: number = 1000) {
    this.logDir = logDir;
    this.maxEntriesPerProject = maxEntriesPerProject;
  }

  /**
   * 初始化日志目录
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create message log directory:', error);
    }
  }

  /**
   * 记录消息
   */
  async log(entry: MessageLogEntry): Promise<void> {
    const { projectId } = entry;

    // 获取或创建项目日志
    let logs = this.projectLogs.get(projectId);
    if (!logs) {
      logs = [];
      this.projectLogs.set(projectId, logs);
    }

    // 添加新条目
    logs.push(entry);

    // 限制日志条目数量
    if (logs.length > this.maxEntriesPerProject) {
      logs.shift();
    }

    // 异步写入文件
    this.writeToFile(projectId).catch(error => {
      console.error(`Failed to write message log for ${projectId}:`, error);
    });
  }

  /**
   * 记录入站消息（从聊天平台收到）
   */
  async logIncoming(
    projectId: string,
    provider: string,
    chatId: string,
    content: string,
    userId?: string,
    userName?: string,
    messageId?: string,
    messageType?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      direction: 'inbound',
      source: provider,
      projectId,
      chatId,
      userId,
      userName,
      content,
      messageId,
      messageType,
      metadata,
    });
  }

  /**
   * 记录出站消息（发送到聊天平台）
   */
  async logOutgoing(
    projectId: string,
    provider: string,
    chatId: string,
    content: string,
    messageId?: string,
    messageType?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      timestamp: Date.now(),
      direction: 'outbound',
      source: provider,
      projectId,
      chatId,
      content,
      messageId,
      messageType,
      metadata,
    });
  }

  /**
   * 获取项目日志
   */
  async getProjectLogs(projectId: string): Promise<MessageLogEntry[]> {
    // 先从内存获取
    let logs = this.projectLogs.get(projectId);
    if (!logs) {
      logs = [];
      this.projectLogs.set(projectId, logs);
    }

    // 尝试从文件加载
    try {
      const filePath = this.getLogFilePath(projectId);
      const content = await fs.readFile(filePath, 'utf-8');
      const fileLogs = JSON.parse(content) as MessageLogEntry[];
      // 合并日志，去重
      const allLogs = new Map<number, MessageLogEntry>();
      logs.forEach(entry => allLogs.set(entry.timestamp, entry));
      fileLogs.forEach(entry => allLogs.set(entry.timestamp, entry));
      logs = Array.from(allLogs.values()).sort((a, b) => a.timestamp - b.timestamp);
      this.projectLogs.set(projectId, logs);
    } catch (error) {
      // 文件不存在或读取失败，使用内存中的日志
    }

    return logs;
  }

  /**
   * 获取项目的最近消息
   */
  async getRecentMessages(
    projectId: string,
    count: number = 50
  ): Promise<MessageLogEntry[]> {
    const logs = await this.getProjectLogs(projectId);
    return logs.slice(-count);
  }

  /**
   * 获取聊天记录
   */
  async getChatHistory(
    projectId: string,
    chatId: string,
    count: number = 50
  ): Promise<MessageLogEntry[]> {
    const logs = await this.getProjectLogs(projectId);
    return logs
      .filter(entry => entry.chatId === chatId)
      .slice(-count);
  }

  /**
   * 获取日志文件路径
   */
  private getLogFilePath(projectId: string): string {
    // 使用安全的项目名称作为文件名
    const safeProjectName = projectId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.logDir, `${safeProjectName}.jsonl`);
  }

  /**
   * 写入日志到文件
   */
  private async writeToFile(projectId: string): Promise<void> {
    const logs = this.projectLogs.get(projectId);
    if (!logs || logs.length === 0) {
      return;
    }

    const filePath = this.getLogFilePath(projectId);
    const content = logs.map(entry => JSON.stringify(entry)).join('\n');

    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      throw error;
    }
  }

  /**
   * 清除项目日志
   */
  async clearProjectLogs(projectId: string): Promise<void> {
    this.projectLogs.delete(projectId);

    try {
      const filePath = this.getLogFilePath(projectId);
      await fs.unlink(filePath);
    } catch (error) {
      // 文件不存在或删除失败，忽略
    }
  }

  /**
   * 获取所有项目列表
   */
  async listProjects(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.logDir);
      return files
        .filter(file => file.endsWith('.jsonl'))
        .map(file => file.replace('.jsonl', ''));
    } catch (error) {
      return [];
    }
  }

  /**
   * 导出日志为可读格式
   */
  async exportToReadable(projectId: string): Promise<string> {
    const logs = await this.getProjectLogs(projectId);

    let output = `# Message Log for Project: ${projectId}\n`;
    output += `# Generated: ${new Date().toISOString()}\n`;
    output += `# Total Messages: ${logs.length}\n\n`;

    for (const entry of logs) {
      const date = new Date(entry.timestamp);
      const direction = entry.direction === 'inbound' ? '▼' : '▲';
      const arrow = entry.direction === 'inbound' ? '→' : '←';

      output += `[${date.toISOString()}] ${direction} ${entry.source}\n`;
      output += `  ${arrow} Chat: ${entry.chatId}\n`;
      if (entry.userId) {
        output += `  ${arrow} User: ${entry.userName || entry.userId}\n`;
      }
      output += `  ${arrow} Content: ${entry.content}\n`;
      if (entry.messageId) {
        output += `  ${arrow} Message ID: ${entry.messageId}\n`;
      }
      output += '\n';
    }

    return output;
  }

  /**
   * 实时查看日志
   */
  watch(projectId: string, callback: (entry: MessageLogEntry) => void): () => void {
    let logs = this.projectLogs.get(projectId) || [];
    let lastLength = logs.length;

    // 轮询检查新消息
    const interval = setInterval(() => {
      const currentLogs = this.projectLogs.get(projectId) || [];
      if (currentLogs.length > lastLength) {
        const newLogs = currentLogs.slice(lastLength);
        lastLength = currentLogs.length;

        for (const entry of newLogs) {
          callback(entry);
        }
      } else if (currentLogs.length < lastLength) {
        // Handle array rotation (if maxEntriesPerProject is exceeded)
        lastLength = currentLogs.length;
      }
    }, 1000);

    return () => clearInterval(interval);
  }
}