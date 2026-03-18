import { homedir } from 'os';
import { resolve } from 'path';

/**
 * 简单的日志器实现
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private level: LogLevel;
  private file?: string;
  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: { level: LogLevel; file?: string }) {
    this.level = config.level;
    // 支持 ~ 路径展开
    this.file = config.file ? this.expandHomeDir(config.file) : undefined;
  }

  private expandHomeDir(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return resolve(homedir(), filePath.slice(2));
    }
    return filePath;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private format(level: LogLevel, message: string, args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const formattedMessage = args.length > 0
      ? `${prefix} ${message} ${JSON.stringify(args)}`
      : `${prefix} ${message}`;
    return formattedMessage;
  }

  private async write(formattedMessage: string): Promise<void> {
    console.error(formattedMessage);

    if (this.file) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');

        // 确保目录存在
        const dir = path.dirname(this.file);
        try {
          await fs.mkdir(dir, { recursive: true });
        } catch {
          // 如果目录创建失败，可能已存在，继续尝试写入
        }

        await fs.appendFile(this.file, formattedMessage + '\n');
      } catch (error) {
        // 文件写入失败时不影响控制台输出
        console.error('Failed to write to log file:', error);
      }
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      this.write(this.format('debug', message, args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      this.write(this.format('info', message, args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) {
      this.write(this.format('warn', message, args));
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) {
      this.write(this.format('error', message, args));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}