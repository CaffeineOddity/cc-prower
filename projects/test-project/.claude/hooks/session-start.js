#!/usr/bin/env node
/**
 * SessionStart Hook
 * 当 Claude Code 启动时，准备项目配置信息供 MCP 注册使用
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// 定义 hook 事件类型
interface SessionStartEvent {
  type: 'SessionStart';
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

  let event: SessionStartEvent;
  try {
    event = JSON.parse(input.toString());
  } catch (error) {
    process.exit(0);
  }

  if (event.type !== 'SessionStart') {
    process.exit(0);
  }

  const projectDir = event.sessionContext.projectDirectory;

  // 查找项目配置文件
  const configPaths = [
    path.join(projectDir, '.cc-power.yaml'),
    path.join(projectDir, 'config.yaml'),
  ];

  let config: any = null;
  let configPath: string | null = null;

  for (const candidate of configPaths) {
    try {
      const content = fs.readFileSync(candidate, 'utf-8');
      config = yaml.parse(content);
      configPath = candidate;
      break;
    } catch (error) {
      continue;
    }
  }

  if (!config || !configPath) {
    process.exit(0);
  }

  const projectId = path.basename(projectDir);

  // 创建信号目录
  fs.mkdirSync(SIGNALS_DIR, { recursive: true });

  // 写入注册信号文件
  const signalPath = path.join(SIGNALS_DIR, `register-${projectId}.json`);
  const signal = {
    type: 'register',
    projectId,
    provider: config.provider,
    config: config[config.provider],
    timestamp: Date.now(),
    sessionId: event.sessionId,
    projectDirectory: projectDir,
  };

  fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));

  console.error(`Project ${projectId} registration signal written to ${signalPath}`);
  console.error(`Use MCP tool 'register_project' to register: { project_id: "${projectId}", provider: "${config.provider}", config: {...} }`);
}

// 运行主函数
main().catch(error => {
  console.error('SessionStart hook error:', error);
  process.exit(1);
});