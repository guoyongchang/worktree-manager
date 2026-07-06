import * as React from 'react';

/** Primary action control. Port of src/components/ui/button.tsx (shadcn-style, cva variants). */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. 'default' = filled indigo accent. @default 'default' */
  variant?: 'default' | 'destructive' | 'warning' | 'outline' | 'secondary' | 'ghost' | 'link';
  /** 'default' 36px / 'sm' 32px / 'lg' 40px / 'icon' 36×36. @default 'default' */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
