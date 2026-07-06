import * as React from 'react';

/** Hover tooltip. Cosmetic port of src/components/ui/tooltip.tsx — elevated bg, 12px text, 4px offset. */
export interface TooltipProps {
  content: React.ReactNode;
  /** @default 'top' */
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  /** The hover target. */
  children: React.ReactNode;
}

export function Tooltip(props: TooltipProps): JSX.Element;
