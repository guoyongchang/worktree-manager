import { useState, useEffect, useCallback } from 'react';
import { callBackend } from '../lib/backend';
import type { MainWorkspaceOccupation, DeployToMainResult } from '../types';

export interface UseMainOccupationReturn {
  occupation: MainWorkspaceOccupation | null;
  deploying: boolean;
  exiting: boolean;
  deployToMain: (worktreeName: string) => Promise<DeployToMainResult | null>;
  exitOccupation: (force?: boolean) => Promise<boolean>;
  refreshOccupation: () => Promise<void>;
}

export function useMainOccupation(
  currentWorkspacePath: string | undefined,
): UseMainOccupationReturn {
  const [occupation, setOccupation] = useState<MainWorkspaceOccupation | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [exiting, setExiting] = useState(false);

  const refreshOccupation = useCallback(async () => {
    if (!currentWorkspacePath) return;
    try {
      const result = await callBackend('get_main_occupation', {}) as MainWorkspaceOccupation | null;
      setOccupation(prev => {
        const next = JSON.stringify(result);
        return next === JSON.stringify(prev) ? prev : result;
      });
    } catch {
      // ignore
    }
  }, [currentWorkspacePath]);

  const deployToMain = useCallback(async (worktreeName: string): Promise<DeployToMainResult | null> => {
    setDeploying(true);
    try {
      const result = await callBackend('deploy_to_main', { worktreeName }) as DeployToMainResult;
      await refreshOccupation();
      return result;
    } finally {
      setDeploying(false);
    }
  }, [refreshOccupation]);

  const exitOccupation = useCallback(async (force: boolean = false): Promise<boolean> => {
    setExiting(true);
    try {
      await callBackend('exit_main_occupation', { force });
      await refreshOccupation();
      return true;
    } finally {
      setExiting(false);
    }
  }, [refreshOccupation]);

  useEffect(() => {
    refreshOccupation();
    const interval = setInterval(refreshOccupation, 5000);
    return () => clearInterval(interval);
  }, [refreshOccupation]);

  return {
    occupation,
    deploying,
    exiting,
    deployToMain,
    exitOccupation,
    refreshOccupation,
  };
}
