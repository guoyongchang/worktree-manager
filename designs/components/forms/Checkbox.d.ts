import * as React from 'react';

/** Checkbox. Port of src/components/ui/checkbox.tsx — native input, 16px, accent-colored check. */
export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional inline label rendered to the right (14px). */
  label?: React.ReactNode;
}

export function Checkbox(props: CheckboxProps): JSX.Element;
