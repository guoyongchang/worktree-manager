import type { EditorConfig } from './types';

export const EDITORS: EditorConfig[] = [
  { id: 'vscode', name: 'VS Code', icon: 'V' },
  { id: 'cursor', name: 'Cursor', icon: 'C' },
  { id: 'antigravity', name: 'Antigravity', icon: 'A' },
  { id: 'idea', name: 'IDEA', icon: 'I' },
  { id: 'codex', name: 'Codex', icon: 'X' },
];

// Terminal configuration
export const TERMINAL = {
  DEFAULT_HEIGHT: 280,
  MIN_HEIGHT: 100,
  MAX_HEIGHT: 1200,
  MAX_VIEWPORT_MARGIN: 140,
  POLL_INTERVAL_MS: 100,
  SCROLLBACK_LINES: 5000,
  // Terminal state broadcast settings
  BROADCAST_RATE_LIMIT_MS: 100,
  // Terminal resize settings
  RESIZE_TRIGGER_OFFSET: 5,
  RESIZE_DELAY_MS: 50,
} as const;

export function getTerminalMaxHeight(viewportHeight: number): number {
  return Math.max(
    TERMINAL.MIN_HEIGHT,
    Math.min(TERMINAL.MAX_HEIGHT, viewportHeight - TERMINAL.MAX_VIEWPORT_MARGIN),
  );
}

export function clampTerminalHeight(height: number, viewportHeight: number): number {
  return Math.max(TERMINAL.MIN_HEIGHT, Math.min(getTerminalMaxHeight(viewportHeight), height));
}

// Tag color presets
export const TAG_PRESET_COLORS = [
  '#4caf50', '#ff9800', '#2196f3', '#e91e63',
  '#9c27b0', '#00bcd4', '#ff5722', '#607d8b',
  '#8bc34a', '#ffc107',
];
