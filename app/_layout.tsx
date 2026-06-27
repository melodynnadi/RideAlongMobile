import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import * as NativeSplashScreen from 'expo-splash-screen';

import '../global.css';

import { useAuthStore } from '@/stores/authStore';
import { ThemeProvider } from '@/hooks/ThemeContext';
import DismissKeyboardView from '@/components/DismissKeyboardView';
import SplashScreen from '@/components/SplashScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const queryClient = new QueryClient();

NativeSplashScreen.preventAutoHideAsync().catch(() => {});

const SPLASH_MIN_MS = 2200;

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
  const isLoading = useAuthStore((s) => s.isLoading);
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);
  const [minSplashPassed, setMinSplashPassed] = useState(false);
  const [appSplashVisible, setAppSplashVisible] = useState(true);

  const hideNativeSplash = useCallback(() => {
    if (nativeSplashHidden) return;
    NativeSplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setNativeSplashHidden(true));
  }, [nativeSplashHidden]);

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashPassed(true), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLoading && minSplashPassed) setAppSplashVisible(false);
  }, [isLoading, minSplashPassed]);

  if (appSplashVisible) {
    return (
      <View style={{ flex: 1 }} onLayout={hideNativeSplash}>
        <SplashScreen animated={false} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} onLayout={hideNativeSplash}>
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

  useEffect(() => {
    const unsubscribe = initializeAuth();
    return unsubscribe;
  }, [initializeAuth]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ErrorBoundary>
              <DismissKeyboardView style={{ flex: 1 }}>
                <AppStack />
              </DismissKeyboardView>
            </ErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
