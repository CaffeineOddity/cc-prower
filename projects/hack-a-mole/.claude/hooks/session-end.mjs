#!/usr/bin/env node
/**
 * SessionEnd Hook
 * 当 Claude Code 结束时，准备取消注册信号
 */

import * as fs from 'fs';
import * as path from 'path';

// 定义 hook 事件类型
interface SessionEndEvent {
  type: 'SessionEnd';
  sessionId: string;
  sessionContext: {
    projectDirectory: string;
  };
}

// 信号目录
const SIGNALS_DIR = path.join(process.env.HOME || '', '.cc-power', 'signals');

// 主函数
async function main() {
  // 读取输入
  const input = process.stdin.read();
  if (!input) {
    process.exit(0);
  }

  let event: SessionEndEvent;
  try {
    event = JSON.parse(input.toString());
  } catch (error) {
    process.exit(0);
  }

  if (event.type !== 'SessionEnd') {
    process.exit(0);
  }

  const projectDir = event.sessionContext.projectDirectory;
  const projectId = path.basename(projectDir);

  // 创建信号目录
  fs.mkdirSync(SIGNALS_DIR, { recursive: true });

  // 写入取消注册信号文件
  const signalPath = path.join(SIGNALS_DIR, `unregister-${projectId}.json`);
  const signal = {
    type: 'unregister',
    projectId,
    timestamp: Date.now(),
    sessionId: event.sessionId,
    projectDirectory: projectDir,
  };

  fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));

  console.error(`Project ${projectId} unregister signal written to ${signalPath}`);
  console.error(`Use MCP tool 'unregister_project' to unregister: { project_id: "${projectId}" }`);
}

// 运行主函数
main().catch(error => {
  console.error('SessionEnd hook error:', error);
  process.exit(1);
});