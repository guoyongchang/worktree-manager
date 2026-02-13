import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { callBackend, isTauri } from '../lib/backend';
import { getWebSocketManager } from '../lib/websocket';
import { TERMINAL } from '../constants';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  cwd: string;
  visible: boolean;
}

export interface TerminalHandle {
  copyContent: () => Promise<void>;
}

const TerminalInner = forwardRef<TerminalHandle, TerminalProps>(({ cwd, visible }, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // Extract actual cwd (remove #timestamp suffix if present)
  const actualCwd = cwd.split('#')[0];
  const sessionIdRef = useRef<string>(`pty-${cwd.replace(/[\/#]/g, '-')}`);
  const readerIntervalRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const cwdRef = useRef(actualCwd);

  // Expose copyContent method
  useImperativeHandle(ref, () => ({
    copyContent: async () => {
      if (!xtermRef.current) return;
      const term = xtermRef.current;
      // Select all content
      term.selectAll();
      // Get selection
      const selection = term.getSelection();
      if (selection) {
        try {
          await navigator.clipboard.writeText(selection);
        } catch {
          // Clipboard write failed silently
        }
      }
      // Clear selection after copying
      term.clearSelection();
    }
  }), []);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new XTerm({
      theme: {
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
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: TERMINAL.SCROLLBACK_LINES,
      convertEol: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle user input
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
      } catch {
        // PTY write failed silently
      }
    });

    return () => {
      term.dispose();
      xtermRef.current = null;
    };
  }, []);

  // Create PTY session when first visible
  useEffect(() => {
    if (!xtermRef.current || !visible || initializedRef.current) return;

    const initPty = async () => {
      const term = xtermRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term || !fitAddon) return;

      try {
        // Fit first to get correct dimensions
        fitAddon.fit();

        const cols = term.cols;
        const rows = term.rows;

        // Create PTY session
        await callBackend('pty_create', {
          sessionId: sessionIdRef.current,
          cwd: cwdRef.current,
          cols,
          rows,
        });

        initializedRef.current = true;

        // Start reading from PTY
        startReading();

      } catch (e) {
        // Show error in terminal UI instead of console
        term.write(`\r\n\x1b[31mFailed to create terminal: ${e}\x1b[0m\r\n`);
      }
    };

    initPty();
  }, [visible]);

  // Start/stop reading based on visibility
  const startReading = useCallback(() => {
    if (!isTauri()) {
      // Browser mode: subscribe to WebSocket PTY output (no polling)
      getWebSocketManager().subscribePty(sessionIdRef.current, (data) => {
        if (data && xtermRef.current) {
          xtermRef.current.write(data);
        }
      });
    } else {
      // Tauri desktop mode: poll via invoke
      if (readerIntervalRef.current) return; // Already reading

      const readLoop = async () => {
        try {
          const data = await callBackend<string>('pty_read', {
            sessionId: sessionIdRef.current,
          });
          if (data && xtermRef.current) {
            xtermRef.current.write(data);
          }
        } catch {
          // PTY read failed silently
        }
      };

      readerIntervalRef.current = window.setInterval(readLoop, TERMINAL.POLL_INTERVAL_MS);
    }
  }, []);

  const stopReading = useCallback(() => {
    if (!isTauri()) {
      getWebSocketManager().unsubscribePty(sessionIdRef.current);
    }
    if (readerIntervalRef.current) {
      clearInterval(readerIntervalRef.current);
      readerIntervalRef.current = null;
    }
  }, []);

  // Handle resize
  const handleResize = useCallback(() => {
    if (!fitAddonRef.current || !xtermRef.current || !visible) return;

    fitAddonRef.current.fit();
    const cols = xtermRef.current.cols;
    const rows = xtermRef.current.rows;

    callBackend('pty_resize', {
      sessionId: sessionIdRef.current,
      cols,
      rows,
    }).catch(() => {
      // PTY resize failed silently
    });
  }, [visible]);

  // Manage reading based on visibility
  useEffect(() => {
    if (!initializedRef.current) return;

    if (visible) {
      startReading();
      // Trigger resize when terminal becomes visible to ensure proper display
      // Use a small delay to ensure DOM is fully rendered
      const resizeTimer = setTimeout(() => {
        handleResize();
      }, 50);
      return () => clearTimeout(resizeTimer);
    } else {
      stopReading();
    }
  }, [visible, startReading, stopReading, handleResize]);

  // ResizeObserver for container size changes (handles visibility, window resize, layout changes)
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopReading();
      callBackend('pty_close', { sessionId: sessionIdRef.current }).catch(() => {});
    };
  }, [stopReading]);

  return (
    <div
      ref={terminalRef}
      className="h-full w-full overflow-hidden"
      style={{ padding: '4px 8px', background: '#0f172a' }}
    />
  );
});

export const Terminal = memo(TerminalInner);
