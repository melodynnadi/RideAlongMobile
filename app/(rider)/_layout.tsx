import { router, Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { RouteErrorFallback } from '@/components/ErrorBoundary';

export { RouteErrorFallback as ErrorBoundary };

import { HapticTab } from '@/components/HapticTab';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { useAppTheme } from '@/hooks/ThemeContext';
import { useAuthStore } from '@/stores/authStore';
import { useRiderUnreadCounts } from '@/hooks/useRiderUnreadCounts';
import { usePendingRatingGate } from '@/src/hooks/usePendingRatingGate';
import { useGlobalRiderTracking } from '@/src/hooks/useGlobalRiderTracking';

export default function RiderTabLayout() {
  const { colors } = useAppTheme();
  const { isAuthenticated, isEmailVerified, checkEmailVerification } = useAuthStore();
  const { messageCount: totalUnread } = useRiderUnreadCounts();
  usePendingRatingGate('rider', isAuthenticated && isEmailVerified);
  useGlobalRiderTracking(isAuthenticated && isEmailVerified);

  useEffect(() => {
    if (isAuthenticated && !isEmailVerified) {
      const verifyStatus = async () => {
        try {
          const verified = await checkEmailVerification();
          if (!verified) router.replace('/(auth)/verify-email');
        } catch {
          router.replace('/(auth)/verify-email');
        }
      };
      verifyStatus();
    }
  }, [isAuthenticated, isEmailVerified, checkEmailVerification]);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: {
          display: 'none',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size || 24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="book"
        options={{
          title: 'Request',
          tabBarIcon: ({ color, size }) => <Ionicons name="add-circle-outline" size={size || 24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Rides',
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size || 24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size || 24} color={color} />,
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.redDeep, color: colors.textInverse, fontSize: 12, fontWeight: 'bold' },
        }}
      />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size || 24} color={color} />,
        }}
      />
      {/* Hide all non-tab screens from the tab bar */}
      <Tabs.Screen name="available-rides" options={{ href: null, title: 'Rides' }} />
      <Tabs.Screen name="booking-confirmed" options={{ href: null }} />
      <Tabs.Screen name="trip-in-progress" options={{ href: null }} />
      <Tabs.Screen name="rate-trip" options={{ href: null }} />
      {/*
        Each settings screen is registered individually here (not as a single
        "settings" tab wrapping a nested Stack) so they don't share a
        navigator's history. Tabs keep child navigators mounted in the
        background rather than resetting them, so a shared nested Stack
        accumulated every screen ever pushed into it across the whole
        session (visit Emergency Contacts, then later Ride History, and
        Emergency Contacts was still sitting underneath it) — that stale
        history is what caused back navigation to land on old, unrelated
        screens. As independent leaf tabs (the same pattern already used
        successfully for messages/[chatId], driver/[driverId], etc. below),
        each one is self-contained with no shared history to go stale.
      */}
      <Tabs.Screen name="settings/index" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/account-settings" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/change-password" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/change-phone" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/emergency-contacts" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/payment-methods" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/ride-history" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/ride-preferences" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/saved-routes" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/student-verification" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings/payment-methods-enhanced" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="messages/[chatId]" options={{ href: null }} />
      <Tabs.Screen name="ride/[id]" options={{ href: null }} />
      <Tabs.Screen name="trip/[confirmedRideId]" options={{ href: null }} />
      <Tabs.Screen name="driver/[driverId]" options={{ href: null }} />
      <Tabs.Screen name="become-driver" options={{ href: null }} />
    </Tabs>
  );
}
