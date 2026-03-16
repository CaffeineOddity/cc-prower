/**
 * cc-connect-carry 主入口
 */
import { ConfigManager } from './core/config.js';
import { Logger } from './core/logger.js';
import { Router } from './core/router.js';
import { MCPServer } from './core/mcp.js';
import { MessageLogger } from './core/message-logger.js';

export { ConfigManager, Logger, Router, MCPServer, MessageLogger };
export * from './types/index.js';
export * from './providers/base.js';
export * from './providers/feishu.js';
export * from './providers/telegram.js';
export * from './providers/whatsapp.js';

/**
 * 默认导出主函数
 */
export async function main(configPath: string = './config.yaml', projectMode: boolean = false) {
  // 加载配置
  const configManager = new ConfigManager();
  const globalConfig = await configManager.load(configPath);

  // 创建日志器
  const logger = new Logger(globalConfig.logging);

  // 创建消息日志器
  const messageLogger = new MessageLogger('./logs/messages');
  await messageLogger.initialize();

  // 创建路由器
  const router = new Router(configManager, logger, messageLogger);
  await router.initializeMessageLogger();

  // 检查是否是项目配置模式
  let loadedProject = false;

  if (projectMode) {
    // 项目配置模式：不自动加载项目
    logger.info('Project mode: On-demand project loading');
  } else {
    // 默认模式：加载所有项目
    const projects = await configManager.loadAllProjects();
    logger.info(`Found ${projects.size} projects`);

    if (projects.size > 0) {
      for (const [projectId, projectConfig] of projects) {
        try {
          await router.registerProject(projectId, projectConfig);
          loadedProject = true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to register project ${projectId}: ${errorMessage}`);
        }
      }
    } else {
      logger.info('No projects found. Projects will be loaded on-demand.');
    }
  }

  // 创建 MCP 服务器
  const mcpServer = new MCPServer(router, logger);

  return {
    configManager,
    logger,
    router,
    mcpServer,
    messageLogger,
    loadedProject,
  };
}

// 如果直接运行此文件，使用项目模式
if (import.meta.url === `file://${process.argv[1]}`) {
  main('./config.yaml', true).then(({ mcpServer }) => {
    return mcpServer.startStdio();
  }).catch(console.error);
}