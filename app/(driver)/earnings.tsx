import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DriverEarningsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-8">
        <Text className="text-text text-2xl font-bold mb-6">Earnings</Text>
        <View className="bg-card border border-border rounded-3xl p-6 items-center justify-center h-48">
          <Text className="text-muted text-center">Earnings dashboard coming soon</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
