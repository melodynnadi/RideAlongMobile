// RideAlong — Theme Context
// Wraps the entire app. Follows the phone's light/dark setting by default ('system');
// users can pin Light or Dark in Settings → Appearance.
// Usage: const { colors, isDark, themeMode, setThemeMode } = useAppTheme();

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import {
  AppColors,
  darkColors,
  lightColors,
  darkShadow,
  lightShadow,
} from '@/constants/theme';
import { settingsService, type ThemeMode } from '@/src/services/settingsService';

interface ThemeContextValue {
  isDark: boolean;
  colors: AppColors;
  shadows: typeof darkShadow;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  /** Pins Light/Dark explicitly (stops following the phone). */
  toggleTheme: () => void;
  setDark: (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: false,
  colors: lightColors,
  shadows: lightShadow,
  themeMode: 'system',
  setThemeMode: () => {},
  toggleTheme: () => {},
  setDark: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Re-renders automatically when the phone switches between light and dark.
  const systemScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let mounted = true;
    settingsService
      .getSettings()
      .then((settings) => {
        if (mounted) setThemeModeState(settings.themeMode ?? 'system');
      })
      .catch((error: unknown) => {
        console.warn('Failed to load theme preference:', error);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const isDark = themeMode === 'system' ? systemScheme === 'dark' : themeMode === 'dark';

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    settingsService
      .updateSettings({ themeMode: mode, darkModeEnabled: mode === 'dark' })
      .catch((error: unknown) => {
        console.warn('Failed to save theme preference:', error);
      });
  }, []);

  const setDark = useCallback((dark: boolean) => setThemeMode(dark ? 'dark' : 'light'), [setThemeMode]);
  const toggleTheme = useCallback(() => setThemeMode(isDark ? 'light' : 'dark'), [isDark, setThemeMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDark,
      colors: isDark ? darkColors : lightColors,
      shadows: isDark ? darkShadow : lightShadow,
      themeMode,
      setThemeMode,
      toggleTheme,
      setDark,
    }),
    [isDark, themeMode, setThemeMode, toggleTheme, setDark]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
