import type { EditorConfig } from './types';

export const EDITORS: EditorConfig[] = [
  { id: 'vscode', name: 'VS Code', icon: 'V' },
  { id: 'cursor', name: 'Cursor', icon: 'C' },
  { id: 'idea', name: 'IDEA', icon: 'I' },
];

// Terminal configuration
export const TERMINAL = {
  DEFAULT_HEIGHT: 280,
  MIN_HEIGHT: 100,
  MAX_HEIGHT: 600,
  POLL_INTERVAL_MS: 100,
  SCROLLBACK_LINES: 5000,
  // Terminal state broadcast settings
  BROADCAST_RATE_LIMIT_MS: 100,
  // Terminal resize settings
  RESIZE_TRIGGER_OFFSET: 5,
  RESIZE_DELAY_MS: 50,
} as const;

