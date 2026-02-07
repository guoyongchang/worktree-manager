import { useState, useEffect, useCallback, useRef } from 'react';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'notification'
  | 'downloading'
  | 'success'
  | 'error';

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

export interface UseUpdaterReturn {
  state: UpdaterState;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress;
  errorMessage: string;
  showUpToDateToast: boolean;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  startDownload: () => Promise<void>;
  restartApp: () => Promise<void>;
  dismiss: () => void;
  retry: () => Promise<void>;
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

  const updateRef = useRef<Update | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto check on mount with a 3-second delay (silent mode)
  useEffect(() => {
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
    if (!silent) {
      setState('checking');
    }

    try {
      const update = await check();

      if (update) {
        updateRef.current = update;

        const notes = update.body
          ? update.body.split('\n').filter((line) => line.trim())
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

  const startDownload = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState('downloading');
    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
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
            const percentage = totalBytes > 0
              ? Math.min(Math.round((downloadedBytes / totalBytes) * 100), 100)
              : 0;
            setDownloadProgress({
              version: update.version,
              downloadedBytes,
              totalBytes,
              percentage,
            });
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

  const restartApp = useCallback(async () => {
    try {
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
    restartApp,
    dismiss,
    retry,
  };
}
