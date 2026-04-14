import { beforeEach, describe, expect, it } from 'vitest';

// 每次 import 都是同一单例，用 clearLogs 重置
import {
  addLog,
  clearLogs,
  getLogs,
  getUnreadErrorCount,
  markAsRead,
} from './operationLog';

const PATH = '/test/project';

beforeEach(() => {
  clearLogs(PATH);
});

describe('addLog / getLogs', () => {
  it('stores entry with auto id and timestamp', () => {
    addLog(PATH, { level: 'info', operation: 'refresh', message: 'ok' });
    const logs = getLogs(PATH);
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBeTruthy();
    expect(logs[0].timestamp).toBeInstanceOf(Date);
    expect(logs[0].level).toBe('info');
    expect(logs[0].operation).toBe('refresh');
  });

  it('returns empty array for unknown path', () => {
    expect(getLogs('/unknown')).toEqual([]);
  });

  it('preserves order of insertion', () => {
    addLog(PATH, { level: 'info', operation: 'a', message: '1' });
    addLog(PATH, { level: 'error', operation: 'b', message: '2' });
    const logs = getLogs(PATH);
    expect(logs[0].operation).toBe('a');
    expect(logs[1].operation).toBe('b');
  });
});

describe('getUnreadErrorCount / markAsRead', () => {
  it('errors before any markAsRead are all unread', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail' });
    addLog(PATH, { level: 'error', operation: 'sync', message: 'fail2' });
    expect(getUnreadErrorCount(PATH)).toBe(2);
  });

  it('info/success/warn do not count as unread errors', () => {
    addLog(PATH, { level: 'info', operation: 'refresh', message: 'ok' });
    addLog(PATH, { level: 'success', operation: 'push', message: 'done' });
    expect(getUnreadErrorCount(PATH)).toBe(0);
  });

  it('markAsRead clears unread count', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail' });
    markAsRead(PATH);
    expect(getUnreadErrorCount(PATH)).toBe(0);
  });

  it('errors added after markAsRead count as new unread', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail 1' });
    markAsRead(PATH);
    addLog(PATH, { level: 'error', operation: 'sync', message: 'fail 2' });
    expect(getUnreadErrorCount(PATH)).toBe(1);
  });
});

describe('clearLogs', () => {
  it('removes all entries', () => {
    addLog(PATH, { level: 'info', operation: 'refresh', message: 'x' });
    clearLogs(PATH);
    expect(getLogs(PATH)).toHaveLength(0);
  });

  it('resets unread error count', () => {
    addLog(PATH, { level: 'error', operation: 'push', message: 'fail' });
    clearLogs(PATH);
    expect(getUnreadErrorCount(PATH)).toBe(0);
  });
});
