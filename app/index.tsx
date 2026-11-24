/**
 * Neutral start screen. Without it "/" resolved to the driver home, so that
 * screen mounted for everyone on launch (signed out and riders included) and
 * asked for location. AuthGate (app/_layout.tsx) sends people on from here.
 */
import { View } from 'react-native';
import { useAppTheme } from '@/hooks/ThemeContext';

export default function Index() {
  const { colors } = useAppTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
