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
  let mockChildProcess: any;
  let mockLogger: any;

  beforeEach(() => {
    mockChildProcess = {
      exec: vi.fn(),
      promisify: vi.fn(),
    };

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Create a new instance of Router for each test
    router = new (Router as any)(undefined, mockLogger, undefined);

    // Mock the child_process and util modules at the module level
    vi.doMock('child_process', () => ({
      exec: mockChildProcess.exec,
    }));

    vi.doMock('util', () => ({
      promisify: mockChildProcess.promisify,
    }));
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
      expect(mockLogger.warn).toHaveBeenCalledWith('No tmux session found for project nonexistent-project');
    });

    it('should check current process before injection for security', async () => {
      // Add a mock tmux session
      router['projectTmuxSessions'].set('test-project', 'test-session:0');

      const mockExec1 = vi.fn();
      const mockPromisify1 = vi.fn().mockReturnValue(mockExec1);

      // Set up mocks using the mockChildProcess object from beforeEach
      mockChildProcess.exec.mockImplementation(mockExec1);
      mockChildProcess.promisify.mockReturnValue(mockPromisify1);

      // Mock successful checks
      mockExec1.mockResolvedValueOnce({ stdout: '', stderr: '' }) // has-session check
        .mockResolvedValueOnce({ stdout: '0:1234:bash' }) // Process check
        .mockResolvedValueOnce({ stdout: '' }); // send-keys

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

      // Should check for current process and find it's safe (bash)
      expect(mockExec1).toHaveBeenCalledWith(expect.stringContaining('tmux list-panes'));
    });

    it('should not inject if unsafe process detected', async () => {
      // Add a mock tmux session
      router['projectTmuxSessions'].set('test-project', 'test-session:0');

      const mockExec2 = vi.fn();
      const mockPromisify2 = vi.fn().mockReturnValue(mockExec2);

      // Set up mocks using the mockChildProcess object from beforeEach
      mockChildProcess.exec.mockImplementation(mockExec2);
      mockChildProcess.promisify.mockReturnValue(mockPromisify2);

      mockExec2.mockResolvedValueOnce({ stdout: '0:1234:rm' }); // Unsafe process

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

      const mockExec = vi.fn();
      const mockPromisify = vi.fn().mockReturnValue(mockExec);

      // Mock child_process
      const mockExec3 = vi.fn();
      const mockPromisify3 = vi.fn().mockReturnValue(mockExec3);

      // Set up mocks using the mockChildProcess object from beforeEach
      mockChildProcess.exec.mockImplementation(mockExec3);
      mockChildProcess.promisify.mockReturnValue(mockPromisify3);

      // Mock successful session check
      mockExec3.mockResolvedValueOnce({ stdout: '', stderr: '' }) // has-session check
        .mockResolvedValueOnce({ stdout: '0:1234:bash' }); // Process check

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
      expect(mockExec3).toHaveBeenCalledWith(expect.stringContaining('tmux has-session'));
    });
  });
});