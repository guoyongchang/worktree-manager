import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { callBackend, isTauri, openLink } from '../lib/backend';
import { getWebSocketManager } from '../lib/websocket';
import { TERMINAL } from '../constants';
import '@xterm/xterm/css/xterm.css';

const IS_MOBILE = typeof window !== 'undefined' && 'ontouchstart' in window;

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

interface TerminalProps {
  cwd: string;
  visible: boolean;
  clientId?: string;
}

export interface TerminalHandle {
  copyContent: () => Promise<void>;
}

const TerminalInner = forwardRef<TerminalHandle, TerminalProps>(({ cwd, visible, clientId }, ref) => {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // Extract actual cwd (remove #timestamp suffix if present)
  const actualCwd = cwd.split('#')[0];
  const sessionIdRef = useRef<string>(`pty-${cwd.replace(/[\/#]/g, '-')}`);
  const readerIntervalRef = useRef<number | null>(null);
  const wsSubscribedRef = useRef(false);
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
      if (text) {
        if (!isTauri()) {
          getWebSocketManager().writePty(sessionIdRef.current, text);
        } else {
          await callBackend('pty_write', {
            sessionId: sessionIdRef.current,
            data: text,
          });
        }
      }
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

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new XTerm({
      theme: TERMINAL_THEME,
      fontSize: IS_MOBILE ? 12 : 13,
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

    const handleMouseUp = () => {
      if (!mouseSelectionRef.current.pressed) return;
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
    if (IS_MOBILE && terminalRef.current) {
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


    term.onData(async (data) => {
      try {
        if (!isTauri()) {
          getWebSocketManager().writePty(sessionIdRef.current, data);
        } else {
          await callBackend('pty_write', {
            sessionId: sessionIdRef.current,
            data,
          });
        }
      } catch { /* noop */ }
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

  // Create PTY session on first visibility
  useEffect(() => {
    if (!xtermRef.current || !visible || initializedRef.current) return;

    const initPty = async () => {
      const term = xtermRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term || !fitAddon) return;

      try {
        try {
          // Promise.race so Safari doesn't hang forever on document.fonts.ready
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


        const exists = await callBackend<boolean>('pty_exists', {
          sessionId: sessionIdRef.current,
        });

        if (!exists) {
          const shell = localStorage.getItem('preferred_terminal') || undefined;
          await callBackend('pty_create', {
            sessionId: sessionIdRef.current,
            cwd: cwdRef.current,
            cols,
            rows,
            shell: shell && shell !== 'auto' ? shell : undefined,
          });
        }

        initializedRef.current = true;

        startReading();

        // Deferred resize: fitAddon.fit() during init may run before CSS layout
        // is complete, giving default 80×24. RAF + timeout ensures final dimensions.
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

      } catch (e) {
        term.write(`\r\n\x1b[31mFailed to create terminal: ${e}\x1b[0m\r\n`);
      }
    };

    initPty();
  }, [visible]);


  const startReading = useCallback(() => {
    if (!isTauri()) {
      // Browser mode: WS subscribe is idempotent
      if (wsSubscribedRef.current) return;
      wsSubscribedRef.current = true;
      getWebSocketManager().subscribePty(sessionIdRef.current, (data) => {
        if (data && xtermRef.current) {
          xtermRef.current.write(data);

          // Force a few frame refreshes to defeat iOS Safari canvas bugs
          // where the terminal stays blank if it received data while layout was settling.
          if (!window._xtermRefreshed) {
            window._xtermRefreshed = true;
            setTimeout(() => {
              if (xtermRef.current) xtermRef.current.refresh(0, xtermRef.current.rows - 1);
            }, 100);
            setTimeout(() => {
              if (xtermRef.current) xtermRef.current.refresh(0, xtermRef.current.rows - 1);
            }, 500);
          }
        }
      });
    } else {
      // Tauri desktop: chained setTimeout polling (avoids request pile-up from setInterval)
      if (readerIntervalRef.current) return;

      const scheduleNext = () => {
        readerIntervalRef.current = window.setTimeout(readLoop, TERMINAL.POLL_INTERVAL_MS);
      };

      const readLoop = async () => {
        try {
          const data = await callBackend<string>('pty_read', {
            sessionId: sessionIdRef.current,
          });
          if (data && xtermRef.current) {
            xtermRef.current.write(data);
          }
        } catch { /* noop */ }

        if (readerIntervalRef.current !== null) {
          scheduleNext();
        }
      };

      scheduleNext();
    }
  }, []);

  const stopReading = useCallback(() => {
    if (!isTauri() && wsSubscribedRef.current) {
      wsSubscribedRef.current = false;
      getWebSocketManager().unsubscribePty(sessionIdRef.current);
    }
    if (readerIntervalRef.current !== null) {
      clearTimeout(readerIntervalRef.current);
      readerIntervalRef.current = null;
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
    } else {
      if (isTauri()) stopReading();
    }
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
          if (data && xtermRef.current) {
            xtermRef.current.write(data);
          }
        });
      }
    });
    return unsub;
  }, []);

  return (
    <div className="h-full w-full relative overflow-hidden" onContextMenu={handleContextMenu}>
      <div
        ref={terminalRef}
        className="h-full w-full overflow-hidden"
        style={{ padding: '4px 8px', background: '#0f172a' }}
      />
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
  );
});
declare global {
  interface Window {
    _xtermRefreshed?: boolean;
  }
}

export const Terminal = memo(TerminalInner);
