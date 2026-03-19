import * as fs from 'fs/promises';
import * as path from 'path';
import { getCacheDir } from './signals.js';

/**
 * 项目历史记录
 */
export interface ProjectHistory {
  projectId: string;
  projectPath: string;
  config: any;
  sessionName: string;
  createdAt: number;
  lastUsed: number;
}

/**
 * 获取项目历史文件路径
 */
export function getProjectHistoryPath(): string {
  return path.join(getCacheDir(), 'project_history.json');
}

/**
 * 读取项目历史
 */
export async function readProjectHistory(): Promise<Record<string, ProjectHistory>> {
  const historyPath = getProjectHistoryPath();

  try {
    const content = await fs.readFile(historyPath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * 写入项目历史
 */
export async function writeProjectHistory(history: Record<string, ProjectHistory>): Promise<void> {
  const historyPath = getProjectHistoryPath();

  // Import atomic write
  const { default: writeFileAtomic } = await import('write-file-atomic');

  // Acquire lock
  const { lock, unlock } = await import('proper-lockfile');

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await lock(historyPath, {
      retries: 5,
      retryDelay: 100,
      stale: 30000,
      onCompromised: (err) => console.error('Lock compromised:', err),
    });

    await writeFileAtomic(historyPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Failed to write project history:', error);
    throw error;
  } finally {
    if (releaseLock) {
      try {
        await releaseLock();
      } catch (lockError) {
        console.error('Failed to release lock:', lockError);
      }
    }
  }
}

/**
 * 记录项目历史
 */
export async function recordProjectHistory(
  projectId: string,
  projectPath: string,
  config: any,
  sessionName: string
): Promise<void> {
  const history = await readProjectHistory();

  history[projectId] = {
    projectId,
    projectPath,
    config,
    sessionName,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  await writeProjectHistory(history);
  console.log(`Project history recorded for ${projectId}`);
}

/**
 * 获取项目历史
 */
export async function getProjectHistory(projectId: string): Promise<ProjectHistory | null> {
  const history = await readProjectHistory();
  return history[projectId] || null;
}