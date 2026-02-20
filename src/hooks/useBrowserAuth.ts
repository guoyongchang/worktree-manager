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
  // Also checks URL ?pwd= parameter for auto-authentication via shared link
  useEffect(() => {
    if (isTauri()) return;

    // Check URL ?pwd= parameter for auto-authentication
    const params = new URLSearchParams(window.location.search);
    const urlPwd = params.get('pwd');
    if (urlPwd) {
      // Remove password from URL to avoid leaking to browser history
      params.delete('pwd');
      const cleanUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);

      authenticate(urlPwd)
        .then(() => {
          // Full page reload to reset all singletons (WebSocket, etc.) with new session ID
          window.location.replace(cleanUrl);
        })
        .catch(() => { /* wrong password, show normal login page */ });
      return;
    }

    // Validate existing session from sessionStorage
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
      // Full page reload to reset all singletons (WebSocket, etc.) with new session ID
      window.location.replace('/');
      return; // Page is about to reload, skip cleanup
    } catch (e) {
      setBrowserLoginError(String(e));
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
