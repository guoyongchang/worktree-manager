import * as React from 'react';

/**
 * Notification toast. Port of src/components/Toast.tsx — surface card with a 2px colored left bar,
 * type icon, and a countdown line along the bottom. Stacks bottom-right.
 */
export interface ToastProps {
  /** @default 'info' */
  type?: 'success' | 'error' | 'info' | 'warning';
  message: React.ReactNode;
  /** Renders the X button and enables auto-dismiss. */
  onClose?: () => void;
  /** Auto-dismiss ms. Defaults per type: success/info 3000, warning 5000, error 0 (persistent). */
  duration?: number;
  /** Plays the slide-out-to-right exit animation. */
  exiting?: boolean;
}

export function Toast(props: ToastProps): JSX.Element;

/** Fixed bottom-right column (24px inset, 8px gap) that holds Toasts. */
export function ToastStack(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;

/** Per-type auto-dismiss durations (ms); error = 0 = manual close only. */
export const TOAST_DURATION: Record<'success' | 'error' | 'info' | 'warning', number>;
