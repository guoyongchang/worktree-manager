import * as React from 'react';

export interface SelectOption { value: string; label: React.ReactNode; }

/** Select dropdown. Cosmetic port of src/components/ui/select.tsx (Radix): input-height trigger, floating list, check on the right of the selected item. */
export interface SelectProps {
  /** Strings or { value, label } pairs. */
  options: Array<string | SelectOption>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** @default 'Select…' */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Select(props: SelectProps): JSX.Element;
