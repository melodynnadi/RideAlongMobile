import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, User, Phone, Mail, Calendar, GraduationCap, BookOpen } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { firebaseAuth, firestore } from '@/constants/services';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  sendPhoneOTP,
  verifyPhoneOTP,
  formatPhoneNumber,
  cancelPhoneVerification,
} from '@/services/phoneVerification';
import { MAJORS } from '@/constants/universities';
import { UniversitySearch } from '@/components/ui/UniversitySearch';

export default function AccountSettingsScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showOTPModal, setShowOTPModal] = useState(false);
  
  // Form fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [university, setUniversity] = useState('');
  const [universityData, setUniversityData] = useState<any>(null);
  const [major, setMajor] = useState('');
  
  // Original values for change detection
  const [originalPhone, setOriginalPhone] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  
  // OTP state
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpTimer, setOtpTimer] = useState(300); // 5 minutes
  const [canResend, setCanResend] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Picker modals
  const [showMajorPicker, setShowMajorPicker] = useState(false);

  // Load user data
  useEffect(() => {
    loadUserData();
  }, []);

  // OTP timer countdown
  useEffect(() => {
    if (showOTPModal && otpTimer > 0) {
      const interval = setInterval(() => {
        setOtpTimer((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showOTPModal, otpTimer]);

  const loadUserData = async () => {
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        router.replace('/(auth)/sign-in');
        return;
      }

      const userDoc = await getDoc(doc(firestore, 'riders', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setFullName(data.fullName || data.fullname || data.name || '');
        setEmail(data.email || user.email || '');
        const phone = data.phoneNumber || data.phone || '';
        setPhoneNumber(phone);
        setOriginalPhone(phone);
        setDateOfBirth(data.dateOfBirth || data.dateofbirth || data.dob || '');
        setUniversity(data.university || '');
        setUniversityData(data.universityData || null);
        setMajor(data.major || '');
      }
    } catch (error) {
      console.error('Error loading user data:', error);
      Alert.alert('Error', 'Failed to load your account information');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChanges = async () => {
    // Validate inputs
    if (!fullName.trim()) {
      Alert.alert('Validation Error', 'Please enter your full name');
      return;
    }

    if (!phoneNumber.trim()) {
      Alert.alert('Validation Error', 'Please enter your phone number');
      return;
    }

    const phoneChanged = phoneNumber !== originalPhone;

    if (phoneChanged) {
      // Show OTP modal for phone verification
      setPendingPhone(phoneNumber);
      startOTPVerification(phoneNumber);
    } else {
      // Save directly without phone verification
      await saveProfileData();
    }
  };

  const startOTPVerification = async (phone: string) => {
    try {
      setSaving(true);
      const result = await sendPhoneOTP(phone);

      if (result.success) {
        setShowOTPModal(true);
        setOtpTimer(300);
        setCanResend(false);
        setOtpCode('');
        setOtpError('');
      } else {
        Alert.alert('Error', result.message || 'Failed to send verification code');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to send verification code');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setOtpError('Please enter the 6-digit code');
      return;
    }

    setVerifying(true);
    setOtpError('');

    try {
      const result = await verifyPhoneOTP(otpCode, pendingPhone);

      if (result.success) {
        setShowOTPModal(false);
        await saveProfileData();
      } else {
        setOtpError(result.message || 'Invalid verification code');
      }
    } catch (error) {
      setOtpError('Failed to verify code. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResendOTP = async () => {
    setOtpCode('');
    setOtpError('');
    setCanResend(false);
    setOtpTimer(300);

    const result = await sendPhoneOTP(pendingPhone);

    if (!result.success) {
      Alert.alert('Error', result.message || 'Failed to resend code');
    }
  };

  const handleCancelOTP = () => {
    cancelPhoneVerification();
    setShowOTPModal(false);
    setOtpCode('');
    setOtpError('');
    setPendingPhone('');
  };

  const saveProfileData = async () => {
    try {
      setSaving(true);
      const user = firebaseAuth.currentUser;
      if (!user) return;

      const uniData = universityData || { name: university.trim(), custom: true };
      
      await updateDoc(doc(firestore, 'riders', user.uid), {
        fullName: fullName.trim(),
        name: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        phone: phoneNumber.trim(),
        dateOfBirth: dateOfBirth.trim(),
        university: uniData.name || university.trim(),
        universityData: {
          name: uniData.name || university.trim(),
          city: uniData.city || null,
          state: uniData.state || null,
          id: uniData.id || null,
          custom: uniData.custom || false,
        },
        major: major.trim(),
        updatedAt: serverTimestamp(),
      });

      setOriginalPhone(phoneNumber);
      Alert.alert('Success', 'Your account information has been updated');
      router.back();
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', 'Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <ArrowLeft size={24} color={theme.colors.secondary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
            Account Settings
          </Text>
        </View>

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Card style={styles.formCard}>
            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: theme.colors.secondary }]}>
                <User size={16} color={theme.colors.primary} /> Full Name
              </Text>
              <TextInput
                style={[styles.input, { borderColor: theme.colors.primary + '40' }]}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Enter your full name"
                placeholderTextColor="#9CA3AF"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: theme.colors.secondary }]}>
                <Mail size={16} color={theme.colors.primary} /> Email
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.inputDisabled,
                  { borderColor: theme.colors.primary + '40' },
                ]}
                value={email}
                editable={false}
                placeholder="Email address"
                placeholderTextColor="#9CA3AF"
              />
              <Text style={styles.helperText}>Email cannot be changed here</Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: theme.colors.secondary }]}>
                <Phone size={16} color={theme.colors.primary} /> Phone Number
              </Text>
              <TextInput
                style={[styles.input, { borderColor: theme.colors.primary + '40' }]}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="(555) 123-4567"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
              />
              {phoneNumber !== originalPhone && (
                <Text style={styles.warningText}>
                  Changing your phone number will require verification
                </Text>
              )}
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: theme.colors.secondary }]}>
                <Calendar size={16} color={theme.colors.primary} /> Date of Birth
              </Text>
              <TextInput
                style={[styles.input, { borderColor: theme.colors.primary + '40' }]}
                value={dateOfBirth}
                onChangeText={setDateOfBirth}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9CA3AF"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: theme.colors.secondary }]}>
                <GraduationCap size={16} color={theme.colors.primary} /> University
              </Text>
              <UniversitySearch
                value={university}
                onSelect={(selectedUniversity) => {
                  setUniversity(selectedUniversity.name);
                  setUniversityData(selectedUniversity);
                }}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: theme.colors.secondary }]}>
                <BookOpen size={16} color={theme.colors.primary} /> Major
              </Text>
              <TouchableOpacity
                style={[styles.input, { borderColor: theme.colors.primary + '40' }]}
                onPress={() => setShowMajorPicker(true)}
              >
                <Text style={major ? { color: theme.colors.secondary } : { color: '#9CA3AF' }}>
                  {major || 'Select your major'}
                </Text>
              </TouchableOpacity>
            </View>
          </Card>

          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: theme.colors.primary },
              saving && styles.saveButtonDisabled,
            ]}
            onPress={handleSaveChanges}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* OTP Verification Modal */}
        <Modal
          visible={showOTPModal}
          transparent
          animationType="slide"
          onRequestClose={handleCancelOTP}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={[styles.modalTitle, { color: theme.colors.secondary }]}>
                Verify Phone Number
              </Text>

              <Text style={styles.modalInstructionText}>
                We've sent a 6-digit code to{'\n'}
                <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>
                  {formatPhoneNumber(pendingPhone)}
                </Text>
              </Text>

              <TextInput
                style={[
                  styles.otpInput,
                  { borderColor: theme.colors.primary },
                  otpError && styles.otpInputError,
                ]}
                value={otpCode}
                onChangeText={(text) => {
                  setOtpCode(text.replace(/[^0-9]/g, ''));
                  setOtpError('');
                }}
                placeholder="Enter 6-digit code"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />

              {otpError ? (
                <Text style={styles.otpErrorText}>{otpError}</Text>
              ) : null}

              <Text style={styles.otpTimerText}>
                {otpTimer > 0 ? (
                  <>Code expires in <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{formatTime(otpTimer)}</Text></>
                ) : (
                  <Text style={{ color: '#EF4444' }}>Code expired</Text>
                )}
              </Text>

              {canResend && (
                <TouchableOpacity onPress={handleResendOTP} style={styles.resendButton}>
                  <Text style={[styles.resendButtonText, { color: theme.colors.primary }]}>
                    Resend Code
                  </Text>
                </TouchableOpacity>
              )}

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonOutline]}
                  onPress={handleCancelOTP}
                >
                  <Text style={[styles.modalButtonTextOutline, { color: theme.colors.primary }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalButtonPrimary,
                    { backgroundColor: theme.colors.primary },
                    verifying && styles.modalButtonDisabled,
                  ]}
                  onPress={handleVerifyOTP}
                  disabled={verifying}
                >
                  {verifying ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.modalButtonText}>Verify Code</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Major Picker Modal */}
        <Modal
          visible={showMajorPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowMajorPicker(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.pickerModalContent, { maxHeight: '80%' }]}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Select Major</Text>
                <TouchableOpacity onPress={() => setShowMajorPicker(false)}>
                  <Text style={[styles.pickerCloseButton, { color: theme.colors.primary }]}>Done</Text>
                </TouchableOpacity>
              </View>
              <ScrollView>
                {MAJORS.map((maj) => (
                  <TouchableOpacity
                    key={maj}
                    style={styles.pickerItem}
                    onPress={() => {
                      setMajor(maj);
                      setShowMajorPicker(false);
                    }}
                  >
                    <Text style={[styles.pickerItemText, major === maj && { color: theme.colors.primary, fontWeight: '600' }]}>
                      {maj}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  formCard: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  inputDisabled: {
    backgroundColor: '#F3F4F6',
    color: '#9CA3AF',
  },
  pickerContainer: {
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    overflow: 'hidden',
    minHeight: 50,
    justifyContent: 'center',
  },
  picker: {
    height: 50,
    width: '100%',
  },
  helperText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
  },
  warningText: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 4,
    fontWeight: '500',
  },
  saveButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 32,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInstructionText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  otpInput: {
    borderWidth: 2,
    borderRadius: 8,
    padding: 16,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
    fontWeight: '600',
    marginBottom: 12,
  },
  otpInputError: {
    borderColor: '#EF4444',
  },
  otpErrorText: {
    color: '#EF4444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  otpTimerText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 16,
  },
  resendButton: {
    padding: 8,
    marginBottom: 16,
  },
  resendButtonText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  modalButtonPrimary: {
    //backgroundColor set dynamically
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextOutline: {
    fontSize: 16,
    fontWeight: '600',
  },
  pickerModalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    width: '100%',
    marginTop: 'auto',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  pickerCloseButton: {
    fontSize: 16,
    fontWeight: '600',
  },
  pickerItem: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  pickerItemText: {
    fontSize: 16,
  },
});
