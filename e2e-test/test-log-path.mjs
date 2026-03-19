#!/usr/bin/env node
/**
 * Log Path Unification Tests - Test unified log path configuration
 */

import { Logger } from '../cc-power-service/dist/core/logger.js';
import { ConfigManager } from '../cc-power-service/dist/core/config.js';
import { Router } from '../cc-power-service/dist/core/router.js';
import { MessageLogger } from '../cc-power-service/dist/core/message-logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'log-path-test.log');

// Expected log paths
const EXPECTED_MESSAGE_LOG_DIR = path.join(homedir(), '.cc-power/tmp/logs/messages');
const EXPECTED_SERVICE_LOG_FILE = path.join(homedir(), '.cc-power/tmp/logs/cc-power.log');

async function setup() {
  console.log('========================================');
  console.log('Log Path Unification Tests');
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

  const messageLogger = new MessageLogger();
  await messageLogger.initialize();

  const router = new Router(configManager, logger, messageLogger);

  return { logger, configManager, router, messageLogger, globalConfig };
}

async function testDefaultMessageLogPath(messageLogger) {
  console.log('\n--- Test 1: Default Message Log Path ---');

  try {
    // Check if the message log directory is created at the expected location
    const dirExists = await fs.access(EXPECTED_MESSAGE_LOG_DIR).then(() => true).catch(() => false);

    if (dirExists) {
      console.log('✅ PASS - Message log directory created at expected path');
      console.log(`  Path: ${EXPECTED_MESSAGE_LOG_DIR}`);
      return true;
    } else {
      console.log('❌ FAIL - Message log directory not created at expected path');
      console.log(`  Expected: ${EXPECTED_MESSAGE_LOG_DIR}`);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error checking message log path:', error.message);
    return false;
  }
}

async function testServiceLogPathConfig(configManager) {
  console.log('\n--- Test 2: Service Log Path in Config ---');

  try {
    const globalConfig = configManager.getGlobalConfig();

    if (globalConfig?.logging?.file) {
      const logPath = globalConfig.logging.file.replace('~', homedir());
      const isCorrectPath = logPath === EXPECTED_SERVICE_LOG_FILE;

      if (isCorrectPath) {
        console.log('✅ PASS - Service log path configured correctly');
        console.log(`  Path: ${logPath}`);
        return true;
      } else {
        console.log('❌ FAIL - Service log path not matching expected');
        console.log(`  Actual: ${logPath}`);
        console.log(`  Expected: ${EXPECTED_SERVICE_LOG_FILE}`);
        return false;
      }
    } else {
      console.log('❌ FAIL - Service log path not configured');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error checking service log path:', error.message);
    return false;
  }
}

async function testMessageLoggerCustomPath() {
  console.log('\n--- Test 3: Message Logger Custom Path ---');

  try {
    const customLogDir = path.join(LOG_DIR, 'custom-messages');
    const customLogger = new MessageLogger(customLogDir);
    await customLogger.initialize();

    const dirExists = await fs.access(customLogDir).then(() => true).catch(() => false);

    if (dirExists) {
      console.log('✅ PASS - Message logger accepts custom path');
      console.log(`  Custom path: ${customLogDir}`);

      // Cleanup custom directory
      await fs.rm(customLogDir, { recursive: true, force: true });

      return true;
    } else {
      console.log('❌ FAIL - Custom log directory not created');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error testing custom path:', error.message);
    return false;
  }
}

async function testLogWriting(messageLogger) {
  console.log('\n--- Test 4: Log Writing to Correct Location ---');

  try {
    const testProjectId = 'test-log-path-project';
    const testChatId = 'test-chat-id';

    // Log a test message
    await messageLogger.logIncoming(
      testProjectId,
      'feishu',
      testChatId,
      'Test message content',
      'test-user',
      'Test User'
    );

    // Check if log file was created at expected location
    const logFilePath = path.join(EXPECTED_MESSAGE_LOG_DIR, `${testProjectId}.jsonl`);
    const fileExists = await fs.access(logFilePath).then(() => true).catch(() => false);

    if (fileExists) {
      console.log('✅ PASS - Log file created at expected location');
      console.log(`  Log file: ${logFilePath}`);

      // Read and verify content
      const content = await fs.readFile(logFilePath, 'utf-8');
      const hasContent = content.trim().length > 0;

      if (hasContent) {
        console.log('  Log file has content');

        // Cleanup test log file
        await fs.rm(logFilePath, { force: true });

        return true;
      } else {
        console.log('❌ FAIL - Log file is empty');
        return false;
      }
    } else {
      console.log('❌ FAIL - Log file not created at expected location');
      console.log(`  Expected: ${logFilePath}`);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error testing log writing:', error.message);
    return false;
  }
}

async function testLogDirectoryStructure() {
  console.log('\n--- Test 5: Log Directory Structure ---');

  try {
    const ccPowerTmpDir = path.join(homedir(), '.cc-power/tmp/logs');
    const dirExists = await fs.access(ccPowerTmpDir).then(() => true).catch(() => false);

    if (dirExists) {
      console.log('✅ PASS - Log directory structure created');
      console.log(`  Directory: ${ccPowerTmpDir}`);
      return true;
    } else {
      console.log('❌ FAIL - Log directory structure not created');
      console.log(`  Expected: ${ccPowerTmpDir}`);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error checking directory structure:', error.message);
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
    results.push({ id: 'LP-001', name: 'Default Message Log Path', passed: await testDefaultMessageLogPath(messageLogger) });
    results.push({ id: 'LP-002', name: 'Service Log Path in Config', passed: await testServiceLogPathConfig(configManager) });
    results.push({ id: 'LP-003', name: 'Message Logger Custom Path', passed: await testMessageLoggerCustomPath() });
    results.push({ id: 'LP-004', name: 'Log Writing to Correct Location', passed: await testLogWriting(messageLogger) });
    results.push({ id: 'LP-005', name: 'Log Directory Structure', passed: await testLogDirectoryStructure() });

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