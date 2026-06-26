import { router, Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { RouteErrorFallback } from '@/components/ErrorBoundary';

export { RouteErrorFallback as ErrorBoundary };

import { HapticTab } from '@/components/HapticTab';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/stores/authStore';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';

export default function RiderTabLayout() {
  const theme = useTheme();
  const { isAuthenticated, isEmailVerified, checkEmailVerification } = useAuthStore();
  const totalUnread = useUnreadMessages();

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
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.muted,
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
          tabBarBadgeStyle: { backgroundColor: '#EF4444', color: '#FFFFFF', fontSize: 12, fontWeight: 'bold' },
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
      <Tabs.Screen name="settings" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="messages/[chatId]" options={{ href: null }} />
      <Tabs.Screen name="ride/[id]" options={{ href: null }} />
      <Tabs.Screen name="trip/[confirmedRideId]" options={{ href: null }} />
      <Tabs.Screen name="driver/[driverId]" options={{ href: null }} />
    </Tabs>
  );
}
