import { ConfigManager } from './core/config.js';
import { Logger } from './utils/logger.js';
import { Router } from './core/router.js';
import { MessageLogger } from './utils/message-logger.js';

export { ConfigManager, Logger, Router, MessageLogger };
export * from './types/index.js';
export * from './providers/base.js';
export * from './providers/feishu.js';
export * from './providers/telegram.js';
export * from './providers/whatsapp.js';

/**
 * 默认导出主函数
 */
export async function main(configPath: string = './config.yaml') {
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

  logger.info('Mode: On-demand project loading (projects will be registered when MCP tools are called)');

  return {
    configManager,
    logger,
    router,
    messageLogger,
  };
}

// 如果直接运行此文件，启动 CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  import('./cli.js').catch(console.error);
}