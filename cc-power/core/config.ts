import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import type {
  GlobalConfig,
  ProjectConfig,
  IConfigManager,
  ProviderType,
} from '../types/config.js';

/**
 * 配置管理器
 * 负责加载和管理全局配置和项目配置
 */
export class ConfigManager implements IConfigManager {
  private globalConfig: GlobalConfig | null = null;
  private projectsCache = new Map<string, ProjectConfig>();

  /**
   * 加载全局配置
   */
  async load(configPath: string): Promise<GlobalConfig> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config = yaml.parse(content) as GlobalConfig;

      // 设置默认值
      config.mcp = config.mcp || { transport: 'stdio', port: 8080 };
      config.projects_dir = config.projects_dir || './projects';
      config.logging = config.logging || { level: 'info' };
      config.providers = config.providers || {};

      this.globalConfig = config;
      return config;
    } catch (error) {
      throw new Error(`Failed to load config from ${configPath}: ${error}`);
    }
  }

  /**
   * 加载项目配置
   */
  async loadProject(projectId: string): Promise<ProjectConfig | null> {
    if (!this.globalConfig) {
      throw new Error('Global config not loaded');
    }

    // 检查缓存
    if (this.projectsCache.has(projectId)) {
      return this.projectsCache.get(projectId)!;
    }

    // 构建配置文件路径
    // 支持两种路径格式：
    // 1. projects_dir/projectId/config.yaml
    // 2. projects_dir/projectId.yaml
    const projectsDir = this.globalConfig.projects_dir;
    const possiblePaths = [
      path.join(projectsDir, projectId, 'config.yaml'),
      path.join(projectsDir, `${projectId}.yaml`),
    ];

    for (const configPath of possiblePaths) {
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config = yaml.parse(content) as ProjectConfig;

        // 验证配置
        if (!config.provider) {
          throw new Error(`Missing provider in ${configPath}`);
        }

        this.projectsCache.set(projectId, config);
        return config;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        // 文件不存在，尝试下一个路径
      }
    }

    return null;
  }

  /**
   * 监听配置文件变化
   */
  watch(callback: (projectId: string, config: ProjectConfig) => void): void {
    if (!this.globalConfig) {
      throw new Error('Global config not loaded');
    }

    const projectsDir = this.globalConfig.projects_dir;

    // 使用 fs.watch 监听目录变化（简化实现）
    // 实际生产环境应该使用 chokidar 等更精确的文件监听库
    const watcher = fs.watch(projectsDir, { recursive: true });
    // TODO: 实现文件变化监听回调
    console.log('Config watcher started (callback not implemented)');
  }

  /**
   * 获取全局配置
   */
  getGlobalConfig(): GlobalConfig | null {
    return this.globalConfig;
  }

  /**
   * 检查 Provider 是否启用
   */
  isProviderEnabled(provider: ProviderType): boolean {
    if (!this.globalConfig) {
      return false;
    }
    return this.globalConfig.providers[provider]?.enabled ?? false;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.projectsCache.clear();
  }
}