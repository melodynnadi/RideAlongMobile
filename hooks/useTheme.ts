import { theme, colors, spacing, borderRadius, shadows } from '@/theme';

export interface Theme {
  colors: typeof colors;
  borderRadius: typeof borderRadius;
  spacing: typeof spacing;
  shadows: typeof shadows;
}

export function useTheme(): Theme {
  return { colors, borderRadius, spacing, shadows };
}
