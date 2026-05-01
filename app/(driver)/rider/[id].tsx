import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { firestore, firebaseAuth } from '@/constants/services';
import { doc, getDoc, query, collection, where, onSnapshot, getDocs } from 'firebase/firestore';
import { Star, Phone, User, Music, Thermometer, MessageCircle, Cigarette, Heart } from 'lucide-react-native';
import { Linking } from 'react-native';
import { theme } from '@/theme';
import { useTheme } from '@/hooks/useTheme';

type Review = {
  id: string;
  reviewerName?: string;
  rating?: number;
  comment?: string;
  createdAt?: any;
};

type CommentItem = Review & { raterId?: string; commenterName?: string; commenterAvatarUrl?: string };

export default function RiderProfilePage() {
  const { id } = useLocalSearchParams();
  const riderId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rider, setRider] = useState<any | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [totalRides, setTotalRides] = useState<number>(0);

  useEffect(() => {
  if (!riderId) return;
    let mounted = true;
    // realtime listener for rideRatings so the RatingsSummary shows live data
    const revQ = query(collection(firestore, 'rideRatings'), where('rateeId', '==', riderId));
    const unsubReviews = onSnapshot(revQ, (snap) => {
      if (!mounted) return;
      const revs: Review[] = snap.docs.map((d) => {
        const data = d.data() as any;
        // normalize rating field (some docs use `stars`)
        return { id: d.id, ...data, rating: typeof data.stars === 'number' ? data.stars : data.rating } as Review;
      });
      setReviews(revs);

      // Build comments: only include docs that have a non-empty comment and were left by drivers
      (async () => {
        try {
          const commented = revs.filter(r => r.comment && String(r.comment).trim().length > 0);
          const getRaterId = (c: any) => c.raterId || c.rater || c.reviewerId || c.reviewer || c.userId || c.authorId || c.uid || c.by || c.createdBy;
          if (commented.length === 0) {
            setComments([]);
            return;
          }

          const raterIds = Array.from(new Set(commented.map(c => getRaterId(c)).filter(Boolean)));

          // Check which raterIds correspond to drivers. Prefer `users` doc flags (role/isDriver)
          // and fall back to presence of a `drivers/{id}` doc. Also prefer `users` doc for name/avatar.
          const driverMap: Record<string, boolean> = {};
          const profileMap: Record<string, { name?: string; avatarUrl?: string }> = {};

          await Promise.all(raterIds.map(async (rid) => {
            try {
              // First, attempt to read the users doc and look for driver flags
              const udoc = await getDoc(doc(firestore, 'riders', rid));
              if (udoc.exists()) {
                const u = udoc.data() as any;
                const isDriver = (u?.role === 'driver') || (u?.isDriver === true) || (u?.type === 'driver');
                if (isDriver) {
                  driverMap[rid] = true;
                }
                // capture name/avatar from users doc if present
                const avatar = u?.avatarUrl || u?.avatarURL || u?.photoURL || u?.photoUrl || u?.profilePhoto || u?.profilePic || u?.picture || u?.avatar;
                const uname = u?.name || u?.displayName || u?.fullName || (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}`.trim() : null) || (u?.firstName ? u.firstName : null);
                if (avatar || uname) profileMap[rid] = { name: uname, avatarUrl: avatar };
              }

              // If we didn't already mark as driver, check drivers collection presence
              if (!driverMap[rid]) {
                try {
                  const ddoc = await getDoc(doc(firestore, 'drivers', rid));
                  if (ddoc.exists()) {
                    driverMap[rid] = true;
                    const dv = ddoc.data() as any;
                    // prefer users name/avatar, but fallback to drivers doc if missing
                    // Drivers collection commonly stores `fullName` and may have `avatarUrl1`
                    const avatar2 = dv?.avatarUrl1 || dv?.avatarUrl || dv?.photoURL || dv?.profilePhoto || dv?.photo || dv?.profilePic;
                    const dname = dv?.fullName || dv?.name || dv?.displayName;
                    if (!profileMap[rid]) profileMap[rid] = { name: dname, avatarUrl: avatar2 };
                    else profileMap[rid] = { name: profileMap[rid].name || dname, avatarUrl: profileMap[rid].avatarUrl || avatar2 };
                  }
                } catch (e) {
                  // ignore drivers read failure
                }
              }
            } catch (e) {
              // ignore individual failures
            }
          }));

          const built: CommentItem[] = commented.map((c) => {
            const rid = getRaterId(c as any);
            if (!rid || !driverMap[rid]) return null;
            const p = profileMap[rid] || {};

            // If this rater is the currently authenticated user and we don't yet have name/avatar,
            // use the auth currentUser as a fallback (helps when viewing your own comment).
            try {
              const authUser = (firebaseAuth as any)?.currentUser;
              if (authUser && authUser.uid === rid) {
                if (!p.name && authUser.displayName) p.name = authUser.displayName;
                if (!p.avatarUrl && authUser.photoURL) p.avatarUrl = authUser.photoURL;
              }
            } catch (e) {
              // ignore
            }

            return ({ ...c as any, raterId: rid, commenterName: p.name, commenterAvatarUrl: p.avatarUrl } as CommentItem);
          }).filter(Boolean) as CommentItem[];

          setComments(built);
        } catch (e) {
          // ignore
          setComments([]);
        }
      })();
    }, () => {
      // ignore realtime errors for now
    });

    (async () => {
      try {
        // Primary user profile
        const d = await getDoc(doc(firestore, 'riders', riderId));
        const userData = d.exists() ? (d.data() as any) : null;

        // Try to enrich preferences from a dedicated `riders` collection (preferred source for ride prefs)
        let ridersData: any = null;
        try {
          const rd = await getDoc(doc(firestore, 'riders', riderId));
          if (rd.exists()) ridersData = rd.data();
        } catch (e) {
          // ignore riders read failure
        }

        // Preference fields to prefer from `riders` collection
        const prefFields = ['conversationLevel', 'musicPreference', 'passengerType', 'smokingPreference', 'soundEnvironment'];

        // Start with any existing preferences object on the users doc
        const prefsFromUser = (userData && userData.preferences && typeof userData.preferences === 'object') ? { ...userData.preferences } : {};
        const mergedPrefs: Record<string, any> = { ...prefsFromUser };

        // Overlay fields from riders doc (preferred)
        if (ridersData) {
          prefFields.forEach((f) => {
            if (ridersData[f] !== undefined && ridersData[f] !== null) mergedPrefs[f] = ridersData[f];
          });
        }

        // If still missing some fields, fall back to top-level fields on users doc
        prefFields.forEach((f) => {
          if ((mergedPrefs[f] === undefined || mergedPrefs[f] === null) && userData && userData[f] !== undefined && userData[f] !== null) {
            mergedPrefs[f] = userData[f];
          }
        });

        // Normalize name field from multiple possible sources
        const displayName = userData?.name || userData?.displayName || userData?.fullName || 
          (userData?.firstName && userData?.lastName ? `${userData.firstName} ${userData.lastName}`.trim() : null) ||
          (userData?.firstName ? userData.firstName : null);

        const finalRider = userData ? { 
          ...userData, 
          name: displayName || 'Unknown',
          preferences: Object.keys(mergedPrefs).length ? mergedPrefs : (userData.preferences || null) 
        } : null;

        if (!mounted) return;
        setRider(finalRider);

        // total completed rides for this rider
        const ridesQ = query(collection(firestore, 'confirmedRides'), where('riderId', '==', riderId), where('status', '==', 'COMPLETED'));
        const ridesSnap = await getDocs(ridesQ);
        if (!mounted) return;
        setTotalRides(ridesSnap.size || 0);
      } catch (e) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; unsubReviews(); };
  }, [riderId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const reviewsData = reviews || [];

  // Compute a single source of truth for average rating and total reviews
  const totalReviews = reviewsData.length;
  const computedAverage = totalReviews ? reviewsData.reduce((s, r) => s + (r.rating || 0), 0) / totalReviews : (rider?.rating ?? 0);
  const averageRating = Number((computedAverage || 0).toFixed(1));

  // Histogram counts for stars 5 -> 1
  const histogram = [5, 4, 3, 2, 1].map((star) => reviewsData.filter(r => Math.round(r.rating || 0) === star).length);

  // Top header (fixed) — back button + title. Render this above the ScrollView so it stays stagnant.
  function TopHeader() {
    const appTheme = useTheme();
    return (
      <View style={[styles.header, { backgroundColor: '#F8FAFC' }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        >
          <Text style={{ color: appTheme.colors.secondary, fontSize: 18}}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: appTheme.colors.secondary }]}>Rider details</Text>
          <Text style={styles.headerSubtitle}>View your rider details</Text>
        </View>
      </View>
    );
  }

  // RiderCard (scrollable) — avatar, name, rating, call button. This stays inside the ScrollView.
  function RiderCard({ name, avatarUrl, averageRatingProp, totalRidesProp }: { name?: string; avatarUrl?: string | null; averageRatingProp?: number; totalRidesProp?: number }) {
    return (
      <View style={styles.headerCard}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatar} accessibilityLabel={`${name}'s avatar`} />
        ) : (
          <View style={styles.avatarPlaceholder} accessibilityLabel="No avatar">
            <User size={50} color="#64748B" />
          </View>
        )}
        <View style={{ marginLeft: 12, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{name ?? 'Unknown'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Star size={16} color="#F59E0B" />
              <Text style={styles.ratingText} accessibilityLabel={`Average rating ${averageRatingProp ?? averageRating}`}>{typeof averageRatingProp === 'number' ? averageRatingProp.toFixed(1) : averageRating.toFixed(1)}</Text>
              <Text style={styles.metaText}> • {totalRidesProp ?? totalRides} rides</Text>
            </View>
          </View>

          {rider?.phone ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${rider.phone}`)}
              style={styles.callButton}
              accessibilityLabel={`Call ${name || 'rider'}`}
            >
              <Phone size={18} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  function RatingsSummary({ averageRating: avgProp, totalReviews: totalProp, histogram: histProp }: { averageRating?: number; totalReviews?: number; histogram?: number[] }) {
    const avg = typeof avgProp === 'number' ? avgProp : averageRating;
    const total = typeof totalProp === 'number' ? totalProp : totalReviews;
    const hist = histProp || histogram;

    if (total === 0) {
      return (
        <View style={styles.ratingsSummaryCard} accessibilityLabel="Ratings summary">
          <Text style={styles.noRatingsText}>No ratings yet</Text>
        </View>
      );
    }

    return (
      <View style={styles.ratingsSummaryCard} accessibilityLabel="Ratings summary">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ alignItems: 'center', marginRight: 12 }}>
            <Text style={styles.avgRatingText} accessibilityLabel={`Average rating ${avg}`}>{avg.toFixed(1)}</Text>
            <Text style={styles.reviewsCount}>{total} reviews</Text>
          </View>
          <View style={{ flex: 1 }}>
            {hist.map((count, idx) => {
              const star = 5 - idx;
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <View key={star} style={styles.ratingBarRow} accessibilityLabel={`${star} stars: ${count}`}>
                  <Text style={styles.starLabel}>{star}</Text>
                  <View style={styles.barBackground}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.starCount}>{count}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    );
  }

  function ReviewsList({ data }: { data: Review[] }) {
    if (!data || data.length === 0) {
      return (
        <View style={{ marginTop: 8 }}>
          <View style={styles.reviewRow}><Text style={styles.reviewerName}>Anonymous</Text><Text style={styles.reviewMeta}> • —</Text></View>
        </View>
      );
    }

    return (
      <View>
        {data.map((item) => (
          <View key={item.id} style={styles.reviewRow} accessibilityLabel={`Review by ${item.reviewerName ?? 'Anonymous'}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={styles.reviewerName}>{item.reviewerName ?? 'Anonymous'}</Text>
              <Text style={styles.reviewMeta}> • {item.rating ?? '—'}</Text>
            </View>
            {item.comment ? <Text style={[styles.reviewText, styles.reviewQuote]}>{`"${String(item.comment).trim()}"`}</Text> : null}
          </View>
        ))}
      </View>
    );
  }

  function CommentsList({ data }: { data: CommentItem[] }) {
    if (!data || data.length === 0) return null;

    return (
      <View>
        {data.map((c) => (
          <View key={c.id} style={styles.reviewRow} accessibilityLabel={`Comment by ${c.commenterName ?? 'Driver'}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {c.commenterAvatarUrl ? (
                <Image source={{ uri: c.commenterAvatarUrl }} style={{ width: 36, height: 36, borderRadius: 18, marginRight: 12 }} />
              ) : (
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', marginRight: 12, justifyContent: 'center', alignItems: 'center' }}>
                  <User size={18} color="#64748B" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewerName}>{c.commenterName ?? 'Driver'}</Text>
                <Text style={[styles.reviewText, styles.reviewQuote]}>{`"${String(c.comment).trim()}"`}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  }

  // List header should render RiderCard then RatingsSummary then Preferences (RiderCard is scrollable)
  const ListHeader = () => (
    <View>
      <RiderCard name={rider?.name} avatarUrl={rider?.avatarUrl} averageRatingProp={rider?.rating} totalRidesProp={totalRides} />
      {/* Small subtitle above ratings summary */}
      <View style={{ marginTop: 8, marginBottom: 6 }}>
        <Text style={styles.ratingsSubtitle}>Ratings summary</Text>
      </View>
      <RatingsSummary averageRating={averageRating} totalReviews={totalReviews} histogram={histogram} />
      {/* Preferences Section */}
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionTitle}>Ride Preferences</Text>
        {rider?.preferences ? (
          <View style={styles.preferencesContainer}>
            {/* Render preferences in a predictable order with label left and value right */}
            {(() => {
              const prefs = rider.preferences || {};
              const order = ['conversationLevel', 'musicPreference', 'passengerType', 'smokingPreference', 'soundEnvironment', 'allowPets', 'temperaturePreference'];
              const entries: Array<[string, any]> = [];
              order.forEach((k) => {
                if (prefs[k] !== undefined && prefs[k] !== null) entries.push([k, prefs[k]]);
              });
              // include any other keys not in the order
              Object.entries(prefs).forEach(([k, v]) => {
                if (!order.includes(k)) entries.push([k, v]);
              });

              const labelFor = (key: string) => {
                switch (key) {
                  case 'musicPreference': return 'Music';
                  case 'temperaturePreference': return 'Temperature';
                  case 'conversationLevel': return 'Conversation';
                  case 'smokingPreference':
                  case 'allowSmoking': return 'Smoking';
                  case 'allowPets': return 'Pets';
                  case 'passengerType': return 'Passenger Type';
                  case 'soundEnvironment': return 'Sound Environment';
                  default: return key;
                }
              };

              const iconFor = (key: string) => {
                switch (key) {
                  case 'musicPreference': return <Music size={16} color="#64748B" />;
                  case 'temperaturePreference': return <Thermometer size={16} color="#64748B" />;
                  case 'conversationLevel': return <MessageCircle size={16} color="#64748B" />;
                  case 'smokingPreference':
                  case 'allowSmoking': return <Cigarette size={16} color="#64748B" />;
                  case 'allowPets': return <Heart size={16} color="#64748B" />;
                  case 'passengerType': return <User size={16} color="#64748B" />;
                  case 'soundEnvironment': return <Music size={16} color="#64748B" />;
                  default: return null;
                }
              };

              const formatValue = (v: any) => {
                if (typeof v === 'boolean') return v ? 'Yes' : 'No';
                if (v === null || v === undefined) return '—';
                return String(v);
              };

              return entries.map(([key, value]) => (
                <View key={key} style={styles.preferenceItem}>
                  <View style={styles.preferenceIcon}>{iconFor(key)}</View>
                  <View style={styles.preferenceRow}>
                    <Text style={styles.preferenceLabel}>{labelFor(key)}</Text>
                    <Text style={styles.preferenceValueRight}>{formatValue(value)}</Text>
                  </View>
                </View>
              ));
            })()}
          </View>
        ) : (
          <Text style={styles.noPreferences}>No preferences specified</Text>
        )}
      </View>
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
      <TopHeader />
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: 12 }]} showsVerticalScrollIndicator={false}>
        {/* Scrollable content: rider card, ratings, preferences */}
        <ListHeader />

        {/* Comments header + list (only drivers' comments) */}
        {comments.length > 0 && (
          <>
            <View style={{ marginTop: 12, marginBottom: 8 }}>
              <Text style={styles.reviewsHeader}>Comments</Text>
            </View>
            <CommentsList data={comments} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 40, paddingHorizontal: 16, paddingBottom: 40, backgroundColor: '#F8FAFC' },
  pageHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  backBtn: { padding: 8 },
  backText: { fontSize: 20, color: '#0B1220' },
  // ...existing code...
  backButton: {
    marginTop: 50,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    marginTop: 50,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 16 },
  headerLargeTitle: { fontSize: 28, fontWeight: 'bold', marginBottom: 4 },
  headerSubtitle: { fontSize: 16, color: '#64748B' },
  headerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#EEF2F7', marginBottom: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarPlaceholder: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  name: { fontSize: 20, fontWeight: '700', color: '#0B1220' },
  ratingText: { marginLeft: 8, fontWeight: '600', color: '#0B1220' },
  metaText: { marginLeft: 6, color: '#64748B' },
  sectionBlock: { marginTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0B1220', marginBottom: 8 },
  preferencesContainer: { gap: 8 },
  preferenceItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#EEF2F7', marginBottom: 8 },
  preferenceIcon: { width: 36, alignItems: 'center' },
  pIcon: { fontSize: 16 },
  preferenceContent: { flex: 1 },
  preferenceLabel: { fontSize: 14, fontWeight: '600', color: '#0B1220' },
  preferenceValue: { fontSize: 14, color: '#64748B' },
  preferenceRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preferenceValueRight: { fontSize: 14, color: '#64748B', textAlign: 'right' },
  noPreferences: { color: '#64748B', fontStyle: 'italic' },
  ratingsSummaryCard: { backgroundColor: '#FFFFFF', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#EEF2F7', marginBottom: 12 },
  avgRatingText: { fontSize: 28, fontWeight: '700', color: '#0B1220' },
  reviewsCount: { fontSize: 12, color: '#64748B' },
  noRatingsText: { color: '#64748B', fontStyle: 'italic', padding: 8 },
  ratingsSubtitle: { marginTop: 16, fontSize: 16, fontWeight: '700', color: '#0B1220' },
  ratingBarRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  starLabel: { width: 18, fontSize: 12, color: '#0B1220' },
  barBackground: { flex: 1, height: 8, backgroundColor: '#F1F5F9', borderRadius: 8, marginHorizontal: 8 },
  barFill: { height: 8, backgroundColor: '#F97316', borderRadius: 8 },
  starCount: { width: 28, textAlign: 'right', fontSize: 12, color: '#64748B' },
  callButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0B1220', alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  reviewRow: { marginTop: 12, backgroundColor: '#FFFFFF', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#EEF2F7' },
  reviewerName: { fontWeight: '700', color: '#0B1220' },
  reviewMeta: { marginLeft: 6, color: '#64748B' },
  reviewText: { marginTop: 6, color: '#334155' },
  reviewsHeader: { marginTop: 16, fontSize: 16, fontWeight: '700', color: '#0B1220' },
  reviewQuote: { fontStyle: 'italic', color: '#475569' },
});
