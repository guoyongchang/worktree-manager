import React, { useState, useRef, useEffect } from 'react';
import { wmEnsureStyle } from '../forms/Button.jsx';

wmEnsureStyle('wm-style-popover', `
.wm-popover-root { position: relative; display: inline-block; }
.wm-popover-content {
  position: absolute; z-index: 50; top: calc(100% + 4px);
  border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); color: var(--text-primary); padding: 16px;
  box-shadow: var(--shadow-lg); animation: animate-in 0.15s ease-out;
  font-family: var(--font-ui); width: max-content; max-width: 320px;
}
.wm-popover-content--start { left: 0; }
.wm-popover-content--center { left: 50%; transform: translateX(-50%); }
.wm-popover-content--end { right: 0; }
`);

export function Popover({ trigger, align = 'center', className = '', children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="wm-popover-root" ref={rootRef}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'contents' }}>{trigger}</div>
      {open && <div className={`wm-popover-content wm-popover-content--${align} ${className}`}>{children}</div>}
    </div>
  );
}
