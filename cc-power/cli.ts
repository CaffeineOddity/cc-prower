#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import { Command } from 'commander';
import { ConfigManager } from './core/config.js';
import { Logger } from './core/logger.js';
import { Router } from './core/router.js';
import { MessageLogger } from './core/message-logger.js';
import { MCPServer } from 'cc-power-mcp';
import chokidar from 'chokidar';

const CLI_NAME = 'cc-power';
const CLI_VERSION = '1.0.0';
const DEFAULT_CONFIG_FILE = './config.yaml';

const program = new Command();

program
  .name(CLI_NAME)
  .description('Lightweight bridge between Claude Code and chat platforms')
  .version(CLI_VERSION);

program
  .command('start')
  .description(`Start the ${CLI_NAME} service`)
  .option('-c, --config <path>', 'Path to config file', './config.yaml')
  .option('--stdio', 'Force stdio mode for MCP (useful when configured as stdio MCP server)')
  .action(async (options) => {
    await startService(options);
  });

program
  .command('init')
  .description('Initialize a new project config')
  .argument('[name]', 'Project name', 'default')
  .option('-p, --provider <type>', 'Provider type', 'feishu')
  .action(async (name, options) => {
    await initProject(name, options);
  });

program
  .command('validate')
  .description('Validate configuration')
  .option('-c, --config <path>', 'Path to config file', './config.yaml')
  .action(async (options) => {
    await validateConfig(options);
  });

program
  .command('run')
  .description('Run a project in a managed tmux session with Claude Code')
  .argument('<path>', 'Path to project directory')
  .option('-s, --session <name>', 'Custom tmux session name')
  .option('--dangerously-skip-permissions', 'Skip permission checks (dangerous)')
  .action(async (projectPath, options) => {
    await runProject(projectPath, options);
  });

program
  .command('status')
  .description('Show service status')
  .option('-c, --config <path>', 'Path to config file', './config.yaml')
  .action(async (options) => {
    await showStatus(options);
  });

program
  .command('logs')
  .description('View message logs')
  .argument('[project]', 'Project name (optional, lists all projects if not specified)')
  .option('-c, --count <number>', 'Number of recent messages', '50')
  .option('-o, --output <format>', 'Output format (json, readable)', 'readable')
  .option('-w, --watch', 'Watch for new messages in real-time')
  .option('--chat <chatId>', 'Filter by chat ID')
  .action(async (project, options) => {
    await showLogs(project, options);
  });

program.parse();

/**
 * 启动服务
 */
