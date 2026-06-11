import { ALL_THEMES as allThemes } from './definitions';
export { type ThemeDefinition, type ThemeColors } from './definitions';

export const ALL_THEMES = allThemes;

const STORAGE_KEY = 'theme';
const DEFAULT_THEME_ID = 'default-dark';

export function getStoredThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function applyTheme(themeId: string): void {
  document.documentElement.setAttribute('data-theme', themeId);
  try {
    localStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // localStorage unavailable
  }
}

export function getThemeById(id: string) {
  return allThemes.find((t) => t.id === id);
}
