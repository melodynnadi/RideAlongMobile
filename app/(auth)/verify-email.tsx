import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mail } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '@/stores/authStore';

export default function VerifyEmailScreen() {
  const { email, sendVerificationEmail, checkEmailVerification, signOut } = useAuthStore();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  const handleCheckVerification = async () => {
    setChecking(true);
    try {
      const verified = await checkEmailVerification();
      if (!verified) {
        Toast.show({ type: 'info', text1: 'Email not verified yet.', text2: 'Check your inbox and click the link.' });
      }
      // If verified, AuthGate in _layout will redirect automatically
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await sendVerificationEmail();
      Toast.show({ type: 'success', text1: 'Verification email sent!' });
    } catch {
      Toast.show({ type: 'error', text1: 'Failed to send email. Try again shortly.' });
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 items-center justify-center gap-6">
        <View className="w-20 h-20 bg-primary/20 rounded-3xl items-center justify-center">
          <Mail size={40} color="#E05E1A" />
        </View>

        <View className="items-center gap-2">
          <Text className="text-2xl font-bold text-text">Check your email</Text>
          <Text className="text-muted text-center text-base leading-6">
            We sent a verification link to{'\n'}
            <Text className="text-text font-medium">{email}</Text>
          </Text>
        </View>

        <TouchableOpacity
          className="bg-primary rounded-2xl py-4 px-10 w-full items-center active:opacity-80"
          onPress={handleCheckVerification}
          disabled={checking}
        >
          {checking
            ? <ActivityIndicator color="#fff" />
            : <Text className="text-white font-bold text-base">I've verified my email</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleResend} disabled={resending}>
          {resending
            ? <ActivityIndicator color="#94A3B8" />
            : <Text className="text-muted">Resend verification email</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={signOut}>
          <Text className="text-muted text-sm">Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
