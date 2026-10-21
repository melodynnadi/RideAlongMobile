import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { toastConfig } from '@/components/ui/RideAlongToast';
import * as NativeSplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { StripeProvider } from '@stripe/stripe-react-native';
import '../global.css';

import { useAuthStore } from '@/stores/authStore';
import { ThemeProvider } from '@/hooks/ThemeContext';
import DismissKeyboardView from '@/components/DismissKeyboardView';
import SplashScreen from '@/components/SplashScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { notificationService } from '@/src/services/notificationService';
import { setupChatNotificationListeners } from '@/src/services/notificationListeners';
import { resetRideAlertSync, syncRideAlertLocation } from '@/src/services/rideAlerts';
import { readEmergencyContacts } from '@/src/services/privateProfile';
import { firebaseAuth } from '@/constants/services';

// Crash reporting — set EXPO_PUBLIC_SENTRY_DSN in .env to enable
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    // Tag every event with app context for easy filtering
    initialScope: { tags: { app: 'ridealong-mobile' } },
  });
} else if (!__DEV__) {
  console.warn('[Sentry] EXPO_PUBLIC_SENTRY_DSN not set — crash reporting disabled in production');
}

// Keep native splash up until we explicitly hide it on first React frame.
NativeSplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const SPLASH_MIN_MS = 2200;

// Module-level flag so the splash never shows twice if Expo Router remounts root.
let splashAlreadyShown = false;

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading, isEmailVerified, activeRole, riderProfile, driverProfile } = useAuthStore();
  const riderOnboardingPending = riderProfile?.profileOnboardingPending === true;
  const driverOnboardingPending = driverProfile?.profileOnboardingPending === true;

  useEffect(() => {
    if (isLoading) return;

    // Links from emails (https://ridealongapp.com/open/...) route themselves
    // once auth has loaded — see app/open/[...slug].tsx.
    if ((segments[0] as string) === 'open') return;

    const inAuth = segments[0] === '(auth)';
    const inRider = segments[0] === '(rider)';
    const inDriver = segments[0] === '(driver)';

    if (!isAuthenticated) {
      if (!inAuth) router.replace('/(auth)/welcome');
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

    // Only allow driver-signup for riders upgrading — already-registered drivers go to /(driver).
    if (inAuth && segments[1] === 'driver-signup' && activeRole !== 'driver') return;

    // New accounts set up their profile (photo, about, preferences) once, right after verifying.
    // The flag lives on the role's doc (set at sign-up, or by the server when a driver is approved),
    // so it survives closing the app.
    if (activeRole === 'driver') {
      if (driverOnboardingPending) {
        if (segments[1] !== 'complete-profile') router.replace('/(auth)/complete-profile');
        return;
      }
      if (!inDriver) router.replace('/(driver)');
      return;
    }

    if (activeRole === 'rider') {
      if (riderOnboardingPending) {
        if (segments[1] !== 'complete-profile') router.replace('/(auth)/complete-profile');
        return;
      }
      if (!inRider) router.replace('/(rider)');
      return;
    }
  }, [isAuthenticated, isLoading, isEmailVerified, activeRole, riderOnboardingPending, driverOnboardingPending, segments, router]);

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
      <Toast config={toastConfig} />
    </View>
  );
}

export default function RootLayout() {
  const initializeAuth = useAuthStore((s) => s.initializeAuth);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const activeRole = useAuthStore((s) => s.activeRole);
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

  // Request an Expo push token and persist it once signed in, and again on
  // role switch (dual-role users). Without this, no device ever registers a
  // token, so nothing server-side has anywhere to send a push to.
  useEffect(() => {
    if (!isAuthenticated || !activeRole) return;
    notificationService.registerAndSaveToken(activeRole).catch((error) => {
      console.warn('[RootLayout] Failed to register push token:', error);
    });
  }, [isAuthenticated, activeRole]);

  // Move emergency contacts off the publicly readable users/{uid} doc (a no-op once moved).
  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!isAuthenticated || !uid) return;
    readEmergencyContacts(uid).catch(() => undefined);
  }, [isAuthenticated]);

  // Keep the approximate location used for "ride near you" alerts fresh:
  // on sign-in / role switch and whenever the app returns to the foreground.
  // Silent — never prompts for permission (see src/services/rideAlerts.ts).
  useEffect(() => {
    if (!isAuthenticated || !activeRole) return;
    syncRideAlertLocation(activeRole).catch(() => undefined);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncRideAlertLocation(activeRole).catch(() => undefined);
    });
    return () => sub.remove();
  }, [isAuthenticated, activeRole]);

  useEffect(() => {
    if (!isAuthenticated) resetRideAlertSync();
  }, [isAuthenticated]);

  // Watch for new chat messages so at least a local (in-process) notification
  // fires while the app is backgrounded, independent of any server-sent push.
  useEffect(() => {
    if (!isAuthenticated || !activeRole) return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    return setupChatNotificationListeners(uid, activeRole);
  }, [isAuthenticated, activeRole]);

  useEffect(() => {
    if (!splashVisible) return;
    const t = setTimeout(() => setMinSplashPassed(true), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, [splashVisible]);

  useEffect(() => {
    if (!isLoading && minSplashPassed) setSplashVisible(false);
  }, [isLoading, minSplashPassed]);

  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
      merchantIdentifier="merchant.com.ridealong.app"
    >
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
                  <SplashScreen animated={false} />
                </View>
              )}
            </ErrorBoundary>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </StripeProvider>
  );
}
