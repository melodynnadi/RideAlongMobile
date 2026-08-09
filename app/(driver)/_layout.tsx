import { Tabs } from 'expo-router';
import { RouteErrorFallback } from '@/components/ErrorBoundary';
import { usePendingRatingGate } from '@/src/hooks/usePendingRatingGate';
import { useGlobalDriverEnRouteTracking } from '@/src/hooks/useGlobalDriverEnRouteTracking';
import { useAuthStore } from '@/stores/authStore';

export { RouteErrorFallback as ErrorBoundary };

export default function DriverTabLayout() {
  const { isAuthenticated, isEmailVerified } = useAuthStore();
  usePendingRatingGate('driver', isAuthenticated && isEmailVerified);
  useGlobalDriverEnRouteTracking(isAuthenticated && isEmailVerified);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="book" options={{ title: 'Offer' }} />
      <Tabs.Screen name="requests" options={{ title: 'Requests' }} />
      <Tabs.Screen name="messages" options={{ title: 'Messages' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />

      {/* Hidden from bottom nav, still routable */}
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="earnings" options={{ href: null }} />
      <Tabs.Screen name="invite" options={{ href: null }} />
      {/*
        Each settings screen is registered individually here (not as a single
        "settings" tab wrapping a nested Stack) so they don't share a
        navigator's history. Tabs keep child navigators mounted in the
        background rather than resetting them, so a shared nested Stack
        accumulated every screen ever pushed into it across the whole
        session (visit Vehicle Info, then later Ride History, and Vehicle
        Info was still sitting underneath it) — that stale history is what
        caused back navigation to land on old, unrelated screens. As
        independent leaf tabs (the same pattern already used successfully
        for messages/[chatId], request/[id], etc. below), each one is
        self-contained with no shared history to go stale.
      */}
      <Tabs.Screen name="settings/index" options={{ href: null }} />
      <Tabs.Screen name="settings/account-settings" options={{ href: null }} />
      <Tabs.Screen name="settings/change-phone" options={{ href: null }} />
      <Tabs.Screen name="settings/driver-profile" options={{ href: null }} />
      <Tabs.Screen name="settings/driver-ride-history" options={{ href: null }} />
      <Tabs.Screen name="settings/driver-ride-preferences" options={{ href: null }} />
      <Tabs.Screen name="settings/driver-student-verification" options={{ href: null }} />
      <Tabs.Screen name="settings/emergency-contacts" options={{ href: null }} />
      <Tabs.Screen name="settings/payout-history" options={{ href: null }} />
      <Tabs.Screen name="settings/driver-documents" options={{ href: null }} />
      <Tabs.Screen name="settings/vehicle-info" options={{ href: null }} />
      <Tabs.Screen name="messages/[chatId]" options={{ href: null }} />
      <Tabs.Screen name="request/[id]" options={{ href: null }} />
      <Tabs.Screen name="trip/[confirmedRideId]" options={{ href: null }} />
      <Tabs.Screen name="rider/[id]" options={{ href: null }} />
      <Tabs.Screen name="rate-trip" options={{ href: null }} />
      <Tabs.Screen name="my-postings" options={{ href: null }} />
      <Tabs.Screen name="edit-posting" options={{ href: null }} />
    </Tabs>
  );
}
