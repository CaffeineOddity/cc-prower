# 类型定义

## 核心类型

```typescript
// 项目配置类型
export interface ProjectConfig {
  provider: ProviderType;
  [key: string]: any; // Provider 特定配置
}

export type ProviderType = 'feishu' | 'telegram' | 'whatsapp';

// Provider 通用配置
export interface ProviderConfig {
  type: ProviderType;
  [key: string]: any; // 平台特定字段
}

// Provider 特定配置
export interface FeishuConfig {
  type: 'feishu';
  app_id: string;
  app_secret: string;
  bot_name?: string;
  allowed_users?: string[];
}

export interface TelegramConfig {
  type: 'telegram';
  bot_token: string;
  allowed_chats?: number[];
}

export interface WhatsAppConfig {
  type: 'whatsapp';
  phone_number: string;
  api_key: string;
  allowed_numbers?: string[];
}

// 会话配置
export interface SessionConfig {
  max_history?: number;
  timeout_minutes?: number;
}

// 全局配置
export interface GlobalConfig {
  mcp: {
    port?: number;
    transport: 'stdio' | 'websocket';
  };
  projects_dir: string;
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
  };
  providers: {
    feishu?: { enabled: boolean };
    telegram?: { enabled: boolean };
    whatsapp?: { enabled: boolean };
  };
}
```