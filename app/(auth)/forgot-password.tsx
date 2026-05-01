import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { firebaseAuth } from '@/constants/services';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) {
      Alert.alert('Reset Password', 'Enter your email address first.');
      return;
    }
    try {
      setLoading(true);
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
      setSent(true);
      Alert.alert('Reset Email Sent', 'Check your inbox for a password reset link.');
    } catch {
      Alert.alert('Error', 'Could not send reset email. Check the address and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient colors={['#F8FAFC', '#EFF6FF']} style={styles.gradient}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={theme.colors.secondary} />
            </TouchableOpacity>

            <View style={styles.titleContainer}>
              <Text style={[styles.title, { color: theme.colors.secondary }]}>Reset Password</Text>
              <Text style={styles.subtitle}>
                {sent
                  ? "We've sent a password reset link to your email. Check your inbox."
                  : "Enter your email and we'll send you a reset link."}
              </Text>
            </View>
          </View>

          <View style={styles.formCard}>
            {!sent ? (
              <View style={styles.form}>
                <Input
                  label="Email"
                  placeholder="you@university.edu"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                />
                <Button onPress={handleSend} loading={loading} fullWidth size="lg" style={styles.sendButton}>
                  <Text style={styles.sendButtonText}>Send Reset Link</Text>
                </Button>
              </View>
            ) : (
              <View style={styles.form}>
                <View style={styles.successContainer}>
                  <Ionicons name="checkmark-circle" size={48} color="#10B981" />
                  <Text style={styles.successText}>Reset link sent to {email}</Text>
                </View>
                <Button onPress={() => router.push('/(auth)/sign-in')} fullWidth size="lg" style={styles.sendButton}>
                  <Text style={styles.sendButtonText}>Back to Sign In</Text>
                </Button>
              </View>
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>
    </ScrollView>
  );
}

const { height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  gradient: { flex: 1, minHeight: height },
  safeArea: { flex: 1, paddingHorizontal: 24 },
  header: { paddingTop: 20, marginBottom: 40 },
  backButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'white',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  titleContainer: { alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748B', textAlign: 'center', fontWeight: '400', lineHeight: 24 },
  formCard: {
    backgroundColor: 'white', borderRadius: 24,
    borderWidth: 1, borderColor: '#F1F5F9', padding: 24, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 8,
  },
  form: { gap: 20 },
  sendButton: {
    backgroundColor: '#E05E1A', borderRadius: 50, paddingVertical: 14,
    shadowColor: '#E05E1A', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  sendButtonText: { fontSize: 18, fontWeight: '700', color: 'white', textAlign: 'center' },
  successContainer: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  successText: { fontSize: 16, color: '#475569', textAlign: 'center', lineHeight: 24 },
});
