import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { callBackend, isTauri, openLink, getPlatform } from '../lib/backend';
import { getWebSocketManager } from '../lib/websocket';
import { TERMINAL } from '../constants';
import '@xterm/xterm/css/xterm.css';

const TERMINAL_THEME = {
  background: '#0f172a',
  foreground: '#cbd5e1',
  cursor: '#cbd5e1',
  cursorAccent: '#0f172a',
  selectionBackground: '#334155',
  black: '#1e293b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#f1f5f9',
  brightBlack: '#475569',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
} as const;

function writeToPty(sessionId: string, data: string) {
  if (!isTauri()) {
    getWebSocketManager().writePty(sessionId, data);
  } else {
    callBackend('pty_write', { sessionId, data }).catch(() => {});
  }
}

const TOOLBAR_BUTTONS = (() => {
  const isMac = getPlatform() === 'mac';
  return [
    { label: 'Esc', data: '\x1b' },
    { label: isMac ? '⌃C' : 'Ctrl+C', data: '\x03' },
    { label: isMac ? '⌃D' : 'Ctrl+D', data: '\x04' },
    { label: isMac ? '⌃Z' : 'Ctrl+Z', data: '\x1a' },
    { label: 'Tab', data: '\t' },
    { label: '←', data: '\x1b[D' },
    { label: '→', data: '\x1b[C' },
    { label: '↑', data: '\x1b[A' },
    { label: '↓', data: '\x1b[B' },
    { label: 'Home', data: '\x1b[H' },
    { label: 'End', data: '\x1b[F' },
  ];
})();

