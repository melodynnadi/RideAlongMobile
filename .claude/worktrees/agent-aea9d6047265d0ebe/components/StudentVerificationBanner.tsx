import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { X } from 'lucide-react-native';
import { useVerificationStore } from '@/stores/verificationStore';
import { firebaseAuth } from '@/constants/services';

export function StudentVerificationBanner() {
  const {
    isVerified,
    verificationStatus,
    daysRemaining,
    bannerDismissed,
    dismissBanner,
  } = useVerificationStore();

  console.log('[StudentVerificationBanner] State:', { isVerified, verificationStatus, bannerDismissed });

  // Don't show banner if user is verified or has dismissed it
  if (isVerified || bannerDismissed) {
    return null;
  }

  // Hide banner until we have confirmation the user is NOT verified.
  // verificationStatus===null means data hasn't loaded yet (Firestore listener hasn't fired).
  // This prevents a flash of the banner for users who are already verified.
  if (verificationStatus === null) {
    return null;
  }

  const openVerification = async () => {
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert('Error', 'Please sign in to verify your student status');
        return;
      }

      // Get fresh Firebase ID token
      const token = await user.getIdToken(true);
      const verificationUrl = `https://ridealongapp.com/pages/login?token=${token}`;
      
      // Open in device's default browser
      const supported = await Linking.canOpenURL(verificationUrl);
      if (supported) {
        await Linking.openURL(verificationUrl);
      } else {
        Alert.alert('Error', 'Unable to open verification page');
      }
    } catch (error) {
      console.error('Error opening verification URL:', error);
      Alert.alert('Error', 'Failed to open verification page. Please try again.');
    }
  };

  const handleDismiss = () => {
    dismissBanner();
  };

  // Show different messages based on status
  const getBannerTitle = () => 'Verify student status';

  const getBannerMessage = () => 'Click this banner to verify your status';

  const getDeadlineText = () => {
    if (daysRemaining === null) return null;
    if (daysRemaining <= 0) {
      return `Past due by ${Math.abs(daysRemaining)} days`;
    }
    return null;
  };

  const deadlineText = getDeadlineText();

  return (
    <View style={styles.container}>
      <TouchableOpacity activeOpacity={0.85} onPress={openVerification} style={styles.banner}>
        <View style={styles.rowTop}>
          <Text style={styles.title}>{getBannerTitle()}</Text>
          <TouchableOpacity 
            style={styles.dismissButton}
            onPress={handleDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X color="#A14A4A" size={18} />
          </TouchableOpacity>
        </View>
        <Text style={styles.message}>{getBannerMessage()}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  banner: {
    backgroundColor: '#FFECEC',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#F8C8C8',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#8B2E2E',
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
    flexGrow: 1,
    paddingRight: 8,
  },
  dismissButton: {
    marginLeft: 6,
    padding: 2,
  },
  message: {
    color: '#A05252',
    fontSize: 12.5,
    lineHeight: 17,
  },
  deadlineBadge: {
    backgroundColor: '#FFD9D9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFC2C2',
    marginRight: 4,
  },
  deadlineText: {
    color: '#C01919',
    fontSize: 11,
    fontWeight: '700',
  },
});

export default StudentVerificationBanner;
