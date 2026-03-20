import { Logger } from '../utils/logger.js';
import { TmuxExecutor } from './tmux-executor.js';

/**
 * 会话健康检查回调
 */
export type SessionHealthCallback = (projectId: string) => Promise<void>;

/**
 * 会话信息
 */
export interface SessionInfo {
  projectId: string;
  tmuxPane: string;
}

/**
 * Tmux 会话轮询器
 * 负责定期检查 tmux 会话的健康状态
 */
export class TmuxSessionPoller {
  private sessions = new Map<string, SessionInfo>(); // projectId → SessionInfo
  private logger: Logger;
  private tmuxExecutor: TmuxExecutor;
  private sessionPollTimer: NodeJS.Timeout | null = null;

  // 定时检查间隔（毫秒）
  private readonly SESSION_POLL_INTERVAL = 60000; // 1 minute

  // 死会话回调
  private onDeadSession: SessionHealthCallback;

  constructor(logger: Logger, onDeadSession: SessionHealthCallback) {
    this.logger = logger;
    this.tmuxExecutor = new TmuxExecutor(logger);
    this.onDeadSession = onDeadSession;
  }

  /**
   * 开始轮询
   */
  start(): void {
    if (this.sessionPollTimer) {
      this.logger.warn('Session polling already started');
      return;
    }

    this.sessionPollTimer = setInterval(() => {
      this.pollSessions().catch(error => {
        this.logger.error('Error during tmux session polling:', error);
      });
    }, this.SESSION_POLL_INTERVAL);

    this.logger.info(`Started tmux session polling every ${this.SESSION_POLL_INTERVAL / 1000} seconds`);
  }

  /**
   * 停止轮询
   */
  stop(): void {
    if (this.sessionPollTimer) {
      clearInterval(this.sessionPollTimer);
      this.sessionPollTimer = null;
      this.logger.info('Stopped tmux session polling');
    }
  }

  /**
   * 注册会话
   */
  registerSession(projectId: string, tmuxPane: string): void {
    this.sessions.set(projectId, { projectId, tmuxPane });
    this.logger.debug(`Registered tmux session for project ${projectId}: ${tmuxPane}`);
  }

  /**
   * 注销会话
   */
  unregisterSession(projectId: string): void {
    this.sessions.delete(projectId);
    this.logger.debug(`Unregistered tmux session for project ${projectId}`);
  }

  /**
   * 轮询检查所有注册的 Tmux 会话状态
   */
  private async pollSessions(): Promise<void> {
    // this.logger.debug('Polling tmux sessions for health check...');

    const projectIds = Array.from(this.sessions.keys());

    if (projectIds.length === 0) {
    //   this.logger.debug('No tmux sessions to poll');
      return;
    }

    for (const projectId of projectIds) {
      const sessionInfo = this.sessions.get(projectId);
      if (!sessionInfo) {
        continue;
      }

      try {
        // Extract session name from pane identifier (format: session:window.pane)
        const sessionName = sessionInfo.tmuxPane.split(':')[0];

        // Check if the session exists using TmuxExecutor
        const isAlive = await this.tmuxExecutor.hasSession(sessionName);

        if (!isAlive) {
          this.logger.warn(`Tmux session ${sessionName} for project ${projectId} is dead, notifying callback`);

          // Call the callback to handle dead session
          await this.onDeadSession(projectId);

          // Remove from our tracking
          this.unregisterSession(projectId);
        } else {
        //   this.logger.debug(`Tmux session ${sessionName} for project ${projectId} is alive`);
        }
      } catch (error) {
        this.logger.error(`Failed to check tmux session ${sessionInfo.tmuxPane} for project ${projectId}:`, error);
      }
    }
  }

  /**
   * 获取所有已注册的会话
   */
  getRegisteredSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * 清理所有资源
   */
  cleanup(): void {
    this.logger.info('Cleaning up session poller...');
    this.stop();
    this.sessions.clear();
    this.logger.info('Session poller cleanup complete');
  }
}