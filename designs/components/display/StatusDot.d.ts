import * as React from 'react';

/** 10px solid status circle. Port of StatusDot in src/components/Icons.tsx. */
export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** success = emerald, warning = amber, info = accent, sync = purple. @default 'info' */
  status?: 'success' | 'warning' | 'info' | 'sync';
}

export function StatusDot(props: StatusDotProps): JSX.Element;
