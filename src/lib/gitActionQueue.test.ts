import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueProjectGitAction,
  getBusyGitProjectKeys,
  getProjectGitQueueState,
  markProjectGitCancelling,
  resetGitActionQueuesForTest,
  subscribeProjectGitQueue,
} from './gitActionQueue';

describe('gitActionQueue', () => {
  afterEach(() => {
    resetGitActionQueuesForTest();
  });

  it('executes actions on the same project strictly in FIFO order (pull -> mergeTest -> mergeBase)', async () => {
    const events: string[] = [];
    let resolvePull: () => void = () => {};
    let resolveMergeTest: () => void = () => {};
    let resolveMergeBase: () => void = () => {};

    const pPull = enqueueProjectGitAction('/ws/wt-1/projects/api/', 'pull', () => {
      events.push('pull:start');
      return new Promise<string>((resolve) => {
        resolvePull = () => {
          events.push('pull:end');
          resolve('pulled');
        };
      });
    });

    // Different trailing slash / Windows separator must normalize to the same project queue.
    const pMergeTest = enqueueProjectGitAction('\\ws\\wt-1\\projects\\api', 'mergeTest', () => {
      events.push('mergeTest:start');
      return new Promise<string>((resolve) => {
        resolveMergeTest = () => {
          events.push('mergeTest:end');
          resolve('merged-test');
        };
      });
    });

    const pMergeBase = enqueueProjectGitAction('/ws/wt-1/projects/api', 'mergeBase', () => {
      events.push('mergeBase:start');
      return new Promise<string>((resolve) => {
        resolveMergeBase = () => {
          events.push('mergeBase:end');
          resolve('merged-base');
        };
      });
    });

    expect(events).toEqual(['pull:start']);
    expect(getProjectGitQueueState('/ws/wt-1/projects/api')).toMatchObject({
      busy: true,
      activeAction: 'pull',
      queuedCount: 2,
      cancelling: false,
    });
    expect(getBusyGitProjectKeys().has('/ws/wt-1/projects/api')).toBe(true);

    resolvePull();
    expect(await pPull).toBe('pulled');
    expect(events).toEqual(['pull:start', 'pull:end', 'mergeTest:start']);
    expect(getProjectGitQueueState('/ws/wt-1/projects/api')).toMatchObject({
      busy: true,
      activeAction: 'mergeTest',
      queuedCount: 1,
    });

    resolveMergeTest();
    expect(await pMergeTest).toBe('merged-test');
    expect(events).toEqual(['pull:start', 'pull:end', 'mergeTest:start', 'mergeTest:end', 'mergeBase:start']);
    expect(getProjectGitQueueState('/ws/wt-1/projects/api')).toMatchObject({
      busy: true,
      activeAction: 'mergeBase',
      queuedCount: 0,
    });

    resolveMergeBase();
    expect(await pMergeBase).toBe('merged-base');
    expect(events).toEqual([
      'pull:start',
      'pull:end',
      'mergeTest:start',
      'mergeTest:end',
      'mergeBase:start',
      'mergeBase:end',
    ]);
    expect(getProjectGitQueueState('/ws/wt-1/projects/api').busy).toBe(false);
    expect(getBusyGitProjectKeys().size).toBe(0);
  });

  it('continues draining queued tasks even if an earlier task rejects, and runs distinct projects in parallel', async () => {
    const events: string[] = [];
    let releaseA: () => void = () => {};

    const pA1 = enqueueProjectGitAction('/ws/proj-a', 'pull', () => {
      events.push('a1:start');
      return new Promise<void>((_, reject) => {
        releaseA = () => reject(new Error('network error'));
      });
    });

    const pA2 = enqueueProjectGitAction('/ws/proj-a', 'mergeTest', async () => {
      events.push('a2:start');
      return 'ok';
    });

    const pB = enqueueProjectGitAction('/ws/proj-b', 'pull', async () => {
      events.push('b:start');
      return 'b-ok';
    });

    expect(events).toEqual(['a1:start', 'b:start']);
    expect(await pB).toBe('b-ok');

    releaseA();
    await expect(pA1).rejects.toThrow('network error');
    expect(await pA2).toBe('ok');
    expect(events).toEqual(['a1:start', 'b:start', 'a2:start']);
  });

  it('notifies subscribers when cancelling flag is updated', async () => {
    const listener = vi.fn();
    const unsub = subscribeProjectGitQueue('/ws/proj-c', listener);
    let resolveOp: () => void = () => {};

    const p = enqueueProjectGitAction('/ws/proj-c', 'mergeTest', () => new Promise<void>((r) => { resolveOp = r; }));
    expect(getProjectGitQueueState('/ws/proj-c').cancelling).toBe(false);

    markProjectGitCancelling('/ws/proj-c', true);
    expect(getProjectGitQueueState('/ws/proj-c').cancelling).toBe(true);
    expect(listener).toHaveBeenCalled();

    resolveOp();
    await p;
    expect(getProjectGitQueueState('/ws/proj-c').busy).toBe(false);
    unsub();
  });
});
