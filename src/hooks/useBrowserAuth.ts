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
  // Also checks URL #pwd= fragment for auto-authentication via shared link
  useEffect(() => {
    if (isTauri()) return;

    // Check URL #pwd= fragment for auto-authentication
    const hash = window.location.hash;
    const urlPwd = hash.startsWith('#pwd=')
      ? decodeURIComponent(hash.substring(5).split('&')[0])
      : null;
    if (urlPwd) {
      // Remove password from URL fragment
      window.history.replaceState(
        {},
        '',
        window.location.pathname + window.location.search
      );

      authenticate(urlPwd)
        .then(() => {
          // Full page reload to reset all singletons (WebSocket, etc.) with new session ID
          window.location.replace(
            window.location.pathname + window.location.search
          );
        })
        .catch(() => {
          /* wrong password, show normal login page */
        });
      return;
    }

    // Validate existing session from sessionStorage
    const sid = getSessionId();
    if (!sid) return;
    callBackend('list_workspaces')
      .then(() => setBrowserAuthenticated(true))
      .catch(() => {
        // Session invalid or expired, clear it and show login page
        if (getSessionId() === sid) {
          clearSessionId();
          setBrowserAuthenticated(false);
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
      // Preserve the current pathname (e.g. /t/{subdomain}/) so tunnel proxy paths are kept
      window.location.replace(window.location.pathname || '/');
      return; // Page is about to reload, skip cleanup
    } catch (e) {
      const errorMsg = String(e);
      // Provide user-friendly error messages
      if (errorMsg.includes('密码错误') || errorMsg.includes('Unauthorized') || errorMsg.includes('401')) {
        setBrowserLoginError('密码错误，请重试');
      } else if (errorMsg.includes('expired') || errorMsg.includes('过期')) {
        setBrowserLoginError('会话已过期，请重新登录');
      } else if (errorMsg.includes('Challenge request failed')) {
        setBrowserLoginError('无法连接到服务器，请检查分享是否已启动');
      } else {
        setBrowserLoginError(errorMsg);
      }
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
