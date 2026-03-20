import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * 检查 tmux 是否安装
 */
export function checkTmuxInstalled(): void {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
  } catch (error) {
    console.error('Error: tmux is not installed. Please install tmux to use this command.');
    process.exit(1);
  }
}

/**
 * 检查 tmux session 是否存在
 */
export function tmuxSessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName}`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 创建新的 tmux session
 */
export function createTmuxSession(sessionName: string, projectPath: string, command: string): void {
  const cmd = `tmux new-session -d -s ${sessionName} -n ${sessionName} -c ${projectPath} '${command}'`;
  try {
    console.log(`createTmuxSession cmd ${cmd}`);
    execSync(cmd);

    // 设置 pane-border-status 在左上角显示 session 名称
    try {
      execSync(`tmux set-option -t ${sessionName} pane-border-status top`);
      execSync(`tmux set-option -t ${sessionName} pane-border-format "#{pane_title} | #{session_name}"`);
    } catch (e) {
      // 如果设置失败，不影响 session 创建，静默忽略
      console.warn(`Warning: Could not set pane-border-status for ${sessionName}`);
    }
  } catch (error) {
    console.error(`Error creating tmux session ${sessionName}: ${error}`);
    process.exit(1);
  }
}

/**
 * 获取所有 cc-power tmux 会话
 */
export async function getCCPowerTmuxSessions(): Promise<string[]> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    const sessionsResult = await execAsync('tmux list-sessions 2>/dev/null || true');
    const sessions = sessionsResult.stdout.toString();

    if (!sessions.includes('cc-p-')) {
      return [];
    }

    const sessionLines = sessions.split('\n');
    const ccPowerSessions: string[] = [];

    for (const line of sessionLines) {
      if (line.includes('cc-p-')) {
        const sessionName = line.split(':')[0];
        ccPowerSessions.push(sessionName);
      }
    }

    return ccPowerSessions;
  } catch (error) {
    return [];
  }
}

/**
 * 终止 tmux session
 */
export async function killTmuxSession(sessionName: string): Promise<void> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    await execAsync(`tmux kill-session -t "${sessionName}" 2>/dev/null || true`);
  } catch (error) {
    // Ignore errors
  }
}

/**
 * 终止所有 cc-power tmux 会话
 */
export async function killAllCCPowerTmuxSessions(): Promise<void> {
  const sessions = await getCCPowerTmuxSessions();

  for (const sessionName of sessions) {
    await killTmuxSession(sessionName);
  }
}