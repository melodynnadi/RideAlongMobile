import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { HapticTab } from '@/components/HapticTab';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { useTheme } from '@/hooks/useTheme';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';

export default function DriverTabLayout() {
  const theme = useTheme();
  const totalUnread = useUnreadMessages();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.muted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: {
          backgroundColor: '#101826',
          borderTopColor: '#1E2D45',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 90 : 80,
          paddingBottom: Platform.OS === 'ios' ? 25 : 15,
          paddingTop: 10,
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
          title: 'Offer',
          tabBarIcon: ({ color, size }) => <Ionicons name="car" size={size || 24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          title: 'Requests',
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
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications" size={size || 24} color={color} />,
        }}
      />
      <Tabs.Screen name="earnings" options={{ href: null }} />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size || 24} color={color} />,
        }}
      />
      {/* Hide all non-tab screens from the tab bar */}
      <Tabs.Screen name="invite" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="legal" options={{ href: null }} />
      <Tabs.Screen name="legal/privacy" options={{ href: null }} />
      <Tabs.Screen name="legal/terms" options={{ href: null }} />
      <Tabs.Screen name="messages/[chatId]" options={{ href: null }} />
      <Tabs.Screen name="request/[id]" options={{ href: null }} />
      <Tabs.Screen name="rider/[id]" options={{ href: null }} />
    </Tabs>
  );
}
