// Provider 类型定义
export type ProviderType = 'feishu' | 'telegram' | 'whatsapp';

// 全局配置
export interface GlobalConfig {
  mcp: MCPConfig;
  projects_dir: string;
  logging: LoggingConfig;
  providers: ProvidersConfig;
}

export interface MCPConfig {
  port?: number;
  transport: 'stdio' | 'websocket';
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file?: string;
}

export interface ProvidersConfig {
  feishu?: { enabled: boolean };
  telegram?: { enabled: boolean };
  whatsapp?: { enabled: boolean };
}

// 项目配置
export interface ProjectConfig {
  provider: ProviderType;
  session?: SessionConfig;
  [key: string]: any; // Provider 特定配置
}

export interface SessionConfig {
  max_history?: number;
  timeout_minutes?: number;
}

// Provider 配置
export interface ProviderConfig {
  type: ProviderType;
  projectId: string;
  [key: string]: any;
}

// Provider 特定配置
export interface FeishuConfig extends ProviderConfig {
  type: 'feishu';
  app_id: string;
  app_secret: string;
  bot_name?: string;
  allowed_users?: string[];
}

export interface TelegramConfig extends ProviderConfig {
  type: 'telegram';
  bot_token: string;
  allowed_chats?: number[];
}

export interface WhatsAppConfig extends ProviderConfig {
  type: 'whatsapp';
  phone_number: string;
  api_key: string;
  allowed_numbers?: string[];
}

// 配置管理器接口
export interface IConfigManager {
  load(path: string): Promise<GlobalConfig>;
  loadProject(projectId: string): Promise<ProjectConfig | null>;
  loadAllProjects(): Promise<Map<string, ProjectConfig>>;
  watch(callback: (projectId: string, config: ProjectConfig) => void): void;
  getGlobalConfig(): GlobalConfig | null;
  isProviderEnabled(provider: ProviderType): boolean;
  clearCache(): void;
}