import React from 'react';
import { wmEnsureStyle } from './Button.jsx';

wmEnsureStyle('wm-style-checkbox', `
.wm-checkbox {
  width: 16px; height: 16px; flex-shrink: 0;
  border-radius: var(--radius, 4px); border: 1px solid var(--border);
  background: var(--bg-surface); accent-color: var(--accent);
  cursor: pointer; margin: 0;
}
.wm-checkbox:focus-visible { box-shadow: var(--focus-ring); }
.wm-checkbox:disabled { cursor: not-allowed; opacity: 0.5; }
.wm-checkbox-label {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
  font-size: 14px; color: var(--text-primary); font-family: var(--font-ui);
}
`);

export function Checkbox({ className = '', label, ...props }) {
  const box = <input type="checkbox" className={`wm-checkbox ${className}`} {...props} />;
  if (!label) return box;
  return (
    <label className="wm-checkbox-label">
      {box}
      <span>{label}</span>
    </label>
  );
}
