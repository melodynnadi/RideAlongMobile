// RideAlong — Theme Context
// Wraps the entire app. Reads saved app settings, then falls back to system preference.
// Usage: const { colors, isDark, toggleTheme, setDark } = useAppTheme();

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
import { settingsService } from '@/src/services/settingsService';

interface ThemeContextValue {
  isDark: boolean;
  colors: AppColors;
  shadows: typeof darkShadow;
  toggleTheme: () => void;
  setDark: (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark: true,
  colors: darkColors,
  shadows: darkShadow,
  toggleTheme: () => {},
  setDark: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [isDark, setIsDarkState] = useState<boolean>(systemScheme !== 'light');

  useEffect(() => {
    let mounted = true;

    settingsService
      .getSettings()
      .then((settings) => {
        if (!mounted) return;
        setIsDarkState(settings.darkModeEnabled);
      })
      .catch((error: unknown) => {
        console.warn('Failed to load theme preference:', error);

        if (!mounted) return;
        setIsDarkState(systemScheme !== 'light');
      });

    return () => {
      mounted = false;
    };
  }, [systemScheme]);

  const setDark = useCallback((dark: boolean) => {
    setIsDarkState(dark);

    settingsService
      .updateSettings({ darkModeEnabled: dark })
      .catch((error: unknown) => {
        console.warn('Failed to save theme preference:', error);
      });
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDarkState((previous) => {
      const next = !previous;

      settingsService
        .updateSettings({ darkModeEnabled: next })
        .catch((error: unknown) => {
          console.warn('Failed to save theme preference:', error);
        });

      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      isDark,
      colors: isDark ? darkColors : lightColors,
      shadows: isDark ? darkShadow : lightShadow,
      toggleTheme,
      setDark,
    }),
    [isDark, toggleTheme, setDark]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}