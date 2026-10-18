import type { TextStyle } from 'react-native';

/**
 * Single-line TextInputs: give them a fixed height and NO vertical padding.
 *
 * On iOS a single-line field already centers its own text vertically. When its height
 * instead comes from vertical padding or from measuring the text, iOS can measure the
 * placeholder before layout settles and draw it pushed down and clipped (seen on the
 * sign-in email field and the Home "Houston, TX" field). Spread this into the style of
 * any single-line input and set a height (or alignSelf: 'stretch' inside a fixed-height row).
 * Not for multiline inputs — those need their padding.
 */
export const singleLineInput: TextStyle = {
  paddingVertical: 0,
  paddingTop: 0,
  paddingBottom: 0,
};
