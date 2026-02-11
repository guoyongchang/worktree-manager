/**
 * Backend API adapter layer.
 *
 * Detects whether the app is running inside Tauri (desktop) or a plain browser.
 * - Tauri mode  → delegates to `invoke()` from `@tauri-apps/api/core`
 * - Browser mode → sends HTTP POST to `/api/{command}` with JSON body
 *
 * A session ID is used in browser mode to simulate Tauri's per-window state.
 */

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

// ---------------------------------------------------------------------------
// Session management (browser mode)
// ---------------------------------------------------------------------------

let _sessionId: string | null = null;

export function getSessionId(): string {
  if (!_sessionId) {
    // Try to restore from sessionStorage (survives page refresh)
    _sessionId = sessionStorage.getItem('wm_session_id');
    if (!_sessionId) {
      _sessionId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('wm_session_id', _sessionId);
    }
  }
  return _sessionId;
}

// ---------------------------------------------------------------------------
// HTTP base URL (browser mode)
// ---------------------------------------------------------------------------

/** In dev mode Vite proxies /api to the Rust server; in prod the same origin serves both. */
function getApiBase(): string {
  return '/api';
}

// ---------------------------------------------------------------------------
// Core invoke adapter
// ---------------------------------------------------------------------------

export async function callBackend<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }

  const res = await fetch(`${getApiBase()}/${command}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': getSessionId(),
    },
    body: JSON.stringify(args ?? {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  // Some commands return empty 204
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Tauri plugin shims for browser mode
// ---------------------------------------------------------------------------

/** Open a directory picker – falls back to a prompt in browser mode. */
export async function openDirectoryDialog(title: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false, title });
    if (selected && typeof selected === 'string') return selected;
    return null;
  }
  // Browser fallback: prompt for path
  const path = window.prompt(title + '\n\n请输入目录路径：');
  return path || null;
}

/** Get the current window label. */
export async function getWindowLabel(): Promise<string> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow().label;
  }
  return getSessionId();
}

/** Set the native window title (no-op in browser). */
export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setTitle(title);
    } catch {
      // ignore
    }
  }
}

/** Get the app version. */
export async function getAppVersion(): Promise<string> {
  if (isTauri()) {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  }
  // In browser mode, fetch from backend
  try {
    return await callBackend<string>('get_app_version');
  } catch {
    return 'web';
  }
}

/** Check if this is the "main" window. */
export async function isMainWindow(): Promise<boolean> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow().label === 'main';
  }
  // In browser mode, treat first session as main
  return true;
}

// ---------------------------------------------------------------------------
// Sharing API (desktop controls the HTTP server lifecycle)
// ---------------------------------------------------------------------------

export interface ShareState {
  active: boolean;
  url?: string;
  workspace_path?: string;
}

export interface ShareInfo {
  workspace_name: string;
  workspace_path: string;
}

/** Start sharing the current workspace with a password. Returns the share URL. */
export async function startSharing(port: number, password: string): Promise<string> {
  return callBackend<string>('start_sharing', { port, password });
}

/** Stop sharing (shuts down the HTTP server). */
export async function stopSharing(): Promise<void> {
  return callBackend<void>('stop_sharing');
}

/** Get the current share state. */
export async function getShareState(): Promise<ShareState> {
  return callBackend<ShareState>('get_share_state');
}

/** Update the share password while sharing is active. */
export async function updateSharePassword(password: string): Promise<void> {
  return callBackend<void>('update_share_password', { password });
}

/** Browser mode: fetch info about the shared workspace from the HTTP server. */
export async function getShareInfo(): Promise<ShareInfo> {
  const res = await fetch(`${'/api'}/get_share_info`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<ShareInfo>;
}

/** Browser mode: authenticate with the share password. */
export async function authenticate(password: string): Promise<void> {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': getSessionId(),
    },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || '认证失败');
  }
}
