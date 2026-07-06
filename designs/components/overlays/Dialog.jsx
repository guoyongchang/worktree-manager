import React, { useEffect } from 'react';
import { wmEnsureStyle } from '../forms/Button.jsx';

wmEnsureStyle('wm-style-dialog', `
.wm-dialog-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: var(--overlay, rgba(0,0,0,0.6));
  -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px);
  animation: fade-in 0.15s ease-out;
}
.wm-dialog-content {
  position: fixed; left: 50%; top: 50%; z-index: 50; transform: translate(-50%, -50%);
  display: grid; gap: 16px; width: calc(100% - 32px); max-width: 512px;
  border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary);
  padding: 24px; box-shadow: var(--shadow-modal); border-radius: var(--radius-lg, 8px);
  animation: animate-in 0.15s ease-out; font-family: var(--font-ui);
}
.wm-dialog-close {
  position: absolute; right: 16px; top: 16px; border-radius: var(--radius-sm, 2px);
  opacity: 0.7; background: transparent; border: none; cursor: pointer; padding: 0;
  color: var(--text-secondary); transition: opacity 150ms; line-height: 0;
}
.wm-dialog-close:hover { opacity: 1; }
.wm-dialog-close svg { width: 16px; height: 16px; }
.wm-dialog-header { display: flex; flex-direction: column; gap: 6px; text-align: left; }
.wm-dialog-footer { display: flex; flex-direction: row; justify-content: flex-end; gap: 8px; }
.wm-dialog-title { font-size: 16px; font-weight: 500; line-height: 1; letter-spacing: -0.025em; color: var(--text-primary); }
.wm-dialog-description { font-size: 14px; color: var(--text-secondary); }
`);

export function Dialog({ open, onOpenChange, maxWidth, className = '', children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && onOpenChange) onOpenChange(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div>
      <div className="wm-dialog-overlay" onClick={() => onOpenChange && onOpenChange(false)}></div>
      <div className={`wm-dialog-content ${className}`} style={maxWidth ? { maxWidth } : undefined} role="dialog">
        {children}
        <button className="wm-dialog-close" onClick={() => onOpenChange && onOpenChange(false)} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

export function DialogHeader({ className = '', children, ...props }) {
  return <div className={`wm-dialog-header ${className}`} {...props}>{children}</div>;
}
export function DialogFooter({ className = '', children, ...props }) {
  return <div className={`wm-dialog-footer ${className}`} {...props}>{children}</div>;
}
export function DialogTitle({ className = '', children, ...props }) {
  return <div className={`wm-dialog-title ${className}`} {...props}>{children}</div>;
}
export function DialogDescription({ className = '', children, ...props }) {
  return <div className={`wm-dialog-description ${className}`} {...props}>{children}</div>;
}
