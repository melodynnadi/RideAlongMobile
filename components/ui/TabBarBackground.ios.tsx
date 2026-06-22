import React from 'react';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';

// Use a solid background on iOS to match Android/emulator appearance.
export default function TabBarBackground() {
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }]} />;
}

export function useBottomTabOverflow() {
  return useBottomTabBarHeight();
}
