import * as fs from 'fs/promises';
import * as path from 'path';
import { getCacheDir } from './signals.js';

/**
 * 项目历史记录
 */
export interface ProjectHistory {
  projectId?: string;  // 可选：由 Provider 自动生成
  projectName?: string;  // 新增：项目名称
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
  projectId: string | null,
  projectPath: string,
  config: any,
  sessionName: string
): Promise<void> {
  const history = await readProjectHistory();

  // 使用 projectId 或 projectName 作为 key
  const key = projectId || (config.project_name?.replace(/[^a-zA-Z0-9_-]/g, '_') || path.basename(projectPath));

  history[key] = {
    projectId: projectId || undefined,
    projectName: config.project_name || path.basename(projectPath),
    projectPath,
    config,
    sessionName,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  await writeProjectHistory(history);
  console.log(`Project history recorded for ${key}`);
}

/**
 * 获取项目历史
 */
export async function getProjectHistory(projectId: string): Promise<ProjectHistory | null> {
  const history = await readProjectHistory();
  return history[projectId] || null;
}

/**
 * 根据 projectName 获取项目历史
 */
export async function getProjectHistoryByName(projectName: string): Promise<ProjectHistory | null> {
  const history = await readProjectHistory();
  for (const [key, entry] of Object.entries(history)) {
    if (entry.projectName === projectName || key === projectName) {
      return entry;
    }
  }
  return null;
}