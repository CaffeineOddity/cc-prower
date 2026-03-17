#!/usr/bin/env node
/**
 * CC-Power Heartbeat Timeout Test (TC-007)
 * Tests automatic project unregistration when heartbeat timeout occurs
 */

import { Logger } from '../cc-power/core/logger.js';
import { ConfigManager } from '../cc-power/core/config.js';
import { Router } from '../cc-power/core/router.js';
import { MessageLogger } from '../cc-power/core/message-logger.js';
import * as path from 'path';

const LOG_DIR = './logs';
const LOG_FILE = path.join(LOG_DIR, 'cc-power-heartbeat-test.log');

const TEST_PROJECT_ID = 'test-project-timeout';
const TEST_PROVIDER = 'feishu';
const TEST_CONFIG = {
  app_id: 'cli_a93c0992f1399ccd',
  app_secret: 'egnFaEXVpX7XSWenOCgOvzZHqsh51tuO',
  bot_name: 'cc-power-timeout-test'
};

async function testHeartbeatTimeout() {
  console.log('========================================');
  console.log('TC-007: Heartbeat Timeout Test');
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

    // Step 3: Stop sending heartbeat (simulate timeout)
    // We'll wait longer than HEARTBEAT_TIMEOUT (60s)
    const WAIT_TIME = 65000; // 65 seconds

    console.log(`\n--- Step 3: Waiting ${WAIT_TIME/1000} seconds for heartbeat timeout ---`);
    console.log('(This is a long wait - testing automatic cleanup mechanism)');

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, WAIT_TIME));

    console.log('\n--- Step 4: Checking project status after timeout ---');

    // Check if project was unregistered
    registeredProjects = router.getRegisteredProjects();
    console.log(`Registered projects: ${registeredProjects.join(', ')}`);

    const isUnregistered = !registeredProjects.includes(TEST_PROJECT_ID);

    if (isUnregistered) {
      console.log('✅ PASS - Project was automatically unregistered due to heartbeat timeout');
      console.log('\nExpected behavior confirmed:');
      console.log('  - Project was registered initially');
      console.log('  - No heartbeat was sent for > 60 seconds');
      console.log('  - Project was automatically unregistered');
    } else {
      console.log('⚠️ WARNING - Project still registered after timeout');
      console.log('  This may indicate the heartbeat checker interval has not run yet');
      console.log('  The heartbeat checker runs every 10 seconds');

      // Manually trigger cleanup check
      console.log('\n--- Triggering manual cleanup check ---');
      await new Promise(resolve => setTimeout(resolve, 15000));

      registeredProjects = router.getRegisteredProjects();
      console.log(`Registered projects after additional wait: ${registeredProjects.join(', ')}`);

      const isNowUnregistered = !registeredProjects.includes(TEST_PROJECT_ID);

      if (isNowUnregistered) {
        console.log('✅ PASS - Project was eventually unregistered');
      } else {
        console.log('❌ FAIL - Project remains registered despite timeout');
        console.log('  Manual cleanup may be required');
      }
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

testHeartbeatTimeout().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});