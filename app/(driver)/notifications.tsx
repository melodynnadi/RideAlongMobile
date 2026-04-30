import React from 'react';
import { Redirect } from 'expo-router';

// Legacy route shim: declarative redirect to the tabbed notifications screen
export default function NotificationsRedirect() {
  return <Redirect href="/(tabs)/notifications" />;
}
