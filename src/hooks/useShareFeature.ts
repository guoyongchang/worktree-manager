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
  getWmsConfig,
  setWmsConfig,
  startWmsTunnel,
  stopWmsTunnel,
  getConnectedClients,
  kickClient,
} from '../lib/backend';
import type { ConnectedClient } from '../lib/backend';

export interface UseShareFeatureReturn {
  shareActive: boolean;
  shareUrls: string[];
  shareNgrokUrl: string | null;
  shareWmsUrl: string | null;
  sharePassword: string;
  ngrokLoading: boolean;
  wmsLoading: boolean;
  showNgrokTokenDialog: boolean;
  setShowNgrokTokenDialog: (show: boolean) => void;
  ngrokTokenInput: string;
  setNgrokTokenInput: (value: string) => void;
  savingNgrokToken: boolean;
  showWmsConfigDialog: boolean;
  setShowWmsConfigDialog: (show: boolean) => void;
  wmsConfigInput: { token: string; subdomain: string };
  setWmsConfigInput: (value: { token: string; subdomain: string }) => void;
  savingWmsConfig: boolean;
  connectedClients: ConnectedClient[];
  handleStartShare: (port: number) => Promise<void>;
  handleStopShare: () => Promise<void>;
  handleToggleNgrok: () => Promise<void>;
  handleToggleWms: () => Promise<void>;
  handleUpdateSharePassword: (newPassword: string) => Promise<void>;
  handleSaveNgrokToken: () => Promise<void>;
  handleSaveWmsConfig: () => Promise<void>;
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
  const [shareWmsUrl, setShareWmsUrl] = useState<string | null>(null);
  const [wmsLoading, setWmsLoading] = useState(false);
  const [showWmsConfigDialog, setShowWmsConfigDialog] = useState(false);
  const [wmsConfigInput, setWmsConfigInput] = useState({ token: '', subdomain: '' });
  const [savingWmsConfig, setSavingWmsConfig] = useState(false);
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
      // 如果有 ngrok 或 WMS 正在运行，先停止它们
      if (shareNgrokUrl) {
        await stopNgrokTunnel();
      }
      if (shareWmsUrl) {
        await stopWmsTunnel();
      }

      await stopSharing();
      setShareActive(false);
      setShareUrls([]);
      setShareNgrokUrl(null);
      setShareWmsUrl(null);
      setConnectedClients([]);
    } catch (e) {
      setError(String(e));
    }
  }, [setError, shareNgrokUrl, shareWmsUrl]);

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

  const handleToggleWms = useCallback(async () => {
    if (wmsLoading) return;
    setWmsLoading(true);
    try {
      if (shareWmsUrl) {
        await stopWmsTunnel();
        setShareWmsUrl(null);
      } else {
        const cfg = await getWmsConfig();
        if (!cfg.token || !cfg.subdomain) {
          setWmsLoading(false);
          setWmsConfigInput({
            token: cfg.token || '',
            subdomain: cfg.subdomain || '',
          });
          setShowWmsConfigDialog(true);
          return;
        }
        const wmsUrl = await startWmsTunnel();
        setShareWmsUrl(wmsUrl);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setWmsLoading(false);
    }
  }, [setError, shareWmsUrl, wmsLoading]);

  const handleSaveWmsConfig = useCallback(async () => {
    if (!wmsConfigInput.token.trim() || !wmsConfigInput.subdomain.trim()) return;
    setSavingWmsConfig(true);
    try {
      await setWmsConfig('https://tunnel.kirov-opensource.com', wmsConfigInput.token.trim(), wmsConfigInput.subdomain.trim());
      setShowWmsConfigDialog(false);
      setWmsLoading(true);
      const wmsUrl = await startWmsTunnel();
      setShareWmsUrl(wmsUrl);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingWmsConfig(false);
      setWmsLoading(false);
    }
  }, [setError, wmsConfigInput]);

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
          if (state.wms_url) {
            setShareWmsUrl(state.wms_url);
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
    shareWmsUrl,
    sharePassword,
    ngrokLoading,
    wmsLoading,
    showNgrokTokenDialog,
    setShowNgrokTokenDialog,
    ngrokTokenInput,
    setNgrokTokenInput,
    savingNgrokToken,
    showWmsConfigDialog,
    setShowWmsConfigDialog,
    wmsConfigInput,
    setWmsConfigInput,
    savingWmsConfig,
    connectedClients,
    handleStartShare,
    handleStopShare,
    handleToggleNgrok,
    handleToggleWms,
    handleUpdateSharePassword,
    handleSaveNgrokToken,
    handleSaveWmsConfig,
    handleKickClient,
    generatePassword,
  };
}
