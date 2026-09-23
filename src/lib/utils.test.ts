import { describe, expect, it } from 'vitest';

import { GIT_BATCH_CONCURRENCY, GIT_FETCH_CONCURRENCY, basename, mapWithConcurrency, normalizePath, uniqueFetchProjectPaths } from './utils';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` tasks at once and keeps input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = [12, 2, 8, 4, 6, 0];

    const results = await mapWithConcurrency(items, 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(n);
      inFlight -= 1;
      return n * 10;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([120, 20, 80, 40, 60, 0]);
  });

  it('captures rejections per item without aborting the batch', async () => {
    const results = await mapWithConcurrency(['ok', 'boom', 'ok2'], 3, async (v) => {
      if (v === 'boom') throw new Error('failed: ' + v);
      return v.toUpperCase();
    });

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'OK' });
    expect(results[1].status).toBe('rejected');
    expect(String((results[1] as PromiseRejectedResult).reason)).toContain('failed: boom');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'OK2' });
  });

  it('handles empty input and a non-positive limit', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    const results = await mapWithConcurrency([1, 2, 3], 0, async (n) => n + 1);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([2, 3, 4]);
  });

  it('exposes a small default fan-out for git batches', () => {
    expect(GIT_BATCH_CONCURRENCY).toBe(2);
    expect(GIT_FETCH_CONCURRENCY).toBe(GIT_BATCH_CONCURRENCY);
  });
});

describe('uniqueFetchProjectPaths', () => {
  it('keeps one path per project and prefers the main workspace checkout', () => {
    const paths = uniqueFetchProjectPaths(
      [
        {
          is_archived: false,
          projects: [
            { name: 'javascmapi', path: '/ws/worktrees/a/projects/javascmapi' },
            { name: 'webapp', path: '/ws/worktrees/a/projects/webapp' },
          ],
        },
        {
          is_archived: false,
          projects: [{ name: 'javascmapi', path: '/ws/worktrees/b/projects/javascmapi' }],
        },
        {
          is_archived: true,
          projects: [{ name: 'only-archived', path: '/ws/worktrees/old/projects/only-archived' }],
        },
      ],
      {
        projects: [{ name: 'javascmapi', path: '/ws/projects/javascmapi' }],
      },
    );

    expect(paths).toEqual(['/ws/projects/javascmapi', '/ws/worktrees/a/projects/webapp']);
  });

  it('falls back to the first live worktree when main workspace is missing', () => {
    const paths = uniqueFetchProjectPaths(
      [
        {
          is_archived: true,
          projects: [{ name: 'webapp', path: '/ws/worktrees/old/projects/webapp' }],
        },
        {
          is_archived: false,
          projects: [{ name: 'webapp', path: '/ws/worktrees/a/projects/webapp' }],
        },
      ],
      null,
    );

    expect(paths).toEqual(['/ws/worktrees/a/projects/webapp']);
  });
});

describe('path helpers', () => {
  it('normalizes mixed separators and extracts basename', () => {
    expect(normalizePath('C:\\a\\\\b//c')).toBe('C:/a/b/c');
    expect(basename('E:\\ai-code-ws\\clp\\worktrees\\ERP-1\\projects\\erp.fin.net')).toBe('erp.fin.net');
    expect(basename('/tmp/x/')).toBe('x');
  });
});
