import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Settings, Camera, Star, Edit2, User as UserIcon, Mail, Phone, Calendar, GraduationCap, BookOpen } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router, useFocusEffect } from 'expo-router';
import { onAuthStateChanged, updateProfile as updateAuthProfile } from 'firebase/auth';
import { collection, doc, getDoc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { EmailVerificationBanner } from '@/components/EmailVerificationBanner';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { pickAndUploadAvatar } from '@/services/avatarUpload';

export default function ProfileScreen() {
  const theme = useTheme();
  const { isEmailVerified, refreshProfiles: refreshAuthState } = useAuthStore();
  const { isVerified, verificationStatus } = useVerificationStore();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalRides: 0, totalSpent: 0 });
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [statsInitializing, setStatsInitializing] = useState(true);
  const [ratingInitializing, setRatingInitializing] = useState(true);
  const validCompletedRideIdsRef = useRef<Set<string>>(new Set());
  const ratingsByRideIdRef = useRef<Map<string, { stars: number; createdAt?: number }>>(new Map());

  // Refresh auth state when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      const refreshState = async () => {
        try {
          await refreshAuthState();
        } catch (error) {
          console.error('Error refreshing auth state:', error);
        }
      };
      
      refreshState();
    }, [refreshAuthState])
  );

  useEffect(() => {
  let statsUnsub: (() => void) | undefined;
  let ratingsUnsub: (() => void) | undefined;
    const unsub = onAuthStateChanged(firebaseAuth, async (u) => {
      setUser(u);
      if (u) {
        const ref = doc(firestore, 'riders', u.uid);
        const snap = await getDoc(ref);
        const data = snap.exists() ? (snap.data() as any) : null;
        setProfile(data);

        // Single listener for completed confirmed rides: drives stats and valid ride IDs
        const completedQuery = query(
          collection(firestore, 'confirmedRides'),
          where('riderId', '==', u.uid),
          where('status', '==', 'COMPLETED')
        );
        statsUnsub?.();
        statsUnsub = onSnapshot(completedQuery, (snap) => {
          let count = 0;
          let total = 0;
          const validSet = new Set<string>();
          snap.forEach((d) => {
            const r: any = d.data();
            count += 1;
            validSet.add(String(d.id));
            const parseAmount = (ride: any) => {
              const v = ride?.contributionAmount ?? ride?.estimatedFare?.total ?? ride?.estimatedFare ?? ride?.price;
              if (typeof v === 'string') {
                const m = v.match(/([\d.]+)/);
                return m ? parseFloat(m[1]) || 0 : 0;
              }
              return Number(v) || 0;
            };
            let amt = parseAmount(r);
            if (!amt && r.originalRideRequest) amt = parseAmount(r.originalRideRequest);
            if (!amt && r.originalRidePosting) amt = parseAmount(r.originalRidePosting);
            total += amt;
          });
          setStats({ totalRides: count, totalSpent: total });
          validCompletedRideIdsRef.current = validSet;
          recomputeAvg();
          if (statsInitializing) setStatsInitializing(false);
        });

        // Ratings addressed to this rider
        ratingsUnsub?.();
        ratingsUnsub = onSnapshot(
          query(collection(firestore, 'rideRatings'), where('rateeId', '==', u.uid)),
          (snap4) => {
            const map = new Map<string, { stars: number; createdAt?: number }>();
            snap4.forEach((d) => {
              const r: any = d.data() || {};
              const rideId = r?.rideId as string | undefined;
              const stars = typeof r?.stars === 'number' ? r.stars : (typeof r?.rating === 'number' ? r.rating : undefined);
              if (!rideId || typeof stars !== 'number') return;
              let createdAt: number | undefined;
              const ca = r?.createdAt;
              if (ca && typeof ca?.toDate === 'function') {
                try { createdAt = ca.toDate().getTime(); } catch {}
              } else if (typeof ca === 'string') {
                const td = new Date(ca).getTime();
                if (!isNaN(td)) createdAt = td;
              }
              const prev = map.get(rideId);
              if (!prev || (createdAt || 0) >= (prev.createdAt || 0)) {
                map.set(rideId, { stars, createdAt });
              }
            });
            ratingsByRideIdRef.current = map;
            recomputeAvg();
            if (ratingInitializing) setRatingInitializing(false);
          }
        );
      } else {
        setProfile(null);
        // Cleanup any prior stats listener when signed out
        statsUnsub?.();
        statsUnsub = undefined;
        
        ratingsUnsub?.();
        ratingsUnsub = undefined;
        setAvgRating(null);
        setStatsInitializing(true);
        setRatingInitializing(true);
      }
      setLoading(false);
    });
    return () => {
      statsUnsub?.();
      ratingsUnsub?.();
      unsub();
    };
  }, []);

  const recomputeAvg = () => {
    try {
      const valid = validCompletedRideIdsRef.current;
      const ratings = ratingsByRideIdRef.current;
      let sum = 0;
      let count = 0;
      ratings.forEach((v, id) => {
        if (valid.has(id) && typeof v?.stars === 'number' && isFinite(v.stars)) {
          sum += v.stars;
          count += 1;
        }
      });
      setAvgRating(count ? (sum / count) : null);
    } catch {}
  };

  const onChangeAvatar = async () => {
    if (!user?.uid) return;
    try {
      const result = await pickAndUploadAvatar();
      if (result.canceled) return;
      const downloadURL = result.avatarUrl;

      // Update Firebase Auth profile (non-critical)
      try {
        await updateAuthProfile(user, { photoURL: downloadURL });
      } catch (authError) {
        console.warn('Failed to update auth profile:', authError);
      }

      // Local state
      setProfile((prev: any) => ({ ...(prev || {}), avatarUrl: downloadURL, photoPath: result.photoPath }));

      void logActivity({
        type: 'profile_updated',
        entityType: 'profile',
        entityId: user.uid,
        metadata: {
          fields: ['avatarUrl'],
          mode: 'avatar',
        },
      });

      Alert.alert('Success', 'Profile picture updated successfully!');
    } catch (e: any) {
      console.error('Avatar update error:', e);
      let errorMessage = e?.message || 'Please try again.';
      if (e?.code === 'storage/unauthenticated') {
        errorMessage = 'Upload failed: Please sign in again.';
      }
      Alert.alert('Avatar update failed', errorMessage);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]} edges={['top', 'left', 'right']}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Email Verification Banner */}
          {!isEmailVerified && user?.email && (
            <EmailVerificationBanner userEmail={user.email} />
          )}
        
        {/* Profile Header */}
        <View style={[styles.profileCard, { backgroundColor: theme.colors.primary }]}>
          <TouchableOpacity 
            style={styles.settingsButton}
            onPress={() => router.push('/settings')}
          >
            <Settings size={24} color="white" />
          </TouchableOpacity>
          
          <View style={styles.profileInfo}>
            <TouchableOpacity style={styles.avatarContainer} activeOpacity={0.8} onPress={onChangeAvatar}>
              { profile?.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatar}>
                  <UserIcon size={32} color="white" />
                </View>
              )}
              <TouchableOpacity style={styles.cameraButton} onPress={onChangeAvatar}>
                <Camera size={16} color={theme.colors.primary} />
              </TouchableOpacity>
            </TouchableOpacity>
            
            <Text style={styles.profileName}>{profile?.fullName || profile?.fullname || profile?.name || user?.displayName || 'Student'}</Text>
            <Text style={styles.profileEmail}>{user?.email ?? 'no-email'}</Text>
            
            <View style={styles.verificationContainer}>
              {isVerified || verificationStatus === 'approved' ? (
                <View style={styles.verifiedBadge}>
                  <Text style={styles.verifiedText}>✓ Verified Student</Text>
                </View>
              ) : (verificationStatus === 'pending' || verificationStatus === 'manual-review') ? (
                <View style={[styles.verifiedBadge, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]}>
                  <Text style={[styles.verifiedText, { opacity: 0.75 }]}>Pending Verification</Text>
                </View>
              ) : verificationStatus === 'rejected' ? (
                <View style={[styles.verifiedBadge, { backgroundColor: 'rgba(255, 255, 255, 0.2)' }]}>
                  <Text style={styles.verifiedText}>❌ Not Verified</Text>
                </View>
              ) : null}
              <View style={styles.ratingContainer}>
                <Star size={16} color="#F59E0B" fill="#F59E0B" />
                <Text style={styles.ratingText}>{typeof avgRating === 'number' ? avgRating.toFixed(1) : '—'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsContainer}>
          {statsInitializing ? (
            <>
              <Card style={styles.statCard}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.statLabel}>Total Rides</Text>
              </Card>
              <Card style={styles.statCard}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.statLabel}>Total Spent</Text>
              </Card>
            </>
          ) : (
            <>
              <Card style={styles.statCard}>
                <Text style={[styles.statNumber, { color: theme.colors.secondary }]}>{stats.totalRides}</Text>
                <Text style={styles.statLabel}>Total Rides</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={[styles.statNumber, { color: '#10B981' }]}>${stats.totalSpent.toFixed(1)}</Text>
                <Text style={styles.statLabel}>Total Spent</Text>
              </Card>
            </>
          )}
        </View>

        {/* Personal Information */}
        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Text style={[styles.infoTitle, { color: theme.colors.secondary }]}>
              Personal Information
            </Text>
            <TouchableOpacity 
              style={styles.editButton} 
              onPress={() => router.push('/settings/account-settings')}
            >
              <Edit2 size={16} color={theme.colors.primary} />
              <Text style={[styles.editText, { color: theme.colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoSection}>
            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#F0F9FF' }]}>
                <UserIcon size={20} color="#3B82F6" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Full Name</Text>
                <Text style={[styles.infoValue, { color: theme.colors.secondary }]}>
                  {profile?.fullName || profile?.fullname || profile?.name || user?.displayName || 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#F0FDF4' }]}>
                <Mail size={20} color="#10B981" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={[styles.infoValue, { color: theme.colors.secondary }]}>
                  {user?.email ?? 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#FFFBEB' }]}>
                <Phone size={20} color="#F59E0B" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Phone Number</Text>
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {profile?.phoneNumber || 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#F8FAFC' }]}>
                <Calendar size={20} color="#64748B" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Date of Birth</Text>
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {profile?.dateOfBirth || profile?.dateofbirth || profile?.dob || 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#FEF3E2' }]}>
                <GraduationCap size={20} color="#F97316" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>University</Text>
                <Text style={[styles.infoValue, { color: theme.colors.secondary }]}>
                  {profile?.university || 'Not provided'}
                </Text>
              </View>
            </View>

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#F3E8FF' }]}>
                <BookOpen size={20} color="#8B5CF6" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Major</Text>
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {profile?.major || 'Not provided'}
                </Text>
              </View>
            </View>
          </View>
        </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  profileCard: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
    position: 'relative',
  },
  settingsButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    alignItems: 'center',
    marginTop: 20,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E5E7EB',
  },
  cameraButton: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E05E1A',
  },
  profileName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
    marginBottom: 16,
  },
  verificationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  verifiedBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  verifiedText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'white',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  statNumber: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
  },
  infoCard: {
    backgroundColor: 'white',
    padding: 20,
    paddingBottom: 32,
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editText: {
    fontSize: 16,
    fontWeight: '600',
  },
  infoSection: {
    gap: 20,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 4,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1F2937',
  },
  addButton: {
    marginTop: 6,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#64748B',
  },
});
