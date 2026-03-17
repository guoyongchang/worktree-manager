import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../lib/backend';
import { getWebSocketManager } from '../lib/websocket';

export interface UseWorktreeLocksReturn {
  lockedWorktrees: Record<string, string>;
  refreshLockedWorktrees: () => Promise<void>;
}

export function useWorktreeLocks(
  currentWorkspacePath: string | undefined,
  getLockedWorktreesFn: (workspacePath: string) => Promise<Record<string, string>>,
): UseWorktreeLocksReturn {
  const [lockedWorktrees, setLockedWorktrees] = useState<Record<string, string>>({});

  const updateLocksIfChanged = useCallback((locks: Record<string, string>) => {
    setLockedWorktrees(prev => {
      const next = JSON.stringify(locks);
      return next === JSON.stringify(prev) ? prev : locks;
    });
  }, []);

  const refreshLockedWorktrees = useCallback(async () => {
    if (!currentWorkspacePath) return;
    try {
      const locks = await getLockedWorktreesFn(currentWorkspacePath);
      updateLocksIfChanged(locks);
    } catch {
      // ignore
    }
  }, [currentWorkspacePath, getLockedWorktreesFn, updateLocksIfChanged]);

  useEffect(() => {
    if (!currentWorkspacePath) return;

    if (!isTauri()) {
      const wsManager = getWebSocketManager();
      wsManager.subscribeLocks(currentWorkspacePath, updateLocksIfChanged);
      refreshLockedWorktrees();
      return () => { wsManager.unsubscribeLocks(); };
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    refreshLockedWorktrees();

    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<{
          workspacePath?: string;
          locks?: Record<string, string>;
        }>('lock-state-update', (event) => {
          if (cancelled) return;
          const payload = event.payload;
          if (!payload || payload.workspacePath !== currentWorkspacePath || !payload.locks) {
            return;
          }
          updateLocksIfChanged(payload.locks);
        });
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
          // Reconcile any lock changes that landed while the desktop listener was attaching.
          void refreshLockedWorktrees();
        }
      } catch {
        if (cancelled) return;
        const interval = setInterval(refreshLockedWorktrees, 3000);
        unlisten = () => clearInterval(interval);
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refreshLockedWorktrees, currentWorkspacePath, updateLocksIfChanged]);

  return {
    lockedWorktrees,
    refreshLockedWorktrees,
  };
}
