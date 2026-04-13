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

  const generatePassword = useCallback(() => {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
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

      await stopSharing();
      setShareActive(false);
      setShareUrls([]);
      setShareNgrokUrl(null);
      setConnectedClients([]);
    } catch (e) {
      setError(String(e));
    }
  }, [setError, shareNgrokUrl]);

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

  // Poll connected clients while sharing is active (Tauri only).
  useEffect(() => {
    if (!isTauri() || !shareActive) {
      setConnectedClients([]);
      return;
    }
    const fetchStatus = () => {
      getConnectedClients()
        .then(setConnectedClients)
        .catch(() => { });
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
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
  };
}
