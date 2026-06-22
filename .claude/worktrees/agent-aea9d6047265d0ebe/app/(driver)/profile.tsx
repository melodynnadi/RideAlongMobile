import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Image, ActivityIndicator, Alert } from 'react-native';
// Image picking/upload handled by src/services/profilePhoto
import { SafeAreaView } from 'react-native-safe-area-context';
import { Settings, Camera, Star, Edit2, User as UserIcon, Mail, Phone, Calendar, GraduationCap, BookOpen, Car, Palette, Hash, Users } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, getCountFromServer, limit, onSnapshot, query, updateDoc, where, setDoc, documentId } from 'firebase/firestore';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { computeFilteredAverageRating } from '@/src/services/ratings';
import { pickAndUploadProfilePhoto, removeProfilePhoto } from '@/src/services/profilePhoto';
import { logActivity } from '@/src/services/activity';
import { useVerificationStore } from '@/stores/verificationStore';

type DocumentActivityState = {
  uploadedToken?: string;
  approvedToken?: string;
  approved?: boolean;
};

export default function ProfileScreen() {
  const theme = useTheme();
  const { isVerified, verificationStatus } = useVerificationStore();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [driver, setDriver] = useState<any>(null);
  const [headerName, setHeaderName] = useState<string>('');
  const [driverAvatarUrl, setDriverAvatarUrl] = useState<string | null>(null);
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalRides: 0, totalEarnings: 0 });
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<any>(null);
  const documentActivityRef = useRef<Record<string, DocumentActivityState>>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, async (u) => {
      setUser(u);
      if (u) {
        // Fast initial render from auth
        setUserPhotoUrl(u.photoURL || null);
        setHeaderName(u.displayName || u.email?.split('@')[0] || 'Driver');
        setLoading(false); // Render immediately

        // Fetch all data in parallel (non-blocking)
        const fetchAllData = async () => {
          try {
            const [userSnap, driverSnap, ridesCount] = await Promise.all([
              getDoc(doc(firestore, 'drivers', u.uid)),
              getDoc(doc(firestore, 'drivers', u.uid)),
              getCountFromServer(query(
                collection(firestore, 'confirmedRides'),
                where('driverId', '==', u.uid),
                where('status', '==', 'COMPLETED')
              ))
            ]);

            // Process user data
            const userData = userSnap.exists() ? (userSnap.data() as any) : null;
            setProfile(userData);

            // Hydrate verification store from Firestore as a fallback
            if (userData) {
              const vs = useVerificationStore.getState();
              if (typeof userData.isVerified === 'boolean') {
                vs.setIsVerified(userData.isVerified);
              }
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

            // Process driver data
            const driverData = driverSnap.exists() ? (driverSnap.data() as any) : null;
            setDriver(driverData);
            if (driverData) {
              const pi = driverData?.personalInfo || driverData?.profile || {};
              const fn = String(pi?.firstName || pi?.firstname || pi?.first_name || pi?.first || '');
              const ln = String(pi?.lastName || pi?.lastname || pi?.last_name || pi?.last || '');
              const combined = `${fn.trim()} ${ln.trim()}`.trim();
              const drvAvatar = driverData?.avatarUrl || pi?.avatarUrl || null;
              setDriverAvatarUrl(typeof drvAvatar === 'string' && drvAvatar ? drvAvatar : null);
              const fallback = (userData?.fullName || userData?.fullname || userData?.name || u.displayName || (u.email ? u.email.split('@')[0] : 'Driver')) as string;
              setHeaderName((driverData?.fullName && String(driverData.fullName).trim()) || combined || fallback);
              
              // Vehicle info
              let vehicleData = driverData?.vehicleInfo;
              if ((!vehicleData || Object.keys(vehicleData).length === 0) && driverData?.applicationId) {
                try {
                  const appRef = doc(firestore, 'driverApplications', driverData.applicationId);
                  const appSnap = await getDoc(appRef);
                  if (appSnap.exists()) {
                    vehicleData = appSnap.data()?.vehicleInfo;
                  }
                } catch (err) {
                  console.warn('Could not fetch vehicle info:', err);
                }
              }
              setVehicleInfo(vehicleData || null);
              
              // Use cached rating from driver doc if available
              if (typeof driverData?.rating === 'number') {
                setAvgRating(driverData.rating);
              }
            }

            // Process rides count
            setStats((prev) => ({ ...prev, totalRides: ridesCount.data().count }));

            // Fetch earnings (lowest priority - can be slow)
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
            } catch (err) {
              console.warn('[Profile] Failed to fetch earnings:', err);
            }
          } catch (err) {
            console.error('[Profile] Data fetch error:', err);
          }
        };

        fetchAllData();
      } else {
        setProfile(null);
        setDriver(null);
        setHeaderName('');
        setAvgRating(null);
        setDriverAvatarUrl(null);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const onChangeAvatar = async () => {
    if (!user?.uid) return;
    try {
      const res = await pickAndUploadProfilePhoto();
      if (res.canceled) return;
      const { photoURL } = res;
      // Mirror to drivers collection avatarUrl for compatibility
      try { await updateDoc(doc(firestore, 'drivers', user.uid), { avatarUrl: photoURL }); } catch { await setDoc(doc(firestore, 'drivers', user.uid), { avatarUrl: photoURL }, { merge: true } as any); }
      setDriverAvatarUrl(photoURL);
      setUserPhotoUrl(photoURL);
      setProfile((prev: any) => ({ ...(prev || {}), avatarUrl: photoURL, photoURL }));
    } catch (e: any) {
      Alert.alert('Avatar update failed', e?.message || 'Please try again.');
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
          {/* Profile Header */}
          <View style={[styles.profileCard, { backgroundColor: theme.colors.primary }]}>
          <TouchableOpacity 
            style={styles.settingsButton}
            onPress={() => router.push('/settings')}
          >
            <Settings size={24} color="white" />
          </TouchableOpacity>
          
          <View style={styles.profileInfo}>
            <View style={styles.avatarContainer}>
              { (driverAvatarUrl || userPhotoUrl || profile?.avatarUrl) ? (
                <Image source={{ uri: (driverAvatarUrl || userPhotoUrl || profile?.avatarUrl) as string }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatar}>
                  <UserIcon size={32} color="white" />
                </View>
              )}
              <TouchableOpacity style={styles.cameraButton} onPress={onChangeAvatar} accessibilityRole="button" accessibilityLabel="Change profile picture">
                <Camera size={16} color={theme.colors.primary} />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.profileName}>
              {headerName || profile?.fullName || profile?.fullname || profile?.name || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Driver')}
            </Text>
            <Text style={styles.profileEmail}>{user?.email ?? 'no-email'}</Text>
            
            <View style={styles.verificationContainer}>
              {isVerified || verificationStatus==='approved'? (
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
                <Text style={styles.ratingText}>
                  {typeof avgRating === 'number'
                    ? avgRating.toFixed(1)
                    : (typeof (driver?.rating ?? profile?.rating) === 'number' ? (driver?.rating ?? profile?.rating).toFixed(1) : '—')}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsContainer}>
          <Card style={styles.statCard}>
            <Text style={[styles.statNumber, { color: theme.colors.secondary }]}>{stats.totalRides}</Text>
            <Text style={styles.statLabel}>Total Rides</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#10B981' }]}>${stats.totalEarnings.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Total Earned</Text>
          </Card>
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
                  {driver?.fullName || [driver?.personalInfo?.firstName, driver?.personalInfo?.lastName].filter(Boolean).join(' ') || profile?.fullName || profile?.fullname || profile?.name || user?.displayName || 'Not provided'}
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
                  {driver?.email || driver?.personalInfo?.email || user?.email || 'Not provided'}
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
                  {driver?.personalInfo?.phone || profile?.phone || profile?.phoneNumber || profile?.phonenumber || 'Not provided'}
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
                  {driver?.personalInfo?.dateOfBirth || driver?.personalInfo?.dob || profile?.dateOfBirth || profile?.dateofbirth || profile?.dob || 'Not provided'}
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
                  {driver?.personalInfo?.university || profile?.university || 'Not provided'}
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
                  {driver?.personalInfo?.major || profile?.major || 'Not provided'}
                </Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Vehicle Information */}
        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Text style={[styles.infoTitle, { color: theme.colors.secondary }]}>
              Vehicle Information
            </Text>
            <TouchableOpacity 
              style={styles.editButton} 
              onPress={() => router.push('/settings/vehicle-info')}
            >
              <Edit2 size={16} color={theme.colors.primary} />
              <Text style={[styles.editText, { color: theme.colors.primary }]}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoSection}>
            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary + '20' }]}>
                <Car size={20} color={theme.colors.primary} />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Vehicle</Text>
                <Text style={[styles.infoValue, { color: theme.colors.secondary }]}>
                  {vehicleInfo?.year && vehicleInfo?.make && vehicleInfo?.model
                    ? `${vehicleInfo.year} ${vehicleInfo.make} ${vehicleInfo.model}`
                    : 'Not specified'}
                </Text>
              </View>
            </View>

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#FEF3E2' }]}>
                <Palette size={20} color="#F97316" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Color</Text>
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {vehicleInfo?.color || vehicleInfo?.colour || 'Not specified'}
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#F8FAFC' }]}>
                <Hash size={20} color="#64748B" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>License Plate</Text>
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {vehicleInfo?.licensePlate || vehicleInfo?.license || 'Not specified'}
                </Text>
              </View>
            </View>

            <View style={styles.infoItem}>
              <View style={[styles.iconContainer, { backgroundColor: '#F3E8FF' }]}>
                <Users size={20} color="#8B5CF6" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Passenger Seats</Text>
                <Text style={[styles.infoValue, { color: '#64748B' }]}>
                  {vehicleInfo?.seats || 'Not specified'}
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

