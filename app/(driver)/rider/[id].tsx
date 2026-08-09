import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ActivityIndicator,
  TouchableOpacity, ScrollView, Linking, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { firestore, firebaseAuth, storage } from '@/constants/services';
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';

import { useAppTheme } from '@/hooks/ThemeContext';

async function resolveAvatarUrl(raw: string | null | undefined): Promise<string | null> {
  if (!raw || !raw.trim()) return null;
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  const path = url.replace(/^gs:\/\/[^/]+\//, '');
  try {
    return await getDownloadURL(storageRef(storage, path));
  } catch {
    return null;
  }
}

function firstText(...values: any[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function profileNameFrom(data: any): string | undefined {
  const personal = data?.personalInfo || {};
  const profile = data?.profile || {};
  return firstText(
    data?.fullName,
    data?.name,
    data?.displayName,
    profile?.fullName,
    profile?.name,
    profile?.displayName,
    personal?.fullName,
    personal?.name,
    personal?.displayName,
    personal?.firstName && `${personal.firstName} ${personal.lastName || ''}`,
    data?.firstName && `${data.firstName} ${data.lastName || ''}`,
  );
}

function profileAvatarFrom(data: any): string | undefined {
  const personal = data?.personalInfo || {};
  const profile = data?.profile || {};
  return firstText(
    data?.avatarUrl1,
    data?.avatarUrl,
    data?.avatarURL,
    data?.photoURL,
    data?.photoUrl,
    data?.profilePicture,
    data?.profileImageUrl,
    data?.imageUrl,
    data?.picture,
    data?.avatar,
    profile?.avatarUrl1,
    profile?.avatarUrl,
    profile?.photoURL,
    profile?.photoUrl,
    profile?.profilePicture,
    profile?.imageUrl,
    personal?.avatarUrl1,
    personal?.avatarUrl,
    personal?.photoURL,
    personal?.photoUrl,
    personal?.profilePicture,
    personal?.imageUrl,
  );
}


type Review = { id: string; reviewerName?: string; rating?: number; comment?: string; createdAt?: any };
type CommentItem = Review & { raterId?: string; commenterName?: string; commenterAvatarUrl?: string };

async function getCompletedRiderRideIds(riderId: string) {
  const ids = new Set<string>();
  let count = 0;
  const addRide = (id: string, data: any) => {
    count += 1;
    ids.add(id);
    if (data?.rideRequestId) ids.add(String(data.rideRequestId));
    if (data?.ridePostingId) ids.add(String(data.ridePostingId));
    if (data?.ridePostingRequestId) ids.add(String(data.ridePostingRequestId));
  };

  try {
    const snap = await getDocs(query(
      collection(firestore, 'confirmedRides'),
      where('riderId', '==', riderId),
      where('status', 'in', ['COMPLETED', 'completed']),
    ));
    snap.docs.forEach((d) => addRide(d.id, d.data() as any));
  } catch {
    const snap = await getDocs(query(collection(firestore, 'confirmedRides'), where('riderId', '==', riderId)));
    snap.docs.forEach((d) => {
      const data = d.data() as any;
      if (String(data?.status || '').toUpperCase() === 'COMPLETED') addRide(d.id, data);
    });
  }

  return { ids, count };
}

const PREF_ICONS: Record<string, string> = {
  musicPreference:       'musical-notes-outline',
  soundEnvironment:      'musical-notes-outline',
  temperaturePreference: 'thermometer-outline',
  conversationLevel:     'chatbubble-outline',
  smokingPreference:     'ban-outline',
  allowSmoking:          'ban-outline',
  allowPets:             'paw-outline',
  passengerType:         'person-outline',
};

const PREF_LABELS: Record<string, string> = {
  musicPreference:       'Music',
  soundEnvironment:      'Sound',
  temperaturePreference: 'Temperature',
  conversationLevel:     'Conversation',
  smokingPreference:     'Smoking',
  allowSmoking:          'Smoking',
  allowPets:             'Pets',
  passengerType:         'Passenger type',
};

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Ionicons
          key={s}
          name={rating >= s ? 'star' : rating >= s - 0.5 ? 'star-half' : 'star-outline'}
          size={size}
          color={colors.amber}
        />
      ))}
    </View>
  );
}

