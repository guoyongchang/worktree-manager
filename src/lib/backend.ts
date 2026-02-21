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

export async function openLink(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank');
  }
}

// ---------------------------------------------------------------------------
// Session management (browser mode)
// ---------------------------------------------------------------------------

/**
 * Get the current session ID.
 * Always reads from sessionStorage to avoid stale in-memory cache
 * (e.g., after HMR reload or race conditions with auth flow).
 */
export function getSessionId(): string {
  return sessionStorage.getItem('wm_session_id') || '';
}

/** Store the server-generated session ID (called after successful authentication). */
function setSessionId(sid: string): void {
  sessionStorage.setItem('wm_session_id', sid);
}

/** Clear the stored session ID (e.g., on session expiration). */
export function clearSessionId(): void {
  sessionStorage.removeItem('wm_session_id');
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
  const t0 = performance.now();
  const logResult = (result: T) => {
    console.log(`[ipc] ${command}: ${(performance.now() - t0).toFixed(1)}ms`);
    return result;
  };
  const logError = (err: unknown) => {
    console.error(`[ipc] ${command} FAILED (${(performance.now() - t0).toFixed(1)}ms):`, err);
    throw err;
  };

  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args).then(logResult, logError);
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
    logError(new Error(text || `HTTP ${res.status}`));
  }

  // Some commands return empty 204
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return logResult(undefined as T);
  }

  const data = await res.json() as T;
  return logResult(data);
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
  const path = window.prompt(title);
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
  ngrok_url?: string;
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

/** Start ngrok tunnel for the current sharing session. Returns the ngrok URL. */
export async function startNgrokTunnel(): Promise<string> {
  return callBackend<string>('start_ngrok_tunnel');
}

/** Stop ngrok tunnel (LAN sharing continues). */
export async function stopNgrokTunnel(): Promise<void> {
  return callBackend<void>('stop_ngrok_tunnel');
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

/** Get the configured ngrok token. */
export async function getNgrokToken(): Promise<string | null> {
  return callBackend<string | null>('get_ngrok_token');
}

/** Set the ngrok token. */
export async function setNgrokToken(token: string): Promise<void> {
  return callBackend<void>('set_ngrok_token', { token });
}

/** Get the last used share port. */
export async function getLastSharePort(): Promise<number | null> {
  return callBackend<number | null>('get_last_share_port');
}

/** Get the last used share password. */
export async function getLastSharePassword(): Promise<string | null> {
  return callBackend<string | null>('get_last_share_password');
}

// ---------------------------------------------------------------------------
// Connected clients API
// ---------------------------------------------------------------------------

export interface ConnectedClient {
  session_id: string;
  ip: string;
  user_agent: string;
  authenticated_at: string;
  last_active: string;
  ws_connected: boolean;
}

export async function getConnectedClients(): Promise<ConnectedClient[]> {
  return callBackend<ConnectedClient[]>('get_connected_clients');
}

export async function kickClient(sessionId: string): Promise<void> {
  return callBackend('kick_client', { sessionId });
}

/** Browser mode: fetch info about the shared workspace from the HTTP server. */
export async function getShareInfo(): Promise<ShareInfo> {
  const res = await fetch(`${getApiBase()}/get_share_info`);
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Authentication failed');
  }
  // Server returns a generated session ID — clear old and store new
  const data = await res.json();
  if (data.sessionId) {
    clearSessionId();
    setSessionId(data.sessionId);
  }
}

/** Get cached terminal state for a worktree (used for initial sync) */
export async function getTerminalState(
  workspacePath: string,
  worktreeName: string,
): Promise<{
  activated_terminals: string[];
  active_terminal_tab: string | null;
  terminal_visible: boolean;
  client_id?: string;
} | null> {
  return callBackend('get_terminal_state', { workspacePath, worktreeName });
}

/** Broadcast terminal state (desktop only) */
export async function broadcastTerminalState(
  workspacePath: string,
  worktreeName: string,
  activatedTerminals: string[],
  activeTerminalTab: string | null,
  terminalVisible: boolean,
  clientId?: string
): Promise<void> {
  return callBackend('broadcast_terminal_state', {
    workspacePath,
    worktreeName,
    activatedTerminals,
    activeTerminalTab,
    terminalVisible,
    clientId,
  });
}

// ---------------------------------------------------------------------------
// Git Operations API
// ---------------------------------------------------------------------------

export interface BranchDiffStats {
  ahead: number;
  behind: number;
  changed_files: number;
}

/** Sync with base branch (pull from base branch) */
export async function syncWithBaseBranch(path: string, baseBranch: string): Promise<string> {
  return callBackend<string>('sync_with_base_branch', { path, baseBranch });
}

/** Push current branch to remote */
export async function pushToRemote(path: string): Promise<string> {
  return callBackend<string>('push_to_remote', { path });
}

/** Merge current branch to test branch */
export async function mergeToTestBranch(path: string, testBranch: string): Promise<string> {
  return callBackend<string>('merge_to_test_branch', { path, testBranch });
}

/** Merge current branch to base branch */
export async function mergeToBaseBranch(path: string, baseBranch: string): Promise<string> {
  return callBackend<string>('merge_to_base_branch', { path, baseBranch });
}

/** Get branch diff statistics */
export async function getBranchDiffStats(path: string, baseBranch: string): Promise<BranchDiffStats> {
  return callBackend<BranchDiffStats>('get_branch_diff_stats', { path, baseBranch });
}

/** Create a pull request using gh CLI */
export async function createPullRequest(
  path: string,
  baseBranch: string,
  title: string,
  body: string
): Promise<string> {
  return callBackend<string>('create_pull_request', { path, baseBranch, title, body });
}

/** Fetch from remote origin (updates remote-tracking branches) */
export async function fetchProjectRemote(path: string): Promise<void> {
  return callBackend<void>('fetch_project_remote', { path });
}

/** Check if a remote branch exists */
export async function checkRemoteBranchExists(
  path: string,
  branchName: string
): Promise<boolean> {
  return callBackend<boolean>('check_remote_branch_exists', { path, branchName });
}

/** Get list of remote branches */
export async function getRemoteBranches(path: string): Promise<string[]> {
  return callBackend<string[]>('get_remote_branches', { path });
}

// ---------------------------------------------------------------------------
// Voice Recognition API (Dashscope)
// ---------------------------------------------------------------------------

export async function getDashscopeApiKey(): Promise<string | null> {
  return callBackend<string | null>('get_dashscope_api_key');
}

export async function setDashscopeApiKey(key: string): Promise<void> {
  return callBackend<void>('set_dashscope_api_key', { key });
}

export async function getDashscopeBaseUrl(): Promise<string | null> {
  return callBackend<string | null>('get_dashscope_base_url');
}

export async function setDashscopeBaseUrl(url: string): Promise<void> {
  return callBackend<void>('set_dashscope_base_url', { url });
}

export async function voiceStart(sampleRate?: number): Promise<void> {
  return callBackend<void>('voice_start', { sampleRate });
}

export async function voiceSendAudio(data: string): Promise<void> {
  return callBackend<void>('voice_send_audio', { data });
}

export async function voiceStop(): Promise<void> {
  return callBackend<void>('voice_stop');
}

export async function voiceIsActive(): Promise<boolean> {
  return callBackend<boolean>('voice_is_active');
}

