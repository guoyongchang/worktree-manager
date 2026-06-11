import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { callBackend, isTauri, openLink, getPlatform } from '../lib/backend';
import { getPreferredPtyShell, getTerminalPreferenceDebugInfo, logTerminalPreferenceDebugInfo } from '../lib/terminalPreferences';
import { getWebSocketManager } from '../lib/websocket';
import { TERMINAL } from '../constants';
import { TerminalRegistry } from '../terminal';
import type { TerminalAdapter, Disposable, SearchOptions } from '../terminal';

function writeToPty(sessionId: string, data: string) {
  if (!isTauri()) {
    getWebSocketManager().writePty(sessionId, data);
  } else {
    callBackend('pty_write', { sessionId, data }).catch(() => {});
  }
}

const TOOLBAR_BUTTONS = (() => {
  const isMac = getPlatform() === 'mac';
  const buttons: { label: string; data: string; confirm: boolean }[] = [
    { label: 'Esc', data: '\x1b', confirm: true },
    { label: isMac ? '⌃C' : 'Ctrl+C', data: '\x03', confirm: true },
    ...(!isMac ? [{ label: 'Ctrl+D', data: '\x04', confirm: true }] : []),
    { label: isMac ? '⌃Z' : 'Ctrl+Z', data: '\x1a', confirm: true },
    { label: 'Tab', data: '\t', confirm: false },
    { label: '←', data: '\x1b[D', confirm: false },
    { label: '→', data: '\x1b[C', confirm: false },
    { label: '↑', data: '\x1b[A', confirm: false },
    { label: '↓', data: '\x1b[B', confirm: false },
    { label: 'Home', data: '\x1b[H', confirm: false },
    { label: 'End', data: '\x1b[F', confirm: false },
  ];
  return buttons;
})();

const DEBUG_INFO_ROW_GROUPS = [
  ['Session ID', 'Window Label', 'Platform'],
  ['Source', 'App Logs'],
  ['Terminal Size', 'Viewport Size'],
  ['Preferred Terminal', 'Preferred Shell'],
  ['Tool Paths Terminal', 'Tool Paths Terminal Custom'],
  ['Tool Paths Shell', 'Resolved External Terminal'],
  ['Resolved PTY Shell', 'Resolved Launch Shell'],
  ['WS Connected', 'Client ID'],
  ['Initialized', 'Init Status', 'Init Error'],
  ['Got First Data', 'Is Mobile', 'Has Selection'],
  ['Renderer', 'Unicode Version', 'Loaded Add-ons'],
];

const DEBUG_INFO_WIDE_KEYS = new Set([
  'Working Path',
  'Detected Terminals',
  'Detected Shells',
  'Font',
  'User Agent',
  'Current Time',
]);

