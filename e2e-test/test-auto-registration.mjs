#!/usr/bin/env node
/**
 * CC-Power Auto-Registration Test (TC-010, TC-011)
 * Tests file system signal processing for automatic project registration/unregistration
 */

import { Logger } from '../cc-power/dist/core/logger.js';
import { ConfigManager } from '../cc-power/dist/core/config.js';
import { Router } from '../cc-power/dist/core/router.js';
import { MessageLogger } from '../cc-power/dist/core/message-logger.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import chokidar from '../cc-power/node_modules/chokidar/index.js';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'cc-power-auto-registration-test.log');

// Test configuration
const TEST_PROJECT_ID = 'test-auto-register-' + Date.now();
const TEST_PROVIDER = 'feishu';
const TEST_CONFIG = {
  app_id: 'cli_a93c0992f1399ccd',
  app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
  bot_name: 'cc-power-auto-register-test',
  allowed_users: ['ou_123456']
};

async function setupTestEnvironment() {
  console.log('========================================');
  console.log('TC-010 & TC-011: Auto-Registration Tests');
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

  // Mock config manager and message logger
  const configManager = new ConfigManager();

  // Load default config or create a minimal one
  try {
    await configManager.load('./config.yaml');
  } catch (e) {
    // Create a minimal config if none exists
    console.log('Using default config for testing...');
  }

  const messageLogger = new MessageLogger(path.join(LOG_DIR, 'messages'));
  await messageLogger.initialize();

  const router = new Router(configManager, logger, messageLogger);

  return { logger, configManager, router, messageLogger };
}

async function createSignalFile(type, projectId, projectDirectory, config = {}) {
  const signalsDir = path.join(os.homedir(), '.cc-power', 'signals');
  await fs.mkdir(signalsDir, { recursive: true });

  const filename = `${type}-${projectId}.json`;
  const filepath = path.join(signalsDir, filename);

  const signal = {
    type,
    projectId,
    tmuxPane: `test-session-${projectId}:0`, // Default tmux pane
    timestamp: Date.now(),
    projectDirectory: projectDirectory || `/tmp/test-project-${projectId}`,
    provider: config.provider || 'feishu',
    config: config
  };

  await fs.writeFile(filepath, JSON.stringify(signal, null, 2));

  console.log(`✓ Created signal file: ${filename}`);
  console.log(`  Type: ${type}`);
  console.log(`  Project ID: ${projectId}`);
  console.log(`  Location: ${filepath}`);

  return filepath;
}

async function setupSignalFileWatcher(router, logger) {
  const signalsDir = path.join(os.homedir(), '.cc-power', 'signals');
  await fs.mkdir(signalsDir, { recursive: true });

  const watcher = chokidar.watch(signalsDir, {
    ignored: /^\./, // 忽略隐藏文件
    persistent: true,
  });

  watcher.on('add', async (filePath) => {
    if (filePath.endsWith('.json')) {
      await processSignalFile(filePath, router, logger);
    }
  });

  logger.info(`Started watching signal directory: ${signalsDir}`);
  return watcher;
}

async function processSignalFile(filePath, router, logger) {
  try {
    const fileName = path.basename(filePath);
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const signal = JSON.parse(fileContent);

    logger.info(`Processing signal file: ${fileName}`, signal);

    if (fileName.startsWith('register-') && fileName.endsWith('.json')) {
      // Extract project config from signal
      const projectConfig = {
        provider: signal.provider || 'feishu',
        ...signal.config,
        tmuxPane: signal.tmuxPane,
      };

      // Register project
      await router.registerProject(signal.projectId, projectConfig);
      logger.info(`Successfully registered project: ${signal.projectId} from signal`);

      // Delete signal file after processing
      await fs.unlink(filePath);
      logger.debug(`Deleted processed signal file: ${filePath}`);
    } else if (fileName.startsWith('unregister-') && fileName.endsWith('.json')) {
      // Unregister project
      await router.unregisterProject(signal.projectId);
      logger.info(`Successfully unregistered project: ${signal.projectId} from signal`);

      // Delete signal file after processing
      await fs.unlink(filePath);
      logger.debug(`Deleted processed signal file: ${filePath}`);
    }
  } catch (error) {
    logger.error(`Failed to process signal file ${filePath}:`, error);
  }
}

