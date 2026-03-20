import { BaseCommand } from './base.command.js';
import { killAllCCPowerTmuxSessions, getCCPowerTmuxSessions } from '../utils/tmux.js';

/**
 * Stop 命令 - 停止 cc-power 服务
 */
export class StopCommand extends BaseCommand {
  getName(): string {
    return 'stop';
  }

  getDescription(): string {
    return 'Stop all running cc-power services and tmux sessions';
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .option('-f, --force', 'Force stop without confirmation')
      .action(async (options) => {
        await this.execute(options);
      });
  }

  async execute(options: any): Promise<void> {
    const { force } = options;

    // 获取所有运行的 tmux 会话
    const sessions = await getCCPowerTmuxSessions();

    if (sessions.length === 0) {
      console.log('No cc-power tmux sessions are running.');
      this.logger.info('No cc-power tmux sessions are running.');
      return;
    }

    console.log('Found running cc-power tmux sessions:');
    this.logger.info(`Found ${sessions.length} running cc-power tmux sessions`);
    for (const session of sessions) {
      console.log(`  - ${session}`);
      this.logger.info(`  Session: ${session}`);
    }

    if (!force) {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(`Stop ${sessions.length} session(s)? (yes/no): `, (input) => {
          resolve(input.toLowerCase());
          rl.close();
        });
      });

      if (answer !== 'yes' && answer !== 'y') {
        console.log('Stop cancelled.');
        this.logger.info('Stop cancelled by user.');
        return;
      }
    }

    console.log('Stopping cc-power tmux sessions...');
    this.logger.info(`Stopping ${sessions.length} cc-power tmux sessions...`);
    await killAllCCPowerTmuxSessions();

    console.log(`Stopped ${sessions.length} session(s).`);
    this.logger.info(`Successfully stopped ${sessions.length} session(s).`);
  }
}