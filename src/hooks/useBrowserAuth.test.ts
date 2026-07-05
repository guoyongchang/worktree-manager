import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  callBackend: vi.fn(),
  getSessionId: vi.fn(),
  clearSessionId: vi.fn(),
  authenticate: vi.fn(),
}));

const tunnelRouteMocks = vi.hoisted(() => ({
  ensureTunnelRoute: vi.fn(),
}));

vi.mock('../lib/backend', () => backendMocks);
vi.mock('../lib/tunnelRoute', () => tunnelRouteMocks);

import { useBrowserAuth } from './useBrowserAuth';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useBrowserAuth tunnel routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backendMocks.isTauri.mockReturnValue(false);
    backendMocks.getSessionId.mockReturnValue('sid-1');
    backendMocks.callBackend.mockResolvedValue([]);
    tunnelRouteMocks.ensureTunnelRoute.mockResolvedValue(null);
    window.history.replaceState({}, '', '/t/bliss-kind-drift/');
  });

  it('attempts tunnel route before validating a stored browser session', async () => {
    const order: string[] = [];
    const route = deferred<null>();
    tunnelRouteMocks.ensureTunnelRoute.mockImplementation(async () => {
      order.push('route:start');
      await route.promise;
      order.push('route:end');
      return null;
    });
    backendMocks.callBackend.mockImplementation(async () => {
      order.push('callBackend');
      return [];
    });

    renderHook(() => useBrowserAuth());

    await waitFor(() => {
      expect(tunnelRouteMocks.ensureTunnelRoute).toHaveBeenCalledTimes(1);
    });
    expect(backendMocks.callBackend).not.toHaveBeenCalled();

    route.resolve(null);

    await waitFor(() => {
      expect(backendMocks.callBackend).toHaveBeenCalledWith('list_workspaces');
    });
    expect(order).toEqual(['route:start', 'route:end', 'callBackend']);
  });

  it('shows route selection after password authentication before entering the app', async () => {
    backendMocks.getSessionId.mockReturnValue('');
    backendMocks.authenticate.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBrowserAuth());

    await act(async () => {
      result.current.setBrowserLoginPassword('share-password');
    });
    await act(async () => {
      await result.current.handleBrowserLogin();
    });

    expect(backendMocks.authenticate).toHaveBeenCalledWith('share-password');
    expect(tunnelRouteMocks.ensureTunnelRoute).not.toHaveBeenCalled();
    expect(result.current.browserRouteSelectionPending).toBe(true);
    expect(result.current.browserAuthenticated).toBe(false);

    act(() => {
      result.current.completeBrowserRouteSelection();
    });

    expect(result.current.browserRouteSelectionPending).toBe(false);
    expect(result.current.browserAuthenticated).toBe(true);
  });
});
