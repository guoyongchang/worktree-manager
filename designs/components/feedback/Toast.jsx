import React, { useEffect } from 'react';
import { wmEnsureStyle } from '../forms/Button.jsx';

wmEnsureStyle('wm-style-toast', `
.wm-toast-stack { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; }
.wm-toast {
  position: relative; display: flex; align-items: stretch; overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--radius-lg, 8px);
  background: var(--bg-surface); box-shadow: var(--shadow-lg); max-width: 384px;
  animation: slide-in-from-bottom-4 0.3s ease-out; font-family: var(--font-ui);
}
.wm-toast--exiting { animation: slide-out-to-right 0.2s ease-in forwards; }
.wm-toast-bar { width: 2px; flex-shrink: 0; }
.wm-toast-body { display: flex; align-items: flex-start; gap: 10px; padding: 12px; flex: 1; }
.wm-toast-icon { width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; }
.wm-toast-message { font-size: 14px; color: var(--text-primary); flex: 1; word-break: break-word; margin: 0; }
.wm-toast-close {
  flex-shrink: 0; background: none; border: none; padding: 0; cursor: pointer;
  color: var(--text-muted); transition: color 150ms; line-height: 0;
}
.wm-toast-close:hover { color: var(--text-primary); }
.wm-toast-close svg { width: 14px; height: 14px; }
.wm-toast-countdown { position: absolute; bottom: 0; left: 0; right: 0; height: 2px; }
.wm-toast-countdown > div { height: 100%; opacity: 0.4; }
`);

const svgProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'wm-toast-icon' };

const ICONS = {
  success: <svg {...svgProps}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>,
  error: <svg {...svgProps}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>,
  info: <svg {...svgProps}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>,
  warning: <svg {...svgProps}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.73-2Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>,
};

const BAR_COLOR = {
  success: 'var(--success)',
  error: 'var(--error)',
  info: 'var(--accent)',
  warning: 'var(--warning)',
};

/* Auto-dismiss durations per type, ms; 0 = persistent (error) — from src/components/Toast.tsx */
export const TOAST_DURATION = { success: 3000, error: 0, info: 3000, warning: 5000 };

export function Toast({ type = 'info', message, onClose, duration, exiting = false }) {
  const ms = duration !== undefined ? duration : TOAST_DURATION[type];

  useEffect(() => {
    if (!ms || !onClose) return;
    const timer = setTimeout(onClose, ms);
    return () => clearTimeout(timer);
  }, [ms, onClose]);

  const color = BAR_COLOR[type] || BAR_COLOR.info;
  return (
    <div className={`wm-toast ${exiting ? 'wm-toast--exiting' : ''}`}>
      <div className="wm-toast-bar" style={{ background: color }}></div>
      <div className="wm-toast-body">
        <span style={{ color, lineHeight: 0 }}>{ICONS[type] || ICONS.info}</span>
        <p className="wm-toast-message">{message}</p>
        {onClose && (
          <button className="wm-toast-close" onClick={onClose} aria-label="Dismiss">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        )}
      </div>
      {ms > 0 && (
        <div className="wm-toast-countdown">
          <div style={{ background: color, animation: `toast-countdown ${ms}ms linear forwards` }}></div>
        </div>
      )}
    </div>
  );
}

export function ToastStack({ children, ...props }) {
  return <div className="wm-toast-stack" {...props}>{children}</div>;
}
