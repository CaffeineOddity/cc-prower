/**
 * Provider 相关类型定义
 */

// Provider 类型定义
export type ProviderType = 'feishu' | 'telegram' | 'whatsapp';
export interface ProviderConfig {
    name: ProviderType;
}

// Provider 全局配置
export interface ProvidersConfig {
  feishu?: { enabled: boolean };
  telegram?: { enabled: boolean };
  whatsapp?: { enabled: boolean };
}

// Provider 特定配置
export interface FeishuConfig extends ProviderConfig {
  name: 'feishu';
  app_id: string;
  app_secret: string;
  chat_id: string;      // 监听的群ID（单个）
  bot_name?: string;
  priority?: number;     // 优先级，数字越大优先级越高，默认0
  keyword?: string;      // 关键词过滤，消息包含此关键词才触发（可选）
  allowed_users?: string[];
}

export interface TelegramConfig extends ProviderConfig {
  name: 'telegram';
  bot_token: string;
  chat_id?: string;      // 监听的聊天ID（单个）
  priority?: number;
  keyword?: string;
  allowed_chats?: number[];
}

export interface WhatsAppConfig extends ProviderConfig {
  name: 'whatsapp';
  phone_number: string;
  api_key: string;
  chat_id?: string;      // 监听的聊天ID（单个）
  priority?: number;
  keyword?: string;
  allowed_numbers?: string[];
}

// Provider 配置（运行时使用）
export interface TemplateProviderConfig {
  project_name: string; // 项目名称，用于标识不同的项目
  provider: FeishuConfig | TelegramConfig | WhatsAppConfig;
}

export interface FeishuTemplateConfig extends TemplateProviderConfig {
  provider: FeishuConfig;
}

export interface TelegramTemplateConfig extends TemplateProviderConfig {
  provider: TelegramConfig;
}

export interface WhatsAppTemplateConfig extends TemplateProviderConfig {
  provider: WhatsAppConfig;
}

export function get_project_id(template: TemplateProviderConfig): string {
    if (template.provider.name === 'feishu') {
        return  `${template.provider.app_id}-${template.provider.chat_id}`;
    }
    if (template.provider.name === 'telegram') {
        return  `${template.provider.bot_token}-${template.provider.chat_id}`;
    }
    if (template.provider.name === 'whatsapp') {
        return  `${template.provider.phone_number}-${template.provider.chat_id}`;
    }
  return template.project_name;
}
