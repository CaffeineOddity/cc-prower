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
  projectId: string;
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
  projectId: string;
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
  projectId: string,
  tmuxSession: string,
  projectDir: string,
  projectConfig?: any
): Promise<void> {
  const signalsDir = getSignalsDir();
  await fs.mkdir(signalsDir, { recursive: true });

  const signalPath = path.join(signalsDir, `register-${projectId}.json`);

  const signal: RegisterSignal = {
    type: 'register',
    projectId,
    tmuxPane: `${tmuxSession}:0`,
    timestamp: Date.now(),
    projectDirectory: projectDir,
    provider: projectConfig?.provider || 'unknown',
    config: projectConfig || {},
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectId} registered with session ${tmuxSession}`);
}

/**
 * 创建注销信号文件
 */
export async function createUnregisterSignal(projectId: string): Promise<void> {
  const signalsDir = getSignalsDir();
  await fs.mkdir(signalsDir, { recursive: true });

  const signalPath = path.join(signalsDir, `unregister-${projectId}.json`);

  const signal: UnregisterSignal = {
    type: 'unregister',
    projectId,
    timestamp: Date.now(),
  };

  await fs.writeFile(signalPath, JSON.stringify(signal, null, 2));
  console.log(`Signal sent: Project ${projectId} unregistered`);
}