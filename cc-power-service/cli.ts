#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { Command } from 'commander';
import { ConfigManager } from './core/config.js';
import { Logger } from './core/logger.js';
import { Router } from './core/router.js';
import { MessageLogger } from './core/message-logger.js';
import chokidar from 'chokidar';

// ES Module __dirname workaround
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLI_NAME = 'ccpower';
const CLI_VERSION = '1.0.0';

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
  .argument('[name]', 'Project name or path', '.')
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
  .allowUnknownOption(true) // 允许未知的选项，这样可以把参数透传给 claude
  .action(async (projectPath, options, command) => {
    // 找到 run 之后的参数
    const rawArgs = process.argv.slice(2);
    const runIndex = rawArgs.findIndex(arg => arg === 'run');
    let claudeArgs: string[] = [];
    
    // 我们也需要自己重新解析 session name，防止 commander 解析错误
    let actualSessionName = options.session;
    
    if (runIndex !== -1) {
      const afterRun = rawArgs.slice(runIndex + 1);
      let skipNext = false;
      
      // 我们检查一下如果是 "-skip-ask" 这种被 commander 误解析的
      // 我们应该把 actualSessionName 恢复为 undefined (如果它原本就是错的)
      if (options.session === 'kip-ask' && afterRun.includes('-skip-ask')) {
        actualSessionName = undefined;
      }
      
      claudeArgs = afterRun.filter((arg, i) => {
        if (skipNext) {
          skipNext = false;
          return false;
        }
        if (arg === projectPath) return false;
        
        // 只有在明确是 -s 或 --session 且下一个参数存在时，才跳过
        if (arg === '-s' || arg === '--session') {
          // 这里说明用户确实想指定 session，我们从原始参数里取
          if (i + 1 < afterRun.length) {
            actualSessionName = afterRun[i + 1];
            skipNext = true;
          }
          return false;
        }
        
        // 其他的如果是类似 --session=xxx 的格式
        if (arg.startsWith('--session=')) {
          actualSessionName = arg.split('=')[1];
          return false;
        }

        return true;
      }).map(arg => {
        // 将 -skip-ask 替换为 claude 实际需要的参数
        if (arg === '-skip-ask') {
          return '--dangerously-skip-permissions';
        }
        return arg;
      });
    }

    const finalOptions = {
      ...options,
      session: actualSessionName
    };

    await runProject(projectPath, finalOptions, claudeArgs);
  });