type NormalizedDocumentInfo = {
  key: string;
  status?: string;
  normalizedStatus?: string;
  uploadedToken?: string;
  uploadedAt?: number | string | null;
  approved?: boolean;
  approvedToken?: string;
  approvedAt?: number | string | null;
};

function collectDriverDocuments(driver: any): Record<string, any> {
  const map: Record<string, any> = {};
  if (!driver || typeof driver !== 'object') return map;
  const candidates = [
    driver?.documents,
    driver?.documentsStatus,
    driver?.documentStatus,
    driver?.documentsInfo,
    driver?.documentInfo,
    driver?.verification?.documents,
    driver?.verification?.requiredDocuments,
    driver?.compliance?.documents,
    driver?.compliance?.requiredDocuments,
    driver?.docs,
  ];
  candidates.forEach((candidate) => {
    if (candidate && typeof candidate === 'object') {
      Object.entries(candidate).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          map[key] = val;
        }
      });
    }
  });
  return map;
}

function normalizeDocumentInfo(key: string, value: any): NormalizedDocumentInfo {
  const info: NormalizedDocumentInfo = { key };
  if (value === undefined || value === null) return info;

  if (typeof value === 'string') {
    const status = value.trim();
    info.status = status;
    info.normalizedStatus = status.toLowerCase();
    info.uploadedToken = `string:${status}`;
    info.uploadedAt = status;
    if (['approved', 'verified', 'active', 'accepted', 'complete', 'completed'].includes(info.normalizedStatus)) {
      info.approved = true;
      info.approvedToken = `status:${info.normalizedStatus}`;
      info.approvedAt = info.uploadedAt;
    }
    return info;
  }

  if (typeof value === 'object') {
    const rawStatus =
      value.status ??
      value.state ??
      value.reviewStatus ??
      value.verificationStatus ??
      value.stage ??
      value.result ??
      value.outcome ??
      value.currentStatus;
    if (rawStatus !== undefined && rawStatus !== null) {
      info.status = String(rawStatus);
      info.normalizedStatus = info.status.toLowerCase();
    }

    const uploadSource =
      value.uploadedAt ??
      value.submittedAt ??
      value.createdAt ??
      value.timestamp ??
      value.updatedAt ??
      value.addedAt ??
      value.requestedAt;
    const normalizedUpload = normalizeTimestampForDoc(uploadSource);
    if (normalizedUpload) {
      info.uploadedToken = `ts:${normalizedUpload.token}`;
      info.uploadedAt = normalizedUpload.value;
    }

    const fileToken =
      value.fileUrl ??
      value.fileURL ??
      value.filePath ??
      value.path ??
      value.url ??
      value.storagePath ??
      value.documentUrl ??
      value.documentPath;
    if (fileToken) {
      const tokenStr = String(fileToken);
      info.uploadedToken = info.uploadedToken ? `${info.uploadedToken}|file:${tokenStr}` : `file:${tokenStr}`;
      info.uploadedAt = info.uploadedAt ?? tokenStr;
    }

    const approvedSource =
      value.approvedAt ??
      value.reviewedAt ??
      value.verifiedAt ??
      value.completedAt ??
      value.resolvedAt ??
      (value.approved === true || value.verified === true ? (value.updatedAt ?? uploadSource) : undefined);
    const normalizedApproved = normalizeTimestampForDoc(approvedSource);
    if (normalizedApproved) {
      info.approvedToken = `ts:${normalizedApproved.token}`;
      info.approvedAt = normalizedApproved.value;
    }

    const normalizedStatus = info.normalizedStatus;
    const explicitApproved =
      value.approved === true ||
      value.verified === true ||
      value.isApproved === true ||
      String(value.reviewStatus ?? '').toLowerCase() === 'approved';
    if (
      explicitApproved ||
      (typeof normalizedStatus === 'string' &&
        ['approved', 'verified', 'active', 'accepted', 'complete', 'completed'].includes(normalizedStatus))
    ) {
      info.approved = true;
      if (!info.approvedToken) {
        if (normalizedApproved) {
          info.approvedToken = `ts:${normalizedApproved.token}`;
          info.approvedAt = normalizedApproved.value;
        } else if (info.uploadedToken) {
          info.approvedToken = `status:${normalizedStatus ?? 'approved'}|${info.uploadedToken}`;
          info.approvedAt = info.approvedAt ?? info.uploadedAt ?? normalizedStatus ?? 'approved';
        } else if (normalizedStatus) {
          info.approvedToken = `status:${normalizedStatus}`;
          info.approvedAt = normalizedStatus;
        } else {
          info.approvedToken = 'status:approved';
          info.approvedAt = 'approved';
        }
      }
    } else {
      info.approved = false;
    }

    if (!info.uploadedToken) {
      const jsonToken = safeJsonStringify(value);
      if (jsonToken) {
        info.uploadedToken = `json:${jsonToken}`;
        info.uploadedAt = info.uploadedAt ?? jsonToken;
      }
    }

    return info;
  }

  return info;
}

function normalizeTimestampForDoc(value: any): { token: string; value: number | string } | null {
  if (!value) return null;
  try {
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis();
      return { token: String(millis), value: millis };
    }
  } catch {}
  if (value instanceof Date) return { token: String(value.getTime()), value: value.getTime() };
  if (typeof value === 'number' && Number.isFinite(value)) return { token: String(value), value };
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return { token: String(parsed), value: parsed };
    return { token: value, value };
  }
  return null;
}

function safeJsonStringify(value: any): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// average rating helper moved to src/services/ratings

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
    marginBottom: 24,
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
