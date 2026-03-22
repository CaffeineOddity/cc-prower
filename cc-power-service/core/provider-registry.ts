import type { IProvider, IncomingMessage, TemplateProviderConfig } from '../types/index.js';
import { Logger } from '../utils/logger.js';
import { ConfigManager } from './config.js';

/**
 * Provider 注册表
 * 负责 Provider 的注册、注销、加载和生命周期管理
 */
export class ProviderRegistry {
  private providers = new Map<string, IProvider>(); // projectId → Provider
  private configManager: ConfigManager;
  private logger: Logger;

  // 项目名称规范化后的 tmux session 映射
  private projectTmuxSessionsByProjectName = new Map<string, string>();

  // Tmux session 注册回调
  private onTmuxSessionRegistered?: (projectId: string, tmuxPane: string) => void;
  private onTmuxSessionUnregistered?: (projectId: string) => void;

  constructor(configManager: ConfigManager, logger: Logger) {
    this.configManager = configManager;
    this.logger = logger;
  }

  /**
   * 设置 Tmux session 注册回调
   */
  setTmuxSessionCallbacks(
    onRegistered: (projectId: string, tmuxPane: string) => void,
    onUnregistered: (projectId: string) => void
  ): void {
    this.onTmuxSessionRegistered = onRegistered;
    this.onTmuxSessionUnregistered = onUnregistered;
  }

  /**
   * 注册项目
   */
  async registerProject(
    providerType: string,
    config: TemplateProviderConfig,
    tmuxPane?: string
  ): Promise<{ projectId: string; projectName: string | undefined }> {
    // 验证 Provider 是否启用
    if (!this.configManager.isProviderEnabled(providerType as any)) {
      throw new Error(`Provider ${providerType} is not enabled in global config`);
    }

    // 动态导入 Provider
    const ProviderModule = await this.loadProvider(providerType);

    // 创建 Provider 实例
    let providerInstance: IProvider;

    if (providerType === 'custom') {
      // CustomProvider 需要传入 configManager，loadProvider 返回的是工厂函数
      providerInstance = ProviderModule(this.logger) as IProvider;
    } else {
      // 其他 Provider 使用标准构造函数（用 new）
      providerInstance = new ProviderModule(this.logger) as IProvider;
    }

    // 调用 connect，让 Provider 生成自己的 projectId
    try {
      this.logger.info(`Attempting to connect provider...`);
      await providerInstance.connect(config);
      this.logger.info(`Provider connection successful`);
    } catch (connectionError) {
      const errorMessage = connectionError instanceof Error ? connectionError.message : String(connectionError);
      this.logger.error(`Failed to connect to provider: ${errorMessage}`);
      this.logger.error(`Stack: ${connectionError instanceof Error ? connectionError.stack : 'No stack'}`);
      throw connectionError;
    }

    // 获取 Provider 生成的 projectId
    const actualProjectId = providerInstance.getProjectId();
    const actualProjectName = providerInstance.getProjectName();

    // 如果该 projectId 已存在，先注销旧的项目
    if (this.providers.has(actualProjectId)) {
      this.logger.info(`Project ${actualProjectId} already exists, unregistering old instance first`);
      await this.unregisterProject(actualProjectId);
    }

    this.logger.info(`Registering project: ${actualProjectId} (${providerType})${actualProjectName ? ` [${actualProjectName}]` : ''}`);

    // 缓存项目配置
    this.configManager.cacheProjectConfig(actualProjectId, config);

    // 设置消息监听
    providerInstance.onMessage((message: IncomingMessage) => {
      // 通过事件或其他方式通知 Router
      // 这里简化处理，实际可能需要回调机制
    });

    // 存储 Provider
    this.providers.set(actualProjectId, providerInstance);

    // 存储 tmux session 信息
    if (tmuxPane && actualProjectName) {
      const normalizedName = actualProjectName.replace(/[^a-zA-Z0-9_-]/g, '_');
      this.projectTmuxSessionsByProjectName.set(normalizedName, tmuxPane);
      this.logger.debug(`Stored tmux session by project name: ${normalizedName}`);

      // 通知回调
      this.onTmuxSessionRegistered?.(actualProjectId, tmuxPane);
    }

    this.logger.info(`Project ${actualProjectId} registered successfully`);
    return { projectId: actualProjectId, projectName: actualProjectName };
  }

  /**
   * 取消注册项目
   */
  async unregisterProject(projectId: string): Promise<{ projectName?: string }> {
    const provider = this.providers.get(projectId);
    if (!provider) {
      return {};
    }

    this.logger.info(`Unregistering project: ${projectId}`);

    await provider.disconnect();
    this.providers.delete(projectId);

    // 清理 projectTmuxSessionsByProjectName
    const projectName = provider.getProjectName();
    if (projectName) {
      const normalizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
      this.projectTmuxSessionsByProjectName.delete(normalizedName);
    }

    // 通知回调
    this.onTmuxSessionUnregistered?.(projectId);

    this.logger.info(`Project ${projectId} unregistered`);
    return { projectName };
  }

  /**
   * 注销所有项目
   */
  async unregisterAll(): Promise<void> {
    const projectIds = Array.from(this.providers.keys());
    for (const projectId of projectIds) {
      await this.unregisterProject(projectId);
    }
  }

  /**
   * 加载 Provider 模块
   */
  private async loadProvider(type: string): Promise<any> {
    const providerPath = `../providers/${type}.js`;
    const module = await import(providerPath);

    // CustomProvider 需要额外的 configManager 参数
    if (type === 'custom') {
      return (logger: Logger) => new module.CustomProvider(this.configManager, logger);
    }

    // 其他 Provider 使用标准构造函数
    const ProviderClass = module.default || module[`${type.charAt(0).toUpperCase() + type.slice(1)}Provider`];
    return ProviderClass;
  }

  /**
   * 获取 Provider 实例
   */
  getProvider(projectId: string): IProvider | undefined {
    return this.providers.get(projectId);
  }

  /**
   * 获取所有已注册的项目
   */
  getRegisteredProjects(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 根据 project_name 查找 tmux pane
   */
  getTmuxPaneByProjectName(projectName: string): string | undefined {
    const normalizedName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    return this.projectTmuxSessionsByProjectName.get(normalizedName);
  }

  /**
   * 清理所有资源
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up provider registry...');
    await this.unregisterAll();
    this.logger.info('Provider registry cleanup complete');
  }
}