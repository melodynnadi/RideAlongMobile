export * from './colors';
export * from './designSystem';

export const theme = {
  colors: {
    primary: '#F97316',
    secondary: '#0D1B48',
    accent: '#4F46E5',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    bg: '#0B1220',
    card: '#101826',
    text: '#F8FAFC',
    muted: '#94A3B8',
    border: '#1E2D45',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    '2xl': 48,
    '3xl': 64,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    '2xl': 24,
    '3xl': 32,
    full: 9999,
  },
} as const;
