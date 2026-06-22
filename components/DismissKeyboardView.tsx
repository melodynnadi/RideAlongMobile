import React, { type PropsWithChildren } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

type DismissKeyboardViewProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export default function DismissKeyboardView({ children, style }: DismissKeyboardViewProps) {
  return (
    <View style={style}>
      {children}
    </View>
  );
}
