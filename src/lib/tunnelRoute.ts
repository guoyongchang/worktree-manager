export interface PeerCandidate {
  id: string;
  public_base_url: string;
  public_ws_url: string;
  probe_url: string;
  desktop_rtt_ms?: number | null;
  load_score: number;
  weight: number;
}

export interface PeerMeasurement {
  peer_id: string;
  browser_rtt_ms?: number | null;
  ok: boolean;
}

export interface SelectedTunnelRoute {
  subdomain: string;
  selected_peer_id: string;
  api_base_url: string;
  ws_base_url: string;
  route_token: string;
  expires_at: number;
}

export interface TunnelRouteOption {
  peer: PeerCandidate;
  samples_ms: number[];
  median_browser_rtt_ms: number | null;
  reachable: boolean;
}

export interface TunnelRouteDiscovery {
  route_session_id: string;
  subdomain: string;
  route_token: string;
  options: TunnelRouteOption[];
}

interface RouteCandidatesResponse {
  route_session_id: string;
  subdomain?: string;
  peers: PeerCandidate[];
  route_token: string;
}

type SelectRouteResponse = Omit<SelectedTunnelRoute, 'expires_at'> & {
  expires_in_secs: number;
};

let currentRoute: SelectedTunnelRoute | null = null;
const ROUTE_STORAGE_KEY = 'wm_tunnel_route';
const ROUTE_PREFERENCE_KEY = 'wm_tunnel_peer_preference';
const AUTO_ROUTE_PREFERENCE = 'auto';

export function selectBestMeasuredPeer(
  peers: PeerCandidate[],
  measurements: PeerMeasurement[],
): PeerCandidate | null {
  const measurementByPeer = new Map(
    measurements
      .filter((m) => m.ok && typeof m.browser_rtt_ms === 'number')
      .map((m) => [m.peer_id, m.browser_rtt_ms as number]),
  );

  let best: { peer: PeerCandidate; score: number } | null = null;
  for (const peer of peers) {
    const browserRtt = measurementByPeer.get(peer.id);
    if (browserRtt == null) continue;
    const desktopRtt = peer.desktop_rtt_ms ?? 150;
    const score = browserRtt
      + desktopRtt
      + Math.round(Math.max(0, peer.load_score) * 200)
      + peer.weight;
    if (!best || score < best.score) {
      best = { peer, score };
    }
  }
  return best?.peer ?? null;
}

export function setTunnelRoute(route: SelectedTunnelRoute): void {
  currentRoute = route;
  sessionStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(route));
}

export function getTunnelRoute(): SelectedTunnelRoute | null {
  const subdomain = getSubdomain();
  if (
    currentRoute
    && currentRoute.expires_at > Date.now()
    && (!subdomain || currentRoute.subdomain === subdomain)
  ) {
    return currentRoute;
  }
  if (currentRoute) currentRoute = null;

  const raw = sessionStorage.getItem(ROUTE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SelectedTunnelRoute;
    if (parsed.expires_at <= Date.now() || (subdomain && parsed.subdomain !== subdomain)) {
      clearTunnelRoute();
      return null;
    }
    currentRoute = parsed;
    return parsed;
  } catch {
    clearTunnelRoute();
    return null;
  }
}

export function getRoutedApiBase(): string | null {
  return getTunnelRoute()?.api_base_url ?? null;
}

export function getRouteToken(): string | null {
  return getTunnelRoute()?.route_token ?? null;
}

export function getRoutedWebSocketUrl(sessionId: string): string | null {
  const route = getTunnelRoute();
  if (!route) return null;
  return `${route.ws_base_url}?session_id=${encodeURIComponent(sessionId)}&route_token=${encodeURIComponent(route.route_token)}`;
}

export function clearTunnelRoute(): void {
  currentRoute = null;
  sessionStorage.removeItem(ROUTE_STORAGE_KEY);
}

export function getRoutePreference(): string {
  return sessionStorage.getItem(ROUTE_PREFERENCE_KEY) || AUTO_ROUTE_PREFERENCE;
}

export function setRoutePreference(peerId: string): void {
  sessionStorage.setItem(ROUTE_PREFERENCE_KEY, peerId || AUTO_ROUTE_PREFERENCE);
}

function getSubdomain(): string | null {
  return window.location.pathname.match(/^\/t\/([^/]+)/)?.[1] ?? null;
}

function getCenterApiBase(): string {
  return '/api';
}

