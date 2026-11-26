export type ProjectGitActionKind =
  | 'sync'
  | 'pull'
  | 'push'
  | 'commit'
  | 'mergeTest'
  | 'mergeBase'
  | 'refresh'
  | 'switchBranch';

export interface ProjectGitQueueState {
  busy: boolean;
  activeAction: ProjectGitActionKind | null;
  queuedCount: number;
  startedAt: number | null;
  cancelling: boolean;
}

const IDLE_STATE: ProjectGitQueueState = Object.freeze({
  busy: false,
  activeAction: null,
  queuedCount: 0,
  startedAt: null,
  cancelling: false,
});

interface QueuedTask<T = unknown> {
  kind: ProjectGitActionKind;
  task: () => T | Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}
interface RunningTask {
  kind: ProjectGitActionKind;
  startedAt: number;
  cancelling: boolean;
}

interface ProjectQueueEntry {
  running: RunningTask | null;
  pending: QueuedTask[];
  snapshot: ProjectGitQueueState;
}

const queues = new Map<string, ProjectQueueEntry>();
const pathListeners = new Map<string, Set<() => void>>();
const globalListeners = new Set<() => void>();
let busyKeysSnapshot: ReadonlySet<string> = new Set();

export function normalizeGitProjectKey(projectPath: string): string {
  const normalized = projectPath.trim().replace(/\\/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.replace(/\/+$/, '');
  }
  return normalized;
}

function buildSnapshot(entry: ProjectQueueEntry | undefined): ProjectGitQueueState {
  if (!entry || (!entry.running && entry.pending.length === 0)) {
    return IDLE_STATE;
  }
  return {
    busy: true,
    activeAction: entry.running?.kind ?? null,
    queuedCount: entry.pending.length,
    startedAt: entry.running?.startedAt ?? null,
    cancelling: entry.running?.cancelling ?? false,
  };
}

function rebuildBusyKeys(): void {
  const next = new Set<string>();
  for (const [key, entry] of queues.entries()) {
    if (entry.running || entry.pending.length > 0) {
      next.add(key);
    }
  }
  busyKeysSnapshot = next;
}

function notify(key: string): void {
  const entry = queues.get(key);
  if (entry) {
    entry.snapshot = buildSnapshot(entry);
  }
  rebuildBusyKeys();
  const listeners = pathListeners.get(key);
  if (listeners) {
    for (const fn of [...listeners]) fn();
  }
  for (const fn of [...globalListeners]) fn();
}

function drainNext(key: string): void {
  const entry = queues.get(key);
  if (!entry) return;

  const next = entry.pending.shift();
  if (!next) {
    entry.running = null;
    queues.delete(key);
    notify(key);
    return;
  }

  entry.running = {
    kind: next.kind,
    startedAt: Date.now(),
    cancelling: false,
  };
  notify(key);

  let promise: Promise<unknown>;
  try {
    promise = Promise.resolve(next.task());
  } catch (err) {
    promise = Promise.reject(err);
  }

  promise.then(
    (value) => {
      drainNext(key);
      next.resolve(value);
    },
    (err) => {
      drainNext(key);
      next.reject(err);
    },
  );
}

/**
 * Serialize all mutating/refreshing Git actions for the same project path in strict FIFO order.
 * Different project paths execute independently in parallel.
 *
 * When the queue for `projectPath` is idle, `task()` starts synchronously on the calling turn
 * so button locking and progress indicators update immediately without an extra microtask delay.
 */
export function enqueueProjectGitAction<T>(
  projectPath: string,
  kind: ProjectGitActionKind,
  task: () => T | Promise<T>,
): Promise<T> {
  const key = normalizeGitProjectKey(projectPath);
  const existing = queues.get(key);

  if (!existing || (!existing.running && existing.pending.length === 0)) {
    const entry: ProjectQueueEntry = {
      running: {
        kind,
        startedAt: Date.now(),
        cancelling: false,
      },
      pending: [],
      snapshot: IDLE_STATE,
    };
    queues.set(key, entry);
    notify(key);

    let promise: Promise<T>;
    try {
      promise = Promise.resolve(task());
    } catch (err) {
      promise = Promise.reject(err);
    }

    return new Promise<T>((resolve, reject) => {
      promise.then(
        (value) => {
          drainNext(key);
          resolve(value);
        },
        (err) => {
          drainNext(key);
          reject(err);
        },
      );
    });
  }

  return new Promise<T>((resolve, reject) => {
    existing.pending.push({
      kind,
      task: task as () => unknown | Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    notify(key);
  });
}

export function markProjectGitCancelling(projectPath: string, cancelling = true): void {
  const key = normalizeGitProjectKey(projectPath);
  const entry = queues.get(key);
  if (!entry?.running || entry.running.cancelling === cancelling) return;
  entry.running = { ...entry.running, cancelling };
  notify(key);
}

export function getProjectGitQueueState(projectPath: string): ProjectGitQueueState {
  const key = normalizeGitProjectKey(projectPath);
  return queues.get(key)?.snapshot ?? IDLE_STATE;
}

export function isProjectGitBusy(projectPath: string): boolean {
  return getProjectGitQueueState(projectPath).busy;
}

export function getBusyGitProjectKeys(): ReadonlySet<string> {
  return busyKeysSnapshot;
}

export function subscribeProjectGitQueue(projectPath: string, listener: () => void): () => void {
  const key = normalizeGitProjectKey(projectPath);
  let listeners = pathListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    pathListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = pathListeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      pathListeners.delete(key);
    }
  };
}

export function subscribeAnyProjectGitQueue(listener: () => void): () => void {
  globalListeners.add(listener);
  return () => {
    globalListeners.delete(listener);
  };
}

export function resetGitActionQueuesForTest(): void {
  queues.clear();
  busyKeysSnapshot = new Set();
  for (const listeners of pathListeners.values()) {
    for (const fn of [...listeners]) fn();
  }
  for (const fn of [...globalListeners]) fn();
}
