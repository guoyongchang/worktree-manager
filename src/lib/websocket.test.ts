import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('WebSocketManager singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://tunnel.kirov-opensource.com/t/bliss-kind-drift/'),
    });
  });

  it('connects when a session becomes available after an earlier empty-session lookup', async () => {
    const sockets: Array<{ url: string; close: () => void }> = [];
    class MockWebSocket {
      url: string;

      constructor(url: string) {
        this.url = url;
        sockets.push(this);
      }

      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', MockWebSocket);

    const { getWebSocketManager } = await import('./websocket');

    getWebSocketManager();
    expect(sockets).toHaveLength(0);

    sessionStorage.setItem('wm_session_id', 'sid-1');
    getWebSocketManager();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('wss://tunnel.kirov-opensource.com/t/bliss-kind-drift/ws?session_id=sid-1');
  });
});