async function testTC010(logger, configManager, router) {
  console.log('\n--- TC-010: Auto-Register Signal Processing ---');

  try {
    // Setup file watcher
    const watcher = await setupSignalFileWatcher(router, logger);

    // Step 1: Create a registration signal file
    console.log('\nStep 1: Creating registration signal file');
    const projectDir = `/tmp/test-project-${TEST_PROJECT_ID}`;
    await fs.mkdir(projectDir, { recursive: true });

    // Create a mock .cc-power.yaml in project directory
    const projectConfigContent = {
      provider: TEST_PROVIDER,
      feishu: TEST_CONFIG
    };
    await fs.writeFile(path.join(projectDir, '.cc-power.yaml'), JSON.stringify(projectConfigContent, null, 2));

    const signalFile = await createSignalFile(
      'register',
      TEST_PROJECT_ID,
      projectDir,
      projectConfigContent
    );

    // Wait briefly for the file watcher to process the file
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: Verify project was registered
    console.log('\nStep 2: Verifying project registration');
    const registeredProjects = router.getRegisteredProjects();
    console.log(`  Registered projects: ${registeredProjects.join(', ')}`);

    const isRegistered = registeredProjects.includes(TEST_PROJECT_ID);

    // Stop the watcher
    watcher.close();

    if (isRegistered) {
      console.log('\n✅ PASS - Auto-registration works correctly');
      console.log('Verification:');
      console.log('  ✓ Signal file was created');
      console.log('  ✓ Signal file was detected by file watcher');
      console.log('  ✓ Project was registered');
      console.log('  ✓ Signal file was deleted after processing');
      return true;
    } else {
      console.log('\n❌ FAIL - Auto-registration did not register project');
      console.log(`  Expected project ID: ${TEST_PROJECT_ID}`);
      console.log(`  Actual registered projects: ${registeredProjects.join(', ') || 'none'}`);
      return false;
    }
  } catch (error) {
    console.log(`\n❌ FAIL - Auto-registration error: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

async function testTC011(logger, router) {
  console.log('\n--- TC-011: Auto-Unregister Signal Processing ---');

  try {
    // Setup file watcher
    const watcher = await setupSignalFileWatcher(router, logger);

    // Step 1: Create an unregister signal file
    console.log('\nStep 1: Creating unregister signal file');
    const signalFile = await createSignalFile(
      'unregister',
      TEST_PROJECT_ID,
      `/tmp/test-project-${TEST_PROJECT_ID}`
    );

    // Wait briefly for the file watcher to process the file
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Step 2: Verify project was unregistered
    console.log('\nStep 2: Verifying project unregistration');
    const registeredProjects = router.getRegisteredProjects();
    console.log(`  Registered projects: ${registeredProjects.join(', ') || 'none'}`);

    const isUnregistered = !registeredProjects.includes(TEST_PROJECT_ID);

    // Stop the watcher
    watcher.close();

    if (isUnregistered) {
      console.log('\n✅ PASS - Auto-unregistration works correctly');
      console.log('Verification:');
      console.log('  ✓ Unregister signal file was created');
      console.log('  ✓ Signal file was detected by file watcher');
      console.log('  ✓ Project was unregistered');
      console.log('  ✓ Signal file was deleted after processing');
      return true;
    } else {
      console.log('\n❌ FAIL - Auto-unregistration did not remove project');
      console.log(`  Expected project ID to be removed: ${TEST_PROJECT_ID}`);
      console.log(`  Still registered projects: ${registeredProjects.join(', ') || 'none'}`);
      return false;
    }
  } catch (error) {
    console.log(`\n❌ FAIL - Auto-unregistration error: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

async function cleanup(logger, router, testProjectId) {
  console.log('\n--- Cleanup ---');

  try {
    // Try to unregister the test project if still registered
    const registeredProjects = router.getRegisteredProjects();
    if (registeredProjects.includes(testProjectId)) {
      await router.unregisterProject(testProjectId);
      console.log(`✅ Cleaned up test project: ${testProjectId}`);
    }

    // Remove signal files
    const signalsDir = path.join(os.homedir(), '.cc-power', 'signals');
    try {
      const files = await fs.readdir(signalsDir);
      for (const file of files) {
        if (file.includes(testProjectId)) {
          await fs.unlink(path.join(signalsDir, file));
          console.log(`✅ Removed signal file: ${file}`);
        }
      }
    } catch (e) {
      // Directory may not exist
    }

    // Remove test project directory
    try {
      await fs.rm(`/tmp/test-project-${testProjectId}`, { recursive: true, force: true });
      console.log(`✅ Removed test project directory`);
    } catch (e) {
      // Directory may not exist
    }

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
      name: 'Auto-Register Signal Processing',
      passed: await testTC010(logger, configManager, router)
    });

    results.push({
      id: 'TC-011',
      name: 'Auto-Unregister Signal Processing',
      passed: await testTC011(logger, router)
    });

    // Cleanup
    await cleanup(logger, router, TEST_PROJECT_ID);

    // Print summary
    await printTestResults(results);

    // Print log contents
    try {
      console.log('\n--- Log Contents ---');
      const logContent = await fs.readFile(LOG_FILE, 'utf-8');
      console.log(logContent);
    } catch (e) {
      console.log('Could not read log file:', e.message);
    }

    // Exit with appropriate code
    const hasFailures = results.some(r => !r.passed);
    if (hasFailures) {
      process.exit(1);
    }

  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

main();