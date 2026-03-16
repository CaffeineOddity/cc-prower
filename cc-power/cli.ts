#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { Command } from 'commander';
import { ConfigManager } from './core/config.js';
import { Logger } from './core/logger.js';
import { Router } from './core/router.js';
import { MessageLogger } from './core/message-logger.js';
import { MCPServer } from 'cc-power-mcp';
import type { ProjectConfig } from './types/config.js';

const CLI_NAME = 'cc-power';
const CONFIG_FILES = ['.cc-power.yaml', 'cc-power.yaml', 'config.yaml'];

const packageJson = JSON.parse(
  await fs.readFile(new URL('./package.json', import.meta.url), 'utf-8')
);

/**
 * 加载所有项目配置（仅在 CLI 命令中使用）
 */
async function loadAllProjects(projectsDir: string): Promise<Map<string, ProjectConfig>> {
  const projects = new Map<string, ProjectConfig>();

  try {
    await fs.access(projectsDir);
  } catch {
    return projects;
  }

  const entries = await fs.readdir(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.name.endsWith('.yaml') && !entry.isDirectory()) {
      continue;
    }

    let projectId: string;

    if (entry.isDirectory()) {
      projectId = entry.name;
    } else {
      projectId = entry.name.replace('.yaml', '');
    }

    try {
      const possiblePaths = [
        path.join(projectsDir, projectId, 'config.yaml'),
        path.join(projectsDir, `${projectId}.yaml`),
      ];

      for (const configPath of possiblePaths) {
        try {
          const content = await fs.readFile(configPath, 'utf-8');
          const config = yaml.parse(content) as ProjectConfig;

          if (!config.provider) {
            throw new Error(`Missing provider in ${configPath}`);
          }

          projects.set(projectId, config);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
    } catch (error) {
      console.error(`Failed to load project ${projectId}:`, error);
    }
  }

  return projects;
}

/**
 * 自动注册当前目录的项目
 */
async function autoRegisterProject(
  backend: any,
  currentDir: string,
  logger: Logger
): Promise<string | null> {
  const possibleConfigFiles = CONFIG_FILES.map(f => path.join(currentDir, f));

  for (const configPath of possibleConfigFiles) {
    try {
      await fs.access(configPath);
      const content = await fs.readFile(configPath, 'utf-8');

      if (content.includes('provider:')) {
        try {
          const config = yaml.parse(content) as any;

          if (config.provider) {
            // 使用当前目录名作为项目 ID
            const projectId = path.basename(currentDir);

            logger.info(`Auto-registering project: ${projectId} from ${path.basename(configPath)}`);

            // 构建项目配置
            const projectConfig: any = {
              projectId,
              ...config,
            };

            // 注册项目
            await backend.registerProject(projectId, projectConfig);

            logger.info(`Project ${projectId} auto-registered successfully`);

            return projectId;
          }
        } catch (parseError) {
          logger.error(`Failed to parse config file ${configPath}:`, parseError);
        }
      }
    } catch {
      // 文件不存在，继续尝试
    }
  }

  return null;
}

const program = new Command();

program
  .name(CLI_NAME)
  .description('Lightweight bridge between Claude Code and chat platforms')
  .version(packageJson.version);

program
  .command('start')
  .description(`Start the ${CLI_NAME} service`)
  .option('-c, --config <path>', 'Path to config file', './config.yaml')
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
  const { config: configPath } = options;

  console.log(`Starting ${CLI_NAME}...`);

  // 检查当前目录下是否有项目配置
  const currentDir = process.cwd();
  const possibleProjectConfigs = CONFIG_FILES.map(f => path.join(currentDir, f));

  let actualConfigPath = configPath;
  let autoDetectedProject = false;

  // 尝试自动检测项目配置
  for (const possiblePath of possibleProjectConfigs) {
    try {
      await fs.access(possiblePath);
      const content = await fs.readFile(possiblePath, 'utf-8');

      if (content.includes('provider:') || content.includes('provider:')) {
        actualConfigPath = possiblePath;
        autoDetectedProject = true;
        console.log(`Auto-detected project config: ${path.basename(possiblePath)}`);
        break;
      }
    } catch {
      // 文件不存在，继续尝试
    }
  }

  // 加载配置
  const configManager = new ConfigManager();
  const globalConfig = await configManager.load(actualConfigPath);

  // 创建日志器
  const logger = new Logger(globalConfig.logging);

  logger.info(`${CLI_NAME} starting...`);
  logger.info(`Config: ${actualConfigPath}${autoDetectedProject ? ' (auto-detected)' : ''}`);

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
  };

  // 创建 MCP 服务器
  const mcpServer = new MCPServer(backend, {
    name: CLI_NAME,
    version: packageJson.version,
  });

  // 自动注册当前目录的项目（如果存在）
  const autoRegisteredProjectId = await autoRegisterProject(backend, currentDir, logger);

  // 启动 MCP 服务器
  await mcpServer.startStdio();

  // 优雅关闭
  const shutdown = async () => {
    logger.info('Shutting down...');

    // 取消注册自动注册的项目
    if (autoRegisteredProjectId) {
      try {
        await backend.unregisterProject(autoRegisteredProjectId);
        logger.info(`Auto-unregistered project: ${autoRegisteredProjectId}`);
      } catch (error) {
        logger.error(`Failed to auto-unregister project ${autoRegisteredProjectId}:`, error);
      }
    }

    await mcpServer.stop();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

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

    const projects = await loadAllProjects(globalConfig.projects_dir);
    console.log(`✓ Found ${projects.size} projects`);

    for (const [projectId, config] of projects) {
      console.log(`✓ Project "${projectId}" (${config.provider})`);
    }
  } catch (error) {
    console.error(`✗ Validation failed:`, error);
    process.exit(1);
  }

  console.log('All configs are valid!');
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
    const projects = await loadAllProjects(globalConfig.projects_dir);

    console.log(`\nGlobal Config: ${configPath}`);
    console.log(`Transport: ${globalConfig.mcp.transport}`);
    console.log(`Projects Directory: ${globalConfig.projects_dir}`);
    console.log(`Log Level: ${globalConfig.logging.level}`);

    console.log(`\nRegistered Projects: ${projects.size}`);

    for (const [projectId, config] of projects) {
      console.log(`  - ${projectId} (${config.provider})`);
    }

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