import * as React from 'react';

/**
 * Lucide icon — the app's only icon system (lucide-react in source; UMD build from CDN here).
 * Auto-loads the lucide script on first use if not already present.
 */
export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Lucide name, kebab-case or PascalCase: 'git-branch', 'GitMerge', 'folder', 'settings'… */
  name: string;
  /** Square px. App uses 12/14/16/20. @default 16 */
  size?: number;
  /** @default 2 */
  strokeWidth?: number;
  /** @default 'currentColor' */
  color?: string;
}

export function Icon(props: IconProps): JSX.Element;
