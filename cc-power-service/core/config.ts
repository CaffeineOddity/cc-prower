import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import type {
  GlobalConfig,
  ProjectConfig,
  IConfigManager,
  ProviderType,
} from '../types/config.js';

// 配置管理器
// 负责加载和管理全局配置
// 注意：项目配置现在由客户端通过 MCP 传递，不再从文件系统加载
export class ConfigManager implements IConfigManager {
  private globalConfig: GlobalConfig | null = null;
  private projectsCache = new Map<string, ProjectConfig>();

  /**
   * 加载全局配置
   */
  async load(configPath: string): Promise<GlobalConfig> {
    let config: Partial<GlobalConfig> = {};
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      config = yaml.parse(content) as Partial<GlobalConfig> || {};
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // If file doesn't exist, try ~/.cc-power/config.yaml or use defaults
        const homeDir = process.env.HOME || '';
        const homeConfigPath = path.join(homeDir, '.cc-power', 'config.yaml');
        try {
          const content = await fs.readFile(homeConfigPath, 'utf-8');
          config = yaml.parse(content) as Partial<GlobalConfig> || {};
        } catch (homeError: any) {
          if (homeError.code !== 'ENOENT') {
            throw new Error(`Failed to load config from ${homeConfigPath}: ${homeError}`);
          }
          // Both paths failed with ENOENT, proceed with defaults
          console.warn(`Global config not found at ${configPath} or ${homeConfigPath}, using default configuration.`);
        }
      } else {
        throw new Error(`Failed to load config from ${configPath}: ${error}`);
      }
    }

    // 设置默认值
    const finalConfig: GlobalConfig = {
      mcp: config.mcp || { transport: 'stdio', port: 8080 },
      logging: config.logging || { level: 'info' },
      providers: config.providers || { feishu: { enabled: true } }
    };

    this.globalConfig = finalConfig;
    return finalConfig;
  }

  /**
   * 加载项目配置（已废弃，仅保留用于向后兼容）
   * 现在项目配置由客户端通过 MCP 传递
   */
  async loadProject(projectId: string): Promise<ProjectConfig | null> {
    // 检查缓存
    if (this.projectsCache.has(projectId)) {
      return this.projectsCache.get(projectId)!;
    }
    return null;
  }

  /**
   * 缓存项目配置（用于 MCP 注册的项目）
   */
  cacheProjectConfig(projectId: string, config: ProjectConfig): void {
    this.projectsCache.set(projectId, config);
  }

  /**
   * 获取缓存的项目配置
   */
  getProjectConfig(projectId: string): ProjectConfig | null {
    if (this.projectsCache.has(projectId)) {
      return this.projectsCache.get(projectId)!;
    }
    return null;
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

  /**
   * 移除缓存的项目配置
   */
  removeCachedProjectConfig(projectId: string): void {
    this.projectsCache.delete(projectId);
  }
}