import { useState, useEffect, useCallback } from 'react';
import { isTauri, callBackend, getSessionId, clearSessionId, authenticate } from '../lib/backend';
import { ensureTunnelRoute } from '../lib/tunnelRoute';

export interface UseBrowserAuthReturn {
  browserAuthenticated: boolean;
  browserLoginPassword: string;
  setBrowserLoginPassword: (value: string) => void;
  browserLoginError: string | null;
  browserLoggingIn: boolean;
  browserRouteSelectionPending: boolean;
  handleBrowserLogin: () => Promise<void>;
  completeBrowserRouteSelection: () => void;
  cancelBrowserRouteSelection: () => void;
}

async function prepareTunnelRoute(): Promise<void> {
  if (isTauri()) return;
  await ensureTunnelRoute().catch(() => null);
}

export function useBrowserAuth(): UseBrowserAuthReturn {
  const [browserAuthenticated, setBrowserAuthenticated] = useState(isTauri());
  const [browserLoginPassword, setBrowserLoginPassword] = useState('');
  const [browserLoginError, setBrowserLoginError] = useState<string | null>(null);
  const [browserLoggingIn, setBrowserLoggingIn] = useState(false);
  const [browserRouteSelectionPending, setBrowserRouteSelectionPending] = useState(false);

  // Validate stored session on startup (avoids re-auth on refresh)
  // Also checks URL params/fragments for auto-authentication
  useEffect(() => {
    if (isTauri()) return;

    // Older links may still carry `session_id`; it is no longer trusted for auto-auth.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('session_id')) {
      urlParams.delete('session_id');
      const cleanSearch = urlParams.toString();
      const cleanUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '');
      window.history.replaceState({}, '', cleanUrl);
    }

    // Check URL #pwd= fragment for auto-authentication via shared link
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
        .then(async () => {
          await prepareTunnelRoute();
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
    let cancelled = false;
    const sid = getSessionId();
    if (!sid) return;

    const validateStoredSession = async () => {
      try {
        await prepareTunnelRoute();
        await callBackend('list_workspaces');
        if (!cancelled) setBrowserAuthenticated(true);
      } catch {
        // Session invalid or expired, clear it and show login page
        if (!cancelled && getSessionId() === sid) {
          clearSessionId();
          setBrowserAuthenticated(false);
        }
      }
    };
    void validateStoredSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleBrowserLogin = useCallback(async () => {
    if (!browserLoginPassword.trim()) return;
    setBrowserLoggingIn(true);
    setBrowserLoginError(null);
    try {
      await authenticate(browserLoginPassword.trim());
      setBrowserRouteSelectionPending(true);
      setBrowserLoggingIn(false);
      return;
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

  const completeBrowserRouteSelection = useCallback(() => {
    setBrowserRouteSelectionPending(false);
    setBrowserAuthenticated(true);
  }, []);

  const cancelBrowserRouteSelection = useCallback(() => {
    clearSessionId();
    setBrowserRouteSelectionPending(false);
    setBrowserAuthenticated(false);
  }, []);

  return {
    browserAuthenticated,
    browserLoginPassword,
    setBrowserLoginPassword,
    browserLoginError,
    browserLoggingIn,
    browserRouteSelectionPending,
    handleBrowserLogin,
    completeBrowserRouteSelection,
    cancelBrowserRouteSelection,
  };
}
