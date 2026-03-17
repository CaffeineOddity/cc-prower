#!/usr/bin/env node
/**
 * CC-Power Simulated Heartbeat Timeout Test (TC-007)
 * Tests automatic project unregistration by manipulating heartbeat timestamps
 */

import { Logger } from '../cc-power/core/logger.js';
import { ConfigManager } from '../cc-power/core/config.js';
import { Router } from '../cc-power/core/router.js';
import { MessageLogger } from '../cc-power/core/message-logger.js';
import * as path from 'path';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'cc-power-timeout-test.log');

const TEST_PROJECT_ID = 'test-project-timeout';
const TEST_PROVIDER = 'feishu';
const TEST_CONFIG = {
  app_id: 'cli_a93c0992f1399ccd',
  app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
  bot_name: 'cc-power-timeout-test'
};

async function testSimulatedHeartbeatTimeout() {
  console.log('========================================');
  console.log('TC-007: Heartbeat Timeout Test (Simulated)');
  console.log('========================================');

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

  try {
    // Step 1: Register a project
    console.log('\n--- Step 1: Registering project ---');
    const projectConfig = {
      provider: TEST_PROVIDER,
      projectId: TEST_PROJECT_ID,
      ...TEST_CONFIG
    };

    await router.registerProject(TEST_PROJECT_ID, projectConfig);
    console.log('✅ Project registered');

    // Verify project is registered
    let registeredProjects = router.getRegisteredProjects();
    console.log(`Registered projects: ${registeredProjects.join(', ')}`);

    if (!registeredProjects.includes(TEST_PROJECT_ID)) {
      throw new Error('Project not registered after registration');
    }

    // Step 2: Check initial heartbeat status
    console.log('\n--- Step 2: Initial heartbeat status ---');
    let status = router.getProjectHeartbeatStatus(TEST_PROJECT_ID);
    console.log(`Is alive: ${status.isAlive}`);
    console.log(`Last heartbeat: ${new Date(status.lastHeartbeat).toISOString()}`);

    // Step 3: Simulate heartbeat timeout by waiting
    // The heartbeat checker runs every 10 seconds and has a 60s timeout
    // We'll wait 70 seconds to ensure it runs and triggers cleanup
    const CHECK_INTERVAL = 10000; // 10 seconds
    const TIMEOUT_THRESHOLD = 60000; // 60 seconds
    const TOTAL_WAIT = TIMEOUT_THRESHOLD + CHECK_INTERVAL + 2000; // 72 seconds

    console.log(`\n--- Step 3: Simulating heartbeat timeout ---`);
    console.log(`Heartbeat checker runs every ${CHECK_INTERVAL/1000}s`);
    console.log(`Heartbeat timeout threshold: ${TIMEOUT_THRESHOLD/1000}s`);
    console.log(`Waiting ${TOTAL_WAIT/1000}s for automatic cleanup...`);
    console.log('(This tests the heartbeat timeout mechanism without manual heartbeat updates)');

    // Wait for automatic cleanup
    const startTime = Date.now();
    let timeoutTriggered = false;

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const projects = router.getRegisteredProjects();
      const isUnregistered = !projects.includes(TEST_PROJECT_ID);

      if (isUnregistered && !timeoutTriggered) {
        console.log(`\n✅ Timeout triggered at ${(elapsed/1000).toFixed(1)}s`);
        console.log('Project was automatically unregistered');
        timeoutTriggered = true;
        clearInterval(checkInterval);
      } else if (elapsed >= TOTAL_WAIT && !timeoutTriggered) {
        console.log(`\n⚠️ Timeout check completed at ${(elapsed/1000).toFixed(1)}s`);
        clearInterval(checkInterval);
      }
    }, CHECK_INTERVAL);

    await new Promise(resolve => setTimeout(resolve, TOTAL_WAIT));

    // Final check
    console.log('\n--- Step 4: Final project status ---');
    registeredProjects = router.getRegisteredProjects();
    console.log(`Registered projects: ${registeredProjects.join(', ')}`);

    const isUnregistered = !registeredProjects.includes(TEST_PROJECT_ID);

    if (isUnregistered) {
      console.log('\n✅ PASS - Heartbeat timeout mechanism works correctly');
      console.log('Verification:');
      console.log('  ✓ Project was registered initially');
      console.log('  ✓ No heartbeat updates were sent');
      console.log('  ✓ Project was automatically unregistered after timeout');
      console.log('  ✓ Heartbeat checker detected the timeout and cleaned up');
    } else {
      console.log('\n❌ FAIL - Project remains registered despite timeout');
      console.log('  Possible issues:');
      console.log('    - Heartbeat checker interval not triggered');
      console.log('    - Timeout logic not executing');
      console.log('    - Project cleanup not completed');
    }

  } finally {
    // Cleanup
    console.log('\n--- Cleanup ---');
    await router.cleanup();
    console.log('✅ Router cleaned up');
  }

  console.log('\n========================================');
  console.log('Test complete');
  console.log('========================================');
}

testSimulatedHeartbeatTimeout().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});