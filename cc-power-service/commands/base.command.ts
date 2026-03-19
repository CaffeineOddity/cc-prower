import { Command } from 'commander';

/**
 * 命令基类
 * 所有 CLI 命令都继承此类
 */
export abstract class BaseCommand {
  protected program: Command;

  constructor(program: Command) {
    this.program = program;
  }

  /**
   * 注册命令到 commander
   */
  abstract register(): void;

  /**
   * 执行命令
   */
  abstract execute(...args: any[]): Promise<void> | void;

  /**
   * 获取命令名称
   */
  abstract getName(): string;

  /**
   * 获取命令描述
   */
  abstract getDescription(): string;

  /**
   * 统一错误处理
   */
  protected handleError(error: unknown, context?: string): never {
    const message = error instanceof Error ? error.message : String(error);
    const contextStr = context ? `[${context}] ` : '';
    console.error(`Error: ${contextStr}${message}`);
    process.exit(1);
  }
}