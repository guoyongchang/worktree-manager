import { useState, useEffect, useCallback } from 'react';
import { isTauri, callBackend, getSessionId, clearSessionId, authenticate } from '../lib/backend';

export interface UseBrowserAuthReturn {
  browserAuthenticated: boolean;
  browserLoginPassword: string;
  setBrowserLoginPassword: (value: string) => void;
  browserLoginError: string | null;
  browserLoggingIn: boolean;
  handleBrowserLogin: () => Promise<void>;
}

export function useBrowserAuth(): UseBrowserAuthReturn {
  const [browserAuthenticated, setBrowserAuthenticated] = useState(isTauri());
  const [browserLoginPassword, setBrowserLoginPassword] = useState('');
  const [browserLoginError, setBrowserLoginError] = useState<string | null>(null);
  const [browserLoggingIn, setBrowserLoggingIn] = useState(false);

  // Validate stored session on startup (avoids re-auth on refresh)
  useEffect(() => {
    if (isTauri()) return;
    const sid = getSessionId();
    if (!sid) return;
    callBackend('list_workspaces')
      .then(() => setBrowserAuthenticated(true))
      .catch(() => {
        if (getSessionId() === sid) {
          clearSessionId();
        }
      });
  }, []);

  const handleBrowserLogin = useCallback(async () => {
    if (!browserLoginPassword.trim()) return;
    setBrowserLoggingIn(true);
    setBrowserLoginError(null);
    try {
      await authenticate(browserLoginPassword.trim());
      setBrowserAuthenticated(true);
      setBrowserLoginPassword('');
    } catch (e) {
      setBrowserLoginError(String(e));
    } finally {
      setBrowserLoggingIn(false);
    }
  }, [browserLoginPassword]);

  return {
    browserAuthenticated,
    browserLoginPassword,
    setBrowserLoginPassword,
    browserLoginError,
    browserLoggingIn,
    handleBrowserLogin,
  };
}
