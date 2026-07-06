import React from 'react';
import { wmEnsureStyle } from '../forms/Button.jsx';

wmEnsureStyle('wm-style-card', `
.wm-card {
  border-radius: var(--radius-lg, 8px); border: 1px solid var(--border);
  background: var(--bg-surface); color: var(--text-primary);
  box-shadow: var(--shadow-subtle); font-family: var(--font-ui);
}
.wm-card-header { display: flex; flex-direction: column; gap: 6px; padding: 24px; }
.wm-card-title { font-weight: 600; line-height: 1; letter-spacing: -0.025em; }
.wm-card-description { font-size: 14px; color: var(--text-secondary); }
.wm-card-content { padding: 24px; padding-top: 0; }
.wm-card-footer { display: flex; align-items: center; padding: 24px; padding-top: 0; }
`);

export function Card({ className = '', children, ...props }) {
  return <div className={`wm-card ${className}`} {...props}>{children}</div>;
}
export function CardHeader({ className = '', children, ...props }) {
  return <div className={`wm-card-header ${className}`} {...props}>{children}</div>;
}
export function CardTitle({ className = '', children, ...props }) {
  return <div className={`wm-card-title ${className}`} {...props}>{children}</div>;
}
export function CardDescription({ className = '', children, ...props }) {
  return <div className={`wm-card-description ${className}`} {...props}>{children}</div>;
}
export function CardContent({ className = '', children, ...props }) {
  return <div className={`wm-card-content ${className}`} {...props}>{children}</div>;
}
export function CardFooter({ className = '', children, ...props }) {
  return <div className={`wm-card-footer ${className}`} {...props}>{children}</div>;
}
