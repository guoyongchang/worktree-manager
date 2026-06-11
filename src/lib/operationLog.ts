export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  operation: string;
  message: string;
  detail?: string;
}

let counter = 0;
const store = new Map<string, LogEntry[]>();
const lastReadIndex = new Map<string, number>();
const MAX_ENTRIES = 500;

export function addLog(
  projectPath: string,
  entry: Omit<LogEntry, 'id' | 'timestamp'>,
): void {
  const entries = store.get(projectPath) ?? [];
  entries.push({
    ...entry,
    id: `${Date.now()}-${counter++}`,
    timestamp: new Date(),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  store.set(projectPath, entries);
}

export function getLogs(projectPath: string): LogEntry[] {
  return store.get(projectPath) ?? [];
}

export function clearLogs(projectPath: string): void {
  store.delete(projectPath);
  lastReadIndex.delete(projectPath);
}

export function markAsRead(projectPath: string): void {
  const entries = store.get(projectPath) ?? [];
  lastReadIndex.set(projectPath, entries.length);
}

export function getUnreadErrorCount(projectPath: string): number {
  const entries = store.get(projectPath) ?? [];
  const readIdx = lastReadIndex.get(projectPath) ?? 0;
  return entries.slice(readIdx).filter((e) => e.level === 'error').length;
}
