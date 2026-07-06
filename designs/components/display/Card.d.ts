import * as React from 'react';

/** Surface container. Port of src/components/ui/card.tsx — 8px radius, hairline border, surface bg. */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> { children?: React.ReactNode; }

export function Card(props: CardProps): JSX.Element;
export function CardHeader(props: CardProps): JSX.Element;
export function CardTitle(props: CardProps): JSX.Element;
export function CardDescription(props: CardProps): JSX.Element;
export function CardContent(props: CardProps): JSX.Element;
export function CardFooter(props: CardProps): JSX.Element;
