import * as React from 'react';

/** Status pill. Port of src/components/ui/badge.tsx — 10px text, fully rounded, 15%-tint backgrounds. */
export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** @default 'default' */
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
  children?: React.ReactNode;
}

export function Badge(props: BadgeProps): JSX.Element;
