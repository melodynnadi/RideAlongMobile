// RideAlong Design System — Mascot-accurate color tokens
// Bee body orange: #F97316  |  Bee stripe navy: #050C1E
// Light mode: navy text on white (bee stripe on wing)
// Dark mode:  orange glow on navy (bee body on stripe)

type WidenColorToken<T> =
  T extends readonly string[] ? string[] :
  T extends number ? number :
  T extends 'light-content' | 'dark-content' ? 'light-content' | 'dark-content' :
  T extends 'dark' | 'light' | 'default' ? 'dark' | 'light' | 'default' :
  T extends string ? string :
  T;

// ─────────────────────────────────────────────────────────────────────────────
// Shared brand constants (never change between modes)
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  orange:       '#F97316',   // bee body — primary CTA, active states
  orangeLight:  '#FB923C',   // lighter orange for hover/pressed
  orangeDeep:   '#EA6C0A',   // deeper orange for gradients
  navyDeep:     '#050C1E',   // bee stripe dark — dark mode bg
  navyMid:      '#0B1635',   // bee stripe mid
  navyCard:     '#0D1E45',   // bee stripe card
  navyText:     '#0D1B48',   // bee stripe — light mode primary text
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Dark mode palette  (bee stripe as canvas, bee body as accent)
// ─────────────────────────────────────────────────────────────────────────────

export const darkColors = {
  // Scaffolding
  bg:              '#050C1E',
  bgSecondary:     '#0B1635',
  bgCard:          '#0D1E45',
  bgElevated:      '#132247',
  bgInput:         'rgba(255,255,255,0.06)',
  bgOverlay:       'rgba(5,12,30,0.85)',

  // Brand
  primary:         '#F97316',
  primaryLight:    '#FB923C',
  primaryDim:      'rgba(249,115,22,0.16)',
  primaryBorder:   'rgba(249,115,22,0.32)',

  // Typography
  textPrimary:     '#F0F6FF',
  textSecondary:   '#8B9CB5',
  textTertiary:    '#4A5D78',
  textInverse:     '#050C1E',

  // Borders & dividers
  border:          'rgba(255,255,255,0.07)',
  borderMid:       'rgba(255,255,255,0.12)',
  borderStrong:    'rgba(255,255,255,0.20)',
  divider:         'rgba(255,255,255,0.06)',

  // Semantic — calibrated for dark bg
  green:           '#34D399',
  greenLight:      '#6EE7B7',
  greenDim:        'rgba(52,211,153,0.14)',
  greenBorder:     'rgba(52,211,153,0.30)',
  red:             '#F87171',
  redDeep:         '#EF4444',
  redDim:          'rgba(239,68,68,0.12)',
  redBorder:       'rgba(239,68,68,0.26)',
  blue:            '#60A5FA',
  blueDim:         'rgba(96,165,250,0.14)',
  blueBorder:      'rgba(96,165,250,0.28)',
  purple:          '#A78BFA',
  purpleDim:       'rgba(167,139,250,0.14)',
  purpleBorder:    'rgba(167,139,250,0.28)',
  amber:           '#FBBF24',
  amberDim:        'rgba(251,191,36,0.14)',
  amberBorder:     'rgba(251,191,36,0.28)',
  teal:            '#2DD4BF',
  tealDim:         'rgba(45,212,191,0.14)',
  tealBorder:      'rgba(45,212,191,0.28)',

  // Map / hero elements
  mapGrid:         'rgba(59,130,246,0.06)',
  mapRoad:         'rgba(30,60,120,0.42)',
  mapOverlayBg:    'rgba(5,12,30,0.70)',

  // iOS glass card
  glassBg:         'rgba(13,30,69,0.55)',
  glassIntensity:  12,
  glassTint:       'dark' as 'dark' | 'light' | 'default',

  // Switch
  switchTrackOff:  'rgba(255,255,255,0.10)',
  switchTrackOn:   'rgba(249,115,22,0.55)',
  switchThumbOff:  '#2E3F5C',
  switchThumbOn:   '#F97316',
  switchIosBg:     'rgba(255,255,255,0.08)',

  // Status bar
  statusBar:       'light-content' as 'light-content' | 'dark-content',

  // Gradient stops
  gradientBg:      ['#050C1E', '#0B1635', '#0A1530'] as string[],
  gradientHero:    ['#071526', '#0D2545', '#091E3A'] as string[],
  gradientCard:    ['#0D1E45', '#132247'] as string[],
  gradientOrange:  ['#F97316', '#EA6C0A'] as string[],
  gradientGreen:   ['#34D399', '#059669'] as string[],

  // Avatar fallback
  avatarGradient:  ['#F97316', '#EA6C0A'] as string[],
} as const;

