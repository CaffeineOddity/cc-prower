import { Logger } from '../utils/logger.js';

/**
 * Tmux 命令执行器
 * 负责执行底层 tmux 命令
 */
export class TmuxExecutor {
  private logger: Logger;

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
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const escapedText = text.replace(/'/g, "'\\\\''");
      await execAsync(`tmux send-keys -t ${targetPane} '${escapedText}' Enter`);
    } catch (error) {
      this.logger.error(`Failed to send keys to tmux pane ${targetPane}:`, error);
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