import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, RefreshControl, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { sendEmailVerification, onAuthStateChanged } from 'firebase/auth';
import { firebaseAuth } from '@/constants/services';
import { useAuthStore } from '@/stores/authStore';

export default function VerifyEmailScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { checkEmailVerification, signOut } = useAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (user) {
        setUserEmail(user.email || '');
      } else {
        router.replace('/(auth)/sign-in');
      }
    });
    return unsubscribe;
  }, []);

  const handleResendEmail = async () => {
    try {
      setLoading(true);
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) {
        Alert.alert('Error', 'No user found. Please sign in again.');
        router.replace('/(auth)/sign-in');
        return;
      }
      await sendEmailVerification(currentUser);
      Alert.alert('Email Sent', 'Verification email has been sent to your inbox.');
    } catch {
      Alert.alert('Error', 'Could not send verification email. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    try {
      setChecking(true);
      const isVerified = await checkEmailVerification();
      if (isVerified) {
        Alert.alert(
          'Email Verified!',
          'Your email has been verified successfully. You can now sign in to your account.',
          [{ text: 'Sign In', onPress: () => router.replace('/(auth)/sign-in') }],
        );
      } else {
        Alert.alert(
          'Not Verified Yet',
          "Your email has not been verified yet. If you clicked the verification link and it said \"expired or already used\", please request a new verification email.",
          [
            { text: 'Resend Email', onPress: () => handleResendEmail() },
            { text: 'Try Again', onPress: () => handleCheckVerification() },
            { text: 'OK', style: 'cancel' },
          ],
        );
      }
    } catch {
      Alert.alert(
        'Verification Error',
        'There was an issue checking your verification status. Please request a new verification email.',
        [
          { text: 'Resend Email', onPress: () => handleResendEmail() },
          { text: 'Try Again', onPress: () => handleCheckVerification() },
          { text: 'OK', style: 'cancel' },
        ],
      );
    } finally {
      setChecking(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await handleCheckVerification();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.centerWrap}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.secondary }]}>Verify Your Email</Text>
            <Text style={styles.subtitle}>We've sent a verification link to:</Text>
            <Text style={[styles.email, { color: theme.colors.primary }]}>{userEmail}</Text>
          </View>

          <View style={styles.contentCard}>
            <View style={styles.iconContainer}>
              <Text style={styles.icon}>📧</Text>
            </View>

            <Text style={styles.instructions}>
              Please check your email and click the verification link to activate your account.
            </Text>

            <Text style={styles.tip}>
              💡 Tip: After clicking the verification link, pull down to refresh this page.
            </Text>

            <View style={styles.buttonContainer}>
              <Button onPress={handleCheckVerification} loading={checking} fullWidth style={styles.primaryButton}>
                {checking ? 'Checking...' : "I've Verified My Email"}
              </Button>

              <Button onPress={handleResendEmail} loading={loading} fullWidth variant="outline" style={styles.secondaryButton}>
                {loading ? 'Sending...' : 'Resend Verification Email'}
              </Button>

              <TouchableOpacity onPress={() => Linking.openURL('mailto:')} style={styles.linkButton}>
                <Text style={[styles.linkText, { color: theme.colors.primary }]}>Open Email App</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity onPress={() => signOut()} style={styles.backButton}>
            <Text style={styles.backText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  centerWrap: { flex: 1, justifyContent: 'center', padding: 16 },
  header: { paddingHorizontal: 8, marginBottom: 24, alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#64748B', textAlign: 'center', marginBottom: 8 },
  email: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  contentCard: {
    backgroundColor: 'white', borderRadius: 12,
    borderWidth: 1, borderColor: '#F1F5F9', padding: 24, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  iconContainer: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  icon: { fontSize: 40 },
  instructions: {
    fontSize: 16, color: '#475569', textAlign: 'center',
    lineHeight: 24, marginBottom: 16,
  },
  tip: {
    fontSize: 14, color: '#64748B', textAlign: 'center',
    lineHeight: 20, marginBottom: 24, fontStyle: 'italic',
  },
  buttonContainer: { width: '100%', gap: 12 },
  primaryButton: { marginBottom: 8 },
  secondaryButton: { marginBottom: 8 },
  linkButton: { paddingVertical: 12, alignItems: 'center' },
  linkText: { fontSize: 16, fontWeight: '600' },
  backButton: { marginTop: 24, alignItems: 'center' },
  backText: { fontSize: 16, color: '#64748B', fontWeight: '500' },
});
