import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { deleteDoc, doc } from 'firebase/firestore';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { pickAndUploadAvatar } from '@/services/avatarUpload';
import { loadRiderAccount, RiderAccountProfile, saveRiderAccount } from '@/services/riderAccount';
import { useAuthStore } from '@/stores/authStore';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { hitSlop, layout } from '@/theme/designSystem';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import { UniversitySearch } from '@/components/ui/UniversitySearch';
import { MAJORS } from '@/constants/universities';
import { useAppTheme } from '@/hooks/ThemeContext';

function AccountField({ label, value, onChangeText, placeholder, keyboardType, editable = true, note, styles, colors }: {
  label: string;
  value: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  editable?: boolean;
  note?: string;
  styles: ReturnType<typeof makeStyles>;
  colors: any;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, !editable && styles.inputReadOnly]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={keyboardType}
          editable={editable}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
          style={[styles.input, !editable && styles.readOnlyText]}
        />
        {!editable ? <Ionicons name="lock-closed" size={16} color={colors.textSecondary} /> : null}
      </View>
      {note ? <Text style={styles.fieldNote}>{note}</Text> : null}
    </View>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, alignItems: 'center', backgroundColor: colors.bg },
    safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: colors.bg },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingBottom: 36 },
    header: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
    backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'},
    headerTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
    loading: { minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 12 },
    muted: { color: colors.textSecondary, fontSize: 14 },
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
    section: { marginBottom: 24 },
    sectionTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '700', marginBottom: 14 },
    nameRow: { flexDirection: 'row', gap: 12 },
    nameField: { flex: 1 },
    fieldGroup: { marginBottom: 16 },
    label: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, letterSpacing: 1.3, fontWeight: '700', marginBottom: 7 },
    inputWrap: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
    aboutInput: { minHeight: 112, alignItems: 'flex-start', color: colors.textPrimary, fontSize: 15, lineHeight: 21, paddingTop: 14, paddingBottom: 14 },
    inputReadOnly: { backgroundColor: colors.bgSecondary },
    input: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 14 },
    readOnlyText: { color: colors.textSecondary },
    selectInput: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 10 },
    selectInputText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
    selectInputPlaceholder: { flex: 1, color: colors.textSecondary, fontSize: 15 },
    fieldNote: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 6, paddingHorizontal: 2 },
    phoneRow: { minHeight: 68, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
    phoneIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
    phoneCopy: { flex: 1 },
    phoneValue: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '600' },
    phoneNote: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
    actionRow: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
    actionIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
    actionCopy: { flex: 1 },
    actionTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    actionSubtitle: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
    saveButton: { minHeight: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    buttonDisabled: { opacity: 0.5 },
    saveText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
    dangerSection: { marginTop: 30, marginBottom: 4 },
    dangerLabel: { color: colors.red, fontSize: 10, lineHeight: 15, letterSpacing: 1.3, fontWeight: '700', marginBottom: 8, paddingHorizontal: 2 },
    deleteRow: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: colors.redBorder, backgroundColor: colors.redDim, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
    deleteIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.redDim, alignItems: 'center', justifyContent: 'center' },
    deleteTitle: { color: colors.red, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(21,35,58,0.35)', justifyContent: 'flex-end' },
    modalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
    modalHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 18 },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 20 },
    modalTitleCopy: { flex: 1 },
    modalTitle: { color: colors.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    modalSubtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
    modalClose: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    deletePasswordWrap: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, marginBottom: 16 },
    deleteButton: { minHeight: 54, borderRadius: 27, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
    pickerOverlay: { flex: 1, backgroundColor: 'rgba(21,35,58,0.42)', justifyContent: 'flex-end' },
    pickerSheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36, maxHeight: '88%' as any },
    pickerHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
    pickerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
    pickerHeaderIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
    pickerTitle: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    pickerClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
    pickerSearchWrap: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginVertical: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, gap: 8 },
    pickerSearchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, padding: 0 },
    pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
    pickerItemText: { color: colors.textPrimary, fontSize: 15, fontWeight: '500', flex: 1 },
    pickerItemTextActive: { color: colors.primary, fontWeight: '700' },
    pickerEmpty: { alignItems: 'center', paddingVertical: 32 },
    pickerEmptyText: { color: colors.textSecondary, fontSize: 14 },
  });
}

