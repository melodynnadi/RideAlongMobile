import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const layout = {
  screenPadding: 20,
  screenPaddingCompact: 16,
  contentMaxWidth: 720,
  sectionGap: 32,
  cardGap: 16,
  minimumTouchTarget: 44,
  tabBarHeight: 64,
} as const;

export const typography = {
  display: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -0.8 } as TextStyle,
  title1: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 } as TextStyle,
  title2: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25 } as TextStyle,
  title3: { fontSize: 20, lineHeight: 26, fontWeight: '700' } as TextStyle,
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' } as TextStyle,
  bodyStrong: { fontSize: 16, lineHeight: 23, fontWeight: '600' } as TextStyle,
  callout: { fontSize: 14, lineHeight: 20, fontWeight: '500' } as TextStyle,
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '500' } as TextStyle,
  overline: { fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' } as TextStyle,
} as const;

export const appHeader = {
  row: {
    position: 'relative',
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,
  title: {
    ...typography.title2,
  } as TextStyle,
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
} as const;
export const hitSlop = { top: 8, right: 8, bottom: 8, left: 8 } as const;

export const surfaceShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#0D1B48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
  },
  android: { elevation: 3 },
  default: {},
}) as ViewStyle;
