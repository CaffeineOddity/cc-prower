#!/usr/bin/env node
/**
 * Run All E2E Tests
 *
 * This script runs all E2E tests in the correct order and summarizes results.
 */

import { spawn } from 'child_process';
import * as path from 'path';

const TEST_FILES = [
  'test-runner.mjs',
  'test-core.mjs',
  'test-auto-discovery.mjs',
  'test-send-message.mjs',
  'test-heartbeat-timeout-fast.mjs'
];

const TIMEOUTS = {
  'test-runner.mjs': 10000,
  'test-core.mjs': 30000,
  'test-auto-discovery.mjs': 30000,
  'test-send-message.mjs': 30000,
  'test-heartbeat-timeout-fast.mjs': 90000
};

async function runTest(testFile, timeout) {
  const testPath = path.join('e2e-test', testFile);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const child = spawn('npx', ['tsx', testPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      resolve({
        test: testFile,
        passed: code === 0,
        duration,
        output: stdout,
        error: stderr
      });
    });

    child.on('error', (error) => {
      reject({
        test: testFile,
        passed: false,
        error: error.message
      });
    });
  });
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║              CC-Power E2E Tests - Running All Tests              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const results = [];
  let totalDuration = 0;

  for (let i = 0; i < TEST_FILES.length; i++) {
    const testFile = TEST_FILES[i];
    const timeout = TIMEOUTS[testFile];

    console.log(`[${i + 1}/${TEST_FILES.length}] Running ${testFile}...`);

    try {
      const result = await runTest(testFile, timeout);
      results.push(result);
      totalDuration += result.duration;

      if (result.passed) {
        console.log(`  ✅ PASSED (${(result.duration / 1000).toFixed(1)}s)`);
      } else {
        console.log(`  ❌ FAILED (${(result.duration / 1000).toFixed(1)}s)`);
      }
    } catch (error) {
      results.push({
        test: testFile,
        passed: false,
        error: error.message
      });
      console.log(`  ❌ FAILED`);
    }

    console.log('');
  }

  // Print summary
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                          Test Summary                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(1)}s\n`);

  if (failed > 0) {
    console.log('Failed Tests:');
    for (const result of results) {
      if (!result.passed) {
        console.log(`  - ${result.test}`);
      }
    }
  }

  console.log('\n' + '═'.repeat(69) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();