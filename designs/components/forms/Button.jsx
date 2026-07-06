import React from 'react';

/* Injects component CSS once per page */
export function wmEnsureStyle(id, css) {
  if (typeof document !== 'undefined' && !document.getElementById(id)) {
    const s = document.createElement('style');
    s.id = id;
    s.textContent = css;
    document.head.appendChild(s);
  }
}

wmEnsureStyle('wm-style-button', `
.wm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  white-space: nowrap; border-radius: var(--radius-md, 6px);
  font-size: 14px; font-weight: 500; font-family: var(--font-ui);
  transition: all 150ms; cursor: pointer; border: 1px solid transparent;
  -webkit-user-select: none; user-select: none;
}
.wm-btn:focus-visible { box-shadow: var(--focus-ring); }
.wm-btn:disabled { pointer-events: none; opacity: 0.5; }
.wm-btn svg { width: 16px; height: 16px; flex-shrink: 0; pointer-events: none; }
.wm-btn--size-default { height: 36px; padding: 8px 16px; }
.wm-btn--size-sm { height: 32px; padding: 0 12px; font-size: 12px; }
.wm-btn--size-lg { height: 40px; padding: 0 32px; }
.wm-btn--size-icon { height: 36px; width: 36px; padding: 0; }
.wm-btn--default { background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow-subtle); }
.wm-btn--default:hover { background: var(--accent-hover); }
.wm-btn--destructive { background: var(--error); color: var(--error-fg); box-shadow: var(--shadow-subtle); }
.wm-btn--destructive:hover { background: var(--error-light); }
.wm-btn--warning { background: var(--warning); color: var(--warning-fg); box-shadow: var(--shadow-subtle); }
.wm-btn--warning:hover { background: var(--warning-light); }
.wm-btn--outline { border-color: var(--border); background: transparent; color: var(--text-primary); box-shadow: var(--shadow-subtle); }
.wm-btn--outline:hover { background: var(--bg-elevated); }
.wm-btn--secondary { background: var(--bg-surface); color: var(--text-primary); border-color: var(--border); box-shadow: var(--shadow-subtle); }
.wm-btn--secondary:hover { background: var(--bg-elevated); }
.wm-btn--ghost { background: transparent; color: var(--text-primary); }
.wm-btn--ghost:hover { background: var(--bg-surface); }
.wm-btn--link { background: transparent; color: var(--accent); text-underline-offset: 4px; }
.wm-btn--link:hover { text-decoration: underline; }
`);

export function Button({ variant = 'default', size = 'default', className = '', children, ...props }) {
  return (
    <button
      className={`wm-btn wm-btn--${variant} wm-btn--size-${size} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
