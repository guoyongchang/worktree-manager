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
  setWmsConfig,
  startWmsTunnel,
  stopWmsTunnel,
  wmsManualReconnect,
  getConnectedClients,
  kickClient,
  getWmsConfig,
  wmsBrowserLogin,
  cancelWmsBrowserLogin,
  wmsLogin,
  getWmsUser,
  wmsLogout,
} from '../lib/backend';
import type { ConnectedClient, WmsUser } from '../lib/backend';

export interface UseShareFeatureReturn {
  shareActive: boolean;
  shareUrls: string[];
  shareNgrokUrl: string | null;
  shareWmsUrl: string | null;
  wmsConnected: boolean;
  wmsReconnecting: boolean;
  wmsReconnectAttempt: number;
  wmsNextRetrySecs: number;
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
  hasLastConfig: boolean;
  handleStartShare: (port: number) => Promise<void>;
  handleStopShare: () => Promise<void>;
  handleToggleNgrok: () => Promise<void>;
  handleToggleWms: () => Promise<void>;
  handleWmsManualReconnect: () => Promise<void>;
  handleUpdateSharePassword: (newPassword: string) => Promise<void>;
  handleSaveNgrokToken: () => Promise<void>;
  handleSaveWmsConfig: () => Promise<void>;
  handleKickClient: (sessionId: string) => Promise<void>;
  handleQuickShare: () => Promise<void>;
  generatePassword: () => string;
  hasNgrokToken: boolean;
  wmsLoggedIn: boolean;
  wmsUser: WmsUser | null;
  showWmsLoginDialog: boolean;
  setShowWmsLoginDialog: (show: boolean) => void;
  wmsLoginLoading: boolean;
  handleWmsBrowserLogin: () => Promise<void>;
  handleCancelWmsBrowserLogin: () => void;
  handleWmsFormLogin: () => Promise<void>;
  wmsUsername: string;
  setWmsUsername: (v: string) => void;
  wmsPassword: string;
  setWmsPassword: (v: string) => void;
  wmsFormLoginLoading: boolean;
  handleWmsLogout: () => Promise<void>;
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
  const [shareWmsUrl, setShareWmsUrl] = useState<string | null>(null);
  const [wmsLoading, setWmsLoading] = useState(false);
  const [showWmsConfigDialog, setShowWmsConfigDialog] = useState(false);
  const [wmsConfigInput, setWmsConfigInput] = useState({ token: '', subdomain: '' });
  const [savingWmsConfig, setSavingWmsConfig] = useState(false);
  const [wmsConnected, setWmsConnected] = useState(false);
  const [wmsReconnecting, setWmsReconnecting] = useState(false);
  const [wmsReconnectAttempt, setWmsReconnectAttempt] = useState(0);
  const [wmsNextRetrySecs, setWmsNextRetrySecs] = useState(0);
  const [connectedClients, setConnectedClients] = useState<ConnectedClient[]>([]);
  const [hasNgrokToken, setHasNgrokToken] = useState(false);
  const [wmsLoggedIn, setWmsLoggedIn] = useState(false);
  const [wmsUser, setWmsUser] = useState<WmsUser | null>(null);
  const [showWmsLoginDialog, setShowWmsLoginDialog] = useState(false);
  const [wmsLoginLoading, setWmsLoginLoading] = useState(false);
  const [wmsUsername, setWmsUsername] = useState('');
  const [wmsPassword, setWmsPassword] = useState('');
  const [wmsFormLoginLoading, setWmsFormLoginLoading] = useState(false);
  const [pendingShareAction, setPendingShareAction] = useState<'toggle' | 'quick' | null>(null);

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
      setWmsConnected(false);
      setWmsReconnecting(false);
      setWmsReconnectAttempt(0);
      setWmsNextRetrySecs(0);
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
        setWmsConnected(false);
        setWmsReconnecting(false);
        setWmsReconnectAttempt(0);
        setWmsNextRetrySecs(0);
      } else {
        // Check if logged in first
        const config = await getWmsConfig();
        if (!config.jwt) {
          // Show login dialog instead of directly opening browser
          setWmsLoading(false);
          setPendingShareAction('toggle');
          setShowWmsLoginDialog(true);
          return;
        }
        const wmsUrl = await startWmsTunnel();
        setShareWmsUrl(wmsUrl);
        // Sync LAN state (backend may have auto-started it)
        const state = await getShareState();
        if (state.active) {
          setShareActive(true);
          setShareUrls(state.urls);
        }
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
      // Sync LAN state
      const state = await getShareState();
      if (state.active) {
        setShareActive(true);
        setShareUrls(state.urls);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingWmsConfig(false);
      setWmsLoading(false);
    }
  }, [setError, wmsConfigInput]);

  const handleWmsManualReconnect = useCallback(async () => {
    try {
      await wmsManualReconnect();
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  // Track if we have a previous share config for quick-share
  const [hasLastConfig, setHasLastConfig] = useState(false);

  // Quick share: restart sharing with WMS tunnel (auto-registers if needed)
  const handleQuickShare = useCallback(async () => {
    try {
      setWmsLoading(true);
      // Check if logged in first
      const config = await getWmsConfig();
      if (!config.jwt) {
        // Show login dialog instead of directly opening browser
        setWmsLoading(false);
        setPendingShareAction('quick');
        setShowWmsLoginDialog(true);
        return;
      }
      const wmsUrl = await startWmsTunnel();
      setShareWmsUrl(wmsUrl);
      // Sync LAN state
      const state = await getShareState();
      if (state.active) {
        setShareActive(true);
        setShareUrls(state.urls);
      }
      setWmsLoading(false);
    } catch (e) {
      setError(String(e));
      setWmsLoading(false);
    }
  }, [setError]);

  // Shared post-login action: start tunnel if there was a pending share action
  const executePostLoginAction = useCallback(async () => {
    const action = pendingShareAction;
    setPendingShareAction(null);
    if (action === 'toggle' || action === 'quick') {
      setWmsLoading(true);
      try {
        const wmsUrl = await startWmsTunnel();
        setShareWmsUrl(wmsUrl);
        const state = await getShareState();
        if (state.active) {
          setShareActive(true);
          setShareUrls(state.urls);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setWmsLoading(false);
      }
    }
  }, [setError, pendingShareAction]);

  // Handle WMS browser login: called from login dialog
  const handleWmsBrowserLogin = useCallback(async () => {
    setWmsLoginLoading(true);
    try {
      await wmsBrowserLogin();
      setWmsLoggedIn(true);
      setShowWmsLoginDialog(false);
      getWmsUser().then(u => { if (u.username) setWmsUser(u); }).catch(() => { });
      await executePostLoginAction();
    } catch (e) {
      setError(String(e));
    } finally {
      setWmsLoginLoading(false);
    }
  }, [setError, executePostLoginAction]);

  // Handle WMS form login (username/password): called from login dialog
  const handleWmsFormLogin = useCallback(async () => {
    if (!wmsUsername.trim() || !wmsPassword.trim()) return;
    setWmsFormLoginLoading(true);
    try {
      await wmsLogin(wmsUsername.trim(), wmsPassword);
      setWmsLoggedIn(true);
      setShowWmsLoginDialog(false);
      setWmsUsername('');
      setWmsPassword('');
      getWmsUser().then(u => { if (u.username) setWmsUser(u); }).catch(() => { });
      await executePostLoginAction();
    } catch (e) {
      setError(String(e));
    } finally {
      setWmsFormLoginLoading(false);
    }
  }, [setError, wmsUsername, wmsPassword, executePostLoginAction]);

  // Cancel a pending WMS browser login
  const handleCancelWmsBrowserLogin = useCallback(() => {
    cancelWmsBrowserLogin().catch(() => { });
    setWmsLoginLoading(false);
    setShowWmsLoginDialog(false);
    setPendingShareAction(null);
  }, []);

  // Handle WMS logout: clear JWT and user info
  const handleWmsLogout = useCallback(async () => {
    try {
      await wmsLogout();
      setWmsLoggedIn(false);
      setWmsUser(null);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

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
      // Check if WMS is logged in
      getWmsConfig().then(config => {
        const loggedIn = !!config.jwt;
        setWmsLoggedIn(loggedIn);
        if (loggedIn) {
          getWmsUser().then(u => { if (u.username) setWmsUser(u); }).catch(() => { });
        }
      }).catch(() => { });
    }
  }, []);

  // Poll connected clients and WMS connection state when sharing is active (Tauri only)
  // Use faster polling (2s) when WMS is reconnecting, normal (5s) otherwise
  useEffect(() => {
    if (!isTauri() || !shareActive) {
      setConnectedClients([]);
      return;
    }
    const pollInterval = (shareWmsUrl && wmsReconnecting) ? 2000 : 5000;
    const fetchStatus = () => {
      getConnectedClients()
        .then(setConnectedClients)
        .catch(() => { });
      // Also poll WMS connection state when WMS tunnel is active
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
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [shareActive, shareWmsUrl, wmsReconnecting]);

  return {
    shareActive,
    shareUrls,
    shareNgrokUrl,
    shareWmsUrl,
    wmsConnected,
    wmsReconnecting,
    wmsReconnectAttempt,
    wmsNextRetrySecs,
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
    hasLastConfig,
    handleStartShare,
    handleStopShare,
    handleToggleNgrok,
    handleToggleWms,
    handleWmsManualReconnect,
    handleUpdateSharePassword,
    handleSaveNgrokToken,
    handleSaveWmsConfig,
    handleKickClient,
    handleQuickShare,
    generatePassword,
    hasNgrokToken,
    wmsLoggedIn,
    wmsUser,
    showWmsLoginDialog,
    setShowWmsLoginDialog,
    wmsLoginLoading,
    handleWmsBrowserLogin,
    handleCancelWmsBrowserLogin,
    handleWmsFormLogin,
    wmsUsername,
    setWmsUsername,
    wmsPassword,
    setWmsPassword,
    wmsFormLoginLoading,
    handleWmsLogout,
    showShareDisclaimer,
    setShowShareDisclaimer,
    acceptShareDisclaimer,
  };
}
