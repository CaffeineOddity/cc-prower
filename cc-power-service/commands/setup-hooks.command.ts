import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BaseCommand } from './base.command.js';

// ES Module __dirname workaround
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SetupHooks 命令 - 设置 Claude Code Hooks
 */
export class SetupHooksCommand extends BaseCommand {
  getName(): string {
    return 'setup-hooks';
  }

  getDescription(): string {
    return 'Setup Claude Code hooks for automatic response sending';
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .argument('[path]', 'Path to project directory', '.')
      .action(async (projectPath) => {
        await this.execute(projectPath);
      });
  }

  async execute(projectPath: string = '.'): Promise<void> {
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
    const hookTemplatePath = path.join(__dirname, '..', 'claude-code-hooks', 'stop-hook.sh');
    const hookDestPath = path.join(hooksDir, 'stop-hook.sh');

    try {
      await fs.copyFile(hookTemplatePath, hookDestPath);
      await fs.chmod(hookDestPath, 0o755);
      console.log(`✓ Created hook script: ${hookDestPath}`);
    } catch (error) {
      console.error(`✗ Failed to copy hook script:`, error);
      return;
    }

    // 读取或创建 settings.json
    const templateSettingsPath = path.join(__dirname, '..', 'claude-code-hooks', 'settings.json');
    let existingSettings: any = {};

    try {
      const existingContent = await fs.readFile(settingsPath, 'utf-8');
      existingSettings = JSON.parse(existingContent);
    } catch {
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
}