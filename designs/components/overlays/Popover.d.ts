import * as React from 'react';

/** Click-toggled floating panel (16px padding). Cosmetic port of src/components/ui/popover.tsx. */
export interface PopoverProps {
  trigger: React.ReactNode;
  /** @default 'center' */
  align?: 'start' | 'center' | 'end';
  className?: string;
  children?: React.ReactNode;
}

export function Popover(props: PopoverProps): JSX.Element;
