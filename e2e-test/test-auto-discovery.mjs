#!/usr/bin/env node
/**
 * CC-Power Auto-Discovery Test (TC-010, TC-011)
 * Tests signal file processing for automatic project registration/unregistration
 */

import { MCPServer } from '../cc-power-mcp/src/mcp/index.js';
import { Logger } from '../cc-power/core/logger.js';
import { ConfigManager } from '../cc-power/core/config.js';
import { Router } from '../cc-power/core/router.js';
import { MessageLogger } from '../cc-power/core/message-logger.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'cc-power-auto-discovery-test.log');

// Test configuration
const TEST_PROJECT_ID = 'test-auto-discover';
const TEST_PROVIDER = 'feishu';
const TEST_CONFIG = {
  app_id: 'cli_a93c0992f1399ccd',
  app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
  bot_name: 'cc-power-auto-discover'
};

async function setupTestEnvironment() {
  console.log('========================================');
  console.log('TC-010 & TC-011: Auto-Discovery Tests');
  console.log('========================================');

  // Create log directory
  await fs.mkdir(LOG_DIR, { recursive: true });

  // Clear test log
  await fs.writeFile(LOG_FILE, '');

  // Initialize components
  const logger = new Logger({
    level: 'debug',
    file: LOG_FILE
  });

  const configManager = new ConfigManager();
  await configManager.load('./config.yaml');

  const messageLogger = new MessageLogger(path.join(LOG_DIR, 'messages'));
  await messageLogger.initialize();

  const router = new Router(configManager, logger, messageLogger);

  return { logger, configManager, router, messageLogger };
}

async function createSignalFile(type, projectId, provider, config) {
  const signalsDir = path.join(os.homedir(), '.cc-power', 'signals');
  await fs.mkdir(signalsDir, { recursive: true });

  const filename = `${type}-${projectId}.json`;
  const filepath = path.join(signalsDir, filename);

  const signal = {
    type,
    projectId,
    provider,
    config,
    timestamp: Date.now()
  };

  await fs.writeFile(filepath, JSON.stringify(signal, null, 2));

  console.log(`✓ Created signal file: ${filename}`);
  console.log(`  Type: ${type}`);
  console.log(`  Project ID: ${projectId}`);

  return filepath;
}

async function testTC010(logger, configManager, router) {
  console.log('\n--- TC-010: Auto-Discover Projects ---');

  try {
    // Step 1: Create a registration signal file
    console.log('\nStep 1: Creating registration signal file');
    const signalFile = await createSignalFile(
      'register',
      TEST_PROJECT_ID,
      TEST_PROVIDER,
      TEST_CONFIG
    );

    // Step 2: Process signal files
    console.log('\nStep 2: Processing signal files');

    // Simulate MCP server's processSignalFiles method
    const signalsDir = path.join(os.homedir(), '.cc-power', 'signals');
    const files = await fs.readdir(signalsDir);

    console.log(`  Found ${files.length} signal file(s)`);

    let registered = 0;
    for (const file of files) {
      const filepath = path.join(signalsDir, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const signal = JSON.parse(content);

      if (signal.type === 'register') {
        console.log(`  Processing register signal for: ${signal.projectId}`);

        const projectConfig = {
          provider: signal.provider,
          projectId: signal.projectId,
          ...signal.config
        };

        await router.registerProject(signal.projectId, projectConfig);
        registered++;

        // Delete signal file
        await fs.unlink(filepath);
        console.log(`  ✓ Deleted signal file: ${file}`);
      }
    }

    // Step 3: Verify project was registered
    console.log('\nStep 3: Verifying project registration');
    const registeredProjects = router.getRegisteredProjects();
    console.log(`  Registered projects: ${registeredProjects.join(', ')}`);

    const isRegistered = registeredProjects.includes(TEST_PROJECT_ID);

    if (isRegistered && registered > 0) {
      console.log('\n✅ PASS - Auto-discovery works correctly');
      console.log('Verification:');
      console.log('  ✓ Signal file was created');
      console.log('  ✓ Signal file was processed');
      console.log('  ✓ Project was registered');
      console.log('  ✓ Signal file was deleted after processing');
      return true;
    } else {
      console.log('\n❌ FAIL - Auto-discovery did not register project');
      return false;
    }
  } catch (error) {
    console.log(`\n❌ FAIL - Auto-discovery error: ${error.message}`);
    return false;
  }
}

async function testTC011(logger, router) {
  console.log('\n--- TC-011: Auto-Unregister ---');

  try {
    // Step 1: Create an unregister signal file
    console.log('\nStep 1: Creating unregister signal file');
    const signalFile = await createSignalFile(
      'unregister',
      TEST_PROJECT_ID,
      TEST_PROVIDER,
      {}
    );

    // Step 2: Process signal files
    console.log('\nStep 2: Processing signal files');

    const signalsDir = path.join(os.homedir(), '.cc-power', 'signals');
    const files = await fs.readdir(signalsDir);

    console.log(`  Found ${files.length} signal file(s)`);

    let unregistered = 0;
    for (const file of files) {
      const filepath = path.join(signalsDir, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const signal = JSON.parse(content);

      if (signal.type === 'unregister') {
        console.log(`  Processing unregister signal for: ${signal.projectId}`);

        await router.unregisterProject(signal.projectId);
        unregistered++;

        // Delete signal file
        await fs.unlink(filepath);
        console.log(`  ✓ Deleted signal file: ${file}`);
      }
    }

    // Step 3: Verify project was unregistered
    console.log('\nStep 3: Verifying project unregistration');
    const registeredProjects = router.getRegisteredProjects();
    console.log(`  Registered projects: ${registeredProjects.join(', ') || 'none'}`);

    const isUnregistered = !registeredProjects.includes(TEST_PROJECT_ID);

    if (isUnregistered && unregistered > 0) {
      console.log('\n✅ PASS - Auto-unregister works correctly');
      console.log('Verification:');
      console.log('  ✓ Unregister signal file was created');
      console.log('  ✓ Signal file was processed');
      console.log('  ✓ Project was unregistered');
      console.log('  ✓ Signal file was deleted after processing');
      return true;
    } else {
      console.log('\n❌ FAIL - Auto-unregister did not remove project');
      return false;
    }
  } catch (error) {
    console.log(`\n❌ FAIL - Auto-unregister error: ${error.message}`);
    return false;
  }
}

async function cleanup(logger, router) {
  console.log('\n--- Cleanup ---');

  try {
    await router.cleanup();
    console.log('✅ Router cleaned up successfully');
  } catch (error) {
    console.log('⚠️ Cleanup warning:', error.message);
  }
}

async function printTestResults(results) {
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);

  if (failed > 0) {
    console.log('\nFailed Tests:');
    for (const result of results) {
      if (!result.passed) {
        console.log(`  - ${result.id}: ${result.name}`);
      }
    }
  }

  console.log('\n========================================');
}

async function main() {
  let results = [];

  try {
    const { logger, configManager, router, messageLogger } = await setupTestEnvironment();

    // Run tests
    results.push({
      id: 'TC-010',
      name: 'Auto-Discover Projects',
      passed: await testTC010(logger, configManager, router)
    });

    results.push({
      id: 'TC-011',
      name: 'Auto-Unregister',
      passed: await testTC011(logger, router)
    });

    // Cleanup
    await cleanup(logger, router);

    // Print summary
    await printTestResults(results);

    // Print log contents
    console.log('\n--- Log Contents ---');
    const logContent = await fs.readFile(LOG_FILE, 'utf-8');
    console.log(logContent);

  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

main();
