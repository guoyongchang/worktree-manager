import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  startSharing: vi.fn(),
  stopSharing: vi.fn(),
  getShareState: vi.fn(),
  getLastSharePassword: vi.fn(),
  updateSharePassword: vi.fn(),
  getNgrokToken: vi.fn(),
  setNgrokToken: vi.fn(),
  startNgrokTunnel: vi.fn(),
  stopNgrokTunnel: vi.fn(),
  getConnectedClients: vi.fn(),
  kickClient: vi.fn(),
  getLastSharePort: vi.fn(),
}));

vi.mock('../lib/backend', () => backendMocks);

import { useShareFeature } from './useShareFeature';

describe('useShareFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('share_disclaimer_accepted', 'true');
    backendMocks.isTauri.mockReturnValue(false);
    backendMocks.getLastSharePort.mockResolvedValue(43123);
    backendMocks.startSharing.mockResolvedValue(undefined);
    backendMocks.getShareState.mockResolvedValue({
      active: true,
      urls: ['https://127.0.0.1:43123'],
      ngrok_url: null,
    });
    backendMocks.stopSharing.mockResolvedValue(undefined);
    backendMocks.updateSharePassword.mockResolvedValue(undefined);
    backendMocks.getNgrokToken.mockResolvedValue(null);
    backendMocks.setNgrokToken.mockResolvedValue(undefined);
    backendMocks.startNgrokTunnel.mockResolvedValue('https://demo.ngrok-free.app');
    backendMocks.stopNgrokTunnel.mockResolvedValue(undefined);
    backendMocks.getConnectedClients.mockResolvedValue([]);
    backendMocks.kickClient.mockResolvedValue(undefined);
    backendMocks.getLastSharePassword.mockResolvedValue(null);
  });

  it('reads the saved share port only once during quick share', async () => {
    const setError = vi.fn();
    const { result } = renderHook(() => useShareFeature(setError));

    await act(async () => {
      await result.current.handleQuickShare();
    });

    await waitFor(() => {
      expect(backendMocks.startSharing).toHaveBeenCalledWith(43123, expect.any(String));
    });

    expect(backendMocks.getLastSharePort).toHaveBeenCalledTimes(1);
    expect(setError).not.toHaveBeenCalled();
  });
});
