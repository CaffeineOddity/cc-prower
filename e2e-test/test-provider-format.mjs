#!/usr/bin/env node
/**
 * Provider Format Tests - Test new nested provider configuration format
 */

import { Logger } from '../cc-power-service/dist/core/logger.js';
import { ConfigManager } from '../cc-power-service/dist/core/config.js';
import { Router } from '../cc-power-service/dist/core/router.js';
import { MessageLogger } from '../cc-power-service/dist/core/message-logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'provider-format-test.log');

// Test configuration
const TEST_PROJECT_ID_NEW = 'test-project-new-format';
const TEST_PROJECT_ID_OLD = 'test-project-old-format';

// New format config (nested)
const NEW_FORMAT_CONFIG = {
  provider: {
    name: 'feishu',
    app_id: 'cli_a93c0992f1399ccd',
    app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
    bot_name: 'cc-power-test-new',
    chat_id: 'oc_test_chat_id'
  }
};

// Old format config (flat)
const OLD_FORMAT_CONFIG = {
  provider: 'feishu',
  feishu: {
    app_id: 'cli_a93c0992f1399ccd',
    app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
    bot_name: 'cc-power-test-old',
    chat_id: 'oc_test_chat_id'
  }
};

async function setup() {
  console.log('========================================');
  console.log('Provider Format Tests');
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

async function testNewFormatRegistration(router) {
  console.log('\n--- Test 1: New Nested Format Registration ---');

  try {
    await router.registerProject(TEST_PROJECT_ID_NEW, NEW_FORMAT_CONFIG);

    const registeredProjects = router.getRegisteredProjects();
    const isRegistered = registeredProjects.includes(TEST_PROJECT_ID_NEW);

    if (isRegistered) {
      console.log('✅ PASS - New format project registered successfully');
      console.log(`  Registered projects: ${registeredProjects.join(', ')}`);

      // Verify provider configuration
      const provider = router.getProvider(TEST_PROJECT_ID_NEW);
      if (provider) {
        console.log(`  Provider type: ${provider.name}`);
        console.log(`  Provider healthy: ${provider.isHealthy()}`);
      }

      return true;
    } else {
      console.log('❌ FAIL - New format project not registered');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - New format registration error:', error.message);
    return false;
  }
}

async function testOldFormatRegistration(router) {
  console.log('\n--- Test 2: Old Flat Format Registration (Backward Compatibility) ---');

  try {
    await router.registerProject(TEST_PROJECT_ID_OLD, OLD_FORMAT_CONFIG);

    const registeredProjects = router.getRegisteredProjects();
    const isRegistered = registeredProjects.includes(TEST_PROJECT_ID_OLD);

    if (isRegistered) {
      console.log('✅ PASS - Old format project registered successfully');
      console.log(`  Registered projects: ${registeredProjects.join(', ')}`);

      const provider = router.getProvider(TEST_PROJECT_ID_OLD);
      if (provider) {
        console.log(`  Provider type: ${provider.name}`);
        console.log(`  Provider healthy: ${provider.isHealthy()}`);
      }

      return true;
    } else {
      console.log('❌ FAIL - Old format project not registered');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Old format registration error:', error.message);
    return false;
  }
}

async function testMixedFormatRegistration(router) {
  console.log('\n--- Test 3: Multiple Projects with Different Formats ---');

  try {
    const newProjectId = 'test-new-2';
    const oldProjectId = 'test-old-2';

    // Register new format project
    await router.registerProject(newProjectId, {
      provider: {
        name: 'feishu',
        app_id: 'cli_a93c0992f1399ccd',
        app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
        chat_id: 'oc_test_chat_id_2'
      }
    });

    // Register old format project
    await router.registerProject(oldProjectId, {
      provider: 'feishu',
      feishu: {
        app_id: 'cli_a93c0992f1399ccd',
        app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
        chat_id: 'oc_test_chat_id_3'
      }
    });

    const registeredProjects = router.getRegisteredProjects();
    const bothRegistered = registeredProjects.includes(newProjectId) && registeredProjects.includes(oldProjectId);

    if (bothRegistered) {
      console.log('✅ PASS - Both format projects registered successfully');
      console.log(`  Total registered: ${registeredProjects.length}`);

      return true;
    } else {
      console.log('❌ FAIL - Not all projects registered');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Mixed format registration error:', error.message);
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
    const { logger, configManager, router, messageLogger } = await setup();

    // Run tests
    results.push({ id: 'PF-001', name: 'New Nested Format Registration', passed: await testNewFormatRegistration(router) });
    results.push({ id: 'PF-002', name: 'Old Flat Format Registration', passed: await testOldFormatRegistration(router) });
    results.push({ id: 'PF-003', name: 'Mixed Format Registration', passed: await testMixedFormatRegistration(router) });

    // Cleanup
    await cleanup(logger, router);

    // Print summary
    await printTestResults(results);

    // Print log contents
    console.log('\n--- Log Contents ---');
    const logContent = await fs.readFile(LOG_FILE, 'utf-8');
    console.log(logContent);

    // Exit with appropriate code
    const allPassed = results.every(r => r.passed);
    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

main();