function MobileTerminalToolbar({
  sessionId,
  onResize,
  onDebug,
}: {
  sessionId: string;
  onResize?: () => void;
  onDebug?: () => void;
}) {
  const [pendingBtn, setPendingBtn] = useState<string | null>(null);
  const [sentToast, setSentToast] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Click outside toolbar / timeout clears pending state
  useEffect(() => {
    if (!pendingBtn) return;
    const timer = setTimeout(() => setPendingBtn(null), 2000);
    const handleOutside = (e: PointerEvent) => {
      // Don't clear if the tap is inside the toolbar (let onClick handle it)
      if (toolbarRef.current?.contains(e.target as Node)) return;
      setPendingBtn(null);
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handleOutside);
    };
  }, [pendingBtn]);

  const showSentToast = (label: string) => {
    setSentToast(label);
    setTimeout(() => setSentToast(null), 800);
  };

  const handleBtn = (btn: typeof TOOLBAR_BUTTONS[0]) => {
    // Blur any focused element to prevent keyboard popup
    (document.activeElement as HTMLElement)?.blur();

    if (btn.confirm) {
      if (pendingBtn === btn.label) {
        // Second tap — execute
        writeToPty(sessionId, btn.data);
        setPendingBtn(null);
        showSentToast(btn.label);
      } else {
        // First tap — highlight
        setPendingBtn(btn.label);
      }
    } else {
      // No confirmation needed (arrows, tab, etc.)
      writeToPty(sessionId, btn.data);
      setPendingBtn(null);
    }
  };

  return (
    <div ref={toolbarRef} className="flex items-center gap-1.5 px-2 py-1.5 bg-[var(--color-bg-surface)]/95 border-t border-[var(--color-border)]/50 overflow-x-auto shrink-0 scrollbar-none"
      style={{ touchAction: 'pan-x' }}
    >
      {TOOLBAR_BUTTONS.map((btn) => (
        <button
          key={btn.label}
          onClick={() => handleBtn(btn)}
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium select-none touch-manipulation transition-colors ${
            pendingBtn === btn.label
              ? 'bg-yellow-600/90 text-yellow-100 ring-1 ring-yellow-400'
              : 'bg-[var(--color-bg-elevated)]/80 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]'
          }`}
        >
          {btn.label}
        </button>
      ))}
      {onResize && (
        <button
          onClick={() => {
            (document.activeElement as HTMLElement)?.blur();
            onResize();
          }}
          className="shrink-0 px-2.5 py-1 rounded-full bg-[var(--color-accent)]/80 text-[var(--color-accent)] text-xs font-medium active:bg-[var(--color-accent)] select-none touch-manipulation"
        >
          Resize
        </button>
      )}
      {onDebug && (
        <button
          onClick={() => {
            (document.activeElement as HTMLElement)?.blur();
            onDebug();
          }}
          className="shrink-0 px-2.5 py-1 rounded-full bg-amber-700/80 text-amber-200 text-xs font-medium active:bg-amber-600 select-none touch-manipulation"
        >
          Debug
        </button>
      )}
      {sentToast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] px-4 py-2 rounded-lg bg-[var(--color-success)]/95 text-[var(--color-text-primary)] text-sm font-medium shadow-lg pointer-events-none animate-pulse">
          {sentToast} sent
        </div>
      )}
    </div>
  );
}

interface TerminalProps {
  cwd: string;
  visible: boolean;
  clientId?: string;
  voiceStatus?: 'idle' | 'ready' | 'recording' | 'error';
  onShellIntegrationDetected?: () => void;
  onCwdChanged?: (cwd: string) => void;
  onSearchRequested?: () => void;
  onRendererFallback?: () => void;
}

interface PtyOutputEventPayload {
  sessionId: string;
  data: string;
}

export interface TerminalHandle {
  copyContent: () => Promise<void>;
  scrollToCommand: (direction: 'prev' | 'next') => void;
  findNext: (query: string, options?: SearchOptions) => boolean;
  findPrevious: (query: string, options?: SearchOptions) => boolean;
  clearSearch: () => void;
  isInitializing: () => boolean;
}

const TerminalInner = forwardRef<TerminalHandle, TerminalProps>(({ cwd, visible, clientId, voiceStatus = 'idle', onShellIntegrationDetected, onCwdChanged, onSearchRequested, onRendererFallback }, ref) => {
  // Keep desktop PTY on polling until the event-stream path can preserve replay semantics.
  const enableDesktopEventStreaming = false;
  useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<TerminalAdapter | null>(null);
  // Extract actual cwd (remove #timestamp suffix if present)
  const actualCwd = cwd.split('#')[0];
  // Session ID includes the full cwd (with #timestamp for duplicated terminals)
  // so each terminal tab gets its own PTY session
  const sessionIdRef = useRef<string>(`pty-${cwd.replace(/[/\\/#]/g, '-')}`);
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
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const initStatusRef = useRef<string | null>(null);
  const [initStatus, setInitStatus] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [reinitTrigger, setReinitTrigger] = useState(0);
  const reinitTriggerRef = useRef(0);
  const gotFirstDataRef = useRef(false);
  const mountedRef = useRef(false);
  const shellIntDetectedRef = useRef(false);
  const onShellIntDetectedRef = useRef(onShellIntegrationDetected);
  onShellIntDetectedRef.current = onShellIntegrationDetected;
  const onCwdChangedRef = useRef(onCwdChanged);
  onCwdChangedRef.current = onCwdChanged;
  const voiceStatusRef = useRef(voiceStatus);
  voiceStatusRef.current = voiceStatus;
  const onSearchRequestedRef = useRef(onSearchRequested);
  onSearchRequestedRef.current = onSearchRequested;
  const onRendererFallbackRef = useRef(onRendererFallback);
  onRendererFallbackRef.current = onRendererFallback;
  const keyDisposableRef = useRef<Disposable | null>(null);
  const inputDisposableRef = useRef<Disposable | null>(null);
  const shellIntCmdSubRef = useRef<Disposable | null>(null);
  const shellIntCwdSubRef = useRef<Disposable | null>(null);
  const mouseHandlersRef = useRef<{
    handleMouseDown: (e: MouseEvent) => void;
    handleMouseMove: (e: MouseEvent) => void;
    handleMouseUp: (e: MouseEvent) => void;
    handleWindowBlur: () => void;
  } | null>(null);
  const touchHandlersRef = useRef<{
    el: HTMLElement;
    handleTouchStart: (e: TouchEvent) => void;
    handleTouchMove: (e: TouchEvent) => void;
    handleTouchEnd: () => void;
  } | null>(null);
  const pasteHandlerRef = useRef<{
    el: HTMLElement;
    handlePaste: (e: ClipboardEvent) => void;
  } | null>(null);
  const pendingPasteFallbackRef = useRef<number | null>(null);
  const recentFallbackPasteRef = useRef<{
    text: string;
    timestamp: number;
  } | null>(null);

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

  // Sync initStatusRef so isInitializing() always returns the latest value
  useEffect(() => {
    initStatusRef.current = initStatus;
  }, [initStatus]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  const handleCopy = useCallback(() => {
    if (adapterRef.current) {
      const selection = adapterRef.current.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    }
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  const sendPastedText = useCallback((text: string, source: 'clipboard-event' | 'fallback' | 'menu' = 'clipboard-event') => {
    if (!text) return;
    const normalizedText = text.replace(/\r\n?/g, '\n');
    const recentFallbackPaste = recentFallbackPasteRef.current;
    if (
      source === 'clipboard-event' &&
      recentFallbackPaste &&
      recentFallbackPaste.text === normalizedText &&
      Date.now() - recentFallbackPaste.timestamp < 150
    ) {
      recentFallbackPasteRef.current = null;
      return;
    }
    if (source === 'fallback') {
      recentFallbackPasteRef.current = { text: normalizedText, timestamp: Date.now() };
    } else if (recentFallbackPaste && Date.now() - recentFallbackPaste.timestamp >= 150) {
      recentFallbackPasteRef.current = null;
    }
    const isMultiline = /[\r\n]/.test(text);
    if (adapterRef.current) {
      adapterRef.current.paste(text, { forceBracketed: isMultiline });
    } else {
      const fallback = isMultiline
        ? `\x1b[200~${text.replace(/\r\n|\r|\n/g, '\r')}\x1b[201~`
        : text;
      writeToPty(sessionIdRef.current, fallback);
    }
    adapterRef.current?.focus();
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      sendPastedText(text, 'menu');
    } catch {
      // Ignore paste errors
    }
    handleCloseContextMenu();
  }, [handleCloseContextMenu, sendPastedText]);

  const handleClear = useCallback(() => {
    adapterRef.current?.clear();
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  const [debugInfo, setDebugInfo] = useState<{
    visible: boolean;
    data: Record<string, string>;
  }>({ visible: false, data: {} });
  const [debugInfoCopied, setDebugInfoCopied] = useState(false);

  const handleShowDebugInfo = useCallback(async () => {
    const windowLabel = isTauri()
      ? await import('@tauri-apps/api/window').then(m => m.getCurrentWindow().label).catch(() => 'unknown')
      : 'browser';
    const cols = adapterRef.current?.cols ?? 0;
    const rows = adapterRef.current?.rows ?? 0;
    const selection = adapterRef.current?.getSelection() ?? '';
    const adapterDebug = adapterRef.current?.getDebugInfo?.() ?? {};
    const terminalPreferenceDebug = getTerminalPreferenceDebugInfo();
    setDebugInfoCopied(false);
    setDebugInfo({
      visible: true,
      data: {
        'Session ID': sessionIdRef.current,
        'Working Path': actualCwd,
        'Window Label': windowLabel,
        'Source': isTauri() ? 'Desktop (Tauri IPC)' : 'Browser (HTTP/WebSocket)',
        'Platform': getPlatform(),
        'App Logs': isTauri() ? 'Settings/sidebar log button -> worktree-manager.log' : 'N/A (browser)',
        'Terminal Size': `${cols} cols x ${rows} rows`,
        'Viewport Size': `${window.innerWidth} x ${window.innerHeight}`,
        ...terminalPreferenceDebug,
        ...adapterDebug,
        'User Agent': navigator.userAgent,
        'WS Connected': isTauri() ? 'N/A (desktop)' : String(wsConnected),
        'Client ID': clientId || 'N/A',
        'Initialized': String(initializedRef.current),
        'Init Status': initStatus || 'none',
        'Init Error': initError || 'none',
        'Got First Data': String(gotFirstDataRef.current),
        'Is Mobile': String(isMobile),
        'Has Selection': selection ? `${selection.length} chars` : 'no',
        'Current Time': new Date().toISOString(),
      },
    });
    handleCloseContextMenu();
  }, [actualCwd, clientId, wsConnected, initStatus, initError, isMobile, handleCloseContextMenu]);

  const handleCloseDebugInfo = useCallback(() => {
    setDebugInfoCopied(false);
    setDebugInfo(prev => ({ ...prev, visible: false }));
  }, []);

  const handleCopyDebugInfo = useCallback(async () => {
    const text = Object.entries(debugInfo.data)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setDebugInfoCopied(true);
      window.setTimeout(() => setDebugInfoCopied(false), 1500);
    } catch {
      setDebugInfoCopied(false);
    }
  }, [debugInfo.data]);

  const debugInfoRows = (() => {
    const consumed = new Set<string>();
    const rows: Array<Array<[string, string]>> = [];

    for (const group of DEBUG_INFO_ROW_GROUPS) {
      const fields = group
        .map((key) => {
          const value = debugInfo.data[key];
          return value === undefined ? null : ([key, value] as [string, string]);
        })
        .filter((field): field is [string, string] => field !== null);

      if (fields.length > 0) {
        fields.forEach(([key]) => consumed.add(key));
        rows.push(fields);
      }
    }

    for (const [key, value] of Object.entries(debugInfo.data)) {
      if (consumed.has(key)) continue;
      rows.push([[key, value]]);
    }

    return rows;
  })();

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      setContextMenu({ visible: true, x: touch.clientX, y: touch.clientY });
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    copyContent: async () => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      adapter.selectAll();
      const selection = adapter.getSelection();
      if (selection) {
        try { await navigator.clipboard.writeText(selection); } catch { /* noop */ }
      }
      adapter.clearSelection();
    },
    scrollToCommand: (direction: 'prev' | 'next') => {
      adapterRef.current?.scrollToCommand?.(direction);
    },
    findNext: (query: string, options?: SearchOptions) => {
      return adapterRef.current?.findNext?.(query, options) ?? false;
    },
    findPrevious: (query: string, options?: SearchOptions) => {
      return adapterRef.current?.findPrevious?.(query, options) ?? false;
    },
    clearSearch: () => {
      adapterRef.current?.clearSearch?.();
    },
    isInitializing: () => initStatusRef.current !== null,
  }), []);

  const handleIncomingData = useCallback((data: string) => {
    if (!data || !adapterRef.current) return;
    if (!gotFirstDataRef.current) {
      gotFirstDataRef.current = true;
      setInitStatus(null);
    }
    adapterRef.current.write(data);

    if (!window._terminalRefreshed) {
      window._terminalRefreshed = true;
      setTimeout(() => {
        if (adapterRef.current) adapterRef.current.refresh(0, adapterRef.current.rows - 1);
      }, 100);
      setTimeout(() => {
        if (adapterRef.current) adapterRef.current.refresh(0, adapterRef.current.rows - 1);
      }, 500);
    }
  }, []);

  useEffect(() => {
    if (!terminalRef.current || adapterRef.current) return;

    const adapter = TerminalRegistry.create();
    adapterRef.current = adapter;

    return () => {
      mountedRef.current = false;

      // Clean up mouse handlers
      const handlers = mouseHandlersRef.current;
      if (handlers) {
        terminalRef.current?.removeEventListener('mousedown', handlers.handleMouseDown, true);
        window.removeEventListener('mousemove', handlers.handleMouseMove, true);
        window.removeEventListener('mouseup', handlers.handleMouseUp, true);
        window.removeEventListener('blur', handlers.handleWindowBlur);
        mouseHandlersRef.current = null;
      }

      // Clean up touch handlers
      const touchH = touchHandlersRef.current;
      if (touchH) {
        touchH.el.removeEventListener('touchstart', touchH.handleTouchStart);
        touchH.el.removeEventListener('touchmove', touchH.handleTouchMove);
        touchH.el.removeEventListener('touchend', touchH.handleTouchEnd);
        touchHandlersRef.current = null;
      }

      const pasteH = pasteHandlerRef.current;
      if (pasteH) {
        pasteH.el.removeEventListener('paste', pasteH.handlePaste, true);
        pasteHandlerRef.current = null;
      }

      if (pendingPasteFallbackRef.current !== null) {
        clearTimeout(pendingPasteFallbackRef.current);
        pendingPasteFallbackRef.current = null;
      }

      // Clean up disposables
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      keyDisposableRef.current?.dispose();
      keyDisposableRef.current = null;

      // Clean up shell integration subscriptions
      shellIntCmdSubRef.current?.dispose();
      shellIntCmdSubRef.current = null;
      shellIntCwdSubRef.current?.dispose();
      shellIntCwdSubRef.current = null;

      adapter.dispose();
      adapterRef.current = null;
    };
  }, []);

  const startReading = useCallback(() => {
    const startDesktopPolling = () => {
      if (readerIntervalRef.current) return;
      desktopTransportRef.current = 'polling';

      const scheduleNext = () => {
        readerIntervalRef.current = window.setTimeout(readLoop, TERMINAL.POLL_INTERVAL_MS);
      };

      let sessionNotFoundCount = 0;

      const readLoop = async () => {
        try {
          const data = await callBackend<string>('pty_read', {
            sessionId: sessionIdRef.current,
            ...(clientId ? { clientId } : {}),
          });
          handleIncomingData(data);
          sessionNotFoundCount = 0;
        } catch (err) {
          if (typeof err === 'string' && err.includes('Session not found') ||
              err instanceof Error && err.message.includes('Session not found')) {
            sessionNotFoundCount++;
            if (sessionNotFoundCount >= 3) {
              console.warn('[terminal] PTY session lost, stopping poll and triggering re-init');
              if (readerIntervalRef.current !== null) {
                clearTimeout(readerIntervalRef.current);
                readerIntervalRef.current = null;
              }
              desktopTransportRef.current = null;
              // Reset initialized flag so the visibility useEffect re-triggers initPty
              initializedRef.current = false;
              reinitTriggerRef.current++;
              setReinitTrigger(r => r + 1);
              return;
            }
          }
        }

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
    const adapter = adapterRef.current;
    if (!adapter || !terminalRef.current) return;

    setInitStatus('Preparing terminal...');
    setInitError(null);
    gotFirstDataRef.current = false;

    try {
      // --- Mount adapter (async to support future WASM-based adapters) ---
      if (!mountedRef.current) {
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        const isSmallScreen = window.innerWidth < 768;
        const isMobileDevice = hasTouch && isSmallScreen;

        await adapter.mount(terminalRef.current, {
          fontSize: isMobileDevice ? 12 : 13,
          fontFamily: '"Maple Mono NF CN", Menlo, Monaco, "Courier New", monospace',
          cursorBlink: true,
          cursorStyle: 'bar' as const,
          scrollback: TERMINAL.SCROLLBACK_LINES,
          linkHandler: (uri) => openLink(uri),
          onRendererFallback: () => onRendererFallbackRef.current?.(),
        });

        // Check if component was unmounted during async mount
        if (!adapterRef.current) return;

        mountedRef.current = true;

        // On mobile, prevent soft keyboard from popping up on casual touch.
        if (isMobileDevice) {
          adapter.setMobileKeyboardPolicy('none');
        }

        // Key handler: Ctrl/Cmd+F for search, Alt+V passthrough for voice
        const keyDisposable = adapter.onKeyEvent((e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            onSearchRequestedRef.current?.();
            return false;
          }
          const isPasteShortcut =
            !e.repeat &&
            (((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'KeyV') ||
              (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'Insert'));
          if (isPasteShortcut) {
            // Block xterm from handling paste to avoid:
            // - Duplicate paste on Windows (xterm has built-in Ctrl+V handling)
            // - macOS clipboard permission popup (xterm may call navigator.clipboard.readText())
            // Returning false does NOT preventDefault — the browser still fires the native
            // paste ClipboardEvent, which handleTerminalPaste catches via event.clipboardData.
            return false;
          }
          if (e.altKey && e.code === 'KeyV') {
            return !(voiceStatusRef.current === 'ready' || voiceStatusRef.current === 'recording');
          }
          return true;
        });
        keyDisposableRef.current = keyDisposable;

        const handleTerminalPaste = (event: ClipboardEvent) => {
          const target = event.target;
          if (!(target instanceof Node) || !terminalRef.current?.contains(target)) return;

          if (pendingPasteFallbackRef.current !== null) {
            clearTimeout(pendingPasteFallbackRef.current);
            pendingPasteFallbackRef.current = null;
          }

          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (!text) return;

          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          sendPastedText(text, 'clipboard-event');
        };

        terminalRef.current.addEventListener('paste', handleTerminalPaste, true);
        pasteHandlerRef.current = {
          el: terminalRef.current,
          handlePaste: handleTerminalPaste,
        };

        // Mouse selection handling
        const resetStuckSelection = (forceClear = false) => {
          const selectionState = mouseSelectionRef.current;
          const shouldClear = forceClear || !selectionState.moved;
          selectionState.pressed = false;
          selectionState.moved = false;
          if (shouldClear) {
            adapter.clearSelection();
            adapter.focus();
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

        // Store cleanup references
        mouseHandlersRef.current = { handleMouseDown, handleMouseMove, handleMouseUp, handleWindowBlur };

        // Mobile: single-finger touch scroll (use isMobileDevice from inline check above)
        if (isMobileDevice && terminalRef.current) {
          let touchStartY = 0;
          let scrollAccum = 0;
          let isDragging = false;

          const el = terminalRef.current;

          const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 1) {
              touchStartY = e.touches[0].clientY;
              scrollAccum = 0;
              isDragging = false;
            }
          };

          const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 1) {
              const nowY = e.touches[0].clientY;
              const dy = touchStartY - nowY;
              if (!isDragging && Math.abs(dy) > 8) {
                isDragging = true;
              }
              if (isDragging) {
                e.preventDefault();
                scrollAccum += dy;
                const lineHeight = 16;
                const lines = Math.trunc(scrollAccum / lineHeight);
                if (lines !== 0) {
                  adapter.scrollLines(lines);
                  scrollAccum -= lines * lineHeight;
                }
                touchStartY = nowY;
              }
            }
          };

          const handleTouchEnd = () => {
            isDragging = false;
            scrollAccum = 0;
          };

          el.addEventListener('touchstart', handleTouchStart, { passive: true });
          el.addEventListener('touchmove', handleTouchMove, { passive: false });
          el.addEventListener('touchend', handleTouchEnd, { passive: true });

          touchHandlersRef.current = { el, handleTouchStart, handleTouchMove, handleTouchEnd };
        }

        // Input handler — passes xterm input directly to the PTY.
        // Full-width character normalisation (U+FF01–U+FF5E → ASCII, U+3000 → space)
        // was intentionally removed: that conversion should be the IME's responsibility,
        // not the terminal's. Doing it here broke CJK input flows where users explicitly
        // wanted full-width characters in the shell.
        const inputDisposable = adapter.onInput((data) => {
          writeToPty(sessionIdRef.current, data);
        });
        inputDisposableRef.current = inputDisposable;

        // Shell integration subscriptions
        shellIntCmdSubRef.current = adapter.onCommandStarted?.(() => {
          if (!shellIntDetectedRef.current) {
            shellIntDetectedRef.current = true;
            onShellIntDetectedRef.current?.();
          }
        }) ?? null;
        shellIntCwdSubRef.current = adapter.onCwdChanged?.((newCwd: string) => {
          onCwdChangedRef.current?.(newCwd);
        }) ?? null;
      }

      // --- PTY initialization (same as before) ---
      try {
        await Promise.race([
          document.fonts.ready,
          new Promise(r => setTimeout(r, 100))
        ]);
      } catch (_e) { /* ignore */ }

      try {
        adapter.fit();
      } catch (_e) {
        console.warn('[terminal] adapter.fit() failed during init', _e);
      }

      const cols = Math.max(adapter.cols || 80, 2);
      const rows = Math.max(adapter.rows || 24, 2);

      setInitStatus('Checking session...');

      const exists = await callBackend<boolean>('pty_exists', {
        sessionId: sessionIdRef.current,
      });

      if (!exists) {
        setInitStatus('Creating PTY session...');
        const shell = getPreferredPtyShell();

        const payload = {
          sessionId: sessionIdRef.current,
          cwd: cwdRef.current,
          cols,
          rows,
          shell,
        };
        logTerminalPreferenceDebugInfo('pty_create', payload);
        await callBackend('pty_create', payload);
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
          if (adapterRef.current && mountedRef.current) {
            try { adapterRef.current.fit(); } catch (_e) { /* ignore */ }
            const newCols = Math.max(adapterRef.current.cols || 80, 2);
            const newRows = Math.max(adapterRef.current.rows || 24, 2);
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
  }, [clientId, handleIncomingData, sendPastedText, startReading]);

  // Create PTY session on first visibility, or re-create after session loss
  useEffect(() => {
    if (!adapterRef.current || !visible || initializedRef.current) return;
    initPty();
  }, [visible, initPty, reinitTrigger]);


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
    if (!adapterRef.current || !mountedRef.current || !visible || !initializedRef.current) return;

    try { adapterRef.current.fit(); } catch (_e) { /* ignore */ }
    const cols = Math.max(adapterRef.current.cols || 80, 2);
    const rows = Math.max(adapterRef.current.rows || 24, 2);

    callBackend('pty_resize', {
      sessionId: sessionIdRef.current,
      cols,
      rows,
      ...(clientId ? { clientId } : {}),
    }).catch(() => { /* noop */ });
  }, [visible, clientId]);

  const handleResizeToFit = useCallback(() => {
    handleResize();
    handleCloseContextMenu();
  }, [handleResize, handleCloseContextMenu]);


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
          style={{ padding: '4px 8px', background: 'var(--bg-base)' }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />

        {/* Initializing overlay */}
        {(initStatus || initError) && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-base)]/80 backdrop-blur-sm z-20">
            <div className="flex flex-col items-center gap-3">
              {initStatus ? (
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-[var(--color-accent)] animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-[var(--color-text-secondary)] text-sm font-medium">{initStatus}</span>
                </div>
              ) : initError ? (
                <>
                  <div className="flex items-center gap-2 text-[var(--color-error)]">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium">Connection failed</span>
                  </div>
                  <p className="text-[var(--color-text-secondary)] text-xs max-w-xs text-center">{initError}</p>
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
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-900/80 backdrop-blur-sm border border-amber-700/50 text-[var(--color-warning)] text-xs font-medium shadow-lg pointer-events-auto">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Reconnecting...
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu.visible && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={handleCloseContextMenu}
            />
            <div
              className="fixed z-50 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[140px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                className="w-full px-3 py-1 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                onClick={handleCopy}
              >
                Copy
              </button>
              <button
                className="w-full px-3 py-1 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                onClick={handlePaste}
              >
                Paste
              </button>
              <div className="border-t border-[var(--color-border)] my-0.5" />
              <button
                className="w-full px-3 py-1 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                onClick={handleResizeToFit}
              >
                Resize to Fit
              </button>
              <div className="border-t border-[var(--color-border)] my-0.5" />
              <button
                className="w-full px-3 py-1 text-left text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                onClick={handleClear}
              >
                Clear
              </button>
              <div className="border-t border-[var(--color-border)] my-0.5" />
              <button
                className="w-full px-3 py-1 text-left text-sm text-[var(--color-warning)] hover:bg-[var(--color-bg-elevated)] transition-colors"
                onClick={handleShowDebugInfo}
              >
                Debug Info
              </button>
            </div>
          </>
        )}

        {/* Debug Info Panel */}
        {debugInfo.visible && (
          <>
            <div
              className="fixed inset-0 z-50"
              onClick={handleCloseDebugInfo}
            />
            <div className="absolute z-[60] top-2 left-2 right-2 max-h-[80vh] bg-[var(--color-bg-base)]/95 border border-amber-600/50 rounded-lg shadow-xl select-text flex flex-col">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-border)]/80">
                <span className="text-xs font-bold text-[var(--color-warning)] uppercase tracking-wider">Terminal Debug Info</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyDebugInfo}
                    className="text-[var(--color-text-secondary)] hover:text-white text-xs px-2 py-1 rounded border border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors"
                  >
                    {debugInfoCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={handleCloseDebugInfo}
                    className="text-[var(--color-text-secondary)] hover:text-white text-xs px-1.5 py-1 rounded hover:bg-[var(--color-bg-elevated)] transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 overflow-y-auto px-3 py-3">
                {debugInfoRows.map((row) => (
                  <div
                    key={row.map(([key]) => key).join('|')}
                    className={row.length > 1 ? 'grid gap-x-3 gap-y-1 sm:grid-cols-2 xl:grid-cols-3' : ''}
                  >
                    {row.map(([key, value]) => (
                      <div
                        key={key}
                        className={`text-xs ${DEBUG_INFO_WIDE_KEYS.has(key) ? 'col-span-full' : ''}`}
                      >
                        <span className="text-[var(--color-text-secondary)] font-medium">{key}:</span>
                        <span className="text-[var(--color-text-primary)] ml-1 break-all font-mono">{value}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {isMobile && <MobileTerminalToolbar sessionId={sessionIdRef.current} onResize={handleResize} onDebug={handleShowDebugInfo} />}
    </div>
  );
});
declare global {
  interface Window {
    _terminalRefreshed?: boolean;
  }
}

export const Terminal = memo(TerminalInner);
