import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
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
      .allowUnknownOption(true)
      .action(async (projectPath, options, command) => {
        const claudeArgs = this.parseClaudeArgs(projectPath);
        await this.execute(projectPath, claudeArgs);
      });
  }

  /**
   * 解析 Claude 参数
   */
  private parseClaudeArgs(projectPath: string): string[] {
    const rawArgs = process.argv.slice(2);
    const runIndex = rawArgs.findIndex(arg => arg === 'run');
    let claudeArgs: string[] = [];

    if (runIndex !== -1) {
      const afterRun = rawArgs.slice(runIndex + 1);

      claudeArgs = afterRun.filter((arg) => {
        // 过滤掉项目路径
        if (arg === projectPath) return false;
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

  async execute(projectPath: string, claudeArgs: string[] = []): Promise<void> {
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

    // 获取项目名称（用于 tmux session）
    const project_name = projectConfig.project_name || projectName;

    // 规范化项目名称：移除或替换 tmux 不支持的字符
    const safeProjectName = project_name.replace(/[^a-zA-Z0-9_-]/g, '_');

    // 生成固定的 session 名称格式
    const sessionName = `cc-p-${safeProjectName}`;

    // 检查 tmux
    checkTmuxInstalled();

    console.log(`Running project ${projectName} [${project_name}] in tmux session: ${sessionName}`);

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

      // 生成注册信号（使用 project_name）
      await createRegisterSignal(null, sessionName, absProjectPath, projectConfig);

      // 记录项目历史
      await recordProjectHistory(null, absProjectPath, projectConfig, sessionName);
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
      await createUnregisterSignal(null);
    });
  }
}