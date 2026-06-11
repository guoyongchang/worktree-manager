import { useState, useCallback } from 'react';
import { ALL_THEMES, applyTheme, getStoredThemeId } from '@/themes';

export function useTheme() {
  const [themeId, setThemeId] = useState<string>(() => getStoredThemeId());

  const setTheme = useCallback((id: string) => {
    applyTheme(id);
    setThemeId(id);
  }, []);

  return { themeId, setTheme, themes: ALL_THEMES };
}
