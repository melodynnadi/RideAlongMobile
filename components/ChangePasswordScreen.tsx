import { Ionicons } from '@expo/vector-icons';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { firebaseAuth } from '@/constants/services';
import { hitSlop, layout } from '@/theme/designSystem';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, alignItems: 'center', backgroundColor: colors.bg },
    safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: colors.bg },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingBottom: 36 },
    header: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'},
    headerTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
    intro: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 20 },
    formCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 17, marginBottom: 18 },
    fieldGroup: { marginBottom: 16 },
    label: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, letterSpacing: 1.3, fontWeight: '700', marginBottom: 7 },
    inputWrap: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
    input: { flex: 1, color: colors.textPrimary, fontSize: 15, paddingVertical: 14, paddingRight: 12 },
    requirement: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 13, backgroundColor: colors.primaryDim, padding: 12 },
    requirementText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 17 },
    saveButton: { minHeight: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    buttonDisabled: { opacity: 0.5 },
    saveText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  });
}

function PasswordField({ label, value, onChangeText, placeholder, styles, colors }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  styles: ReturnType<typeof makeStyles>;
  colors: any;
}) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textSecondary} secureTextEntry={hidden} autoCapitalize="none" textContentType="password" style={styles.input} />
        <TouchableOpacity onPress={() => setHidden((current) => !current)} hitSlop={hitSlop} accessibilityLabel={hidden ? 'Show password' : 'Hide password'}>
          <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ChangePasswordScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { goBack } = useReturnNavigation('/(rider)/settings/account-settings');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const user = firebaseAuth.currentUser;
    if (!user?.email) {
      Alert.alert('Sign in required', 'Please sign in again before changing your password.');
      return;
    }
    if (!currentPassword || !newPassword || !confirmation) {
      Alert.alert('Missing information', 'Complete all password fields.');
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      Alert.alert('Password is too weak', 'Use at least 8 characters with uppercase, lowercase, a number, and a special character.');
      return;
    }
    if (newPassword !== confirmation) {
      Alert.alert('Passwords do not match', 'Re-enter the same new password in both fields.');
      return;
    }
    if (currentPassword === newPassword) {
      Alert.alert('Choose a new password', 'Your new password must be different from your current password.');
      return;
    }

    setSaving(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
      await updatePassword(user, newPassword);
      Alert.alert('Password updated', 'Your new password is ready to use.', [{ text: 'Done', onPress: goBack }]);
    } catch (error: any) {
      const incorrect = error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password';
      Alert.alert('Unable to change password', incorrect ? 'Your current password is incorrect.' : error?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={goBack} hitSlop={hitSlop} accessibilityLabel="Go back"><Ionicons name="arrow-back" size={19} color={colors.textPrimary} /></TouchableOpacity>
            <Text style={styles.headerTitle}>Change password</Text>
          </View>
          <Text style={styles.intro}>Enter your current password, then choose a strong new one.</Text>
          <View style={styles.formCard}>
            <PasswordField label="CURRENT PASSWORD" value={currentPassword} onChangeText={setCurrentPassword} placeholder="Enter current password" styles={styles} colors={colors} />
            <PasswordField label="NEW PASSWORD" value={newPassword} onChangeText={setNewPassword} placeholder="Create a new password" styles={styles} colors={colors} />
            <PasswordField label="CONFIRM NEW PASSWORD" value={confirmation} onChangeText={setConfirmation} placeholder="Repeat new password" styles={styles} colors={colors} />
            <View style={styles.requirement}><Ionicons name="shield-checkmark-outline" size={17} color={colors.primary} /><Text style={styles.requirementText}>At least 8 characters with uppercase, lowercase, a number, and a special character.</Text></View>
          </View>
          <TouchableOpacity style={[styles.saveButton, saving && styles.buttonDisabled]} onPress={() => void save()} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveText}>Update password</Text>}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
