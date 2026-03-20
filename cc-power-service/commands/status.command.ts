import { ConfigManager } from '../core/config.js';
import { BaseCommand } from './base.command.js';

const CLI_NAME = 'ccpower';

/**
 * Status 命令 - 显示服务状态
 */
export class StatusCommand extends BaseCommand {
  getName(): string {
    return 'status';
  }

  getDescription(): string {
    return 'Show service status';
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .option('-c, --config <path>', 'Path to config file', './config.yaml')
      .action(async (options) => {
        await this.execute(options);
      });
  }

  async execute(options: any): Promise<void> {
    const { config: configPath } = options;

    console.log(`${CLI_NAME} status`);
    this.logger.info(`Checking ${CLI_NAME} status...`);

    const configManager = new ConfigManager();

    try {
      const globalConfig = await configManager.load(configPath);

      console.log(`\nGlobal Config: ${configPath}`);
      console.log(`Log Level: ${globalConfig.logging.level}`);

      this.logger.info(`Global Config: ${configPath}`);
      this.logger.info(`Log Level: ${globalConfig.logging.level}`);

      console.log(`\nEnabled Providers:`);
      for (const [provider, config] of Object.entries(globalConfig.providers)) {
        const providerConfig = config as { enabled?: boolean };
        console.log(`  - ${provider}: ${providerConfig.enabled ? 'enabled' : 'disabled'}`);
        this.logger.info(`Provider ${provider}: ${providerConfig.enabled ? 'enabled' : 'disabled'}`);
      }
    } catch (error) {
      this.handleError(error, 'status');
    }
  }
}