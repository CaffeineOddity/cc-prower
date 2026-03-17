#!/usr/bin/env node
/**
 * CC-Power Core Functionality Tests
 * Tests Router and MCP functionality directly without stdio protocol
 */

import { Logger } from '../cc-power/core/logger.js';
import { ConfigManager } from '../cc-power/core/config.js';
import { Router } from '../cc-power/core/router.js';
import { MessageLogger } from '../cc-power/core/message-logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'cc-power-test.log');

// Test configuration
const TEST_PROJECT_ID = 'test-project';
const TEST_PROVIDER = 'feishu';
const TEST_CONFIG = {
  app_id: 'cli_a93c0992f1399ccd',
  app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
  bot_name: 'cc-power-test'
};

async function setup() {
  console.log('========================================');
  console.log('CC-Power Core Functionality Tests');
  console.log('========================================');

  // Create log directory
  await fs.mkdir(LOG_DIR, { recursive: true });

  // Clear test log
  await fs.writeFile(LOG_FILE, '');

  // Initialize components
  const logger = new Logger({
    level: 'info',
    file: LOG_FILE
  });

  const configManager = new ConfigManager();
  // Load global config from root
  const globalConfig = await configManager.load('./config.yaml');
  logger.info('Global config loaded:', globalConfig);

  const messageLogger = new MessageLogger(path.join(LOG_DIR, 'messages'));
  await messageLogger.initialize();

  const router = new Router(configManager, logger, messageLogger);

  return { logger, configManager, router, messageLogger, globalConfig };
}

