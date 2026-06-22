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
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { UniversitySearch } from '@/components/ui/UniversitySearch';
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
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import { pickAndUploadProfilePhoto } from '@/src/services/profilePhoto';
import { hitSlop, layout } from '@/theme/designSystem';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';

const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';

export default function AccountSettingsScreen() {
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showOTPModal, setShowOTPModal] = useState(false);

  const [fullName, setFullName]       = useState('');
  const [email, setEmail]             = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [university, setUniversity]   = useState('');
  const [major, setMajor]             = useState('');

  const [originalPhone, setOriginalPhone] = useState('');
  const [pendingPhone, setPendingPhone]   = useState('');

  const [otpCode, setOtpCode]     = useState('');
  const [otpError, setOtpError]   = useState('');
  const [otpTimer, setOtpTimer]   = useState(300);
  const [canResend, setCanResend] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [showMajorPicker, setShowMajorPicker] = useState(false);

  useEffect(() => { loadUserData(); }, []);

  useEffect(() => {
    if (showOTPModal && otpTimer > 0) {
      const interval = setInterval(() => {
        setOtpTimer((prev) => { if (prev <= 1) { setCanResend(true); return 0; } return prev - 1; });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showOTPModal, otpTimer]);

  const loadUserData = async () => {
    try {
      const user = firebaseAuth.currentUser;
      if (!user) { router.replace('/(auth)/sign-in'); return; }
      let userDoc = await getDoc(doc(firestore, 'drivers', user.uid));
      if (!userDoc.exists()) userDoc = await getDoc(doc(firestore, 'drivers', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        setFullName(data.fullName || data.name || '');
        setAvatarUrl(data.avatarUrl || data.photoURL || data.personalInfo?.avatarUrl || user.photoURL || null);
        setEmail(data.email || user.email || '');
        const phone = data.phoneNumber || data.phone || data.personalInfo?.phone || '';
        setPhoneNumber(phone);
        setOriginalPhone(phone);
        setDateOfBirth(data.dateOfBirth || data.DOB || data.personalInfo?.dateOfBirth || data.personalInfo?.dob || '');
        setUniversity(data.university || data.personalInfo?.university || '');
        setMajor(data.major || data.personalInfo?.major || '');
      }
    } catch { Alert.alert('Error', 'Failed to load your account information'); }
    finally { setLoading(false); }
  };

  const handleSaveChanges = async () => {
    if (!fullName.trim()) { Alert.alert('Validation Error', 'Please enter your full name'); return; }
    if (phoneNumber !== originalPhone) { setPendingPhone(phoneNumber); startOTPVerification(phoneNumber); }
    else await saveProfileData();
  };

  const startOTPVerification = async (phone: string) => {
    try {
      setSaving(true);
      const result = await sendPhoneOTP(phone);
      if (result.success) { setShowOTPModal(true); setOtpTimer(300); setCanResend(false); setOtpCode(''); setOtpError(''); }
      else Alert.alert('Error', result.message || 'Failed to send verification code');
    } catch { Alert.alert('Error', 'Failed to send verification code'); }
    finally { setSaving(false); }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || otpCode.length !== 6) { setOtpError('Please enter the 6-digit code'); return; }
    setVerifying(true);
    setOtpError('');
    try {
      const result = await verifyPhoneOTP(otpCode, pendingPhone);
      if (result.success) { setShowOTPModal(false); await saveProfileData(); }
      else setOtpError(result.message || 'Invalid verification code');
    } catch { setOtpError('Failed to verify code. Please try again.'); }
    finally { setVerifying(false); }
  };

  const handleResendOTP = async () => {
    setOtpCode(''); setOtpError(''); setCanResend(false); setOtpTimer(300);
    const result = await sendPhoneOTP(pendingPhone);
    if (!result.success) Alert.alert('Error', result.message || 'Failed to resend code');
  };

  const handleCancelOTP = () => {
    cancelPhoneVerification();
    setShowOTPModal(false);
    setOtpCode(''); setOtpError(''); setPendingPhone('');
  };

  const saveProfileData = async () => {
    try {
      setSaving(true);
      const user = firebaseAuth.currentUser;
      if (!user) return;
      const driverDocRef = doc(firestore, 'drivers', user.uid);
      const driverDoc    = await getDoc(driverDocRef);
      if (!driverDoc.exists()) { Alert.alert('Error', 'Your driver profile could not be found. Please contact support.'); return; }
      const existingPersonalInfo = driverDoc.data()?.personalInfo || {};
      await updateDoc(driverDocRef, {
        fullName: fullName.trim(), name: fullName.trim(),
        phoneNumber: phoneNumber.trim(), phone: phoneNumber.trim(),
        dateOfBirth: dateOfBirth.trim(), DOB: dateOfBirth.trim(),
        university: university.trim(), major: major.trim(),
        personalInfo: {
          ...existingPersonalInfo,
          phone: phoneNumber.trim(), dateOfBirth: dateOfBirth.trim(), dob: dateOfBirth.trim(),
          university: university.trim(), major: major.trim(),
        },
        updatedAt: serverTimestamp(),
      });
      setOriginalPhone(phoneNumber);
      Alert.alert('Account updated', 'Your profile information has been saved.');

    } catch { Alert.alert('Error', 'Failed to save changes. Please try again.'); }
    finally { setSaving(false); }
  };

  const initials = fullName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'DR';

  const editAvatar = async () => {
    if (uploadingAvatar) return;
    setUploadingAvatar(true);
    try {
      const result = await pickAndUploadProfilePhoto();
      if (!result.canceled) setAvatarUrl(result.photoURL);
    } catch (error: any) {
      Alert.alert('Unable to update photo', error?.message || 'Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  if (loading) {
    return (
      <View style={s.root}>
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <View style={s.loadingWrap}><ActivityIndicator size="large" color={ORANGE} /></View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <View style={s.hdr}>
              <TouchableOpacity style={s.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={hitSlop}>
                <Ionicons name="arrow-back" size={19} color={NAVY} />
              </TouchableOpacity>
              <Text style={s.hdrTitle}>Account</Text>
            </View>

            <View style={s.identity}>
              <TouchableOpacity style={s.avatarButton} onPress={() => void editAvatar()} disabled={uploadingAvatar} accessibilityRole="button" accessibilityLabel="Change profile picture">
                <View style={s.avatar}>
                  {avatarUrl ? <Image source={{ uri: avatarUrl }} style={s.avatarImage} contentFit="cover" /> : <Text style={s.avatarText}>{initials}</Text>}
                  {uploadingAvatar ? <View style={s.avatarLoading}><ActivityIndicator color="#FFFFFF" /></View> : null}
                </View>
                <View style={s.cameraBadge}><Ionicons name="camera" size={14} color="#FFFFFF" /></View>
              </TouchableOpacity>
              <View style={s.identityCopy}>
                <Text style={s.identityName}>{fullName.trim() || 'RideAlong driver'}</Text>
                <Text style={s.identitySchool}>{university || email || 'University not added'}</Text>
              </View>
            </View>

            {/* Full Name */}
            <Text style={s.sectionLabel}>Personal information</Text>
            <View style={s.sectionCard}>
              <Field label="Full Name" icon="person-outline">
                <TextInput style={s.fieldInput} value={fullName} onChangeText={setFullName} placeholder="Your full name" placeholderTextColor={MUTED} />
              </Field>

              <Field label="Email" icon="mail-outline" isLast>
                <TextInput style={[s.fieldInput, s.fieldInputDisabled]} value={email} editable={false} placeholder="Email address" placeholderTextColor={MUTED} />
                <Text style={s.fieldHint}>Email cannot be changed here</Text>
              </Field>
            </View>

            <Text style={s.sectionLabel}>Contact</Text>
            <View style={s.sectionCard}>
              <Field label="Phone Number" icon="call-outline" isLast>
                <TouchableOpacity
                  style={[s.fieldInput, s.phoneChangeRow]}
                  onPress={() => router.push({ pathname: '/(driver)/settings/change-phone', params: { returnTo: '/(driver)/settings/account-settings' } } as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Change phone number"
                >
                  <View style={s.phoneChangeCopy}>
                    <Text style={s.phoneChangeValue}>{phoneNumber || 'Add a phone number'}</Text>
                    <Text style={s.phoneChangeNote}>Change and verify your phone number</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={MUTED} />
                </TouchableOpacity>
              </Field>
            </View>

            <Text style={s.sectionLabel}>Academic information</Text>
            <View style={s.sectionCard}>
              <Field label="Date of Birth" icon="calendar-outline">
                <TextInput style={s.fieldInput} value={dateOfBirth} onChangeText={setDateOfBirth} placeholder="YYYY-MM-DD" placeholderTextColor={MUTED} />
              </Field>

              <Field label="University" icon="school-outline">
                <UniversitySearch value={university} onSelect={(uni) => setUniversity(uni?.name || '')} placeholder="Search your university…" allowCustom={true} />
              </Field>

              <Field label="Major" icon="book-outline" isLast>
                <TouchableOpacity style={s.fieldInput} onPress={() => setShowMajorPicker(true)}>
                  <Text style={major ? s.fieldInputText : s.fieldInputPlaceholder}>{major || 'Select your major'}</Text>
                </TouchableOpacity>
              </Field>
            </View>

            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSaveChanges}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveBtnText}>Save changes</Text>}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>

          {/* OTP Modal */}
          <Modal visible={showOTPModal} transparent animationType="slide" onRequestClose={handleCancelOTP}>
            <KeyboardAwareModalView style={s.modalOverlay}>
              <View style={s.modalCard}>
                <Text style={s.modalTitle}>Verify Phone Number</Text>
                <Text style={s.modalSub}>
                  {"We've sent a 6-digit code to"}{'\n'}
                  <Text style={{ color: ORANGE, fontWeight: '600' }}>{formatPhoneNumber(pendingPhone)}</Text>
                </Text>

                <TextInput
                  style={[s.otpInput, otpError ? s.otpInputError : null]}
                  value={otpCode}
                  onChangeText={(t) => { setOtpCode(t.replace(/[^0-9]/g, '')); setOtpError(''); }}
                  placeholder="000000"
                  placeholderTextColor={MUTED}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />

                {otpError ? <Text style={s.otpErrorText}>{otpError}</Text> : null}

                <Text style={s.otpTimerText}>
                  {otpTimer > 0
                    ? <Text>Code expires in <Text style={{ color: ORANGE, fontWeight: '600' }}>{formatTime(otpTimer)}</Text></Text>
                    : <Text style={{ color: '#EF4444' }}>Code expired</Text>
                  }
                </Text>

                {canResend && (
                  <TouchableOpacity onPress={handleResendOTP} style={s.resendBtn}>
                    <Text style={s.resendBtnText}>Resend Code</Text>
                  </TouchableOpacity>
                )}

                <View style={s.modalBtns}>
                  <TouchableOpacity style={s.modalBtnOutline} onPress={handleCancelOTP}>
                    <Text style={s.modalBtnOutlineText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.modalBtnPrimary, verifying && { opacity: 0.6 }]}
                    onPress={handleVerifyOTP}
                    disabled={verifying}
                  >
                    {verifying ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={s.modalBtnText}>Verify</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAwareModalView>
          </Modal>

          {/* Major Picker */}
          <Modal visible={showMajorPicker} transparent animationType="slide" onRequestClose={() => setShowMajorPicker(false)}>
            <View style={s.modalOverlay}>
              <View style={s.pickerCard}>
                <View style={s.pickerHdr}>
                  <Text style={s.pickerTitle}>Select Major</Text>
                  <TouchableOpacity onPress={() => setShowMajorPicker(false)}>
                    <Text style={s.pickerDone}>Done</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView>
                  {MAJORS.map((maj) => (
                    <TouchableOpacity
                      key={maj}
                      style={s.pickerItem}
                      onPress={() => { setMajor(maj); setShowMajorPicker(false); }}
                    >
                      <Text style={[s.pickerItemText, major === maj && s.pickerItemTextActive]}>{maj}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>

        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Field({ label, icon, children, isLast = false }: { label: string; icon: string; children: React.ReactNode; isLast?: boolean }) {
  return (
    <View style={[s.fieldWrap, !isLast && s.fieldWrapBorder]}>
      <View style={s.fieldLabelRow}>
        <Ionicons name={icon as any} size={14} color={MUTED} style={{ marginRight: 6 }} />
        <Text style={s.fieldLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, alignItems: 'center', backgroundColor: BG },
  safe:        { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: BG },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  hdr:      { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  backBtn:  { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  hdrTitle: { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingBottom: 36 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  avatarButton: { width: 72, height: 72 },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#FCEBDD', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 34 },
  avatarLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(21,35,58,0.45)' },
  cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: BG, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: ORANGE, fontSize: 22, fontWeight: '700' },
  identityCopy: { flex: 1 },
  identityName: { color: NAVY, fontSize: 20, lineHeight: 26, fontWeight: '700' },
  identitySchool: { color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 3 },

  sectionLabel: { color: NAVY, fontSize: 18, lineHeight: 24, fontWeight: '700', marginBottom: 14 },
  sectionCard: { marginBottom: 8 },

  fieldWrap:       { marginBottom: 16 },
  fieldWrapBorder: {},
  fieldLabelRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
  fieldLabel:      { color: '#8B94A6', fontSize: 10, lineHeight: 15, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  fieldInput: {
    minHeight: 54, borderWidth: 1, borderColor: '#D7DCE3', borderRadius: 14,
    paddingHorizontal: 15, paddingVertical: 14, color: NAVY, fontSize: 15, backgroundColor: '#FFFFFF',
  },
  fieldInputDisabled: { color: MUTED, backgroundColor: '#F3EFE8' },
  fieldInputText:     { color: NAVY, fontSize: 14, fontWeight: '500' },
  fieldInputPlaceholder: { color: MUTED, fontSize: 14 },
  fieldHint:          { color: MUTED, fontSize: 11, marginTop: 6 },
  warningText:        { color: '#F59E0B', fontSize: 11, marginTop: 6, fontWeight: '500' },
  phoneChangeRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  phoneChangeCopy:    { flex: 1 },
  phoneChangeValue:   { color: NAVY, fontSize: 15, fontWeight: '600' },
  phoneChangeNote:    { color: MUTED, fontSize: 11, marginTop: 3 },

  saveBtn:     { minHeight: 54, borderRadius: 27, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard:    { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, width: '100%', maxWidth: 400 },
  modalTitle:   { color: NAVY, fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  modalSub:     { color: MUTED, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },

  otpInput:      { borderWidth: 2, borderColor: BORDER, borderRadius: 12, padding: 16, fontSize: 24, textAlign: 'center', letterSpacing: 8, fontWeight: '600', marginBottom: 12, color: NAVY },
  otpInputError: { borderColor: '#EF4444' },
  otpErrorText:  { color: '#EF4444', fontSize: 13, textAlign: 'center', marginBottom: 10 },
  otpTimerText:  { color: MUTED, fontSize: 13, textAlign: 'center', marginBottom: 14 },
  resendBtn:     { paddingVertical: 8, marginBottom: 14 },
  resendBtnText: { color: ORANGE, fontSize: 14, fontWeight: '600', textAlign: 'center', textDecorationLine: 'underline' },

  modalBtns:         { flexDirection: 'row', gap: 12 },
  modalBtnOutline:   { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  modalBtnOutlineText: { color: NAVY, fontSize: 15, fontWeight: '600' },
  modalBtnPrimary:   { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: ORANGE },
  modalBtnText:      { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  pickerCard:     { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, width: '100%', marginTop: 'auto', maxHeight: '80%' },
  pickerHdr:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  pickerTitle:    { color: NAVY, fontSize: 17, fontWeight: '700' },
  pickerDone:     { color: ORANGE, fontSize: 15, fontWeight: '600' },
  pickerItem:     { paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  pickerItemText: { color: NAVY, fontSize: 15 },
  pickerItemTextActive: { color: ORANGE, fontWeight: '700' },
});
