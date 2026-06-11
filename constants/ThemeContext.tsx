// RideAlong — Theme Context
// Wraps the entire app. Reads system preference, allows manual override.
// Usage:  const { colors, isDark, toggleTheme } = useAppTheme();

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppColors,
  darkColors,
  lightColors,
  darkShadow,
  lightShadow,
} from '@/constants/theme';   // ← adjust path if you put theme.ts elsewhere

const STORAGE_KEY = '@ridealong_theme_override';

// ─────────────────────────────────────────────────────────────────────────────
// Context shape
// ─────────────────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  isDark:      boolean;
  colors:      AppColors;
  shadows:     typeof darkShadow;
  toggleTheme: () => void;
  setDark:     (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  isDark:      true,
  colors:      darkColors,
  shadows:     darkShadow,
  toggleTheme: () => {},
  setDark:     () => {},
});

// ─────────────────────────────────────────────────────────────────────────────
// Provider — place this at the root of your app (_layout.tsx)
// ─────────────────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [isDark, setIsDark] = useState<boolean>(systemScheme !== 'light');

  // Load persisted override on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'dark')  setIsDark(true);
      if (stored === 'light') setIsDark(false);
      // If null — follow system (default)
    }).catch(() => {});
  }, []);

  // Re-sync with system if no stored override
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!stored) setIsDark(systemScheme !== 'light');
    }).catch(() => {});
  }, [systemScheme]);

  const toggleTheme = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      AsyncStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  }, []);

  const setDark = useCallback((dark: boolean) => {
    setIsDark(dark);
    AsyncStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light').catch(() => {});
  }, []);

  const value: ThemeContextValue = {
    isDark,
    colors:  isDark ? darkColors  : lightColors,
    shadows: isDark ? darkShadow  : lightShadow,
    toggleTheme,
    setDark,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook — import this everywhere
// ─────────────────────────────────────────────────────────────────────────────

export function useAppTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}