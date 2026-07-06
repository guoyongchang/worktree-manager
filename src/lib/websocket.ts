/**
 * WebSocket manager for browser mode.
 *
 * Multiplexes PTY output and lock state updates over a single WebSocket
 * connection to the Axum server's /ws endpoint.
 */

import { getSessionId } from './backend';
import { getRoutedWebSocketUrl } from './tunnelRoute';

type PtyCallback = (data: string) => void;
type LockCallback = (locks: Record<string, string>) => void;
type TerminalStateCallback = (msg: {
  workspacePath: string;
  worktreeName: string;
  activatedTerminals: string[];
  activeTerminalTab: string | null;
  terminalVisible: boolean;
  clientId?: string;
}) => void;
type VoiceEventCallback = (event: string, payload: Record<string, unknown>) => void;
type KickedCallback = (reason: string) => void;
type ConnectionStateCallback = (connected: boolean) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 10000;
  private sessionId: string | null = null;

  // Callback registries
  private ptyCallbacks = new Map<string, PtyCallback>();
  private lockCallback: LockCallback | null = null;
  private terminalStateCallbacks: TerminalStateCallback[] = [];
  private voiceEventCallbacks: VoiceEventCallback[] = [];
  private kickedCallbacks: KickedCallback[] = [];
  private connectionStateCallbacks: ConnectionStateCallback[] = [];

  // Pending subscriptions to send after reconnect
  private pendingPtySubscriptions = new Set<string>();
  private pendingLockSubscription: string | null = null;
  private pendingVoiceSubscription = false;

  // Keystrokes typed while disconnected, flushed in order on reconnect (bounded, drop-oldest).
  private pendingWrites: Array<{ sessionId: string; data: string }> = [];
  private pendingWriteBytes = 0;
  private static readonly MAX_PENDING_WRITE_BYTES = 256 * 1024;

  connect(sessionId: string) {
    if (!sessionId) {
      this.sessionId = null;
      return;
    }
    if (this.ws && this.sessionId === sessionId) return;
    if (this.ws && this.sessionId !== sessionId) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
      this.notifyConnectionState(false);
    }
    this.sessionId = sessionId;
    this.doConnect();
  }

  private doConnect() {
    if (!this.sessionId) {
      console.warn('[ws] doConnect: no sessionId, skipping');
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Detect tunnel path prefix (e.g., /t/guo) for proxy routing
    const tunnelMatch = location.pathname.match(/^(\/t\/[^/]+)/);
    const basePath = tunnelMatch ? tunnelMatch[1] : '';
    const routedUrl = getRoutedWebSocketUrl(this.sessionId);
    const url = routedUrl ?? `${protocol}//${location.host}${basePath}/ws?session_id=${encodeURIComponent(this.sessionId)}`;
    console.log('[ws] connecting to', url);

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.notifyConnectionState(true);
      console.log('[ws] connected, re-subscribing', this.pendingPtySubscriptions.size, 'PTY sessions');

      // Re-subscribe any active subscriptions after reconnect
      for (const sessionId of this.pendingPtySubscriptions) {
        this.sendJson({ type: 'pty_subscribe', sessionId });
      }
      if (this.pendingLockSubscription) {
        this.sendJson({ type: 'subscribe_locks', workspacePath: this.pendingLockSubscription });
      }
      if (this.pendingVoiceSubscription) {
        this.sendJson({ type: 'subscribe_voice_events' });
      }

      // Flush keystrokes buffered while disconnected, in order, after re-subscribing.
      if (this.pendingWrites.length > 0) {
        const queued = this.pendingWrites;
        this.pendingWrites = [];
        this.pendingWriteBytes = 0;
        for (const w of queued) {
          this.sendJson({ type: 'pty_write', sessionId: w.sessionId, data: w.data });
        }
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = (event) => {
      console.log('[ws] disconnected, code:', event.code, 'reason:', event.reason);
      this.connected = false;
      this.ws = null;
      this.notifyConnectionState(false);

      // Check if close was due to authentication failure (code 1008 = policy violation, or 4401 = custom unauthorized)
      if (event.code === 1008 || event.code === 4401 || event.reason?.includes('auth')) {
        console.warn('[ws] Authentication failed, clearing session');
        // Import clearSessionId dynamically to avoid circular dependency
        import('./backend').then(({ clearSessionId }) => {
          clearSessionId();
          // Reload page to show login screen
          window.location.reload();
        });
        return;
      }

      this.scheduleReconnect();
    };

    this.ws.onerror = (e) => {
      console.error('[ws] error', e);
      // onclose will fire after onerror
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'pty_output': {
        if (msg.sessionId && msg.data) {
          const cb = this.ptyCallbacks.get(msg.sessionId);
          if (cb) {
            cb(msg.data);
          } else {
            console.warn('[ws] pty_output received but no callback for:', msg.sessionId);
          }
        }
        break;
      }
      case 'lock_update': {
        if (msg.locks && this.lockCallback) {
          this.lockCallback(msg.locks);
        }
        break;
      }
      case 'terminal_state_update': {
        for (const cb of this.terminalStateCallbacks) {
          cb(msg);
        }
        break;
      }
      case 'voice_event': {
        if (msg.event) {
          for (const cb of this.voiceEventCallbacks) {
            cb(msg.event, msg.payload || {});
          }
        }
        break;
      }
      case 'kicked': {
        const reason = msg.reason || '';
        for (const cb of this.kickedCallbacks) {
          cb(reason);
        }
        break;
      }
    }
  }

  private sendJson(obj: Record<string, unknown>) {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private hasActiveSubscriptions(): boolean {
    return this.ptyCallbacks.size > 0
      || !!this.lockCallback
      || this.terminalStateCallbacks.length > 0
      || this.voiceEventCallbacks.length > 0;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.hasActiveSubscriptions()) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.doConnect();
    }, this.reconnectDelay);
  }

  subscribePty(sessionId: string, onData: PtyCallback) {
    this.ptyCallbacks.set(sessionId, onData);
    this.pendingPtySubscriptions.add(sessionId);
    console.log('[ws] subscribePty:', sessionId, 'connected:', this.connected);
    this.sendJson({ type: 'pty_subscribe', sessionId });
  }

  unsubscribePty(sessionId: string) {
    this.ptyCallbacks.delete(sessionId);
    this.pendingPtySubscriptions.delete(sessionId);
    this.sendJson({ type: 'pty_unsubscribe', sessionId });
  }

  writePty(sessionId: string, data: string) {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({ type: 'pty_write', sessionId, data }));
      return;
    }
    // Buffer keystrokes typed while (re)connecting so they aren't silently dropped; flush in
    // order once the socket reopens. Bounded (drop-oldest) to avoid unbounded growth on a
    // long outage.
    this.pendingWrites.push({ sessionId, data });
    this.pendingWriteBytes += data.length;
    while (
      this.pendingWriteBytes > WebSocketManager.MAX_PENDING_WRITE_BYTES &&
      this.pendingWrites.length > 0
    ) {
      const dropped = this.pendingWrites.shift();
      if (dropped) this.pendingWriteBytes -= dropped.data.length;
    }
  }

  subscribeTerminalState(workspacePath: string, worktreeName: string, callback: TerminalStateCallback) {
    this.terminalStateCallbacks.push(callback);
    this.sendJson({ type: 'subscribe_terminal_state', workspacePath, worktreeName });
    return () => {
      this.terminalStateCallbacks = this.terminalStateCallbacks.filter(cb => cb !== callback);
    };
  }

  broadcastTerminalState(
    workspacePath: string,
    worktreeName: string,
    activatedTerminals: string[],
    activeTerminalTab: string | null,
    terminalVisible: boolean,
    clientId?: string,
    sessionId?: string | null
  ) {
    this.sendJson({
      type: 'broadcast_terminal_state',
      workspacePath,
      worktreeName,
      activatedTerminals,
      activeTerminalTab,
      terminalVisible,
      clientId,
      sessionId,
    });
  }

  subscribeLocks(workspacePath: string, onUpdate: LockCallback) {
    this.lockCallback = onUpdate;
    this.pendingLockSubscription = workspacePath;
    this.sendJson({ type: 'subscribe_locks', workspacePath });
  }

  unsubscribeLocks() {
    this.lockCallback = null;
    this.pendingLockSubscription = null;
  }

  subscribeVoiceEvents(callback: VoiceEventCallback): () => void {
    this.voiceEventCallbacks.push(callback);
    this.pendingVoiceSubscription = true;
    this.sendJson({ type: 'subscribe_voice_events' });
    return () => {
      this.voiceEventCallbacks = this.voiceEventCallbacks.filter(cb => cb !== callback);
      if (this.voiceEventCallbacks.length === 0) {
        this.pendingVoiceSubscription = false;
      }
    };
  }

  onKicked(callback: KickedCallback): () => void {
    this.kickedCallbacks.push(callback);
    return () => {
      this.kickedCallbacks = this.kickedCallbacks.filter(cb => cb !== callback);
    };
  }

  onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.connectionStateCallbacks.push(callback);
    // Immediately notify current state
    callback(this.connected);
    return () => {
      this.connectionStateCallbacks = this.connectionStateCallbacks.filter(cb => cb !== callback);
    };
  }

  private notifyConnectionState(connected: boolean) {
    for (const cb of this.connectionStateCallbacks) {
      cb(connected);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ptyCallbacks.clear();
    this.pendingPtySubscriptions.clear();
    this.lockCallback = null;
    this.pendingLockSubscription = null;
    this.terminalStateCallbacks = [];
    this.voiceEventCallbacks = [];
    this.pendingVoiceSubscription = false;
    this.pendingWrites = [];
    this.pendingWriteBytes = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

}

let instance: WebSocketManager | null = null;

export function getWebSocketManager(): WebSocketManager {
  if (!instance) {
    instance = new WebSocketManager();
  }
  instance.connect(getSessionId());
  return instance;
}