function MobileTerminalToolbar({ sessionId }: { sessionId: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-800/95 border-t border-slate-700/50 overflow-x-auto shrink-0 scrollbar-none">
      {TOOLBAR_BUTTONS.map((btn) => (
        <button
          key={btn.label}
          onPointerDown={(e) => {
            e.preventDefault();
            writeToPty(sessionId, btn.data);
          }}
          className="shrink-0 px-2.5 py-1 rounded-full bg-slate-700/80 text-slate-300 text-xs font-medium active:bg-slate-600 select-none touch-manipulation"
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
}

interface TerminalProps {
  cwd: string;
  visible: boolean;
  clientId?: string;
}

interface PtyOutputEventPayload {
  sessionId: string;
  data: string;
}

export interface TerminalHandle {
  copyContent: () => Promise<void>;
}

const TerminalInner = forwardRef<TerminalHandle, TerminalProps>(({ cwd, visible, clientId }, ref) => {
  // Keep desktop PTY on polling until the event-stream path can preserve replay semantics.
  const enableDesktopEventStreaming = false;
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // Extract actual cwd (remove #timestamp suffix if present)
  const actualCwd = cwd.split('#')[0];
  const sessionIdRef = useRef<string>(`pty-${cwd.replace(/[\/#]/g, '-')}`);
  const readerIntervalRef = useRef<number | null>(null);
  const wsSubscribedRef = useRef(false);
  const desktopUnlistenRef = useRef<UnlistenFn | null>(null);
  const desktopListenerStartingRef = useRef(false);
  const desktopListenerTokenRef = useRef(0);
  const desktopTransportRef = useRef<'event' | 'polling' | null>(null);
  const initializedRef = useRef(false);
  const cwdRef = useRef(actualCwd);
  const mouseSelectionRef = useRef({
    pressed: false,
    moved: false,
    startX: 0,
    startY: 0,
  });
  const [wsConnected, setWsConnected] = useState(!isTauri() ? getWebSocketManager().isConnected() : true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [initStatus, setInitStatus] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const gotFirstDataRef = useRef(false);

  // Detect mobile device on mount
  useEffect(() => {
    const checkMobile = () => {
      // Check for touch support and small screen
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(hasTouch && isSmallScreen);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCopy = useCallback(async () => {
    setContextMenu(null);
    const term = xtermRef.current;
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      try { await navigator.clipboard.writeText(selection); } catch { /* noop */ }
    }
    term.clearSelection();
  }, []);

  const handlePaste = useCallback(async () => {
    setContextMenu(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) writeToPty(sessionIdRef.current, text);
    } catch { /* noop */ }
  }, []);

  const handleClear = useCallback(() => {
    setContextMenu(null);
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  }, []);

  useImperativeHandle(ref, () => ({
    copyContent: async () => {
      const term = xtermRef.current;
      if (!term) return;
      term.selectAll();
      const selection = term.getSelection();
      if (selection) {
        try { await navigator.clipboard.writeText(selection); } catch { /* noop */ }
      }
      term.clearSelection();
    }
  }), []);

  const handleIncomingData = useCallback((data: string) => {
    if (!data || !xtermRef.current) return;
    if (!gotFirstDataRef.current) {
      gotFirstDataRef.current = true;
      setInitStatus(null);
    }
    xtermRef.current.write(data);

    if (!window._xtermRefreshed) {
      window._xtermRefreshed = true;
      setTimeout(() => {
        if (xtermRef.current) xtermRef.current.refresh(0, xtermRef.current.rows - 1);
      }, 100);
      setTimeout(() => {
        if (xtermRef.current) xtermRef.current.refresh(0, xtermRef.current.rows - 1);
      }, 500);
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    // Sync mobile detection for initial fontSize
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isSmallScreen = window.innerWidth < 768;
    const isMobileDevice = hasTouch && isSmallScreen;

    const term = new XTerm({
      theme: TERMINAL_THEME,
      fontSize: isMobileDevice ? 12 : 13,
      fontFamily: '"Maple Mono NF CN", Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: TERMINAL.SCROLLBACK_LINES,
      convertEol: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    // In Tauri, window.open() is blocked — use openLink() which
    // delegates to @tauri-apps/plugin-opener on desktop.
    const webLinksAddon = new WebLinksAddon((_event, uri) => openLink(uri));

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);

    // Let Alt+V pass through xterm for voice input
    term.attachCustomKeyEventHandler((e) => !(e.altKey && e.code === 'KeyV'));

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const resetStuckSelection = (forceClear = false) => {
      const selectionState = mouseSelectionRef.current;
      const shouldClear = forceClear || !selectionState.moved;
      selectionState.pressed = false;
      selectionState.moved = false;
      if (shouldClear) {
        term.clearSelection();
        term.focus();
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      mouseSelectionRef.current = {
        pressed: true,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
      };
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!mouseSelectionRef.current.pressed || mouseSelectionRef.current.moved) return;
      const dx = Math.abs(event.clientX - mouseSelectionRef.current.startX);
      const dy = Math.abs(event.clientY - mouseSelectionRef.current.startY);
      if (dx > 3 || dy > 3) {
        mouseSelectionRef.current.moved = true;
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (!mouseSelectionRef.current.pressed) return;
      // Preserve xterm's native word/line selection on double/triple click.
      const isMultiClickSelection = event.detail > 1;
      if (isMultiClickSelection) {
        mouseSelectionRef.current.pressed = false;
        mouseSelectionRef.current.moved = false;
        return;
      }
      resetStuckSelection(false);
    };

    const handleWindowBlur = () => {
      if (!mouseSelectionRef.current.pressed) return;
      resetStuckSelection(true);
    };

    terminalRef.current.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('blur', handleWindowBlur);

    // Mobile: single-finger touch scroll
    if (isMobile && terminalRef.current) {
      let touchStartY = 0;
      let scrollAccum = 0;
      let isDragging = false;

      const el = terminalRef.current;

      el.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          touchStartY = e.touches[0].clientY;
          scrollAccum = 0;
          isDragging = false;
        }
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
          const nowY = e.touches[0].clientY;
          const dy = touchStartY - nowY;
          // 8px threshold to avoid false triggers
          if (!isDragging && Math.abs(dy) > 8) {
            isDragging = true;
          }
          if (isDragging) {
            e.preventDefault();
            scrollAccum += dy;
            const lineHeight = 16;
            const lines = Math.trunc(scrollAccum / lineHeight);
            if (lines !== 0) {
              term.scrollLines(lines);
              scrollAccum -= lines * lineHeight;
            }
            touchStartY = nowY;
          }
        }
      }, { passive: false });

      el.addEventListener('touchend', () => {
        isDragging = false;
        scrollAccum = 0;
      }, { passive: true });
    }


    term.onData((data) => {
      writeToPty(sessionIdRef.current, data);
    });

    return () => {
      terminalRef.current?.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('blur', handleWindowBlur);
      term.dispose();
      xtermRef.current = null;
    };
  }, []);

  const startReading = useCallback(() => {
    const startDesktopPolling = () => {
      if (readerIntervalRef.current) return;
      desktopTransportRef.current = 'polling';

      const scheduleNext = () => {
        readerIntervalRef.current = window.setTimeout(readLoop, TERMINAL.POLL_INTERVAL_MS);
      };

      const readLoop = async () => {
        try {
          const data = await callBackend<string>('pty_read', {
            sessionId: sessionIdRef.current,
            ...(clientId ? { clientId } : {}),
          });
          handleIncomingData(data);
        } catch { /* noop */ }

        if (readerIntervalRef.current !== null) {
          scheduleNext();
        }
      };

      scheduleNext();
    };

    if (!isTauri()) {
      // Browser mode: WS subscribe is idempotent
      if (wsSubscribedRef.current) return;
      wsSubscribedRef.current = true;
      getWebSocketManager().subscribePty(sessionIdRef.current, (data) => {
        handleIncomingData(data);
      });
    } else {
      if (!enableDesktopEventStreaming) {
        startDesktopPolling();
        return;
      }

      if (desktopUnlistenRef.current || desktopListenerStartingRef.current) return;
      if (desktopTransportRef.current === 'polling') {
        startDesktopPolling();
        return;
      }

      desktopListenerStartingRef.current = true;
      const token = ++desktopListenerTokenRef.current;

      void import('@tauri-apps/api/event')
        .then(async ({ listen }) => {
          const unlisten = await listen<PtyOutputEventPayload>('pty-output', (event) => {
            if (event.payload?.sessionId !== sessionIdRef.current) return;
            handleIncomingData(event.payload.data);
          });

          if (desktopListenerTokenRef.current !== token) {
            unlisten();
            return;
          }

          desktopTransportRef.current = 'event';
          desktopUnlistenRef.current = () => {
            unlisten();
            desktopUnlistenRef.current = null;
            if (desktopTransportRef.current === 'event') {
              desktopTransportRef.current = null;
            }
          };
        })
        .catch(() => {
          if (desktopListenerTokenRef.current === token) {
            startDesktopPolling();
          }
        })
        .finally(() => {
          if (desktopListenerTokenRef.current === token) {
            desktopListenerStartingRef.current = false;
          }
        });
    }
  }, [enableDesktopEventStreaming, handleIncomingData]);

  // Initialize PTY session
  const initPty = useCallback(async () => {
    const term = xtermRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    setInitStatus('Preparing terminal...');
    setInitError(null);
    gotFirstDataRef.current = false;

    try {
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise(r => setTimeout(r, 100))
        ]);
      } catch (e) { /* ignore */ }

      try {
        fitAddon.fit();
      } catch (e) {
        console.warn('[terminal] fitAddon.fit() failed during init', e);
      }

      const cols = Math.max(term.cols || 80, 2);
      const rows = Math.max(term.rows || 24, 2);

      setInitStatus('Checking session...');

      const exists = await callBackend<boolean>('pty_exists', {
        sessionId: sessionIdRef.current,
      });

      if (!exists) {
        setInitStatus('Creating PTY session...');
        const shell = localStorage.getItem('preferred_terminal') || undefined;
        await callBackend('pty_create', {
          sessionId: sessionIdRef.current,
          cwd: cwdRef.current,
          cols,
          rows,
          shell: shell && shell !== 'auto' ? shell : undefined,
        });
      } else {
        setInitStatus('Restoring session...');
      }

      if (exists && isTauri()) {
        setInitStatus('Restoring buffered output...');
        try {
          const data = await callBackend<string>('pty_read', {
            sessionId: sessionIdRef.current,
            ...(clientId ? { clientId } : {}),
          });
          handleIncomingData(data);
        } catch {
          // Event stream will still resume live output even if restore failed.
        }
      }

      setInitStatus('Subscribing output...');
      initializedRef.current = true;
      startReading();

      // Deferred resize
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (fitAddonRef.current && xtermRef.current) {
            try { fitAddonRef.current.fit(); } catch (e) { /* ignore */ }
            const newCols = Math.max(xtermRef.current.cols || 80, 2);
            const newRows = Math.max(xtermRef.current.rows || 24, 2);
            if (newCols !== cols || newRows !== rows || exists) {
              callBackend('pty_resize', {
                sessionId: sessionIdRef.current,
                cols: newCols,
                rows: newRows,
                ...(clientId ? { clientId } : {}),
              }).catch(() => { });
            }
          }
        }, 100);
      });

      setInitStatus('Waiting for output...');

      // If existing session, data may already be available — give 2s grace period
      if (exists) {
        setTimeout(() => {
          if (!gotFirstDataRef.current) setInitStatus(null);
        }, 2000);
      }

    } catch (e) {
      setInitStatus(null);
      setInitError(String(e));
      console.error('[terminal] Failed to initialize PTY:', e);
    }
  }, [clientId, handleIncomingData, startReading]);

  // Create PTY session on first visibility
  useEffect(() => {
    if (!xtermRef.current || !visible || initializedRef.current) return;
    initPty();
  }, [visible, initPty]);


  const stopReading = useCallback(() => {
    if (!isTauri() && wsSubscribedRef.current) {
      wsSubscribedRef.current = false;
      getWebSocketManager().unsubscribePty(sessionIdRef.current);
    }
    desktopListenerTokenRef.current += 1;
    desktopListenerStartingRef.current = false;
    if (desktopUnlistenRef.current) {
      desktopUnlistenRef.current();
    }
    if (readerIntervalRef.current !== null) {
      clearTimeout(readerIntervalRef.current);
      readerIntervalRef.current = null;
    }
    if (desktopTransportRef.current === 'polling') {
      desktopTransportRef.current = null;
    }
  }, []);


  const handleResize = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current || !visible || !initializedRef.current) return;

    try { fitAddonRef.current.fit(); } catch (e) { /* ignore */ }
    const cols = Math.max(xtermRef.current.cols || 80, 2);
    const rows = Math.max(xtermRef.current.rows || 24, 2);

    callBackend('pty_resize', {
      sessionId: sessionIdRef.current,
      cols,
      rows,
      ...(clientId ? { clientId } : {}),
    }).catch(() => { /* noop */ });
  }, [visible, clientId]);


  useEffect(() => {
    if (!initializedRef.current) return;

    if (visible) {
      if (isTauri()) startReading();
      // Small delay ensures DOM is fully rendered before resize
      const resizeTimer = setTimeout(() => {
        handleResize();
      }, 50);
      return () => clearTimeout(resizeTimer);
    }
    // Desktop terminals stay mounted across worktree switches to preserve PTY state,
    // so keep draining output even while hidden. Stopping polling here can let large
    // bursts accumulate and eventually overflow any intermediate buffers.
  }, [visible, startReading, stopReading, handleResize]);

  // ResizeObserver for container size changes
  useEffect(() => {
    if (!terminalRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (visible) {
        handleResize();
      }
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [visible, handleResize]);

  // Cleanup on unmount — stop reading only (PTY sessions persist like tmux)
  useEffect(() => {
    return () => {
      stopReading();
    };
  }, [stopReading]);

  // Browser mode: track WS connection state and re-subscribe on reconnect
  useEffect(() => {
    if (isTauri()) return;
    const wsMgr = getWebSocketManager();
    const unsub = wsMgr.onConnectionStateChange((connected) => {
      setWsConnected(connected);
      // On reconnect, re-subscribe if we had an active session
      if (connected && initializedRef.current && wsSubscribedRef.current) {
        console.log('[terminal] WS reconnected, re-subscribing PTY:', sessionIdRef.current);
        wsMgr.subscribePty(sessionIdRef.current, (data) => {
          handleIncomingData(data);
        });
      }
    });
    return unsub;
  }, [handleIncomingData]);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 relative" onContextMenu={handleContextMenu}>
        <div
          ref={terminalRef}
          className="h-full w-full overflow-hidden"
          style={{ padding: '4px 8px', background: '#0f172a' }}
        />

        {/* Initializing overlay */}
        {(initStatus || initError) && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm z-20">
            <div className="flex flex-col items-center gap-3">
              {initStatus ? (
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-slate-300 text-sm font-medium">{initStatus}</span>
                </div>
              ) : initError ? (
                <>
                  <div className="flex items-center gap-2 text-red-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium">Connection failed</span>
                  </div>
                  <p className="text-slate-400 text-xs max-w-xs text-center">{initError}</p>
                  <button
                    onClick={() => {
                      initializedRef.current = false;
                      initPty();
                    }}
                    className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Retry
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}

        {/* WS connection status overlay (browser mode only) */}
        {!isTauri() && !wsConnected && (
          <div className="absolute inset-0 flex items-end justify-center pointer-events-none z-10 pb-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-900/80 backdrop-blur-sm border border-amber-700/50 text-amber-300 text-xs font-medium shadow-lg pointer-events-auto">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Reconnecting...
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          >
            <div
              className="absolute bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[140px]"
              style={{ left: Math.min(contextMenu.x, window.innerWidth - 140), top: Math.min(contextMenu.y, window.innerHeight - 150) }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleCopy}
                className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                </svg>
                {t('terminal.copyContent')}
              </button>
              <button
                onClick={handlePaste}
                className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-slate-700 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                {t('terminal.paste')}
              </button>
              <div className="border-t border-slate-700 my-1" />
              <button
                onClick={handleClear}
                className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-slate-700 hover:text-red-300 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {t('terminal.clear')}
              </button>
            </div>
          </div>
        )}
      </div>
      {isMobile && <MobileTerminalToolbar sessionId={sessionIdRef.current} />}
    </div>
  );
});
declare global {
  interface Window {
    _xtermRefreshed?: boolean;
  }
}

export const Terminal = memo(TerminalInner);
