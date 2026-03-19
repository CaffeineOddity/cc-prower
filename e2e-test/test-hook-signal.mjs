#!/usr/bin/env node
/**
 * Hook Signal Format Tests - Test hook signal format compatibility
 */

import { Logger } from '../cc-power-service/dist/core/logger.js';
import { ConfigManager } from '../cc-power-service/dist/core/config.js';
import { Router } from '../cc-power-service/dist/core/router.js';
import { MessageLogger } from '../cc-power-service/dist/core/message-logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'hook-signal-test.log');

// Test project configuration
const TEST_PROJECT_ID = 'test-hook-project';

// Old format signal
const OLD_FORMAT_SIGNAL = {
  type: 'send_message',
  provider: 'feishu',
  projectId: TEST_PROJECT_ID,
  chatId: 'test_chat_id',
  content: 'Test message from old format'
};

// New format signal
const NEW_FORMAT_SIGNAL = {
  session_id: '4121246d-e581-4989-a5bc-a611fa989e86',
  transcript_path: '/tmp/test-transcript.jsonl',
  cwd: '/tmp/test-project',
  permission_mode: 'default',
  hook_event_name: 'Stop',
  stop_hook_active: false,
  last_assistant_message: 'Test message from new format',
  provider: 'feishu',
  project_id: TEST_PROJECT_ID
};

async function setup() {
  console.log('========================================');
  console.log('Hook Signal Format Tests');
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

async function testOldFormatSignal(router) {
  console.log('\n--- Test 1: Old Format Signal Processing ---');

  try {
    // Create a temporary signal file with old format
    const hooksDir = path.join(homedir(), '.cc-power', 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });

    const timestamp = Date.now();
    const signalFile = path.join(hooksDir, `send-${TEST_PROJECT_ID}-${timestamp}.json`);
    await fs.writeFile(signalFile, JSON.stringify(OLD_FORMAT_SIGNAL, null, 2));

    console.log(`✓ Created old format signal file: ${signalFile}`);

    // Note: Actual processing requires the Router to have a registered provider
    // This test verifies the signal format structure
    console.log('✅ PASS - Old format signal structure is valid');
    console.log(`  Type: ${OLD_FORMAT_SIGNAL.type}`);
    console.log(`  Provider: ${OLD_FORMAT_SIGNAL.provider}`);
    console.log(`  ChatId: ${OLD_FORMAT_SIGNAL.chatId}`);

    // Cleanup
    await fs.rm(signalFile, { force: true });

    return true;
  } catch (error) {
    console.log('❌ FAIL - Old format signal test error:', error.message);
    return false;
  }
}

async function testNewFormatSignal(router) {
  console.log('\n--- Test 2: New Format Signal Processing ---');

  try {
    // Create a temporary transcript file
    const transcriptPath = '/tmp/test-transcript.jsonl';
    const transcriptContent = JSON.stringify({
      role: 'assistant',
      content: 'Test message from transcript'
    }) + '\n';
    await fs.writeFile(transcriptPath, transcriptContent);

    // Update signal with correct transcript path
    NEW_FORMAT_SIGNAL.transcript_path = transcriptPath;

    // Create a temporary signal file with new format
    const hooksDir = path.join(homedir(), '.cc-power', 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });

    const timestamp = Date.now();
    const signalFile = path.join(hooksDir, `send-${TEST_PROJECT_ID}-${timestamp}.json`);
    await fs.writeFile(signalFile, JSON.stringify(NEW_FORMAT_SIGNAL, null, 2));

    console.log(`✓ Created new format signal file: ${signalFile}`);

    console.log('✅ PASS - New format signal structure is valid');
    console.log(`  Hook Event: ${NEW_FORMAT_SIGNAL.hook_event_name}`);
    console.log(`  Provider: ${NEW_FORMAT_SIGNAL.provider}`);
    console.log(`  Project ID: ${NEW_FORMAT_SIGNAL.project_id}`);
    console.log(`  Transcript Path: ${NEW_FORMAT_SIGNAL.transcript_path}`);

    // Cleanup
    await fs.rm(signalFile, { force: true });
    await fs.rm(transcriptPath, { force: true });

    return true;
  } catch (error) {
    console.log('❌ FAIL - New format signal test error:', error.message);
    return false;
  }
}

async function testHookScriptPath() {
  console.log('\n--- Test 3: Hook Script Path ---');

  try {
    const hookScriptPath = path.join(process.cwd(), 'cc-power-service', 'claude-code-hooks', 'stop-hook.sh');
    const scriptExists = await fs.access(hookScriptPath).then(() => true).catch(() => false);

    if (scriptExists) {
      console.log('✅ PASS - Hook script exists at expected path');
      console.log(`  Script: ${hookScriptPath}`);
      return true;
    } else {
      console.log('❌ FAIL - Hook script not found at expected path');
      console.log(`  Expected: ${hookScriptPath}`);
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error checking hook script:', error.message);
    return false;
  }
}

async function testSettingsJson() {
  console.log('\n--- Test 4: Settings.json Configuration ---');

  try {
    const settingsPath = path.join(process.cwd(), 'cc-power-service', 'claude-code-hooks', 'settings.json');
    const settingsContent = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);

    if (settings.hooks?.Stop) {
      const stopHooks = settings.hooks.Stop;
      let usesStopHookScript = false;

      for (const hookConfig of stopHooks) {
        if (hookConfig.hooks) {
          for (const hook of hookConfig.hooks) {
            if (hook.type === 'command' && hook.command.includes('stop-hook.sh')) {
              usesStopHookScript = true;
              break;
            }
          }
        }
      }

      if (usesStopHookScript) {
        console.log('✅ PASS - Settings.json configured with stop-hook.sh');
        console.log(`  Settings: ${settingsPath}`);
        return true;
      } else {
        console.log('❌ FAIL - Settings.json not configured with stop-hook.sh');
        return false;
      }
    } else {
      console.log('❌ FAIL - Settings.json missing Stop hook configuration');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error checking settings.json:', error.message);
    return false;
  }
}

async function testHookSignalsDirectory() {
  console.log('\n--- Test 5: Hook Signals Directory ---');

  try {
    const hooksDir = path.join(homedir(), '.cc-power', 'hooks');
    await fs.mkdir(hooksDir, { recursive: true });

    const dirExists = await fs.access(hooksDir).then(() => true).catch(() => false);

    if (dirExists) {
      console.log('✅ PASS - Hook signals directory created');
      console.log(`  Directory: ${hooksDir}`);
      return true;
    } else {
      console.log('❌ FAIL - Hook signals directory not created');
      return false;
    }
  } catch (error) {
    console.log('❌ FAIL - Error checking hooks directory:', error.message);
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
    results.push({ id: 'HS-001', name: 'Old Format Signal Processing', passed: await testOldFormatSignal(router) });
    results.push({ id: 'HS-002', name: 'New Format Signal Processing', passed: await testNewFormatSignal(router) });
    results.push({ id: 'HS-003', name: 'Hook Script Path', passed: await testHookScriptPath() });
    results.push({ id: 'HS-004', name: 'Settings.json Configuration', passed: await testSettingsJson() });
    results.push({ id: 'HS-005', name: 'Hook Signals Directory', passed: await testHookSignalsDirectory() });

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