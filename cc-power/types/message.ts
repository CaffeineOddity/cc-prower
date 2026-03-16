// 消息类型定义
export interface Message {
  type: MessageType;
  timestamp: number;
}

export type MessageType = 'incoming' | 'outgoing';

// 来自聊天平台的入站消息
export interface IncomingMessage extends Message {
  type: 'incoming';
  provider: string;
  projectId: string;
  chatId: string;
  userId: string;
  userName?: string;
  content: string;
  metadata?: Record<string, any>;
}

// 发送到聊天平台的出站消息
export interface OutgoingMessage extends Message {
  type: 'outgoing';
  provider: string;
  projectId: string;
  chatId: string;
  content: string;
  metadata?: Record<string, any>;
}

// 消息路由目标
export interface MessageRoute {
  provider: string;
  projectId: string;
  chatId: string;
  userId?: string;
}

// 消息队列项
export interface QueueItem {
  message: IncomingMessage | OutgoingMessage;
  priority: number;
  retries: number;
  maxRetries: number;
}