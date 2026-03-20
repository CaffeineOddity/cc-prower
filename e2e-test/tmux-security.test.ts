import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Router } from '../core/router.js';

// Mock dependencies
vi.mock('child_process');
vi.mock('fs/promises');
vi.mock('../core/config.js');
vi.mock('../core/logger.js');
vi.mock('../core/message-logger.js');

describe('Tmux functionality', () => {
  let router: Router;
  let originalExec: any;
  let mockExec: any;
  let mockPromisify: any;
  let mockLogger: any;

  beforeEach(async () => {
    // Mock child_process functions
    mockExec = vi.fn();
    mockPromisify = vi.fn().mockReturnValue(mockExec);

    // Mock the entire child_process module
    const childProcessMock = {
      exec: mockExec,
      promisify: mockPromisify,
    };
    vi.mocked(await import('child_process')).exec = mockExec;

    // Use dynamic import to mock properly
    vi.doMock('child_process', () => childProcessMock);
    vi.doMock('util', () => ({ promisify: mockPromisify }));

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create a new instance of Router for each test
    // We need to handle the constructor properly - Router needs a ConfigManager
    const mockConfigManager = {
      isProviderEnabled: vi.fn().mockReturnValue(true),
      cacheProjectConfig: vi.fn(),
    };

    router = new Router(mockConfigManager as any, mockLogger, undefined as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('injectMessageViaTmux', () => {
    it('should not inject message if no tmux session exists', async () => {
      const message: any = {
        type: 'incoming',
        provider: 'feishu',
        projectId: 'nonexistent-project',
        chatId: 'test-chat',
        userId: 'test-user',
        content: 'Hello world',
        timestamp: Date.now(),
      };

      await router['injectMessageViaTmux'](message as any);

      // Should log a warning and return without injecting
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('No tmux session found for project'));
    });

    it('should check current process before injection for security', async () => {
      // Add a mock tmux session
      router['projectTmuxSessions'].set('test-project', 'test-session:0');

      // Setup mock responses for different commands
      mockExec.mockImplementation((command: string, callback: (error: Error | null, result: { stdout: string, stderr: string }) => void) => {
        if (command.includes('has-session')) {
          // Simulate session exists
          callback(null, { stdout: '', stderr: '' });
        } else if (command.includes('list-panes')) {
          // Simulate safe process (bash)
          callback(null, { stdout: 'test-session:0 12345:bash', stderr: '' });
        } else if (command.includes('send-keys')) {
          // Simulate successful send
          callback(null, { stdout: '', stderr: '' });
        }
      });

      const message = {
        type: 'incoming',
        provider: 'feishu',
        projectId: 'test-project',
        chatId: 'test-chat',
        userId: 'test-user',
        userName: 'Test User',
        content: 'Hello world',
        timestamp: Date.now(),
      };

      await router['injectMessageViaTmux'](message as any);

      // Verify that the necessary commands were called
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('tmux has-session'),
        expect.any(Function)
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('tmux list-panes'),
        expect.any(Function)
      );
    });

    it('should not inject if unsafe process detected', async () => {
      // Add a mock tmux session
      router['projectTmuxSessions'].set('test-project', 'test-session:0');

      // Setup mock to simulate unsafe process (rm command)
      mockExec.mockImplementation((command: string, callback: (error: Error | null, result: { stdout: string, stderr: string }) => void) => {
        if (command.includes('has-session')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (command.includes('list-panes')) {
          // Return an unsafe process
          callback(null, { stdout: 'test-session:0 12345:rm', stderr: '' });
        }
      });

      const message: any = {
        type: 'incoming',
        provider: 'feishu',
        projectId: 'test-project',
        chatId: 'test-chat',
        userId: 'test-user',
        userName: 'Test User',
        content: 'Hello world',
        timestamp: Date.now(),
      };

      await router['injectMessageViaTmux'](message as any);

      // Should log warning about unsafe process and not proceed with injection
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unsafe process detected')
      );
    });
  });

  describe('Tmux Session Status Checks', () => {
    it('should handle tmux session health checks', async () => {
      // Add a mock tmux session
      router['projectTmuxSessions'].set('test-project', 'test-session:0');

      // Setup mock responses
      mockExec.mockImplementation((command: string, callback: (error: Error | null, result: { stdout: string, stderr: string }) => void) => {
        if (command.includes('has-session')) {
          callback(null, { stdout: '', stderr: '' });
        } else if (command.includes('list-panes')) {
          callback(null, { stdout: 'test-session:0 12345:bash', stderr: '' });
        } else if (command.includes('send-keys')) {
          callback(null, { stdout: '', stderr: '' });
        }
      });

      // Create a message to trigger the check
      const message = {
        type: 'incoming' as const,
        provider: 'feishu',
        projectId: 'test-project',
        chatId: 'test-chat',
        userId: 'test-user',
        userName: 'Test User',
        content: 'Hello world',
        timestamp: Date.now(),
      };

      await router['injectMessageViaTmux'](message as any);

      // Should have checked the session status
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('tmux has-session'),
        expect.any(Function)
      );
    });
  });
});