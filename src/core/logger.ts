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
    this.file = config.file;
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
    console.log(formattedMessage);

    if (this.file) {
      try {
        await import('fs/promises').then(fs =>
          fs.appendFile(this.file!, formattedMessage + '\n')
        );
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