import * as React from 'react';

/** Dropdown/context menu. Cosmetic port of src/components/ui/dropdown-menu.tsx (Radix). */
export interface DropdownMenuProps {
  /** Element that toggles the menu (e.g. a Button). */
  trigger: React.ReactNode;
  /** @default 'start' */
  align?: 'start' | 'end';
  /** Fixed content width, e.g. '240px' (defaults to min 8rem, fit content). */
  width?: string;
  children?: React.ReactNode;
}

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Red text for dangerous actions (Archive, Delete). */
  destructive?: boolean;
}

export function DropdownMenu(props: DropdownMenuProps): JSX.Element;
export function DropdownMenuItem(props: DropdownMenuItemProps): JSX.Element;
export function DropdownMenuLabel(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function DropdownMenuSeparator(props: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
export function DropdownMenuShortcut(props: React.HTMLAttributes<HTMLSpanElement>): JSX.Element;
