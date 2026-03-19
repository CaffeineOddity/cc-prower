import * as fs from 'fs/promises';
import * as path from 'path';
import { MessageLogger } from '../core/message-logger.js';
import { BaseCommand } from './base.command.js';

/**
 * Logs 命令 - 查看消息日志
 */
export class LogsCommand extends BaseCommand {
  getName(): string {
    return 'logs';
  }

  getDescription(): string {
    return 'View message logs';
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .argument('[project]', 'Project name (optional, lists all projects if not specified)')
      .option('-c, --count <number>', 'Number of recent messages', '50')
      .option('-o, --output <format>', 'Output format (json, readable)', 'readable')
      .option('-w, --watch', 'Watch for new messages in real-time')
      .option('--chat <chatId>', 'Filter by chat ID')
      .action(async (project, options) => {
        await this.execute(project, options);
      });
  }

  async execute(project: string | undefined, options: any): Promise<void> {
    const { count, output, watch, chat } = options;
    const messageLogger = new MessageLogger();

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
}