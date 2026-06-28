import React, { useState, useEffect, useMemo } from 'react';
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
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { deleteDoc, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
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
import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors } from '@/constants/theme';

export default function AccountSettingsScreen() {
  const { colors } = useAppTheme();
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordHidden, setDeletePasswordHidden] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const [fullName, setFullName]       = useState('');
  const [email, setEmail]             = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [university, setUniversity]   = useState('');
  const [major, setMajor]             = useState('');
  const [about, setAbout]             = useState('');

  const [originalPhone, setOriginalPhone] = useState('');
  const [pendingPhone, setPendingPhone]   = useState('');

  const [otpCode, setOtpCode]     = useState('');
  const [otpError, setOtpError]   = useState('');
  const [otpTimer, setOtpTimer]   = useState(300);
  const [canResend, setCanResend] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [showMajorPicker, setShowMajorPicker] = useState(false);
  const [majorSearch, setMajorSearch] = useState('');

  const s = useMemo(() => makeStyles(colors), [colors]);

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

      const [driverDoc, riderDoc] = await Promise.all([
        getDoc(doc(firestore, 'drivers', user.uid)),
        getDoc(doc(firestore, 'riders', user.uid)),
      ]);

      const data = driverDoc.exists() ? driverDoc.data() : null;
      const riderData = riderDoc.exists() ? riderDoc.data() : null;

      if (data) {
        setFullName(data.fullName || data.name || '');
        // Do NOT fall back to user.photoURL — that bleeds the rider photo into the driver account
        setAvatarUrl(data.avatarUrl || data.photoURL || data.personalInfo?.avatarUrl || null);
        setEmail(data.email || user.email || '');
        const phone = data.phoneNumber || data.phone || data.personalInfo?.phone || '';
        setPhoneNumber(phone);
        setOriginalPhone(phone);
        // Shared fields: fall back to rider doc if driver doc doesn't have them yet (new upgrade)
        setDateOfBirth(
          data.dateOfBirth || data.DOB || data.personalInfo?.dateOfBirth || data.personalInfo?.dob ||
          riderData?.dateOfBirth || riderData?.DOB || riderData?.personalInfo?.dateOfBirth || ''
        );
        setUniversity(
          data.university || data.personalInfo?.university ||
          riderData?.university || riderData?.personalInfo?.university || ''
        );
        setMajor(
          data.major || data.personalInfo?.major ||
          riderData?.major || riderData?.personalInfo?.major || ''
        );
        setAbout(data.about || data.bio || data.description || data.personalInfo?.about || data.personalInfo?.bio || '');
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

  const closeDelete = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeletePassword('');
  };

  const deleteAccount = async () => {
    const user = firebaseAuth.currentUser;
    if (!user?.email || !deletePassword || deleting) return;

    setDeleting(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, deletePassword));

      fetch(`${getApiBaseUrl()}/api/send-account-deletion-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, name: fullName || 'there' }),
      }).catch(() => undefined);

      await Promise.all([
        deleteDoc(doc(firestore, 'drivers', user.uid)).catch(() => undefined),
        deleteDoc(doc(firestore, 'riders', user.uid)).catch(() => undefined),
        deleteDoc(doc(firestore, 'users', user.uid)).catch(() => undefined),
      ]);
      await deleteUser(user);
      setDeleteOpen(false);
      router.replace('/(auth)/sign-in' as any);
    } catch (error: any) {
      const incorrect = error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password';
      Alert.alert('Unable to delete account', incorrect ? 'Your current password is incorrect.' : error?.message || 'Please try again.');
    } finally {
      setDeleting(false);
    }
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
      const aboutText = about.trim();

      const sharedFields = {
        dateOfBirth: dateOfBirth.trim(), DOB: dateOfBirth.trim(),
        university: university.trim(), major: major.trim(),
      };

      const driverUpdate = {
        fullName: fullName.trim(), name: fullName.trim(),
        phoneNumber: phoneNumber.trim(), phone: phoneNumber.trim(),
        ...sharedFields,
        about: aboutText, bio: aboutText, description: aboutText,
        personalInfo: {
          ...existingPersonalInfo,
          phone: phoneNumber.trim(), dateOfBirth: dateOfBirth.trim(), dob: dateOfBirth.trim(),
          university: university.trim(), major: major.trim(),
          about: aboutText, bio: aboutText,
        },
        updatedAt: serverTimestamp(),
      };

      const riderDocRef = doc(firestore, 'riders', user.uid);
      const riderDoc = await getDoc(riderDocRef);

      const writes: Promise<void>[] = [updateDoc(driverDocRef, driverUpdate)];
      // Sync shared academic fields back to rider doc so both accounts stay consistent
      if (riderDoc.exists()) {
        writes.push(updateDoc(riderDocRef, { ...sharedFields, updatedAt: serverTimestamp() }));
      }
      await Promise.all(writes);

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
          <View style={s.loadingWrap}><ActivityIndicator size="large" color={colors.primary} /></View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            <View style={s.hdr}>
              <TouchableOpacity style={s.backBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={hitSlop}>
                <Ionicons name="arrow-back" size={19} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={s.hdrTitle}>Account</Text>
            </View>

            <View style={s.identity}>
              <TouchableOpacity style={s.avatarButton} onPress={() => void editAvatar()} disabled={uploadingAvatar} accessibilityRole="button" accessibilityLabel="Change profile picture">
                <View style={s.avatar}>
                  {avatarUrl ? <Image source={{ uri: avatarUrl }} style={s.avatarImage} contentFit="cover" /> : <Text style={s.avatarText}>{initials}</Text>}
                  {uploadingAvatar ? <View style={s.avatarLoading}><ActivityIndicator color={colors.textInverse} /></View> : null}
                </View>
                <View style={s.cameraBadge}><Ionicons name="camera" size={14} color={colors.textInverse} /></View>
              </TouchableOpacity>
              <View style={s.identityCopy}>
                <Text style={s.identityName}>{fullName.trim() || 'RideAlong driver'}</Text>
                <Text style={s.identitySchool}>{university || email || 'University not added'}</Text>
              </View>
            </View>

            {/* Full Name */}
            <Text style={s.sectionLabel}>Personal information</Text>
            <View style={s.sectionCard}>
              <Field label="Full Name" icon="person-outline" colors={colors} s={s}>
                <TextInput style={s.fieldInput} value={fullName} onChangeText={setFullName} placeholder="Your full name" placeholderTextColor={colors.textSecondary} />
              </Field>

              <Field label="Email" icon="mail-outline" isLast colors={colors} s={s}>
                <TextInput style={[s.fieldInput, s.fieldInputDisabled]} value={email} editable={false} placeholder="Email address" placeholderTextColor={colors.textSecondary} />
                <Text style={s.fieldHint}>Email cannot be changed here</Text>
              </Field>
            </View>

            <Text style={s.sectionLabel}>Contact</Text>
            <View style={s.sectionCard}>
              <Field label="Phone Number" icon="call-outline" isLast colors={colors} s={s}>
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
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </Field>
            </View>

            <Text style={s.sectionLabel}>Academic information</Text>
            <View style={s.sectionCard}>
              <Field label="Date of Birth" icon="calendar-outline" colors={colors} s={s}>
                <TextInput style={s.fieldInput} value={dateOfBirth} onChangeText={setDateOfBirth} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textSecondary} />
              </Field>

              <Field label="University" icon="school-outline" colors={colors} s={s}>
                <UniversitySearch value={university} onSelect={(uni) => setUniversity(uni?.name || '')} placeholder="Search your university…" allowCustom={true} />
              </Field>

              <Field label="Major" icon="book-outline" isLast colors={colors} s={s}>
                <TouchableOpacity style={s.fieldInput} onPress={() => setShowMajorPicker(true)}>
                  <Text style={major ? s.fieldInputText : s.fieldInputPlaceholder}>{major || 'Select your major'}</Text>
                </TouchableOpacity>
              </Field>
            </View>

            <Text style={s.sectionLabel}>About</Text>
            <View style={s.sectionCard}>
              <Field label="About you" icon="person-circle-outline" isLast colors={colors} s={s}>
                <TextInput
                  style={[s.fieldInput, s.aboutInput]}
                  value={about}
                  onChangeText={setAbout}
                  placeholder="Share what classmates should know about riding with you."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  maxLength={240}
                  textAlignVertical="top"
                />
                <Text style={s.fieldHint}>{about.length}/240 characters</Text>
              </Field>
            </View>

            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSaveChanges}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={s.saveBtnText}>Save changes</Text>}
            </TouchableOpacity>

            <View style={s.dangerSection}>
              <Text style={s.dangerLabel}>DANGER ZONE</Text>
              <TouchableOpacity style={s.deleteRow} onPress={() => setDeleteOpen(true)} accessibilityRole="button">
                <View style={s.deleteIcon}><Ionicons name="trash-outline" size={19} color={colors.red} /></View>
                <View style={s.dangerCopy}>
                  <Text style={s.deleteTitle}>Delete account</Text>
                  <Text style={s.deleteSubtitle}>Permanently remove your account and profile data</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>

          {/* OTP Modal */}
          <Modal visible={showOTPModal} transparent animationType="slide" onRequestClose={handleCancelOTP}>
            <KeyboardAwareModalView style={s.modalOverlay}>
              <View style={s.modalCard}>
                <View style={s.modalIconWrap}>
                  <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
                </View>
                <Text style={s.modalTitle}>Verify Phone Number</Text>
                <Text style={s.modalSub}>
                  {"We've sent a 6-digit code to"}{'\n'}
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>{formatPhoneNumber(pendingPhone)}</Text>
                </Text>

                <TextInput
                  style={[s.otpInput, otpError ? s.otpInputError : null]}
                  value={otpCode}
                  onChangeText={(t) => { setOtpCode(t.replace(/[^0-9]/g, '')); setOtpError(''); }}
                  placeholder="000000"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />

                {otpError ? <Text style={s.otpErrorText}>{otpError}</Text> : null}

                <Text style={s.otpTimerText}>
                  {otpTimer > 0
                    ? <Text>Code expires in <Text style={{ color: colors.primary, fontWeight: '600' }}>{formatTime(otpTimer)}</Text></Text>
                    : <Text style={{ color: colors.red }}>Code expired</Text>
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
                    {verifying ? <ActivityIndicator color={colors.textInverse} size="small" /> : <Text style={s.modalBtnText}>Verify</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAwareModalView>
          </Modal>

          {/* Major Picker */}
          <Modal visible={showMajorPicker} transparent animationType="slide" onRequestClose={() => { setShowMajorPicker(false); setMajorSearch(''); }}>
            <View style={s.pickerOverlay}>
              <View style={s.pickerSheet}>
                <View style={s.pickerHandle} />

                <View style={s.pickerHdr}>
                  <View style={s.pickerHdrIcon}>
                    <Ionicons name="book-outline" size={16} color={colors.primary} />
                  </View>
                  <Text style={s.pickerTitle}>Select Major</Text>
                  <TouchableOpacity style={s.pickerCloseBtn} onPress={() => { setShowMajorPicker(false); setMajorSearch(''); }} activeOpacity={0.7}>
                    <Ionicons name="close" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={s.pickerSearchWrap}>
                  <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
                  <TextInput
                    style={s.pickerSearchInput}
                    placeholder="Search majors…"
                    placeholderTextColor={colors.textSecondary}
                    value={majorSearch}
                    onChangeText={setMajorSearch}
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {majorSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setMajorSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>

                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  {MAJORS.filter((m) => m.toLowerCase().includes(majorSearch.toLowerCase())).map((maj) => (
                    <TouchableOpacity
                      key={maj}
                      style={s.pickerItem}
                      onPress={() => { setMajor(maj); setMajorSearch(''); setShowMajorPicker(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.pickerItemText, major === maj && s.pickerItemTextActive]}>{maj}</Text>
                      {major === maj && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                    </TouchableOpacity>
                  ))}
                  {MAJORS.filter((m) => m.toLowerCase().includes(majorSearch.toLowerCase())).length === 0 && (
                    <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{`No majors match "${majorSearch}"`}</Text>
                    </View>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>

          <Modal visible={deleteOpen} transparent animationType="slide" onRequestClose={closeDelete}>
            <KeyboardAwareModalView style={s.deleteModalOverlay}>
              <View style={s.deleteModalSheet}>
                <View style={s.deleteModalHandle} />
                <View style={s.deleteModalHeader}>
                  <View style={s.deleteModalCopy}>
                    <Text style={s.deleteModalTitle}>Delete your account?</Text>
                    <Text style={s.deleteModalSubtitle}>This permanently deletes your RideAlong account and profile data. This cannot be undone.</Text>
                  </View>
                  <TouchableOpacity style={s.deleteModalClose} onPress={closeDelete} hitSlop={hitSlop}>
                    <Ionicons name="close" size={20} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>
                <Text style={s.fieldLabel}>CURRENT PASSWORD</Text>
                <View style={s.deletePasswordWrap}>
                  <TextInput
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                    placeholder="Enter your password"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={deletePasswordHidden}
                    autoCapitalize="none"
                    style={s.deletePasswordInput}
                  />
                  <TouchableOpacity onPress={() => setDeletePasswordHidden((hidden) => !hidden)} hitSlop={hitSlop}>
                    <Ionicons name={deletePasswordHidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[s.deleteButton, (!deletePassword || deleting) && { opacity: 0.5 }]} onPress={() => void deleteAccount()} disabled={!deletePassword || deleting}>
                  {deleting ? <ActivityIndicator color={colors.textInverse} /> : <Text style={s.saveBtnText}>Delete account permanently</Text>}
                </TouchableOpacity>
              </View>
            </KeyboardAwareModalView>
          </Modal>

        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Field({ label, icon, children, isLast = false, colors, s }: { label: string; icon: string; children: React.ReactNode; isLast?: boolean; colors: AppColors; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[s.fieldWrap, !isLast && s.fieldWrapBorder]}>
      <View style={s.fieldLabelRow}>
        <Ionicons name={icon as any} size={14} color={colors.textSecondary} style={{ marginRight: 6 }} />
        <Text style={s.fieldLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    root:        { flex: 1, alignItems: 'center', backgroundColor: colors.bg },
    safe:        { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: colors.bg },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    hdr:      { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    backBtn:  { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    hdrTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingBottom: 36 },

    identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
    avatarButton: { width: 72, height: 72 },
    avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    avatarImage: { width: '100%', height: '100%', borderRadius: 34 },
    avatarLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(21,35,58,0.45)' },
    cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: colors.bg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: colors.primary, fontSize: 22, fontWeight: '700' },
    identityCopy: { flex: 1 },
    identityName: { color: colors.textPrimary, fontSize: 20, lineHeight: 26, fontWeight: '700' },
    identitySchool: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 3 },

    sectionLabel: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '700', marginBottom: 14 },
    sectionCard: { marginBottom: 8 },

    fieldWrap:       { marginBottom: 16 },
    fieldWrapBorder: {},
    fieldLabelRow:   { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
    fieldLabel:      { color: colors.textSecondary, fontSize: 10, lineHeight: 15, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
    fieldInput: {
      minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: 14,
      paddingHorizontal: 15, paddingVertical: 14, color: colors.textPrimary, fontSize: 15, backgroundColor: colors.bgCard,
    },
    fieldInputDisabled: { color: colors.textSecondary, backgroundColor: colors.bgSecondary },
    fieldInputText:     { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
    fieldInputPlaceholder: { color: colors.textSecondary, fontSize: 14 },
    aboutInput: { minHeight: 112, lineHeight: 21, paddingTop: 14, paddingBottom: 14 },
    fieldHint:          { color: colors.textSecondary, fontSize: 11, marginTop: 6 },
    warningText:        { color: colors.amber, fontSize: 11, marginTop: 6, fontWeight: '500' },
    phoneChangeRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
    phoneChangeCopy:    { flex: 1 },
    phoneChangeValue:   { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    phoneChangeNote:    { color: colors.textSecondary, fontSize: 11, marginTop: 3 },

    saveBtn:     { minHeight: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    saveBtnText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
    dangerSection: { marginTop: 30, marginBottom: 4 },
    dangerLabel: { color: colors.red, fontSize: 10, lineHeight: 15, letterSpacing: 1.3, fontWeight: '700', marginBottom: 8, paddingHorizontal: 2 },
    deleteRow: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: colors.redBorder, backgroundColor: colors.redDim, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
    deleteIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.redDim, alignItems: 'center', justifyContent: 'center' },
    dangerCopy: { flex: 1 },
    deleteTitle: { color: colors.red, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    deleteSubtitle: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalCard:    { backgroundColor: colors.bgCard, borderRadius: 20, padding: 24, width: '100%', maxWidth: 400 },
    modalIconWrap: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 },
    modalTitle:   { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
    modalSub:     { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },

    otpInput:      { borderWidth: 2, borderColor: colors.border, borderRadius: 12, padding: 16, fontSize: 24, textAlign: 'center', letterSpacing: 8, fontWeight: '600', marginBottom: 12, color: colors.textPrimary },
    otpInputError: { borderColor: colors.red },
    otpErrorText:  { color: colors.red, fontSize: 13, textAlign: 'center', marginBottom: 10 },
    otpTimerText:  { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: 14 },
    resendBtn:     { paddingVertical: 8, marginBottom: 14 },
    resendBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600', textAlign: 'center', textDecorationLine: 'underline' },

    modalBtns:         { flexDirection: 'row', gap: 12 },
    modalBtnOutline:   { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    modalBtnOutlineText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    modalBtnPrimary:   { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', backgroundColor: colors.primary },
    modalBtnText:      { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
    deleteModalOverlay: { flex: 1, backgroundColor: 'rgba(21,35,58,0.35)', justifyContent: 'flex-end' },
    deleteModalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
    deleteModalHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 18 },
    deleteModalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 20 },
    deleteModalCopy: { flex: 1 },
    deleteModalTitle: { color: colors.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    deleteModalSubtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
    deleteModalClose: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    deletePasswordWrap: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, marginBottom: 16 },
    deletePasswordInput: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 14 },
    deleteButton: { minHeight: 54, borderRadius: 27, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },

    pickerOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    pickerSheet:    { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36, maxHeight: '88%' },
    pickerHandle:   { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
    pickerHdr:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
    pickerHdrIcon:  { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
    pickerTitle:    { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
    pickerCloseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
    pickerSearchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginVertical: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, gap: 8 },
    pickerSearchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
    pickerItem:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
    pickerItemText: { color: colors.textPrimary, fontSize: 15, fontWeight: '500', flex: 1 },
    pickerItemTextActive: { color: colors.primary, fontWeight: '700' },
  });
}
