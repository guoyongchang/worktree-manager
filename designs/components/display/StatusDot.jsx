import React from 'react';

const DOT_COLORS = {
  success: '#10B981',            /* emerald-500 */
  warning: '#F59E0B',            /* amber-500 */
  info: 'var(--accent)',
  sync: '#A855F7',               /* purple-500 */
};

/** Port of StatusDot from src/components/Icons.tsx — 10px solid circle. */
export function StatusDot({ status = 'info', style, ...props }) {
  return (
    <span
      style={{
        display: 'inline-block', width: 10, height: 10, borderRadius: 9999,
        background: DOT_COLORS[status] || DOT_COLORS.info, flexShrink: 0, ...style,
      }}
      {...props}
    ></span>
  );
}