export default function RiderAccountScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { returnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTarget = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  // navigate, not replace or dismissTo: returnTarget may point to a
  // different tab than this screen's own settings-tab nested Stack.
  // replace() can't leave this Stack (pushes a duplicate instead). dismissTo
  // maps to a Stack-only POP_TO action that tab navigators silently ignore.
  // navigate() is what Expo Router maps to the tab-navigator JUMP_TO action.
  const goBack = () => router.navigate((returnTarget || '/(rider)/settings') as any);
  const refreshProfiles = useAuthStore((state) => state.refreshProfiles);
  const [profile, setProfile] = useState<RiderAccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletePasswordHidden, setDeletePasswordHidden] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showMajorPicker, setShowMajorPicker] = useState(false);
  const [majorSearch, setMajorSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const account = await loadRiderAccount();
      setProfile(account);
    } catch (error: any) {
      Alert.alert('Unable to load account', error?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const initials = useMemo(() => {
    if (!profile) return 'RA';
    return `${profile.firstName[0] || ''}${profile.lastName[0] || ''}`.toUpperCase() || 'RA';
  }, [profile]);

  const persist = async () => {
    if (!profile) return;
    await saveRiderAccount(profile);
    await refreshProfiles();
    Alert.alert('Account updated', 'Your profile information has been saved.');
  };

  const save = async () => {
    if (!profile || saving) return;
    if (!profile.firstName.trim() || !profile.lastName.trim()) {
      Alert.alert('Name required', 'Enter your first and last name.');
      return;
    }
    if (!profile.university.trim()) {
      Alert.alert('University required', 'Enter your current university.');
      return;
    }
    setSaving(true);
    try {
      await persist();
    } catch (error: any) {
      Alert.alert('Unable to save account', error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeletePassword('');
  };

  const editAvatar = async () => {
    if (!profile || uploadingAvatar) return;
    setUploadingAvatar(true);
    try {
      const result = await pickAndUploadAvatar();
      if (result.canceled) return;
      setProfile((current) => current ? { ...current, avatarUrl: result.avatarUrl } : current);
      await refreshProfiles();
    } catch (error: any) {
      Alert.alert('Unable to update photo', error?.message || 'Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
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
        body: JSON.stringify({ email: user.email, name: user.displayName || profile?.firstName || 'there' }),
      }).catch(() => undefined);

      await Promise.all([
        deleteDoc(doc(firestore, 'riders', user.uid)).catch(() => undefined),
        deleteDoc(doc(firestore, 'users', user.uid)).catch(() => undefined),
        deleteDoc(doc(firestore, 'drivers', user.uid)).catch(() => undefined),
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

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={hitSlop}>
              <Ionicons name="arrow-back" size={19} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Account</Text>
          </View>

          {loading || !profile ? (
            <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Loading your account...</Text></View>
          ) : (
            <>
              <View style={styles.identity}>
                <TouchableOpacity style={styles.avatarButton} onPress={() => void editAvatar()} disabled={uploadingAvatar} accessibilityRole="button" accessibilityLabel="Change profile picture">
                  <View style={styles.avatar}>
                    {profile.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} contentFit="cover" /> : <Text style={styles.avatarText}>{initials}</Text>}
                    {uploadingAvatar ? <View style={styles.avatarLoading}><ActivityIndicator color={colors.textInverse} /></View> : null}
                  </View>
                  <View style={styles.cameraBadge}><Ionicons name="camera" size={14} color={colors.textInverse} /></View>
                </TouchableOpacity>
                <View style={styles.identityCopy}>
                  <Text style={styles.identityName}>{`${profile.firstName} ${profile.lastName}`.trim() || 'RideAlong rider'}</Text>
                  <Text style={styles.identitySchool}>{profile.university || 'University not added'}</Text>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Personal information</Text>
                <View style={styles.nameRow}>
                  <View style={styles.nameField}><AccountField label="FIRST NAME" value={profile.firstName} onChangeText={(firstName) => setProfile({ ...profile, firstName })} placeholder="First name" styles={styles} colors={colors} /></View>
                  <View style={styles.nameField}><AccountField label="LAST NAME" value={profile.lastName} onChangeText={(lastName) => setProfile({ ...profile, lastName })} placeholder="Last name" styles={styles} colors={colors} /></View>
                </View>
                <AccountField label="VERIFIED .EDU EMAIL" value={profile.email} editable={false} keyboardType="email-address" note="Your sign-in email is managed through your verified RideAlong account." styles={styles} colors={colors} />
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>PHONE NUMBER</Text>
                  <TouchableOpacity
                    style={styles.phoneRow}
                    onPress={() => router.push({ pathname: '/(rider)/settings/change-phone', params: { returnTo: '/(rider)/settings/account-settings' } } as any)}
                    accessibilityRole="button"
                    accessibilityLabel="Change phone number"
                  >
                    <View style={styles.phoneIcon}><Ionicons name="call-outline" size={18} color={colors.primary} /></View>
                    <View style={styles.phoneCopy}>
                      <Text style={styles.phoneValue}>{profile.phone || 'Add a phone number'}</Text>
                      <Text style={styles.phoneNote}>Change and verify your phone number</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>UNIVERSITY</Text>
                  <UniversitySearch value={profile.university} onSelect={(university) => setProfile({ ...profile, university: university?.name || '' })} placeholder="Search your university..." allowCustom />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>MAJOR</Text>
                  <TouchableOpacity style={styles.selectInput} onPress={() => setShowMajorPicker(true)} accessibilityRole="button">
                    <Text style={profile.major ? styles.selectInputText : styles.selectInputPlaceholder}>{profile.major || 'Select your major'}</Text>
                    <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>ABOUT</Text>
                  <TextInput
                    value={profile.about}
                    onChangeText={(about) => setProfile({ ...profile, about })}
                    placeholder="Share what classmates should know about riding with you."
                    placeholderTextColor={colors.textSecondary}
                    multiline
                    maxLength={240}
                    style={[styles.inputWrap, styles.aboutInput]}
                    textAlignVertical="top"
                  />
                  <Text style={styles.fieldNote}>{profile.about.length}/240 characters</Text>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Security</Text>
                <TouchableOpacity style={styles.actionRow} onPress={() => router.push({ pathname: '/(rider)/settings/change-password', params: { returnTo: '/(rider)/settings/account-settings' } } as any)} accessibilityRole="button">
                  <View style={styles.actionIcon}><Ionicons name="key-outline" size={19} color={colors.primary} /></View>
                  <View style={styles.actionCopy}><Text style={styles.actionTitle}>Change password</Text><Text style={styles.actionSubtitle}>Update your account password securely</Text></View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.saveButton, saving && styles.buttonDisabled]} onPress={() => void save()} disabled={saving} accessibilityRole="button">
                {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveText}>Save changes</Text>}
              </TouchableOpacity>

              <View style={styles.dangerSection}>
                <Text style={styles.dangerLabel}>DANGER ZONE</Text>
                <TouchableOpacity style={styles.deleteRow} onPress={() => setDeleteOpen(true)} accessibilityRole="button">
                  <View style={styles.deleteIcon}><Ionicons name="trash-outline" size={19} color={colors.red} /></View>
                  <View style={styles.actionCopy}><Text style={styles.deleteTitle}>Delete account</Text><Text style={styles.actionSubtitle}>Permanently remove your account and profile data</Text></View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={deleteOpen} transparent animationType="slide" onRequestClose={closeDelete}>
        <KeyboardAwareModalView style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleCopy}><Text style={styles.modalTitle}>Delete your account?</Text><Text style={styles.modalSubtitle}>This permanently deletes your RideAlong account and profile data. This cannot be undone.</Text></View>
              <TouchableOpacity style={styles.modalClose} onPress={closeDelete} hitSlop={hitSlop}><Ionicons name="close" size={20} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            <Text style={styles.label}>CURRENT PASSWORD</Text>
            <View style={styles.deletePasswordWrap}>
              <TextInput value={deletePassword} onChangeText={setDeletePassword} placeholder="Enter your password" placeholderTextColor={colors.textSecondary} secureTextEntry={deletePasswordHidden} autoCapitalize="none" style={styles.input} />
              <TouchableOpacity onPress={() => setDeletePasswordHidden((hidden) => !hidden)} hitSlop={hitSlop}><Ionicons name={deletePasswordHidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.deleteButton, (!deletePassword || deleting) && styles.buttonDisabled]} onPress={() => void deleteAccount()} disabled={!deletePassword || deleting}>
              {deleting ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveText}>Delete account permanently</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAwareModalView>
      </Modal>

      <Modal visible={showMajorPicker} transparent animationType="slide" onRequestClose={() => { setShowMajorPicker(false); setMajorSearch(''); }}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <View style={styles.pickerHeaderIcon}><Ionicons name="book-outline" size={16} color={colors.primary} /></View>
              <Text style={styles.pickerTitle}>Select Major</Text>
              <TouchableOpacity style={styles.pickerClose} onPress={() => { setShowMajorPicker(false); setMajorSearch(''); }} hitSlop={hitSlop}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.pickerSearchWrap}>
              <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
              <TextInput
                style={styles.pickerSearchInput}
                placeholder="Search majors..."
                placeholderTextColor={colors.textSecondary}
                value={majorSearch}
                onChangeText={setMajorSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {majorSearch.length > 0 ? (
                <TouchableOpacity onPress={() => setMajorSearch('')} hitSlop={hitSlop}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {MAJORS.filter((major) => major.toLowerCase().includes(majorSearch.toLowerCase())).map((major) => (
                <TouchableOpacity
                  key={major}
                  style={styles.pickerItem}
                  onPress={() => {
                    setProfile((current) => current ? { ...current, major } : current);
                    setMajorSearch('');
                    setShowMajorPicker(false);
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.pickerItemText, profile?.major === major && styles.pickerItemTextActive]}>{major}</Text>
                  {profile?.major === major ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                </TouchableOpacity>
              ))}
              {MAJORS.filter((major) => major.toLowerCase().includes(majorSearch.toLowerCase())).length === 0 ? (
                <View style={styles.pickerEmpty}><Text style={styles.pickerEmptyText}>{`No majors match "${majorSearch}"`}</Text></View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
