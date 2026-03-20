import * as fs from 'fs/promises';
import * as path from 'path';

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
  provider: string;
  config: any;
}

/**
 * 注销信号
 */
export interface UnregisterSignal {
  type: 'unregister';
  projectId?: string;  // 可选
  projectName?: string;  // 新增：项目名称
  timestamp: number;
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
  projectId: string | null,
  tmuxSession: string,
  projectDir: string,
  projectConfig?: any
): Promise<void> {
  const signalsDir = getSignalsDir();
  await fs.mkdir(signalsDir, { recursive: true });

  // 从配置中获取项目名称
  const projectName = projectConfig?.project_name || path.basename(projectDir);

  // 如果没有提供 projectId，使用 projectName 作为文件名的一部分
  const signalFileId = projectId || projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const signalPath = path.join(signalsDir, `register-${signalFileId}.json`);

  const signal: RegisterSignal = {
    type: 'register',
    projectId: projectId || undefined,
    projectName,
    tmuxPane: `${tmuxSession}:0`,
    timestamp: Date.now(),
    projectDirectory: projectDir,
    provider: projectConfig?.provider?.name || projectConfig?.provider || 'unknown',
    config: projectConfig || {},
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectName} registered with session ${tmuxSession}`);
}

/**
 * 创建注销信号文件
 */
export async function createUnregisterSignal(projectId: string | null, projectName?: string): Promise<void> {
  const signalsDir = getSignalsDir();
  await fs.mkdir(signalsDir, { recursive: true });

  // 如果没有提供 projectId，使用 projectName 作为文件名的一部分
  const signalFileId = projectId || (projectName?.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown');
  const signalPath = path.join(signalsDir, `unregister-${signalFileId}.json`);

  const signal: UnregisterSignal = {
    type: 'unregister',
    projectId: projectId || undefined,
    projectName,
    timestamp: Date.now(),
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectName || projectId} unregistered`);
}