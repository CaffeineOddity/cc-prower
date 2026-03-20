import { ConfigManager } from '../core/config.js';
import { BaseCommand } from './base.command.js';

/**
 * Validate 命令 - 验证配置
 */
export class ValidateCommand extends BaseCommand {
  getName(): string {
    return 'validate';
  }

  getDescription(): string {
    return 'Validate configuration';
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

    console.log(`Validating config: ${configPath}`);
    this.logger.info(`Validating config: ${configPath}`);

    const configManager = new ConfigManager();

    try {
      const globalConfig = await configManager.load(configPath);
      console.log('✓ Global config is valid');
      this.logger.info('Global config is valid');

      console.log(`\nEnabled Providers:`);
      for (const [provider, config] of Object.entries(globalConfig.providers)) {
        const providerConfig = config as { enabled?: boolean };
        console.log(`  - ${provider}: ${providerConfig.enabled ? 'enabled' : 'disabled'}`);
        this.logger.info(`Provider ${provider}: ${providerConfig.enabled ? 'enabled' : 'disabled'}`);
      }
    } catch (error) {
      this.handleError(error, 'validate');
    }

    console.log('Config is valid!');
    this.logger.info('Config is valid!');
  }
}