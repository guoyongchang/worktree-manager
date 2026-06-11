export interface ThemeColors {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentFg: string;
  success: string;
  successLight: string;
  warning: string;
  warningLight: string;
  warningFg: string;
  error: string;
  errorLight: string;
  errorFg: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  nameKey: string;
  colors: ThemeColors;
}

export const defaultDark: ThemeDefinition = {
  id: 'default-dark',
  name: 'Default Dark',
  nameKey: 'themes.defaultDark',
  colors: {
    bgBase: '#0A0A0F',
    bgSurface: '#141419',
    bgElevated: '#1A1A22',
    border: '#1E1E26',
    textPrimary: '#E8E8ED',
    textSecondary: '#8B8B9E',
    textMuted: '#55556A',
    accent: '#6366F1',
    accentHover: '#818CF8',
    accentFg: '#FFFFFF',
    success: '#10B981',
    successLight: '#34D399',
    warning: '#F59E0B',
    warningLight: '#FBBF24',
    warningFg: '#1E1E26',
    error: '#EF4444',
    errorLight: '#F87171',
    errorFg: '#FFFFFF',
  },
};

export const monokai: ThemeDefinition = {
  id: 'monokai',
  name: 'Monokai',
  nameKey: 'themes.monokai',
  colors: {
    bgBase: '#1E1F1C',
    bgSurface: '#272822',
    bgElevated: '#3E3D32',
    border: '#49483E',
    textPrimary: '#F8F8F2',
    textSecondary: '#A6A68A',
    textMuted: '#75715E',
    accent: '#F92672',
    accentHover: '#FF6188',
    accentFg: '#FFFFFF',
    success: '#A6E22E',
    successLight: '#C1E849',
    warning: '#E6DB74',
    warningLight: '#F0E68C',
    warningFg: '#272822',
    error: '#F92672',
    errorLight: '#FF6188',
    errorFg: '#FFFFFF',
  },
};

export const dracula: ThemeDefinition = {
  id: 'dracula',
  name: 'Dracula',
  nameKey: 'themes.dracula',
  colors: {
    bgBase: '#1E1F29',
    bgSurface: '#282A36',
    bgElevated: '#343746',
    border: '#44475A',
    textPrimary: '#F8F8F2',
    textSecondary: '#BFBFBF',
    textMuted: '#6272A4',
    accent: '#BD93F9',
    accentHover: '#C9A8FC',
    accentFg: '#282A36',
    success: '#50FA7B',
    successLight: '#69FF94',
    warning: '#F1FA8C',
    warningLight: '#FFFFA5',
    warningFg: '#282A36',
    error: '#FF5555',
    errorLight: '#FF6E6E',
    errorFg: '#FFFFFF',
  },
};

export const solarizedDark: ThemeDefinition = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  nameKey: 'themes.solarizedDark',
  colors: {
    bgBase: '#001E27',
    bgSurface: '#002B36',
    bgElevated: '#073642',
    border: '#094553',
    textPrimary: '#EEE8D5',
    textSecondary: '#93A1A1',
    textMuted: '#586E75',
    accent: '#268BD2',
    accentHover: '#4BA3E0',
    accentFg: '#FFFFFF',
    success: '#859900',
    successLight: '#98A820',
    warning: '#B58900',
    warningLight: '#C99A00',
    warningFg: '#FFFFFF',
    error: '#DC322F',
    errorLight: '#E85050',
    errorFg: '#FFFFFF',
  },
};

export const nord: ThemeDefinition = {
  id: 'nord',
  name: 'Nord',
  nameKey: 'themes.nord',
  colors: {
    bgBase: '#1D2029',
    bgSurface: '#2E3440',
    bgElevated: '#3B4252',
    border: '#434C5E',
    textPrimary: '#ECEFF4',
    textSecondary: '#D8DEE9',
    textMuted: '#4C566A',
    accent: '#88C0D0',
    accentHover: '#8FBCBB',
    accentFg: '#2E3440',
    success: '#A3BE8C',
    successLight: '#B5C99D',
    warning: '#EBCB8B',
    warningLight: '#EFD39E',
    warningFg: '#2E3440',
    error: '#BF616A',
    errorLight: '#C9757D',
    errorFg: '#FFFFFF',
  },
};

export const defaultLight: ThemeDefinition = {
  id: 'default-light',
  name: 'Default Light',
  nameKey: 'themes.defaultLight',
  colors: {
    bgBase: '#FFFFFF',
    bgSurface: '#F8F9FA',
    bgElevated: '#F1F3F5',
    border: '#E5E7EB',
    textPrimary: '#111827',
    textSecondary: '#4B5563',
    textMuted: '#9CA3AF',
    accent: '#4F46E5',
    accentHover: '#6366F1',
    accentFg: '#FFFFFF',
    success: '#059669',
    successLight: '#10B981',
    warning: '#D97706',
    warningLight: '#F59E0B',
    warningFg: '#FFFFFF',
    error: '#DC2626',
    errorLight: '#EF4444',
    errorFg: '#FFFFFF',
  },
};

export const solarizedLight: ThemeDefinition = {
  id: 'solarized-light',
  name: 'Solarized Light',
  nameKey: 'themes.solarizedLight',
  colors: {
    bgBase: '#FDF6E3',
    bgSurface: '#F5EFD8',
    bgElevated: '#EEE8D5',
    border: '#D8D2BC',
    textPrimary: '#073642',
    textSecondary: '#586E75',
    textMuted: '#93A1A1',
    accent: '#268BD2',
    accentHover: '#2AA198',
    accentFg: '#FFFFFF',
    success: '#859900',
    successLight: '#98A820',
    warning: '#B58900',
    warningLight: '#C99A00',
    warningFg: '#FFFFFF',
    error: '#DC322F',
    errorLight: '#E85050',
    errorFg: '#FFFFFF',
  },
};

export const githubLight: ThemeDefinition = {
  id: 'github-light',
  name: 'GitHub Light',
  nameKey: 'themes.githubLight',
  colors: {
    bgBase: '#FFFFFF',
    bgSurface: '#F6F8FA',
    bgElevated: '#EAEEF2',
    border: '#D0D7DE',
    textPrimary: '#1F2328',
    textSecondary: '#656D76',
    textMuted: '#8C959F',
    accent: '#0969DA',
    accentHover: '#218BFF',
    accentFg: '#FFFFFF',
    success: '#1F883D',
    successLight: '#2DA44E',
    warning: '#9A6700',
    warningLight: '#BF8700',
    warningFg: '#FFFFFF',
    error: '#D1242F',
    errorLight: '#E5534B',
    errorFg: '#FFFFFF',
  },
};

export const ALL_THEMES: ThemeDefinition[] = [
  defaultDark,
  monokai,
  dracula,
  solarizedDark,
  nord,
  defaultLight,
  solarizedLight,
  githubLight,
];
