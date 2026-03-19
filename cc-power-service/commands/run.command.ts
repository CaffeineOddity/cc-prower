import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import { BaseCommand } from './base.command.js';
import { checkTmuxInstalled, tmuxSessionExists, createTmuxSession } from '../utils/tmux.js';
import { createRegisterSignal, createUnregisterSignal } from '../utils/signals.js';
import { recordProjectHistory } from '../utils/history.js';

/**
 * Run 命令 - 在 tmux 会话中运行项目
 */
export class RunCommand extends BaseCommand {
  getName(): string {
    return 'run';
  }

  getDescription(): string {
    return 'Run a project in a managed tmux session with Claude Code';
  }

  register(): void {
    this.program
      .command(this.getName())
      .description(this.getDescription())
      .argument('<path>', 'Path to project directory')
      .option('-s, --session <name>', 'Custom tmux session name')
      .allowUnknownOption(true)
      .action(async (projectPath, options, command) => {
        const claudeArgs = this.parseClaudeArgs(projectPath, options);
        const finalOptions = { ...options, session: this.parseSessionName(options, claudeArgs) };
        await this.execute(projectPath, finalOptions, claudeArgs);
      });
  }

  /**
   * 解析 Claude 参数
   */
  private parseClaudeArgs(projectPath: string, options: any): string[] {
    const rawArgs = process.argv.slice(2);
    const runIndex = rawArgs.findIndex(arg => arg === 'run');
    let claudeArgs: string[] = [];

    if (runIndex !== -1) {
      const afterRun = rawArgs.slice(runIndex + 1);
      let skipNext = false;

      claudeArgs = afterRun.filter((arg, i) => {
        if (skipNext) {
          skipNext = false;
          return false;
        }
        if (arg === projectPath) return false;

        if (arg === '-s' || arg === '--session') {
          if (i + 1 < afterRun.length) {
            skipNext = true;
          }
          return false;
        }

        if (arg.startsWith('--session=')) {
          return false;
        }

        return true;
      }).map(arg => {
        if (arg === '-skip-ask') {
          return '--dangerously-skip-permissions';
        }
        return arg;
      });
    }

    return claudeArgs;
  }

  /**
   * 解析 session 名称
   */
  private parseSessionName(options: any, claudeArgs: string[]): string | undefined {
    const rawArgs = process.argv.slice(2);
    const runIndex = rawArgs.findIndex(arg => arg === 'run');

    if (runIndex === -1) return options.session;

    const afterRun = rawArgs.slice(runIndex + 1);
    let actualSessionName = options.session;

    // Fix commander parsing issue with -skip-ask
    if (options.session === 'kip-ask' && afterRun.includes('-skip-ask')) {
      actualSessionName = undefined;
    }

    // Parse session from raw args
    for (let i = 0; i < afterRun.length; i++) {
      const arg = afterRun[i];
      if (arg === '-s' || arg === '--session') {
        if (i + 1 < afterRun.length) {
          actualSessionName = afterRun[i + 1];
        }
      } else if (arg.startsWith('--session=')) {
        actualSessionName = arg.split('=')[1];
      }
    }

    return actualSessionName;
  }

  async execute(projectPath: string, options: any, claudeArgs: string[] = []): Promise<void> {
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

    // 验证 project_id
    if (!projectConfig.project_id) {
      console.error(`Error: project_id is required in .cc-power.yaml.`);
      console.error('Please add it to your configuration:');
      console.error('  project_id: my-project-name');
      process.exit(1);
    }

    const projectId = projectConfig.project_id;
    const app_id = projectConfig.provider?.app_id || projectConfig.app_id || '';
    const chat_id = projectConfig.provider?.chat_id || projectConfig.chat_id || '';

    // 使用 app_id + chat_id 生成唯一的 session 标识
    // 确保不同的 app_id 或 chat_id 有不同的 session
    const uniqueId = app_id ? `${app_id.substring(0, 8)}-${chat_id.substring(0, 8)}` : projectId;
    const sessionName = session || `cc-p-${uniqueId}`;

    // 检查 tmux
    checkTmuxInstalled();

    console.log(`Running project ${projectName} (ID: ${projectId}) in tmux session: ${sessionName}`);

    // 检查 session 是否存在
    const sessionExists = tmuxSessionExists(sessionName);

    if (sessionExists) {
      console.log(`Attaching to existing session: ${sessionName}`);
    } else {
      console.log(`Creating new session: ${sessionName}`);

      // 构建 claude 命令
      let claudeCmd = 'claude';
      if (claudeArgs && claudeArgs.length > 0) {
        claudeCmd += ' ' + claudeArgs.join(' ');
      }

      // 启动新 session
      createTmuxSession(sessionName, absProjectPath, claudeCmd);

      // 生成注册信号
      await createRegisterSignal(projectId, sessionName, absProjectPath, projectConfig);

      // 记录项目历史
      await recordProjectHistory(projectId, absProjectPath, projectConfig, sessionName);
    }

    // Attach 到 session
    const attach = spawn('tmux', ['attach', '-t', sessionName], {
      stdio: 'inherit',
      shell: true
    });

    attach.on('close', async (code: number | null) => {
      if (code !== 0) {
        console.log(`Tmux session detached with code ${code}`);
      }

      // 退出时生成注销信号
      await createUnregisterSignal(projectId);
    });
  }
}