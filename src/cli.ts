#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { Command } from 'commander';
import { ConfigManager } from './core/config.js';
import { Logger } from './core/logger.js';
import { Router } from './core/router.js';
import { MCPServer } from './core/mcp.js';
import { MessageLogger } from './core/message-logger.js';

const packageJson = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8')
);

const program = new Command();

program
  .name('cc-carry')
  .description('Lightweight bridge between Claude Code and chat platforms')
  .version(packageJson.version);

program
  .command('start')
  .description('Start the cc-connect-carry service')
  .option('-c, --config <path>', 'Path to config file', './config.yaml')
  .option('-p, --port <number>', 'MCP server port (WebSocket mode)', '8080')
  .option('-t, --transport <type>', 'MCP transport type', 'stdio')
  .option('--project <projectId>', 'Specific project ID to register (optional)')
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
  const { config: configPath, port, transport, project } = options;

  console.log('Starting cc-connect-carry...');

  // 检查当前目录下是否有项目配置
  const currentDir = process.cwd();
  const possibleProjectConfigs = [
    path.join(currentDir, '.cc-carry.yaml'),
    path.join(currentDir, 'cc-carry.yaml'),
    path.join(currentDir, 'config.yaml'),
  ];

  let actualConfigPath = configPath;
  let autoDetectedProject = false;

  // 尝试自动检测项目配置
  for (const possiblePath of possibleProjectConfigs) {
    try {
      await fs.access(possiblePath);
      const content = await fs.readFile(possiblePath, 'utf-8');

      // 检查是否是项目配置（包含 provider 字段）
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

  logger.info('cc-connect-carry starting...');
  logger.info(`Config: ${actualConfigPath}${autoDetectedProject ? ' (auto-detected)' : ''}`);
  logger.info(`Transport: ${transport}`);

  // 创建消息日志器
  const messageLogger = new MessageLogger('./logs/messages');
  await messageLogger.initialize();

  // 创建路由器
  const router = new Router(configManager, logger, messageLogger);
  await router.initializeMessageLogger();

  // 确定启动模式
  let projectToLoad = project;
  let isProjectMode = false;

  // 检查配置文件是否是项目配置
  const configContent = await fs.readFile(actualConfigPath, 'utf-8');

  // 如果配置文件直接包含 provider 字段，说明是项目配置
  if (configContent.includes('provider:') || configContent.includes('provider:')) {
    isProjectMode = true;
    // 使用当前目录名作为项目 ID
    projectToLoad = path.basename(currentDir);
    logger.info(`Detected project config. Project ID: ${projectToLoad}`);
  }

  // 根据模式决定是否加载项目
  if (projectToLoad) {
    logger.info(`Loading project: ${projectToLoad}`);

    if (isProjectMode) {
      // 项目配置模式：直接使用配置文件内容
      try {
        const projectConfig = yaml.parse(configContent) as any;
        await router.registerProject(projectToLoad, projectConfig);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to register project ${projectToLoad}: ${errorMessage}`);
      }
    } else {
      // 全局配置模式：从 projects_dir 加载
      const projectConfig = await configManager.loadProject(projectToLoad);
      if (projectConfig) {
        try {
          await router.registerProject(projectToLoad, projectConfig);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to register project ${projectToLoad}: ${errorMessage}`);
        }
      } else {
        logger.warn(`Project ${projectToLoad} not found in ${globalConfig.projects_dir}`);
      }
    }
  } else {
    logger.info('Mode: On-demand project loading (projects will be registered when MCP tools are called)');
  }

  // 创建 MCP 服务器
  const mcpServer = new MCPServer(router, logger);

  // 启动 MCP 服务器
  if (transport === 'stdio') {
    await mcpServer.startStdio();
  } else {
    const portNum = parseInt(port, 10);
    await mcpServer.startWebSocket(portNum);
  }

  // 监听配置变化
  configManager.watch(async (projectId, config) => {
    logger.info(`Project config changed: ${projectId}`);
    try {
      await router.unregisterProject(projectId);
      await router.registerProject(projectId, config);
    } catch (error) {
      logger.error(`Failed to reload project ${projectId}:`, error);
    }
  });

  // 优雅关闭
  const shutdown = async () => {
    logger.info('Shutting down...');
    await mcpServer.stop();

    for (const projectId of router.getRegisteredProjects()) {
      await router.unregisterProject(projectId);
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('cc-connect-carry started successfully');
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

  // 根据 Provider 类型创建配置模板
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

    const projects = await configManager.loadAllProjects();
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

  console.log(`cc-connect-carry status`);

  const configManager = new ConfigManager();

  try {
    const globalConfig = await configManager.load(configPath);
    const projects = await configManager.loadAllProjects();

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

  // 如果没有指定项目，列出所有项目
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
    // 实时监控模式
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
    // 查看日志模式
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