import React, { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

// Legacy route shim: keep this lightweight redirect to the tabbed notifications screen
export default function NotificationsRedirect() {
  useEffect(() => {
    router.replace('/(tabs)/notifications');
  }, []);
  return <View />;
}
