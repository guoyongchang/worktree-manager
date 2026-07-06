import * as React from 'react';

/** Text input. Port of src/components/ui/input.tsx. 36px tall, surface bg, focus = 2px accent/40 ring. */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input(props: InputProps): JSX.Element;
