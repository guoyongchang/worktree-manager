import React from 'react';
import { wmEnsureStyle } from '../forms/Button.jsx';

wmEnsureStyle('wm-style-badge', `
.wm-badge {
  display: inline-flex; align-items: center; border-radius: var(--radius-full, 9999px);
  border: 1px solid transparent; padding: 2px 8px; font-size: 10px; font-weight: 500;
  font-family: var(--font-ui); transition: color 150ms, background 150ms; line-height: 1.5;
  white-space: nowrap;
}
.wm-badge--default { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent-hover); }
.wm-badge--secondary { background: var(--bg-elevated); color: var(--text-secondary); }
.wm-badge--success { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success-light); }
.wm-badge--warning { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning-light); }
.wm-badge--destructive { background: color-mix(in srgb, var(--error) 15%, transparent); color: var(--error-light); }
.wm-badge--outline { border-color: var(--border); color: var(--text-secondary); }
`);

export function Badge({ variant = 'default', className = '', children, ...props }) {
  return (
    <div className={`wm-badge wm-badge--${variant} ${className}`} {...props}>
      {children}
    </div>
  );
}
