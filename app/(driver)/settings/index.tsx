import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { deleteUser } from 'firebase/auth';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/constants/services';
import { removeProfilePhoto } from '@/src/services/profilePhoto';
import { settingsService } from '@/src/services/settingsService';
import { notificationService } from '@/src/services/notificationService';
import { useVerificationStore } from '@/stores/verificationStore';
import { useAppTheme } from '@/hooks/ThemeContext';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const BG = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED = '#8B94A6';

export default function SettingsScreen() {
  const handleBack = () => router.replace('/(driver)/profile' as any);
  const { isVerified, verificationStatus } = useVerificationStore();
  const { isDark, setDark } = useAppTheme();
  const [pushEnabled, setPushEnabled] = useState(true);

  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    settingsService.getSettings().then((settings) => {
      setPushEnabled(settings.pushNotificationsEnabled);
    }).catch(() => {});

    const loadDriverSettings = async () => {
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return;

      try {
        const snap = await getDoc(doc(firestore, 'drivers', currentUser.uid));
        const data = snap.data() as any;

        const savedPush = data?.settings?.pushNotificationsEnabled ?? data?.pushNotificationsEnabled;
        const savedDarkMode = data?.settings?.darkModeEnabled ?? data?.darkModeEnabled;

        if (typeof savedPush === 'boolean') setPushEnabled(savedPush);
        if (typeof savedDarkMode === 'boolean') setDark(savedDarkMode);
      } catch {}
    };

    loadDriverSettings();
  }, []);

  const togglePush = async (value: boolean) => {
    const previous = pushEnabled;
    setPushEnabled(value);

    try {
      await settingsService.updateSettings({ pushNotificationsEnabled: value });
      const currentUser = firebaseAuth.currentUser;
      if (currentUser) {
        await setDoc(doc(firestore, 'drivers', currentUser.uid), {
          pushNotificationsEnabled: value,
          settings: { pushNotificationsEnabled: value },
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
      await notificationService.updateNotificationHandler();
    } catch {
      setPushEnabled(previous);
      Alert.alert('Settings not saved', 'We could not update your notification setting. Please try again.');
    }
  };

  const toggleDarkMode = async (value: boolean) => {
    const previous = isDark;
    setDark(value);
    try {
      const currentUser = firebaseAuth.currentUser;
      if (currentUser) {
        await setDoc(doc(firestore, 'drivers', currentUser.uid), {
          darkModeEnabled: value,
          settings: { darkModeEnabled: value },
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
    } catch {
      setDark(previous);
      Alert.alert('Settings not saved', 'We could not update your dark mode setting. Please try again.');
    }
  };

  const isVerifiedFinal = isVerified || verificationStatus === 'approved' || verificationStatus === 'auto-approved';
  const isPending = verificationStatus === 'pending' || verificationStatus === 'manual-review';
  const verLabel = isVerifiedFinal ? 'UT Austin - approved' : isPending ? 'Pending review' : 'Not verified';


  const handleDelete = () => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) {
      Alert.alert('Not signed in');
      return;
    }

    Alert.alert(
      'Delete Account?',
      'This permanently removes your account, profile, and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              try { await removeProfilePhoto(); } catch {}
              try { await deleteDoc(doc(firestore, 'drivers', currentUser.uid)); } catch {}
              await deleteUser(currentUser);
              router.replace('/(auth)/sign-in' as any);
            } catch (error: any) {
              Alert.alert(
                error?.code === 'auth/requires-recent-login' ? 'Re-authentication Required' : 'Delete Failed',
                error?.code === 'auth/requires-recent-login'
                  ? 'Please sign out and sign back in, then try again.'
                  : error?.message || 'Could not delete your account.'
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const openLink = async (url: string) => {
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    } catch {
      Alert.alert('Error', 'Failed to open the link.');
    }
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
          <View style={s.pageHeader}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={handleBack}
              activeOpacity={0.75}
            >
              <Ionicons name="chevron-back" size={22} color={NAVY} />
            </TouchableOpacity>
            <Text style={s.pageTitle}>Settings</Text>
          </View>

          <Text style={[s.groupLabel, s.firstGroupLabel]}>ACCOUNT</Text>
          <View style={s.groupCard}>
            <NavRow
              icon="person-circle-outline"
              label="Account"
              sub="Email, phone, password"
              onPress={() => router.push({ pathname: '/(driver)/settings/account-settings', params: { returnTo: '/(driver)/settings' } } as any)}
            />
            <NavRow
              icon="school-outline"
              label=".edu verification"
              sub={verLabel}
              onPress={() => router.push({ pathname: '/(driver)/settings/driver-student-verification', params: { returnTo: '/(driver)/settings' } } as any)}
              isLast
            />
          </View>

          <Text style={s.groupLabel}>PREFERENCES</Text>
          <View style={s.groupCard}>
            <NavRow
              icon="options-outline"
              label="Ride preferences"
              sub="Music, conversation & comfort"
              onPress={() => router.push({ pathname: '/(driver)/settings/driver-ride-preferences', params: { returnTo: '/(driver)/settings' } } as any)}
              isLast
            />
          </View>

          <Text style={s.groupLabel}>SAFETY</Text>
          <View style={s.groupCard}>
            <NavRow
              icon="shield-outline"
              label="Emergency contacts"
              sub="Trusted people who can be alerted"
              onPress={() => router.push({ pathname: '/(driver)/settings/emergency-contacts', params: { returnTo: '/(driver)/settings' } } as any)}
              isLast
            />
          </View>

          <Text style={s.groupLabel}>APP PREFERENCES</Text>
          <View style={s.groupCard}>
            <ToggleRow
              icon="notifications-outline"
              label="Push notifications"
              sub="Ride offers & account alerts"
              value={pushEnabled}
              onToggle={togglePush}
            />
            <ToggleRow
              icon="moon-outline"
              label="Dark mode"
              sub={isDark ? 'On' : 'Off'}
              value={isDark}
              onToggle={toggleDarkMode}
              isLast
            />
          </View>

          <Text style={s.groupLabel}>HELP & LEGAL</Text>
          <View style={s.groupCard}>
            <NavRow
              icon="help-buoy-outline"
              label="Help Center"
              sub="FAQs & how-to guides"
              onPress={() => openLink('https://ridealongapp.com/pages/help')}
            />
            <NavRow
              icon="mail-outline"
              label="Contact Support"
              sub="Response within 24h"
              onPress={() => openLink('mailto:support@ridealongapp.com')}
            />
            <NavRow
              icon="shield-checkmark-outline"
              label="Privacy Policy"
              sub="How we protect your data"
              onPress={() => openLink('https://ridealongapp.com/privacy')}
            />
            <NavRow
              icon="document-text-outline"
              label="Terms of Service"
              sub="User agreement"
              onPress={() => openLink('https://ridealongapp.com/terms')}
              isLast
            />
          </View>

          <TouchableOpacity
            style={[s.deleteCard, deleting && { opacity: 0.55 }]}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Text style={s.deleteText}>{deleting ? 'Deleting account...' : 'Delete Account'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function NavRow({
  icon, label, sub, onPress, isLast = false,
}: {
  icon: string; label: string; sub?: string; onPress: () => void; isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.row, !isLast && s.rowBorder]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={s.rowIconWrap}>
        <Ionicons name={icon as any} size={19} color={NAVY} />
      </View>
      <View style={s.rowMid}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={MUTED} />
    </TouchableOpacity>
  );
}

function ToggleRow({
  icon, label, sub, value, onToggle, isLast = false,
}: {
  icon: string; label: string; sub?: string; value: boolean; onToggle: (v: boolean) => void; isLast?: boolean;
}) {
  return (
    <View style={[s.row, !isLast && s.rowBorder]}>
      <View style={s.rowIconWrap}>
        <Ionicons name={icon as any} size={19} color={NAVY} />
      </View>
      <View style={s.rowMid}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#D1D5DB', true: ORANGE }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#D1D5DB"
        style={{ transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  pageHeader: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

  groupLabel: {
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 2,
    color: MUTED,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  firstGroupLabel: { marginTop: 2 },
  groupCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    marginBottom: 2,
  },

  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  rowIconWrap: { width: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowMid: { flex: 1, minWidth: 0 },
  rowLabel: { color: NAVY, fontSize: 15, fontWeight: '600' },
  rowSub: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 3 },

  deleteCard: {
    marginTop: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(185,28,28,0.22)',
    backgroundColor: 'rgba(185,28,28,0.04)',
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteText: { color: '#B91C1C', fontSize: 14, fontWeight: '600' },
});
