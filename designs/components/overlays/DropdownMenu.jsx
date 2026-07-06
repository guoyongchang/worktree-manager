import React, { useState, useRef, useEffect } from 'react';
import { wmEnsureStyle } from '../forms/Button.jsx';

wmEnsureStyle('wm-style-dropdown', `
.wm-menu-root { position: relative; display: inline-block; }
.wm-menu-content {
  position: absolute; z-index: 50; min-width: 8rem; overflow: hidden;
  border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); color: var(--text-primary); padding: 4px;
  box-shadow: var(--shadow-lg); animation: animate-in 0.15s ease-out;
  top: calc(100% + 4px); font-family: var(--font-ui);
}
.wm-menu-content--start { left: 0; }
.wm-menu-content--end { right: 0; }
.wm-menu-item {
  position: relative; display: flex; width: 100%; cursor: default; align-items: center; gap: 8px;
  border-radius: var(--radius-sm, 2px); padding: 6px 8px; font-size: 14px; border: none;
  background: transparent; color: var(--text-primary); text-align: left;
  transition: background 150ms, color 150ms;
}
.wm-menu-item:hover:not(:disabled) { background: var(--bg-elevated); }
.wm-menu-item:disabled { pointer-events: none; opacity: 0.5; }
.wm-menu-item--destructive { color: var(--error); }
.wm-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; }
.wm-menu-label { padding: 6px 8px; font-size: 14px; font-weight: 500; color: var(--text-secondary); }
.wm-menu-separator { margin: 4px -4px; height: 1px; background: var(--border); }
.wm-menu-shortcut { margin-left: auto; font-size: 12px; letter-spacing: 0.1em; opacity: 0.6; }
`);

export function DropdownMenu({ trigger, align = 'start', width, children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="wm-menu-root" ref={rootRef}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'contents' }}>{trigger}</div>
      {open && (
        <div
          className={`wm-menu-content wm-menu-content--${align}`}
          style={width ? { width } : undefined}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownMenuItem({ destructive, className = '', children, ...props }) {
  return (
    <button className={`wm-menu-item ${destructive ? 'wm-menu-item--destructive' : ''} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function DropdownMenuLabel({ className = '', children, ...props }) {
  return <div className={`wm-menu-label ${className}`} {...props}>{children}</div>;
}
export function DropdownMenuSeparator(props) {
  return <div className="wm-menu-separator" {...props}></div>;
}
export function DropdownMenuShortcut({ children, ...props }) {
  return <span className="wm-menu-shortcut" {...props}>{children}</span>;
}