async function probePeerLatency(
  peer: PeerCandidate,
  routeSessionId: string,
  routeToken: string,
  sampleIndex = 0,
): Promise<number | null> {
  const t0 = performance.now();
  try {
    const url = `${peer.probe_url}?route_session_id=${encodeURIComponent(routeSessionId)}&sample=${sampleIndex}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${routeToken}` },
      mode: 'cors',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return performance.now() - t0;
  } catch {
    return null;
  }
}

export function medianLatencyMs(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[middle]);
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export async function measurePeerMedianLatency(
  peer: PeerCandidate,
  routeSessionId: string,
  routeToken: string,
  sampleCount = 5,
): Promise<TunnelRouteOption> {
  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = await probePeerLatency(peer, routeSessionId, routeToken, i);
    if (sample != null) samples.push(Math.round(sample));
  }

  return {
    peer,
    samples_ms: samples,
    median_browser_rtt_ms: medianLatencyMs(samples),
    reachable: samples.length > 0,
  };
}

export async function discoverTunnelRoutes(sampleCount = 5): Promise<TunnelRouteDiscovery | null> {
  const subdomain = getSubdomain();
  if (!subdomain) return null;
  const centerBase = getCenterApiBase();
  const sessionId = sessionStorage.getItem('wm_session_id') || '';
  try {
    const candidatesRes = await fetch(
      `${centerBase}/tunnel/route/${encodeURIComponent(subdomain)}`,
      { headers: { 'X-Session-Id': sessionId } },
    );
    if (!candidatesRes.ok) return null;

    const candidates = await candidatesRes.json() as RouteCandidatesResponse;
    const options = await Promise.all(
      candidates.peers.map((peer) => measurePeerMedianLatency(
        peer,
        candidates.route_session_id,
        candidates.route_token,
        sampleCount,
      )),
    );
    return {
      route_session_id: candidates.route_session_id,
      subdomain: candidates.subdomain || subdomain,
      route_token: candidates.route_token,
      options,
    };
  } catch {
    return null;
  }
}

function measurementForOption(option: TunnelRouteOption): PeerMeasurement {
  return {
    peer_id: option.peer.id,
    browser_rtt_ms: option.median_browser_rtt_ms,
    ok: option.reachable,
  };
}

export async function selectTunnelRoute(
  discovery: TunnelRouteDiscovery,
  peerId: string,
): Promise<SelectedTunnelRoute | null> {
  const centerBase = getCenterApiBase();
  const sessionId = sessionStorage.getItem('wm_session_id') || '';
  const manualPeerId = peerId !== AUTO_ROUTE_PREFERENCE ? peerId : null;
  const selectedOption = manualPeerId
    ? discovery.options.find((option) => option.peer.id === manualPeerId && option.reachable)
    : null;
  if (manualPeerId && !selectedOption) return null;

  const measurements = manualPeerId && selectedOption
    ? [measurementForOption(selectedOption)]
    : discovery.options.filter((option) => option.reachable).map(measurementForOption);
  if (measurements.length === 0) return null;

  try {
    const selectRes = await fetch(
      `${centerBase}/tunnel/route/${encodeURIComponent(discovery.subdomain)}/select`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          route_session_id: discovery.route_session_id,
          measurements,
        }),
      },
    );
    if (!selectRes.ok) return null;

    const selected = await selectRes.json() as SelectRouteResponse;
    const route: SelectedTunnelRoute = {
      ...selected,
      subdomain: discovery.subdomain,
      expires_at: Date.now() + selected.expires_in_secs * 1000,
    };
    setTunnelRoute(route);
    setRoutePreference(peerId);
    return route;
  } catch {
    return null;
  }
}

export async function ensureTunnelRoute(): Promise<SelectedTunnelRoute | null> {
  const existing = getTunnelRoute();
  if (existing) return existing;

  const discovery = await discoverTunnelRoutes(1);
  if (!discovery) return null;
  const preferredPeerId = getRoutePreference();
  const preferredRoute = await selectTunnelRoute(discovery, preferredPeerId);
  if (preferredRoute || preferredPeerId === AUTO_ROUTE_PREFERENCE) return preferredRoute;
  return selectTunnelRoute(discovery, AUTO_ROUTE_PREFERENCE);
}

export const setTunnelRouteForTests = setTunnelRoute;
export const clearTunnelRouteForTests = clearTunnelRoute;
