import React, { useEffect, useMemo, useState } from 'react';
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
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { doc, getDoc, addDoc, deleteDoc, collection, serverTimestamp, query, where, getDocs, limit as fsLimit } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { Ionicons } from '@expo/vector-icons';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';
import { getOrCreateRideChat } from '@/src/services/chatAvailability';
import { createRoleNotification } from '@/src/services/notificationRecords';

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

async function getRiderRatingForCompletedRides(riderId: string): Promise<number | undefined> {
  const rideIds = new Set<string>();
  const addRide = (id: string, data: any) => {
    rideIds.add(id);
    if (data?.rideRequestId) rideIds.add(String(data.rideRequestId));
    if (data?.ridePostingId) rideIds.add(String(data.ridePostingId));
    if (data?.ridePostingRequestId) rideIds.add(String(data.ridePostingRequestId));
  };

  try {
    const ridesSnap = await getDocs(query(
      collection(firestore, 'confirmedRides'),
      where('riderId', '==', riderId),
      where('status', 'in', ['COMPLETED', 'completed']),
    ));
    ridesSnap.docs.forEach((d) => addRide(d.id, d.data() as any));
  } catch {
    const ridesSnap = await getDocs(query(collection(firestore, 'confirmedRides'), where('riderId', '==', riderId)));
    ridesSnap.docs.forEach((d) => {
      const data = d.data() as any;
      if (String(data?.status || '').toUpperCase() === 'COMPLETED') addRide(d.id, data);
    });
  }

  if (rideIds.size === 0) return undefined;

  const ratingsSnap = await getDocs(query(collection(firestore, 'rideRatings'), where('rateeId', '==', riderId)));
  const nums = ratingsSnap.docs
    .map((d) => d.data() as any)
    .filter((r) => {
      const rateeRole = String(r?.rateeRole || r?.ratedRole || '').toLowerCase();
      if (rateeRole && rateeRole !== 'rider') return false;
      return rideIds.has(String(r?.rideId || ''));
    })
    .map((r) => (typeof r.stars === 'number' ? r.stars : (typeof r.rating === 'number' ? r.rating : undefined)))
    .filter((n): n is number => typeof n === 'number');

  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
}

function fmtDate(val: any): string {
  if (!val) return '';
  try {
    let d: Date;
    if (val?.toDate) {
      d = val.toDate();
    } else if (val instanceof Date) {
      d = val;
    } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      // Date-only string: parse as local noon to avoid UTC-midnight timezone shift
      const [y, m, day] = val.split('-').map(Number);
      d = new Date(y, m - 1, day, 12, 0, 0);
    } else {
      d = new Date(val);
    }
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return String(val); }
}

