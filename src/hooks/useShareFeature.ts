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
  startWmsTunnel,
  stopWmsTunnel,
  wmsManualReconnect,
  cloudGetStatus,
  getConnectedClients,
  kickClient,
  getLastSharePort,
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
  hasLastConfig: boolean;
  handleStartShare: (port: number) => Promise<void>;
  handleStopShare: () => Promise<void>;
  handleToggleNgrok: () => Promise<void>;
  handleUpdateSharePassword: (newPassword: string) => Promise<void>;
  handleSaveNgrokToken: () => Promise<void>;
  handleKickClient: (sessionId: string) => Promise<void>;
  handleQuickShare: () => Promise<void>;
  generatePassword: () => string;
  hasNgrokToken: boolean;
  showShareDisclaimer: boolean;
  setShowShareDisclaimer: (show: boolean) => void;
  acceptShareDisclaimer: () => void;
  // WMS tunnel
  shareWmsUrl: string | null;
  wmsConnected: boolean;
  wmsReconnecting: boolean;
  wmsReconnectAttempt: number;
  wmsNextRetrySecs: number;
  wmsLoading: boolean;
  showWmsLoginDialog: boolean;
  setShowWmsLoginDialog: (show: boolean) => void;
  handleToggleWms: () => Promise<void>;
  handleWmsManualReconnect: () => Promise<void>;
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
  const [hasNgrokToken, setHasNgrokToken] = useState(false);

  // WMS tunnel state
  const [shareWmsUrl, setShareWmsUrl] = useState<string | null>(null);
  const [wmsConnected, setWmsConnected] = useState(false);
  const [wmsReconnecting, setWmsReconnecting] = useState(false);
  const [wmsReconnectAttempt, setWmsReconnectAttempt] = useState(0);
  const [wmsNextRetrySecs, setWmsNextRetrySecs] = useState(0);
  const [wmsLoading, setWmsLoading] = useState(false);
  const [showWmsLoginDialog, setShowWmsLoginDialog] = useState(false);

  // Sharing disclaimer (one-time per install)
  const [shareDisclaimerAccepted, setShareDisclaimerAccepted] = useState(() => localStorage.getItem('share_disclaimer_accepted') === 'true');
  const [showShareDisclaimer, setShowShareDisclaimer] = useState(false);
  const [pendingDisclaimerAction, setPendingDisclaimerAction] = useState<(() => void) | null>(null);

  const acceptShareDisclaimer = useCallback(() => {
    localStorage.setItem('share_disclaimer_accepted', 'true');
    setShareDisclaimerAccepted(true);
    setShowShareDisclaimer(false);
    if (pendingDisclaimerAction) {
      pendingDisclaimerAction();
      setPendingDisclaimerAction(null);
    }
  }, [pendingDisclaimerAction]);

  const requireDisclaimer = useCallback((action: () => void) => {
    if (shareDisclaimerAccepted) {
      action();
    } else {
      setPendingDisclaimerAction(() => action);
      setShowShareDisclaimer(true);
    }
  }, [shareDisclaimerAccepted]);

  // 强口令：14 位、加密安全随机、含大小写+数字（去除易混淆的 l/o/0/1）。
  const generatePassword = useCallback(() => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(14);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => chars[n % chars.length]).join('');
  }, []);

  const _doStartShare = useCallback(async (port: number) => {
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

  const handleStartShare = useCallback(async (port: number) => {
    requireDisclaimer(() => { _doStartShare(port); });
  }, [requireDisclaimer, _doStartShare]);

  const handleStopShare = useCallback(async () => {
    try {
      if (shareNgrokUrl) {
        await stopNgrokTunnel();
      }
      if (shareWmsUrl) {
        await stopWmsTunnel();
        setShareWmsUrl(null);
        setWmsConnected(false);
        setWmsReconnecting(false);
        setWmsReconnectAttempt(0);
        setWmsNextRetrySecs(0);
      }

      await stopSharing();
      setShareActive(false);
      setShareUrls([]);
      setShareNgrokUrl(null);
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

  const handleToggleWms = useCallback(async () => {
    if (wmsLoading) return;
    if (shareWmsUrl) {
      // Stop WMS tunnel
      try {
        await stopWmsTunnel();
        setShareWmsUrl(null);
        setWmsConnected(false);
        setWmsReconnecting(false);
        setWmsReconnectAttempt(0);
        setWmsNextRetrySecs(0);
      } catch (e) {
        setError(String(e));
      }
      return;
    }
    // Check cloud login gate
    try {
      const status = await cloudGetStatus();
      if (!status?.connected) {
        setShowWmsLoginDialog(true);
        return;
      }
    } catch {
      setShowWmsLoginDialog(true);
      return;
    }
    // Start WMS tunnel (backend enforces LAN share must be active)
    setWmsLoading(true);
    try {
      const url = await startWmsTunnel();
      setShareWmsUrl(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setWmsLoading(false);
    }
  }, [setError, shareWmsUrl, wmsLoading]);

  const handleWmsManualReconnect = useCallback(async () => {
    try {
      await wmsManualReconnect();
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

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

  // Track if we have a previous share config for quick-share
  const [hasLastConfig, setHasLastConfig] = useState(false);

  // Quick share: restart sharing with the last known LAN port.
  const handleQuickShare = useCallback(async () => {
    try {
      const lastPort = await getLastSharePort();
      if (!lastPort) {
        return;
      }
      requireDisclaimer(() => { void _doStartShare(lastPort); });
    } catch (e) {
      setError(String(e));
    }
  }, [setError, requireDisclaimer, _doStartShare]);

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
            setWmsConnected(state.wms_connected);
            setWmsReconnecting(state.wms_reconnecting);
            setWmsReconnectAttempt(state.wms_reconnect_attempt);
            setWmsNextRetrySecs(state.wms_next_retry_secs);
          }
        }
      }).catch(() => { });
      getLastSharePassword().then(pwd => {
        if (pwd) {
          setSharePassword(pwd);
          setHasLastConfig(true);
        }
      }).catch(() => { });
      // Check if ngrok token is configured
      getNgrokToken().then(token => {
        setHasNgrokToken(!!token);
      }).catch(() => { });
    }
  }, []);

  // Poll connected clients and WMS state while sharing is active (Tauri only).
  useEffect(() => {
    if (!isTauri() || !shareActive) {
      setConnectedClients([]);
      return;
    }
    // Use shorter interval when WMS tunnel is running and reconnecting
    const intervalMs = (shareWmsUrl && wmsReconnecting) ? 2000 : 5000;
    const fetchStatus = () => {
      getConnectedClients()
        .then(setConnectedClients)
        .catch(() => { });
      if (shareWmsUrl) {
        getShareState()
          .then(state => {
            setWmsConnected(state.wms_connected);
            setWmsReconnecting(state.wms_reconnecting);
            setWmsReconnectAttempt(state.wms_reconnect_attempt);
            setWmsNextRetrySecs(state.wms_next_retry_secs);
          })
          .catch(() => { });
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, intervalMs);
    return () => clearInterval(interval);
  }, [shareActive, shareWmsUrl, wmsReconnecting]);

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
    hasLastConfig,
    handleStartShare,
    handleStopShare,
    handleToggleNgrok,
    handleUpdateSharePassword,
    handleSaveNgrokToken,
    handleKickClient,
    handleQuickShare,
    generatePassword,
    hasNgrokToken,
    showShareDisclaimer,
    setShowShareDisclaimer,
    acceptShareDisclaimer,
    // WMS tunnel
    shareWmsUrl,
    wmsConnected,
    wmsReconnecting,
    wmsReconnectAttempt,
    wmsNextRetrySecs,
    wmsLoading,
    showWmsLoginDialog,
    setShowWmsLoginDialog,
    handleToggleWms,
    handleWmsManualReconnect,
  };
}
