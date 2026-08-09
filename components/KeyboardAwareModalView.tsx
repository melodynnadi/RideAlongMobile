import React, { type PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, StyleProp, ViewStyle } from 'react-native';

import DismissKeyboardView from '@/components/DismissKeyboardView';

type KeyboardAwareModalViewProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  keyboardVerticalOffset?: number;
}>;

export default function KeyboardAwareModalView({ children, style, keyboardVerticalOffset = 0 }: KeyboardAwareModalViewProps) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      <DismissKeyboardView style={style}>{children}</DismissKeyboardView>
    </KeyboardAvoidingView>
  );
}
