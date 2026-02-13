/**
 * WebSocket manager for browser mode.
 *
 * Multiplexes PTY output and lock state updates over a single WebSocket
 * connection to the Axum server's /ws endpoint.
 */

import { getSessionId } from './backend';

type PtyCallback = (data: string) => void;
type TmuxCallback = (data: string) => void;
type LockCallback = (locks: Record<string, string>) => void;
type CollaboratorCallback = (msg: { workspacePath: string; worktreeName: string; collaborators: string[]; owner?: string }) => void;
type TerminalStateCallback = (msg: {
  workspacePath: string;
  worktreeName: string;
  activatedTerminals: string[];
  activeTerminalTab: string | null;
  terminalVisible: boolean;
}) => void;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 10000;
  private sessionId: string | null = null;

  // Callback registries
  private ptyCallbacks = new Map<string, PtyCallback>();
  private tmuxCallbacks = new Map<string, TmuxCallback>();
  private lockCallback: LockCallback | null = null;
  private collaboratorCallbacks: CollaboratorCallback[] = [];
  private terminalStateCallbacks: TerminalStateCallback[] = [];

  // Pending subscriptions to send after reconnect
  private pendingPtySubscriptions = new Set<string>();
  private pendingLockSubscription: string | null = null;

  connect(sessionId: string) {
    if (this.ws && this.connected) return;
    this.sessionId = sessionId;
    this.doConnect();
  }

  private doConnect() {
    if (!this.sessionId) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?session_id=${encodeURIComponent(this.sessionId)}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;

      // Re-subscribe any active subscriptions after reconnect
      for (const sessionId of this.pendingPtySubscriptions) {
        this.sendJson({ type: 'pty_subscribe', sessionId });
      }
      if (this.pendingLockSubscription) {
        this.sendJson({ type: 'subscribe_locks', workspacePath: this.pendingLockSubscription });
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

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'pty_output': {
        if (msg.sessionId && msg.data) {
          const cb = this.ptyCallbacks.get(msg.sessionId);
          if (cb) cb(msg.data);
        }
        break;
      }
      case 'tmux_output': {
        if (msg.tmuxSession && msg.data) {
          const cb = this.tmuxCallbacks.get(msg.tmuxSession);
          if (cb) cb(msg.data);
        }
        break;
      }
      case 'lock_update': {
        if (msg.locks && this.lockCallback) {
          this.lockCallback(msg.locks);
        }
        break;
      }
      case 'collaborator_update': {
        for (const cb of this.collaboratorCallbacks) {
          cb(msg);
        }
        break;
      }
      case 'terminal_state_update': {
        for (const cb of this.terminalStateCallbacks) {
          cb(msg);
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
      || this.tmuxCallbacks.size > 0
      || !!this.lockCallback
      || this.collaboratorCallbacks.length > 0
      || this.terminalStateCallbacks.length > 0;
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
    this.sendJson({ type: 'pty_subscribe', sessionId });
  }

  unsubscribePty(sessionId: string) {
    this.ptyCallbacks.delete(sessionId);
    this.pendingPtySubscriptions.delete(sessionId);
    this.sendJson({ type: 'pty_unsubscribe', sessionId });
  }

  writePty(sessionId: string, data: string) {
    this.sendJson({ type: 'pty_write', sessionId, data });
  }

  subscribeTmux(tmuxSession: string, onData: TmuxCallback) {
    this.tmuxCallbacks.set(tmuxSession, onData);
  }

  unsubscribeTmux(tmuxSession: string) {
    this.tmuxCallbacks.delete(tmuxSession);
  }

  writeTmux(tmuxSession: string, data: string) {
    this.sendJson({ type: 'tmux_input', tmuxSession, data });
  }

  resizeTmux(tmuxSession: string, cols: number, rows: number) {
    this.sendJson({ type: 'tmux_resize', tmuxSession, cols, rows });
  }

  captureTmux(tmuxSession: string) {
    this.sendJson({ type: 'tmux_capture', tmuxSession });
  }

  subscribeCollaborators(callback: CollaboratorCallback) {
    this.collaboratorCallbacks.push(callback);
    return () => {
      this.collaboratorCallbacks = this.collaboratorCallbacks.filter(cb => cb !== callback);
    };
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
    sequence?: number
  ) {
    this.sendJson({
      type: 'broadcast_terminal_state',
      workspacePath,
      worktreeName,
      activatedTerminals,
      activeTerminalTab,
      terminalVisible,
      sequence,
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

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ptyCallbacks.clear();
    this.tmuxCallbacks.clear();
    this.pendingPtySubscriptions.clear();
    this.lockCallback = null;
    this.pendingLockSubscription = null;
    this.collaboratorCallbacks = [];
    this.terminalStateCallbacks = [];
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
    instance.connect(getSessionId());
  }
  return instance;
}
