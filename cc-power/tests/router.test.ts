import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Router } from '../core/router.js';
import { ConfigManager } from '../core/config.js';
import { Logger } from '../core/logger.js';
import { MessageLogger } from '../core/message-logger.js';
import type { ProjectConfig } from '../types/config.js';
import type { IncomingMessage, OutgoingMessage } from '../types/message.js';

// Mock dependencies
vi.mock('../core/config.js');
vi.mock('../core/logger.js');
vi.mock('../core/message-logger.js');
vi.mock('fs/promises');
vi.mock('child_process');

describe('Router', () => {
  let router: Router;
  let mockConfigManager: any;
  let mockLogger: any;
  let mockMessageLogger: any;

  beforeEach(() => {
    mockConfigManager = {
      isProviderEnabled: vi.fn().mockReturnValue(true),
      cacheProjectConfig: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    mockMessageLogger = {
      initialize: vi.fn().mockResolvedValue(undefined),
      logIncoming: vi.fn().mockResolvedValue(undefined),
      logOutgoing: vi.fn().mockResolvedValue(undefined),
    };

    // Create a new instance of Router for each test
    router = new Router(mockConfigManager, mockLogger, mockMessageLogger);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerProject', () => {
    it('should register a project successfully', async () => {
      const projectId = 'test-project';
      const config: ProjectConfig = {
        provider: 'feishu',
        feishu: {
          app_id: 'test_app_id',
          app_secret: 'test_app_secret',
          bot_name: 'test_bot',
        },
      };

      await router.registerProject(projectId, config);

      // Verify that the project was registered
      expect(mockConfigManager.cacheProjectConfig).toHaveBeenCalledWith(projectId, config);
      expect(mockLogger.info).toHaveBeenCalledWith(`Registering project: ${projectId} (feishu)`);
    });

    it('should handle connection errors gracefully', async () => {
      const projectId = 'test-project';
      const config: ProjectConfig = {
        provider: 'feishu',
        feishu: {
          app_id: 'invalid_app_id',
          app_secret: 'invalid_app_secret',
        },
      };

      await router.registerProject(projectId, config);

      // Should still register the project even with connection errors
      expect(mockLogger.error).toHaveBeenCalled();
      expect(router.getRegisteredProjects()).toContain(projectId);
    });
  });

  describe('unregisterProject', () => {
    it('should unregister a project successfully', async () => {
      const projectId = 'test-project';
      const config: ProjectConfig = {
        provider: 'feishu',
        feishu: {
          app_id: 'test_app_id',
          app_secret: 'test_app_secret',
        },
      };

      // Register the project first
      await router.registerProject(projectId, config);
      expect(router.getRegisteredProjects()).toContain(projectId);

      // Then unregister it
      await router.unregisterProject(projectId);
      expect(router.getRegisteredProjects()).not.toContain(projectId);
    });
  });

  describe('handleIncomingMessage', () => {
    it('should queue incoming messages', () => {
      const message: IncomingMessage = {
        type: 'incoming',
        provider: 'feishu',
        projectId: 'test-project',
        chatId: 'test-chat',
        userId: 'test-user',
        content: 'Hello world',
        timestamp: Date.now(),
      };

      // Initially, no messages should be in the queue
      const initialMessages = router['incomingMessageQueue'].get(message.projectId) || [];
      expect(initialMessages.length).toBe(0);

      // Handle the incoming message
      router['handleIncomingMessage'](message);

      // Now there should be a message in the queue
      const messagesAfter = router['incomingMessageQueue'].get(message.projectId) || [];
      expect(messagesAfter.length).toBe(1);
      expect(messagesAfter[0]).toEqual(message);
    });

    it('should enforce queue length limits', () => {
      const projectId = 'test-project';

      // Set up a smaller max queue length for testing
      router['MAX_QUEUE_LENGTH'] = 2;

      // Add more messages than the limit
      for (let i = 0; i < 5; i++) {
        const message: IncomingMessage = {
          type: 'incoming',
          provider: 'feishu',
          projectId,
          chatId: `test-chat-${i}`,
          userId: 'test-user',
          content: `Hello world ${i}`,
          timestamp: Date.now() + i,
        };

        router['handleIncomingMessage'](message);
      }

      const messages = router['incomingMessageQueue'].get(projectId) || [];
      expect(messages.length).toBeLessThanOrEqual(2); // Should not exceed the limit
    });
  });

  describe('getIncomingMessages', () => {
    it('should retrieve and clear queued messages', async () => {
      const projectId = 'test-project';
      const message: IncomingMessage = {
        type: 'incoming',
        provider: 'feishu',
        projectId,
        chatId: 'test-chat',
        userId: 'test-user',
        content: 'Hello world',
        timestamp: Date.now(),
      };

      // Add a message to the queue
      router['handleIncomingMessage'](message);

      // Verify the message was queued
      const messagesBefore = router['incomingMessageQueue'].get(projectId) || [];
      expect(messagesBefore.length).toBe(1);

      // Retrieve messages
      const retrieved = await router.getIncomingMessages({
        project_id: projectId,
      });

      // Verify messages were retrieved
      expect(retrieved.length).toBe(1);
      expect(retrieved[0]).toEqual(message);

      // Verify the queue is now empty
      const messagesAfter = router['incomingMessageQueue'].get(projectId) || [];
      expect(messagesAfter.length).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should clean up all resources', async () => {
      // Register a project
      const projectId = 'test-project';
      const config: ProjectConfig = {
        provider: 'feishu',
        feishu: {
          app_id: 'test_app_id',
          app_secret: 'test_app_secret',
        },
      };

      await router.registerProject(projectId, config);
      expect(router.getRegisteredProjects()).toContain(projectId);

      // Perform cleanup
      await router.cleanup();

      // Verify all projects were unregistered
      expect(router.getRegisteredProjects().length).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('Router cleanup complete');
    });
  });
});