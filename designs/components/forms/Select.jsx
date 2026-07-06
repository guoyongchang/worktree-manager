import React, { useState, useRef, useEffect } from 'react';
import { wmEnsureStyle } from './Button.jsx';

wmEnsureStyle('wm-style-select', `
.wm-select { position: relative; display: inline-block; width: 100%; font-family: var(--font-ui); }
.wm-select-trigger {
  display: flex; height: 36px; width: 100%; align-items: center; justify-content: space-between;
  white-space: nowrap; border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); padding: 8px 12px; font-size: 14px; color: var(--text-primary);
  box-shadow: var(--shadow-subtle); cursor: pointer; transition: box-shadow 150ms;
}
.wm-select-trigger:focus { box-shadow: var(--focus-ring); }
.wm-select-trigger:disabled { cursor: not-allowed; opacity: 0.5; }
.wm-select-trigger .wm-select-placeholder { color: var(--text-muted); }
.wm-select-trigger svg { width: 16px; height: 16px; opacity: 0.5; flex-shrink: 0; margin-left: 8px; }
.wm-select-content {
  position: absolute; z-index: 50; top: calc(100% + 4px); left: 0; min-width: 8rem; width: 100%;
  max-height: 384px; overflow-y: auto; border-radius: var(--radius-md, 6px);
  border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary);
  box-shadow: var(--shadow-lg); padding: 4px; animation: animate-in 0.15s ease-out;
}
.wm-select-item {
  position: relative; display: flex; width: 100%; align-items: center; cursor: default;
  -webkit-user-select: none; user-select: none; border-radius: var(--radius-sm, 2px);
  padding: 6px 32px 6px 8px; font-size: 14px; color: var(--text-primary); border: none;
  background: transparent; text-align: left;
}
.wm-select-item:hover { background: var(--bg-elevated); }
.wm-select-item .wm-select-check {
  position: absolute; right: 8px; display: flex; width: 14px; height: 14px;
  align-items: center; justify-content: center;
}
.wm-select-item .wm-select-check svg { width: 16px; height: 16px; }
`);

const ChevronDownSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
);
const CheckSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);

/** Cosmetic port of the Radix-based select.tsx: trigger + floating item list with right-aligned check. */
export function Select({ options = [], value, defaultValue, onChange, placeholder = 'Select…', disabled, className = '', style }) {
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = value !== undefined ? value : internal;
  const items = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const selected = items.find(i => i.value === current);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className={`wm-select ${className}`} style={style} ref={rootRef}>
      <button type="button" className="wm-select-trigger" disabled={disabled} onClick={() => setOpen(o => !o)}>
        {selected ? <span>{selected.label}</span> : <span className="wm-select-placeholder">{placeholder}</span>}
        <ChevronDownSvg />
      </button>
      {open && (
        <div className="wm-select-content">
          {items.map(item => (
            <button
              type="button"
              key={item.value}
              className="wm-select-item"
              onClick={() => { setInternal(item.value); setOpen(false); if (onChange) onChange(item.value); }}
            >
              <span className="wm-select-check">{item.value === current ? <CheckSvg /> : null}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
