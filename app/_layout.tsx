import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import '../global.css';

import { useAuthStore } from '@/stores/authStore';
import { ThemeProvider} from '@/hooks/ThemeContext';
import DismissKeyboardView from '@/components/DismissKeyboardView';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const queryClient = new QueryClient();

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

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FBFAF7', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#DE5D20" />
      </View>
    );
  }

  return (
    <>
      <AuthGate />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(rider)" />
        <Stack.Screen name="(driver)" />
      </Stack>
      <Toast />
    </>
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
