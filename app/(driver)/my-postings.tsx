import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  collection, query, where, onSnapshot, doc,
  updateDoc, serverTimestamp, Timestamp, addDoc,
} from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { FlagRideModal } from '@/components/FlagRideModal';
import { roleKey } from '@/src/utils/roleIdentity';

type BookingRequest = {
  id: string;
  riderName: string;
  riderEmail: string;
  riderId: string;
  pickup: string;
  dropoff: string;
  passengers: number;
  contributionAmount: number | null;
  status: string;
  ridePostingId: string;
  createdAtMs: number;
};

const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';

type Posting = {
  id: string;
  from: string;
  to: string;
  date: string;
  time: string;
  scheduledAt: Date | null;
  seats: number;
  price: number | null;
  status: string;
  notes: string;
  vibes: string[];
  distance: string;
  raw: any;
};

function extractAddr(r: any, key: 'pickup' | 'dropoff'): string {
  const v =
    r?.[key] ??
    r?.[`${key}Location`] ??
    r?.[`${key}Address`] ??
    r?.[key === 'pickup' ? 'from' : 'to'] ??
    r?.[key === 'pickup' ? 'origin' : 'destination'];
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const s = v.address || v.description || v.name || '';
    return typeof s === 'string' ? s.trim() : '';
  }
  return '';
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function parseDateTime(dateValue: any, timeValue: any): Date | null {
  const direct = toDate(dateValue);
  if (direct && direct.getHours() + direct.getMinutes() + direct.getSeconds() > 0) return direct;

  if (typeof dateValue !== 'string' || !dateValue.trim()) return direct;
  const dateMatch = dateValue.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!dateMatch) return direct;

  let hours = 23;
  let minutes = 59;
  if (typeof timeValue === 'string' && timeValue.trim()) {
    const timeMatch = timeValue.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      hours = Number(timeMatch[1]);
      minutes = Number(timeMatch[2] || 0);
      const meridiem = timeMatch[3]?.toLowerCase();
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    }
  }

  const d = new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hours,
    minutes,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function postingScheduledAt(r: any): Date | null {
  return (
    toDate(r.departureTime) ||
    toDate(r.scheduledAt) ||
    toDate(r.dateTime) ||
    toDate(r.requestedTime) ||
    toDate(r.pickupTime) ||
    parseDateTime(r.date || r.departureDate || r.scheduledDate, r.time || r.departureTimeText || r.scheduledTime)
  );
}

function toPosting(id: string, r: any): Posting {
  return {
    id,
    from: extractAddr(r, 'pickup') || 'Pickup pending',
    to: extractAddr(r, 'dropoff') || 'Dropoff pending',
    date: r.date || '',
    time: r.time || '',
    scheduledAt: postingScheduledAt(r),
    seats: Number(r.availableSeats ?? r.seats ?? r.seatsAvailable ?? 1),
    price: r.pricePerSeat != null ? Number(r.pricePerSeat) : r.contributionAmount != null ? Number(r.contributionAmount) : null,
    status: String(r.status || 'active').toLowerCase(),
    notes: r.notes || '',
    vibes: Array.isArray(r.rideVibe) ? r.rideVibe : Array.isArray(r.preferences) ? r.preferences : [],
    distance: r.distance?.text || r.distanceText || '',
    raw: r,
  };
}

const ACTIVE_STATUSES = new Set([
  'active', 'open', 'available', 'posted',
  'accepted', 'confirmed', 'booked',
  'in_progress', 'in progress', 'in-progress',
  'driver_completed', 'driver completed', 'rider_completed', 'rider completed',
]);
const INACTIVE_STATUSES = new Set(['cancelled', 'canceled', 'completed', 'complete', 'finished', 'expired']);

function isPostingOutdated(p: Posting, now = Date.now()): boolean {
  const status = p.status.toLowerCase();
  if (INACTIVE_STATUSES.has(status)) return true;
  if (!p.scheduledAt) return false;
  return p.scheduledAt.getTime() < now;
}