async function startService(options: any) {
  const { config: configPath, stdio: forceStdio } = options;

  console.log(`Starting ${CLI_NAME}...`);

  // 加载配置
  const actualConfigPath = configPath;
  const configManager = new ConfigManager();
  const globalConfig = await configManager.load(actualConfigPath);

  // 创建日志器
  const logger = new Logger(globalConfig.logging);

  // 如果设置了 --stdio 标志，强制使用 stdio 模式
  const transportMode = forceStdio ? 'stdio' : globalConfig.mcp.transport;

  logger.info(`${CLI_NAME} starting...`);
  logger.info(`Config: ${actualConfigPath}`);
  logger.info(`Transport: ${transportMode}${forceStdio ? ' (forced by --stdio flag)' : ''}`);

  // 创建消息日志器
  const messageLogger = new MessageLogger('./logs/messages');
  await messageLogger.initialize();

  // 创建路由器
  const router = new Router(configManager, logger, messageLogger);
  await router.initializeMessageLogger();

  // 创建 Backend Service 适配器
  const backend = {
    async registerProject(projectId: string, config: any): Promise<void> {
      await router.registerProject(projectId, config);
    },

    async unregisterProject(projectId: string): Promise<void> {
      await router.unregisterProject(projectId);
    },

    async sendMessage(args: {
      provider: string;
      chat_id: string;
      content: string;
      project_id?: string;
    }): Promise<any> {
      await router.handleMCPMessage({
        method: 'tools/call',
        params: {
          name: 'send_message',
          arguments: args,
        },
      });
    },

    async listChats(args: {
      provider: string;
      project_id?: string;
    }): Promise<any> {
      return await router.handleMCPMessage({
        method: 'tools/call',
        params: {
          name: 'list_chats',
          arguments: args,
        },
      });
    },

    async getStatus(args: { provider?: string }): Promise<any> {
      return await router.handleMCPMessage({
        method: 'tools/call',
        params: {
          name: 'get_status',
          arguments: args,
        },
      });
    },

    getRegisteredProjects(): string[] {
      return router.getRegisteredProjects();
    },

    logDebug(message: string, ...args: any[]): void {
      logger.debug(message, ...args);
    },

    logInfo(message: string, ...args: any[]): void {
      logger.info(message, ...args);
    },

    logWarn(message: string, ...args: any[]): void {
      logger.warn(message, ...args);
    },

    logError(message: string, ...args: any[]): void {
      logger.error(message, ...args);
    },

    async sendHeartbeat(projectId: string): Promise<void> {
      // Heartbeat functionality has been removed in favor of Tmux-based session monitoring
      // The function remains for interface compatibility but does nothing
      logger.debug(`Heartbeat call for ${projectId} (deprecated)`);
    },

    getProjectHeartbeatStatus(projectId: string): { lastHeartbeat: number; isAlive: boolean } {
      // Heartbeat functionality has been removed in favor of Tmux-based session monitoring
      // The function returns a default value for interface compatibility
      logger.debug(`Heartbeat status request for ${projectId} (deprecated)`);
      return { lastHeartbeat: Date.now(), isAlive: true };
    },

    async getIncomingMessages(args: {
      project_id: string;
      since?: number;
    }): Promise<any[]> {
      return await router.getIncomingMessages(args);
    },

    setNotificationSender(sender: (message: any) => Promise<void>): void {
      router.setNotificationSender(sender);
    },
  };

  // 设置信号目录路径
  const signalsDir = path.join(process.env.HOME || '', '.cc-power', 'signals');
  await fs.mkdir(signalsDir, { recursive: true });

  // 创建文件监听器，监听信号文件
  const watcher = chokidar.watch(signalsDir, {
    ignored: /^\./, // 忽略隐藏文件
    persistent: true,
  });

  watcher.on('add', async (filePath) => {
    if (filePath.endsWith('.json')) {
      await processSignalFile(filePath, backend, logger);
    }
  });

  // 创建 MCP 服务器
  const mcpServer = new MCPServer(backend, {
    name: CLI_NAME,
    version: CLI_VERSION,
  });

  // 根据传输方式启动
  if (transportMode === 'http') {
    console.log(`${CLI_NAME} does not support HTTP mode anymore. Using stdio mode.`);
  }

  console.log(`${CLI_NAME} is ready. Projects will be registered when clients connect via MCP.`);
  console.log('Press Ctrl+C to stop the server.\n');

  await mcpServer.startStdio();

  // 优雅关闭
  const shutdown = async () => {
    logger.info('Shutting down...');

    // 清理路由器资源
    await router.cleanup();

    await mcpServer.stop();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  logger.info(`${CLI_NAME} started successfully`);
}

/**
 * 初始化项目
 */
async function initProject(name: string, options: any) {
  const { provider } = options;

  console.log(`Initializing project "${name}" with provider: ${provider}`);

  const projectsDir = './projects';
  await fs.mkdir(projectsDir, { recursive: true });

  const projectDir = path.join(projectsDir, name);
  await fs.mkdir(projectDir, { recursive: true });

  const configPath = path.join(projectDir, 'config.yaml');

  let configTemplate = '';

  switch (provider) {
    case 'feishu':
      configTemplate = `provider: feishu

feishu:
  app_id: "cli_app_id_here"
  app_secret: "your_app_secret_here"
  bot_name: "Claude Bot"
  allowed_users:
    - "ou_user_id_1"
    - "ou_user_id_2"

session:
  max_history: 50
  timeout_minutes: 30
`;
      break;

    case 'telegram':
      configTemplate = `provider: telegram

telegram:
  bot_token: "your_bot_token_here"
  allowed_chats:
    - 123456789
    - 987654321

session:
  max_history: 50
  timeout_minutes: 30
`;
      break;

    case 'whatsapp':
      configTemplate = `provider: whatsapp

whatsapp:
  phone_number: "your_phone_number_id_here"
  api_key: "your_api_key_here"
  allowed_numbers:
    - "+1234567890"
    - "+0987654321"

session:
  max_history: 50
  timeout_minutes: 30
`;
      break;

    default:
      console.error(`Unknown provider: ${provider}`);
      process.exit(1);
  }

  await fs.writeFile(configPath, configTemplate);

  console.log(`Project config created at: ${configPath}`);
  console.log('Please edit the config file with your credentials.');
}

/**
 * 验证配置
 */
async function validateConfig(options: any) {
  const { config: configPath } = options;

  console.log(`Validating config: ${configPath}`);

  const configManager = new ConfigManager();

  try {
    const globalConfig = await configManager.load(configPath);
    console.log('✓ Global config is valid');

    console.log(`\nEnabled Providers:`);
    for (const [provider, config] of Object.entries(globalConfig.providers)) {
      console.log(`  - ${provider}: ${config.enabled ? 'enabled' : 'disabled'}`);
    }
  } catch (error) {
    console.error(`✗ Validation failed:`, error);
    process.exit(1);
  }

  console.log('Config is valid!');
}

/**
 * 显示状态
 */
async function showStatus(options: any) {
  const { config: configPath } = options;

  console.log(`${CLI_NAME} status`);

  const configManager = new ConfigManager();

  try {
    const globalConfig = await configManager.load(configPath);

    console.log(`\nGlobal Config: ${configPath}`);
    console.log(`Transport: ${globalConfig.mcp.transport}`);
    console.log(`Log Level: ${globalConfig.logging.level}`);

    console.log(`\nEnabled Providers:`);
    for (const [provider, config] of Object.entries(globalConfig.providers)) {
      console.log(`  - ${provider}: ${config.enabled ? 'enabled' : 'disabled'}`);
    }
  } catch (error) {
    console.error(`Failed to get status:`, error);
    process.exit(1);
  }
}

/**
 * 运行项目 (Tmux 模式)
 */
async function runProject(projectPath: string, options: any) {
  const { session, dangerouslySkipPermissions } = options;
  const absProjectPath = path.resolve(projectPath);
  const projectName = path.basename(absProjectPath);

  // 生成项目ID（使用项目绝对路径的MD5哈希前8位）
  const crypto = await import('crypto');
  const projectId = crypto.createHash('md5').update(absProjectPath).digest('hex').substring(0, 8);

  const sessionName = session || `cc-p-${projectId}`;
  const configManager = new ConfigManager();

  // 检查是否安装了 tmux
  try {
    execSync('tmux -V', { stdio: 'ignore' });
  } catch (error) {
    console.error('Error: tmux is not installed. Please install tmux to use this command.');
    process.exit(1);
  }

  // 尝试加载项目配置
  const configPaths = [
    path.join(absProjectPath, '.cc-power.yaml'),
    path.join(absProjectPath, 'config.yaml'),
  ];

  let projectConfig: any = null;
  for (const candidate of configPaths) {
    try {
      const content = await fs.readFile(candidate, 'utf-8');
      const yaml = await import('yaml');
      projectConfig = yaml.parse(content);
      break;
    } catch (error) {
      continue;
    }
  }

  if (!projectConfig) {
    console.warn(`Warning: No .cc-power.yaml found in ${absProjectPath}. Using default settings.`);
  }

  console.log(`Running project ${projectName} (ID: ${projectId}) in tmux session: ${sessionName}`);

  // 检查 session 是否存在
  let sessionExists = false;
  try {
    execSync(`tmux has-session -t ${sessionName}`, { stdio: 'ignore' });
    sessionExists = true;
  } catch (error) {
    sessionExists = false;
  }

  if (sessionExists) {
    console.log(`Attaching to existing session: ${sessionName}`);
  } else {
    console.log(`Creating new session: ${sessionName}`);

    // 构建 claude 命令
    let claudeCmd = 'claude';
    if (dangerouslySkipPermissions) {
      claudeCmd += ' --dangerously-skip-permissions';
    }

    // 启动新 session，并进入项目目录运行 claude
    // 使用 -d 后台启动
    const cmd = `tmux new-session -d -s ${sessionName} -c ${absProjectPath} '${claudeCmd}'`;
    execSync(cmd);

    // 生成注册信号
    await generateRegisterSignal(projectId, sessionName, absProjectPath, projectConfig);

    // 记录项目历史
    await recordProjectHistory(projectId, absProjectPath, projectConfig, sessionName);
  }

  // Attach 到 session
  // 使用 spawn 继承 stdio，这样用户可以直接交互
  const attach = spawn('tmux', ['attach', '-t', sessionName], {
    stdio: 'inherit',
    shell: true
  });

  attach.on('close', async (code: number | null) => {
    if (code !== 0) {
      console.log(`Tmux session detached with code ${code}`);
    }

    // 退出时生成注销信号
    await generateUnregisterSignal(projectId);
  });
}

/**
 * 生成注册信号文件
 */
async function generateRegisterSignal(projectId: string, tmuxSession: string, projectDir: string, projectConfig?: any) {
  const signalsDir = path.join(process.env.HOME || '', '.cc-power', 'signals');
  await fs.mkdir(signalsDir, { recursive: true });

  const signalPath = path.join(signalsDir, `register-${projectId}.json`);

  const signal = {
    type: 'register',
    projectId,
    tmuxPane: `${tmuxSession}:0`, // 默认第一个窗口
    timestamp: Date.now(),
    projectDirectory: projectDir,
    provider: projectConfig?.provider || 'unknown',
    config: projectConfig || {},
    // 其他配置由后台服务从项目目录加载或在此处解析补充
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectId} registered with session ${tmuxSession}`);
}

/**
 * 生成注销信号文件
 */
async function generateUnregisterSignal(projectId: string) {
  const signalsDir = path.join(process.env.HOME || '', '.cc-power', 'signals');
  await fs.mkdir(signalsDir, { recursive: true });

  const signalPath = path.join(signalsDir, `unregister-${projectId}.json`);

  const signal = {
    type: 'unregister',
    projectId,
    timestamp: Date.now(),
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectId} unregistered`);
}

