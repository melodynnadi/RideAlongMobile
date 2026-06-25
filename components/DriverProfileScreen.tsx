import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text as RNText, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDocs, getDoc, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { StatusBar } from 'expo-status-bar';

import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { pickAndUploadProfilePhoto } from '@/src/services/profilePhoto';
import { useVerificationStore } from '@/stores/verificationStore';
import { useAuthStore } from '@/stores/authStore';
import { hitSlop, layout } from '@/theme/designSystem';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const BG = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED = '#8B94A6';
const FONT_SANS = Platform.OS === 'web' ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' : undefined;
const FONT_MONO = Platform.OS === 'web' ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : undefined;

function Text({ style, ...props }: React.ComponentProps<typeof RNText>) {
  return <RNText {...props} style={[styles.text, style]} />;
}

function Pill({ label, active }: { label: string; active?: boolean }) {
  return <Text style={[styles.pill, active && styles.pillActive]}>{label}</Text>;
}

function RatingPill({ rating }: { rating: number }) {
  return (
    <View style={[styles.pill, styles.ratingPill]}>
      <Ionicons name="star" size={11} color={ORANGE} />
      <RNText style={styles.ratingPillText}>{rating.toFixed(2)}</RNText>
    </View>
  );
}

function MenuRow({ icon, title, sub, href, returnTo }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; href?: string; returnTo?: string }) {
  const pathname = usePathname();
  return (
    <TouchableOpacity
      style={styles.menuRow}
      onPress={() => href && router.push({ pathname: href, params: { returnTo: returnTo || pathname } } as any)}
      disabled={!href}
      accessibilityRole={href ? 'link' : undefined}
    >
      <View style={styles.menuIcon}><Ionicons name={icon} size={18} color="#6B7280" /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        {sub ? <Text style={styles.menuSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={17} color={MUTED} />
    </TouchableOpacity>
  );
}

export default function DriverProfileScreen() {
  const insets = useSafeAreaInsets();
  const { signOut, role, activeRole, switchRole, becomeRider } = useAuthStore();
  const { isVerified, verificationStatus } = useVerificationStore();
  const [loading, setLoading] = useState(true);
  const [roleActionLoading, setRoleActionLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [driver, setDriver] = useState<any>(null);
  const [displayName, setDisplayName] = useState('Driver');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalRides: 0, totalEarnings: 0, avgRating: null as number | null });
  const [vehicleLabel, setVehicleLabel] = useState('Vehicle not set');

  const canSwitchToRider = activeRole === 'driver' && role !== 'rider';

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, async (u) => {
      setUser(u);
      if (!u) {
        setDriver(null);
        setLoading(false);
        return;
      }

      try {
        const driverSnap = await getDoc(doc(firestore, 'drivers', u.uid));

        const driverData = driverSnap.exists() ? (driverSnap.data() as any) : null;
        setDriver(driverData);

        const pi = driverData?.personalInfo || driverData?.profile || {};
        const combined = `${pi?.firstName || ''} ${pi?.lastName || ''}`.trim();
        setDisplayName(driverData?.fullName || combined || u.displayName || u.email?.split('@')[0] || 'Driver');
        setAvatarUrl(driverData?.avatarUrl || pi?.avatarUrl || u.photoURL || null);

        const vehicle = driverData?.vehicleInfo;
        if (vehicle?.year && vehicle?.make && vehicle?.model) {
          setVehicleLabel(`${vehicle.year} ${vehicle.make} ${vehicle.model}`);
        }

        if (typeof driverData?.rating === 'number') {
          setStats((prev) => ({ ...prev, avgRating: driverData.rating }));
        }
      } finally {
        setLoading(false);
      }

      // Load ride count and earnings non-blocking (after loading screen is dismissed)
      try {
        const ridesSnap = await getDocs(
          query(collection(firestore, 'confirmedRides'), where('driverId', '==', u.uid), where('status', '==', 'COMPLETED'))
        );
        setStats((prev) => ({ ...prev, totalRides: ridesSnap.size }));
      } catch { /* non-critical */ }

      try {
        const token = await u.getIdToken();
        const res = await fetch(`${getApiBaseUrl()}/api/connect/driver-earnings?userId=${u.uid}&summaryOnly=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setStats((prev) => ({ ...prev, totalEarnings: data.lifetime || 0 }));
        }
      } catch { /* earnings optional */ }
    });
    return unsub;
  }, []);

  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const aboutText = String(driver?.about || driver?.bio || driver?.description || driver?.personalInfo?.about || driver?.personalInfo?.bio || '').trim();

  const onChangeAvatar = async () => {
    if (!user?.uid) return;
    try {
      const res = await pickAndUploadProfilePhoto();
      if (res.canceled) return;
      try {
        await updateDoc(doc(firestore, 'drivers', user.uid), { avatarUrl: res.photoURL });
      } catch {
        await setDoc(doc(firestore, 'drivers', user.uid), { avatarUrl: res.photoURL }, { merge: true } as any);
      }
      setAvatarUrl(res.photoURL);
    } catch (error: any) {
      Alert.alert('Avatar update failed', error?.message || 'Please try again.');
    }
  };

  const handleSwitchToRider = async () => {
    if (!canSwitchToRider || roleActionLoading) return;
    setRoleActionLoading(true);
    try {
      if (role === 'both') await switchRole('rider');
      else {
        await becomeRider({
          firstName: driver?.firstName || driver?.personalInfo?.firstName || '',
          lastName: driver?.lastName || driver?.personalInfo?.lastName || '',
          university: driver?.university || driver?.personalInfo?.university || '',
          phone: driver?.phone || driver?.personalInfo?.phone || '',
        });
      }
      router.replace('/(rider)' as any);
    } catch (error: any) {
      Alert.alert('Could not switch', error?.message || 'Please try again.');
    } finally {
      setRoleActionLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.loadingWrap}>
          <ActivityIndicator color={ORANGE} size="large" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: 90 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.circleBtn} onPress={() => router.replace('/(driver)' as any)} hitSlop={hitSlop}>
              <Ionicons name="arrow-back" size={18} color={NAVY} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Profile</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={styles.circleBtn} onPress={() => router.push({ pathname: '/(driver)/settings', params: { returnTo: '/(driver)/profile' } } as any)} hitSlop={hitSlop}>
              <Ionicons name="settings-outline" size={18} color={NAVY} />
            </TouchableOpacity>
          </View>

          <View style={styles.profileTopRow}>
            <TouchableOpacity style={styles.bigAvatar} onPress={onChangeAvatar} accessibilityRole="button" accessibilityLabel="Change profile photo">
              {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.bigAvatarImage} /> : <Text style={styles.bigAvatarText}>{initials}</Text>}
              <View style={styles.cameraBadge}><Ionicons name="camera" size={12} color="#FFFFFF" /></View>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <View style={styles.profileIdentityHeader}>
                <Text style={styles.profileName}>{displayName}</Text>
                <TouchableOpacity
                  style={styles.editProfileButton}
                  onPress={() => router.push({ pathname: '/(driver)/settings/account-settings', params: { returnTo: '/(driver)/profile' } } as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Edit profile"
                  hitSlop={hitSlop}
                >
                  <Ionicons name="pencil" size={16} color={ORANGE} />
                </TouchableOpacity>
              </View>
              <Text style={styles.mutedSmall}>{driver?.personalInfo?.university || user?.email}</Text>
              <View style={[styles.pillRow, styles.profileBadgeRow]}>
                {(isVerified || verificationStatus === 'approved') ? <Pill label="Verified driver" active /> : null}
                {stats.avgRating ? <RatingPill rating={stats.avgRating} /> : null}
              </View>
            </View>
          </View>

          <View style={styles.profileActivity}>
            <View style={styles.profileActivityItem}><Text style={styles.profileActivityValue}>{stats.totalRides}</Text><Text style={styles.profileActivityLabel}>Completed</Text></View>
            <View style={styles.profileActivityDivider} />
            <View style={styles.profileActivityItem}><Text style={[styles.profileActivityValue, { color: ORANGE }]}>${Math.round(stats.totalEarnings)}</Text><Text style={styles.profileActivityLabel}>Earned</Text></View>
            <View style={styles.profileActivityDivider} />
            <View style={styles.profileActivityItem}><Text style={styles.profileActivityValue}>{stats.avgRating ? stats.avgRating.toFixed(1) : 'â€”'}</Text><Text style={styles.profileActivityLabel}>Rating</Text></View>
          </View>

          {aboutText ? (
            <View style={styles.aboutCard}>
              <Text style={styles.aboutTitle}>About</Text>
              <Text style={styles.aboutText}>{aboutText}</Text>
            </View>
          ) : null}

          {canSwitchToRider ? (
            <TouchableOpacity style={styles.switchBtn} onPress={handleSwitchToRider} disabled={roleActionLoading}>
              {roleActionLoading ? <ActivityIndicator color="#FFFFFF" /> : <>
                <Ionicons name="swap-horizontal" size={16} color="#FFFFFF" />
                <Text style={styles.switchBtnText}>{role === 'both' ? 'Switch to rider mode' : 'Add rider mode'}</Text>
              </>}
            </TouchableOpacity>
          ) : null}

          <View style={styles.menuCard}>
            <MenuRow icon="car" title="Vehicle info" sub={vehicleLabel} href="/(driver)/settings/vehicle-info" returnTo="/(driver)/profile" />
            <MenuRow icon="wallet" title="Earnings & payouts" sub="View payout history" href="/(driver)/earnings" returnTo="/(driver)/profile" />
            <MenuRow icon="time" title="Ride history" href="/(driver)/settings/driver-ride-history" returnTo="/(driver)/profile" />

            <MenuRow icon="notifications" title="Notifications" href="/(driver)/notifications" returnTo="/(driver)/profile" />


          </View>

        </ScrollView>
        <View style={[styles.logoutContainer, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity style={styles.logoutBtn} onPress={signOut} activeOpacity={0.85}>
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: FONT_SANS, color: NAVY },
  root: { flex: 1, backgroundColor: BG, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: BG },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: MUTED, fontSize: 14 },
  scroll: { flex: 1 },
  header: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  headerTitle: { fontFamily: FONT_SANS, color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
  circleBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER},
  content: { flexGrow: 1, width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingTop: 4 },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  profileIdentityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  editProfileButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF2E9', alignItems: 'center', justifyContent: 'center' },
  bigAvatar: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bigAvatarImage: { width: '100%', height: '100%' },
  bigAvatarText: { color: ORANGE, fontSize: 26, fontWeight: '600' },
  cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 24, height: 24, borderRadius: 12, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: BG },
  profileName: { flex: 1, fontFamily: FONT_SANS, color: NAVY, fontSize: 25, fontWeight: '700', marginTop: 3 },
  mutedSmall: { color: MUTED, fontSize: 13, marginTop: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  profileBadgeRow: { marginTop: 6 },
  pill: { fontFamily: FONT_MONO, borderRadius: 18, borderWidth: 1, borderColor: '#D7DCE3', color: '#6B7280', fontSize: 11, paddingHorizontal: 12, paddingVertical: 7, overflow: 'hidden' },
  pillActive: { backgroundColor: NAVY, borderColor: NAVY, color: '#FFFFFF' },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingPillText: { fontFamily: FONT_MONO, color: '#6B7280', fontSize: 11 },
  profileActivity: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingHorizontal: 8 },
  profileActivityItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  profileActivityDivider: { width: 1, height: 32, backgroundColor: BORDER },
  profileActivityValue: { fontFamily: FONT_SANS, color: NAVY, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  profileActivityLabel: { color: MUTED, fontSize: 11, lineHeight: 16, marginTop: 2 },
  aboutCard: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 18 },
  aboutTitle: { fontFamily: FONT_SANS, color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 6 },
  aboutText: { color: '#5F6878', fontSize: 13, lineHeight: 20, fontWeight: '500' },
  switchBtn: { height: 48, borderRadius: 24, backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 18 },
  switchBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  menuCard: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', overflow: 'hidden', marginBottom: 18 },
  menuRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  menuIcon: { width: 22, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontFamily: FONT_SANS, color: NAVY, fontSize: 15, fontWeight: '600' },
  menuSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  logoutContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingTop: 10, backgroundColor: 'rgba(251,250,247,0.96)' },
  logoutBtn: { height: 52, borderRadius: 26, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  logoutText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
