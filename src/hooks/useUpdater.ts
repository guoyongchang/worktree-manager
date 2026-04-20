import { useState, useEffect, useCallback, useRef } from 'react';
import { isTauri, callBackend } from '../lib/backend';

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'notification'
  | 'downloading'
  | 'success'
  | 'error';

export type ChannelStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date: string;
  notes: string[];
}

export interface DownloadProgress {
  version: string;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
}

export interface MirrorSource {
  name: string;
  url: string;
  builtin: boolean;
}

export interface MirrorTestResult {
  name: string;
  url: string;
  bytes_downloaded: number;
  speed_mbps: number;
  available: boolean;
}

export interface UseUpdaterReturn {
  state: UpdaterState;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress;
  errorMessage: string;
  showUpToDateToast: boolean;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  startDownload: () => Promise<void>;
  downloadViaMirror: () => Promise<void>;
  restartApp: () => Promise<void>;
  dismiss: () => void;
  retry: () => Promise<void>;
  // Dual-channel checker dialog
  showCheckerDialog: boolean;
  openCheckerDialog: () => void;
  closeCheckerDialog: () => void;
  officialStatus: ChannelStatus;
  mirrorStatus: ChannelStatus;
  mirrorVersion: string | null;
  officialError: string;
  mirrorError: string;
  // Mirror source management
  mirrorTestResults: MirrorTestResult[];
  selectedMirror: MirrorSource | null;
  speedTesting: boolean;
  testMirrorSpeed: () => Promise<void>;
  addCustomMirror: (name: string, url: string) => Promise<void>;
  removeCustomMirror: (name: string) => Promise<void>;
  selectMirror: (mirror: MirrorSource) => void;
  speedTestSingle: (mirrorUrl: string) => Promise<void>;
}

