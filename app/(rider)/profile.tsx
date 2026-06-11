import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import {
  BookOpen,
  Calendar,
  Camera,
  Car,
  Edit2,
  GraduationCap,
  Mail,
  Phone,
  Settings,
  Star,
  User as UserIcon,
} from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import { onAuthStateChanged, updateProfile as updateAuthProfile } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { firebaseAuth, firestore } from '@/constants/services';
import { AppColors, BRAND } from '@/constants/theme';
import { useAppTheme } from '@/hooks/ThemeContext';
import { pickAndUploadAvatar } from '@/services/avatarUpload';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { logActivity } from '@/utils/activityLogger';

type GradientStops = readonly [string, string, ...string[]];

const asGradientStops = (stops: string[]): GradientStops => {
  return stops as unknown as GradientStops;
};

type InfoRow = {
  icon: any;
  label: string;
  value: string;
  tint: string;
  bg: string;
};

export default function RiderProfileScreen() {
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);
  const {
    isEmailVerified,
    refreshProfiles: refreshAuthState,
    role,
    activeRole,
    switchRole,
  } = useAuthStore();
  const { isVerified, verificationStatus } = useVerificationStore();

  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalRides: 0, totalSpent: 0 });
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [statsInitializing, setStatsInitializing] = useState(true);
  const [ratingInitializing, setRatingInitializing] = useState(true);
  const [roleActionLoading, setRoleActionLoading] = useState(false);

  const validCompletedRideIdsRef = useRef<Set<string>>(new Set());
  const ratingsByRideIdRef = useRef<Map<string, { stars: number; createdAt?: number }>>(new Map());

  useFocusEffect(
    useCallback(() => {
      const refreshState = async () => {
        try {
          await refreshAuthState();
        } catch (error) {
          console.error('Error refreshing auth state:', error);
        }
      };

      void refreshState();
    }, [refreshAuthState])
  );

  const recomputeAvg = useCallback(() => {
    try {
      const valid = validCompletedRideIdsRef.current;
      const ratings = ratingsByRideIdRef.current;
      let sum = 0;
      let count = 0;

      ratings.forEach((value, id) => {
        if (valid.has(id) && typeof value?.stars === 'number' && Number.isFinite(value.stars)) {
          sum += value.stars;
          count += 1;
        }
      });

      setAvgRating(count ? sum / count : null);
    } catch {}
  }, []);

  useEffect(() => {
    let statsUnsub: (() => void) | undefined;
    let ratingsUnsub: (() => void) | undefined;

    const unsub = onAuthStateChanged(firebaseAuth, async (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        statsUnsub?.();
        ratingsUnsub?.();
        statsUnsub = undefined;
        ratingsUnsub = undefined;
        setAvgRating(null);
        setStats({ totalRides: 0, totalSpent: 0 });
        setStatsInitializing(true);
        setRatingInitializing(true);
        setLoading(false);
        return;
      }

      try {
        const ref = doc(firestore, 'riders', currentUser.uid);
        const snap = await getDoc(ref);
        const data = snap.exists() ? (snap.data() as any) : null;
        setProfile(data);

        statsUnsub?.();
        statsUnsub = onSnapshot(
          query(
            collection(firestore, 'confirmedRides'),
            where('riderId', '==', currentUser.uid),
            where('status', '==', 'COMPLETED')
          ),
          (snapshot) => {
            let count = 0;
            let total = 0;
            const validSet = new Set<string>();

            snapshot.forEach((item) => {
              const ride: any = item.data();
              count += 1;
              validSet.add(String(item.id));

              const parseAmount = (source: any) => {
                const value =
                  source?.contributionAmount ??
                  source?.estimatedFare?.total ??
                  source?.estimatedFare ??
                  source?.price;

                if (typeof value === 'string') {
                  const match = value.match(/([\d.]+)/);
                  return match ? parseFloat(match[1]) || 0 : 0;
                }

                return Number(value) || 0;
              };

              let amount = parseAmount(ride);
              if (!amount && ride.originalRideRequest) amount = parseAmount(ride.originalRideRequest);
              if (!amount && ride.originalRidePosting) amount = parseAmount(ride.originalRidePosting);
              total += amount;
            });

            setStats({ totalRides: count, totalSpent: total });
            validCompletedRideIdsRef.current = validSet;
            recomputeAvg();
            setStatsInitializing(false);
          },
          () => setStatsInitializing(false)
        );

        ratingsUnsub?.();
        ratingsUnsub = onSnapshot(
          query(collection(firestore, 'rideRatings'), where('rateeId', '==', currentUser.uid)),
          (snapshot) => {
            const map = new Map<string, { stars: number; createdAt?: number }>();

            snapshot.forEach((item) => {
              const rating: any = item.data() || {};
              const rideId = rating?.rideId as string | undefined;
              const stars =
                typeof rating?.stars === 'number'
                  ? rating.stars
                  : typeof rating?.rating === 'number'
                    ? rating.rating
                    : undefined;

              if (!rideId || typeof stars !== 'number') return;

              let createdAt: number | undefined;
              const rawCreatedAt = rating?.createdAt;
              if (rawCreatedAt && typeof rawCreatedAt?.toDate === 'function') {
                try {
                  createdAt = rawCreatedAt.toDate().getTime();
                } catch {}
              } else if (typeof rawCreatedAt === 'string') {
                const timestamp = new Date(rawCreatedAt).getTime();
                if (!Number.isNaN(timestamp)) createdAt = timestamp;
              }

              const previous = map.get(rideId);
              if (!previous || (createdAt || 0) >= (previous.createdAt || 0)) {
                map.set(rideId, { stars, createdAt });
              }
            });

            ratingsByRideIdRef.current = map;
            recomputeAvg();
            setRatingInitializing(false);
          },
          () => setRatingInitializing(false)
        );
      } catch (error) {
        console.error('Profile load error:', error);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      statsUnsub?.();
      ratingsUnsub?.();
      unsub();
    };
  }, [recomputeAvg]);

  const onChangeAvatar = async () => {
    if (!user?.uid) return;

    try {
      const result = await pickAndUploadAvatar();
      if (result.canceled) return;

      const downloadURL = result.avatarUrl;

      try {
        await updateAuthProfile(user, { photoURL: downloadURL });
      } catch (authError) {
        console.warn('Failed to update auth profile:', authError);
      }

      setProfile((prev: any) => ({ ...(prev || {}), avatarUrl: downloadURL, photoPath: result.photoPath }));

      try {
        await updateDoc(doc(firestore, 'riders', user.uid), {
          avatarUrl: downloadURL,
          photoPath: result.photoPath,
          updatedAt: new Date(),
        });
      } catch {}

      void logActivity({
        type: 'profile_updated',
        entityType: 'profile',
        entityId: user.uid,
        metadata: { fields: ['avatarUrl'], mode: 'avatar' },
      });

      Alert.alert('Success', 'Profile picture updated successfully.');
    } catch (error: any) {
      console.error('Avatar update error:', error);
      let message = error?.message || 'Please try again.';
      if (error?.code === 'storage/unauthenticated') {
        message = 'Upload failed: Please sign in again.';
      }
      Alert.alert('Avatar update failed', message);
    }
  };

  const canSwitchToDriver = activeRole === 'rider' && role !== 'driver';

  const handleSwitchToDriver = async () => {
    if (!canSwitchToDriver || roleActionLoading) return;

    setRoleActionLoading(true);

    try {
      if (role === 'both') {
        await switchRole('driver');
        router.replace('/(driver)' as any);
        return;
      }

      Alert.alert(
        'Driver setup required',
        'To drive with RideAlong, you need to complete driver onboarding first.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Start setup',
            onPress: () => router.push('/(auth)/driver-signup?role=both' as any),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert('Could not switch', error?.message || 'Please try again.');
    } finally {
      setRoleActionLoading(false);
    }
  };

  const displayName =
    profile?.fullName ||
    profile?.fullname ||
    profile?.name ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'Student';
  const displayEmail = user?.email ?? 'No email';
  const displayAvatar = profile?.avatarUrl || user?.photoURL || null;
  const ratingText = typeof avgRating === 'number' ? avgRating.toFixed(1) : '--';
  const isStudentVerified = isVerified || verificationStatus === 'approved';

  const infoRows: InfoRow[] = [
    {
      icon: UserIcon,
      label: 'Full Name',
      value: displayName || 'Not provided',
      tint: colors.blue,
      bg: colors.blueDim,
    },
    {
      icon: Mail,
      label: 'Email',
      value: displayEmail,
      tint: colors.green,
      bg: colors.greenDim,
    },
    {
      icon: Phone,
      label: 'Phone Number',
      value: profile?.phoneNumber || profile?.phone || 'Not provided',
      tint: colors.amber,
      bg: isDark ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.10)',
    },
    {
      icon: Calendar,
      label: 'Date of Birth',
      value: profile?.dateOfBirth || profile?.dateofbirth || profile?.dob || 'Not provided',
      tint: colors.textSecondary,
      bg: colors.bgInput,
    },
    {
      icon: GraduationCap,
      label: 'University',
      value: profile?.university || 'Not provided',
      tint: colors.primary,
      bg: colors.primaryDim,
    },
    {
      icon: BookOpen,
      label: 'Major',
      value: profile?.major || 'Not provided',
      tint: '#8B5CF6',
      bg: isDark ? 'rgba(139,92,246,0.16)' : 'rgba(139,92,246,0.10)',
    },
  ];

  return (
    <View style={themed.root}>
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient colors={asGradientStops(colors.gradientBg)} style={StyleSheet.absoluteFillObject} />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={themed.loadingText}>Loading profile...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {!isEmailVerified && user?.email && <EmailVerificationBanner userEmail={user.email} />}

            <View style={themed.heroCard}>
              <LinearGradient
                colors={asGradientStops([BRAND.navyText, isDark ? '#0B1524' : '#12213A'])}
                style={StyleSheet.absoluteFillObject}
              />

              <TouchableOpacity
                style={styles.settingsButton}
                onPress={() => router.push('/(rider)/settings' as any)}
                activeOpacity={0.86}
              >
                <Settings size={22} color="#FFFFFF" />
              </TouchableOpacity>

              <View style={styles.heroContent}>
                <TouchableOpacity style={styles.avatarWrap} activeOpacity={0.85} onPress={onChangeAvatar}>
                  {displayAvatar ? (
                    <Image source={{ uri: displayAvatar }} style={styles.avatarImg} />
                  ) : (
                    <LinearGradient
                      colors={asGradientStops([BRAND.orange, BRAND.orangeDeep])}
                      style={styles.avatarFallback}
                    >
                      <UserIcon size={34} color="#FFFFFF" />
                    </LinearGradient>
                  )}

                  <TouchableOpacity style={styles.cameraButton} onPress={onChangeAvatar}>
                    <Camera size={16} color={colors.primary} />
                  </TouchableOpacity>
                </TouchableOpacity>

                <Text style={styles.profileName}>{displayName}</Text>
                <Text style={styles.profileEmail}>{displayEmail}</Text>

                <View style={styles.badgeRow}>
                  <View style={styles.heroBadge}>
                    <Text style={styles.heroBadgeText}>
                      {isStudentVerified
                        ? 'Verified Student'
                        : verificationStatus === 'pending' || verificationStatus === 'manual-review'
                          ? 'Pending Verification'
                          : verificationStatus === 'rejected'
                            ? 'Not Verified'
                            : 'Student Profile'}
                    </Text>
                  </View>

                  <View style={styles.ratingPill}>
                    <Star size={15} color="#F59E0B" fill="#F59E0B" />
                    <Text style={styles.ratingText}>{ratingText}</Text>
                  </View>
                </View>

                {canSwitchToDriver && (
                  <TouchableOpacity
                    onPress={handleSwitchToDriver}
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
                          <Car size={16} color="#FFFFFF" />
                          <Text style={styles.roleSwitchText}>
                            {role === 'both' ? 'Switch to Driver Mode' : 'Add Driver Mode'}
                          </Text>
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={themed.statCard}>
                {statsInitializing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.statValue, { color: colors.textPrimary }]}>{stats.totalRides}</Text>
                )}
                <Text style={themed.statLabel}>Total Rides</Text>
              </View>

              <View style={themed.statCard}>
                {statsInitializing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.statValue, { color: colors.primary }]}>
                    ${stats.totalSpent.toFixed(1)}
                  </Text>
                )}
                <Text style={themed.statLabel}>Total Spent</Text>
              </View>

              <View style={themed.statCard}>
                {ratingInitializing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={[styles.statValue, { color: colors.textPrimary }]}>★{ratingText}</Text>
                )}
                <Text style={themed.statLabel}>Rating</Text>
              </View>
            </View>

            <View style={themed.infoCard}>
              {isDark && <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />}

              <View style={styles.infoHeader}>
                <Text style={themed.infoTitle}>Personal Information</Text>
                <TouchableOpacity
                  style={themed.editButton}
                  onPress={() => router.push('/(rider)/settings/account-settings' as any)}
                  activeOpacity={0.86}
                >
                  <Edit2 size={15} color={colors.primary} />
                  <Text style={themed.editText}>Edit</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.infoSection}>
                {infoRows.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <View key={item.label}>
                      {index === 4 && <View style={themed.divider} />}
                      <View style={styles.infoItem}>
                        <View style={[styles.iconContainer, { backgroundColor: item.bg }]}>
                          <Icon size={20} color={item.tint} />
                        </View>
                        <View style={styles.infoContent}>
                          <Text style={themed.infoLabel}>{item.label}</Text>
                          <Text style={themed.infoValue}>{item.value}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const createStyles = (colors: AppColors, isDark: boolean) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    loadingText: {
      marginTop: 16,
      fontSize: 15,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    heroCard: {
      marginHorizontal: 18,
      marginBottom: 16,
      borderRadius: 26,
      overflow: 'hidden',
      minHeight: 288,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(13,27,72,0.08)',
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: isDark ? 0.2 : 0.12,
      shadowRadius: 24,
      elevation: 5,
    },
    statCard: {
      flex: 1,
      minHeight: 88,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 12,
    },
    statLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 5,
      textAlign: 'center',
    },
    infoCard: {
      marginHorizontal: 18,
      marginBottom: 34,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      overflow: 'hidden',
      padding: 18,
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.12 : 0.05,
      shadowRadius: 14,
      elevation: 2,
    },
    infoTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: 0,
    },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.primaryDim,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 12,
    },
    editText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '800',
    },
    infoLabel: {
      color: colors.textTertiary,
      fontSize: 12,
      fontWeight: '800',
      marginBottom: 4,
    },
    infoValue: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 20,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 2,
    },
  });

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
    paddingBottom: 90,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  settingsButton: {
    position: 'absolute',
    top: 18,
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.16)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  heroContent: {
    alignItems: 'center',
    padding: 24,
    paddingTop: 38,
  },
  avatarWrap: {
    position: 'relative',
    marginBottom: 16,
  },
  avatarImg: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#E5E7EB',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  avatarFallback: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  cameraButton: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: BRAND.orange,
  },
  profileName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  profileEmail: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 16,
    textAlign: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  heroBadge: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  ratingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
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
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  statValue: {
    fontSize: 25,
    fontWeight: '900',
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  infoSection: {
    gap: 18,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  infoContent: {
    flex: 1,
  },
});
