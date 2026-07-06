import React from 'react';
import { wmEnsureStyle } from '../forms/Button.jsx';

wmEnsureStyle('wm-style-tooltip', `
.wm-tooltip-wrap { position: relative; display: inline-flex; }
.wm-tooltip {
  position: absolute; z-index: 50; display: none; overflow: hidden; white-space: nowrap;
  border-radius: var(--radius-md, 6px); background: var(--bg-elevated);
  border: 1px solid var(--border); padding: 6px 12px; font-size: 12px;
  color: var(--text-primary); box-shadow: var(--shadow-lg); font-family: var(--font-ui);
  pointer-events: none;
}
.wm-tooltip-wrap:hover .wm-tooltip { display: block; animation: animate-in 0.15s ease-out; }
.wm-tooltip--top { bottom: calc(100% + 4px); left: 50%; transform: translateX(-50%); }
.wm-tooltip--bottom { top: calc(100% + 4px); left: 50%; transform: translateX(-50%); }
.wm-tooltip--left { right: calc(100% + 4px); top: 50%; transform: translateY(-50%); }
.wm-tooltip--right { left: calc(100% + 4px); top: 50%; transform: translateY(-50%); }
`);

export function Tooltip({ content, side = 'top', className = '', children }) {
  return (
    <span className={`wm-tooltip-wrap ${className}`}>
      {children}
      <span className={`wm-tooltip wm-tooltip--${side}`} role="tooltip">{content}</span>
    </span>
  );
}