export type AppColors = {
  -readonly [K in keyof typeof darkColors]: WidenColorToken<(typeof darkColors)[K]>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Light mode palette  (bee wing white as canvas, navy text, orange accent)
// ─────────────────────────────────────────────────────────────────────────────

export const lightColors: AppColors = {
  // Scaffolding — matches existing app cream palette
  bg:              '#FBFAF7',
  bgSecondary:     '#F2EFE9',
  bgCard:          '#FFFFFF',
  bgElevated:      '#FFFFFF',
  bgInput:         'rgba(21,35,58,0.05)',
  bgOverlay:       'rgba(251,250,247,0.92)',

  // Brand — matches existing app orange
  primary:         '#DE5D20',
  primaryLight:    '#E8714A',
  primaryDim:      'rgba(222,93,32,0.10)',
  primaryBorder:   'rgba(222,93,32,0.25)',

  // Typography — matches existing app navy
  textPrimary:     '#15233A',
  textSecondary:   '#8A8A8E',
  textTertiary:    '#B0ABAB',
  textInverse:     '#FFFFFF',

  // Borders & dividers — matches existing app border
  border:          '#E4E1D9',
  borderMid:       'rgba(21,35,58,0.14)',
  borderStrong:    'rgba(21,35,58,0.24)',
  divider:         'rgba(228,225,217,0.8)',

  // Semantic — calibrated for white bg
  green:           '#059669',
  greenLight:      '#34D399',
  greenDim:        'rgba(5,150,105,0.10)',
  greenBorder:     'rgba(5,150,105,0.25)',
  red:             '#DC2626',
  redDeep:         '#DC2626',
  redDim:          'rgba(220,38,38,0.08)',
  redBorder:       'rgba(220,38,38,0.22)',
  blue:            '#2563EB',
  blueDim:         'rgba(37,99,235,0.10)',
  blueBorder:      'rgba(37,99,235,0.22)',
  purple:          '#7C3AED',
  purpleDim:       'rgba(124,58,237,0.10)',
  purpleBorder:    'rgba(124,58,237,0.22)',
  amber:           '#D97706',
  amberDim:        'rgba(217,119,6,0.10)',
  amberBorder:     'rgba(217,119,6,0.22)',
  teal:            '#0D9488',
  tealDim:         'rgba(13,148,136,0.10)',
  tealBorder:      'rgba(13,148,136,0.22)',

  // Map / hero elements
  mapGrid:         'rgba(13,27,72,0.06)',
  mapRoad:         'rgba(13,27,72,0.12)',
  mapOverlayBg:    'rgba(247,249,255,0.88)',

  // iOS glass card — light mode uses solid white + shadow
  glassBg:         'rgba(255,255,255,0.92)',
  glassIntensity:  20,
  glassTint:       'light',

  // Switch
  switchTrackOff:  'rgba(13,27,72,0.12)',
  switchTrackOn:   'rgba(249,115,22,0.50)',
  switchThumbOff:  '#FFFFFF',
  switchThumbOn:   '#F97316',
  switchIosBg:     'rgba(13,27,72,0.10)',

  // Status bar
  statusBar:       'dark-content',

  // Gradient stops
  gradientBg:      ['#F7F9FF', '#EEF2FF', '#E8EFFF'],
  gradientHero:    ['#EEF2FF', '#E0E9FF', '#D4E2FF'],
  gradientCard:    ['#FFFFFF', '#F7F9FF'],
  gradientOrange:  ['#F97316', '#EA6C0A'],
  gradientGreen:   ['#34D399', '#059669'],

  // Avatar
  avatarGradient:  ['#F97316', '#EA6C0A'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Semantic icon palette — same keys, mode-aware values
// Usage: C.iconColor('blue') returns the right blue for current mode
// ─────────────────────────────────────────────────────────────────────────────

export type SemanticColor =
  | 'orange'
  | 'green'
  | 'red'
  | 'blue'
  | 'purple'
  | 'amber'
  | 'teal'
  | 'muted';

export function iconPalette(colors: AppColors, key: SemanticColor) {
  const map: Record<SemanticColor, { color: string; bg: string; border: string }> = {
    orange: {
      color: colors.primary,
      bg: colors.primaryDim,
      border: colors.primaryBorder,
    },
    green: {
      color: colors.green,
      bg: colors.greenDim,
      border: colors.greenBorder,
    },
    red: {
      color: colors.redDeep,
      bg: colors.redDim,
      border: colors.redBorder,
    },
    blue: {
      color: colors.blue,
      bg: colors.blueDim,
      border: colors.blueBorder,
    },
    purple: {
      color: colors.purple,
      bg: colors.purpleDim,
      border: colors.purpleBorder,
    },
    amber: {
      color: colors.amber,
      bg: colors.amberDim,
      border: colors.amberBorder,
    },
    teal: {
      color: colors.teal,
      bg: colors.tealDim,
      border: colors.tealBorder,
    },
    muted: {
      color: colors.textTertiary,
      bg: 'rgba(139,156,181,0.12)',
      border: 'rgba(139,156,181,0.20)',
    },
  };

  return map[key];
}

// ─────────────────────────────────────────────────────────────────────────────
// Typography scale (same across modes)
// ─────────────────────────────────────────────────────────────────────────────

export const TYPE = {
  largeTitle:  { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
  title1:      { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.4 },
  title2:      { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  title3:      { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.2 },
  headline:    { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.3 },
  body:        { fontSize: 17, fontWeight: '400' as const, letterSpacing: -0.1 },
  callout:     { fontSize: 16, fontWeight: '500' as const, letterSpacing: -0.1 },
  subhead:     { fontSize: 15, fontWeight: '500' as const, letterSpacing: -0.1 },
  footnote:    { fontSize: 13, fontWeight: '400' as const },
  caption1:    { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0 },
  caption2:    { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Spacing & radius (iOS 8pt grid)
// ─────────────────────────────────────────────────────────────────────────────

export const SPACE = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  24,
  xxxl: 32,
} as const;

export const RADIUS = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   18,
  xxl:  22,
  full: 9999,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shadow presets — light mode uses elevation, dark uses glow
// ─────────────────────────────────────────────────────────────────────────────

export const lightShadow = {
  sm: {
    shadowColor: '#0D1B48',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#0D1B48',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
  },
  lg: {
    shadowColor: '#0D1B48',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 20,
    elevation: 8,
  },
  card: {
    shadowColor: '#0D1B48',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
};

export const darkShadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.20,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.30,
    shadowRadius: 10,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.40,
    shadowRadius: 20,
    elevation: 8,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 3,
  },
};