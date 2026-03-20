import * as fs from 'fs/promises';
import * as path from 'path';
import chokidar from 'chokidar';
import { ConfigManager } from '../core/config.js';
import { Logger } from '../utils/logger.js';
import { Router } from '../core/router.js';
import { MessageLogger } from '../utils/message-logger.js';
import { BaseCommand,get_project_config_template } from './base.command.js';
import { getSignalsDir, getHooksDir,UnregisterSignal,RegisterSignal } from '../utils/signals.js';
import  {
  type TemplateProviderConfig,
  get_project_id
} from '../types/provider.config.js';
const CLI_NAME = 'ccpower';

/**
 * Start 命令 - 启动 cc-power 服务
 */
export class StartCommand extends BaseCommand {
  private router: Router | null = null;

  getName(): string {
    return 'start';
  }

  getDescription(): string {
    return `Start the ${CLI_NAME} service`;
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .option('-c, --config <path>', 'Path to config file', './config.yaml')
      .option('--stdio', 'Force stdio mode for MCP')
      .action(async (options) => {
        await this.execute(options);
      });
  }

  async execute(options: any): Promise<void> {
    const { config: configPath, stdio: forceStdio } = options;

    if (!forceStdio) {
      console.log(`Starting ${CLI_NAME}...`);
    }

    // 加载配置
    const actualConfigPath = configPath;
    const configManager = new ConfigManager();
    const globalConfig = await configManager.load(actualConfigPath);

    // 创建日志器（使用配置的日志级别）
    this.logger = new Logger(globalConfig.logging);

    // 在非 stdio 模式下输出到控制台
    if (!forceStdio) {
      this.logger.info(`${CLI_NAME} starting...`);
    }
    this.logger.info(`Config: ${actualConfigPath}`);

    // 创建消息日志器
    const messageLogger = new MessageLogger();
    await messageLogger.initialize();

    // 创建路由器
    this.router = new Router(configManager, this.logger, messageLogger);
    await this.router.initializeMessageLogger();

    // 设置信号目录
    const signalsDir = getSignalsDir();
    await fs.mkdir(signalsDir, { recursive: true });

    // 创建文件监听器
    const watcher = chokidar.watch(signalsDir, {
      ignored: /^\./,
      persistent: true,
    });

    watcher.on('add', async (filePath) => {
      if (filePath.endsWith('.json')) {
        await this.processSignalFile(filePath);
      }
    });

    // 设置 hooks 目录
    const hooksDir = getHooksDir();
    await fs.mkdir(hooksDir, { recursive: true });

    const hooksWatcher = chokidar.watch(hooksDir, {
      ignored: /^\./,
      persistent: true,
    });

    hooksWatcher.on('add', async (filePath) => {
      this.logger.info(`[cc-power] hooksWatcher add: ${filePath}`);
      if (path.basename(filePath).startsWith('send-') && filePath.endsWith('.json')) {
        await this.processHookSignal(filePath);
      }
    });

    if (!forceStdio) {
      this.logger.info(`${CLI_NAME} is ready. Projects will be registered when you run 'ccpower run'.`);
      this.logger.info('Press Ctrl+C to stop the server.\n');
    }

    // 优雅关闭
    const shutdown = async () => {
      this.logger.info('Shutting down...');

      // 清理路由器资源
      await this.router?.cleanup();

      this.logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    process.on('uncaughtException', (err) => {
      this.logger.error('Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    this.logger.info(`${CLI_NAME} started successfully`);
  }

  /**
   * 处理信号文件
   */
  private async processSignalFile(filePath: string): Promise<void> {
    if (!this.router) return;

    try {
      const fileName = path.basename(filePath);

      let fileContent: string;
      try {
        fileContent = await fs.readFile(filePath, 'utf-8');
      } catch (readError: any) {
        if (readError.code === 'ENOENT') {
          this.logger.debug(`Signal file already processed: ${filePath}`);
          return;
        }
        throw readError;
      }

      const signal = JSON.parse(fileContent);
      this.logger.info(`Processing signal file: ${fileName}`);

      if (fileName.startsWith('register-')) {
        await this.handleRegisterSignal(filePath, signal);
      } else if (fileName.startsWith('unregister-')) {
        await this.handleUnregisterSignal(filePath, signal);
      }
    } catch (error) {
      this.logger.error(`Failed to process signal file ${filePath}:`, error);
    }
  }

  /**
   * 处理注册信号
   */
  private async handleRegisterSignal(filePath: string, signal: RegisterSignal): Promise<void> {
    if (!this.router) return;

    const projectDir = signal.projectDirectory;
    if (!projectDir) {
      this.logger.error(`No projectDirectory in register signal`);
      return;
    }
    
    let projectConfig = await get_project_config_template(projectDir)

    if (!projectConfig) {
        this.logger.error(`No projectConfig in register signal`);
        return;
    }

    const finalConfig = {
      ...projectConfig,
      tmuxPane: signal.tmuxPane,
    };

    // 不再需要 projectId，由 router 自动生成
    await this.router.registerProject(undefined, finalConfig);
    this.logger.info(`Successfully registered project from signal: ${signal.projectName}`);

    await fs.unlink(filePath).catch(() => {});
  }

  /**
   * 处理注销信号
   */
  private async handleUnregisterSignal(filePath: string, signal: UnregisterSignal): Promise<void> {
    if (!this.router) return;

    const config = signal as UnregisterSignal
    const projectId = get_project_id(config.config);
    const projectName = signal.projectName;

    if (!projectId && !projectName) {
      this.logger.error(`No projectId or projectName in unregister signal`);
      return;
    }

    if (projectId) {
      await this.router.unregisterProject(projectId);
      this.logger.info(`Successfully unregistered project: ${projectId}`);
    } else if (projectName) {
      // 查找所有已注册的项目，匹配项目名称
      const registeredProjects = this.router.getRegisteredProjects();
      for (const pid of registeredProjects) {
        const provider = this.router.getProvider(pid);
        if (provider && provider.getProjectName() === projectName) {
          await this.router.unregisterProject(pid);
          this.logger.info(`Successfully unregistered project: ${pid} [${projectName}]`);
          break;
        }
      }
    }

    await fs.unlink(filePath).catch(() => {});
  }

  /**
   * 处理 Hook 信号文件
   */
  private async processHookSignal(filePath: string): Promise<void> {
    if (!this.router) return;

    try {
      let fileContent: string;
      try {
        fileContent = await fs.readFile(filePath, 'utf-8');
      } catch (readError: any) {
        if (readError.code === 'ENOENT') {
          return;
        }
        throw readError;
      }

      const signal = JSON.parse(fileContent);
      this.logger.info(`Received hook signal: ${filePath}`);

      if (signal.hook_event_name === 'Stop' || (signal.provider && signal.project_name)) {
        await this.handleNewHookSignal(signal);
      } else {
        this.logger.warn(`Unknown hook signal format`);
        return;
      }

      await fs.unlink(filePath).catch(() => {});
    } catch (error) {
      this.logger.error(`Failed to process hook signal:`, error);
    }
  }

 

  /**
   * 处理新格式 Hook 信号
   */
  private async handleNewHookSignal(signal: any): Promise<void> {
    if (!this.router) return;

    const { transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage, cwd } = signal;
    const templateConfig = signal as TemplateProviderConfig;
    // 尝试使用 projectId 或从项目路径推断
    let providerInstance = null;
    let actualProjectId = get_project_id(templateConfig);

    // 如果没有 projectId，尝试从项目路径推断
    if (!actualProjectId && cwd) {
      const { readProjectHistory } = await import('../utils/history.js');
      const projectHistory = await readProjectHistory();

      // 查找匹配的项目路径
      for (const [key, entry] of Object.entries(projectHistory)) {
        if (entry.projectPath === cwd || entry.projectPath === cwd.replace(/\/$/, '')) {
          actualProjectId = entry.projectId || key;
          break;
        }
      }
    }

    if (actualProjectId) {
      providerInstance = this.router.getProvider(actualProjectId);
    }

    if (!providerInstance) {
      this.logger.error(`Provider not found: ${actualProjectId || 'unknown'}`);
      return;
    }

    // 从项目历史或配置获取 chat_id
    let chatId: string | undefined;
    if (actualProjectId) {
      const { getProjectHistory } = await import('../utils/history.js');
      const history = await getProjectHistory(actualProjectId);
      chatId = history?.config?.provider?.chat_id || history?.config?.chat_id;
    }

    if (!chatId && cwd) {
      // 尝试从配置文件直接读取
      try {
        const configPaths = [
          path.join(cwd, '.cc-power.yaml'),
          path.join(cwd, 'config.yaml'),
        ];
        for (const candidate of configPaths) {
          try {
            const content = await fs.readFile(candidate, 'utf-8');
            const yaml = await import('yaml');
            const config = yaml.parse(content);
            chatId = config?.provider?.chat_id || config?.chat_id;
            if (chatId) break;
          } catch (error) {
            continue;
          }
        }
      } catch (error) {
        this.logger.debug(`Failed to read config for chat_id`);
      }
    }

    if (!chatId) {
      this.logger.error(`No chat_id found for project: ${actualProjectId}`);
      return;
    }

    // 获取响应内容
    let content = lastAssistantMessage;
    if (transcriptPath) {
      try {
        const transcriptLines = await fs.readFile(transcriptPath, 'utf-8');
        const lines = transcriptLines.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const entry = JSON.parse(lines[i]);
          if (entry.role === 'assistant') {
            content = entry.content;
            break;
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to read transcript`);
      }
    }

    if (!content) {
      this.logger.warn(`No content found for hook signal`);
      return;
    }

    await providerInstance.sendMessage(chatId, content);
    this.logger.info(`Hook message sent to ${actualProjectId}:${chatId}`);
  }
}