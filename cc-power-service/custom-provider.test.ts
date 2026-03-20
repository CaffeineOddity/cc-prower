import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CustomProvider } from './providers/custom.js';
import { ConfigManager } from './core/config.js';
import { Logger } from './utils/logger.js';
import { WebSocket } from 'ws';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('CustomProvider', () => {
  let provider: CustomProvider;
  let configManager: ConfigManager;
  let logger: Logger;
  let testConfigPath: string;
  let testPort = 9999;

  beforeEach(async () => {
    // 创建临时测试配置文件
    testConfigPath = path.join(process.env.TMPDIR || '/tmp', `ccpower-test-${Date.now()}.yaml`);
    const configContent = `
WebSocket:
  port: ${testPort}
  host: "127.0.0.1"

logging:
  level: error

providers:
  custom:
    enabled: true
`;
    await fs.writeFile(testConfigPath, configContent, 'utf8');

    // 初始化 ConfigManager
    configManager = new ConfigManager();
    await configManager.load(testConfigPath);

    // 初始化 Logger
    logger = new Logger({ level: 'error' });

    // 创建 Provider 实例
    provider = new CustomProvider(configManager, logger);
  });

  afterEach(async () => {
    // 清理 Provider
    if (provider) {
      await provider.disconnect();
    }

    // 删除测试配置文件
    try {
      await fs.unlink(testConfigPath);
    } catch {
      // 忽略错误
    }
  });

  it('should create a provider instance', () => {
    expect(provider).toBeDefined();
    expect(provider.getName()).toBe('custom');
  });

  it('should connect and start WebSocket server', async () => {
    const config = {
      project_name: 'test-app',
      provider: {
        name: 'custom' as const,
        app_id: 'test-app-id',
        api_key: 'test-api-key',
        priority: 10,
        keyword: ''
      }
    };

    await provider.connect(config);
    expect(provider.isHealthy()).toBe(true);
    expect(provider.getProjectId()).toBe('test-app-id-test-app');

    // 断开连接
    await provider.disconnect();
    expect(provider.isHealthy()).toBe(false);
  });

  it('should handle client connection with correct api_key', async () => {
    const config = {
      project_name: 'test-app',
      provider: {
        name: 'custom' as const,
        app_id: 'test-app-id',
        api_key: 'test-api-key',
        priority: 10,
        keyword: ''
      }
    };

    await provider.connect(config);

    // 连接客户端
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}?api_key=test-api-key&app_id=test-client`);

    const connected = await new Promise<boolean>((resolve) => {
      ws.on('open', () => resolve(true));
      ws.on('error', () => resolve(false));
      setTimeout(() => resolve(false), 1000);
    });

    expect(connected).toBe(true);
    ws.close();
    await provider.disconnect();
  });

  it('should reject client with wrong api_key', async () => {
    const config = {
      project_name: 'test-app',
      provider: {
        name: 'custom' as const,
        app_id: 'test-app-id',
        api_key: 'test-api-key',
        priority: 10,
        keyword: ''
      }
    };

    await provider.connect(config);

    // 尝试用错误的 api_key 连接
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}?api_key=wrong-key&app_id=test-client`);

    let closed = false;
    let closeCode: number | undefined;
    ws.on('close', (code) => {
      closed = true;
      closeCode = code;
    });

    // 等待连接被拒绝（应该在握手阶段就被拒绝）
    await new Promise(resolve => setTimeout(resolve, 500));

    expect(closed).toBe(true);
    expect(closeCode).toBe(1008); // WebSocket close code for policy violation

    ws.close();
    await provider.disconnect();
  });

  it('should receive and process llm messages', async () => {
    const config = {
      project_name: 'test-app',
      provider: {
        name: 'custom' as const,
        app_id: 'test-app-id',
        api_key: 'test-api-key',
        priority: 10,
        keyword: ''
      }
    };

    await provider.connect(config);

    // 设置消息回调
    const receivedMessages: any[] = [];
    provider.onMessage((msg) => {
      receivedMessages.push(msg);
    });

    // 连接客户端
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}?api_key=test-api-key&app_id=test-client`);

    await new Promise(resolve => ws.on('open', resolve));

    // 等待 connected 消息
    await new Promise(resolve => setTimeout(resolve, 100));

    // 发送 llm 消息
    ws.send(JSON.stringify({
      type: 'llm',
      app_id: 'test-client',
      data: {
        content: 'test message'
      },
      timestamp: Date.now()
    }));

    // 等待消息处理
    await new Promise(resolve => setTimeout(resolve, 200));

    // 验证收到消息
    expect(receivedMessages.length).toBeGreaterThan(0);
    const lastMessage = receivedMessages[receivedMessages.length - 1];
    expect(lastMessage.content).toBe('test message');
    expect(lastMessage.provider).toBe('custom');

    ws.close();
    await provider.disconnect();
  });

  it('should send messages to connected clients', async () => {
    const config = {
      project_name: 'test-app',
      provider: {
        name: 'custom' as const,
        app_id: 'test-app-id',
        api_key: 'test-api-key',
        priority: 10,
        keyword: ''
      }
    };

    await provider.connect(config);

    // 连接客户端
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}?api_key=test-api-key&app_id=test-client`);

    const messagePromise = new Promise<string>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'llm' && msg.data?.content === 'test response') {
          resolve(msg.data.content);
        }
      });
    });

    await new Promise(resolve => ws.on('open', resolve));

    // 等待 connected 消息
    await new Promise(resolve => setTimeout(resolve, 100));

    // 发送消息
    await provider.sendMessage('test-client', 'test response', { duration: 5 });

    // 等待收到消息
    const receivedContent = await Promise.race([
      messagePromise,
      new Promise(resolve => setTimeout(() => resolve(''), 1000))
    ]);

    expect(receivedContent).toBe('test response');

    ws.close();
    await provider.disconnect();
  });
});