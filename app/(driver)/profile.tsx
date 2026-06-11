// RideAlongDriverMobile - Driver Profile Screen
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import {
  Settings, Camera, Star, Edit2,
  User as UserIcon, Mail, Phone, Calendar,
  GraduationCap, BookOpen, Car, Palette, Hash, Users,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, doc, getDoc, getCountFromServer,
  query, updateDoc, where, setDoc,
} from 'firebase/firestore';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { pickAndUploadProfilePhoto } from '@/src/services/profilePhoto';
import { useVerificationStore } from '@/stores/verificationStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppTheme } from '@/hooks/ThemeContext';
import { iconPalette, SemanticColor, AppColors, BRAND } from '@/constants/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Types (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

type DocumentActivityState = {
  uploadedToken?: string;
  approvedToken?: string;
  approved?: boolean;
};
type GradientStops = readonly [string, string, ...string[]];

const asGradientStops = (stops: string[]): GradientStops => {
  return stops as unknown as GradientStops;
};

type InfoRow =
  | {
      icon: any;
      semantic: SemanticColor;
      label: string;
      value: string;
    }
  | null;
// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);
  const { isVerified, verificationStatus } = useVerificationStore();
  const {
  role,
  activeRole,
  switchRole,
  becomeRider,
} = useAuthStore();

