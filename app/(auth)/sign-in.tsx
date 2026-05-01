import React, { useMemo, useState } from 'react';
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
import { useAuthStore } from '@/stores/authStore';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const errors = useMemo(() => {
    const e: Record<string, string | undefined> = {};
    if (!email) e.email = 'Email is required';
    if (!password) e.password = 'Password is required';
    return e;
  }, [email, password]);

  const onSubmit = async () => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      Alert.alert('Check your info', Object.values(errors).filter(Boolean).join('\n'));
      return;
    }
    try {
      setLoading(true);
      await signIn(email.trim().toLowerCase(), password);
      // AuthGate in _layout.tsx handles routing based on role
    } catch (err: any) {
      let msg = 'Sign in failed';
      if (err?.code === 'auth/invalid-credential') msg = 'Invalid email or password';
      else if (err?.code === 'auth/user-not-found') msg = 'No account found with this email';
      else if (err?.code === 'auth/wrong-password') msg = 'Incorrect password';
      else if (err?.code === 'auth/too-many-requests') msg = 'Too many failed attempts. Please try again later.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const onForgot = async () => {
    if (!email) {
      Alert.alert('Reset Password', 'Enter your email first and try again.');
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
      Alert.alert('Reset Email Sent', 'Check your inbox for a password reset link.');
    } catch {
      Alert.alert('Error', 'Could not send reset email');
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
              <Text style={[styles.title, { color: theme.colors.secondary }]}>Welcome Back!</Text>
              <Text style={styles.subtitle}>Sign in to your RideAlong account</Text>
            </View>
          </View>

          <View style={styles.formCard}>
            <View style={styles.form}>
              <Input
                label="Email"
                placeholder="you@university.edu"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                error={showErrors ? (errors.email as string) : undefined}
              />

              <View style={styles.passwordContainer}>
                <Input
                  label="Password"
                  placeholder="Your password"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  error={showErrors ? (errors.password as string) : undefined}
                  style={styles.passwordInput}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={onForgot} style={styles.forgotContainer}>
                <Text style={[styles.forgotText, { color: theme.colors.primary }]}>Forgot password?</Text>
              </TouchableOpacity>

              <Button onPress={onSubmit} loading={loading} fullWidth size="lg" style={styles.signInButton}>
                <Text style={styles.signInButtonText}>Sign In</Text>
              </Button>
            </View>
          </View>

          <TouchableOpacity onPress={() => router.replace('/(auth)/select-role')} style={styles.signUpContainer}>
            <Text style={styles.signUpText}>
              New to RideAlong?{' '}
              <Text style={[styles.signUpLink, { color: theme.colors.primary }]}>Create Account</Text>
            </Text>
          </TouchableOpacity>
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
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'white', justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  titleContainer: { alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748B', textAlign: 'center', fontWeight: '400' },
  formCard: {
    backgroundColor: 'white', borderRadius: 24,
    borderWidth: 1, borderColor: '#F1F5F9', padding: 24, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 8,
  },
  form: { gap: 20 },
  passwordContainer: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  eyeIcon: { position: 'absolute', right: 16, top: '50%', transform: [{ translateY: -12 }], zIndex: 1 },
  forgotContainer: { alignItems: 'flex-end', marginTop: -8 },
  forgotText: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  signInButton: {
    backgroundColor: '#E05E1A', borderRadius: 50, paddingVertical: 14, marginTop: 8,
    shadowColor: '#E05E1A', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  signInButtonText: { fontSize: 18, fontWeight: '700', color: 'white', textAlign: 'center' },
  signUpContainer: { alignItems: 'center', paddingVertical: 20, paddingBottom: 40 },
  signUpText: { fontSize: 16, color: '#64748B', textAlign: 'center', fontWeight: '500' },
  signUpLink: { fontWeight: '700', textDecorationLine: 'underline' },
});
