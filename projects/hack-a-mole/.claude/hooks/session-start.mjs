#!/usr/bin/env node
/**
 * SessionStart Hook
 * 当 Claude Code 启动时，准备项目配置信息供 MCP 注册使用
 */

import * as fs from 'fs';
import * as path from 'path';

// 定义 hook 事件类型 (JSDoc 代替 TypeScript interface)
/**
 * @typedef {Object} SessionStartEvent
 * @property {'SessionStart'} type
 * @property {string} sessionId
 * @property {Object} sessionContext
 * @property {string} sessionContext.projectDirectory
 */

/**
 * 简单的 YAML 解析器（只处理简单的 key: value 格式）
 * @param {string} content - YAML 文件内容
 * @returns {Object} - 解析后的配置对象
 */
function parseSimpleYaml(content) {
  const result = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      // 去除引号
      const cleanValue = value.replace(/^["']|["']$/g, '');
      // 转换布尔值
      if (cleanValue === 'true') result[key] = true;
      else if (cleanValue === 'false') result[key] = false;
      else if (!isNaN(Number(cleanValue))) result[key] = Number(cleanValue);
      else result[key] = cleanValue;
    }
  }

  return result;
}

/**
 * 主函数，处理 SessionStart hook 事件
 * 读取标准输入，解析项目路径，并生成对应的注册信号文件
 * @returns {Promise<void>}
 */
async function main() {
  // 读取输入
  let input = '';
  try {
    input = fs.readFileSync(0, 'utf-8'); // 读取 stdin
  } catch (err) {
    // 忽略错误
  }

  if (!input) {
    process.exit(0);
  }

  let event;
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
    path.join(projectDir, '.cc-power.json'),
    path.join(projectDir, 'config.json'),
  ];

  let config = null;
  let configPath = null;

  for (const candidate of configPaths) {
    try {
      const content = fs.readFileSync(candidate, 'utf-8');
      // 根据扩展名选择解析方式
      if (candidate.endsWith('.json')) {
        config = JSON.parse(content);
      } else {
        config = parseSimpleYaml(content);
      }
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

  // 信号目录 (使用全局路径以适配 MCP 的自动发现机制)
  const SIGNALS_DIR = path.join(process.env.HOME || '', '.cc-power', 'signals');

  // 创建信号目录
  fs.mkdirSync(SIGNALS_DIR, { recursive: true });

  // 写入注册信号文件
  const signalPath = path.join(SIGNALS_DIR, `register-${projectId}.json`);
  const signal = {
    type: 'register',
    projectId,
    provider: config.provider,
    config: config[config.provider] || {},
    timestamp: Date.now(),
    sessionId: event.sessionId,
    projectDirectory: projectDir,
  };

  fs.writeFileSync(signalPath, JSON.stringify(signal, null, 2));

  console.error(`Project ${projectId} registration signal written to ${signalPath}`);
  console.error(`Use 'cc-power-mcp' MCP tool 'register_project' to register: { project_id: "${projectId}", provider: "${config.provider}", config: {...} }`);
}

// 运行主函数
main().catch(error => {
  console.error('SessionStart hook error:', error);
  process.exit(1);
});