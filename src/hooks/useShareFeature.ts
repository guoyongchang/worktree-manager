import { useState, useEffect, useCallback } from 'react';
import {
  isTauri,
  startSharing,
  stopSharing,
  getShareState,
  getLastSharePassword,
  updateSharePassword,
  getNgrokToken,
  setNgrokToken,
  startNgrokTunnel,
  stopNgrokTunnel,
  getConnectedClients,
  kickClient,
} from '../lib/backend';
import type { ConnectedClient } from '../lib/backend';

export interface UseShareFeatureReturn {
  shareActive: boolean;
  shareUrls: string[];
  shareNgrokUrl: string | null;
  sharePassword: string;
  ngrokLoading: boolean;
  showNgrokTokenDialog: boolean;
  setShowNgrokTokenDialog: (show: boolean) => void;
  ngrokTokenInput: string;
  setNgrokTokenInput: (value: string) => void;
  savingNgrokToken: boolean;
  connectedClients: ConnectedClient[];
  handleStartShare: (port: number) => Promise<void>;
  handleStopShare: () => Promise<void>;
  handleToggleNgrok: () => Promise<void>;
  handleUpdateSharePassword: (newPassword: string) => Promise<void>;
  handleSaveNgrokToken: () => Promise<void>;
  handleKickClient: (sessionId: string) => Promise<void>;
  generatePassword: () => string;
}

export function useShareFeature(
  setError: (error: string | null) => void,
): UseShareFeatureReturn {
  const [shareActive, setShareActive] = useState(false);
  const [shareUrls, setShareUrls] = useState<string[]>([]);
  const [shareNgrokUrl, setShareNgrokUrl] = useState<string | null>(null);
  const [sharePassword, setSharePassword] = useState('');
  const [ngrokLoading, setNgrokLoading] = useState(false);
  const [showNgrokTokenDialog, setShowNgrokTokenDialog] = useState(false);
  const [ngrokTokenInput, setNgrokTokenInput] = useState('');
  const [savingNgrokToken, setSavingNgrokToken] = useState(false);
  const [connectedClients, setConnectedClients] = useState<ConnectedClient[]>([]);

  const generatePassword = useCallback(() => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }, []);

  const handleStartShare = useCallback(async (port: number) => {
    try {
      const pwd = sharePassword || generatePassword();
      await startSharing(port, pwd);
      // Fetch full share state to get all LAN URLs
      const state = await getShareState();
      setShareActive(true);
      setShareUrls(state.urls);
      setSharePassword(pwd);
    } catch (e) {
      setError(String(e));
    }
  }, [setError, generatePassword, sharePassword]);

  const handleStopShare = useCallback(async () => {
    try {
      await stopSharing();
      setShareActive(false);
      setShareUrls([]);
      setShareNgrokUrl(null);
      setConnectedClients([]);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const handleToggleNgrok = useCallback(async () => {
    if (ngrokLoading) return;
    setNgrokLoading(true);
    try {
      if (shareNgrokUrl) {
        await stopNgrokTunnel();
        setShareNgrokUrl(null);
      } else {
        const token = await getNgrokToken();
        if (!token) {
          setNgrokLoading(false);
          setShowNgrokTokenDialog(true);
          return;
        }
        const ngrokUrl = await startNgrokTunnel();
        setShareNgrokUrl(ngrokUrl);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setNgrokLoading(false);
    }
  }, [setError, shareNgrokUrl, ngrokLoading]);

  const handleUpdateSharePassword = useCallback(async (newPassword: string) => {
    try {
      await updateSharePassword(newPassword);
      setSharePassword(newPassword);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const handleKickClient = useCallback(async (sessionId: string) => {
    try {
      await kickClient(sessionId);
      const clients = await getConnectedClients();
      setConnectedClients(clients);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const handleSaveNgrokToken = useCallback(async () => {
    if (!ngrokTokenInput.trim()) return;
    setSavingNgrokToken(true);
    try {
      await setNgrokToken(ngrokTokenInput.trim());
      setShowNgrokTokenDialog(false);
      setNgrokTokenInput('');
      setNgrokLoading(true);
      const ngrokUrl = await startNgrokTunnel();
      setShareNgrokUrl(ngrokUrl);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingNgrokToken(false);
      setNgrokLoading(false);
    }
  }, [setError, ngrokTokenInput]);

  // Restore share state and load last password on mount (Tauri only)
  useEffect(() => {
    if (isTauri()) {
      getShareState().then(state => {
        if (state.active && state.urls.length > 0) {
          setShareActive(true);
          setShareUrls(state.urls);
          if (state.ngrok_url) {
            setShareNgrokUrl(state.ngrok_url);
          }
        }
      }).catch(() => {});
      getLastSharePassword().then(pwd => {
        if (pwd) {
          setSharePassword(pwd);
        }
      }).catch(() => {});
    }
  }, []);

  // Poll connected clients when sharing is active (Tauri only)
  useEffect(() => {
    if (!isTauri() || !shareActive) {
      setConnectedClients([]);
      return;
    }
    const fetchClients = () => {
      getConnectedClients()
        .then(setConnectedClients)
        .catch(() => {});
    };
    fetchClients();
    const interval = setInterval(fetchClients, 5000);
    return () => clearInterval(interval);
  }, [shareActive]);

  return {
    shareActive,
    shareUrls,
    shareNgrokUrl,
    sharePassword,
    ngrokLoading,
    showNgrokTokenDialog,
    setShowNgrokTokenDialog,
    ngrokTokenInput,
    setNgrokTokenInput,
    savingNgrokToken,
    connectedClients,
    handleStartShare,
    handleStopShare,
    handleToggleNgrok,
    handleUpdateSharePassword,
    handleSaveNgrokToken,
    handleKickClient,
    generatePassword,
  };
}
