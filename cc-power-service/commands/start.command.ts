import * as fs from 'fs/promises';
import * as path from 'path';
import chokidar from 'chokidar';
import { ConfigManager } from '../core/config.js';
import { Logger } from '../core/logger.js';
import { Router } from '../core/router.js';
import { MessageLogger } from '../core/message-logger.js';
import { BaseCommand } from './base.command.js';
import { getSignalsDir, getHooksDir } from '../utils/signals.js';

const CLI_NAME = 'ccpower';

/**
 * Start 命令 - 启动 cc-power 服务
 */
export class StartCommand extends BaseCommand {
  private logger: Logger | null = null;
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

    // 创建日志器
    this.logger = new Logger(globalConfig.logging);

    this.logger.info(`${CLI_NAME} starting...`);
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
      this.logger?.info(`[cc-power] hooksWatcher add: ${filePath}`);
      if (path.basename(filePath).startsWith('send-') && filePath.endsWith('.json')) {
        await this.processHookSignal(filePath);
      }
    });

    if (!forceStdio) {
      console.log(`${CLI_NAME} is ready. Projects will be registered when you run 'ccpower run'.`);
      console.log('Press Ctrl+C to stop the server.\n');
    }

    // 优雅关闭
    const shutdown = async () => {
      this.logger?.info('Shutting down...');

      // 清理路由器资源
      await this.router?.cleanup();

      this.logger?.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    process.on('uncaughtException', (err) => {
      this.logger?.error('Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, promise) => {
      this.logger?.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    this.logger.info(`${CLI_NAME} started successfully`);
  }

  /**
   * 处理信号文件
   */
  private async processSignalFile(filePath: string): Promise<void> {
    if (!this.router || !this.logger) return;

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
      this.logger.info(`Processing signal file: ${fileName}`, signal);

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
  private async handleRegisterSignal(filePath: string, signal: any): Promise<void> {
    if (!this.router || !this.logger) return;

    const projectDir = signal.projectDirectory;
    if (!projectDir) {
      this.logger.error(`No projectDirectory in register signal`);
      return;
    }

    // 加载项目配置
    const configFile = path.join(projectDir, '.cc-power.yaml');
    let projectConfig: any;

    try {
      const configContent = await fs.readFile(configFile, 'utf-8');
      const yaml = await import('yaml');
      projectConfig = yaml.parse(configContent);
    } catch (error) {
      this.logger.error(`Failed to load project config:`, error);
      return;
    }

    const projectId = signal.projectId || path.basename(projectDir);
    const finalConfig = {
      ...projectConfig,
      tmuxPane: signal.tmuxPane,
    };

    await this.router.registerProject(projectId, finalConfig);
    this.logger.info(`Successfully registered project: ${projectId}`);

    await fs.unlink(filePath).catch(() => {});
  }

  /**
   * 处理注销信号
   */
  private async handleUnregisterSignal(filePath: string, signal: any): Promise<void> {
    if (!this.router || !this.logger) return;

    const projectId = signal.projectId;
    if (!projectId) {
      this.logger.error(`No projectId in unregister signal`);
      return;
    }

    await this.router.unregisterProject(projectId);
    this.logger.info(`Successfully unregistered project: ${projectId}`);

    await fs.unlink(filePath).catch(() => {});
  }

  /**
   * 处理 Hook 信号文件
   */
  private async processHookSignal(filePath: string): Promise<void> {
    if (!this.router || !this.logger) return;

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
      this.logger.info(`Received hook signal`);

      // 支持新旧两种信号格式
      if (signal.type === 'send_message' && signal.chatId && signal.content) {
        await this.handleOldHookSignal(signal);
      } else if (signal.hook_event_name === 'Stop' || (signal.provider && signal.project_id)) {
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
   * 处理旧格式 Hook 信号
   */
  private async handleOldHookSignal(signal: any): Promise<void> {
    if (!this.router || !this.logger) return;

    const { provider, projectId, chatId, content } = signal;

    const providerInstance = this.router.getProvider(projectId);
    if (!providerInstance) {
      this.logger.error(`Provider not found: ${projectId}`);
      return;
    }

    await providerInstance.sendMessage(chatId, content);
    this.logger.info(`Hook message sent to ${provider}:${chatId}`);
  }

  /**
   * 处理新格式 Hook 信号
   */
  private async handleNewHookSignal(signal: any): Promise<void> {
    if (!this.router || !this.logger) return;

    const { provider, project_id: projectId, transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage } = signal;

    const providerInstance = this.router.getProvider(projectId);
    if (!providerInstance) {
      this.logger.error(`Provider not found: ${projectId}`);
      return;
    }

    // 从项目历史获取 chat_id
    const { getProjectHistory } = await import('../utils/history.js');
    const history = await getProjectHistory(projectId);

    const chatId = history?.config?.chat_id || history?.config?.provider?.chat_id;
    if (!chatId) {
      this.logger.error(`No chat_id found for project: ${projectId}`);
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
    this.logger.info(`Hook message sent to ${provider}:${chatId}`);
  }
}