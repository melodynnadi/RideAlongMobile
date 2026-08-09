import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { sendEmailVerification } from 'firebase/auth';
import { firebaseAuth } from '@/constants/services';
import { useTheme } from '@/hooks/useTheme';

interface EmailVerificationBannerProps {
  userEmail: string;
}

export function EmailVerificationBanner({ userEmail }: EmailVerificationBannerProps) {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);

  const handleResendEmail = async () => {
    try {
      setLoading(true);
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) {
        Alert.alert('Error', 'No user found. Please sign in again.');
        return;
      }

      await sendEmailVerification(currentUser);
      Alert.alert('Email Sent', 'Verification email has been sent to your inbox.');
    } catch (error) {
      console.error('Error sending verification email:', error);
      Alert.alert('Error', 'Could not send verification email. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToVerification = () => {
    router.push('/email-verification');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.primary + '15' }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>⚠️</Text>
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: theme.colors.primary }]}>
            Verify Your Email
          </Text>
          <Text style={styles.subtitle}>
            Please verify your email address ({userEmail}) to access all features.
          </Text>
        </View>
      </View>
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          onPress={handleResendEmail}
          disabled={loading}
          style={[styles.button, styles.secondaryButton]}
        >
          <Text style={[styles.buttonText, { color: theme.colors.primary }]}>
            {loading ? 'Sending...' : 'Resend Email'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleGoToVerification}
          style={[styles.button, styles.primaryButton, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={[styles.buttonText, styles.primaryButtonText]}>
            Verify Now
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E05E1A30',
    padding: 16,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  iconContainer: {
    marginRight: 12,
    marginTop: 2,
  },
  icon: {
    fontSize: 20,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    borderWidth: 1,
    borderColor: '#E05E1A',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#E05E1A',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  primaryButtonText: {
    color: 'white',
  },
});
