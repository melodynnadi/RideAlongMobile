import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { onAuthStateChanged } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, getCountFromServer,
  limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { computeFilteredAverageRating } from '@/src/services/ratings';

import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';

export type HistoryItem = {
  id: string;
  date?: string;
  time?: string;
  from?: string;
  to?: string;
  rider?: string;
  riderId?: string;
  riderEmail?: string;
  riderAvatarUrl?: string;
  rating?: number;
  price?: number;
  status?: string;
  duration?: string;
  ridePostingId?: string;
  seatCount?: number;
};

export default function RideHistoryScreen() {
  const { colors } = useAppTheme();
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const [items, setItems]       = useState<HistoryItem[]>([]);
  const [totalRides, setTotalRides] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const s = useMemo(() => StyleSheet.create({
    root:    { flex: 1, backgroundColor: colors.bg },
    safe:    { flex: 1 },

    hdr:     { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
    backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    hdrTitle:{ color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    summaryCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, paddingVertical: 15 },
    summaryItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    summaryDivider: { width: 1, height: 34, backgroundColor: colors.border },
    ratingSummary: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statNum:     { color: colors.textPrimary, fontSize: 21, fontWeight: '700', marginBottom: 2 },
    statLabel:   { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },

    listContent: { paddingHorizontal: 20, paddingBottom: 48 },

    card: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      padding: 16,
      marginBottom: 14,
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.05,
      shadowRadius: 10,
      elevation: 1,
    },
    cardTop:   { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 16 },
    statusBadge: { borderRadius: 10, backgroundColor: colors.greenDim, paddingHorizontal: 9, paddingVertical: 4 },
    statusBadgeFlagged: { backgroundColor: colors.redDim },
    statusBadgeText: { color: colors.green, fontSize: 10, fontWeight: '700' },
    statusBadgeTextFlagged: { color: colors.red },
    tripMeta: { flex: 1, color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
    routeBlock: { minHeight: 82, flexDirection: 'row', paddingHorizontal: 2 },
    routeRail: { width: 18, alignItems: 'center', paddingVertical: 5 },
    navyDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary, flexShrink: 0 },
    routeLine: { flex: 1, width: 1, marginVertical: 4, backgroundColor: colors.border },
    orangeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0 },
    routeDetails: { flex: 1, justifyContent: 'space-between', paddingLeft: 8 },
    routeLabel: { color: colors.textSecondary, fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 1 },
    routeText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '600', marginTop: 1 },
    cardPrice: { color: colors.primary, fontSize: 20, fontWeight: '700' },
    cardFooter: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 13, gap: 10 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    avatarImage: { width: 36, height: 36, borderRadius: 18 },
    avatarText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    riderInfo: { flex: 1, minWidth: 0 },
    riderName: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
    riderMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    ratingText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },

    loadingWrap: { alignItems: 'center', paddingTop: 60 },
    emptyCard:   { borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.bgCard, padding: 32, alignItems: 'center', marginTop: 4 },
    emptyIcon:   { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    emptyTitle:  { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 },
    emptyText:   { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  }), [colors]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) { setItems([]); setAvgRating(null); setLoading(false); return; }

      (async () => {
        try { const { avg } = await computeFilteredAverageRating(user.uid); if (typeof avg === 'number' && isFinite(avg)) setAvgRating(avg); } catch {}
      })();

      (async () => {
        try {
          const countSnap = await getCountFromServer(query(collection(firestore, 'confirmedRides'), where('driverId', '==', user.uid), where('status', '==', 'COMPLETED')));
          setTotalRides(countSnap.data().count);
        } catch {}
      })();

      let currentUnsub: (() => void) | null = null;
      const subscribe = (useOrder: boolean) => {
        const base = [collection(firestore, 'confirmedRides'), where('driverId', '==', user.uid), where('status', 'in', ['COMPLETED', 'FLAGGED'])] as any[];
        if (useOrder) base.push(orderBy('completedAt', 'desc'));
        base.push(limit(100));
        currentUnsub = onSnapshot(query.apply(null, base as any), (snap) => {
          const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          const mapped: HistoryItem[] = data.map((r) => {
            const when = getHistoryDateTime(r);
            return {
              id: String(r.id),
              date: when?.toISOString() ?? (r.date || undefined),
              time: r.time || (when ? when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : undefined),
              from: getAddress(r, 'pickup'),
              to: getAddress(r, 'dropoff'),
              rider:
                r.riderName ||
                r.userName ||
                r.requesterName ||
                r.passengerName ||
                r.rider?.name ||
                r.user?.name ||
                'Rider',
              riderId: r.riderId || r.userId || r.requesterId || r.riderUID || r.passengerId || r.rider?.id || r.user?.id,
              riderEmail: r.riderEmail || r.userEmail || r.requesterEmail || r.passengerEmail,
              riderAvatarUrl:
                r.riderAvatarUrl ||
                r.userAvatarUrl ||
                r.passengerAvatarUrl ||
                r.profilePicture ||
                r.photoURL ||
                r.rider?.avatarUrl ||
                r.rider?.photoURL ||
                r.user?.avatarUrl ||
                r.user?.photoURL ||
                undefined,
              rating: undefined,
              price: getContributionNumber(r) ?? 0,
              status: r.status,
              duration: getDurationText(r),
              ridePostingId: r.ridePostingId || r.originalRidePosting?.id || undefined,
            };
          });
          if (!useOrder) mapped.sort((a, b) => (a.date ? Date.parse(a.date) : 0) < (b.date ? Date.parse(b.date) : 0) ? 1 : -1);

          (async () => {
            try {
              const uidStr = String(user.uid);
              const profileCache = new Map<string, Promise<any | null>>();
              const loadRiderProfile = (it: HistoryItem) => {
                const cacheKey = it.riderId || it.riderEmail || it.id;
                if (profileCache.has(cacheKey)) return profileCache.get(cacheKey)!;
                const request = (async () => {
                  let profileSnap = it.riderId
                    ? await getDoc(doc(firestore, 'riders', String(it.riderId))).catch(() => null)
                    : null;
                  if ((!profileSnap || !profileSnap.exists()) && it.riderId) {
                    profileSnap = await getDoc(doc(firestore, 'users', String(it.riderId))).catch(() => null);
                  }
                  if ((!profileSnap || !profileSnap.exists()) && it.riderEmail) {
                    const emailSnap = await getDocs(query(
                      collection(firestore, 'riders'),
                      where('email', '==', it.riderEmail),
                      limit(1),
                    )).catch(() => null);
                    profileSnap = emailSnap?.docs[0] || null;
                    if (!profileSnap) {
                      const nestedEmailSnap = await getDocs(query(
                        collection(firestore, 'riders'),
                        where('personalInfo.email', '==', it.riderEmail),
                        limit(1),
                      )).catch(() => null);
                      profileSnap = nestedEmailSnap?.docs[0] || null;
                    }
                  }
                  return profileSnap?.exists() ? profileSnap.data() : null;
                })();
                profileCache.set(cacheKey, request);
                return request;
              };

              const enriched = await Promise.all(mapped.map(async (it) => {
                const profile = await loadRiderProfile(it).catch(() => null);
                const profileName =
                  profile?.fullName ||
                  profile?.name ||
                  profile?.displayName ||
                  [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
                  profile?.personalInfo?.fullName ||
                  [profile?.personalInfo?.firstName, profile?.personalInfo?.lastName].filter(Boolean).join(' ').trim();
                const profileAvatar =
                  profile?.avatarUrl ||
                  profile?.avatarURL ||
                  profile?.photoURL ||
                  profile?.photoUrl ||
                  profile?.profilePicture ||
                  profile?.profileImageUrl ||
                  profile?.personalInfo?.avatarUrl ||
                  profile?.personalInfo?.photoURL;

                let stars: number | undefined;
                if (it.riderId) {
                  try {
                    const rd = await getDoc(doc(firestore, 'rideRatings', `${it.id}_${it.riderId}`));
                    if (rd.exists()) { const d: any = rd.data(); if (String(d.rateeId) === uidStr && typeof d.stars === 'number') stars = d.stars; }
                  } catch {}
                }
                if (stars === undefined) {
                  try {
                    const qs = await getDocs(query(collection(firestore, 'rideRatings'), where('rideId', '==', it.id), where('rateeId', '==', uidStr), limit(1)));
                    const docu = qs.docs[0];
                    if (docu) { const d: any = docu.data(); if (typeof d.stars === 'number') stars = d.stars; }
                  } catch {}
                }
                return {
                  ...it,
                  rider: profileName || it.rider || 'Rider',
                  riderAvatarUrl: profileAvatar || it.riderAvatarUrl,
                  rating: typeof stars === 'number' ? stars : undefined,
                } as HistoryItem;
              }));
              const byPosting = new Map<string, HistoryItem[]>();
              enriched.forEach((it) => { const key = it.ridePostingId || it.id; const arr = byPosting.get(key) || []; arr.push(it); byPosting.set(key, arr); });
              const grouped: HistoryItem[] = [];
              byPosting.forEach((arr) => {
                if (arr.length === 1) { grouped.push(arr[0]); return; }
                const sorted = [...arr].sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0));
                const latest = sorted[0];
                grouped.push({
                  ...latest,
                  id: arr[0].ridePostingId || arr[0].id,
                  rider: arr.map(r => r.rider).filter(Boolean).slice(0, 3).join(', '),
                  price: arr.reduce((s, r) => s + (r.price || 0), 0),
                  rating: (() => { const rs = arr.map(r => r.rating).filter(r => typeof r === 'number') as number[]; return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : undefined; })(),
                  seatCount: arr.length,
                });
              });
              grouped.sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0));
              setItems(grouped);
            } catch { setItems(mapped); }
          })();
          setLoading(false);
        }, (err) => {
          if (String(err?.code) === 'failed-precondition' && useOrder) { if (currentUnsub) currentUnsub(); subscribe(false); }
          else if (useOrder) { if (currentUnsub) currentUnsub(); subscribe(false); }
          else setLoading(false);
        });
      };
      subscribe(true);
      return () => { if (currentUnsub) currentUnsub(); };
    });
    return () => unsubAuth();
  }, []);

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderItem = ({ item }: { item: HistoryItem }) => {
    const isFlagged = String(item.status || '').toUpperCase() === 'FLAGGED';
    const stars = Math.round(item.rating || 0);
    const shortFrom = (item.from || '').split(',')[0]?.trim() || 'Pickup';
    const shortTo = (item.to || '').split(',')[0]?.trim() || 'Dropoff';
    const riderName = item.rider || 'Rider';
    const initials = riderName.split(/[ ,]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    const tripMeta = [formatDate(item.date), item.time, item.duration].filter(Boolean).join(' - ');

    return (
      <View style={s.card}>
        <View style={s.cardTop}>
          <View style={[s.statusBadge, isFlagged && s.statusBadgeFlagged]}>
            <Text style={[s.statusBadgeText, isFlagged && s.statusBadgeTextFlagged]}>{isFlagged ? 'Flagged' : 'Completed'}</Text>
          </View>
          <Text style={s.tripMeta} numberOfLines={1}>{tripMeta || 'Completed ride'}</Text>
          {Number(item.price || 0) > 0 ? <Text style={s.cardPrice}>${Number(item.price).toFixed(0)}</Text> : null}
        </View>

        <View style={s.routeBlock}>
          <View style={s.routeRail}>
            <View style={s.navyDot} />
            <View style={s.routeLine} />
            <View style={s.orangeDot} />
          </View>
          <View style={s.routeDetails}>
            <View><Text style={s.routeLabel}>PICKUP</Text><Text style={s.routeText} numberOfLines={1}>{shortFrom}</Text></View>
            <View><Text style={s.routeLabel}>DROPOFF</Text><Text style={s.routeText} numberOfLines={1}>{shortTo}</Text></View>
          </View>
        </View>

        <View style={s.cardFooter}>
          <View style={s.avatar}>
            {item.riderAvatarUrl ? (
              <Image source={{ uri: item.riderAvatarUrl }} style={s.avatarImage} contentFit="cover" />
            ) : (
              <Text style={s.avatarText}>{initials || 'R'}</Text>
            )}
          </View>
          <View style={s.riderInfo}>
            <Text style={s.riderName} numberOfLines={1}>{riderName}</Text>
            <Text style={s.riderMeta}>{item.seatCount && item.seatCount > 1 ? `${item.seatCount} riders` : '1 rider'}</Text>
          </View>
          {stars > 0 ? <View style={s.rating}><Ionicons name="star" size={14} color={colors.amber} /><Text style={s.ratingText}>{item.rating?.toFixed(1)}</Text></View> : null}
        </View>
      </View>
    );
  };
  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <FlatList
          ListHeaderComponent={
            <>
              {/* Header */}
        <View style={s.hdr}>
          <TouchableOpacity style={s.backBtn} onPress={goBack}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.hdrTitle}>Ride history</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={s.summaryCard}>
          <View style={s.summaryItem}>
            <Text style={s.statNum}>{totalRides}</Text>
            <Text style={s.statLabel}>Completed rides</Text>
          </View>
          <View style={s.summaryDivider} />
          <View style={s.summaryItem}>
            <View style={s.ratingSummary}><Ionicons name="star" size={17} color={colors.amber} /><Text style={s.statNum}>{typeof avgRating === 'number' ? avgRating.toFixed(1) : '-'}</Text></View>
            <Text style={s.statLabel}>Average rating</Text>
          </View>
        </View>
            </>
          }
          ListHeaderComponentStyle={{ marginHorizontal: -20 }}
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            loading ? (
              <View style={s.loadingWrap}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <View style={s.emptyCard}>
                <View style={s.emptyIcon}><Ionicons name="car-outline" size={26} color={colors.primary} /></View>
                <Text style={s.emptyTitle}>No rides yet</Text>
                <Text style={s.emptyText}>Your completed rides will appear here.</Text>
              </View>
            )
          }
        />

      </SafeAreaView>
    </View>
  );
}

