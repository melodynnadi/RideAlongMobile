/**
 * Drop-in KeyboardAvoidingView. With edge to edge on, Android reports a closed
 * keyboard as ending above the system bars, so React Native's version leaves a
 * gap under the content after the keyboard closes. Here it only adjusts while the
 * keyboard is actually open. iOS behaviour is unchanged.
 */
import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  KeyboardAvoidingViewProps,
  Platform,
} from 'react-native';

/** Whether the Android keyboard is open; always false on iOS. */
export function useAndroidKeyboardOpen(): boolean {
  const [open, setOpen] = useState(() => Platform.OS === 'android' && Keyboard.isVisible());
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return open;
}

export function KeyboardAvoidingView({ enabled = true, ...props }: KeyboardAvoidingViewProps) {
  const open = useAndroidKeyboardOpen();
  return <RNKeyboardAvoidingView {...props} enabled={enabled && (Platform.OS !== 'android' || open)} />;
}