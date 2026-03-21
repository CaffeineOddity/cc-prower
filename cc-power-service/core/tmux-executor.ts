import { Logger } from '../utils/logger.js';
import * as os from 'os';

/**
 * Tmux 命令执行器
 * 负责执行底层 tmux 命令
 */
export class TmuxExecutor {
  private logger: Logger;
  private readonly isMacos = os.platform() === 'darwin';

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 检查会话是否存在
   */
  async hasSession(sessionName: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const result = await execAsync(`tmux has-session -t '${sessionName}' 2>/dev/null || echo "not found"`);
      const output = result.stdout.toString().trim();
      const stderr = result.stderr?.toString() || '';

      // 检查是否包含 "not found" 或 "no server running"
      return !output.includes('not found') && !stderr.includes('no server running');
    } catch (error) {
      this.logger.error(`Failed to check tmux session ${sessionName}:`, error);
      return false;
    }
  }

  /**
   * 获取所有面板信息
   * 格式: session:window_index pane_index:pane_pid:pane_current_command
   */
  async listPanes(): Promise<Map<string, PaneInfo>> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const result = await execAsync(`tmux list-panes -a -F '#{session_name}:#{window_index} #{pane_index}:#{pane_pid}:#{pane_current_command}' 2>/dev/null || true`);
      const output = result.stdout.toString().trim();
      const lines = output.split('\n');

      const panes = new Map<string, PaneInfo>();

      for (const line of lines) {
        const [sessionWindow, paneInfo] = line.split(' ');
        if (!paneInfo) continue;

        const [sessionName, windowIndex] = sessionWindow.split(':');
        const [paneIndex, panePid, paneCurrentCommand] = paneInfo.split(':');

        if (sessionName && windowIndex && paneIndex) {
          const key = `${sessionName}:${windowIndex}.${paneIndex}`;
          panes.set(key, {
            sessionName,
            windowIndex,
            paneIndex,
            panePid,
            paneCurrentCommand,
          });
        }
      }

      return panes;
    } catch (error) {
      this.logger.error('Failed to list tmux panes:', error);
      return new Map();
    }
  }

  /**
   * 发送按键到指定面板
   */
  async sendKeys(targetPane: string, text: string): Promise<void> {
    try {
      // 在 macOS 上使用 paste-buffer 方式
      if (this.isMacos) {
        return await this.sendKeysViaPasteBuffer(targetPane, text);
      }

      // Linux 上使用直接写入 stdin 的方式
      const pid = await this.getPanePid(targetPane);
      if (pid) {
        try {
          await this.writeToProcessStdin(pid, text.trim());
          return;
        } catch (stdinError) {
          this.logger.debug(`Failed to write to stdin, falling back to tmux send-keys:`, stdinError);
        }
      }

      // 回退到 tmux send-keys
      return await this.sendKeysViaTmux(targetPane, text);
    } catch (error) {
      this.logger.error(`Failed to send keys to tmux pane ${targetPane}:`, error);
      throw error;
    }
  }

  /**
   * 使用 tmux paste-buffer 发送消息（适用于 macOS）
   */
  private async sendKeysViaPasteBuffer(targetPane: string, text: string): Promise<void> {
    const { spawn } = await import('child_process');

    const runCommand = (args: string[]): Promise<void> => {
      return new Promise((resolve, reject) => {
        const child = spawn('tmux', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Command failed: ${args.join(' ')}`)));
        child.on('error', reject);
      });
    };

    try {
      this.logger.debug(`Starting paste-buffer injection for pane: ${targetPane}, text length: ${text.length}`);
      // 1. 选择 pane
      await runCommand(['select-pane', '-t', targetPane]);
      this.logger.debug(`Selected pane: ${targetPane}`);
      // 2. 发送 C-c 重置状态（确保焦点在输入框）
      await runCommand(['send-keys', '-t', targetPane, 'C-c']);
      // 小延迟确保状态重置
      await new Promise(resolve => setTimeout(resolve, 100));
      this.logger.debug(`Sent C-c to ${targetPane}`);
      // 3. 设置 buffer
      const bufferName = 'cc_power_buffer';
      await runCommand(['set-buffer', '-b', bufferName, text.trim()]);
      this.logger.debug(`Buffer '${bufferName}' set with content: ${text.trim().substring(0, 50)}...`);
      // 4. 粘贴 buffer（-b 在 -t 前面）
      await runCommand(['paste-buffer', '-b', bufferName, '-t', targetPane]);
      this.logger.debug(`Buffer '${bufferName}' pasted to ${targetPane}`);
      // 稍长的延迟确保粘贴完成
      await new Promise(resolve => setTimeout(resolve, 100));
      // 5. 发送 C-m 提交
      await runCommand(['send-keys', '-t', targetPane, 'C-m']);
      this.logger.debug(`C-m sent to ${targetPane}`);
    } catch (error) {
      throw error;
    }
  }

  /**
   * 获取指定 pane 的进程 ID
   */
  private async getPanePid(targetPane: string): Promise<string | null> {
    const panes = await this.listPanes();
    const paneKey = targetPane.includes('.') ? targetPane : `${targetPane}.0`;

    for (const [key, info] of panes.entries()) {
      if (key === paneKey || info.sessionName === paneKey) {
        return info.panePid || null;
      }
    }

    return null;
  }

  /**
   * 直接写入进程 stdin (仅适用于 Linux)
   */
  private async writeToProcessStdin(pid: string, text: string): Promise<void> {
    try {
      const stdinPath = `/proc/${pid}/fd/0`;

      // 检查进程是否还活着
      const { execSync } = await import('child_process');
      try {
        execSync(`kill -0 ${pid} 2>/dev/null`);
      } catch {
        throw new Error(`Process ${pid} not found`);
      }

      // 写入 stdin
      const fs = await import('fs');
      const buffer = Buffer.from(`${text}\n`);
      const fd = fs.openSync(stdinPath, 'w');
      fs.writeSync(fd, buffer);
      fs.closeSync(fd);

      this.logger.debug(`Wrote to process ${pid} stdin: ${text.substring(0, 50)}...`);
    } catch (error) {
      throw error;
    }
  }

  /**
   * 使用 tmux send-keys 发送消息（回退方案）
   */
  private async sendKeysViaTmux(targetPane: string, text: string): Promise<void> {
    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      const args = ['send-keys', '-t', targetPane, text, 'C-m'];
      this.logger.debug(`Executing: tmux ${args.join(' ')}`);
      const child = spawn('tmux', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          this.logger.error(`tmux send-keys failed with code ${code}, stderr: ${stderr}`);
          reject(new Error(`tmux send-keys exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        this.logger.error(`Failed to spawn tmux:`, err);
        reject(err);
      });
    });
  }

  /**
   * 发送单个控制按键（如 C-c）
   */
  async sendKey(targetPane: string, key: string): Promise<void> {
    try {
      const { spawn } = await import('child_process');

      return new Promise((resolve, reject) => {
        const args = ['send-keys', '-t', targetPane, key];
        this.logger.debug(`Executing: tmux ${args.join(' ')}`);
        const child = spawn('tmux', args, {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stderr = '';

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            this.logger.error(`tmux send-key failed with code ${code}, stderr: ${stderr}`);
            reject(new Error(`tmux send-key exited with code ${code}: ${stderr}`));
          }
        });

        child.on('error', (err) => {
          this.logger.error(`Failed to spawn tmux:`, err);
          reject(err);
        });
      });
    } catch (error) {
      this.logger.error(`Failed to send key to tmux pane ${targetPane}:`, error);
      throw error;
    }
  }
}

/**
 * 面板信息
 */
export interface PaneInfo {
  sessionName: string;
  windowIndex: string;
  paneIndex: string;
  panePid?: string;
  paneCurrentCommand?: string;
}