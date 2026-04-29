import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { sendPasswordResetEmail } from 'firebase/auth';
import Toast from 'react-native-toast-message';
import { firebaseAuth } from '@/services/firebase';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) {
      Toast.show({ type: 'error', text1: 'Enter your email address.' });
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
      setSent(true);
    } catch {
      Toast.show({ type: 'error', text1: 'Could not send reset email. Check the address and try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-6 pt-6">
        <TouchableOpacity className="mb-8 self-start" onPress={() => router.back()}>
          <ChevronLeft size={28} color="#F8FAFC" />
        </TouchableOpacity>

        <Text className="text-3xl font-bold text-text mb-2">Reset password</Text>
        <Text className="text-muted text-base mb-8">
          {sent
            ? "We've sent a password reset link to your email. Check your inbox."
            : "Enter your email and we'll send you a reset link."}
        </Text>

        {!sent && (
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

            <TouchableOpacity
              className="bg-primary rounded-2xl py-4 items-center active:opacity-80"
              onPress={handleSend}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color="#fff" />
                : <Text className="text-white font-bold text-base">Send reset link</Text>}
            </TouchableOpacity>
          </View>
        )}

        {sent && (
          <TouchableOpacity
            className="bg-card border border-border rounded-2xl py-4 items-center"
            onPress={() => router.push('/(auth)/sign-in')}
          >
            <Text className="text-text font-semibold">Back to sign in</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}
