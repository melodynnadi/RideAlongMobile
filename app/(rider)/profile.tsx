import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut } from 'lucide-react-native';
import { useAuthStore } from '@/stores/authStore';

export default function RiderProfileScreen() {
  const { riderProfile, signOut } = useAuthStore();

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-8">
        <Text className="text-text text-2xl font-bold mb-6">Profile</Text>

        <View className="bg-card border border-border rounded-3xl p-6 mb-4">
          <Text className="text-text text-lg font-semibold mb-1">
            {riderProfile?.firstName} {riderProfile?.lastName}
          </Text>
          <Text className="text-muted">{riderProfile?.email}</Text>
          {riderProfile?.university && (
            <Text className="text-muted text-sm mt-1">{riderProfile.university}</Text>
          )}
        </View>

        <TouchableOpacity
          className="bg-card border border-error/30 rounded-2xl p-4 flex-row items-center gap-3"
          onPress={signOut}
        >
          <LogOut size={20} color="#EF4444" />
          <Text className="text-error font-medium">Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
