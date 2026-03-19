import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseCommand } from './base.command.js';
import { killAllCCPowerTmuxSessions } from '../utils/tmux.js';

/**
 * Uninstall 命令 - 卸载 cc-power
 */
export class UninstallCommand extends BaseCommand {
  getName(): string {
    return 'uninstall';
  }

  getDescription(): string {
    return 'Uninstall cc-power and remove all related files';
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .option('-y, --yes', 'Skip confirmation prompt')
      .action(async (options) => {
        await this.execute(options);
      });
  }

  async execute(options: any): Promise<void> {
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
      // 关闭 tmux 会话
      console.log('Stopping any running cc-power tmux sessions...');
      await killAllCCPowerTmuxSessions();

      // 删除 .cc-power 目录
      const ccPowerDir = path.join(process.env.HOME || '', '.cc-power');
      try {
        await fs.rm(ccPowerDir, { recursive: true, force: true });
        console.log(`Removed directory: ${ccPowerDir}`);
      } catch (error) {
        console.warn(`Could not remove directory ${ccPowerDir}`);
      }

      // 查找并删除信号文件
      const signalFiles = [
        path.join(process.cwd(), '.cc-power', 'signals'),
        path.join(process.env.HOME || '', '.config', 'cc-power', 'signals'),
      ];

      for (const signalDir of signalFiles) {
        try {
          await fs.rm(signalDir, { recursive: true, force: true });
          console.log(`Removed signal directory: ${signalDir}`);
        } catch {
          // Ignore
        }
      }

      // 删除项目配置文件
      const projectConfigFiles = [
        path.join(process.cwd(), '.cc-power.yaml'),
        path.join(process.cwd(), 'config.yaml'),
      ];

      for (const configFile of projectConfigFiles) {
        try {
          const stat = await fs.stat(configFile);
          if (stat.isFile()) {
            const content = await fs.readFile(configFile, 'utf-8');
            if (content.includes('cc-power') || content.includes('provider:') || content.includes('claude')) {
              await fs.unlink(configFile);
              console.log(`Removed project config: ${configFile}`);
            }
          }
        } catch {
          // Ignore
        }
      }

      // 删除日志目录
      const logDirs = [
        path.join(process.cwd(), 'logs'),
        path.join(process.cwd(), '.logs'),
      ];

      for (const logDir of logDirs) {
        try {
          const logContents = await fs.readdir(logDir);
          const hasCCPowerLogs = logContents.some(file =>
            file.includes('cc-power') || file.includes('messages') || file.includes('claude')
          );

          if (hasCCPowerLogs) {
            await fs.rm(logDir, { recursive: true, force: true });
            console.log(`Removed log directory: ${logDir}`);
          }
        } catch {
          // Ignore
        }
      }

      console.log('\nccpower has been uninstalled successfully.');
      console.log('To completely remove it from your system, you may also want to run:');
      console.log('  npm uninstall -g ccpower');
    } catch (error) {
      this.handleError(error, 'uninstall');
    }
  }
}