async function testTC002(logger, router) {
  console.log('\n--- TC-002: Manual Project Registration ---');

  try {
    const projectConfig = {
      provider: TEST_PROVIDER,
      projectId: TEST_PROJECT_ID,
      ...TEST_CONFIG
    };

    await router.registerProject(TEST_PROJECT_ID, projectConfig);

    // Check if project is registered
    const registeredProjects = router.getRegisteredProjects();
    const isRegistered = registeredProjects.includes(TEST_PROJECT_ID);

    if (isRegistered) {
      console.log('✅ PASS - Project registered successfully');
      console.log(`  Registered projects: ${registeredProjects.join(', ')}`);

      // Check provider health
      const provider = router.getProvider(TEST_PROJECT_ID);
      if (provider) {
        const isHealthy = provider.isHealthy();
        console.log(`  Provider healthy: ${isHealthy}`);
      }

      return true;
    } else {
      console.log('❌ FAIL - Project not registered');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Registration error:', error.message);
    return false;
  }
}

async function testTC003(logger, router) {
  console.log('\n--- TC-003: Send Message ---');

  try {
    // Note: Actual message sending requires a valid chat_id and Feishu API access
    // This test verifies the routing logic, not actual API call

    const result = await router.sendMessage({
      provider: TEST_PROVIDER,
      chat_id: 'test_chat_id',
      content: 'Test message from CC-Power',
      project_id: TEST_PROJECT_ID
    });

    console.log('⚠️ SKIP - Message sending requires valid chat_id and API access');
    console.log('  Routing logic is implemented');
    console.log('  To test fully:');
    console.log('    1. Get a valid Feishu chat_id');
    console.log('    2. Ensure Feishu API credentials are valid');
    console.log('    3. Call send_message MCP tool with real parameters');

    return true;
  } catch (error) {
    console.log('❌ FAIL - Send message error:', error.message);
    return false;
  }
}

async function testTC004(logger, router) {
  console.log('\n--- TC-004: Get Status ---');

  try {
    const status = await router.getStatus({
      provider: TEST_PROVIDER
    });

    console.log('✅ PASS - Status retrieved');
    console.log('  Status:', JSON.stringify(status, null, 2));

    return true;
  } catch (error) {
    console.log('❌ FAIL - Get status error:', error.message);
    return false;
  }
}

async function testTC005(logger, router) {
  console.log('\n--- TC-005: List Chats ---');

  try {
    const result = await router.listChats({
      provider: TEST_PROVIDER,
      project_id: TEST_PROJECT_ID
    });

    console.log('✅ PASS - Chats listed');
    console.log('  Result:', JSON.stringify(result, null, 2));

    return true;
  } catch (error) {
    console.log('❌ FAIL - List chats error:', error.message);
    return false;
  }
}

async function testTC006(router) {
  console.log('\n--- TC-006: Send Heartbeat ---');

  try {
    await router.sendHeartbeat(TEST_PROJECT_ID);

    const status = router.getProjectHeartbeatStatus(TEST_PROJECT_ID);
    console.log('✅ PASS - Heartbeat sent');
    console.log(`  Last heartbeat: ${new Date(status.lastHeartbeat).toISOString()}`);
    console.log(`  Is alive: ${status.isAlive}`);
    console.log(`  Time since last: ${status.lastHeartbeat > 0 ? Math.round((Date.now() - status.lastHeartbeat) / 1000) + 's' : 'N/A'}`);

    return true;
  } catch (error) {
    console.log('❌ FAIL - Send heartbeat error:', error.message);
    return false;
  }
}

async function testTC008(router) {
  console.log('\n--- TC-008: Get Heartbeat Status ---');

  try {
    const status = router.getProjectHeartbeatStatus(TEST_PROJECT_ID);

    console.log('✅ PASS - Heartbeat status retrieved');
    console.log(`  Project ID: ${TEST_PROJECT_ID}`);
    console.log(`  Last heartbeat: ${new Date(status.lastHeartbeat).toISOString()}`);
    console.log(`  Is alive: ${status.isAlive}`);
    console.log(`  Time since last: ${Math.round((Date.now() - status.lastHeartbeat) / 1000)}s`);

    return true;
  } catch (error) {
    console.log('❌ FAIL - Get heartbeat status error:', error.message);
    return false;
  }
}

async function testTC009(router) {
  console.log('\n--- TC-009: Get Incoming Messages ---');

  try {
    const messages = await router.getIncomingMessages({
      project_id: TEST_PROJECT_ID
    });

    console.log('✅ PASS - Incoming messages retrieved');
    console.log(`  Message count: ${messages.length}`);

    if (messages.length > 0) {
      console.log('  Messages:', JSON.stringify(messages, null, 2));
    } else {
      console.log('  No messages in queue (expected - no incoming messages yet)');
    }

    return true;
  } catch (error) {
    console.log('❌ FAIL - Get incoming messages error:', error.message);
    return false;
  }
}

async function testTC010(logger, router) {
  console.log('\n--- TC-010: Auto-Discover Projects ---');

  try {
    const signalsDir = path.join(process.env.HOME, '.cc-power', 'signals');

    // Check if signal file exists
    const signalFile = path.join(signalsDir, `register-${TEST_PROJECT_ID}.json`);
    const signalExists = await fs.access(signalFile).then(() => true).catch(() => false);

    if (signalExists) {
      console.log('✅ PASS - Signal file exists and will be processed');
      console.log(`  Signal file: ${signalFile}`);
      console.log('  Note: Signal processing requires MCP auto_discover_projects tool call');
      return true;
    } else {
      console.log('⚠️ SKIP - No signal file found');
      console.log(`  Expected: ${signalFile}`);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Auto-discover error:', error.message);
    return false;
  }
}

async function testTC012(logger, router) {
  console.log('\n--- TC-012: Unregister Project ---');

  try {
    await router.unregisterProject(TEST_PROJECT_ID);

    // Check if project is unregistered
    const registeredProjects = router.getRegisteredProjects();
    const isUnregistered = !registeredProjects.includes(TEST_PROJECT_ID);

    if (isUnregistered) {
      console.log('✅ PASS - Project unregistered successfully');
      console.log(`  Remaining projects: ${registeredProjects.join(', ') || 'none'}`);
      return true;
    } else {
      console.log('❌ FAIL - Project still registered');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Unregister error:', error.message);
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
  const skipped = results.filter(r => r.skipped).length;

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Skipped: ${skipped} ⚠️`);

  if (failed > 0) {
    console.log('\nFailed Tests:');
    for (const result of results) {
      if (!result.passed && !result.skipped) {
        console.log(`  - ${result.id}: ${result.name}`);
      }
    }
  }

  if (skipped > 0) {
    console.log('\nSkipped Tests (require external setup):');
    for (const result of results) {
      if (result.skipped) {
        console.log(`  - ${result.id}: ${result.name}`);
      }
    }
  }

  console.log('\n========================================');
}

async function main() {
  let results = [];

  try {
    const { logger, configManager, router, messageLogger } = await setup();

    // Run tests
    results.push({ id: 'TC-002', name: 'Manual Project Registration', passed: await testTC002(logger, router), skipped: false });
    results.push({ id: 'TC-006', name: 'Send Heartbeat', passed: await testTC006(router), skipped: false });
    results.push({ id: 'TC-008', name: 'Get Heartbeat Status', passed: await testTC008(router), skipped: false });
    results.push({ id: 'TC-004', name: 'Get Status', passed: await testTC004(logger, router), skipped: false });
    results.push({ id: 'TC-005', name: 'List Chats', passed: await testTC005(logger, router), skipped: false });
    results.push({ id: 'TC-009', name: 'Get Incoming Messages', passed: await testTC009(router), skipped: false });
    results.push({ id: 'TC-010', name: 'Auto-Discover Projects', passed: await testTC010(logger, router), skipped: false });
    results.push({ id: 'TC-003', name: 'Send Message', passed: false, skipped: true }); // Requires real chat_id
    results.push({ id: 'TC-012', name: 'Unregister Project', passed: await testTC012(logger, router), skipped: false });

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