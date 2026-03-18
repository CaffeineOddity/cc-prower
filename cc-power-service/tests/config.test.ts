import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigManager } from '../core/config.js';
import * as fs from 'fs/promises';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('yaml');

describe('ConfigManager', () => {
  let configManager: ConfigManager;

  beforeEach(() => {
    configManager = new ConfigManager();
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('should load global config from file', async () => {
      const mockConfig = {
        mcp: { transport: 'stdio' },
        logging: { level: 'info' },
        providers: { feishu: { enabled: true } },
      };

      vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(mockConfig));

      const config = await configManager.load('./config.yaml');

      expect(config).toEqual(mockConfig);
      expect(fs.readFile).toHaveBeenCalledWith('./config.yaml', 'utf-8');
    });

    it('should return default config if file does not exist', async () => {
      vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('File not found'));

      const config = await configManager.load('./nonexistent.yaml');

      // Verify that default values are applied in ConfigManager.load()
      expect(config.mcp).toBeDefined();
      expect(config.mcp.transport).toBeDefined();
      expect(config.logging).toBeDefined();
      expect(config.providers).toBeDefined();
    });
  });

  describe('isProviderEnabled', () => {
    it('should check if provider is enabled in config', async () => {
      const mockConfig = {
        mcp: { transport: 'stdio' },
        logging: { level: 'info' },
        providers: {
          feishu: { enabled: true },
          telegram: { enabled: false }
        },
      };

      vi.spyOn(fs, 'readFile').mockResolvedValueOnce(JSON.stringify(mockConfig));

      await configManager.load('./config.yaml');

      expect(configManager.isProviderEnabled('feishu')).toBe(true);
      expect(configManager.isProviderEnabled('telegram')).toBe(false);
      expect(configManager.isProviderEnabled('whatsapp')).toBe(false);
    });
  });

  describe('cacheProjectConfig', () => {
    it('should cache project configuration', () => {
      const projectId = 'test-project';
      const config: any = { provider: 'feishu', feishu: { app_id: 'test' } };

      configManager.cacheProjectConfig(projectId, config);

      expect((configManager as any).projectsCache.get(projectId)).toEqual(config);
    });
  });

  describe('getProjectConfig', () => {
    it('should retrieve cached project configuration', () => {
      const projectId = 'test-project';
      const config: any = { provider: 'feishu', feishu: { app_id: 'test' } };

      configManager.cacheProjectConfig(projectId, config);

      const result = configManager.getProjectConfig(projectId);
      expect(result).toEqual(config);
    });

    it('should return null for non-existent project', () => {
      const result = configManager.getProjectConfig('nonexistent');
      expect(result).toBeNull();
    });
  });
});