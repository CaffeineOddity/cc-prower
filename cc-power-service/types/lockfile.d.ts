declare module 'write-file-atomic' {
  export default function writeFileAtomic(
    filename: string,
    data: string | Buffer,
    options?: any
  ): Promise<void>;
}

declare module 'proper-lockfile' {
  export function lock(
    filePath: string,
    options?: {
      retries?: number;
      retryDelay?: number;
      stale?: number;
      onCompromised?: (err: Error) => void;
    }
  ): Promise<() => Promise<void>>;

  export function unlock(filePath: string): Promise<void>;
}