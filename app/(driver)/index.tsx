import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin } from 'lucide-react-native';
import { useAuthStore } from '@/stores/authStore';

export default function DriverHomeScreen() {
  const { driverProfile, role, switchRole } = useAuthStore();
  const firstName = driverProfile?.firstName || 'there';

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-8">
        <View className="flex-row items-center justify-between mb-8">
          <View>
            <Text className="text-muted text-sm">Ready to drive,</Text>
            <Text className="text-text text-2xl font-bold">{firstName}</Text>
          </View>
          {role === 'both' && (
            <TouchableOpacity
              className="bg-card border border-border rounded-2xl px-4 py-2 flex-row items-center gap-2"
              onPress={() => switchRole('rider')}
            >
              <MapPin size={16} color="#94A3B8" />
              <Text className="text-muted text-sm">Switch to Rider</Text>
            </TouchableOpacity>
          )}
        </View>

        <View className="bg-card border border-border rounded-3xl p-6 items-center justify-center h-48">
          <Text className="text-muted text-center">
            Map and ride matching coming soon
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
