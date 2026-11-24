import { useState } from 'react';
import { Platform } from 'react-native';

const START = { start: 0, end: 0 };

/**
 * Android leaves a long single-line value scrolled to its end, so an address shows
 * "...Mountain View, California" instead of the street. Pins the caret to the start
 * while the field isn't being edited. iOS already shows the start.
 */
export function useStartOfTextWhenBlurred() {
  const [focused, setFocused] = useState(false);
  return {
    selection: Platform.OS === 'android' && !focused ? START : undefined,
    onFocusChange: setFocused,
  };
}