function fmtTime(val: any): string {
  if (!val) return '';
  try {
    if (typeof val === 'string' && /^\d{1,2}:\d{2}/.test(val)) {
      const [h, m] = val.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
    }
    const d = val?.toDate ? val.toDate() : new Date(val);
    if (!isNaN(d.getTime())) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {}
  return String(val);
}

export default function RequestDeepLinkScreen() {
  const { colors } = useAppTheme();
  const s = useMemo(() => StyleSheet.create({
    root:   { flex: 1, backgroundColor: colors.bg },
    safe:   { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 0,
      paddingTop: 8,
      paddingBottom: 4,
      minHeight: 64,
    },
    backBtn:     { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
    headerTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
    shareBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },

    body:      { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 12 },
    card:      { backgroundColor: colors.bgCard, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
    cardTitle: { fontSize: 11, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1.2, marginBottom: 12, textTransform: 'uppercase' },

    personRow:        { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatarImg:        { width: 56, height: 56, borderRadius: 28 },
    avatarPlaceholder:{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
    personName:       { fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginBottom: 4 },
    metaRow:          { flexDirection: 'row', alignItems: 'center', gap: 4 },
    metaText:         { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },

    routeRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    dot:       { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.textPrimary, marginTop: 4, flexShrink: 0 },
    routeDash: { width: 2, height: 16, marginLeft: 4, marginVertical: 4, backgroundColor: colors.border },
    routeText: { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20, color: colors.textPrimary },

    infoRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    infoLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    infoValue: { fontSize: 14, color: colors.textSecondary, fontWeight: '500', maxWidth: '55%', textAlign: 'right' },

    prefRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
    prefBorder:{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    prefIcon:  { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
    prefLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    prefValue: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },

    notesText: { fontSize: 14, lineHeight: 21, color: colors.textPrimary },

    footer:     { paddingHorizontal: 16, paddingBottom: 28, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgCard },
    btn:        { borderRadius: 27, paddingVertical: 16, alignItems: 'center' },
    btnDisabled:{ backgroundColor: colors.textSecondary },
    btnText:    { color: colors.textInverse, fontWeight: '700', fontSize: 16 },

    errorTitle:    { fontSize: 20, fontWeight: '700', marginBottom: 8, color: colors.textPrimary },
    errorSub:      { fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20, color: colors.textSecondary },
    browseBtn:     { borderRadius: 27, paddingVertical: 14, paddingHorizontal: 28, backgroundColor: colors.primary },
    browseBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  }), [colors]);

  const { id } = useLocalSearchParams<{ id: string }>();
  const { goBack } = useReturnNavigation('/(driver)/requests');
  const requestId = Array.isArray(id) ? id[0] : id;

  const [loading, setLoading]         = useState(true);
  const [request, setRequest]         = useState<any | null>(null);
  const [notFound, setNotFound]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [alreadyOffered, setAlreadyOffered] = useState(false);
  const [offerDocId, setOfferDocId]   = useState<string | null>(null);
  // True when the loaded doc is a ridePostingRequest (rider booked driver's posting)
  const [isPostingRequest, setIsPostingRequest] = useState(false);

  const [riderProfile, setRiderProfile] = useState<{
    name?: string; rating?: number; avatarUrl?: string | null;
    preferences?: Record<string, any> | null;
  } | null>(null);

  useEffect(() => {
    if (!requestId) { setNotFound(true); setLoading(false); return; }
    // Try rideRequests first, then ridePostingRequests (for rider-to-driver posting requests)
    const tryPostingRequests = async () => {
      const prSnap = await getDoc(doc(firestore, 'ridePostingRequests', requestId));
      if (prSnap.exists()) { setIsPostingRequest(true); return { id: prSnap.id, ...prSnap.data() } as any; }
      return null;
    };
    getDoc(doc(firestore, 'rideRequests', requestId))
      .then(async (snap) => {
        const rawSnap = snap.exists() ? { id: snap.id, ...snap.data() } as any : await tryPostingRequests();
        if (rawSnap) {
          const data = rawSnap;
          setRequest(data);
          const uid = firebaseAuth.currentUser?.uid;
          if (uid) {
            const q = query(collection(firestore, 'rideOffers'), where('rideRequestId', '==', requestId), where('driverId', '==', uid), fsLimit(1));
            const existing = await getDocs(q);
            if (!existing.empty) { setAlreadyOffered(true); setOfferDocId(existing.docs[0].id); }
          }
          const rId = data.userId || data.riderId || data.requesterId;
          if (rId) {
            try {
              const uSnap = await getDoc(doc(firestore, 'riders', rId));
              const u = uSnap.exists() ? (uSnap.data() as any) : null;
              const name = u?.name || u?.displayName || u?.fullName ||
                (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}`.trim() : u?.firstName) || null;

              const prefFields = ['conversationLevel', 'musicPreference', 'passengerType', 'smokingPreference', 'soundEnvironment', 'allowPets', 'temperaturePreference'];
              const prefs: Record<string, any> = { ...(u?.preferences || {}) };
              prefFields.forEach(f => { if (u?.[f] != null) prefs[f] = u[f]; });

              setRiderProfile({
                name,
                rating: typeof u?.rating === 'number' ? u.rating : (typeof u?.avgRating === 'number' ? u.avgRating : undefined),
                avatarUrl: u?.avatarUrl || u?.photoURL || u?.photoUrl || null,
                preferences: Object.keys(prefs).length > 0 ? prefs : null,
              });

              const riderRating = await getRiderRatingForCompletedRides(rId);
              if (typeof riderRating === 'number') setRiderProfile(prev => prev ? { ...prev, rating: riderRating } : prev);
            } catch {}
          }
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [requestId]);

  const acceptRequest = async () => {
    if (!requestId || !request) return;
    setSubmitting(true);
    try {
      const postingId = request.ridePostingId || request.rideId;
      if (!postingId) throw new Error('Missing posting ID');
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error('Not signed in');
      const token = await user.getIdToken();
      const { getApiBaseUrl } = await import('@/constants/services');
      const base = getApiBaseUrl();
      const driverSnap = await getDoc(doc(firestore, 'drivers', user.uid));
      const driver = driverSnap.exists() ? (driverSnap.data() as any) : {};
      const driverName = driver.fullName || [driver.firstName, driver.lastName].filter(Boolean).join(' ').trim() || driver.displayName || 'Driver';
      const driverEmail = driver.personalInfo?.email || driver.email || user.email || '';
      const resp = await fetch(`${base}/api/ride-postings/${encodeURIComponent(postingId)}/requests/${encodeURIComponent(requestId)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ driverId: user.uid, driverName, driverEmail }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || 'Failed to accept request');
      }
      Alert.alert('Accepted!', 'The rider has been confirmed for this ride.', [
        { text: 'OK', onPress: () => goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not accept. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const rejectRequest = async () => {
    if (!requestId) return;
    Alert.alert('Decline request?', 'The rider will be notified.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: async () => {
        setSubmitting(true);
        try {
          const { updateDoc } = await import('firebase/firestore');
          const { serverTimestamp } = await import('firebase/firestore');
          await updateDoc(doc(firestore, 'ridePostingRequests', requestId), { status: 'rejected', updatedAt: serverTimestamp() });
          goBack();
        } catch {
          Alert.alert('Error', 'Could not decline. Please try again.');
        } finally {
          setSubmitting(false);
        }
      }},
    ]);
  };

  const shareRequest = async () => {
    if (!requestId) return;
    const p = new URLSearchParams();
    const n = (riderProfile?.name || request?.userName || request?.riderName || request?.requesterName || '').split(' ')[0];
    if (n) p.set('name', n);
    const from = request?.pickupAddress || request?.pickup || request?.pickupLocation?.address || request?.from || '';
    const to   = request?.dropoffAddress || request?.dropoff || request?.dropoffLocation?.address || request?.to || '';
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const qs  = p.toString();
    const url = `https://ridealongapp.com/request/${requestId}${qs ? `?${qs}` : ''}`;
    await Share.share({ message: `There's a ride request on RideAlong! ${url}`, url }).catch(() => {});
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
    const riderId = request.userId || request.riderId || request.requesterId || null;
    if (riderId && user.uid === riderId) {
      Alert.alert('Not allowed', 'You cannot make an offer on your own ride request.');
      return;
    }
    setSubmitting(true);
    try {
      const price       = request.contributionAmount ?? request.estimatedFare ?? request.price ?? null;
      const driverEmail = user.email || null;
      const driverName  = user.displayName || (driverEmail ? driverEmail.split('@')[0] : null);
      const pickup  = request.pickupAddress  || request.pickup  || request.pickupLocation?.address  || request.from || null;
      const dropoff = request.dropoffAddress || request.dropoff || request.dropoffLocation?.address || request.to   || null;
      const offerRef = await addDoc(collection(firestore, 'rideOffers'), {
        rideRequestId: requestId,
        driverId: user.uid, driverEmail, driverName,
        riderId,
        riderEmail: request.userEmail || request.riderEmail || request.requesterEmail || null,
        riderName:  request.userName  || request.riderName  || request.requesterName  || null,
        status: 'pending',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), offerDate: serverTimestamp(),
        emailSent: false,
        offerPrice: typeof price === 'number' ? price : null,
        rideDetails: {
          pickup, destination: dropoff,
          date: request.date || null, time: request.time || null,
          passengers: request.seats || request.numPassengers || 1,
          contributionAmount: typeof price === 'number' ? price.toFixed(2) : null,
        },
      });
      await createRoleNotification({
        recipientId: riderId,
        recipientRole: 'rider',
        type: 'offer_received',
        title: 'You have a ride offer',
        message: `${driverName || 'A driver'} sent an offer for your ride request.`,
        driverId: user.uid,
        riderId,
        rideRequestId: requestId,
        dedupeId: `ride-offer-${offerRef.id}-rider`,
      }).catch(() => {});
      setAlreadyOffered(true);
      Alert.alert('Offer sent! 🎉', "Your offer was sent to the rider. You'll be notified if they accept.");
    } catch (e) {
      console.warn('sendOffer error', e);
      Alert.alert('Failed', 'Could not send your offer. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const withdrawOffer = () => {
    Alert.alert(
      'Withdraw offer?',
      'The rider will no longer see your offer.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            if (!offerDocId) return;
            setSubmitting(true);
            try {
              await deleteDoc(doc(firestore, 'rideOffers', offerDocId));
              setAlreadyOffered(false);
              setOfferDocId(null);
            } catch {
              Alert.alert('Failed', 'Could not withdraw your offer. Please try again.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle={colors.statusBar} />
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <View style={s.center}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (notFound || !request) {
    return (
      <View style={s.root}>
        <StatusBar barStyle={colors.statusBar} />
        <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
          <View style={[s.header, { paddingHorizontal: 16 }]}>
            <TouchableOpacity style={s.backBtn} onPress={goBack}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={s.center}>
            <Text style={s.errorTitle}>Request not found</Text>
            <Text style={s.errorSub}>This ride request may have already been filled or removed.</Text>
            <TouchableOpacity style={s.browseBtn} onPress={() => router.replace('/(driver)/requests' as any)}>
              <Text style={s.browseBtnText}>Browse Requests</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const pickup  = request.pickupAddress  || request.pickup  || request.pickupLocation?.address  || request.from || '';
  const dropoff = request.dropoffAddress || request.dropoff || request.dropoffLocation?.address || request.to   || '';
  const dateRaw = request.date || request.departureDate || request.scheduledDate || '';
  const timeRaw = request.time || request.departureTime || request.scheduledTime || '';
  const dateStr = fmtDate(dateRaw);
  const timeStr = fmtTime(timeRaw);
  const seats   = request.seats || request.numPassengers || 1;
  const price: number | null = request.contributionAmount ?? request.estimatedFare ?? request.price ?? null;
  const riderName     = riderProfile?.name || request.userName || request.riderName || request.requesterName || 'Rider';
  const riderRating   = riderProfile?.rating ?? request.riderRating ?? request.userRating;
  const riderAvatarUrl: string | null = riderProfile?.avatarUrl ?? null;
  const notes    = request.notes || request.riderNotes || '';
  const duration = request.duration?.text || (typeof request.duration === 'string' ? request.duration : '');
  const distance = request.distance?.text || (typeof request.distance === 'string' ? request.distance : '');
  const isConfirmed = ['confirmed', 'completed', 'cancelled', 'canceled'].includes(String(request.status || '').toLowerCase());
  const riderId = request.userId || request.riderId || request.requesterId || null;

  const prefOrder = ['conversationLevel', 'musicPreference', 'passengerType', 'smokingPreference', 'soundEnvironment', 'allowPets', 'temperaturePreference'];
  const prefEntries: Array<[string, any]> = [];
  if (riderProfile?.preferences) {
    prefOrder.forEach(k => { if (riderProfile.preferences![k] != null) prefEntries.push([k, riderProfile.preferences![k]]); });
    Object.entries(riderProfile.preferences).forEach(([k, v]) => { if (!prefOrder.includes(k)) prefEntries.push([k, v]); });
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>

          {/* ── Header ── */}
          <View style={s.header}>
            <TouchableOpacity onPress={goBack} style={s.backBtn}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Ride Request</Text>
            <TouchableOpacity onPress={shareRequest} style={s.shareBtn}>
              <Ionicons name="share-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>

          {/* ── Rider ── */}
          <TouchableOpacity
            style={s.card}
            activeOpacity={0.7}
            onPress={() => { if (riderId) router.push({ pathname: '/(driver)/rider/[id]', params: { id: riderId, returnTo: `/(driver)/request/${requestId}` } } as any); }}
          >
            <View style={s.personRow}>
              {riderAvatarUrl ? (
                <Image source={{ uri: riderAvatarUrl }} style={s.avatarImg} />
              ) : (
                <View style={s.avatarPlaceholder}>
                  <Ionicons name="person-outline" size={28} color={colors.textSecondary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.personName}>{riderName}</Text>
                <View style={s.metaRow}>
                  {typeof riderRating === 'number' ? (
                    <>
                      <Ionicons name="star" size={13} color={colors.amber} />
                      <Text style={s.metaText}>{riderRating.toFixed(1)}</Text>
                    </>
                  ) : (
                    <Text style={s.metaText}>No ratings yet</Text>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* ── Route ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Route</Text>
            <View style={s.routeRow}>
              <View style={s.dot} />
              <Text style={s.routeText} numberOfLines={2}>{pickup || 'Pickup'}</Text>
            </View>
            <View style={s.routeDash} />
            <View style={s.routeRow}>
              <Ionicons name="location" size={14} color={colors.red} />
              <Text style={s.routeText} numberOfLines={2}>{dropoff || 'Dropoff'}</Text>
            </View>
          </View>

          {/* ── Trip Info ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Trip Details</Text>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Date</Text>
              <Text style={s.infoValue}>{dateStr || '—'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Time</Text>
              <Text style={s.infoValue}>{timeStr || '—'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Passengers</Text>
              <Text style={s.infoValue}>{seats}</Text>
            </View>
            {price != null && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Budget</Text>
                <Text style={[s.infoValue, { color: colors.primary, fontWeight: '700' }]}>${typeof price === 'number' ? price.toFixed(2) : price}</Text>
              </View>
            )}
            {Boolean(duration) && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Est. Duration</Text>
                <Text style={s.infoValue}>{duration}</Text>
              </View>
            )}
            {Boolean(distance) && (
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Est. Distance</Text>
                <Text style={s.infoValue}>{distance}</Text>
              </View>
            )}
          </View>

          {/* ── Rider Preferences ── */}
          {prefEntries.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Rider Preferences</Text>
              {prefEntries.map(([key, value], idx) => {
                const label  = PREF_LABELS[key] || key;
                const icon   = PREF_ICONS[key] || 'ellipse-outline';
                const valStr = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '—');
                return (
                  <View key={key} style={[s.prefRow, idx < prefEntries.length - 1 && s.prefBorder]}>
                    <View style={s.prefIcon}>
                      <Ionicons name={icon as any} size={14} color={colors.primary} />
                    </View>
                    <Text style={s.prefLabel}>{label}</Text>
                    <Text style={s.prefValue}>{valStr}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── Rider Notes ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Rider Notes</Text>
            <Text style={[s.notesText, !notes && { color: colors.textSecondary, fontStyle: 'italic' }]}>
              {notes || 'No notes provided'}
            </Text>
          </View>

        </ScrollView>

        <View style={s.footer}>
          {isPostingRequest ? (
            // Rider booked the driver's posting — show Accept / Decline
            ['confirmed', 'accepted', 'completed', 'cancelled', 'canceled', 'rejected', 'declined'].includes(String(request?.status || '').toLowerCase()) ? (
              <TouchableOpacity style={[s.btn, { backgroundColor: colors.bgSecondary }]} disabled activeOpacity={1}>
                <Text style={[s.btnText, { color: colors.textSecondary }]}>{String(request?.status || '').toUpperCase()}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity style={[s.btn, { flex: 1, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bgCard, opacity: submitting ? 0.6 : 1 }]} onPress={rejectRequest} disabled={submitting} activeOpacity={0.8}>
                  <Text style={[s.btnText, { color: colors.textPrimary }]}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]} onPress={acceptRequest} disabled={submitting} activeOpacity={0.85}>
                  <Text style={s.btnText}>{submitting ? 'Accepting…' : 'Accept'}</Text>
                </TouchableOpacity>
              </View>
            )
          ) : (() => {
            const openRiderChat = async () => {
              if (!requestId) return;
              try {
                const uid = firebaseAuth.currentUser?.uid;
                const rId = riderId || request?.userId || request?.riderId || request?.requesterId;
                if (alreadyOffered && uid && rId && offerDocId) {
                  const chatId = await getOrCreateRideChat({
                    context: 'ride-offer',
                    rideId: requestId,
                    rideRequestId: requestId,
                    rideOfferId: offerDocId,
                    driverId: uid,
                    riderId: String(rId),
                  });
                  router.push(`/(driver)/messages/${chatId}` as any);
                  return;
                }
                const confirmedSnap = await getDocs(query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', requestId)));
                if (confirmedSnap.empty) { Alert.alert('Not available', 'The chat opens once the ride is confirmed.'); return; }
                const confirmedRideId = confirmedSnap.docs[0].id;
                const chatSnap = await getDocs(query(collection(firestore, 'chats'), where('rideId', '==', confirmedRideId)));
                if (!chatSnap.empty) {
                  router.push(`/(driver)/messages/${chatSnap.docs[0].id}` as any);
                } else {
                  Alert.alert('Not available', 'The chat will be available shortly after confirmation.');
                }
              } catch { Alert.alert('Error', 'Could not open chat. Please try again.'); }
            };

            if (isConfirmed) {
              return (
                <TouchableOpacity style={[s.btn, { backgroundColor: colors.bgSecondary, opacity: riderId ? 1 : 0.5 }]} onPress={openRiderChat} disabled={!riderId} activeOpacity={0.8}>
                  <Text style={[s.btnText, { color: colors.textPrimary }]}>Message Rider</Text>
                </TouchableOpacity>
              );
            }
            if (alreadyOffered) {
              return (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={[s.btn, { backgroundColor: colors.bgSecondary, flex: 1 }]} onPress={openRiderChat} disabled={!riderId} activeOpacity={0.8}>
                    <Text style={[s.btnText, { color: colors.textPrimary }]}>Message Rider</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btn, { backgroundColor: colors.textPrimary, flex: 1, opacity: submitting ? 0.6 : 1 }]} onPress={withdrawOffer} disabled={submitting} activeOpacity={0.8}>
                    <Text style={s.btnText}>{submitting ? 'Withdrawing…' : 'Withdraw Offer'}</Text>
                  </TouchableOpacity>
                </View>
              );
            }
            return (
              <TouchableOpacity style={[s.btn, { backgroundColor: colors.primary, opacity: submitting ? 0.7 : 1 }]} onPress={sendOffer} disabled={submitting} activeOpacity={0.85}>
                <Text style={s.btnText}>{submitting ? 'Sending…' : 'Send an Offer'}</Text>
              </TouchableOpacity>
            );
          })()}
        </View>
      </SafeAreaView>
    </View>
  );
}

