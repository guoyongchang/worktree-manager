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
  selected_peer_id: string;
  api_base_url: string;
  ws_base_url: string;
  route_token: string;
  expires_at: number;
}

interface RouteCandidatesResponse {
  route_session_id: string;
  peers: PeerCandidate[];
  route_token: string;
}

type SelectRouteResponse = Omit<SelectedTunnelRoute, 'expires_at'> & {
  expires_in_secs: number;
};

let currentRoute: SelectedTunnelRoute | null = null;

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
  sessionStorage.setItem('wm_tunnel_route', JSON.stringify(route));
}

export function getTunnelRoute(): SelectedTunnelRoute | null {
  if (currentRoute && currentRoute.expires_at > Date.now()) return currentRoute;

  const raw = sessionStorage.getItem('wm_tunnel_route');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SelectedTunnelRoute;
    if (parsed.expires_at <= Date.now()) {
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
  sessionStorage.removeItem('wm_tunnel_route');
}

function getSubdomain(): string | null {
  return window.location.pathname.match(/^\/t\/([^/]+)/)?.[1] ?? null;
}

function getCenterApiBase(): string {
  return `${window.location.pathname.match(/^(\/t\/[^/]+)/)?.[1] ?? ''}/api`;
}

async function probePeer(
  peer: PeerCandidate,
  routeSessionId: string,
  routeToken: string,
): Promise<PeerMeasurement> {
  const t0 = performance.now();
  try {
    const url = `${peer.probe_url}?route_session_id=${encodeURIComponent(routeSessionId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${routeToken}` },
      mode: 'cors',
    });
    return {
      peer_id: peer.id,
      browser_rtt_ms: performance.now() - t0,
      ok: res.ok,
    };
  } catch {
    return { peer_id: peer.id, browser_rtt_ms: null, ok: false };
  }
}

export async function ensureTunnelRoute(): Promise<SelectedTunnelRoute | null> {
  const existing = getTunnelRoute();
  if (existing) return existing;

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
    const measurements = await Promise.all(
      candidates.peers.map((peer) => probePeer(
        peer,
        candidates.route_session_id,
        candidates.route_token,
      )),
    );

    const selectRes = await fetch(
      `${centerBase}/tunnel/route/${encodeURIComponent(subdomain)}/select`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          route_session_id: candidates.route_session_id,
          measurements,
        }),
      },
    );
    if (!selectRes.ok) return null;

    const selected = await selectRes.json() as SelectRouteResponse;
    const route: SelectedTunnelRoute = {
      ...selected,
      expires_at: Date.now() + selected.expires_in_secs * 1000,
    };
    setTunnelRoute(route);
    return route;
  } catch {
    return null;
  }
}

export const setTunnelRouteForTests = setTunnelRoute;
export const clearTunnelRouteForTests = clearTunnelRoute;
