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
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { MapPin, Clock, Users, DollarSign, ArrowLeft, Share2, Star, User } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { PaymentModal } from '@/components/PaymentModal';

export default function RideDeepLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const rideId = Array.isArray(id) ? id[0] : id;
  const theme = useTheme();

  const [loading, setLoading] = useState(true);
  const [ride, setRide] = useState<any | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [driverProfile, setDriverProfile] = useState<{ name?: string; rating?: number; avatarUrl?: string | null } | null>(null);

  useEffect(() => {
    if (!rideId) { setNotFound(true); setLoading(false); return; }
    getDoc(doc(firestore, 'ridePostings', rideId))
      .then(async (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as any;
          setRide(data);
          // Fetch the actual driver profile so we show real name/photo/rating
          const dId = data.driverId || data.driverUID || data.ownerId || data.driver?.id;
          if (dId) {
            try {
              const uSnap = await getDoc(doc(firestore, 'users', dId));
              if (uSnap.exists()) {
                const u = uSnap.data() as any;
                const name = u.name || u.displayName || u.fullName ||
                  (u.firstName && u.lastName ? `${u.firstName} ${u.lastName}`.trim() : u.firstName) || null;
                setDriverProfile({
                  name,
                  rating: typeof u.rating === 'number' ? u.rating : (typeof u.avgRating === 'number' ? u.avgRating : undefined),
                  avatarUrl: u.avatarUrl || u.photoURL || u.photoUrl || null,
                });
              } else {
                const dSnap = await getDoc(doc(firestore, 'drivers', dId));
                if (dSnap.exists()) {
                  const d = dSnap.data() as any;
                  const name = d.fullName || d.name || d.displayName || null;
                  setDriverProfile({
                    name,
                    rating: typeof d.rating === 'number' ? d.rating : undefined,
                    avatarUrl: d.avatarUrl1 || d.avatarUrl || d.photoURL || null,
                  });
                }
              }
              // Compute rating from rideRatings if not already set
              const ratingsSnap = await getDocs(
                query(collection(firestore, 'rideRatings'), where('rateeId', '==', dId))
              );
              if (!ratingsSnap.empty) {
                const nums = ratingsSnap.docs
                  .map(d => { const r = d.data() as any; return typeof r.stars === 'number' ? r.stars : (typeof r.rating === 'number' ? r.rating : undefined); })
                  .filter((n): n is number => typeof n === 'number');
                if (nums.length > 0) {
                  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
                  setDriverProfile(prev => prev ? { ...prev, rating: avg } : prev);
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
  }, [rideId]);

  const shareRide = async () => {
    if (!rideId) return;
    const p = new URLSearchParams();
    const n = (driverProfile?.name || ride?.driverName || ride?.driver?.name || '').split(' ')[0];
    if (n) p.set('name', n);
    const from = ride?.pickupAddress || ride?.pickup || ride?.pickupLocation?.address || ride?.from || '';
    const to = ride?.dropoffAddress || ride?.dropoff || ride?.dropoffLocation?.address || ride?.to || '';
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const qs = p.toString();
    const url = `https://ridealongapp.com/ride/${rideId}${qs ? `?${qs}` : ''}`;
    await Share.share({
      message: `Check out this ride on RideAlong! ${url}`,
      url,
    }).catch(() => {});
  };

  const handleBook = () => {
    if (!firebaseAuth.currentUser) {
      Alert.alert('Sign in required', 'Please sign in to book this ride.', [
        { text: 'Sign In', onPress: () => router.push('/(auth)/sign-in') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    setPaymentModalVisible(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={theme.colors.primary} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !ride) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
          <ArrowLeft size={22} color="#1E293B" />
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Ride not found</Text>
          <Text style={styles.errorSub}>
            This ride may have been filled or removed.
          </Text>
          <TouchableOpacity
            style={[styles.browseBtn, { backgroundColor: theme.colors.primary }]}
            onPress={() => router.replace('/available-rides')}
          >
            <Text style={styles.browseBtnText}>Browse Available Rides</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const pickup = ride.pickupAddress || ride.pickup || ride.pickupLocation?.address || ride.from || '';
  const dropoff = ride.dropoffAddress || ride.dropoff || ride.dropoffLocation?.address || ride.to || '';
  const date = ride.date || ride.departureDate || '';
  const time = ride.time || ride.departureTime || ride.pickupTime || '';
  const seats = ride.availableSeats ?? ride.seatsAvailable ?? ride.seats ?? 0;
  const price: number = ride.pricePerSeat ?? ride.contributionAmount ?? ride.estimatedFare ?? 0;
  const driverName = driverProfile?.name || ride.driverName || ride.driver?.name || 'Driver';
  const driverRating = driverProfile?.rating ?? ride.driverRating ?? ride.driver?.rating;
  const driverAvatarUrl: string | null = driverProfile?.avatarUrl ?? null;
  const notes = ride.notes || ride.driverNotes || '';
  const driverId = ride.driverId || ride.driverUID || ride.ownerId || ride.driver?.id || null;
  const vehicle = ride.vehicle || ride.vehicleInfo?.model || ride.carModel || '';
  const duration = ride.duration?.text || (typeof ride.duration === 'string' ? ride.duration : '');
  const distance = ride.distance?.text || (typeof ride.distance === 'string' ? ride.distance : '');

  const isUnavailable = ['confirmed', 'completed', 'cancelled', 'canceled', 'full'].includes(
    String(ride.status || '').toLowerCase()
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} style={styles.backBtn}>
          <ArrowLeft size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Ride Details</Text>
          <Text style={styles.headerSubtitle}>View posted ride details</Text>
        </View>
        <TouchableOpacity onPress={shareRide} style={styles.shareBtn}>
          <Share2 size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Driver Card */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => { if (driverId) router.push(`/driver/${driverId}`); }}
        >
          <View style={styles.personRow}>
            {driverAvatarUrl ? (
              <Image source={{ uri: driverAvatarUrl }} style={styles.avatarImg} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.primary }]}>
                <Text style={styles.avatarInitial}>{driverName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.personName}>{driverName}</Text>
              <View style={styles.metaRow}>
                {typeof driverRating === 'number' ? (
                  <>
                    <Star size={14} color="#F59E0B" fill="#F59E0B" />
                    <Text style={styles.metaText}>{driverRating.toFixed(1)}</Text>
                  </>
                ) : (
                  <Text style={styles.metaText}>No ratings yet</Text>
                )}
                {Boolean(vehicle) && (
                  <Text style={styles.metaText}> • {vehicle}</Text>
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
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Price / Seat</Text>
            <Text style={styles.infoValue}>${typeof price === 'number' ? price.toFixed(2) : price}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Seats Available</Text>
            <Text style={styles.infoValue}>{seats}</Text>
          </View>
          {Boolean(duration) && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Duration</Text>
              <Text style={styles.infoValue}>{duration}</Text>
            </View>
          )}
          {Boolean(distance) && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Distance</Text>
              <Text style={styles.infoValue}>{distance}</Text>
            </View>
          )}
        </View>

        {/* Notes */}
        {Boolean(notes) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Note from Driver</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}
      </ScrollView>

      {/* Book Button */}
      <View style={styles.footer}>
        {isUnavailable ? (
          <View style={[styles.btn, styles.btnDisabled]}>
            <Text style={styles.btnText}>Ride No Longer Available</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: theme.colors.primary }]}
            onPress={handleBook}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Book a Seat  •  ${typeof price === 'number' ? price.toFixed(2) : price}</Text>
          </TouchableOpacity>
        )}
      </View>

      <PaymentModal
        visible={paymentModalVisible}
        onClose={() => setPaymentModalVisible(false)}
        rideId={rideId || ''}
        driverId={driverId}
        baseFare={price}
      />
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
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontWeight: '700', fontSize: 28 },
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
