import type { IncomingMessage } from '../types/index.js';
import { Logger } from '../utils/logger.js';

/**
 * 消息队列
 * 负责入站消息的排队、TTL 清理和长度限制
 */
export class MessageQueue {
  private queues = new Map<string, IncomingMessage[]>(); // projectId → messages
  private logger: Logger;

  // 队列最大长度限制（防止内存泄漏）
  private maxQueueLength = 50;

  // 消息生存时间（毫秒），超过此时间的消息将被丢弃
  private readonly MESSAGE_TTL = 5 * 60 * 1000; // 5分钟

  constructor(logger: Logger, maxQueueLength = 50) {
    this.logger = logger;
    this.maxQueueLength = maxQueueLength;
  }

  /**
   * 设置队列最大长度
   */
  setMaxQueueLength(length: number): void {
    this.maxQueueLength = length;
  }

  /**
   * 添加消息到队列
   */
  enqueue(projectId: string, message: IncomingMessage): void {
    const queue = this.queues.get(projectId) || [];

    // 添加时间戳用于TTL处理
    (message as any).receivedAt = Date.now();
    queue.push(message);

    // 应用队列长度限制
    if (queue.length > this.maxQueueLength) {
      // 丢弃最旧的消息并记录警告
      const removedMessage = queue.shift();
      this.logger.warn(`Message queue for project ${projectId} exceeded max length, removed oldest message: ${removedMessage?.content?.substring(0, 50)}...`);
    }

    // 清理过期消息
    this.cleanupExpiredMessages(queue);

    this.queues.set(projectId, queue);
  }

  /**
   * 获取队列
   */
  getQueue(projectId: string): IncomingMessage[] {
    return this.queues.get(projectId) || [];
  }

  /**
   * 清空指定项目的队列
   */
  clearQueue(projectId: string): void {
    this.queues.delete(projectId);
  }

  /**
   * 清空所有队列
   */
  clearAll(): void {
    this.queues.clear();
  }

  /**
   * 清理过期消息
   */
  private cleanupExpiredMessages(queue: IncomingMessage[]): void {
    const now = Date.now();
    const initialLength = queue.length;

    // 过滤掉超时的消息
    const filteredQueue = queue.filter(msg => {
      const receivedAt = (msg as any).receivedAt || now;
      return (now - receivedAt) <= this.MESSAGE_TTL;
    });

    // 如果有过期消息被清理，记录警告
    if (filteredQueue.length < initialLength) {
      this.logger.warn(`Cleaned up ${initialLength - filteredQueue.length} expired messages from queue`);
    }

    // 更新队列（通过引用传递，所以这里会修改原始队列）
    while (queue.length > 0) {
      queue.pop();
    }
    filteredQueue.forEach(msg => queue.push(msg));
  }

  /**
   * 获取队列大小
   */
  getQueueSize(projectId: string): number {
    return this.queues.get(projectId)?.length || 0;
  }

  /**
   * 获取所有项目 ID
   */
  getProjectIds(): string[] {
    return Array.from(this.queues.keys());
  }
}