/**
 * CCPower 全局配置类型定义
 */

import type { ProvidersConfig } from './provider.config.js';

// 全局配置
export interface GlobalConfig {
  logging: LoggingConfig;
  providers: ProvidersConfig;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  file?: string;
}

// 项目配置
export interface ProjectConfig {
  project_name?: string; // 可选：项目名称，用于显示和 tmux session
  provider: any; // ProviderConfigBase 或 ProviderType
  session?: SessionConfig;
  tmuxPane?: string; // tmux pane 标识
}

export interface SessionConfig {
  max_history?: number;
  timeout_minutes?: number;
}