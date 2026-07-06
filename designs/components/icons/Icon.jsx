import React, { useEffect, useState } from 'react';

const LUCIDE_CDN = 'https://unpkg.com/lucide@0.462.0/dist/umd/lucide.min.js';

let loadPromise = null;
function loadLucide() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.lucide) return Promise.resolve(window.lucide);
  if (!loadPromise) {
    loadPromise = new Promise((resolve) => {
      const existing = document.getElementById('wm-lucide-script');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.lucide));
        return;
      }
      const s = document.createElement('script');
      s.id = 'wm-lucide-script';
      s.src = LUCIDE_CDN;
      s.onload = () => resolve(window.lucide);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return loadPromise;
}

function toPascal(name) {
  return name
    .split(/[-_\s]/)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function renderNode(node, key) {
  // lucide IconNode entries: [tag, attrs] or [tag, attrs, children]
  const [tag, attrs, children] = node;
  const props = { key };
  for (const k in attrs) {
    if (k === 'key') continue;
    props[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attrs[k];
  }
  return React.createElement(
    tag,
    props,
    Array.isArray(children) ? children.map((c, i) => renderNode(c, i)) : undefined
  );
}

/**
 * Lucide icon (the app's icon set, loaded from CDN UMD build).
 * Renders 24-grid stroke icons: fill none, stroke currentColor, width 2, round caps.
 */
export function Icon({ name, size = 16, strokeWidth = 2, color = 'currentColor', className = '', style, ...props }) {
  const [, force] = useState(0);
  const ready = typeof window !== 'undefined' && window.lucide;

  useEffect(() => {
    if (!ready) loadLucide().then(() => force(n => n + 1));
  }, [ready]);

  let node = null;
  if (ready && window.lucide.icons) {
    node = window.lucide.icons[toPascal(name)] || window.lucide.icons[name] || null;
  }
  // lucide UMD (0.462.0) icons are a full ['svg', attrs, children] triple — render only the children
  const entries = Array.isArray(node) && node[0] === 'svg' ? node[2] : node;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      {...props}
    >
      {Array.isArray(entries) ? entries.map((n, i) => renderNode(n, i)) : null}
    </svg>
  );
}
