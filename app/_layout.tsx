import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as NativeSplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import '../global.css';

import { useAuthStore } from '@/stores/authStore';
import { ThemeProvider } from '@/hooks/ThemeContext';
import DismissKeyboardView from '@/components/DismissKeyboardView';
import SplashScreen from '@/components/SplashScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { notificationService } from '@/src/services/notificationService';

// Keep native splash up until we explicitly hide it on first React frame.
NativeSplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const SPLASH_MIN_MS = 2200;

// Module-level flag so the splash never shows twice if Expo Router remounts root.
let splashAlreadyShown = false;

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading, isEmailVerified, activeRole } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;

    const inAuth = segments[0] === '(auth)';
    const inRider = segments[0] === '(rider)';
    const inDriver = segments[0] === '(driver)';

    if (!isAuthenticated) {
      if (!inAuth) router.replace('/(auth)/sign-in');
      return;
    }

    if (!isEmailVerified) {
      if (segments[1] !== 'verify-email') router.replace('/(auth)/verify-email');
      return;
    }

    if (!activeRole) {
       if (!inAuth) router.replace('/(auth)/select-role');
      return;
    }

    // Allow authenticated users to visit driver-signup for the upgrade flow.
    if (inAuth && segments[1] === 'driver-signup') return;

    if (activeRole === 'driver') {
      if (!inDriver) router.replace('/(driver)');
      return;
    }

    if (activeRole === 'rider') {
      if (!inRider) router.replace('/(rider)');
      return;
    }
  }, [isAuthenticated, isLoading, isEmailVerified, activeRole, segments, router]);

  return null;
}

function AppStack() {
  return (
    <View style={{ flex: 1 }}>
      <AuthGate />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(rider)" />
        <Stack.Screen name="(driver)" />
      </Stack>
      <Toast />
    </View>
  );
}

export default function RootLayout() {
  const initializeAuth = useAuthStore((s) => s.initializeAuth);
  const isLoading = useAuthStore((s) => s.isLoading);
  const [minSplashPassed, setMinSplashPassed] = useState(false);
  const [splashVisible, setSplashVisible] = useState(() => !splashAlreadyShown);
  const nativeHiddenRef = useRef(false);

  useEffect(() => {
    // Dismiss the native splash on the very first frame.
    if (!nativeHiddenRef.current) {
      nativeHiddenRef.current = true;
      NativeSplashScreen.hideAsync();
    }
    if (!splashAlreadyShown) splashAlreadyShown = true;

    const unsubscribe = initializeAuth();
    return unsubscribe;
  }, [initializeAuth]);

  // Wire up push notification listeners once on mount.
  useEffect(() => {
    notificationService.setupNotificationListeners();

    // Handle taps from killed-state: the response listener doesn't fire in that case,
    // so we must manually check the last response when the app launches.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response?.notification?.request?.content?.data) {
        // Small delay to let the router and auth state settle before navigating.
        setTimeout(() => {
          (notificationService as any).handleNotificationTap(
            response.notification.request.content.data
          );
        }, 1500);
      }
    }).catch(() => undefined);

    return () => notificationService.cleanup();
  }, []);

  useEffect(() => {
    if (!splashVisible) return;
    const t = setTimeout(() => setMinSplashPassed(true), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, [splashVisible]);

  useEffect(() => {
    if (!isLoading && minSplashPassed) setSplashVisible(false);
  }, [isLoading, minSplashPassed]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ErrorBoundary>
              <DismissKeyboardView style={{ flex: 1 }}>
                <AppStack />
              </DismissKeyboardView>
              {splashVisible && (
                <View style={StyleSheet.absoluteFill}>
                  <SplashScreen />
                </View>
              )}
            </ErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
