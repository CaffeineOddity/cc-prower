#!/usr/bin/env node
/**
 * CC-Power Functional Test Runner
 * Tests MCP tool functionality and verifies log outputs
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

const ROOT_DIR = process.cwd();
const LOG_FILE = path.join(ROOT_DIR, './logs/cc-power.log');

// Expected log patterns for each test case
const EXPECTED_PATTERNS = {
  'TC-001': [
    'cc-connect-carry starting...',
    'Message logger initialized',
    'MCP server started (stdio mode)',
    'cc-connect-carry started successfully'
  ],
  'TC-002': [
    'Registering project:',
    'FeishuProvider',
    'registered successfully'
  ],
  'TC-003': [
    'Message sent to feishu:',
    'Outgoing message logged'
  ],
  'TC-004': [
    'Retrieved status for',
    'healthy:'
  ],
  'TC-005': [
    'Found',
    'active chats'
  ],
  'TC-006': [
    'Heartbeat received from project'
  ],
  'TC-008': [
    'Heartbeat status retrieved for'
  ],
  'TC-009': [
    'Retrieved',
    'incoming messages'
  ],
  'TC-010': [
    'Auto-discovering projects',
    'Auto-registered project:',
    'Auto-discovery complete'
  ],
  'TC-011': [
    'Auto-unregistered project:'
  ],
  'TC-012': [
    'Unregistering project:',
    'Project unregistered'
  ]
};

async function readLogs() {
  try {
    return await fs.readFile(LOG_FILE, 'utf-8');
  } catch (error) {
    return '';
  }
}

function checkPatterns(logContent, patterns) {
  const found = [];
  const missing = [];

  for (const pattern of patterns) {
    if (logContent.includes(pattern)) {
      found.push(pattern);
    } else {
      missing.push(pattern);
    }
  }

  return { allFound: missing.length === 0, found, missing };
}

async function testTC001() {
  console.log('\n========================================');
  console.log('TC-001: MCP Server Startup');
  console.log('========================================');

  // Clear log file for fresh test
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, '');
  } catch (error) {
    // Ignore errors
  }

  return new Promise((resolve) => {
    const server = spawn('node', ['dist/cli.js', 'start'], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    server.stdout.on('data', (data) => { stdout += data.toString(); });
    server.stderr.on('data', (data) => { stderr += data.toString(); });

    setTimeout(async () => {
      server.kill();

      await new Promise(r => setTimeout(r, 500));

      const logContent = await readLogs();
      const result = checkPatterns(logContent, EXPECTED_PATTERNS['TC-001']);

      console.log(result.allFound ? '✅ PASS' : '❌ FAIL');

      if (result.missing.length > 0) {
        console.log('  Missing patterns:');
        result.missing.forEach(p => console.log(`    ✗ ${p}`));
      }

      resolve({ id: 'TC-001', passed: result.allFound });
    }, 3000);
  });
}

function printSummary(results) {
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');

  const total = Object.keys(EXPECTED_PATTERNS).length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);

  if (failed > 0) {
    console.log('\nPending Tests (require MCP tool invocation):');
    Object.keys(EXPECTED_PATTERNS).slice(1).forEach(id => {
      console.log(`  - ${id}`);
    });
  }

  console.log('\n========================================');
}

async function main() {
  console.log('CC-Power Functional Test Runner');
  console.log('========================================');

  const results = [];

  // TC-001: Server startup
  results.push(await testTC001());

  // Note: TC-002 through TC-012 require actual MCP tool invocation
  console.log('\n========================================');
  console.log('TESTING REMAINING TESTS');
  console.log('========================================');
  console.log('The following tests require actual MCP tool invocation:');
  console.log('');
  console.log('To test these features:');
  console.log('  1. Configure Claude Code MCP server');
  console.log('  2. Start Claude Code in the test-project directory');
  console.log('  3. Use Claude Code to invoke each MCP tool');
  console.log('');
  console.log('MCP Tools to Test:');
  console.log('  - register_project: Register a project with provider config');
  console.log('  - send_message: Send a message to a chat platform');
  console.log('  - get_status: Query provider and project status');
  console.log('  - list_chats: List active chat sessions');
  console.log('  - send_heartbeat: Send heartbeat to keep project alive');
  console.log('  - get_heartbeat_status: Check project heartbeat status');
  console.log('  - get_incoming_messages: Retrieve queued messages');
  console.log('  - auto_discover_projects: Process signal files');
  console.log('  - unregister_project: Unregister and disconnect project');
  console.log('========================================');

  printSummary(results);
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});