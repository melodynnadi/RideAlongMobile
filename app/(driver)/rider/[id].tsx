import React, { useEffect, useState } from 'react';
import {
  View, Text, Image, StyleSheet, ActivityIndicator,
  TouchableOpacity, ScrollView, Linking, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { firestore, firebaseAuth } from '@/constants/services';
import { doc, getDoc, query, collection, where, onSnapshot, getDocs } from 'firebase/firestore';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';

const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';
const CARD   = '#FFFFFF';

type Review = { id: string; reviewerName?: string; rating?: number; comment?: string; createdAt?: any };
type CommentItem = Review & { raterId?: string; commenterName?: string; commenterAvatarUrl?: string };

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
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Ionicons
          key={s}
          name={rating >= s ? 'star' : rating >= s - 0.5 ? 'star-half' : 'star-outline'}
          size={size}
          color="#F59E0B"
        />
      ))}
    </View>
  );
}

function InitialsAvatar({ name, size = 72 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View style={[s.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[s.avatarInitials, { fontSize: size * 0.36 }]}>{initials || '?'}</Text>
    </View>
  );
}

export default function RiderProfilePage() {
  const { goBack } = useReturnNavigation('/(driver)');
  const { id } = useLocalSearchParams();
  const riderId = Array.isArray(id) ? id[0] : id;

  const [loading, setLoading]       = useState(true);
  const [rider, setRider]           = useState<any | null>(null);
  const [reviews, setReviews]       = useState<Review[]>([]);
  const [comments, setComments]     = useState<CommentItem[]>([]);
  const [totalRides, setTotalRides] = useState<number>(0);

  useEffect(() => {
    if (!riderId) return;
    let mounted = true;

    const revQ = query(collection(firestore, 'rideRatings'), where('rateeId', '==', riderId));
    const unsubReviews = onSnapshot(revQ, (snap) => {
      if (!mounted) return;
      const revs: Review[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return { id: d.id, ...data, rating: typeof data.stars === 'number' ? data.stars : data.rating } as Review;
      });
      setReviews(revs);

      (async () => {
        try {
          const commented  = revs.filter(r => r.comment && String(r.comment).trim().length > 0);
          const getRaterId = (c: any) => c.raterId || c.rater || c.reviewerId || c.reviewer || c.userId || c.authorId || c.uid || c.by || c.createdBy;
          if (commented.length === 0) { setComments([]); return; }

          const raterIds   = Array.from(new Set(commented.map(c => getRaterId(c)).filter(Boolean)));
          const driverMap: Record<string, boolean> = {};
          const profileMap: Record<string, { name?: string; avatarUrl?: string }> = {};

          await Promise.all(raterIds.map(async (rid) => {
            try {
              const udoc = await getDoc(doc(firestore, 'riders', rid));
              if (udoc.exists()) {
                const u = udoc.data() as any;
                if (u?.role === 'driver' || u?.isDriver === true || u?.type === 'driver') driverMap[rid] = true;
                const avatar = u?.avatarUrl || u?.avatarURL || u?.photoURL || u?.photoUrl;
                const uname  = u?.name || u?.displayName || u?.fullName || (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}`.trim() : u?.firstName);
                if (avatar || uname) profileMap[rid] = { name: uname, avatarUrl: avatar };
              }
              if (!driverMap[rid]) {
                const ddoc = await getDoc(doc(firestore, 'drivers', rid));
                if (ddoc.exists()) {
                  driverMap[rid] = true;
                  const dv = ddoc.data() as any;
                  const avatar2 = dv?.avatarUrl1 || dv?.avatarUrl || dv?.photoURL;
                  const dname   = dv?.fullName || dv?.name;
                  profileMap[rid] = { name: profileMap[rid]?.name || dname, avatarUrl: profileMap[rid]?.avatarUrl || avatar2 };
                }
              }
            } catch {}
          }));

          const built: CommentItem[] = commented.map((c) => {
            const rid = getRaterId(c as any);
            if (!rid || !driverMap[rid]) return null;
            const p: any = profileMap[rid] || {};
            try {
              const authUser = (firebaseAuth as any)?.currentUser;
              if (authUser && authUser.uid === rid) {
                if (!p.name && authUser.displayName) p.name = authUser.displayName;
                if (!p.avatarUrl && authUser.photoURL) p.avatarUrl = authUser.photoURL;
              }
            } catch {}
            return { ...c as any, raterId: rid, commenterName: p.name, commenterAvatarUrl: p.avatarUrl } as CommentItem;
          }).filter(Boolean) as CommentItem[];

          setComments(built);
        } catch { setComments([]); }
      })();
    }, () => {});

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

        const ridesSnap = await getDocs(
          query(collection(firestore, 'confirmedRides'), where('riderId', '==', riderId), where('status', '==', 'COMPLETED'))
        );
        if (mounted) setTotalRides(ridesSnap.size || 0);
      } catch {}
      finally { if (mounted) setLoading(false); }
    })();

    return () => { mounted = false; unsubReviews(); };
  }, [riderId]);

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="dark-content" />
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <View style={s.loadingWrap}>
            <ActivityIndicator color={ORANGE} size="large" />
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
  const prefEntries: Array<[string, any]> = [];
  if (rider?.preferences) {
    prefOrder.forEach(k => { if (rider.preferences[k] != null) prefEntries.push([k, rider.preferences[k]]); });
    Object.entries(rider.preferences).forEach(([k, v]) => { if (!prefOrder.includes(k)) prefEntries.push([k, v]); });
  }

  const riderName = rider?.name ?? 'Unknown';

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>

          {/* ── Header ── */}
          <View style={s.pageHeader}>
            <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.75}>
              <Ionicons name="chevron-back" size={22} color={NAVY} />
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
                  <Ionicons name="star" size={11} color="#F59E0B" />
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
                <Ionicons name="call-outline" size={16} color={ORANGE} />
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
                          <Ionicons name="star" size={10} color="#F59E0B" style={{ marginRight: 4 }} />
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
                        <Ionicons name={icon as any} size={15} color={ORANGE} />
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
                        <Text style={s.commentText}>"{String(c.comment).trim()}"</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          {totalReviews === 0 && prefEntries.length === 0 && comments.length === 0 && (
            <View style={s.emptyState}>
              <Ionicons name="person-circle-outline" size={48} color={BORDER} />
              <Text style={s.emptyTitle}>No activity yet</Text>
              <Text style={s.emptyText}>This rider hasn't completed any rides or received reviews.</Text>
            </View>
          )}

          <View style={{ height: 48 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  safe:        { flex: 1 },
  scroll:      { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header — matches settings/profile pages
  pageHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center',
  },
  pageTitle: { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

  // Hero
  heroWrap:       { alignItems: 'center', paddingVertical: 8, marginBottom: 16 },
  heroAvatarWrap: { position: 'relative', marginBottom: 14 },
  heroAvatar:     { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: BORDER },
  avatarFallback: { backgroundColor: '#EEE8DF', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: BORDER },
  avatarInitials: { color: NAVY, fontWeight: '700' },
  ratingBadge: {
    position: 'absolute', bottom: -4, right: -4,
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: NAVY, borderRadius: 12,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 2, borderColor: BG,
  },
  ratingBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  heroName:  { color: NAVY, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center', marginBottom: 4 },
  heroEmail: { color: MUTED, fontSize: 13, marginBottom: 18, textAlign: 'center' },
  statsRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  statPill:  { alignItems: 'center', paddingHorizontal: 20 },
  statValue: { color: NAVY, fontSize: 20, fontWeight: '800', lineHeight: 24 },
  statLabel: { color: MUTED, fontSize: 11, fontWeight: '600', marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: BORDER },
  callRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEF0E8', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  callText: { color: ORANGE, fontSize: 14, fontWeight: '600' },

  // Section label
  sectionLabel: { color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },

  // Card wrapper
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    marginBottom: 20,
    shadowColor: NAVY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },

  // Ratings
  ratingsLayout:  { flexDirection: 'row', alignItems: 'center', gap: 20 },
  bigRatingBlock: { alignItems: 'center', minWidth: 64 },
  bigRatingNum:   { color: NAVY, fontSize: 40, fontWeight: '800', lineHeight: 44 },
  bigRatingSub:   { color: MUTED, fontSize: 11, fontWeight: '600', marginTop: 4 },
  histogramBlock: { flex: 1 },
  barRow:    { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
  barLabel:  { width: 12, fontSize: 11, color: NAVY, fontWeight: '700', textAlign: 'right', marginRight: 2 },
  barTrack:  { flex: 1, height: 6, backgroundColor: '#ECDFD0', borderRadius: 3, marginHorizontal: 6 },
  barFill:   { height: 6, backgroundColor: ORANGE, borderRadius: 3 },
  barCount:  { width: 20, textAlign: 'right', fontSize: 11, color: MUTED, fontWeight: '600' },

  // Preferences (plain rows, no card)
  prefRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 12 },
  prefBorder:  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  prefIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: '#FEF0E8',
    alignItems: 'center', justifyContent: 'center',
  },
  prefLabel: { flex: 1, color: NAVY, fontSize: 14, fontWeight: '600' },
  prefValue: { color: MUTED, fontSize: 13, fontWeight: '500' },

  // Comments (plain rows, no card)
  commentRow:            { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  commentBorder:         { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  commentAvatar:         { width: 38, height: 38, borderRadius: 19, flexShrink: 0 },
  commentAvatarFallback: { backgroundColor: '#EEE8DF', alignItems: 'center', justifyContent: 'center' },
  commentInitials:       { color: NAVY, fontSize: 14, fontWeight: '700' },
  commentName:           { color: NAVY, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  commentText:           { color: MUTED, fontSize: 13, lineHeight: 19, fontStyle: 'italic' },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { color: NAVY, fontSize: 16, fontWeight: '700' },
  emptyText:  { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 20, maxWidth: 260 },
});
