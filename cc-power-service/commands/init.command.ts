import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BaseCommand } from './base.command.js';

// ES Module __dirname workaround
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Init 命令 - 初始化项目配置
 */
export class InitCommand extends BaseCommand {
  getName(): string {
    return 'init';
  }

  getDescription(): string {
    return 'Initialize a new project config';
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .argument('[name]', 'Project name or path', '.')
      .option('-p, --provider <type>', 'Provider type', 'feishu')
      .action(async (name, options) => {
        await this.execute(name, options);
      });
  }

  async execute(name: string, options: any): Promise<void> {
    const { provider } = options;

    let projectDir: string;
    let projectName: string;

    // 检查 name 是否看起来像一个路径
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
    const templatePath = path.join(__dirname, '..', 'providers', 'templates', `${provider}-template.yaml`);
    let configTemplate = '';

    try {
      configTemplate = await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      console.error(`Unknown provider or template not found: ${provider}`);
      console.error(`Expected template at: ${templatePath}`);
      console.error(`__dirname: ${__dirname}`);
      process.exit(1);
    }

    await fs.writeFile(configPath, configTemplate);

    console.log(`Project config created at: ${configPath}`);
    console.log('Please edit the config file with your credentials.');
  }
}