export default function MyPostingsScreen() {
  const { goBack: handleBack } = useReturnNavigation('/(driver)');
  const [postings, setPostings] = useState<Posting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [tab, setTab]           = useState<'active' | 'past'>('active');
  const [requestsByPostingId, setRequestsByPostingId] = useState<Record<string, BookingRequest[]>>({});
  const [actingOnRequest, setActingOnRequest] = useState<string | null>(null);
  const [confirmedIdByPostingId, setConfirmedIdByPostingId] = useState<Record<string, string>>({});

  // Subscribe to incoming rider booking requests for this driver's postings
  useEffect(() => {
    const uid   = firebaseAuth.currentUser?.uid;
    const email = firebaseAuth.currentUser?.email;
    if (!uid) return;

    const inactive = new Set(['cancelled', 'canceled', 'rejected', 'declined', 'completed']);
    const snapA: Map<string, BookingRequest> = new Map();
    const snapB: Map<string, BookingRequest> = new Map();

    const flush = () => {
      // Dedup by doc ID first (merges snapA + snapB), then dedup by riderId per
      // posting keeping only the most recent doc — prevents duplicate cards when
      // a rider books more than once for the same posting.
      const seen = new Map<string, BookingRequest>();
      [...snapA.values(), ...snapB.values()].forEach((r) => seen.set(r.id, r));

      const byPosting: Record<string, BookingRequest[]> = {};
      seen.forEach((r) => {
        if (!byPosting[r.ridePostingId]) byPosting[r.ridePostingId] = [];
        const existing = byPosting[r.ridePostingId].findIndex((x) => x.riderId === r.riderId);
        if (existing === -1) {
          byPosting[r.ridePostingId].push(r);
        } else if (r.createdAtMs > byPosting[r.ridePostingId][existing].createdAtMs) {
          byPosting[r.ridePostingId][existing] = r;
        }
      });
      setRequestsByPostingId(byPosting);
    };

    const toReq = (id: string, d: any): BookingRequest => ({
      id,
      riderName: d.riderName || 'Rider',
      riderEmail: d.riderEmail || '',
      riderId: d.riderId || '',
      pickup: d.pickup || d.from || '',
      dropoff: d.dropoff || d.to || '',
      passengers: Number(d.passengers || 1),
      contributionAmount: d.contributionAmount != null ? Number(d.contributionAmount) : (d.price != null ? Number(d.price) : null),
      status: String(d.status || 'pending'),
      ridePostingId: d.ridePostingId || d.rideId || '',
      createdAtMs: d.createdAt?.toMillis?.() ?? d._localCreatedMs ?? 0,
    });

    const qA = query(collection(firestore, 'ridePostingRequests'), where('driverId', '==', uid));
    const unsubA = onSnapshot(qA, (snap) => {
      snapA.clear();
      snap.forEach((d) => {
        const r = toReq(d.id, d.data());
        if (!inactive.has(r.status.toLowerCase())) snapA.set(d.id, r);
      });
      flush();
    });

    let unsubB = () => {};
    if (email) {
      const qB = query(collection(firestore, 'ridePostingRequests'), where('driverEmail', '==', email));
      unsubB = onSnapshot(qB, (snap) => {
        snapB.clear();
        snap.forEach((d) => {
          const r = toReq(d.id, d.data());
          if (!inactive.has(r.status.toLowerCase())) snapB.set(d.id, r);
        });
        flush();
      });
    }

    return () => { unsubA(); unsubB(); };
  }, []);

  // Track confirmedRides so PostingCard can show a flag button
  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    const q = query(collection(firestore, 'confirmedRides'), where('driverId', '==', uid));
    return onSnapshot(q, (snap) => {
      const map: Record<string, string> = {};
      snap.forEach((d) => {
        const postingId = d.data().ridePostingId;
        if (postingId) map[String(postingId)] = d.id;
      });
      setConfirmedIdByPostingId(map);
    });
  }, []);

  const acceptRequest = useCallback(async (req: BookingRequest) => {
    setActingOnRequest(req.id);
    try {
      await updateDoc(doc(firestore, 'ridePostingRequests', req.id), {
        status: 'accepted',
        updatedAt: serverTimestamp(),
      });
    } catch {
      Alert.alert('Error', 'Could not accept the request. Please try again.');
    } finally {
      setActingOnRequest(null);
    }
  }, []);

  const declineRequest = useCallback(async (req: BookingRequest) => {
    Alert.alert('Decline request?', `${req.riderName} will be notified that their request was declined.`, [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: async () => {
          setActingOnRequest(req.id);
          try {
            await updateDoc(doc(firestore, 'ridePostingRequests', req.id), {
              status: 'rejected',
              updatedAt: serverTimestamp(),
            });
          } catch {
            Alert.alert('Error', 'Could not decline the request. Please try again.');
          } finally {
            setActingOnRequest(null);
          }
        },
      },
    ]);
  }, []);

  const openChatWithRider = useCallback(async (req: BookingRequest) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !req.riderId) return;
    try {
      // Always create a fresh thread for this specific booking request
      const chatRef = await addDoc(collection(firestore, 'chats'), {
        participants: [uid, req.riderId],
        participantKeys: [roleKey('driver', uid), roleKey('rider', req.riderId)],
        participantRoles: { [uid]: 'driver', [req.riderId]: 'rider' },
        driverId: uid,
        riderId: req.riderId,
        ridePostingId: req.ridePostingId || null,
        ridePostingRequestId: req.id,
        context: 'booking-request',
        createdAt: serverTimestamp(),
        lastMessage: null,
        lastMessageTimestamp: null,
      });
      router.push(`/(driver)/messages/${chatRef.id}` as any);
    } catch {
      Alert.alert('Error', 'Could not open the chat. Please try again.');
    }
  }, []);

  useEffect(() => {
    const uid   = firebaseAuth.currentUser?.uid;
    const email = firebaseAuth.currentUser?.email;
    if (!uid) { setLoading(false); return; }

    const seen = new Map<string, Posting>();
    let snapA: Posting[] = [];
    let snapB: Posting[] = [];

    const flush = () => {
      seen.clear();
      [...snapA, ...snapB].forEach((p) => seen.set(p.id, p));
      const all = Array.from(seen.values()).sort((a, b) => {
        const da = a.raw.createdAt?.toMillis?.() ?? 0;
        const db_ = b.raw.createdAt?.toMillis?.() ?? 0;
        return db_ - da;
      });
      setPostings(all);
      setLoading(false);
    };

    const qA = query(collection(firestore, 'ridePostings'), where('driverId', '==', uid));
    const unsubA = onSnapshot(qA, (snap) => {
      snapA = snap.docs.map((d) => toPosting(d.id, d.data()));
      flush();
    });

    let unsubB = () => {};
    if (email) {
      const qB = query(collection(firestore, 'ridePostings'), where('driverEmail', '==', email));
      unsubB = onSnapshot(qB, (snap) => {
        snapB = snap.docs.map((d) => toPosting(d.id, d.data()));
        flush();
      });
    }

    return () => { unsubA(); unsubB(); };
  }, []);

  const cancelPosting = useCallback((p: Posting) => {
    Alert.alert(
      'Cancel Ride',
      `Cancel the ride from ${p.from} to ${p.to}? Riders who requested this ride will be notified.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel Ride',
          style: 'destructive',
          onPress: async () => {
            setCancelling(p.id);
            try {
              await updateDoc(doc(firestore, 'ridePostings', p.id), {
                status: 'cancelled',
                cancelledAt: serverTimestamp(),
              });
            } catch {
              Alert.alert('Error', 'Could not cancel the ride. Please try again.');
            }
            setCancelling(null);
          },
        },
      ],
    );
  }, []);

  const editPosting = useCallback((p: Posting) => {
    router.push({
      pathname: '/(driver)/edit-posting',
      params: { postingId: p.id },
    } as any);
  }, []);

  const now = Date.now();
  const active = postings.filter((p) => ACTIVE_STATUSES.has(p.status) && !isPostingOutdated(p, now));
  const past = postings.filter((p) => INACTIVE_STATUSES.has(p.status) || isPostingOutdated(p, now));
  const shown  = tab === 'active' ? active : past;

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.header}>
            <TouchableOpacity
              onPress={handleBack}
              style={s.backBtn}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color={NAVY} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>My Postings</Text>
            <TouchableOpacity
              onPress={() => router.push('/(driver)/book' as any)}
              style={s.newBtn}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Post a new ride"
            >
              <Ionicons name="add" size={23} color="#FFF" />
            </TouchableOpacity>
          </View>

          <View style={s.tabs}>
            {(['active', 'past'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.tab, tab === t && s.tabActive]}
                onPress={() => setTab(t)}
                activeOpacity={0.75}
              >
                <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                  {t === 'active' ? 'Active (' + active.length + ')' : 'Past (' + past.length + ')'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={ORANGE} size="large" />
            </View>
          ) : shown.length === 0 ? (
            <View style={s.emptyState}>
              <View style={s.emptyIcon}>
                <Ionicons name="car-outline" size={28} color={ORANGE} />
              </View>
              <Text style={s.emptyTitle}>
                {tab === 'active' ? 'No active postings' : 'No past postings'}
              </Text>
              <Text style={s.emptyText}>
                {tab === 'active'
                  ? 'Post a ride to start connecting with nearby riders.'
                  : 'Your completed and cancelled postings will appear here.'}
              </Text>
              {tab === 'active' && (
                <TouchableOpacity
                  style={s.postBtn}
                  onPress={() => router.push('/(driver)/book' as any)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={18} color="#FFF" />
                  <Text style={s.postBtnText}>Post a Ride</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : shown.map((p) => (
            <PostingCard
              key={p.id}
              posting={p}
              isPast={tab === 'past'}
              cancelling={cancelling === p.id}
              onCancel={() => cancelPosting(p)}
              onEdit={() => editPosting(p)}
              incomingRequests={requestsByPostingId[p.id] || []}
              actingOnRequest={actingOnRequest}
              onAccept={acceptRequest}
              onDecline={declineRequest}
              onMessage={openChatWithRider}
              confirmedId={confirmedIdByPostingId[p.id]}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function PostingCard({
  posting: p,
  isPast,
  cancelling,
  onCancel,
  onEdit,
  incomingRequests,
  actingOnRequest,
  onAccept,
  onDecline,
  onMessage,
  confirmedId,
}: {
  posting: Posting;
  isPast: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onEdit: () => void;
  incomingRequests: BookingRequest[];
  actingOnRequest: string | null;
  onAccept: (req: BookingRequest) => void;
  onDecline: (req: BookingRequest) => void;
  onMessage: (req: BookingRequest) => void;
  confirmedId?: string;
}) {
  const hasRequests = incomingRequests.length > 0;
  const [flagVisible, setFlagVisible] = useState(false);
  const isExpired = isPostingOutdated(p);

  const statusLabel = p.status === 'cancelled' ? 'Cancelled'
    : p.status === 'completed' ? 'Completed'
    : isExpired ? 'Expired'
    : p.status === 'expired' ? 'Expired'
    : hasRequests ? `${incomingRequests.length} Request${incomingRequests.length > 1 ? 's' : ''}`
    : 'Active';

  const statusColor = p.status === 'cancelled' ? '#DC2626'
    : p.status === 'completed' ? '#16A34A'
    : isExpired ? MUTED
    : hasRequests ? '#D97706'
    : ORANGE;

  return (
    <View style={s.card}>
      {/* Status row */}
      <View style={s.cardTop}>
        <View style={[s.statusPill, { backgroundColor: `${statusColor}15` }]}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor, marginRight: 5 }} />
          <Text style={[s.statusText, { color: statusColor }]}>{statusLabel.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          {(p.date || p.time) ? (
            <Text style={s.dateText}>{[p.date, p.time].filter(Boolean).join(' - ')}</Text>
          ) : null}
          {confirmedId ? (
            <TouchableOpacity style={s.cardFlagBtn} onPress={() => setFlagVisible(true)} activeOpacity={0.75}>
              <Ionicons name="flag-outline" size={14} color="#B54A4A" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Route */}
      <View style={s.route}>
        <View style={s.routeDots}>
          <View style={s.dotFilled} />
          <View style={s.routeLine} />
          <View style={s.dotOutline} />
        </View>
        <View style={{ flex: 1, gap: 10 }}>
          <Text style={s.routeText} numberOfLines={1}>{p.from}</Text>
          <Text style={s.routeText} numberOfLines={1}>{p.to}</Text>
        </View>
      </View>

      {/* Meta row */}
      <View style={s.meta}>
        {p.price != null && (
          <View style={s.metaChip}>
            <Ionicons name="cash-outline" size={13} color={ORANGE} />
            <Text style={[s.metaLabel, { color: ORANGE, fontWeight: '700' }]}>${p.price.toFixed(2)}/seat</Text>
          </View>
        )}
        <View style={s.metaChip}>
          <Ionicons name="people-outline" size={13} color={MUTED} />
          <Text style={s.metaLabel}>{p.seats} seat{p.seats !== 1 ? 's' : ''}</Text>
        </View>
        {p.distance ? (
          <View style={s.metaChip}>
            <Ionicons name="navigate-outline" size={13} color={MUTED} />
            <Text style={s.metaLabel}>{p.distance}</Text>
          </View>
        ) : null}
      </View>

      {p.vibes.length > 0 && (
        <View style={s.vibes}>
          {p.vibes.map((v) => (
            <View key={v} style={s.vibeTag}>
              <Text style={s.vibeText}>{v}</Text>
            </View>
          ))}
        </View>
      )}

      {p.notes ? (
        <Text style={s.notes} numberOfLines={2}>{p.notes}</Text>
      ) : null}

      {/* Incoming booking requests */}
      {incomingRequests.map((req) => {
        const isActing = actingOnRequest === req.id;
        return (
          <View key={req.id} style={s.requestRow}>
            {/* Tappable rider info → opens rider profile */}
            <TouchableOpacity
              style={s.requestRowTop}
              activeOpacity={0.7}
              onPress={() => req.riderId && router.push({
                pathname: '/(driver)/rider/[id]',
                params: { id: req.riderId, returnTo: '/(driver)/my-postings' },
              } as any)}
              disabled={!req.riderId}
            >
              <View style={s.requestDot} />
              <View style={{ flex: 1 }}>
                <Text style={s.requestName}>{req.riderName}</Text>
                {req.passengers > 0 && (
                  <Text style={s.requestMeta}>
                    {req.passengers} passenger{req.passengers !== 1 ? 's' : ''}
                    {req.contributionAmount != null ? ` · $${req.contributionAmount.toFixed(2)}` : ''}
                  </Text>
                )}
              </View>
              {req.riderId ? (
                <Ionicons name="chevron-forward" size={15} color={MUTED} />
              ) : null}
            </TouchableOpacity>

            <View style={s.requestActions}>
              <TouchableOpacity
                style={s.msgBtn}
                activeOpacity={0.75}
                onPress={() => onMessage(req)}
                disabled={!req.riderId}
              >
                <Ionicons name="chatbubble-outline" size={14} color={NAVY} />
                <Text style={s.msgBtnText}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.acceptBtn, isActing && { opacity: 0.6 }]}
                onPress={() => onAccept(req)}
                disabled={isActing}
                activeOpacity={0.8}
              >
                {isActing
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Text style={s.acceptBtnText}>Accept</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.declineBtn, isActing && { opacity: 0.6 }]}
                onPress={() => onDecline(req)}
                disabled={isActing}
                activeOpacity={0.8}
              >
                <Text style={s.declineBtnText}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Actions */}
      {!isPast && (
        <View style={[s.actions, hasRequests && s.actionsDivided]}>
          <TouchableOpacity style={s.editBtn} onPress={onEdit} activeOpacity={0.8}>
            <Ionicons name="pencil-outline" size={14} color={NAVY} />
            <Text style={s.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.cancelBtn, cancelling && { opacity: 0.6 }]}
            onPress={onCancel}
            disabled={cancelling}
            activeOpacity={0.8}
          >
            {cancelling
              ? <ActivityIndicator size="small" color="#DC2626" />
              : <>
                  <Ionicons name="close-outline" size={14} color="#DC2626" />
                  <Text style={s.cancelBtnText}>Cancel Ride</Text>
                </>}
          </TouchableOpacity>
        </View>
      )}

      <FlagRideModal
        visible={flagVisible}
        rideId={confirmedId || null}
        role="driver"
        onClose={() => setFlagVisible(false)}
        onFlagged={() => setFlagVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  header: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center',
    paddingTop: 8, paddingBottom: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF', borderWidth: 1, borderColor: BORDER,
  },
  headerTitle: {
    flex: 1, marginLeft: 12, fontSize: 24, lineHeight: 30,
    fontWeight: '700', color: NAVY,
  },
  newBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', backgroundColor: ORANGE,
  },
  tabs: {
    height: 46, flexDirection: 'row', marginBottom: 20,
    backgroundColor: '#EFEBE4', borderRadius: 14, padding: 3,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  tabActive: {
    backgroundColor: '#FFF', shadowColor: '#000', shadowOpacity: 0.06,
    shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  tabText: { fontSize: 13, fontWeight: '600', color: MUTED },
  tabTextActive: { color: NAVY, fontWeight: '700' },
  loadingWrap: { minHeight: 300, alignItems: 'center', justifyContent: 'center' },
  emptyState: {
    minHeight: 280, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF', borderWidth: 1, borderStyle: 'dashed', borderColor: BORDER,
    borderRadius: 18, paddingHorizontal: 28, paddingVertical: 32,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(222,93,32,0.1)',
  },
  emptyTitle: { marginTop: 16, fontSize: 18, fontWeight: '700', color: NAVY },
  emptyText: { marginTop: 7, fontSize: 13, lineHeight: 19, color: MUTED, textAlign: 'center' },
  postBtn: {
    minHeight: 44, marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: ORANGE, borderRadius: 22, paddingHorizontal: 24, justifyContent: 'center',
  },
  postBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  card: {
    backgroundColor: '#FFF', borderRadius: 18, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: BORDER,
    shadowColor: NAVY, shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  cardFlagBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center' },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  dateText: { fontSize: 12, color: MUTED, fontWeight: '500' },
  route: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  routeDots: { alignItems: 'center', paddingTop: 3 },
  dotFilled: { width: 8, height: 8, borderRadius: 4, backgroundColor: NAVY },
  routeLine: { width: 1.5, height: 22, backgroundColor: BORDER, marginVertical: 2 },
  dotOutline: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  routeText: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: NAVY },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F3EFE8', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5,
  },
  metaLabel: { fontSize: 12, color: MUTED, fontWeight: '600' },
  vibes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  vibeTag: { backgroundColor: 'rgba(222,93,32,0.08)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  vibeText: { fontSize: 12, color: ORANGE, fontWeight: '600' },
  notes: { fontSize: 13, color: MUTED, marginBottom: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionsDivided: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  editBtn: {
    minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5, backgroundColor: '#F3EFE8',
    borderRadius: 21, borderWidth: 1, borderColor: BORDER,
  },
  editBtnText: { fontSize: 13, fontWeight: '700', color: NAVY },
  cancelBtn: {
    minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 5, backgroundColor: '#FEF2F2',
    borderRadius: 21, borderWidth: 1, borderColor: '#FECACA',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
  requestRow: {
    marginTop: 12, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER,
  },
  requestRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  requestDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D97706' },
  requestName: { fontSize: 14, fontWeight: '700', color: NAVY },
  requestMeta: { fontSize: 12, color: MUTED, marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  msgBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, minHeight: 40, paddingHorizontal: 14,
    backgroundColor: '#F3EFE8', borderRadius: 20,
    borderWidth: 1, borderColor: BORDER,
  },
  msgBtnText: { fontSize: 13, fontWeight: '700', color: NAVY },
  acceptBtn: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: NAVY, borderRadius: 20,
  },
  acceptBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  declineBtn: {
    flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FEF2F2', borderRadius: 20, borderWidth: 1, borderColor: '#FECACA',
  },
  declineBtnText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
});
