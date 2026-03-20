/**
 * 配置管理器接口
 */
import type { GlobalConfig, ProjectConfig } from './ccpower.config.js';
import type { ProviderType } from './provider.config.js';

export type { GlobalConfig, ProjectConfig };
export interface IConfigManager {
  load(path: string): Promise<GlobalConfig>;
  loadProject(projectId: string): Promise<ProjectConfig | null>;
  getGlobalConfig(): GlobalConfig | null;
  isProviderEnabled(provider: ProviderType): boolean;
  clearCache(): void;
}