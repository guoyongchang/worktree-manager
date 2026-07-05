import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearTunnelRouteForTests,
  getRoutedApiBase,
  getRoutedWebSocketUrl,
  getTunnelRoute,
  discoverTunnelRoutes,
  measurePeerMedianLatency,
  selectTunnelRoute,
  selectBestMeasuredPeer,
  setTunnelRouteForTests,
  type TunnelRouteDiscovery,
  type PeerCandidate,
  type PeerMeasurement,
} from './tunnelRoute';

describe('tunnelRoute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
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
      subdomain: 'bliss-kind-drift',
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

  it('discovers route candidates from the center API root while on a share path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        route_session_id: 'rts_center',
        subdomain: 'bliss-kind-drift',
        route_token: 'route-token',
        peers: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const discovery = await discoverTunnelRoutes(5);

    expect(discovery?.subdomain).toBe('bliss-kind-drift');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tunnel/route/bliss-kind-drift',
      { headers: { 'X-Session-Id': '' } },
    );
  });

  it('does not reuse an in-memory route for a different share subdomain', () => {
    setTunnelRouteForTests({
      subdomain: 'bliss-kind-drift',
      selected_peer_id: 'eu-1',
      api_base_url: 'https://167.235.103.66:8443/t/bliss-kind-drift/api',
      ws_base_url: 'wss://167.235.103.66:8443/t/bliss-kind-drift/ws',
      route_token: 'route-token',
      expires_at: Date.now() + 600_000,
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://tunnel.kirov-opensource.com/t/other-share/'),
    });

    expect(getTunnelRoute()).toBeNull();
  });

  it('measures a peer five times and reports the median latency', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const now = vi.spyOn(performance, 'now');
    now
      .mockReturnValueOnce(0).mockReturnValueOnce(50)
      .mockReturnValueOnce(100).mockReturnValueOnce(140)
      .mockReturnValueOnce(200).mockReturnValueOnce(230)
      .mockReturnValueOnce(300).mockReturnValueOnce(320)
      .mockReturnValueOnce(400).mockReturnValueOnce(440);

    const option = await measurePeerMedianLatency(
      {
        id: 'aliyun-cn-1',
        public_base_url: 'https://139.196.238.190:39384',
        public_ws_url: 'wss://139.196.238.190:39384',
        probe_url: 'https://139.196.238.190:39384/_wms/probe',
        desktop_rtt_ms: 10,
        load_score: 0,
        weight: 80,
      },
      'rts_1',
      'route-token',
      5,
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(option.samples_ms).toEqual([50, 40, 30, 20, 40]);
    expect(option.median_browser_rtt_ms).toBe(40);
    expect(option.reachable).toBe(true);
  });

  it('selects a manually chosen peer by submitting only that peer measurement', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        selected_peer_id: 'center',
        api_base_url: 'https://tunnel.kirov-opensource.com/t/bliss-kind-drift/api',
        ws_base_url: 'wss://tunnel.kirov-opensource.com/t/bliss-kind-drift/ws',
        route_token: 'center-token',
        expires_in_secs: 600,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const discovery: TunnelRouteDiscovery = {
      route_session_id: 'rts_manual',
      route_token: 'route-token',
      subdomain: 'bliss-kind-drift',
      options: [
        {
          peer: {
            id: 'aliyun-cn-1',
            public_base_url: 'https://139.196.238.190:39384',
            public_ws_url: 'wss://139.196.238.190:39384',
            probe_url: 'https://139.196.238.190:39384/_wms/probe',
            desktop_rtt_ms: 10,
            load_score: 0,
            weight: 80,
          },
          samples_ms: [10, 11, 9, 10, 12],
          median_browser_rtt_ms: 10,
          reachable: true,
        },
        {
          peer: {
            id: 'center',
            public_base_url: 'https://tunnel.kirov-opensource.com',
            public_ws_url: 'wss://tunnel.kirov-opensource.com',
            probe_url: 'https://tunnel.kirov-opensource.com/_wms/probe',
            desktop_rtt_ms: 250,
            load_score: 0,
            weight: 100,
          },
          samples_ms: [80, 90, 70, 85, 75],
          median_browser_rtt_ms: 80,
          reachable: true,
        },
      ],
    };

    const route = await selectTunnelRoute(discovery, 'center');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);

    expect(route?.selected_peer_id).toBe('center');
    expect(body).toEqual({
      route_session_id: 'rts_manual',
      measurements: [
        { peer_id: 'center', browser_rtt_ms: 80, ok: true },
      ],
    });
  });
});