/**
 * 记录项目历史
 */
async function recordProjectHistory(projectId: string, projectPath: string, config: any, sessionName: string) {
  const cacheDir = path.join(process.env.HOME || '', '.cc-power', 'cache');
  await fs.mkdir(cacheDir, { recursive: true });

  const historyPath = path.join(cacheDir, 'project_history.json');

  let history: any = {};
  try {
    const content = await fs.readFile(historyPath, 'utf-8');
    history = JSON.parse(content);
  } catch (error) {
    // 文件不存在或格式错误，使用空对象
  }

  history[projectId] = {
    projectId,
    projectPath,
    config,
    sessionName,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
  console.log(`Project history recorded for ${projectId}`);
}

/**
 * 显示消息日志
 */
async function showLogs(project: string | undefined, options: any) {
  const { count, output, watch, chat } = options;
  const messageLogger = new MessageLogger('./logs/messages');

  await messageLogger.initialize();

  if (!project) {
    const projects = await messageLogger.listProjects();
    if (projects.length === 0) {
      console.log('No message logs found.');
      return;
    }

    console.log('Available projects with message logs:');
    for (const p of projects) {
      const logs = await messageLogger.getProjectLogs(p);
      console.log(`  - ${p} (${logs.length} messages)`);
    }
    return;
  }

  const countNum = parseInt(count, 10);

  if (watch) {
    console.log(`Watching messages for project: ${project}`);
    console.log('Press Ctrl+C to stop...\n');

    const unwatch = messageLogger.watch(project, (entry) => {
      if (chat && entry.chatId !== chat) {
        return;
      }

      const date = new Date(entry.timestamp);
      const direction = entry.direction === 'inbound' ? '▼' : '▲';
      const arrow = entry.direction === 'inbound' ? '→' : '←';

      console.log(`[${date.toLocaleString()}] ${direction} ${entry.source}`);
      console.log(`  ${arrow} Chat: ${entry.chatId}`);
      if (entry.userId) {
        console.log(`  ${arrow} User: ${entry.userName || entry.userId}`);
      }
      console.log(`  ${arrow} Content: ${entry.content}`);
      console.log();
    });

    process.on('SIGINT', () => {
      unwatch();
      process.exit(0);
    });
  } else {
    let logs: any[];

    if (chat) {
      logs = await messageLogger.getChatHistory(project, chat, countNum);
    } else {
      logs = await messageLogger.getRecentMessages(project, countNum);
    }

    if (logs.length === 0) {
      console.log(`No messages found for project: ${project}`);
      return;
    }

    if (output === 'json') {
      console.log(JSON.stringify(logs, null, 2));
    } else {
      const readable = await messageLogger.exportToReadable(project);
      console.log(readable);
    }
  }
}

/**
 * 处理信号文件
 */
async function processSignalFile(filePath: string, backend: any, logger: any): Promise<void> {
  try {
    const fileName = path.basename(filePath);
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const signal = JSON.parse(fileContent);

    logger.info(`Processing signal file: ${fileName}`, signal);

    if (fileName.startsWith('register-') && fileName.endsWith('.json')) {
      // 从信号中获取项目目录
      const projectDir = signal.projectDirectory;
      if (!projectDir) {
        logger.error(`No projectDirectory found in register signal: ${fileName}`);
        return;
      }

      // 从项目目录加载 .cc-power.yaml 配置文件
      const configFile = path.join(projectDir, '.cc-power.yaml');
      let projectConfig: any;

      try {
        const configContent = await fs.readFile(configFile, 'utf-8');
        const yaml = await import('yaml');
        projectConfig = yaml.parse(configContent);
      } catch (error) {
        logger.error(`Failed to load project config from ${configFile}:`, error);
        return;
      }

      // 从信号和项目配置构建完整的项目配置
      const projectId = signal.projectId || path.basename(projectDir);
      const finalConfig = {
        ...projectConfig,
        tmuxPane: signal.tmuxPane, // 从信号文件获取 tmux pane 信息
      };

      // 调用注册方法
      await backend.registerProject(projectId, finalConfig);
      logger.info(`Successfully registered project: ${projectId} from signal`);

      // 处理完成后删除信号文件
      await fs.unlink(filePath);
      logger.debug(`Deleted processed signal file: ${filePath}`);
    } else if (fileName.startsWith('unregister-') && fileName.endsWith('.json')) {
      // 处理注销信号
      const projectId = signal.projectId;
      if (!projectId) {
        logger.error(`No projectId found in unregister signal: ${fileName}`);
        return;
      }

      // 调用注销方法
      await backend.unregisterProject(projectId);
      logger.info(`Successfully unregistered project: ${projectId} from signal`);

      // 处理完成后删除信号文件
      await fs.unlink(filePath);
      logger.debug(`Deleted processed signal file: ${filePath}`);
    }
  } catch (error) {
    logger.error(`Failed to process signal file ${filePath}:`, error);
  }
}