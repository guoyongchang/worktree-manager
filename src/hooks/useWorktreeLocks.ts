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
    if (!isTauri() && currentWorkspacePath) {
      const wsManager = getWebSocketManager();
      wsManager.subscribeLocks(currentWorkspacePath, updateLocksIfChanged);
      refreshLockedWorktrees();
      return () => { wsManager.unsubscribeLocks(); };
    } else {
      refreshLockedWorktrees();
      const interval = setInterval(refreshLockedWorktrees, 3000);
      return () => clearInterval(interval);
    }
  }, [refreshLockedWorktrees, currentWorkspacePath, updateLocksIfChanged]);

  return {
    lockedWorktrees,
    refreshLockedWorktrees,
  };
}
