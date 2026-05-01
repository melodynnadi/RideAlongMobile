import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Share,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { doc, getDoc, addDoc, collection, serverTimestamp, query, where, getDocs, limit as fsLimit } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { MapPin, ArrowLeft, Share2, Star, User } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';

export default function RequestDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Array.isArray(id) ? id[0] : id;
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<any | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyOffered, setAlreadyOffered] = useState(false);

  const [riderProfile, setRiderProfile] = useState<{ name?: string; rating?: number; avatarUrl?: string | null } | null>(null);

  useEffect(() => {
    if (!requestId) { setNotFound(true); setLoading(false); return; }
    getDoc(doc(firestore, 'rideRequests', requestId))
      .then(async (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as any;
          setRequest(data);
          // Check if driver already offered on this request
          const uid = firebaseAuth.currentUser?.uid;
          if (uid) {
            const q = query(
              collection(firestore, 'rideOffers'),
              where('rideRequestId', '==', requestId),
              where('driverId', '==', uid),
              fsLimit(1)
            );
            const existing = await getDocs(q);
            if (!existing.empty) setAlreadyOffered(true);
          }
          // Fetch the actual rider profile so we show real name/photo/rating
          const rId = data.userId || data.riderId || data.requesterId;
          if (rId) {
            try {
              const uSnap = await getDoc(doc(firestore, 'riders', rId));
              if (uSnap.exists()) {
                const u = uSnap.data() as any;
                const name = u.name || u.displayName || u.fullName ||
                  (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}`.trim() : u.firstName) || null;
                setRiderProfile({
                  name,
                  rating: typeof u.rating === 'number' ? u.rating : (typeof u.avgRating === 'number' ? u.avgRating : undefined),
                  avatarUrl: u.avatarUrl || u.photoURL || u.photoUrl || null,
                });
              } else {
                const rSnap = await getDoc(doc(firestore, 'riders', rId));
                if (rSnap.exists()) {
                  const r = rSnap.data() as any;
                  const name = r.fullName || r.name || null;
                  setRiderProfile({
                    name,
                    rating: typeof r.rating === 'number' ? r.rating : undefined,
                    avatarUrl: r.avatarUrl || null,
                  });
                }
              }
              // Compute rating from rideRatings if not already set
              const ratingsSnap = await getDocs(
                query(collection(firestore, 'rideRatings'), where('rateeId', '==', rId))
              );
              if (!ratingsSnap.empty) {
                const nums = ratingsSnap.docs
                  .map(d => { const r = d.data() as any; return typeof r.stars === 'number' ? r.stars : (typeof r.rating === 'number' ? r.rating : undefined); })
                  .filter((n): n is number => typeof n === 'number');
                if (nums.length > 0) {
                  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
                  setRiderProfile(prev => prev ? { ...prev, rating: avg } : prev);
                }
              }
            } catch {}
          }
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [requestId]);

  const shareRequest = async () => {
    if (!requestId) return;
    const p = new URLSearchParams();
    const n = (riderProfile?.name || request?.userName || request?.riderName || request?.requesterName || '').split(' ')[0];
    if (n) p.set('name', n);
    const from = request?.pickupAddress || request?.pickup || request?.pickupLocation?.address || request?.from || '';
    const to = request?.dropoffAddress || request?.dropoff || request?.dropoffLocation?.address || request?.to || '';
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const qs = p.toString();
    const url = `https://ridealongapp.com/request/${requestId}${qs ? `?${qs}` : ''}`;
    await Share.share({
      message: `There's a ride request on RideAlong! ${url}`,
      url,
    }).catch(() => {});
  };

  const sendOffer = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to make an offer.', [
        { text: 'Sign In', onPress: () => router.push('/(auth)/sign-in') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    if (!request || !requestId) return;
    setSubmitting(true);
    try {
      const price = request.contributionAmount ?? request.estimatedFare ?? request.price ?? null;
      const driverEmail = user.email || null;
      const driverName = user.displayName || (driverEmail ? driverEmail.split('@')[0] : null);

      const pickup = request.pickupAddress || request.pickup || request.pickupLocation?.address || request.from || null;
      const dropoff = request.dropoffAddress || request.dropoff || request.dropoffLocation?.address || request.to || null;

      const payload: any = {
        rideRequestId: requestId,
        driverId: user.uid,
        driverEmail,
        driverName,
        riderId: request.userId || request.riderId || request.requesterId || null,
        riderEmail: request.userEmail || request.riderEmail || request.requesterEmail || null,
        riderName: request.userName || request.riderName || request.requesterName || null,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        offerDate: serverTimestamp(),
        emailSent: false,
        offerPrice: typeof price === 'number' ? price : null,
        rideDetails: {
          pickup,
          destination: dropoff,
          date: request.date || null,
          time: request.time || null,
          passengers: request.seats || request.numPassengers || 1,
          contributionAmount: typeof price === 'number' ? price.toFixed(2) : null,
        },
      };

      await addDoc(collection(firestore, 'rideOffers'), payload);
      setAlreadyOffered(true);
      Alert.alert('Offer sent! 🎉', 'Your offer was sent to the rider. You\'ll be notified if they accept.');
    } catch (e) {
      console.warn('sendOffer error', e);
      Alert.alert('Failed', 'Could not send your offer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={theme.colors.primary} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !request) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/driver')}>
          <ArrowLeft size={22} color="#1E293B" />
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Request not found</Text>
          <Text style={styles.errorSub}>
            This ride request may have already been filled or removed.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => router.replace('/driver/requests')}
          >
            <Text style={styles.browseBtnText}>Browse Requests</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pickup = request.pickupAddress || request.pickup || request.pickupLocation?.address || request.from || '';
  const dropoff = request.dropoffAddress || request.dropoff || request.dropoffLocation?.address || request.to || '';
  const date = request.date || request.departureDate || '';
  const time = request.time || request.departureTime || '';
  const seats = request.seats || request.numPassengers || 1;
  const price: number | null = request.contributionAmount ?? request.estimatedFare ?? request.price ?? null;
  const riderName = riderProfile?.name || request.userName || request.riderName || request.requesterName || 'Rider';
  const riderRating = riderProfile?.rating ?? request.riderRating ?? request.userRating;
  const riderAvatarUrl: string | null = riderProfile?.avatarUrl ?? null;
  const notes = request.notes || request.riderNotes || '';
  const duration = request.duration?.text || (typeof request.duration === 'string' ? request.duration : '');
  const distance = request.distance?.text || (typeof request.distance === 'string' ? request.distance : '');

  const isConfirmed = ['confirmed', 'completed', 'cancelled', 'canceled'].includes(
    String(request.status || '').toLowerCase()
  );

  const riderId = request.userId || request.riderId || request.requesterId || null;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/driver')} style={styles.backBtn}>
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Ride Request</Text>
          <Text style={styles.headerSubtitle}>View rider request details</Text>
        </View>
        <TouchableOpacity onPress={shareRequest} style={styles.shareBtn}>
          <Share2 size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Rider Card */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => { if (riderId) router.push({ pathname: '/rider/[id]', params: { id: riderId } }); }}
        >
          <View style={styles.personRow}>
            {riderAvatarUrl ? (
              <Image source={{ uri: riderAvatarUrl }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User size={28} color="#64748B" />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.personName}>{riderName}</Text>
              <View style={styles.metaRow}>
                {typeof riderRating === 'number' ? (
                  <>
                    <Star size={14} color="#F59E0B" fill="#F59E0B" />
                    <Text style={styles.metaText}>{riderRating.toFixed(1)}</Text>
                  </>
                ) : (
                  <Text style={styles.metaText}>No ratings yet</Text>
                )}
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {/* Route */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Route</Text>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
            <Text style={styles.routeText} numberOfLines={2}>{pickup || 'Pickup'}</Text>
          </View>
          <View style={styles.routeDash} />
          <View style={styles.routeRow}>
            <MapPin size={14} color="#EF4444" />
            <Text style={styles.routeText} numberOfLines={2}>{dropoff || 'Dropoff'}</Text>
          </View>
        </View>

        {/* Trip Info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trip Information</Text>
          {Boolean(date) && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Date</Text>
              <Text style={styles.infoValue}>{date}{time ? ` • ${time}` : ''}</Text>
            </View>
          )}
          {price != null && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Budget</Text>
              <Text style={styles.infoValue}>${typeof price === 'number' ? price.toFixed(2) : price}</Text>
            </View>
          )}
          {Boolean(seats) && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Passengers</Text>
              <Text style={styles.infoValue}>{seats}</Text>
            </View>
          )}
          {Boolean(duration) && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Est. Duration</Text>
              <Text style={styles.infoValue}>{duration}</Text>
            </View>
          )}
          {Boolean(distance) && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Est. Distance</Text>
              <Text style={styles.infoValue}>{distance}</Text>
            </View>
          )}
        </View>

        {/* Notes */}
        {Boolean(notes) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rider Notes</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}
      </ScrollView>

      {/* Footer action */}
      <View style={styles.footer}>
        {isConfirmed ? (
          <View style={[styles.btn, styles.btnDisabled]}>
            <Text style={styles.btnText}>Request No Longer Available</Text>
          </View>
        ) : alreadyOffered ? (
          <View style={[styles.btn, { backgroundColor: '#1A2942' }]}>
            <Text style={[styles.btnText, { color: '#94A3B8' }]}>Offer Already Sent ✓</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.colors.primary, opacity: submitting ? 0.7 : 1 }]}
            onPress={sendOffer}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{submitting ? 'Sending…' : 'Send an Offer'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  headerSubtitle: { fontSize: 14, color: '#6B7280', marginTop: 2 },
  shareBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EEF2F7',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#0F172A', marginBottom: 12 },
  personRow: { flexDirection: 'row', alignItems: 'center' },
  avatarImg: { width: 72, height: 72, borderRadius: 36, marginRight: 12 },
  avatarPlaceholder: {
    width: 72, height: 72, borderRadius: 36, marginRight: 12,
    backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center',
  },
  personName: { fontSize: 20, fontWeight: '700', color: '#0F172A' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  metaText: { fontSize: 14, color: '#6B7280' },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  routeDash: { width: 2, height: 20, marginLeft: 5, marginVertical: 2, backgroundColor: '#E2E8F0' },
  routeText: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 20, color: '#0F172A' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  infoLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  infoValue: { fontSize: 14, color: '#6B7280' },
  notesText: { fontSize: 14, lineHeight: 20, color: '#374151' },
  footer: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  btn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#94A3B8' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#1E293B' },
  errorSub: { fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20, color: '#64748B' },
  browseBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 },
  browseBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
