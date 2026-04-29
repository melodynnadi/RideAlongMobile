import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Car, MapPin } from 'lucide-react-native';

export default function SelectRoleScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-12 pb-8">
        <View className="mb-12">
          <Text className="text-3xl font-bold text-text mb-2">Join RideAlong</Text>
          <Text className="text-muted text-base">
            How would you like to use RideAlong? You can always add the other role later.
          </Text>
        </View>

        <View className="gap-4">
          <TouchableOpacity
            className="bg-card border border-primary/30 rounded-3xl p-6 active:opacity-80"
            onPress={() => router.push({ pathname: '/(auth)/sign-up', params: { role: 'rider' } })}
          >
            <View className="w-14 h-14 bg-primary/20 rounded-2xl items-center justify-center mb-4">
              <MapPin size={28} color="#E05E1A" />
            </View>
            <Text className="text-text text-xl font-bold mb-2">Ride with us</Text>
            <Text className="text-muted text-sm leading-5">
              Book affordable rides to and from campus. Safe, verified drivers.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="bg-card border border-border rounded-3xl p-6 active:opacity-80"
            onPress={() => router.push({ pathname: '/(auth)/sign-up', params: { role: 'driver' } })}
          >
            <View className="w-14 h-14 bg-secondary/40 rounded-2xl items-center justify-center mb-4">
              <Car size={28} color="#F8FAFC" />
            </View>
            <Text className="text-text text-xl font-bold mb-2">Drive & earn</Text>
            <Text className="text-muted text-sm leading-5">
              Earn money giving rides to fellow students on your schedule.
            </Text>
          </TouchableOpacity>
        </View>

        <View className="mt-auto">
          <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')}>
            <Text className="text-center text-muted">
              Already have an account?{' '}
              <Text className="text-primary font-semibold">Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
