// src/design-tokens.ts
// Centralized design tokens for the UI redesign.
// Import these in components or reference the CSS custom properties.

export const colors = {
  // Backgrounds
  bgBase: '#0A0A0F',
  bgSurface: '#141419',
  bgElevated: '#1A1A22',

  // Borders
  border: '#1E1E26',

  // Text
  textPrimary: '#E8E8ED',
  textSecondary: '#8B8B9E',
  textMuted: '#55556A',

  // Accent (Indigo)
  accent: '#6366F1',
  accentHover: '#818CF8',

  // Semantic
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
} as const;

export const typography = {
  uiFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  monoFont: "'Maple Mono NF CN', 'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const shadows = {
  cardHover: '0 4px 24px rgba(0,0,0,0.4)',
  modal: '0 8px 32px rgba(0,0,0,0.6)',
  subtle: '0 1px 3px rgba(0,0,0,0.3)',
} as const;

export const animation = {
  duration: '150ms',
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;
