import * as React from 'react';

/**
 * Modal dialog. Port of src/components/ui/dialog.tsx (Radix): black/60 blurred overlay, centered
 * surface panel, zoom-in entrance, X close at top-right.
 */
export interface DialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Overrides the 512px default, e.g. '420px' for confirms, '640px' for the commit dialog. */
  maxWidth?: string;
  className?: string;
  children?: React.ReactNode;
}

export function Dialog(props: DialogProps): JSX.Element | null;
export function DialogHeader(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function DialogFooter(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function DialogTitle(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function DialogDescription(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