function InitialsAvatar({ name, size = 72 }: { name: string; size?: number }) {
  const { colors } = useAppTheme();
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.border }}>
      <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: size * 0.36 }}>{initials || '?'}</Text>
    </View>
  );
}

export default function RiderProfilePage() {
  const { colors } = useAppTheme();
  const s = useMemo(() => StyleSheet.create({
    root:        { flex: 1, backgroundColor: colors.bg },
    safe:        { flex: 1 },
    scroll:      { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 40 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    pageHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
    backBtn: {
      width: 40, height: 40, borderRadius: 20,
      borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.bgCard,
      alignItems: 'center', justifyContent: 'center',
    },
    pageTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    heroWrap:       { alignItems: 'center', paddingVertical: 8, marginBottom: 16 },
    heroAvatarWrap: { position: 'relative', marginBottom: 14 },
    heroAvatar:     { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: colors.border },
    avatarFallback: { backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.border },
    avatarInitials: { color: colors.textPrimary, fontWeight: '700' },
    ratingBadge: {
      position: 'absolute', bottom: -4, right: -4,
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: colors.textPrimary, borderRadius: 12,
      paddingHorizontal: 7, paddingVertical: 3,
      borderWidth: 2, borderColor: colors.bg,
    },
    ratingBadgeText: { color: colors.textInverse, fontSize: 11, fontWeight: '700' },
    heroName:  { color: colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center', marginBottom: 4 },
    heroEmail: { color: colors.textSecondary, fontSize: 13, marginBottom: 18, textAlign: 'center' },
    statsRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    statPill:  { alignItems: 'center', paddingHorizontal: 20 },
    statValue: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', lineHeight: 24 },
    statLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 },
    statDivider: { width: 1, height: 32, backgroundColor: colors.border },
    callRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: colors.primaryDim, borderRadius: 20,
      paddingHorizontal: 16, paddingVertical: 8,
    },
    callText: { color: colors.primary, fontSize: 14, fontWeight: '600' },

    sectionLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },

    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 20,
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 1,
    },

    ratingsLayout:  { flexDirection: 'row', alignItems: 'center', gap: 20 },
    bigRatingBlock: { alignItems: 'center', minWidth: 64 },
    bigRatingNum:   { color: colors.textPrimary, fontSize: 40, fontWeight: '800', lineHeight: 44 },
    bigRatingSub:   { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 4 },
    histogramBlock: { flex: 1 },
    barRow:    { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
    barLabel:  { width: 12, fontSize: 11, color: colors.textPrimary, fontWeight: '700', textAlign: 'right', marginRight: 2 },
    barTrack:  { flex: 1, height: 6, backgroundColor: colors.border, borderRadius: 3, marginHorizontal: 6 },
    barFill:   { height: 6, backgroundColor: colors.primary, borderRadius: 3 },
    barCount:  { width: 20, textAlign: 'right', fontSize: 11, color: colors.textSecondary, fontWeight: '600' },

    prefRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
    prefBorder:  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    prefIconWrap: {
      width: 32, height: 32, borderRadius: 10,
      backgroundColor: colors.primaryDim,
      alignItems: 'center', justifyContent: 'center',
    },
    prefLabel: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
    prefValue: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },

    commentRow:            { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
    commentBorder:         { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    commentAvatar:         { width: 38, height: 38, borderRadius: 19, flexShrink: 0 },
    commentAvatarFallback: { backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
    commentInitials:       { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
    commentName:           { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 4 },
    commentText:           { color: colors.textSecondary, fontSize: 13, lineHeight: 19, fontStyle: 'italic' },

    emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
    emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
    emptyText:  { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
  }), [colors]);

  const { id, returnTo } = useLocalSearchParams<{ id?: string; returnTo?: string }>();
  const riderId = Array.isArray(id) ? id[0] : id;
  const goBack = () => {
    const dest = Array.isArray(returnTo) ? returnTo[0] : returnTo;
    // navigate, not replace or dismissTo: dest is a different tab than this
    // screen. replace() can't leave this screen's own navigator context
    // (pushes a duplicate instead), and dismissTo's Stack-only POP_TO action
    // is silently ignored by tab navigators. navigate() is what Expo Router
    // maps to the tab-navigator JUMP_TO action.
    router.navigate((dest || '/(driver)') as any);
  };

  const [loading, setLoading]       = useState(true);
  const [rider, setRider]           = useState<any | null>(null);
  const [reviews, setReviews]       = useState<Review[]>([]);
  const [comments, setComments]     = useState<CommentItem[]>([]);
  const [totalRides, setTotalRides] = useState<number>(0);

  useEffect(() => {
    if (!riderId) return;
    let mounted = true;
    // Track both fetches — only hide spinner when both complete
    let profileDone = false;
    let ratingsDone = false;
    const tryFinish = () => { if (profileDone && ratingsDone && mounted) setLoading(false); };

    // Use backend endpoint — admin SDK bypasses Firestore rules that block
    // a viewing driver from querying another rider's confirmedRides.
    const riderRideIds = new Set<string>();
    (async () => {
      try {
        const { getApiBaseUrl } = await import('@/constants/services');
        const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
        const resp = await fetch(`${getApiBaseUrl()}/api/riders/${encodeURIComponent(riderId)}/public-profile`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.ok) {
          const { totalRides: count, ratings } = await resp.json() as { totalRides: number; ratings: any[] };
          if (!mounted) return;
          setTotalRides(count || 0);
          ratings.forEach((r: any) => riderRideIds.add(String(r.rideId || '')));
          const revs: Review[] = ratings.map((r: any) => ({
            id: r.id, ...r, rating: typeof r.stars === 'number' ? r.stars : r.rating,
          }));
          setReviews(revs);

      (async () => {
        try {
          const commented  = revs.filter(r => r.comment && String(r.comment).trim().length > 0);
          const getRaterId = (c: any) => c.raterId || c.rater || c.reviewerId || c.reviewer || c.reviewerUid || c.driverId || c.driverUid || c.userId || c.authorId || c.uid || c.by || c.createdBy || c.ratedBy || c.fromUserId || c.fromId;
          if (commented.length === 0) { setComments([]); return; }

          const raterIds   = Array.from(new Set(commented.map(c => getRaterId(c)).filter(Boolean)));
          const driverMap: Record<string, boolean> = {};
          const profileMap: Record<string, { name?: string; avatarUrl?: string }> = {};

          await Promise.all(raterIds.map(async (rid) => {
            try {
              const [ddoc, udoc] = await Promise.all([
                getDoc(doc(firestore, 'drivers', rid)),
                getDoc(doc(firestore, 'riders', rid)),
              ]);
              let rawAvatar: string | null | undefined;
              let name: string | undefined;
              if (ddoc.exists()) {
                driverMap[rid] = true;
                const dv = ddoc.data() as any;
                rawAvatar = profileAvatarFrom(dv);
                name = profileNameFrom(dv);
              }
              if (udoc.exists()) {
                const u = udoc.data() as any;
                if (u?.role === 'driver' || u?.isDriver === true || u?.type === 'driver') driverMap[rid] = true;
                rawAvatar = rawAvatar || profileAvatarFrom(u);
                name = name || profileNameFrom(u);
              }
              const avatarUrl = await resolveAvatarUrl(rawAvatar);
              profileMap[rid] = { name, avatarUrl: avatarUrl || undefined };
            } catch {}
          }));

          const built = (await Promise.all(commented.map(async (c) => {
            const rid = getRaterId(c as any);
            if (!rid || !driverMap[rid]) return null;
            const p: any = profileMap[rid] || {};
            const embeddedName = firstText(
              (c as any).driverName,
              (c as any).reviewerName,
              (c as any).raterName,
              (c as any).authorName,
              (c as any).userName,
            );
            const embeddedAvatar = firstText(
              (c as any).driverAvatarUrl,
              (c as any).driverPhotoURL,
              (c as any).reviewerAvatarUrl,
              (c as any).reviewerPhotoURL,
              (c as any).raterAvatarUrl,
              (c as any).userAvatarUrl,
              (c as any).avatarUrl,
              (c as any).photoURL,
              (c as any).profilePicture,
            );
            try {
              const authUser = (firebaseAuth as any)?.currentUser;
              if (authUser && authUser.uid === rid) {
                if (!p.name && authUser.displayName) p.name = authUser.displayName;
                if (!p.avatarUrl && authUser.photoURL) p.avatarUrl = authUser.photoURL;
              }
            } catch {}
            const resolvedEmbeddedAvatar = p.avatarUrl ? undefined : await resolveAvatarUrl(embeddedAvatar);
            return { ...c as any, raterId: rid, commenterName: p.name || embeddedName, commenterAvatarUrl: p.avatarUrl || resolvedEmbeddedAvatar || embeddedAvatar } as CommentItem;
          }))).filter(Boolean) as CommentItem[];

          setComments(built);
        } catch { setComments([]); }
      })();
        }
      } catch { setTotalRides(0); setReviews([]); }
      finally { ratingsDone = true; tryFinish(); }
    })(); // close outer async IIFE

    (async () => {
      try {
        const d = await getDoc(doc(firestore, 'riders', riderId));
        const userData = d.exists() ? (d.data() as any) : null;

        const prefFields = ['conversationLevel', 'musicPreference', 'passengerType', 'smokingPreference', 'soundEnvironment'];
        const prefsFromUser = (userData?.preferences && typeof userData.preferences === 'object') ? { ...userData.preferences } : {};
        const mergedPrefs: Record<string, any> = { ...prefsFromUser };
        prefFields.forEach(f => { if (userData?.[f] != null) mergedPrefs[f] = userData[f]; });

        const displayName = userData?.name || userData?.displayName || userData?.fullName ||
          (userData?.firstName && userData?.lastName ? `${userData.firstName} ${userData.lastName}`.trim() : null) || userData?.firstName;
        const finalRider = userData
          ? { ...userData, name: displayName || 'Unknown', preferences: Object.keys(mergedPrefs).length ? mergedPrefs : (userData.preferences || null) }
          : null;

        if (!mounted) return;
        setRider(finalRider);
      } catch {}
      finally { profileDone = true; tryFinish(); }
    })();

    return () => { mounted = false; };
  }, [riderId]);

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle={colors.statusBar} />
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <View style={s.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const totalReviews  = reviews.length;
  const computedAvg   = totalReviews
    ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews
    : (rider?.rating ?? 0);
  const averageRating = Number((computedAvg || 0).toFixed(1));
  const histogram     = [5, 4, 3, 2, 1].map(star => reviews.filter(r => Math.round(r.rating || 0) === star).length);

  const prefOrder  = ['conversationLevel', 'musicPreference', 'passengerType', 'smokingPreference', 'soundEnvironment', 'allowPets', 'temperaturePreference'];
  const prefEntries: [string, any][] = [];
  if (rider?.preferences) {
    prefOrder.forEach(k => { if (rider.preferences[k] != null) prefEntries.push([k, rider.preferences[k]]); });
    Object.entries(rider.preferences).forEach(([k, v]) => { if (!prefOrder.includes(k)) prefEntries.push([k, v]); });
  }

  const riderName = rider?.name ?? 'Unknown';

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

          {/* ── Header ── */}
          <View style={s.pageHeader}>
            <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.75}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={s.pageTitle}>Rider Profile</Text>
          </View>

          {/* ── Hero ── */}
          <View style={s.heroWrap}>
            <View style={s.heroAvatarWrap}>
              {rider?.avatarUrl ? (
                <Image source={{ uri: rider.avatarUrl }} style={s.heroAvatar} />
              ) : (
                <InitialsAvatar name={riderName} size={88} />
              )}
              {totalReviews > 0 && (
                <View style={s.ratingBadge}>
                  <Ionicons name="star" size={11} color={colors.amber} />
                  <Text style={s.ratingBadgeText}>{averageRating.toFixed(1)}</Text>
                </View>
              )}
            </View>

            <Text style={s.heroName}>{riderName}</Text>
            {rider?.email ? <Text style={s.heroEmail}>{rider.email}</Text> : null}

            <View style={s.statsRow}>
              <View style={s.statPill}>
                <Text style={s.statValue}>{totalRides}</Text>
                <Text style={s.statLabel}>rides</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statPill}>
                <Text style={s.statValue}>{totalReviews}</Text>
                <Text style={s.statLabel}>reviews</Text>
              </View>
              {averageRating > 0 && (
                <>
                  <View style={s.statDivider} />
                  <View style={s.statPill}>
                    <Text style={s.statValue}>{averageRating.toFixed(1)}</Text>
                    <Text style={s.statLabel}>avg rating</Text>
                  </View>
                </>
              )}
            </View>

            {rider?.phone ? (
              <TouchableOpacity
                style={s.callRow}
                onPress={() => Linking.openURL(`tel:${rider.phone}`)}
                activeOpacity={0.8}
              >
                <Ionicons name="call-outline" size={16} color={colors.primary} />
                <Text style={s.callText}>{rider.phone}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* ── Ratings breakdown ── */}
          {totalReviews > 0 && (
            <>
              <Text style={s.sectionLabel}>RATINGS</Text>
              <View style={s.card}>
                <View style={s.ratingsLayout}>
                  <View style={s.bigRatingBlock}>
                    <Text style={s.bigRatingNum}>{averageRating.toFixed(1)}</Text>
                    <StarRow rating={averageRating} size={14} />
                    <Text style={s.bigRatingSub}>{totalReviews} {totalReviews === 1 ? 'review' : 'reviews'}</Text>
                  </View>
                  <View style={s.histogramBlock}>
                    {histogram.map((count, idx) => {
                      const star = 5 - idx;
                      const pct  = totalReviews ? (count / totalReviews) * 100 : 0;
                      return (
                        <View key={star} style={s.barRow}>
                          <Text style={s.barLabel}>{star}</Text>
                          <Ionicons name="star" size={10} color={colors.amber} style={{ marginRight: 4 }} />
                          <View style={s.barTrack}>
                            <View style={[s.barFill, { width: `${pct}%` }]} />
                          </View>
                          <Text style={s.barCount}>{count}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            </>
          )}

          {/* ── Ride preferences ── */}
          {prefEntries.length > 0 && (
            <>
              <Text style={s.sectionLabel}>RIDE PREFERENCES</Text>
              <View style={s.card}>
                {prefEntries.map(([key, value], idx) => {
                  const label  = PREF_LABELS[key] || key;
                  const icon   = PREF_ICONS[key] || 'ellipse-outline';
                  const valStr = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '—');
                  return (
                    <View key={key} style={[s.prefRow, idx < prefEntries.length - 1 && s.prefBorder]}>
                      <View style={s.prefIconWrap}>
                        <Ionicons name={icon as any} size={15} color={colors.primary} />
                      </View>
                      <Text style={s.prefLabel}>{label}</Text>
                      <Text style={s.prefValue}>{valStr}</Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Driver comments ── */}
          {comments.length > 0 && (
            <>
              <Text style={s.sectionLabel}>DRIVER COMMENTS</Text>
              <View style={s.card}>
                {comments.map((c, idx) => (
                  <View key={c.id} style={[s.commentRow, idx < comments.length - 1 && s.commentBorder]}>
                    {c.commenterAvatarUrl ? (
                      <Image source={{ uri: c.commenterAvatarUrl }} style={s.commentAvatar} />
                    ) : (
                      <View style={[s.commentAvatar, s.commentAvatarFallback]}>
                        <Text style={s.commentInitials}>
                          {(c.commenterName || 'D').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.commentName}>{c.commenterName ?? 'Driver'}</Text>
                      {c.comment ? (
                        <Text style={s.commentText}>{String(c.comment).trim()}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {totalReviews === 0 && prefEntries.length === 0 && comments.length === 0 && (
            <View style={s.emptyState}>
              <Ionicons name="ribbon-outline" size={48} color={colors.border} />
              <Text style={s.emptyTitle}>New to RideAlong</Text>
              <Text style={s.emptyText}>This rider is just getting started — no ratings or reviews yet.</Text>
            </View>
          )}

          <View style={{ height: 48 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
