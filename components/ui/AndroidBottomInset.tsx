/**
 * Android draws the app edge to edge, so anything pinned to the bottom of the
 * screen (tab bars, action bars, bottom sheets) sits underneath the system
 * navigation bar: about 24dp with gestures, 48dp with the three buttons.
 * iOS layouts already account for the home indicator, so these are no-ops there.
 */
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAndroidKeyboardOpen } from '@/components/ui/KeyboardAvoidingView';

/** Height of Android's system navigation bar; 0 on other platforms. */
export function useAndroidBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  return Platform.OS === 'android' ? bottom : 0;
}

/** Last child of a bottom sheet or bottom bar: keeps its buttons above the system bar. */
export function AndroidBottomSpacer() {
  const height = useAndroidBottomInset();
  // The keyboard covers the system bar, so the gap isn't needed while it's open.
  const keyboardOpen = useAndroidKeyboardOpen();
  return height > 0 && !keyboardOpen ? <View style={{ height }} /> : null;
}

const NAV_OFFSET = 14;

/** Distance of the floating tab bar from the bottom of the screen. */
export function useBottomNavOffset(): number {
  const inset = useAndroidBottomInset();
  return inset > 0 ? Math.max(NAV_OFFSET, inset + 8) : NAV_OFFSET;
}

/** Extra scroll padding needed because the tab bar was raised (0 on iOS). */
export function useBottomNavExtra(): number {
  return useBottomNavOffset() - NAV_OFFSET;
}
