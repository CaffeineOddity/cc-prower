import * as fs from 'fs/promises';
import * as path from 'path';
import { TemplateProviderConfig } from '../types';
import { get_project_id } from '../types/provider.config.js';
/**
 * 信号类型
 */
export type SignalType = 'register' | 'unregister';

/**
 * 注册信号
 */
export interface RegisterSignal {
  type: 'register';
  projectId?: string;  // 可选：由 Provider 自动生成
  projectName?: string;  // 新增：项目名称
  tmuxPane: string;
  timestamp: number;
  projectDirectory: string;
  config: TemplateProviderConfig;
}

/**
 * 注销信号
 */
export interface UnregisterSignal {
  type: 'unregister';
  projectId?: string;  // 可选
  projectName?: string;  // 新增：项目名称
  timestamp: number;
  config: TemplateProviderConfig;
}

/**
 * 获取信号目录路径
 */
export function getSignalsDir(): string {
  return path.join(process.env.HOME || '', '.cc-power', 'signals');
}

/**
 * 获取 hooks 目录路径
 */
export function getHooksDir(): string {
  return path.join(process.env.HOME || '', '.cc-power', 'hooks');
}

/**
 * 获取缓存目录路径
 */
export function getCacheDir(): string {
  return path.join(process.env.HOME || '', '.cc-power', 'cache');
}

/**
 * 创建注册信号文件
 */
export async function createRegisterSignal(
  tmuxSession: string,
  projectDir: string,
  projectConfig?: TemplateProviderConfig
): Promise<void> {
  const signalsDir = getSignalsDir();
  await fs.mkdir(signalsDir, { recursive: true });

  if (!projectConfig) {
    throw new Error('Project config is required to create a register signal');
  }
  
  // 从配置中获取项目名称
  const projectName = projectConfig?.project_name;
  const projectId = get_project_id(projectConfig);
  // 如果没有提供 projectId，使用 projectName 作为文件名的一部分
//   const signalFileId = projectId ;
  const signalPath = path.join(signalsDir, `register-${projectName}.json`);

  const signal: RegisterSignal = {
    type: 'register',
    projectId: projectId || 'unknown',
    projectName,
    tmuxPane: `${tmuxSession}:0`,  // Default to window 0 (first window created by tmux)
    timestamp: Date.now(),
    projectDirectory: projectDir,
    config: projectConfig || {},
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectName} registered with session ${tmuxSession}`);
}

/**
 * 创建注销信号文件
 */
export async function createUnregisterSignal(projectConfig: TemplateProviderConfig): Promise<void> {
  const signalsDir = getSignalsDir();
  await fs.mkdir(signalsDir, { recursive: true });

  if (!projectConfig) {
    throw new Error('Project config is required to create a register signal');
  }
  
  // 从配置中获取项目名称
  const projectName = projectConfig?.project_name;
  const projectId = get_project_id(projectConfig);

  // 如果没有提供 projectId，使用 projectName 作为文件名的一部分
//   const signalFileId = projectId;
  const signalPath = path.join(signalsDir, `unregister-${projectName}.json`);

  const signal: UnregisterSignal = {
    type: 'unregister',
    projectId: projectId || 'unknown',
    projectName,
    timestamp: Date.now(),
    config: projectConfig || {},
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectName || projectId} unregistered`);
}