// Helpers

function toDateField(v: any): Date | null {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') return v.toDate();
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    return null;
  } catch { return null; }
}

function composeDateTime(dateStr?: any, timeStr?: any): Date | null {
  try {
    if (!dateStr && !timeStr) return null;
    if (dateStr && timeStr && typeof dateStr === 'string' && typeof timeStr === 'string') {
      const d = new Date(`${dateStr}T${timeStr}`);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof dateStr === 'string') { const d = new Date(dateStr); return isNaN(d.getTime()) ? null : d; }
    if (typeof timeStr === 'string') { const d = new Date(timeStr); return isNaN(d.getTime()) ? null : d; }
    return null;
  } catch { return null; }
}

function getHistoryDateTime(cr: any): Date | null {
  return composeDateTime(cr?.date, cr?.time) || toDateField(cr?.completedAt || cr?.confirmedAt || cr?.createdAt);
}

function getAddress(r: any, kind: 'pickup' | 'dropoff'): string | undefined {
  const loc = kind === 'pickup' ? (r?.pickup || r?.pickupLocation || r?.from) : (r?.dropoff || r?.dropoffLocation || r?.to);
  if (typeof loc === 'string') return loc;
  if (loc?.address) return String(loc.address);
  const addr = kind === 'pickup' ? (r?.pickupAddress || r?.fromAddress) : (r?.dropoffAddress || r?.toAddress);
  if (typeof addr === 'string') return addr;
  return undefined;
}

