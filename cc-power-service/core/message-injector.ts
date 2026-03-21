import type { IncomingMessage } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { TmuxExecutor } from './tmux-executor.js';

/**
 * 消息注入器
 * 负责将消息注入到 tmux 会话中
 */
export class MessageInjector {
  private logger: Logger;
  private tmuxExecutor: TmuxExecutor;

  // tmux pane 查找回调
  private getTmuxPane: (projectName: string) => string | undefined;

  // 项目注销回调
  private unregisterProject: (projectId: string) => Promise<void>;

  constructor(
    logger: Logger,
    getTmuxPane: (projectName: string) => string | undefined,
    unregisterProject: (projectId: string) => Promise<void>
  ) {
    this.logger = logger;
    this.tmuxExecutor = new TmuxExecutor(logger);
    this.getTmuxPane = getTmuxPane;
    this.unregisterProject = unregisterProject;
  }

  /**
   * 注入消息到 tmux 会话
   */
  async inject(message: IncomingMessage): Promise<boolean> {
    // 从消息元数据获取 project_name
    const projectName = message.metadata?.project_name;

    if (!projectName) {
      this.logger.warn(`No project_name found in message metadata for ${message.projectId}`);
      return false;
    }

    // 规范化项目名称
    const normalizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');

    // 查找 tmux session
    const tmuxPane = this.getTmuxPane(normalizedName);
    if (!tmuxPane) {
      this.logger.warn(`No tmux session found for project: ${normalizedName}`);
      return false;
    }

    // 首先检查 Tmux 会话是否仍然存活
    const sessionName = tmuxPane.split(':')[0];
    const isAlive = await this.tmuxExecutor.hasSession(sessionName);

    if (!isAlive) {
      this.logger.warn(`Tmux session ${sessionName} for project ${normalizedName} is dead, unregistering project`);
      await this.unregisterProject(message.projectId);
      return false;
    }

    // 防误触安全检查：检查当前前台进程是否为安全的 Claude 进程
    if (!(await this.isSafeProcess(tmuxPane))) {
      return false;
    }

    // 注入消息
    const content = message.content;
    const prompt = ` ${content}`;

    this.logger.info(`Injecting message to tmux pane ${tmuxPane} for project ${normalizedName}`);

    try {
      this.logger.debug(`Message content: ${content.substring(0, 100)}...`);
      await this.tmuxExecutor.sendKeys(tmuxPane, prompt);
      this.logger.info(`Successfully injected message to tmux pane ${tmuxPane}`);
      return true;
    } catch (error) {
      this.logger.error(`Tmux injection failed for pane ${tmuxPane}:`, error);
      return false;
    }
  }

  /**
   * 检查 tmux pane 中的进程是否安全
   */
  private async isSafeProcess(tmuxPane: string): Promise<boolean> {
    try {
      // 解析 tmuxPane: session:window
      const [sessionTarget, windowTarget] = tmuxPane.split(':');
      const paneTarget = '0'; // 默认使用第一个 pane

      this.logger.debug(`Looking for tmux pane: session=${sessionTarget}, window=${windowTarget}, pane=${paneTarget}`);

      // 获取所有面板信息
      const panes = await this.tmuxExecutor.listPanes();
      const paneKey = `${sessionTarget}:${windowTarget}.${paneTarget}`;
      const paneInfo = panes.get(paneKey);

      if (paneInfo) {
        const currentCommand = paneInfo.paneCurrentCommand?.toLowerCase() || '';

        // node 环境运行的可能是 claude，所以我们需要包含 node
        // 在 Claude Code 运行时，某些系统的 pane_current_command 会直接返回 Claude 的版本号
        const isClaudeVersion = /^\d+\.\d+\.\d+/.test(currentCommand.trim());

        if (!['claude', 'node', 'bash', 'zsh', 'sh'].includes(currentCommand.trim()) && !isClaudeVersion) {
          this.logger.warn(`Unsafe process detected in tmux pane ${tmuxPane}. Current command: ${currentCommand}. Injection paused for safety.`);
          return false;
        }

        this.logger.debug(`Safe process check passed for tmux pane ${tmuxPane}. Current command: ${currentCommand}`);
        return true;
      } else {
        this.logger.warn(`Could not determine current process in tmux pane ${tmuxPane}, defaulting to safe mode. Injection paused.`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to check current process in tmux pane ${tmuxPane}:`, error);
      return false;
    }
  }
}