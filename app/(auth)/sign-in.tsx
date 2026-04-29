import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '@/stores/authStore';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, isLoading } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      Toast.show({ type: 'error', text1: 'Please enter your email and password.' });
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      // Navigation handled by AuthGate in _layout.tsx
    } catch (err: any) {
      const msg = err?.code === 'auth/invalid-credential'
        ? 'Incorrect email or password.'
        : err?.message || 'Sign in failed. Please try again.';
      Toast.show({ type: 'error', text1: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 px-6 pt-12 pb-8 justify-between">
            <View>
              <Text className="text-3xl font-bold text-text mb-2">Welcome back</Text>
              <Text className="text-muted text-base mb-10">Sign in to your RideAlong account</Text>

              <View className="gap-4">
                <View>
                  <Text className="text-muted text-sm mb-2">Email</Text>
                  <TextInput
                    className="bg-card border border-border rounded-2xl px-4 py-4 text-text"
                    placeholder="you@example.com"
                    placeholderTextColor="#94A3B8"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View>
                  <Text className="text-muted text-sm mb-2">Password</Text>
                  <View className="relative">
                    <TextInput
                      className="bg-card border border-border rounded-2xl px-4 py-4 text-text pr-12"
                      placeholder="••••••••"
                      placeholderTextColor="#94A3B8"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                    />
                    <TouchableOpacity
                      className="absolute right-4 top-4"
                      onPress={() => setShowPassword((v) => !v)}
                    >
                      {showPassword
                        ? <EyeOff size={20} color="#94A3B8" />
                        : <Eye size={20} color="#94A3B8" />}
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  className="self-end"
                  onPress={() => router.push('/(auth)/forgot-password')}
                >
                  <Text className="text-primary text-sm">Forgot password?</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View className="gap-4">
              <TouchableOpacity
                className="bg-primary rounded-2xl py-4 items-center active:opacity-80"
                onPress={handleSignIn}
                disabled={submitting || isLoading}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-base">Sign in</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => router.push('/(auth)/select-role')}>
                <Text className="text-center text-muted">
                  New here?{' '}
                  <Text className="text-primary font-semibold">Create an account</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