function parseCurrency(v: any): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const num = Number(v.replace(/[^0-9.\-]/g, '')); return isNaN(num) ? undefined : num; }
  return undefined;
}

function getContributionNumber(cr: any): number | undefined {
  const v = cr?.contributionAmount ?? cr?.price;
  return typeof v === 'number' ? v : typeof v === 'string' ? parseCurrency(v) : undefined;
}

function getDurationText(r: any): string | undefined {
  try {
    const d = r?.duration;
    if (typeof d?.text === 'string' && d.text.trim()) return normalizeDurationString(d.text.trim());
    if (typeof d === 'string') return normalizeDurationString(d);
    if (typeof d === 'number') { const mins = Math.round(d); if (mins < 60) return `${mins} min`; const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h} hr ${m} min` : `${h} hr`; }
    const seconds = r?.durationSeconds ?? r?.duration_secs ?? r?.durationSec;
    if (typeof seconds === 'number') { const mins = Math.round(seconds / 60); if (mins < 60) return `${mins} min`; const h = Math.floor(mins / 60); const m = mins % 60; return m > 0 ? `${h} hr ${m} min` : `${h} hr`; }
    return undefined;
  } catch { return undefined; }
}

function normalizeDurationString(s: string): string {
  try {
    const lower = s.toLowerCase();
    if (/^\d+\s*hr(\s+\d+\s*min)?$/.test(lower) || /^\d+\s*min$/.test(lower)) return s;
    const hMatch = lower.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour|hours)/);
    const mMatch = lower.match(/(\d+(?:\.\d+)?)\s*(m|min|minute|minutes)/);
    let h = hMatch ? parseFloat(hMatch[1]) : 0;
    let m = mMatch ? parseFloat(mMatch[1]) : 0;
    if (!hMatch && !mMatch) { const onlyMin = lower.match(/(\d+(?:\.\d+)?)\s*m/); if (onlyMin) m = parseFloat(onlyMin[1]); }
    if (h && h % 1 !== 0) { const frac = h - Math.floor(h); m += frac * 60; h = Math.floor(h); }
    m = Math.round(m);
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
    if (h > 0 && m > 0) return `${h} hr ${m} min`;
    if (h > 0) return `${h} hr`;
    if (m > 0) return `${m} min`;
    return s;
  } catch { return s; }
}
