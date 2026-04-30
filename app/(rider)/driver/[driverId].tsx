import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Phone, User as UserIcon, Star } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';

export default function DriverDetailsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { driverId } = useLocalSearchParams();
  const [loading, setLoading] = useState(true);
  const [driver, setDriver] = useState<any>(null);
  const [profileCache, setProfileCache] = useState<Record<string, any>>({});
  const [ratings, setRatings] = useState<any[]>([]);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [comments, setComments] = useState<any[]>([]);

  useEffect(() => {
    if (!driverId) return;
    let ratingsUnsub: (() => void) | undefined;
    const load = async () => {
      setLoading(true);
      // Fetch driver primary doc
      try {
        const dRef = doc(firestore, 'drivers', String(driverId));
        const snap = await getDoc(dRef);
        let data: any = snap.exists() ? (snap.data() as any) : null;
        if (!data) {
          // fallback to users/{driverId}
          const uRef = doc(firestore, 'users', String(driverId));
          const usnap = await getDoc(uRef);
          data = usnap.exists() ? (usnap.data() as any) : null;
        }
        
        // Normalize name field from multiple possible sources
        if (data) {
          const displayName = data.fullName || data.displayName || data.name || 
            (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}`.trim() : null) ||
            (data.firstName ? data.firstName : null);
          data = { ...data, fullName: displayName || 'Driver', displayName: displayName || 'Driver', name: displayName || 'Driver' };
        }
        
        setDriver(data || {});

        // Live ratings where rateeId == driverId
        ratingsUnsub = onSnapshot(query(collection(firestore, 'rideRatings'), where('rateeId', '==', String(driverId))), (snap) => {
          const arr: any[] = [];
          const raterIds = new Set<string>();
          snap.forEach((d) => {
            const r = d.data() as any;
            const stars = typeof r.stars === 'number' ? r.stars : (typeof r.rating === 'number' ? r.rating : undefined);
            arr.push({ id: d.id, ...r, stars });
            if (r?.raterId) raterIds.add(String(r.raterId));
          });
          setRatings(arr);

          // Build comments filtered: non-empty comment and raterId exists and is a rider
          (async () => {
            const commentsArr: any[] = [];
            const ids = Array.from(raterIds);
            console.log('[DriverProfile] Processing ratings for comments. Total ratings:', arr.length, 'Unique raterIds:', ids.length);
            if (!ids.length) { 
              console.log('[DriverProfile] No raterIds found');
              setComments([]); 
              setAvgRating(computeAvg(arr)); 
              return; 
            }
            // Batch fetch potential rider docs from 'riders' and 'users'
            const batches: string[] = ids.slice();
            const fetchedProfiles: Record<string, any> = {};
            await Promise.all(batches.map(async (rid) => {
              try {
                const rSnap = await getDoc(doc(firestore, 'riders', rid));
                if (rSnap.exists()) {
                  const data = rSnap.data();
                  // Normalize name from multiple possible fields
                  const displayName = data?.name || data?.displayName || data?.fullName || 
                    (data?.firstName && data?.lastName ? `${data.firstName} ${data.lastName}`.trim() : null) ||
                    (data?.firstName ? data.firstName : null);
                  fetchedProfiles[rid] = { ...data, name: displayName, displayName, fullName: displayName };
                  console.log('[DriverProfile] Found rider profile for', rid, ':', displayName);
                } else {
                  const uSnap = await getDoc(doc(firestore, 'users', rid));
                  if (uSnap.exists()) {
                    const data = uSnap.data();
                    // Normalize name from multiple possible fields
                    const displayName = data?.name || data?.displayName || data?.fullName || 
                      (data?.firstName && data?.lastName ? `${data.firstName} ${data.lastName}`.trim() : null) ||
                      (data?.firstName ? data.firstName : null);
                    fetchedProfiles[rid] = { ...data, name: displayName, displayName, fullName: displayName };
                    console.log('[DriverProfile] Found user profile for', rid, ':', displayName);
                  } else {
                    console.log('[DriverProfile] No profile found for raterId:', rid);
                  }
                }
              } catch (e) {
                console.warn('[DriverProfile] Error fetching profile for', rid, e);
              }
            }));

            for (const item of arr) {
              if (!item.comment || typeof item.comment !== 'string' || !item.comment.trim()) continue;
              const rater = fetchedProfiles[String(item.raterId)];
              if (!rater) {
                console.log('[DriverProfile] Skipping comment - no rater profile found for', item.raterId);
                continue; // only include comments where rater is a rider/user
              }
              console.log('[DriverProfile] Adding comment from', rater.name || rater.displayName);
              commentsArr.push({ ...item, raterProfile: rater });
            }
            console.log('[DriverProfile] Final comments count:', commentsArr.length);
            setProfileCache(fetchedProfiles);
            setComments(commentsArr);
            setAvgRating(computeAvg(arr));
          })();
        });

      } catch (e) {
        console.warn('Driver load error', e);
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => { ratingsUnsub?.(); };
  }, [driverId]);

  const computeAvg = (arr: any[]) => {
    const nums = arr.map((a) => (typeof a.stars === 'number' ? a.stars : undefined)).filter((n) => typeof n === 'number');
    if (!nums.length) return null;
    const sum = nums.reduce((s, v) => s + (v as number), 0);
    return sum / nums.length;
  };

  const openDialer = (phone?: string) => {
    if (!phone) return;
    const url = `tel:${phone}`;
    Linking.openURL(url).catch(() => {});
  };

  const phone = driver?.phone || driver?.phoneNumber || driver?.contactPhone || driver?.phone1;
  const avatar = driver?.avatarUrl || driver?.avatarUrl1 || driver?.photoURL || driver?.profilePhoto || null;

  // compute rating counts (1-5) and max for histogram widths
  const ratingCounts = useMemo(() => {
    const counts: Record<number, number> = {5: 0,4: 0,3: 0,2: 0,1: 0};
    for (const r of ratings) {
      const stars = typeof r.stars === 'number' ? Math.max(1, Math.min(5, Math.round(r.stars))) : undefined;
      if (typeof stars === 'number') counts[stars] = (counts[stars] || 0) + 1;
    }
    return counts;
  }, [ratings]);

  const maxRatingCount = useMemo(() => Math.max(...Object.values(ratingCounts), 1), [ratingCounts]);

  const displayedRideCount = driver?.rideCount ?? ratings.length;

  const displayAvg = typeof avgRating === 'number' ? avgRating : (computeAvg(ratings) ?? null);

  return (
  <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { backgroundColor: '#F8FAFC' }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} accessibilityLabel="Back">
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={{ marginLeft: 8 }}>
          <Text style={[styles.headerText, styles.title]}>Driver Profile</Text>
          <Text style={styles.subheader}>View your driver details</Text>
        </View>
      </View>
      <ScrollView style={styles.content}>
        <Card style={[styles.profileCardRounded, { backgroundColor: '#FFFFFF', borderColor: '#E6E9EE', borderWidth: StyleSheet.hairlineWidth }]}> 
          <View style={styles.profileHeaderRow}>
            <View style={styles.avatarWrapLarge}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatarImgLarge} />
              ) : (
                <View style={styles.avatarPlaceholderLarge}><UserIcon size={28} color={theme.colors.muted} /></View>
              )}
            </View>
            <View style={styles.profileInfoCol}>
              <Text style={styles.nameLarge}>{driver?.fullName || driver?.displayName || driver?.name || 'Driver'}</Text>
              <View style={styles.nameRatingRow}>
                <View style={styles.ratingStack}>
                  <View style={styles.ratingRowTop}>
                    <Star size={16} color="#FB923C" />
                    <Text style={styles.avgRatingText}>{displayAvg !== null ? displayAvg.toFixed(1) : '—'}</Text>
                    <Text style={styles.rideCountTextSmall}>{displayedRideCount} rides</Text>
                  </View>
                </View>
                <View style={styles.callWrapRight}>
                  {phone ? (
                    <TouchableOpacity style={[styles.callBtn, { backgroundColor: theme.colors.secondary || '#1A2942' }]} onPress={() => openDialer(phone)}>
                      <Phone size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                  ) : (
                    <View style={[styles.callBtnDisabled, { backgroundColor: '#E6EEF6' }]} accessibilityLabel="Phone not provided" accessible>
                      <Phone size={18} color="#94A3B8" />
                    </View>
                  )}
                </View>
              </View>
            </View>
          </View>
        </Card>

        {/* Ratings summary with histogram placeholder */}
        <Card style={[styles.card, { backgroundColor: '#FFFFFF', borderColor: '#E6E9EE', borderWidth: StyleSheet.hairlineWidth }]}>
          <Text style={styles.cardTitle}>Ratings summary</Text>
          <View style={styles.ratingSummaryContainer}>
            <View style={styles.ratingLeft}> 
              <Text style={styles.bigRating}>{displayAvg !== null ? displayAvg.toFixed(1) : '—'}</Text>
              <Text style={styles.smallText}>{displayedRideCount} reviews</Text>
            </View>
            <View style={styles.ratingHistogram}>
              {[5,4,3,2,1].map((star) => {
                const count = ratingCounts[star] || 0;
                const pct = Math.round((count / maxRatingCount) * 100);
                return (
                  <View key={star} style={styles.histRow}>
                    <Text style={styles.histLabel}>{star}</Text>
                    <View style={styles.histBarBg}><View style={[styles.histBarFill, { width: `${pct}%`}]} /></View>
                    <Text style={styles.histCount}>{count}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </Card>

        {/* Ride Preferences */}
        <Card style={[styles.card, { backgroundColor: '#FFFFFF', borderColor: '#E6E9EE', borderWidth: StyleSheet.hairlineWidth }]}>
          <Text style={styles.cardTitle}>Ride Preferences</Text>
          {
            (() => {
              const prefs = driver?.preferences || {};
              const musicArr = driver?.musicPreferences || driver?.musicPreference || prefs?.musicPreferences || prefs?.musicPreference || [];
              const music = Array.isArray(musicArr) ? (musicArr.length ? musicArr.join(', ') : 'None') : (typeof musicArr === 'string' ? musicArr : 'None');

              const conversation = driver?.talkativeness || driver?.convoLevel || driver?.conversationLevel || prefs?.talkativeness || prefs?.convoLevel || prefs?.conversationLevel || 'Chatty';

              const passengerType = driver?.genderPreference || driver?.rideGender || driver?.passengerType || prefs?.genderPreference || prefs?.rideGender || prefs?.passengerType || 'Any';

              const smoking = driver?.smokingPreference || prefs?.smokingPreference || 'No Smoking';

              const soundEnv = driver?.soundEnvironment || driver?.personality || prefs?.soundEnvironment || prefs?.personality || 'Music';

              const maxPassengers = driver?.maxPassengers ?? prefs?.maxPassengers ?? driver?.capacity ?? '1';

              return (
                <>
                  <View style={styles.prefRow}><Text style={styles.prefLabel}>Conversation</Text><Text style={styles.prefValue}>{conversation}</Text></View>
                  <View style={styles.prefRow}><Text style={styles.prefLabel}>Music</Text><Text style={styles.prefValue}>{music}</Text></View>
                  <View style={styles.prefRow}><Text style={styles.prefLabel}>Passenger Type</Text><Text style={styles.prefValue}>{passengerType}</Text></View>
                  <View style={styles.prefRow}><Text style={styles.prefLabel}>Smoking</Text><Text style={styles.prefValue}>{smoking}</Text></View>
                  <View style={styles.prefRow}><Text style={styles.prefLabel}>Sound Environment</Text><Text style={styles.prefValue}>{soundEnv}</Text></View>
                  <View style={styles.prefRow}><Text style={styles.prefLabel}>Max Passengers</Text><Text style={styles.prefValue}>{String(maxPassengers)}</Text></View>
                </>
              );
            })()
          }
        </Card>

        {/* Comments */}
        {comments.length ? (
          <Card style={[styles.card, { backgroundColor: '#FFFFFF', borderColor: '#E6E9EE', borderWidth: StyleSheet.hairlineWidth }]}>
            <Text style={styles.cardTitle}>Comments</Text>
            <View>
              {comments.map((c) => (
                <View key={c.id} style={styles.commentRow}>
                  {c.raterProfile?.avatarUrl ? <Image source={{ uri: c.raterProfile.avatarUrl }} style={styles.commentAvatar} /> : <View style={styles.commentAvatarPlaceholder}><UserIcon size={20} color={theme.colors.muted} /></View>}
                  <View style={styles.commentBody}>
                    <Text style={styles.commentName}>{c.raterProfile?.fullName || c.raterProfile?.displayName || c.raterProfile?.name || 'Rider'}</Text>
                    <Text style={styles.commentText} numberOfLines={3}>&ldquo;<Text style={{ fontStyle: 'italic' }}>{c.comment}</Text>&rdquo;</Text>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 84, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerText: { marginLeft: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 13, color: '#6B7280' },
  subheader: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  content: { padding: 16 },
  profileCardRounded: { marginBottom: 12, padding: 14, borderRadius: 12, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  profileHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  avatarWrapLarge: { marginRight: 12 },
  avatarImgLarge: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholderLarge: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  profileInfoCol: { flex: 1 },
  nameLarge: { fontSize: 20, fontWeight: '600', marginBottom: 5 },
  nameRatingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 0 },
  ratingStack: { flexDirection: 'column' },
  ratingRowTop: { flexDirection: 'row', alignItems: 'center' },
  avgRatingText: { marginLeft: 8, fontSize: 16, fontWeight: '700', color: '#111827' },
  rideCountTextSmall: { marginLeft: 8, color: '#6B7280' },
  callWrapRight: { marginLeft: 12, justifyContent: 'center' },
  callBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginTop: -30 },
  callBtnDisabled: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', opacity: 0.6 },
  card: { marginBottom: 12, borderRadius: 12, padding: 12, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 0 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  ratingSummaryContainer: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  ratingLeft: { width: 84, alignItems: 'center', justifyContent: 'center' },
  bigRating: { fontSize: 36, fontWeight: '800', color: '#0F172A' },
  smallText: { color: '#6B7280' },
  ratingHistogram: { flex: 1, paddingLeft: 12 },
  histRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 6 },
  histLabel: { width: 18, color: '#374151' },
  histBarBg: { flex: 1, height: 12, backgroundColor: '#F1F5F9', borderRadius: 6, marginHorizontal: 8 },
  histBarFill: { height: 12, backgroundColor: '#FB923C', borderRadius: 6 },
  histCount: { width: 24, textAlign: 'right', color: '#6B7280' },
  prefRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F1F5F9' },
  prefLabel: { color: '#374151', fontWeight: '600' },
  prefValue: { color: '#6B7280' },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10 },
  commentAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  commentAvatarPlaceholder: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  commentBody: { flex: 1 },
  commentName: { fontWeight: '600' },
  commentText: { color: '#374151', marginTop: 4 },
});
