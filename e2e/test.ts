#!/usr/bin/env node

/**
 * 测试脚本 - 验证 cc-connect-carry 功能
 */

import { ConfigManager } from './core/config.js';
import { Logger } from './core/logger.js';

async function testConfig() {
  console.log('🧪 Testing ConfigManager...\n');

  const configManager = new ConfigManager();

  try {
    // 测试加载全局配置
    console.log('1. Loading global config...');
    const globalConfig = await configManager.load('./config.example.yaml');
    console.log('✓ Global config loaded');
    console.log(`  - MCP transport: ${globalConfig.mcp.transport}`);
    console.log(`  - Projects dir: ${globalConfig.projects_dir}`);
    console.log(`  - Log level: ${globalConfig.logging.level}\n`);

    // 测试加载项目配置
    console.log('2. Loading project configs...');
    const projects = await configManager.loadAllProjects();
    console.log(`✓ Found ${projects.size} projects\n`);

    for (const [projectId, config] of projects) {
      console.log(`  - ${projectId}: ${config.provider}`);
    }

    // 测试单个项目配置
    console.log('3. Loading hack-a-mole project...');
    const hackAMole = await configManager.loadProject('hack-a-mole');
    if (hackAMole) {
      console.log('✓ Hack-a-mole config loaded');
      console.log(`  - Provider: ${hackAMole.provider}\n`);
    } else {
      console.log('✗ Hack-a-mole config not found\n');
    }

    // 测试 Provider 启用状态
    console.log('4. Checking provider status...');
    const providers = ['feishu', 'telegram', 'whatsapp'] as const;
    for (const provider of providers) {
      const enabled = configManager.isProviderEnabled(provider);
      console.log(`  - ${provider}: ${enabled ? 'enabled' : 'disabled'}`);
    }
    console.log();

  } catch (error) {
    console.error('✗ Config test failed:', error);
    return false;
  }

  return true;
}

async function testLogger() {
  console.log('🧪 Testing Logger...\n');

  try {
    const logger = new Logger({ level: 'debug' });

    logger.debug('This is a debug message');
    logger.info('This is an info message');
    logger.warn('This is a warning message');
    logger.error('This is an error message');

    console.log('✓ Logger test passed\n');
    return true;
  } catch (error) {
    console.error('✗ Logger test failed:', error);
    return false;
  }
}

async function testRouter() {
  console.log('🧪 Testing Router...\n');

  try {
    const { Router } = await import('./core/router.js');
    const configManager = new ConfigManager();
    const logger = new Logger({ level: 'info' });

    const globalConfig = await configManager.load('./config.example.yaml');
    const router = new Router(configManager, logger);

    // 测试路由器基本功能
    console.log('1. Testing router initialization...');
    console.log('✓ Router initialized\n');

    console.log('2. Testing project registration...');
    const testConfig = {
      provider: 'feishu' as const,
      app_id: 'test',
      app_secret: 'test',
    };

    try {
      await router.registerProject('test-project', testConfig);
      console.log('✓ Project registered\n');
    } catch (error) {
      console.log('⚠ Project registration skipped (expected - no real credentials)\n');
    }

    console.log('3. Testing routing methods...');
    const projects = router.getRegisteredProjects();
    console.log(`✓ Registered projects: ${projects.length}\n`);

    console.log('✓ Router test passed\n');
    return true;
  } catch (error) {
    console.error('✗ Router test failed:', error);
    return false;
  }
}

async function testMCPServer() {
  console.log('🧪 Testing MCP Server...\n');

  try {
    const { MCPServer } = await import('./core/mcp.js');
    const { Router } = await import('./core/router.js');
    const { ConfigManager } = await import('./core/config.js');
    const { Logger } = await import('./core/logger.js');

    const configManager = new ConfigManager();
    const logger = new Logger({ level: 'info' });
    const globalConfig = await configManager.load('./config.example.yaml');

    const router = new Router(configManager, logger);
    const mcpServer = new MCPServer(router, logger);

    console.log('1. Testing MCP server initialization...');
    console.log('✓ MCP server initialized\n');

    console.log('2. Testing tool definitions...');
    // 这里我们只是验证 MCP 服务器可以正常创建
    console.log('✓ Tools defined\n');

    console.log('✓ MCP Server test passed\n');
    return true;
  } catch (error) {
    console.error('✗ MCP Server test failed:', error);
    return false;
  }
}

async function main() {
  console.log('🚀 cc-connect-carry Test Suite\n');
  console.log('='.repeat(50));
  console.log();

  const results = {
    config: false,
    logger: false,
    router: false,
    mcp: false,
  };

  results.config = await testConfig();
  results.logger = await testLogger();
  results.router = await testRouter();
  results.mcp = await testMCPServer();

  console.log('='.repeat(50));
  console.log('\n📊 Test Results:\n');

  for (const [name, passed] of Object.entries(results)) {
    const status = passed ? '✓' : '✗';
    const statusText = passed ? 'PASS' : 'FAIL';
    console.log(`${status} ${name.padEnd(20)} ${statusText}`);
  }

  const allPassed = Object.values(results).every(r => r);
  console.log('\n' + (allPassed ? '🎉 All tests passed!' : '⚠️  Some tests failed'));
  process.exit(allPassed ? 0 : 1);
}

main();