import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  discoverTunnelRoutes: vi.fn(),
  hasSelectableRoutePeers: vi.fn((next) => (
    !!next?.options.some((option: { peer: { id: string } }) => option.peer.id !== 'center')
  )),
  isCurrentDomainPeer: vi.fn((peer: { id: string; public_base_url: string }) => (
    peer.id === 'center' || peer.public_base_url === 'https://tunnel.kirov-opensource.com'
  )),
  selectTunnelRoute: vi.fn(),
  getRoutePreference: vi.fn(),
  getTunnelRoute: vi.fn(),
}));

vi.mock('../lib/tunnelRoute', () => routeMocks);

import { TunnelRouteSelector } from './TunnelRouteSelector';
import type { TunnelRouteDiscovery } from '../lib/tunnelRoute';

const discovery: TunnelRouteDiscovery = {
  route_session_id: 'rts_1',
  subdomain: 'bliss-kind-drift',
  route_token: 'route-token',
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
      samples_ms: [12, 10, 11, 9, 10],
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
      samples_ms: [81, 79, 80, 83, 78],
      median_browser_rtt_ms: 80,
      reachable: true,
    },
  ],
};

const centerOnlyDiscovery: TunnelRouteDiscovery = {
  ...discovery,
  options: [discovery.options[1]],
};

describe('TunnelRouteSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.discoverTunnelRoutes.mockResolvedValue(discovery);
    routeMocks.selectTunnelRoute.mockResolvedValue({
      subdomain: 'bliss-kind-drift',
      selected_peer_id: 'center',
      api_base_url: 'https://tunnel.kirov-opensource.com/t/bliss-kind-drift/api',
      ws_base_url: 'wss://tunnel.kirov-opensource.com/t/bliss-kind-drift/ws',
      route_token: 'center-token',
      expires_at: Date.now() + 600_000,
    });
    routeMocks.getRoutePreference.mockReturnValue('auto');
    routeMocks.getTunnelRoute.mockReturnValue(null);
  });

  it('shows median latency for each route and confirms the selected peer', async () => {
    const onSelected = vi.fn();

    render(<TunnelRouteSelector variant="gate" onSelected={onSelected} />);

    expect(routeMocks.discoverTunnelRoutes).toHaveBeenCalledWith(5);
    expect(await screen.findByText('aliyun-cn-1')).toBeInTheDocument();
    expect(screen.getByText('当前域名')).toBeInTheDocument();
    expect(screen.getByText('center · https://tunnel.kirov-opensource.com')).toBeInTheDocument();
    expect(screen.getByText('10 ms')).toBeInTheDocument();
    expect(screen.getByText('80 ms')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /center/ }));
    fireEvent.click(screen.getByRole('button', { name: '进入分享页面' }));

    await waitFor(() => {
      expect(routeMocks.selectTunnelRoute).toHaveBeenCalledWith(discovery, 'center');
    });
    expect(onSelected).toHaveBeenCalledTimes(1);
  });

  it('hides the compact selector when the current domain is the only node', async () => {
    routeMocks.discoverTunnelRoutes.mockResolvedValue(centerOnlyDiscovery);

    render(<TunnelRouteSelector variant="compact" onSelected={vi.fn()} />);

    await waitFor(() => {
      expect(routeMocks.discoverTunnelRoutes).toHaveBeenCalledWith(5);
    });
    expect(screen.queryByLabelText('路由节点')).not.toBeInTheDocument();
  });
});
