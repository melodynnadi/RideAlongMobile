import React, { useEffect, useState, useMemo } from 'react';
import * as WebBrowser from 'expo-web-browser';
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
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/constants/services';
import { settingsService } from '@/src/services/settingsService';
import { notificationService } from '@/src/services/notificationService';
import { useVerificationStore } from '@/stores/verificationStore';
import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors } from '@/constants/theme';

export default function SettingsScreen() {
  const handleBack = () => router.replace('/(driver)/profile' as any);
  const { isVerified, verificationStatus } = useVerificationStore();
  const { isDark, setDark, colors } = useAppTheme();
  const [pushEnabled, setPushEnabled] = useState(true);

  const s = useMemo(() => makeStyles(colors), [colors]);

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

  const openLink = async (url: string) => {
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    } catch {
      Alert.alert('Error', 'Failed to open the link.');
    }
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
          <View style={s.pageHeader}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={handleBack}
              activeOpacity={0.75}
            >
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={s.pageTitle}>Settings</Text>
          </View>

          <Text style={[s.groupLabel, s.firstGroupLabel]}>ACCOUNT</Text>
          <View style={s.groupCard}>
            <NavRow
              colors={colors}
              s={s}
              icon="person-circle-outline"
              label="Account"
              sub="Email, phone, password"
              onPress={() => router.push({ pathname: '/(driver)/settings/account-settings', params: { returnTo: '/(driver)/settings' } } as any)}
            />
            <NavRow
              colors={colors}
              s={s}
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
              colors={colors}
              s={s}
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
              colors={colors}
              s={s}
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
              colors={colors}
              s={s}
              icon="notifications-outline"
              label="Push notifications"
              sub="Ride offers & account alerts"
              value={pushEnabled}
              onToggle={togglePush}
            />
            <ToggleRow
              colors={colors}
              s={s}
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
              colors={colors}
              s={s}
              icon="help-buoy-outline"
              label="Help Center"
              sub="FAQs & how-to guides"
              onPress={() => openLink('https://ridealongapp.com/pages/help')}
            />
            <NavRow
              colors={colors}
              s={s}
              icon="chatbubble-ellipses-outline"
              label="Report a Bug / Feedback"
              sub="Help us improve RideAlong"
              onPress={() => WebBrowser.openBrowserAsync('https://ridealongapp.com/pages/feedback')}
            />
            <NavRow
              colors={colors}
              s={s}
              icon="mail-outline"
              label="Contact Support"
              sub="Response within 24h"
              onPress={() => openLink('mailto:support@ridealongapp.com')}
            />
            <NavRow
              colors={colors}
              s={s}
              icon="shield-checkmark-outline"
              label="Privacy Policy"
              sub="How we protect your data"
              onPress={() => WebBrowser.openBrowserAsync('https://ridealongapp.com/pages/privacy')}
            />
            <NavRow
              colors={colors}
              s={s}
              icon="document-text-outline"
              label="Terms of Service"
              sub="User agreement"
              onPress={() => WebBrowser.openBrowserAsync('https://ridealongapp.com/pages/terms')}
              isLast
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function NavRow({
  colors, s, icon, label, sub, onPress, isLast = false,
}: {
  colors: AppColors; s: ReturnType<typeof makeStyles>; icon: string; label: string; sub?: string; onPress: () => void; isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.row, !isLast && s.rowBorder]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={s.rowIconWrap}>
        <Ionicons name={icon as any} size={19} color={colors.primary} />
      </View>
      <View style={s.rowMid}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function ToggleRow({
  colors, s, icon, label, sub, value, onToggle, isLast = false,
}: {
  colors: AppColors; s: ReturnType<typeof makeStyles>; icon: string; label: string; sub?: string; value: boolean; onToggle: (v: boolean) => void; isLast?: boolean;
}) {
  return (
    <View style={[s.row, !isLast && s.rowBorder]}>
      <View style={s.rowIconWrap}>
        <Ionicons name={icon as any} size={19} color={colors.primary} />
      </View>
      <View style={s.rowMid}>
        <Text style={s.rowLabel}>{label}</Text>
        {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.switchTrackOff, true: colors.switchTrackOn }}
        thumbColor={value ? colors.switchThumbOn : colors.switchThumbOff}
        ios_backgroundColor={colors.switchIosBg}
        style={{ transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] }}
      />
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    safe: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
    pageHeader: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    groupLabel: {
      marginTop: 18,
      marginBottom: 8,
      paddingHorizontal: 2,
      color: colors.textSecondary,
      fontSize: 10,
      lineHeight: 15,
      fontWeight: '800',
      letterSpacing: 1.5,
    },
    firstGroupLabel: { marginTop: 2 },
    groupCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
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
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowIconWrap: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    rowMid: { flex: 1, minWidth: 0 },
    rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    rowSub: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  });
}
