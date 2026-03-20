import { Command } from 'commander';
import { Logger } from '../utils/logger.js';
import  { type TemplateProviderConfig } from '../types/index.js';
import * as path from 'path';
import * as fs from 'fs/promises';
/**
 * 命令基类
 * 所有 CLI 命令都继承此类
 */
export abstract class BaseCommand {
  protected program: Command;
  protected logger: Logger;

  constructor(program: Command) {
    this.program = program;
    // CLI 命令使用 info 级别日志，会输出到控制台
    this.logger = new Logger({ level: 'info' });
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
    this.logger.error(`${contextStr}${message}`);
    process.exit(1);
  }
}

export async function get_project_config_template(projectPath:string): Promise<TemplateProviderConfig | null> {

    const absProjectPath = path.resolve(projectPath);
    const projectName = path.basename(absProjectPath);

    // 尝试加载项目配置
    const configPaths = [
        path.join(absProjectPath, '.cc-power.yaml'),
        path.join(absProjectPath, 'config.yaml'),
    ];

    let projectConfig: TemplateProviderConfig | null = null;
    for (const candidate of configPaths) {
        try {
            const content = await fs.readFile(candidate, 'utf-8');
            const yaml = await import('yaml');
            projectConfig = yaml.parse(content) as TemplateProviderConfig;
            break;
        } catch (error) {
            console.log(`Error loading config from ${candidate}: ${error}`);
            continue;
        }
    }
    if (projectConfig && projectConfig.project_name == "") {
        projectConfig.project_name = projectName;
    }
  return projectConfig;
}
