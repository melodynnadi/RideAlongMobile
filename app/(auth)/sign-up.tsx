import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Eye, EyeOff, ChevronLeft } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '@/stores/authStore';
import type { ActiveRole } from '@/types';

export default function SignUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string }>();
  const role = (params.role === 'driver' ? 'driver' : 'rider') as ActiveRole;

  const { signUp } = useAuthStore();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [university, setUniversity] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSignUp = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      Toast.show({ type: 'error', text1: 'Please fill in all required fields.' });
      return;
    }
    if (password.length < 8) {
      Toast.show({ type: 'error', text1: 'Password must be at least 8 characters.' });
      return;
    }
    if (password !== confirmPassword) {
      Toast.show({ type: 'error', text1: 'Passwords do not match.' });
      return;
    }

    setSubmitting(true);
    try {
      await signUp({
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        university: university.trim() || undefined,
        role,
      });
      router.replace('/(auth)/verify-email');
    } catch (err: any) {
      const msg = err?.code === 'auth/email-already-in-use'
        ? 'An account with this email already exists.'
        : err?.message || 'Sign up failed. Please try again.';
      Toast.show({ type: 'error', text1: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabel = role === 'driver' ? 'Driver' : 'Rider';

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-6 pt-6">
            <TouchableOpacity className="mb-6 self-start" onPress={() => router.back()}>
              <ChevronLeft size={28} color="#F8FAFC" />
            </TouchableOpacity>

            <Text className="text-3xl font-bold text-text mb-1">
              Create {roleLabel} account
            </Text>
            <Text className="text-muted text-base mb-8">
              {role === 'driver'
                ? 'Start earning by driving fellow students.'
                : 'Get affordable, safe rides on campus.'}
            </Text>

            <View className="gap-4">
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-muted text-sm mb-2">First name *</Text>
                  <TextInput
                    className="bg-card border border-border rounded-2xl px-4 py-4 text-text"
                    placeholder="Jane"
                    placeholderTextColor="#94A3B8"
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-muted text-sm mb-2">Last name *</Text>
                  <TextInput
                    className="bg-card border border-border rounded-2xl px-4 py-4 text-text"
                    placeholder="Doe"
                    placeholderTextColor="#94A3B8"
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <View>
                <Text className="text-muted text-sm mb-2">Email *</Text>
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
                <Text className="text-muted text-sm mb-2">Phone</Text>
                <TextInput
                  className="bg-card border border-border rounded-2xl px-4 py-4 text-text"
                  placeholder="+1 (555) 000-0000"
                  placeholderTextColor="#94A3B8"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>

              <View>
                <Text className="text-muted text-sm mb-2">University</Text>
                <TextInput
                  className="bg-card border border-border rounded-2xl px-4 py-4 text-text"
                  placeholder="Your university"
                  placeholderTextColor="#94A3B8"
                  value={university}
                  onChangeText={setUniversity}
                  autoCapitalize="words"
                />
              </View>

              <View>
                <Text className="text-muted text-sm mb-2">Password *</Text>
                <View className="relative">
                  <TextInput
                    className="bg-card border border-border rounded-2xl px-4 py-4 text-text pr-12"
                    placeholder="Min. 8 characters"
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

              <View>
                <Text className="text-muted text-sm mb-2">Confirm password *</Text>
                <TextInput
                  className="bg-card border border-border rounded-2xl px-4 py-4 text-text"
                  placeholder="••••••••"
                  placeholderTextColor="#94A3B8"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                />
              </View>

              <TouchableOpacity
                className="bg-primary rounded-2xl py-4 items-center mt-2 active:opacity-80"
                onPress={handleSignUp}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-bold text-base">Create account</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')}>
                <Text className="text-center text-muted">
                  Already have an account?{' '}
                  <Text className="text-primary font-semibold">Sign in</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
