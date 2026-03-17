#!/usr/bin/env node
/**
 * Functional Test Runner for CC-Power MCP Server
 *
 * This script tests all MCP tools and verifies log outputs match expected patterns.
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

const LOG_FILE = './logs/cc-power-test.log';

// Test cases definition
const TEST_CASES = [
  {
    id: 'TC-001',
    name: 'MCP Server Startup',
    description: 'Verify server starts correctly and logs expected patterns',
    expectedLogs: [
      'cc-connect-carry starting...',
      'Message logger initialized',
      'MCP server started (stdio mode)',
      'Heartbeat checker started',
      'cc-connect-carry started successfully'
    ]
  },
  {
    id: 'TC-002',
    name: 'Manual Project Registration',
    description: 'Test register_project MCP tool',
    expectedLogs: [
      'Registering project:',
      'FeishuProvider connecting',
      'Project registered successfully'
    ]
  },
  {
    id: 'TC-003',
    name: 'Send Message',
    description: 'Test send_message MCP tool',
    expectedLogs: [
      'Message sent to feishu:',
      'Outgoing message logged'
    ]
  },
  {
    id: 'TC-004',
    name: 'Get Status',
    description: 'Test get_status MCP tool',
    expectedLogs: [
      'Retrieved status for',
      'healthy:'
    ]
  },
  {
    id: 'TC-005',
    name: 'List Chats',
    description: 'Test list_chats MCP tool',
    expectedLogs: [
      'Found'
    ]
  },
  {
    id: 'TC-006',
    name: 'Send Heartbeat',
    description: 'Test send_heartbeat MCP tool',
    expectedLogs: [
      'Heartbeat received from project'
    ]
  },
  {
    id: 'TC-008',
    name: 'Get Heartbeat Status',
    description: 'Test get_heartbeat_status MCP tool',
    expectedLogs: [
      'Heartbeat status retrieved for'
    ]
  },
  {
    id: 'TC-009',
    name: 'Get Incoming Messages',
    description: 'Test get_incoming_messages MCP tool',
    expectedLogs: [
      'Retrieved'
    ]
  },
  {
    id: 'TC-010',
    name: 'Auto-Discover Projects',
    description: 'Test auto_discover_projects MCP tool',
    expectedLogs: [
      'Auto-discovering projects',
      'Auto-registered project:',
      'Auto-discovery complete'
    ]
  },
  {
    id: 'TC-011',
    name: 'Auto-Unregister',
    description: 'Test automatic unregistration via signal files',
    expectedLogs: [
      'Auto-unregistered project:'
    ]
  },
  {
    id: 'TC-012',
    name: 'Unregister Project',
    description: 'Test unregister_project MCP tool',
    expectedLogs: [
      'Unregistering project:',
      'Project unregistered'
    ]
  }
];

// Create log directory
async function setupLogDir() {
  const logDir = path.dirname(LOG_FILE);
  try {
    await fs.mkdir(logDir, { recursive: true });
  } catch (error) {
    // Directory may already exist
  }
}

// Read log file
async function readLogs() {
  try {
    const content = await fs.readFile(LOG_FILE, 'utf-8');
    return content;
  } catch (error) {
    return '';
  }
}

// Verify log patterns
function verifyLogs(logContent, expectedPatterns) {
  const missingPatterns = [];
  const foundPatterns = [];

  for (const pattern of expectedPatterns) {
    if (logContent.includes(pattern)) {
      foundPatterns.push(pattern);
    } else {
      missingPatterns.push(pattern);
    }
  }

  return {
    allFound: missingPatterns.length === 0,
    foundPatterns,
    missingPatterns
  };
}

// Print test result
function printResult(testCase, result) {
  const status = result.allFound ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${status} - ${testCase.id}: ${testCase.name}`);
  console.log(`  ${testCase.description}`);

  if (result.foundPatterns.length > 0) {
    console.log(`  Found patterns (${result.foundPatterns.length}):`);
    for (const pattern of result.foundPatterns) {
      console.log(`    ✓ ${pattern}`);
    }
  }

  if (result.missingPatterns.length > 0) {
    console.log(`  Missing patterns (${result.missingPatterns.length}):`);
    for (const pattern of result.missingPatterns) {
      console.log(`    ✗ ${pattern}`);
    }
  }
}

// Run TC-001 (server startup)
async function testTC001() {
  console.log('\n========================================');
  console.log('Running TC-001: MCP Server Startup');
  console.log('========================================');

  await setupLogDir();

  // Clear log file for fresh test
  try {
    await fs.writeFile(LOG_FILE, '');
  } catch (error) {
    // Ignore
  }

  return new Promise((resolve) => {
    const server = spawn('node', ['dist/cli.js', 'start'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    server.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    server.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Wait for startup and check logs
    setTimeout(async () => {
      server.kill();

      // Wait a bit for logs to flush
      await new Promise(r => setTimeout(r, 500));

      // Check log file
      const logContent = await readLogs();
      const testCase = TEST_CASES[0];
      const result = verifyLogs(logContent, testCase.expectedLogs);

      printResult(testCase, result);

      resolve(result.allFound);
    }, 3000);
  });
}

// Print summary
function printSummary(results) {
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');

  const total = TEST_CASES.length;
  const passed = results.filter(r => r).length;
  const failed = total - passed;

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);

  if (failed > 0) {
    console.log('\nFailed Tests:');
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) {
        console.log(`  - ${TEST_CASES[i].id}: ${TEST_CASES[i].name}`);
      }
    }
  }

  console.log('\n========================================');
}

// Main function
async function main() {
  console.log('CC-Power Functional Test Runner');
  console.log('========================================');

  const results = [];

  // Run TC-001 (server startup)
  const tc001Result = await testTC001();
  results.push(tc001Result);

  // Note: TC-002 through TC-012 require MCP protocol interaction
  // These should be tested by actually calling the MCP tools through Claude Code
  console.log('\n========================================');
  console.log('IMPORTANT NOTE');
  console.log('========================================');
  console.log('TC-002 through TC-012 require actual MCP tool invocation.');
  console.log('Please test these by:');
  console.log('  1. Starting Claude Code with the MCP server configured');
  console.log('  2. Calling each MCP tool through the Claude Code interface');
  console.log('  3. Verifying the log outputs match expected patterns');
  console.log('');
  console.log('Expected test procedure:');
  console.log('  1. Register a project: register_project');
  console.log('  2. Send a message: send_message');
  console.log('  3. Get status: get_status');
  console.log('  4. List chats: list_chats');
  console.log('  5. Send heartbeat: send_heartbeat');
  console.log('  6. Get heartbeat status: get_heartbeat_status');
  console.log('  7. Get incoming messages: get_incoming_messages');
  console.log('  8. Auto-discover: auto_discover_projects');
  console.log('  9. Unregister project: unregister_project');
  console.log('========================================');

  printSummary(results);
}

main().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});