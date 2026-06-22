import { Tabs } from 'expo-router';

export default function DriverTabLayout() {
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
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="legal" options={{ href: null }} />
      <Tabs.Screen name="legal/privacy" options={{ href: null }} />
      <Tabs.Screen name="legal/terms" options={{ href: null }} />
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