program
  .command('uninstall')
  .description('Uninstall cc-power and remove all related files')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options) => {
    await uninstallCCPower(options);
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

program
  .command('setup-hooks')
  .description('Setup Claude Code hooks for automatic response sending')
  .argument('[path]', 'Path to project directory', '.')
  .action(async (projectPath) => {
    await setupHooks(projectPath);
  });

program.parse();

/**
 * 启动服务
 */
async function startService(options: any) {
  const { config: configPath, stdio: forceStdio } = options;

  if (!forceStdio) {
    console.log(`Starting ${CLI_NAME}...`);
  }

  // 加载配置
  const actualConfigPath = configPath;
  const configManager = new ConfigManager();
  const globalConfig = await configManager.load(actualConfigPath);

  // 创建日志器
  const logger = new Logger(globalConfig.logging);

  logger.info(`${CLI_NAME} starting...`);
  logger.info(`Config: ${actualConfigPath}`);

  // 创建消息日志器
  const messageLogger = new MessageLogger('./logs/messages');
  await messageLogger.initialize();

  // 创建路由器
  const router = new Router(configManager, logger, messageLogger);
  await router.initializeMessageLogger();

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
      await processSignalFile(filePath, router, logger);
    }
  });

  // 设置 hooks 目录路径（用于 Claude Code hooks）
  const hooksDir = path.join(process.env.HOME || '', '.cc-power', 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });

  // 创建文件监听器，监听 hooks 信号文件
  const hooksWatcher = chokidar.watch(hooksDir, {
    ignored: /^\./, // 忽略隐藏文件
    persistent: true,
  });

  hooksWatcher.on('add', async (filePath) => {
    logger.info(`[cc-power] hooksWatcher add: ${filePath}`);
    if (path.basename(filePath).startsWith('send-') && filePath.endsWith('.json')) {
      await processHookSignal(filePath, router, logger);
    }
  });

  if (!forceStdio) {
    console.log(`${CLI_NAME} is ready. Projects will be registered when you run 'ccpower run'.`);
    console.log('Press Ctrl+C to stop the server.\n');
  }

  // 优雅关闭
  const shutdown = async () => {
    logger.info('Shutting down...');

    // 清理路由器资源
    await router.cleanup();

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

  let projectDir: string;
  let projectName: string;

  // 检查 name 是否看起来像一个路径（以 . 或 / 开头，或者是绝对路径）
  if (path.isAbsolute(name) || name.startsWith('./') || name.startsWith('../') || name === '.') {
    projectDir = path.resolve(name);
    projectName = path.basename(projectDir);
  } else {
    // 默认在 ./projects/ 下创建
    const projectsDir = './projects';
    await fs.mkdir(projectsDir, { recursive: true });
    projectDir = path.join(projectsDir, name);
    projectName = name;
  }

  console.log(`Initializing project "${projectName}" in "${projectDir}" with provider: ${provider}`);
  await fs.mkdir(projectDir, { recursive: true });

  const configPath = path.join(projectDir, '.cc-power.yaml');

  try {
    await fs.access(configPath);
    console.log(`Config file already exists at: ${configPath}`);
    console.log('Initialization skipped to prevent overwriting.');
    return;
  } catch {
    // File doesn't exist, proceed with creation
  }

  // 从 templates 目录读取配置模板
  const templatePath = path.join(__dirname, 'providers', 'templates', `${provider}-template.yaml`);
  let configTemplate = '';

  try {
    configTemplate = await fs.readFile(templatePath, 'utf-8');
  } catch (error) {
    console.error(`Unknown provider or template not found: ${provider}`);
    console.error(`Expected template at: ${templatePath}`);
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
 * 卸载 cc-power 并移除所有相关文件
 */
async function uninstallCCPower(options: any) {
  const { yes } = options;

  console.log('Preparing to uninstall cc-power...');

  if (!yes) {
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('This will remove all cc-power files and configurations. Are you sure? (yes/no): ', (input) => {
        resolve(input.toLowerCase());
        rl.close();
      });
    });

    if (answer !== 'yes' && answer !== 'y') {
      console.log('Uninstall cancelled.');
      return;
    }
  }

  try {
    // 关闭任何正在运行的 tmux 会话
    console.log('Stopping any running cc-power tmux sessions...');

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      // 查找并终止所有 cc-power 相关的 tmux 会话
      const sessionsResult = await execAsync('tmux list-sessions 2>/dev/null || true');
      const sessions = sessionsResult.stdout.toString();

      if (sessions.includes('cc-p-')) {
        const sessionLines = sessions.split('\n');
        for (const line of sessionLines) {
          if (line.includes('cc-p-')) {
            const sessionName = line.split(':')[0]; // 提取会话名
            console.log(`Terminating tmux session: ${sessionName}`);
            await execAsync(`tmux kill-session -t "${sessionName}" 2>/dev/null || true`);
          }
        }
      }
    } catch (tmuxError) {
      console.warn('Could not manage tmux sessions:', tmuxError);
    }

    // 删除 .cc-power 目录及其所有内容
    const ccPowerDir = path.join(process.env.HOME || '', '.cc-power');
    try {
      await fs.rm(ccPowerDir, { recursive: true, force: true });
      console.log(`Removed directory: ${ccPowerDir}`);
    } catch (error) {
      console.warn(`Could not remove directory ${ccPowerDir}:`, error);
    }

    // 查找并删除可能存在的信号文件（如果在其他位置）
    const signalFiles = [
      path.join(process.cwd(), '.cc-power', 'signals'),
      path.join(process.env.HOME || '', '.config', 'cc-power', 'signals'),
    ];

    for (const signalDir of signalFiles) {
      try {
        await fs.rm(signalDir, { recursive: true, force: true });
        console.log(`Removed signal directory: ${signalDir}`);
      } catch (error) {
        // Ignore errors if these directories don't exist
      }
    }

    // 删除项目中的 cc-power 配置文件（如果存在）
    const projectConfigFiles = [
      path.join(process.cwd(), '.cc-power.yaml'),
      path.join(process.cwd(), 'config.yaml'), // only if it's a cc-power config
    ];

    for (const configFile of projectConfigFiles) {
      try {
        const stat = await fs.stat(configFile);
        if (stat.isFile()) {
          // Read the file to check if it's a cc-power config
          const content = await fs.readFile(configFile, 'utf-8');
          if (content.includes('cc-power') || content.includes('provider:') || content.includes('claude')) {
            await fs.unlink(configFile);
            console.log(`Removed project config: ${configFile}`);
          }
        }
      } catch (error) {
        // File doesn't exist, which is fine
      }
    }

    // 删除可能的日志目录
    const logDirs = [
      path.join(process.cwd(), 'logs'),
      path.join(process.cwd(), '.logs'),
    ];

    for (const logDir of logDirs) {
      try {
        // Only remove if it looks like a cc-power log directory
        const logContents = await fs.readdir(logDir);
        const hasCCPowerLogs = logContents.some(file =>
          file.includes('cc-power') || file.includes('messages') || file.includes('claude')
        );

        if (hasCCPowerLogs) {
          await fs.rm(logDir, { recursive: true, force: true });
          console.log(`Removed log directory: ${logDir}`);
        }
      } catch (error) {
        // Directory doesn't exist, which is fine
      }
    }

    console.log('\nccpower has been uninstalled successfully.');
    console.log('To completely remove it from your system, you may also want to run:');
    console.log('  npm uninstall -g ccpower');
  } catch (error) {
    console.error('Error during uninstall:', error);
    process.exit(1);
  }
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
async function runProject(projectPath: string, options: any, claudeArgs: string[] = []) {
  const { session } = options;
  const absProjectPath = path.resolve(projectPath);
  const projectName = path.basename(absProjectPath);

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
    console.error(`Error: No .cc-power.yaml found in ${absProjectPath}`);
    console.error('Please run "ccpower init" to create a project config file.');
    process.exit(1);
  }

  // 从配置文件读取 project_id
  if (!projectConfig.project_id) {
    console.error(`Error: project_id is required in .cc-power.yaml.`);
    console.error('Please add it to your configuration:');
    console.error('  project_id: my-project-name');
    process.exit(1);
  }

  const projectId = projectConfig.project_id;
  const sessionName = session || `cc-p-${projectId}`;

  // 检查是否安装了 tmux
  try {
    execSync('tmux -V', { stdio: 'ignore' });
  } catch (error) {
    console.error('Error: tmux is not installed. Please install tmux to use this command.');
    process.exit(1);
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
    if (claudeArgs && claudeArgs.length > 0) {
      claudeCmd += ' ' + claudeArgs.join(' ');
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

  // Import required modules for atomic write and locking
  const { default: writeFileAtomic } = await import('write-file-atomic');

  // 先确保文件存在，如果不存在则创建一个空的
  try {
    await fs.access(historyPath); // 检查文件是否存在
  } catch (accessError: any) {
    if (accessError.code === 'ENOENT') {
      // 文件不存在，创建一个空的历史记录
      await writeFileAtomic(historyPath, JSON.stringify({}, null, 2));
      console.log(`Created new project history file: ${historyPath}`);
    } else {
      throw accessError; // 其他错误直接抛出
    }
  }

  const { lock, unlock } = await import('proper-lockfile');

  // Acquire a lock before reading/writing the file
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await lock(historyPath, {
      retries: 5,
      retryDelay: 100,
      stale: 30000, // Lock expires after 30 seconds
      onCompromised: (err) => console.error('Lock compromised:', err),
    });

    let history: any = {};
    try {
      const content = await fs.readFile(historyPath, 'utf-8');
      history = JSON.parse(content);
    } catch (error: any) {
      // File doesn't exist or is malformed, start with empty object
      if (error.code === 'ENOENT') {
        // File doesn't exist, create it with empty history
        history = {};
        // Write the initial empty history file
        await writeFileAtomic(historyPath, JSON.stringify(history, null, 2));
        console.log(`Created new project history file: ${historyPath}`);
      } else {
        // Some other error occurred while parsing, start with empty history
        console.warn(`Failed to parse project history file, starting with empty history:`, error);
        history = {};
      }
    }

    history[projectId] = {
      projectId,
      projectPath,
      config,
      sessionName,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    // Write the file atomically
    await writeFileAtomic(historyPath, JSON.stringify(history, null, 2));
    console.log(`Project history recorded for ${projectId}`);
  } catch (error) {
    console.error(`Failed to record project history for ${projectId}:`, error);
    throw error;
  } finally {
    // Release the lock if it was acquired
    if (releaseLock) {
      try {
        await releaseLock();
      } catch (lockError: any) {
        console.error('Failed to release lock:', lockError);
      }
    }
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

/**
 * 处理信号文件
 */
async function processSignalFile(filePath: string, router: Router, logger: Logger): Promise<void> {
  try {
    const fileName = path.basename(filePath);

    // Add try-catch around file read to handle ENOENT errors from race conditions
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (readError: any) {
      if (readError.code === 'ENOENT') {
        // File was already processed and deleted by another process
        logger.debug(`Signal file already processed and deleted: ${filePath}`);
        return;
      }
      throw readError; // Re-throw other errors
    }

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
      await router.registerProject(projectId, finalConfig);
      logger.info(`Successfully registered project: ${projectId} from signal`);

      // 处理完成后删除信号文件
      try {
        await fs.unlink(filePath);
        logger.debug(`Deleted processed signal file: ${filePath}`);
      } catch (unlinkError: any) {
        if (unlinkError.code === 'ENOENT') {
          // File was already deleted by another process
          logger.debug(`Signal file already deleted by another process: ${filePath}`);
        } else {
          logger.error(`Failed to delete signal file ${filePath}:`, unlinkError);
        }
      }
    } else if (fileName.startsWith('unregister-') && fileName.endsWith('.json')) {
      // 处理注销信号
      const projectId = signal.projectId;
      if (!projectId) {
        logger.error(`No projectId found in unregister signal: ${fileName}`);
        return;
      }

      // 调用注销方法
      await router.unregisterProject(projectId);
      logger.info(`Successfully unregistered project: ${projectId} from signal`);

      // 处理完成后删除信号文件
      try {
        await fs.unlink(filePath);
        logger.debug(`Deleted processed signal file: ${filePath}`);
      } catch (unlinkError: any) {
        if (unlinkError.code === 'ENOENT') {
          // File was already deleted by another process
          logger.debug(`Signal file already deleted by another process: ${filePath}`);
        } else {
          logger.error(`Failed to delete signal file ${filePath}:`, unlinkError);
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to process signal file ${filePath}:`, error);
  }
}

/**
 * 设置 Claude Code Hooks
 */
async function setupHooks(projectPath: string = '.') {
  const projectDir = path.resolve(projectPath);

  // 检查目录是否存在
  try {
    const stats = await fs.stat(projectDir);
    if (!stats.isDirectory()) {
      console.error(`Error: ${projectDir} is not a directory`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: Directory does not exist: ${projectDir}`);
    process.exit(1);
  }

  const hooksDir = path.join(projectDir, '.claude', 'hooks');
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');

  console.log(`Setting up hooks in: ${projectDir}`);

  // 创建 hooks 目录
  await fs.mkdir(hooksDir, { recursive: true });

  // 复制 shell hook 脚本
  const hookTemplatePath = path.join(__dirname, 'claude-code-hooks', 'stop-hook.sh');
  const hookDestPath = path.join(hooksDir, 'stop-hook.sh');

  try {
    await fs.copyFile(hookTemplatePath, hookDestPath);
    // 确保脚本可执行
    await fs.chmod(hookDestPath, 0o755);
    console.log(`✓ Created hook script: ${hookDestPath}`);
  } catch (error) {
    console.error(`✗ Failed to copy hook script:`, error);
    return;
  }

  // 读取或创建 settings.json
  const templateSettingsPath = path.join(__dirname, 'claude-code-hooks', 'settings.json');
  let existingSettings: any = {};

  try {
    const existingContent = await fs.readFile(settingsPath, 'utf-8');
    existingSettings = JSON.parse(existingContent);
  } catch (error) {
    // 文件不存在，继续
  }

  // 读取模板 settings.json
  const templateContent = await fs.readFile(templateSettingsPath, 'utf-8');
  const templateSettings = JSON.parse(templateContent);

  // 智能合并：同名替换，异名新增
  for (const [key, value] of Object.entries(templateSettings)) {
    existingSettings[key] = value;
  }

  // 写入合并后的 settings.json
  await fs.writeFile(settingsPath, JSON.stringify(existingSettings, null, 2));
  console.log(`✓ Updated Claude Code settings: ${settingsPath}`);

  console.log('\nClaude Code hooks setup complete!');
  console.log('\nTo use:');
  console.log('1. Ensure the cc-power service is running, : ccpower start');
  console.log('2. Run your project: ccpower run <path>');
  console.log('3. Send a message from your chat platform');
  console.log('4. Claude will process and automatically send the response back');
}

/**
 * 处理 Hook 信号文件（用于 Claude Code hooks）
 */
async function processHookSignal(filePath: string, router: Router, logger: Logger): Promise<void> {
  try {
    let fileContent: string;
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch (readError: any) {
      if (readError.code === 'ENOENT') {
        logger.debug(`Hook signal file already processed and deleted: ${filePath}`);
        return;
      }
      throw readError;
    }

    const signal = JSON.parse(fileContent);
    logger.info(`Received hook signal: ${JSON.stringify(signal)}`);

    // 支持新旧两种信号格式
    if (signal.type === 'send_message' && signal.chatId && signal.content) {
      // 旧格式: 直接包含 chatId 和 content
      const { provider, projectId, chatId, content } = signal;

      const providerInstance = router.getProvider(projectId);
      if (!providerInstance) {
        logger.error(`Provider not found for project: ${projectId}`);
        return;
      }

      await providerInstance.sendMessage(chatId, content);
      logger.info(`Hook message sent to ${provider}:${chatId}`);
    } else if (signal.hook_event_name === 'Stop' || signal.provider && signal.project_id) {
      // 新格式: 需要从历史和 transcript 获取信息
      const { provider, project_id: projectId, transcript_path: transcriptPath, last_assistant_message: lastAssistantMessage } = signal;

      const providerInstance = router.getProvider(projectId);
      if (!providerInstance) {
        logger.error(`Provider not found for project: ${projectId}`);
        return;
      }

      // 从项目历史获取 chat_id
      const historyPath = path.join(process.env.HOME || '', '.cc-power', 'cache', 'project_history.json');
      let chatId: string | null = null;

      try {
        const historyContent = await fs.readFile(historyPath, 'utf-8');
        const history = JSON.parse(historyContent);
        chatId = history[projectId]?.config?.chat_id || history[projectId]?.config?.provider?.chat_id;
      } catch (error) {
        logger.error(`Failed to read history for project ${projectId}:`, error);
      }

      if (!chatId) {
        logger.error(`No chat_id found for project: ${projectId}`);
        return;
      }

      // 获取响应内容（从 transcript 或 last_assistant_message）
      let content = lastAssistantMessage;
      if (transcriptPath) {
        try {
          const transcriptLines = await fs.readFile(transcriptPath, 'utf-8');
          // 解析 jsonl 获取最后一条助手消息
          const lines = transcriptLines.trim().split('\n');
          for (let i = lines.length - 1; i >= 0; i--) {
            const entry = JSON.parse(lines[i]);
            if (entry.role === 'assistant') {
              content = entry.content;
              break;
            }
          }
        } catch (error) {
          logger.warn(`Failed to read transcript, using last_assistant_message:`, error);
        }
      }

      if (!content) {
        logger.warn(`No content found for hook signal`);
        return;
      }

      await providerInstance.sendMessage(chatId, content);
      logger.info(`Hook message sent to ${provider}:${chatId}`);
    } else {
      logger.warn(`Unknown hook signal format: ${JSON.stringify(signal)}`);
      return;
    }

    // 处理完成后删除信号文件
    try {
      await fs.unlink(filePath);
      logger.debug(`Deleted processed hook signal file: ${filePath}`);
    } catch (unlinkError: any) {
      if (unlinkError.code === 'ENOENT') {
        logger.debug(`Hook signal file already deleted by another process: ${filePath}`);
      } else {
        logger.error(`Failed to delete hook signal file ${filePath}:`, unlinkError);
      }
    }
  } catch (error) {
    logger.error(`Failed to process hook signal ${filePath}:`, error);
  }
}