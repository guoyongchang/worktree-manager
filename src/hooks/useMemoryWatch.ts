import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getProcessMemory, isTauri } from '../lib/backend';
import { persistAndReload } from '../lib/uiRestore';
import { useToast } from '../components/Toast';

export const MEMORY_WATCH_MODE_KEY = 'memory_watch_mode';
export const MEMORY_WATCH_MB_KEY = 'memory_watch_mb';
export const MEMORY_WATCH_DEFAULT_MB = 1536;
export const MEMORY_WATCH_DEFAULT_MODE = 'reload';

const POLL_MS = 60_000;
const STARTUP_GRACE_MS = 180_000;
const IDLE_MS = 60_000;
const RELOAD_COOLDOWN_MS = 15 * 60_000;
const REMIND_COOLDOWN_MS = 10 * 60_000;
const LAST_RELOAD_KEY = 'wm-memory-last-reload';

export type MemoryWatchMode = 'reload' | 'remind' | 'off';

export function readMemoryWatchMode(): MemoryWatchMode {
  const raw = localStorage.getItem(MEMORY_WATCH_MODE_KEY);
  if (raw === 'remind' || raw === 'off' || raw === 'reload') return raw;
  return MEMORY_WATCH_DEFAULT_MODE;
}

export function readMemoryWatchMb(): number {
  const n = Number(localStorage.getItem(MEMORY_WATCH_MB_KEY));
  return Number.isFinite(n) && n >= 256 ? Math.round(n) : MEMORY_WATCH_DEFAULT_MB;
}

export function readMemoryWatchEnabled(): boolean {
  return readMemoryWatchMode() !== 'off';
}

export function writeMemoryWatchEnabled(enabled: boolean): void {
  localStorage.setItem(MEMORY_WATCH_MODE_KEY, enabled ? 'reload' : 'off');
  window.dispatchEvent(new Event('memory-watch-changed'));
}

export function writeMemoryWatchMb(mb: number): number {
  const n = Number.isFinite(mb) && mb >= 256 ? Math.round(mb) : MEMORY_WATCH_DEFAULT_MB;
  localStorage.setItem(MEMORY_WATCH_MB_KEY, String(n));
  window.dispatchEvent(new Event('memory-watch-changed'));
  return n;
}
export function useMemoryWatch(): void {
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (!isTauri()) return;

    const startedAt = Date.now();
    let lastInputAt = Date.now();
    let lastRemindAt = 0;
    let cancelled = false;

    const markInput = () => {
      lastInputAt = Date.now();
    };
    window.addEventListener('keydown', markInput, true);
    window.addEventListener('mousedown', markInput, true);
    window.addEventListener('wheel', markInput, { capture: true, passive: true });

    const tick = async () => {
      if (cancelled) return;
      const mode = readMemoryWatchMode();
      if (mode === 'off') return;
      let rssMb: number;
      try {
        rssMb = (await getProcessMemory()).rss_mb;
      } catch {
        return;
      }
      if (cancelled) return;
      const threshold = readMemoryWatchMb();
      if (rssMb < threshold) return;
      if (Date.now() - startedAt < STARTUP_GRACE_MS) return;

      if (mode === 'reload') {
        if (Date.now() - lastInputAt < IDLE_MS) return;
        const lastReload = Number(sessionStorage.getItem(LAST_RELOAD_KEY) || '0');
        if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;
        sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
        persistAndReload();
        return;
      }

      if (Date.now() - lastRemindAt < REMIND_COOLDOWN_MS) return;
      lastRemindAt = Date.now();
      toast('warning', t('memory.highUsage', { mb: rssMb, threshold }));
    };

    const id = window.setInterval(() => {
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('keydown', markInput, true);
      window.removeEventListener('mousedown', markInput, true);
      window.removeEventListener('wheel', markInput, true);
    };
  }, [t, toast]);
}

export function useProcessMemory(): { rssMb: number; threshold: number; enabled: boolean; percent: number } {
  const [rssMb, setRssMb] = useState(0);
  const [threshold, setThreshold] = useState(readMemoryWatchMb);
  const [enabled, setEnabled] = useState(readMemoryWatchEnabled);

  useEffect(() => {
    const syncSettings = () => {
      setThreshold(readMemoryWatchMb());
      setEnabled(readMemoryWatchEnabled());
    };
    window.addEventListener('memory-watch-changed', syncSettings);
    if (!isTauri()) {
      return () => window.removeEventListener('memory-watch-changed', syncSettings);
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const rss = (await getProcessMemory()).rss_mb;
        if (!cancelled) setRssMb(rss);
      } catch {
        // ignore
      }
    };
    void tick();
    const id = window.setInterval(() => { void tick(); }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('memory-watch-changed', syncSettings);
    };
  }, []);

  const percent = threshold > 0 ? Math.min(100, Math.round((rssMb / threshold) * 100)) : 0;
  return { rssMb, threshold, enabled, percent };
}
