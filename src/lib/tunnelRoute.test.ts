import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTunnelRouteForTests,
  getRoutedApiBase,
  getRoutedWebSocketUrl,
  selectBestMeasuredPeer,
  setTunnelRouteForTests,
  type PeerCandidate,
  type PeerMeasurement,
} from './tunnelRoute';

describe('tunnelRoute', () => {
  beforeEach(() => {
    clearTunnelRouteForTests();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://tunnel.kirov-opensource.com/t/bliss-kind-drift/'),
    });
  });

  it('selects the measured peer with the lowest combined score', () => {
    const peers: PeerCandidate[] = [
      {
        id: 'eu-1',
        public_base_url: 'https://eu',
        public_ws_url: 'wss://eu',
        probe_url: 'https://eu/_wms/probe',
        desktop_rtt_ms: 80,
        load_score: 0,
        weight: 0,
      },
      {
        id: 'us-1',
        public_base_url: 'https://us',
        public_ws_url: 'wss://us',
        probe_url: 'https://us/_wms/probe',
        desktop_rtt_ms: 220,
        load_score: 0,
        weight: 0,
      },
    ];
    const measurements: PeerMeasurement[] = [
      { peer_id: 'eu-1', browser_rtt_ms: 80, ok: true },
      { peer_id: 'us-1', browser_rtt_ms: 20, ok: true },
    ];
    expect(selectBestMeasuredPeer(peers, measurements)?.id).toBe('eu-1');
  });

  it('returns selected peer API and websocket bases without changing window origin', () => {
    setTunnelRouteForTests({
      selected_peer_id: 'eu-1',
      api_base_url: 'https://167.235.103.66:8443/t/bliss-kind-drift/api',
      ws_base_url: 'wss://167.235.103.66:8443/t/bliss-kind-drift/ws',
      route_token: 'route-token',
      expires_at: Date.now() + 600_000,
    });

    expect(window.location.origin).toBe('https://tunnel.kirov-opensource.com');
    expect(getRoutedApiBase()).toBe('https://167.235.103.66:8443/t/bliss-kind-drift/api');
    expect(getRoutedWebSocketUrl('sid')).toBe('wss://167.235.103.66:8443/t/bliss-kind-drift/ws?session_id=sid&route_token=route-token');
  });
});