const [roleActionLoading, setRoleActionLoading] = useState(false);
  const [user, setUser]                       = useState<any>(null);
  const [profile, setProfile]                 = useState<any>(null);
  const [driver, setDriver]                   = useState<any>(null);
  const [headerName, setHeaderName]           = useState<string>('');
  const [driverAvatarUrl, setDriverAvatarUrl] = useState<string | null>(null);
  const [userPhotoUrl, setUserPhotoUrl]       = useState<string | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [stats, setStats]                     = useState({ totalRides: 0, totalEarnings: 0 });
  const [avgRating, setAvgRating]             = useState<number | null>(null);
  const [vehicleInfo, setVehicleInfo]         = useState<any>(null);
  const documentActivityRef = useRef<Record<string, DocumentActivityState>>({});

  // ── Animations ─────────────────────────────────────────────────────────────
  const glowAnim   = useRef(new Animated.Value(0.6)).current;
  const avatarGlow = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const g1 = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim,   { toValue: 1,   duration: 2400, useNativeDriver: true }),
      Animated.timing(glowAnim,   { toValue: 0.4, duration: 2400, useNativeDriver: true }),
    ]));
    const g2 = Animated.loop(Animated.sequence([
      Animated.timing(avatarGlow, { toValue: 1,   duration: 1800, useNativeDriver: true }),
      Animated.timing(avatarGlow, { toValue: 0.3, duration: 1800, useNativeDriver: true }),
    ]));
    g1.start(); g2.start();
    return () => { g1.stop(); g2.stop(); };
  }, []);

  // ── Auth + data fetching (unchanged) ──────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, async (u) => {
      setUser(u);
      if (u) {
        setUserPhotoUrl(u.photoURL || null);
        setHeaderName(u.displayName || u.email?.split('@')[0] || 'Driver');
        setLoading(false);

        const fetchAllData = async () => {
          try {
            const [userSnap, driverSnap, ridesCount] = await Promise.all([
              getDoc(doc(firestore, 'drivers', u.uid)),
              getDoc(doc(firestore, 'drivers', u.uid)),
              getCountFromServer(query(
                collection(firestore, 'confirmedRides'),
                where('driverId', '==', u.uid),
                where('status', '==', 'COMPLETED')
              )),
            ]);

            const userData = userSnap.exists() ? (userSnap.data() as any) : null;
            setProfile(userData);

            if (userData) {
              const vs = useVerificationStore.getState();
              if (typeof userData.isVerified === 'boolean') vs.setIsVerified(userData.isVerified);
              vs.setVerificationStatus(userData.verificationStatus || null);
              const deadlineField = userData.verificationDeadline;
              if (deadlineField) {
                const deadlineDate = typeof deadlineField?.toDate === 'function'
                  ? deadlineField.toDate()
                  : new Date(deadlineField);
                vs.setVerificationDeadline(deadlineDate);
              } else {
                vs.setVerificationDeadline(null);
              }
            }
            setUserPhotoUrl((userData?.photoURL as string) || (userData?.avatarUrl as string) || u.photoURL || null);

            const driverData = driverSnap.exists() ? (driverSnap.data() as any) : null;
            setDriver(driverData);
            if (driverData) {
              const pi = driverData?.personalInfo || driverData?.profile || {};
              const fn = String(pi?.firstName || pi?.firstname || pi?.first_name || pi?.first || '');
              const ln = String(pi?.lastName  || pi?.lastname  || pi?.last_name  || pi?.last  || '');
              const combined = `${fn.trim()} ${ln.trim()}`.trim();
              const drvAvatar = driverData?.avatarUrl || pi?.avatarUrl || null;
              setDriverAvatarUrl(typeof drvAvatar === 'string' && drvAvatar ? drvAvatar : null);
              const fallback = (userData?.fullName || userData?.fullname || userData?.name || u.displayName || (u.email ? u.email.split('@')[0] : 'Driver')) as string;
              setHeaderName((driverData?.fullName && String(driverData.fullName).trim()) || combined || fallback);

              let vehicleData = driverData?.vehicleInfo;
              if ((!vehicleData || Object.keys(vehicleData).length === 0) && driverData?.applicationId) {
                try {
                  const appSnap = await getDoc(doc(firestore, 'driverApplications', driverData.applicationId));
                  if (appSnap.exists()) vehicleData = appSnap.data()?.vehicleInfo;
                } catch (err) { console.warn('Could not fetch vehicle info:', err); }
              }
              setVehicleInfo(vehicleData || null);
              if (typeof driverData?.rating === 'number') setAvgRating(driverData.rating);
            }

            setStats((prev) => ({ ...prev, totalRides: ridesCount.data().count }));

            try {
              const token = await u.getIdToken();
              const apiUrl = getApiBaseUrl();
              const res = await fetch(`${apiUrl}/api/connect/driver-earnings?userId=${u.uid}&summaryOnly=1`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                const data = await res.json();
                setStats((prev) => ({ ...prev, totalEarnings: data.lifetime || 0 }));
              }
            } catch (err) { console.warn('[Profile] Failed to fetch earnings:', err); }
          } catch (err) { console.error('[Profile] Data fetch error:', err); }
        };

        fetchAllData();
      } else {
        setProfile(null); setDriver(null); setHeaderName('');
        setAvgRating(null); setDriverAvatarUrl(null); setLoading(false);
      }
    });
    return unsub;
  }, []);

  // ── Avatar upload (unchanged) ──────────────────────────────────────────────
  const onChangeAvatar = async () => {
    if (!user?.uid) return;
    try {
      const res = await pickAndUploadProfilePhoto();
      if (res.canceled) return;
      const { photoURL } = res;
      try {
        await updateDoc(doc(firestore, 'drivers', user.uid), { avatarUrl: photoURL });
      } catch {
        await setDoc(doc(firestore, 'drivers', user.uid), { avatarUrl: photoURL }, { merge: true } as any);
      }
      setDriverAvatarUrl(photoURL);
      setUserPhotoUrl(photoURL);
      setProfile((prev: any) => ({ ...(prev || {}), avatarUrl: photoURL, photoURL }));
    } catch (e: any) {
      Alert.alert('Avatar update failed', e?.message || 'Please try again.');
    }
  };

  // ── Derived display values ─────────────────────────────────────────────────
  const displayName = headerName
    || profile?.fullName || profile?.fullname || profile?.name
    || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Driver');

  const displayAvatar = driverAvatarUrl || userPhotoUrl || profile?.avatarUrl;
  const canSwitchToRider = activeRole === 'driver' && role !== 'rider';

  const handleSwitchToRider = async () => {
    if (!canSwitchToRider || roleActionLoading) return;

    setRoleActionLoading(true);

    try {
      if (role === 'both') {
        await switchRole('rider');
      } else {
        await becomeRider({
          firstName:
            driver?.firstName ||
            driver?.personalInfo?.firstName ||
            profile?.firstName ||
            '',
          lastName:
            driver?.lastName ||
            driver?.personalInfo?.lastName ||
            profile?.lastName ||
            '',
          university:
            driver?.university ||
            driver?.personalInfo?.university ||
            profile?.university ||
            '',
          phone:
            driver?.phone ||
            driver?.personalInfo?.phone ||
            profile?.phone ||
            '',
        });
      }

      router.replace('/(rider)' as any);
    } catch (error: any) {
      Alert.alert(
        'Could not switch',
        error?.message || 'Please try again.'
      );
    } finally {
      setRoleActionLoading(false);
    }
  };

  const ratingDisplay = typeof avgRating === 'number'
    ? avgRating.toFixed(1)
    : typeof (driver?.rating ?? profile?.rating) === 'number'
      ? (driver?.rating ?? profile?.rating).toFixed(1)
      : '—';

  // ── Info rows ──────────────────────────────────────────────────────────────
  const personalInfoRows: InfoRow[] = [
    {
      icon: UserIcon,
      semantic: 'blue',
      label: 'Full Name',
      value:
        driver?.fullName ||
        [driver?.personalInfo?.firstName, driver?.personalInfo?.lastName].filter(Boolean).join(' ') ||
        profile?.fullName ||
        profile?.fullname ||
        profile?.name ||
        user?.displayName ||
        'Not provided',
    },
    {
      icon: Mail,
      semantic: 'green',
      label: 'Email',
      value: driver?.email || driver?.personalInfo?.email || user?.email || 'Not provided',
    },
    {
      icon: Phone,
      semantic: 'amber',
      label: 'Phone Number',
      value:
        driver?.personalInfo?.phone ||
        profile?.phone ||
        profile?.phoneNumber ||
        profile?.phonenumber ||
        'Not provided',
    },
    {
      icon: Calendar,
      semantic: 'muted',
      label: 'Date of Birth',
      value:
        driver?.personalInfo?.dateOfBirth ||
        driver?.personalInfo?.dob ||
        profile?.dateOfBirth ||
        profile?.dob ||
        'Not provided',
    },
    null,
    {
      icon: GraduationCap,
      semantic: 'orange',
      label: 'University',
      value: driver?.personalInfo?.university || profile?.university || 'Not provided',
    },
    {
      icon: BookOpen,
      semantic: 'purple',
      label: 'Major',
      value: driver?.personalInfo?.major || profile?.major || 'Not provided',
    },
  ];

  const vehicleRows: InfoRow[] = [
    {
      icon: Car,
      semantic: 'orange',
      label: 'Vehicle',
      value:
        vehicleInfo?.year && vehicleInfo?.make && vehicleInfo?.model
          ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`
          : 'Not specified',
    },
    {
      icon: Palette,
      semantic: 'orange',
      label: 'Color',
      value: vehicleInfo?.color || vehicleInfo?.colour || 'Not specified',
    },
    null,
    {
      icon: Hash,
      semantic: 'muted',
      label: 'License Plate',
      value: vehicleInfo?.licensePlate || vehicleInfo?.license || 'Not specified',
    },
    {
      icon: Users,
      semantic: 'purple',
      label: 'Passenger Seats',
      value: vehicleInfo?.seats ? String(vehicleInfo.seats) : 'Not specified',
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={themed.root}>
        <StatusBar barStyle={colors.statusBar} />
        <LinearGradient
          colors={asGradientStops(colors.gradientBg)}
          style={StyleSheet.absoluteFillObject}
        />
        <SafeAreaView style={themed.loadingWrap} edges={['top']}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={themed.loadingText}>Loading profile...</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={themed.root}>
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient
        colors={asGradientStops(colors.gradientBg)}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

          {/* ══ PROFILE HERO ══ */}
          <View style={themed.hero}>
            <LinearGradient
              colors={asGradientStops(colors.gradientHero)}
              style={StyleSheet.absoluteFillObject}
            />
            {/* Decorative glow */}
            <Animated.View style={[themed.heroGlow, { opacity: glowAnim }]} />

            {/* Settings button */}
            <TouchableOpacity style={themed.settingsBtn} onPress={() => router.push('/settings')}>
              {isDark && <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFillObject} />}
              <Settings size={20} color={colors.textPrimary} />
            </TouchableOpacity>

            {/* Avatar */}
            <View style={styles.avatarWrap}>
              <Animated.View style={[styles.avatarRing, { opacity: avatarGlow }]} />
              {displayAvatar ? (
                <Image source={{ uri: displayAvatar }} style={styles.avatarImg} />
              ) : (
                <LinearGradient colors={[BRAND.orange, BRAND.orangeDeep]} style={styles.avatarImg}>
                  <UserIcon size={34} color="white" />
                </LinearGradient>
              )}
              <TouchableOpacity style={styles.cameraBtn} onPress={onChangeAvatar}>
                <LinearGradient colors={[BRAND.orange, BRAND.orangeDeep]} style={styles.cameraBtnGrad}>
                  <Camera size={14} color="white" />
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {/* Name + email */}
            <Text style={themed.heroName}>{displayName}</Text>
            <Text style={themed.heroEmail}>{user?.email ?? ''}</Text>

            {/* Badges row */}
            <View style={styles.heroBadgesRow}>
              {/* Verification badge */}
              {(isVerified || verificationStatus === 'approved') ? (
                <View style={[styles.heroBadge, { backgroundColor: 'rgba(16,185,129,0.2)', borderColor: 'rgba(16,185,129,0.4)' }]}>
                  <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                  <Text style={[styles.heroBadgeText, { color: '#10B981' }]}>Verified Student</Text>
                </View>
              ) : verificationStatus === 'pending' || verificationStatus === 'manual-review' ? (
                <View style={[styles.heroBadge, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.35)' }]}>
                  <Ionicons name="time-outline" size={13} color="#F59E0B" />
                  <Text style={[styles.heroBadgeText, { color: '#F59E0B' }]}>Pending Verification</Text>
                </View>
              ) : verificationStatus === 'rejected' ? (
                <View style={[styles.heroBadge, { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.35)' }]}>
                  <Ionicons name="close-circle" size={13} color="#EF4444" />
                  <Text style={[styles.heroBadgeText, { color: '#EF4444' }]}>Not Verified</Text>
                </View>
              ) : null}

              {/* Rating badge */}
              <View style={[styles.heroBadge, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.35)' }]}>
                <Star size={13} color="#F59E0B" fill="#F59E0B" />
                <Text style={[styles.heroBadgeText, { color: '#F59E0B' }]}>{ratingDisplay}</Text>
              </View>
            </View>

            {canSwitchToRider && (
              <TouchableOpacity
                onPress={handleSwitchToRider}
                disabled={roleActionLoading}
                activeOpacity={0.86}
                style={styles.roleSwitchBtn}
              >
                <LinearGradient
                  colors={asGradientStops([BRAND.orange, BRAND.orangeDeep])}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.roleSwitchBtnGrad}
                >
                  {roleActionLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="swap-horizontal" size={16} color="#FFFFFF" />
                      <Text style={styles.roleSwitchText}>
                        {role === 'both' ? 'Switch to Rider Mode' : 'Add Rider Mode'}
                      </Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            )}



          </View>

          {/* ══ STATS ══ */}
          <View style={styles.statsRow}>
            {[
              { label: 'Total Rides',  value: String(stats.totalRides), color: BRAND.orange, icon: 'car-outline' },
              { label: 'Total Earned', value: `$${stats.totalEarnings.toFixed(1)}`,   color: '#10B981',  icon: 'wallet-outline' },
              { label: 'Rating',       value: ratingDisplay,                           color: '#F59E0B',  icon: 'star-outline' },
            ].map((stat, i) => (
              <View key={i} style={styles.statCard}>
                <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />
                <Ionicons name={stat.icon as any} size={18} color={stat.color} style={{ marginBottom: 6 }} />
                <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={styles.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* ══ PERSONAL INFO ══ */}
          <InfoCard
            title="Personal Information"
            onEdit={() => router.push('/settings/account-settings')}
            rows={personalInfoRows}
            colors={colors}
            isDark={isDark}
          />

          {/* ══ VEHICLE INFO ══ */}
          <InfoCard
            title="Vehicle Information"
            onEdit={() => router.push('/settings/vehicle-info')}
            rows={vehicleRows}
            colors={colors}
            isDark={isDark}
          />

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InfoCard sub-component
// ─────────────────────────────────────────────────────────────────────────────

function InfoCard({
  title,
  onEdit,
  rows,
  colors,
  isDark,
}: {
  title: string;
  onEdit: () => void;
  rows: InfoRow[];
  colors: AppColors;
  isDark: boolean;
}) {
  const themed = createStyles(colors, isDark);
  return (
    <View style={themed.infoCard}>
      {isDark && <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />}
      <View style={styles.infoCardInner}>
        {/* Header */}
        <View style={styles.infoCardHdr}>
          <Text style={themed.infoCardTitle}>{title}</Text>
          <TouchableOpacity onPress={onEdit} style={styles.editBtn}>
            <Edit2 size={13} color="#F4621F" />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* Rows */}
        <View style={styles.infoRows}>
          {rows.map((row, i) => {
            if (row === null) return <View key={`div-${i}`} style={styles.infoDivider} />;
            const IconComp = row.icon;
            return (
              <View key={i} style={styles.infoRow}>
                {(() => {
                  const palette = iconPalette(colors, row.semantic);
                  return (
                    <View style={[styles.infoIconWrap, { backgroundColor: palette.bg }]}>
                      <IconComp size={17} color={palette.color} />
                    </View>
                  );
                })()}
                <View style={{ flex: 1 }}>
                  <Text style={themed.infoLabel}>{row.label}</Text>
                  <Text style={themed.infoValue}>{row.value}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────

function collectDriverDocuments(driver: any): Record<string, any> {
  const map: Record<string, any> = {};
  if (!driver || typeof driver !== 'object') return map;
  const candidates = [
    driver?.documents, driver?.documentsStatus, driver?.documentStatus,
    driver?.documentsInfo, driver?.documentInfo, driver?.verification?.documents,
    driver?.verification?.requiredDocuments, driver?.compliance?.documents,
    driver?.compliance?.requiredDocuments, driver?.docs,
  ];
  candidates.forEach((candidate) => {
    if (candidate && typeof candidate === 'object') {
      Object.entries(candidate).forEach(([key, val]) => {
        if (val !== undefined && val !== null) map[key] = val;
      });
    }
  });
  return map;
}

type NormalizedDocumentInfo = {
  key: string; status?: string; normalizedStatus?: string;
  uploadedToken?: string; uploadedAt?: number | string | null;
  approved?: boolean; approvedToken?: string; approvedAt?: number | string | null;
};

function normalizeDocumentInfo(key: string, value: any): NormalizedDocumentInfo {
  const info: NormalizedDocumentInfo = { key };
  if (value === undefined || value === null) return info;
  if (typeof value === 'string') {
    const status = value.trim();
    info.status = status; info.normalizedStatus = status.toLowerCase();
    info.uploadedToken = `string:${status}`; info.uploadedAt = status;
    if (['approved','verified','active','accepted','complete','completed'].includes(info.normalizedStatus!)) {
      info.approved = true; info.approvedToken = `status:${info.normalizedStatus}`; info.approvedAt = info.uploadedAt;
    }
    return info;
  }
  if (typeof value === 'object') {
    const rawStatus = value.status ?? value.state ?? value.reviewStatus ?? value.verificationStatus ?? value.stage ?? value.result ?? value.outcome ?? value.currentStatus;
    if (rawStatus !== undefined && rawStatus !== null) { info.status = String(rawStatus); info.normalizedStatus = info.status.toLowerCase(); }
    const uploadSource = value.uploadedAt ?? value.submittedAt ?? value.createdAt ?? value.timestamp ?? value.updatedAt ?? value.addedAt ?? value.requestedAt;
    const normalizedUpload = normalizeTimestampForDoc(uploadSource);
    if (normalizedUpload) { info.uploadedToken = `ts:${normalizedUpload.token}`; info.uploadedAt = normalizedUpload.value; }
    const fileToken = value.fileUrl ?? value.fileURL ?? value.filePath ?? value.path ?? value.url ?? value.storagePath ?? value.documentUrl ?? value.documentPath;
    if (fileToken) { const tokenStr = String(fileToken); info.uploadedToken = info.uploadedToken ? `${info.uploadedToken}|file:${tokenStr}` : `file:${tokenStr}`; info.uploadedAt = info.uploadedAt ?? tokenStr; }
    const approvedSource = value.approvedAt ?? value.reviewedAt ?? value.verifiedAt ?? value.completedAt ?? value.resolvedAt ?? (value.approved === true || value.verified === true ? (value.updatedAt ?? uploadSource) : undefined);
    const normalizedApproved = normalizeTimestampForDoc(approvedSource);
    if (normalizedApproved) { info.approvedToken = `ts:${normalizedApproved.token}`; info.approvedAt = normalizedApproved.value; }
    const normalizedStatus = info.normalizedStatus;
    const explicitApproved = value.approved === true || value.verified === true || value.isApproved === true || String(value.reviewStatus ?? '').toLowerCase() === 'approved';
    if (explicitApproved || (typeof normalizedStatus === 'string' && ['approved','verified','active','accepted','complete','completed'].includes(normalizedStatus))) {
      info.approved = true;
      if (!info.approvedToken) {
        if (normalizedApproved) { info.approvedToken = `ts:${normalizedApproved.token}`; info.approvedAt = normalizedApproved.value; }
        else if (info.uploadedToken) { info.approvedToken = `status:${normalizedStatus ?? 'approved'}|${info.uploadedToken}`; info.approvedAt = info.approvedAt ?? info.uploadedAt ?? normalizedStatus ?? 'approved'; }
        else if (normalizedStatus) { info.approvedToken = `status:${normalizedStatus}`; info.approvedAt = normalizedStatus; }
        else { info.approvedToken = 'status:approved'; info.approvedAt = 'approved'; }
      }
    } else { info.approved = false; }
    if (!info.uploadedToken) { const jsonToken = safeJsonStringify(value); if (jsonToken) { info.uploadedToken = `json:${jsonToken}`; info.uploadedAt = info.uploadedAt ?? jsonToken; } }
    return info;
  }
  return info;
}

function normalizeTimestampForDoc(value: any): { token: string; value: number | string } | null {
  if (!value) return null;
  try { if (typeof value.toMillis === 'function') { const m = value.toMillis(); return { token: String(m), value: m }; } } catch {}
  if (value instanceof Date) return { token: String(value.getTime()), value: value.getTime() };
  if (typeof value === 'number' && Number.isFinite(value)) return { token: String(value), value };
  if (typeof value === 'string') { const p = Date.parse(value); if (!Number.isNaN(p)) return { token: String(p), value: p }; return { token: value, value }; }
  return null;
}

function safeJsonStringify(value: any): string | null {
  try { return JSON.stringify(value); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

  const createStyles = (colors: AppColors, isDark: boolean) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    loadingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    hero: {
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 16,
      borderRadius: 28,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderMid,
      paddingTop: 20,
      paddingBottom: 28,
      alignItems: 'center',
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.18 : 0.08,
      shadowRadius: 24,
      elevation: 5,
    },
    heroGlow: {
      position: 'absolute',
      top: -40,
      width: 220,
      height: 220,
      borderRadius: 110,
      backgroundColor: colors.primaryDim,
      alignSelf: 'center',
    },
    settingsBtn: {
      position: 'absolute',
      top: 16,
      right: 16,
      width: 40,
      height: 40,
      borderRadius: 20,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(13,27,72,0.06)',
    },
    heroName: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.textPrimary,
      letterSpacing: -0.5,
      marginBottom: 4,
    },
    heroEmail: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 14,
      fontWeight: '500',
    },
    infoCard: {
      marginHorizontal: 16,
      marginBottom: 14,
      borderRadius: 22,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: isDark ? 0.16 : 0.06,
      shadowRadius: 18,
      elevation: 3,
    },
    infoCardTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.textPrimary,
      letterSpacing: -0.3,
    },
    infoLabel: {
      fontSize: 11,
      color: colors.textTertiary,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 3,
    },
    infoValue: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
      lineHeight: 20,
    },
  });

const styles = StyleSheet.create({

  // ── Profile Hero ──────────────────────────────────────────────────────────
  hero:             { marginHorizontal:16, marginTop:8, marginBottom:16, borderRadius:28, overflow:'hidden', borderWidth:1.5, borderColor:'rgba(255,255,255,0.08)', paddingTop:20, paddingBottom:28, alignItems:'center' },
  heroGlow:         { position:'absolute', top:-40, width:200, height:200, borderRadius:100, backgroundColor:'rgba(244,98,31,0.25)', alignSelf:'center' },
  settingsBtn:      { position:'absolute', top:16, right:16, width:40, height:40, borderRadius:20, overflow:'hidden', alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:'rgba(255,255,255,0.1)' },
  avatarWrap:       { position:'relative', marginBottom:14 },
  avatarRing:       { position:'absolute', top:-6, left:-6, right:-6, bottom:-6, borderRadius:52, borderWidth:2, borderColor:'#F4621F' },
  avatarImg:        { width:88, height:88, borderRadius:44, alignItems:'center', justifyContent:'center' },
  cameraBtn:        { position:'absolute', bottom:0, right:0, borderRadius:14, overflow:'hidden', borderWidth:2, borderColor:'#060D18' },
  cameraBtnGrad:    { width:28, height:28, alignItems:'center', justifyContent:'center' },
  heroName:         { fontSize:22, fontWeight:'800', color:'#F0F4FF', letterSpacing:-0.5, marginBottom:4 },
  heroEmail:        { fontSize:13, color:'#7A8FA8', marginBottom:14 },
  heroBadgesRow:    { flexDirection:'row', gap:8, flexWrap:'wrap', justifyContent:'center' },
  heroBadge:        { flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:10, paddingVertical:5, borderRadius:14, borderWidth:1 },
  heroBadgeText:    { fontSize:12, fontWeight:'700' },

  // ── Stats ─────────────────────────────────────────────────────────────────
  statsRow:         { flexDirection:'row', gap:10, marginHorizontal:16, marginBottom:16 },
  statCard:         { flex:1, borderRadius:18, overflow:'hidden', borderWidth:1.5, borderColor:'rgba(255,255,255,0.08)', backgroundColor:'rgba(255,255,255,0.03)', paddingVertical:14, alignItems:'center' },
  statValue:        { fontSize:20, fontWeight:'800', marginBottom:2 },
  statLabel:        { fontSize:10, color:'#7A8FA8', fontWeight:'600', textAlign:'center' },

  // ── Info Cards ────────────────────────────────────────────────────────────
  infoCard:         { marginHorizontal:16, marginBottom:14, borderRadius:22, overflow:'hidden', borderWidth:1.5, borderColor:'rgba(255,255,255,0.08)', backgroundColor:'rgba(255,255,255,0.03)' },
  infoCardInner:    { padding:18 },
  infoCardHdr:      { flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:18 },
  infoCardTitle:    { fontSize:16, fontWeight:'800', color:'#F0F4FF', letterSpacing:-0.3 },
  editBtn:          { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:'rgba(244,98,31,0.1)', paddingHorizontal:10, paddingVertical:5, borderRadius:12, borderWidth:1, borderColor:'rgba(244,98,31,0.25)' },
  editBtnText:      { fontSize:12, color:'#F4621F', fontWeight:'700' },
  infoRows:         { gap:16 },
  infoRow:          { flexDirection:'row', alignItems:'flex-start', gap:12 },
  infoIconWrap:     { width:38, height:38, borderRadius:12, alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2 },
  infoLabel:        { fontSize:11, color:'#7A8FA8', fontWeight:'600', textTransform:'uppercase', letterSpacing:0.5, marginBottom:3 },
  infoValue:        { fontSize:15, fontWeight:'600', color:'#E2E8F0', lineHeight:20 },
  infoDivider:      { height:1, backgroundColor:'rgba(255,255,255,0.07)', marginVertical:4 },

  roleSwitchBtn: {
    marginTop: 16,
    borderRadius: 18,
    overflow: 'hidden',
    alignSelf: 'center',
  },

  roleSwitchBtnGrad: {
    minHeight: 42,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  roleSwitchText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },



});