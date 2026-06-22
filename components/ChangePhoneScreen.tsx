import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { loadRiderAccount } from '@/services/riderAccount';
import { cancelPhoneVerification, formatPhoneNumber, sendPhoneOTP, verifyPhoneOTP } from '@/services/phoneVerification';
import { useAuthStore } from '@/stores/authStore';
import { hitSlop, layout } from '@/theme/designSystem';
import { firebaseAuth, firestore } from '@/constants/services';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const BG = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED = '#7D8698';

export default function ChangePhoneScreen({ role = 'rider' }: { role?: 'rider' | 'driver' }) {
  const fallbackRoute = role === 'driver' ? '/(driver)/settings/account-settings' : '/(rider)/settings/account-settings';
  const { goBack: returnToOrigin } = useReturnNavigation(fallbackRoute);
  const refreshProfiles = useAuthStore((state) => state.refreshProfiles);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [submitting, setSubmitting] = useState(false);

  const loadCurrentPhone = async () => {
    if (role === 'rider') return (await loadRiderAccount()).phone;
    const user = firebaseAuth.currentUser;
    if (!user) throw new Error('Please sign in again to update your phone number.');
    const [driverSnap, userSnap] = await Promise.all([
      getDoc(doc(firestore, 'drivers', user.uid)),
      getDoc(doc(firestore, 'users', user.uid)),
    ]);
    const driver = (driverSnap.data() as any) || {};
    const shared = (userSnap.data() as any) || {};
    return driver.phoneNumber || driver.phone || driver.personalInfo?.phone || shared.phoneNumber || shared.phone || user.phoneNumber || '';
  };

  const persistVerifiedDriverPhone = async () => {
    if (role !== 'driver') return;
    const user = firebaseAuth.currentUser;
    if (!user) throw new Error('Please sign in again to update your phone number.');
    const driverRef = doc(firestore, 'drivers', user.uid);
    const driverSnap = await getDoc(driverRef);
    const personalInfo = driverSnap.data()?.personalInfo || {};
    const formatted = formatPhoneNumber(phone);
    const values = { phone: formatted, phoneNumber: formatted, phoneVerified: true, phoneVerifiedAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await Promise.all([
      setDoc(driverRef, { ...values, personalInfo: { ...personalInfo, phone: formatted, phoneNumber: formatted } }, { merge: true }),
      setDoc(doc(firestore, 'users', user.uid), values, { merge: true }),
    ]);
  };
  const goBack = () => {
    if (step === 'code') {
      void cancelPhoneVerification();
      setCode('');
      setStep('phone');
      return;
    }
    returnToOrigin();
  };

  const sendCode = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      Alert.alert('Invalid phone number', 'Enter a valid US phone number with 10 digits.');
      return;
    }
    setSubmitting(true);
    try {
      const currentPhone = await loadCurrentPhone();
      if (currentPhone.replace(/\D/g, '') === digits) {
        Alert.alert('Use a new number', 'This is already the phone number on your account.');
        return;
      }
      const result = await sendPhoneOTP(phone.trim());
      if (!result.success) throw new Error(result.message);
      setCode(result.devCode || '');
      setStep('code');
      if (result.devCode) {
        Alert.alert('Development verification', 'Twilio is not authenticated on the local server, so the development code has been filled in automatically.');
      }
    } catch (error: any) {
      Alert.alert('Unable to send code', error?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const verify = async () => {
    if (code.length !== 6) return;
    setSubmitting(true);
    try {
      const result = await verifyPhoneOTP(code, phone.trim());
      if (!result.success) throw new Error(result.message);
      await persistVerifiedDriverPhone();
      await refreshProfiles();
      Alert.alert('Phone number updated', `${formatPhoneNumber(phone)} is now connected to your account.`, [
        { text: 'Done', onPress: goBack },
      ]);
    } catch (error: any) {
      Alert.alert('Verification failed', error?.message || 'Check the code and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={goBack} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="arrow-back" size={19} color={NAVY} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Change phone number</Text>
          </View>

          <Text style={styles.intro}>{step === 'phone' ? 'Enter your new phone number. We will text you a verification code.' : `Enter the 6-digit code sent to ${formatPhoneNumber(phone)}.`}</Text>

          <View style={styles.card}>
            {step === 'phone' ? (
              <>
                <Text style={styles.label}>NEW PHONE NUMBER</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="call-outline" size={20} color={MUTED} />
                  <TextInput value={phone} onChangeText={setPhone} placeholder="(512) 555-0123" placeholderTextColor="#9AA3B2" keyboardType="phone-pad" textContentType="telephoneNumber" style={styles.input} autoFocus />
                </View>
                <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={18} color={ORANGE} /><Text style={styles.noticeText}>Your number is only updated after the verification code is confirmed.</Text></View>
              </>
            ) : (
              <>
                <Text style={styles.label}>VERIFICATION CODE</Text>
                <TextInput value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" placeholderTextColor="#A0A8B5" keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} style={styles.codeInput} autoFocus />
                <TouchableOpacity style={styles.resendButton} onPress={() => void sendCode()} disabled={submitting} accessibilityRole="button"><Text style={styles.resendText}>Resend code</Text></TouchableOpacity>
              </>
            )}
          </View>

          <TouchableOpacity style={[styles.primaryButton, (submitting || (step === 'phone' ? !phone.trim() : code.length !== 6)) && styles.disabled]} onPress={() => void (step === 'phone' ? sendCode() : verify())} disabled={submitting || (step === 'phone' ? !phone.trim() : code.length !== 6)} accessibilityRole="button">
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{step === 'phone' ? 'Send verification code' : 'Verify and update'}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', backgroundColor: BG },
  safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: BG },
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingBottom: 36 },
  header: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  headerTitle: { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
  intro: { color: MUTED, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  card: { borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 17, marginBottom: 18 },
  label: { color: '#8B94A6', fontSize: 10, lineHeight: 15, letterSpacing: 1.3, fontWeight: '700', marginBottom: 7 },
  inputWrap: { minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: BG, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 15 },
  input: { flex: 1, color: NAVY, fontSize: 16, paddingVertical: 14 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 13, backgroundColor: '#FFF2E9', padding: 12, marginTop: 16 },
  noticeText: { flex: 1, color: '#6D5547', fontSize: 11, lineHeight: 17 },
  codeInput: { height: 62, borderRadius: 15, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: BG, color: NAVY, fontSize: 25, fontWeight: '700', letterSpacing: 10, textAlign: 'center' },
  resendButton: { alignSelf: 'center', paddingHorizontal: 12, paddingTop: 18, paddingBottom: 2 },
  resendText: { color: ORANGE, fontSize: 13, fontWeight: '700' },
  primaryButton: { minHeight: 54, borderRadius: 27, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
