import React from 'react';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

// Use a solid background on iOS to match Android/emulator appearance.
export default function TabBarBackground() {
  const theme = useTheme();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' /* or theme.colors.card */ }]} />;
}

export function useBottomTabOverflow() {
  return useBottomTabBarHeight();
}
