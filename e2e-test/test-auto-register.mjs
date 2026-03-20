#!/usr/bin/env node
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { Logger } from '../cc-power/core/logger.js';
import { ConfigManager } from '../cc-power/core/config.js';
import { Router } from '../cc-power/core/router.js';
import { MessageLogger } from '../cc-power/core/message-logger.js';

const CONFIG_FILES = ['.cc-power.yaml', 'cc-power.yaml', 'config.yaml'];

async function testAutoRegister() {
  const currentDir = process.cwd();
  console.log('Current directory:', currentDir);

  // 1. 检查当前目录的配置文件
  console.log('\n=== Checking config files ===');
  for (const file of CONFIG_FILES) {
    const configPath = path.join(currentDir, file);
    try {
      await fs.access(configPath);
      const content = await fs.readFile(configPath, 'utf-8');
      console.log(`✓ Found: ${file}`);
      console.log(`  Contains 'provider:': ${content.includes('provider:')}`);

      if (content.includes('provider:')) {
        console.log('\n  --- Parsing config ---');
        try {
          const config = yaml.parse(content);
          console.log('  Parsed config:', JSON.stringify(config, null, 2));
          console.log('  config.provider:', config.provider);
          console.log('  Has mcp field?', 'mcp' in config);
        } catch (parseError) {
          console.log('  ✗ Parse error:', parseError.message);
        }
      }
    } catch {
      console.log(`✗ Not found: ${file}`);
    }
  }

  // 2. 尝试加载全局配置
  console.log('\n=== Trying to load as global config ===');
  try {
    const configManager = new ConfigManager();
    const globalConfig = await configManager.load(path.join(currentDir, 'config.yaml'));
    console.log('✓ Global config loaded');
    console.log('  projects_dir:', globalConfig.projects_dir);
    console.log('  logging:', globalConfig.logging);
    console.log('  providers:', globalConfig.providers);
  } catch (error) {
    console.log('✗ Failed to load as global config:', error.message);
  }

  // 3. 模拟 autoRegisterProject
  console.log('\n=== Simulating autoRegisterProject ===');
  const logger = new Logger({ level: 'info', file: './test-auto-register.log' });

  for (const file of CONFIG_FILES) {
    const configPath = path.join(currentDir, file);
    try {
      await fs.access(configPath);
      const content = await fs.readFile(configPath, 'utf-8');

      if (content.includes('provider:')) {
        try {
          const config = yaml.parse(content);

          if (config.provider) {
            const projectId = path.basename(currentDir);
            logger.info(`Auto-registering project: ${projectId} from ${path.basename(configPath)}`);
            logger.info(`Project config: ${JSON.stringify(config, null, 2)}`);
            console.log('✓ Would register project:', projectId);
            console.log('  Check test-auto-register.log for details');
            return;
          }
        } catch (parseError) {
          logger.error(`Failed to parse config file ${configPath}:`, parseError);
        }
      }
    } catch {
      // 文件不存在
    }
  }

  console.log('✗ No project config found for auto-registration');

  console.log('\n=== Test complete ===');
}

testAutoRegister().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});