export function useUpdater(): UseUpdaterReturn {
  const [state, setState] = useState<UpdaterState>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress>({
    version: '',
    downloadedBytes: 0,
    totalBytes: 0,
    percentage: 0,
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [showUpToDateToast, setShowUpToDateToast] = useState(false);

  // Dual-channel checker dialog state
  const [showCheckerDialog, setShowCheckerDialog] = useState(false);
  const [officialStatus, setOfficialStatus] = useState<ChannelStatus>('idle');
  const [mirrorStatus, setMirrorStatus] = useState<ChannelStatus>('idle');
  const [mirrorVersion, setMirrorVersion] = useState<string | null>(null);
  const [officialError, setOfficialError] = useState('');
  const [mirrorError, setMirrorError] = useState('');
  const [mirrorTestResults, setMirrorTestResults] = useState<MirrorTestResult[]>([]);
  const [selectedMirror, setSelectedMirror] = useState<MirrorSource | null>(null);
  const [speedTesting, setSpeedTesting] = useState(false);

  // Store the native Update object (Tauri only)
  const updateRef = useRef<unknown>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto check on mount with a 3-second delay (silent mode), skip in dev mode and browser mode
  useEffect(() => {
    if (import.meta.env.DEV || !isTauri()) return;
    const timer = setTimeout(() => {
      checkForUpdates(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Cleanup toast timer
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const checkForUpdates = useCallback(async (silent = false) => {
    // Updater is only available in Tauri desktop mode
    if (!isTauri()) {
      if (!silent) {
        setShowUpToDateToast(true);
        toastTimerRef.current = setTimeout(() => setShowUpToDateToast(false), 3000);
      }
      return;
    }

    if (!silent) {
      setState('checking');
    }

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();

      if (update) {
        updateRef.current = update;

        const notes = update.body
          ? update.body.split('\n').filter((line: string) => line.trim())
          : [];

        setUpdateInfo({
          version: update.version,
          currentVersion: update.currentVersion,
          date: update.date ?? new Date().toISOString().split('T')[0],
          notes,
        });
        setState('notification');
      } else {
        setState('idle');
        if (!silent) {
          setShowUpToDateToast(true);
          toastTimerRef.current = setTimeout(() => {
            setShowUpToDateToast(false);
          }, 3000);
        }
      }
    } catch (err) {
      console.error('Failed to check for updates:', err);
      if (!silent) {
        setErrorMessage(String(err));
        setState('error');
      } else {
        setState('idle');
      }
    }
  }, []);

  // --- Dual-channel checker ---

  const checkOfficialChannel = useCallback(async () => {
    if (!isTauri()) {
      setOfficialStatus('up-to-date');
      return;
    }
    setOfficialStatus('checking');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        updateRef.current = update;
        const notes = update.body
          ? update.body.split('\n').filter((line: string) => line.trim())
          : [];
        setUpdateInfo({
          version: update.version,
          currentVersion: update.currentVersion,
          date: update.date ?? new Date().toISOString().split('T')[0],
          notes,
        });
        setOfficialStatus('available');
      } else {
        setOfficialStatus('up-to-date');
      }
    } catch (err) {
      console.error('[updater] Official channel check failed:', err);
      setOfficialError(String(err));
      setOfficialStatus('error');
    }
  }, []);

  const testMirrorSpeed = useCallback(async () => {
    setSpeedTesting(true);
    try {
      const results = await callBackend<MirrorTestResult[]>('test_mirror_speed');
      setMirrorTestResults(results);
      const fastest = results.find((r) => r.available);
      if (fastest) {
        setSelectedMirror({ name: fastest.name, url: fastest.url, builtin: true });
      }
    } catch (err) {
      console.error('[updater] Mirror speed test failed:', err);
    } finally {
      setSpeedTesting(false);
    }
  }, []);

  const addCustomMirror = useCallback(async (name: string, url: string) => {
    try {
      const sources = await callBackend<MirrorSource[]>('get_mirror_sources');
      const customMirrors = sources
        .filter((s) => !s.builtin)
        .map((s) => ({ name: s.name, url: s.url }));
      customMirrors.push({ name, url });
      await callBackend('save_custom_mirrors', { mirrors: customMirrors });
    } catch (err) {
      console.error('[updater] Failed to add custom mirror:', err);
    }
  }, []);

  const removeCustomMirror = useCallback(async (name: string) => {
    try {
      const sources = await callBackend<MirrorSource[]>('get_mirror_sources');
      const customMirrors = sources
        .filter((s) => !s.builtin && s.name !== name)
        .map((s) => ({ name: s.name, url: s.url }));
      await callBackend('save_custom_mirrors', { mirrors: customMirrors });
    } catch (err) {
      console.error('[updater] Failed to remove custom mirror:', err);
    }
  }, []);

  const speedTestSingle = useCallback(async (mirrorUrl: string) => {
    try {
      const result = await callBackend<MirrorTestResult>('speed_test_single_mirror', { mirrorUrl });
      setMirrorTestResults((prev) =>
        prev.map((r) => (r.url === mirrorUrl ? result : r)),
      );
    } catch (err) {
      console.error('[updater] Single mirror speed test failed:', err);
    }
  }, []);

  const checkMirrorChannel = useCallback(async () => {
    setMirrorStatus('checking');
    try {
      // 先测速
      setSpeedTesting(true);
      const results = await callBackend<MirrorTestResult[]>('test_mirror_speed');
      setMirrorTestResults(results);
      setSpeedTesting(false);

      const fastest = results.find((r) => r.available);
      if (!fastest) {
        setMirrorError('No mirror available');
        setMirrorStatus('error');
        return;
      }

      setSelectedMirror({ name: fastest.name, url: fastest.url, builtin: true });

      // 用最快源检查更新
      const manifest = await callBackend<{
        version: string;
        pub_date: string;
        notes: string;
        current_version: string;
      }>('check_mirror_update', { mirrorUrl: fastest.url });

      const latestVersion = manifest.version;
      const currentVersion = manifest.current_version;

      setMirrorVersion(latestVersion);
      if (latestVersion && latestVersion !== currentVersion) {
        if (!updateRef.current) {
          setUpdateInfo((prev) =>
            prev ?? {
              version: latestVersion,
              currentVersion,
              date: manifest.pub_date?.split('T')[0] ?? new Date().toISOString().split('T')[0],
              notes: manifest.notes
                ? String(manifest.notes).split('\n').filter((l: string) => l.trim())
                : [],
            },
          );
        }
        setMirrorStatus('available');
      } else {
        setMirrorStatus('up-to-date');
      }
    } catch (err) {
      console.error('[updater] Mirror channel check failed:', err);
      setMirrorError(String(err));
      setMirrorStatus('error');
      setSpeedTesting(false);
    }
  }, []);

  const openCheckerDialog = useCallback(() => {
    setShowCheckerDialog(true);
    setOfficialStatus('idle');
    setMirrorStatus('idle');
    setOfficialError('');
    setMirrorError('');
    setMirrorVersion(null);
    // Kick off both checks in parallel
    checkOfficialChannel();
    checkMirrorChannel();
  }, [checkOfficialChannel, checkMirrorChannel]);

  const closeCheckerDialog = useCallback(() => {
    setShowCheckerDialog(false);
  }, []);

  // --- Download flows ---

  const startDownload = useCallback(async () => {
    const update = updateRef.current as {
      version: string;
      downloadAndInstall: (cb: (event: { event: string; data: Record<string, number> }) => void) => Promise<void>;
    } | null;
    if (!update) return;

    setShowCheckerDialog(false);
    setState('downloading');
    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await update.downloadAndInstall((event: { event: string; data: Record<string, number> }) => {
        switch (event.event) {
          case 'Started':
            totalBytes = event.data.contentLength ?? 0;
            downloadedBytes = 0;
            setDownloadProgress({
              version: update.version,
              downloadedBytes: 0,
              totalBytes,
              percentage: 0,
            });
            break;
          case 'Progress':
            downloadedBytes += event.data.chunkLength;
            {
              const percentage = totalBytes > 0
                ? Math.min(Math.round((downloadedBytes / totalBytes) * 100), 100)
                : 0;
              setDownloadProgress({
                version: update.version,
                downloadedBytes,
                totalBytes,
                percentage,
              });
            }
            break;
          case 'Finished':
            setDownloadProgress({
              version: update.version,
              downloadedBytes: totalBytes,
              totalBytes,
              percentage: 100,
            });
            break;
        }
      });

      setState('success');
    } catch (err) {
      console.error('Failed to download update:', err);
      setErrorMessage(String(err));
      setState('error');
    }
  }, []);

  const downloadViaMirror = useCallback(async () => {
    if (!updateInfo) return;

    setShowCheckerDialog(false);
    setState('downloading');
    let totalBytes = 0;
    let downloadedBytes = 0;

    // Listen for progress events from the Rust backend
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<{ event: string; data: Record<string, number> }>(
      'mirror-update-progress',
      (event) => {
        const { event: eventType, data } = event.payload;
        switch (eventType) {
          case 'Started':
            totalBytes = data.contentLength ?? 0;
            downloadedBytes = 0;
            setDownloadProgress({
              version: updateInfo.version,
              downloadedBytes: 0,
              totalBytes,
              percentage: 0,
            });
            break;
          case 'Progress':
            downloadedBytes += data.chunkLength;
            {
              const percentage = totalBytes > 0
                ? Math.min(Math.round((downloadedBytes / totalBytes) * 100), 100)
                : 0;
              setDownloadProgress({
                version: updateInfo.version,
                downloadedBytes,
                totalBytes,
                percentage,
              });
            }
            break;
          case 'Finished':
            setDownloadProgress({
              version: updateInfo.version,
              downloadedBytes: totalBytes,
              totalBytes,
              percentage: 100,
            });
            break;
        }
      },
    );

    try {
      await callBackend('download_update_via_mirror', {
        mirrorUrl: selectedMirror?.url ?? 'https://gh-proxy.org/',
      });
      setState('success');
    } catch (err) {
      console.error('Failed to download mirror update:', err);
      setErrorMessage(String(err));
      setState('error');
    } finally {
      unlisten();
    }
  }, [updateInfo, selectedMirror]);

  const restartApp = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      console.error('Failed to relaunch:', err);
      setErrorMessage(String(err));
      setState('error');
    }
  }, []);

  const dismiss = useCallback(() => {
    setState('idle');
  }, []);

  const retry = useCallback(async () => {
    if (updateRef.current) {
      await startDownload();
    } else {
      await checkForUpdates(false);
    }
  }, [startDownload, checkForUpdates]);

  return {
    state,
    updateInfo,
    downloadProgress,
    errorMessage,
    showUpToDateToast,
    checkForUpdates,
    startDownload,
    downloadViaMirror,
    restartApp,
    dismiss,
    retry,
    // Dual-channel checker dialog
    showCheckerDialog,
    openCheckerDialog,
    closeCheckerDialog,
    officialStatus,
    mirrorStatus,
    mirrorVersion,
    officialError,
    mirrorError,
    mirrorTestResults,
    selectedMirror,
    speedTesting,
    testMirrorSpeed,
    addCustomMirror,
    removeCustomMirror,
    selectMirror: setSelectedMirror,
    speedTestSingle,
  };
}
