import React from 'react';
import { wmEnsureStyle } from './Button.jsx';

wmEnsureStyle('wm-style-input', `
.wm-input {
  display: flex; height: 36px; width: 100%;
  border-radius: var(--radius-md, 6px); border: 1px solid var(--border);
  background: var(--bg-surface); padding: 4px 12px;
  font-size: 14px; font-family: var(--font-ui); color: var(--text-primary);
  box-shadow: var(--shadow-subtle); transition: border-color 150ms, box-shadow 150ms;
}
.wm-input::placeholder { color: var(--text-muted); }
.wm-input:focus { box-shadow: var(--focus-ring); }
.wm-input:disabled { cursor: not-allowed; opacity: 0.5; }
`);

export function Input({ className = '', ...props }) {
  return <input className={`wm-input ${className}`} {...props} />;
}
