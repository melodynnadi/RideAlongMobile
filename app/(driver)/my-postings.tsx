import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  collection, query, where, onSnapshot, doc, getDoc,
  updateDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { FlagRideModal } from '@/components/FlagRideModal';
import { useAppTheme } from '@/hooks/ThemeContext';
import { getOrCreateRideChat } from '@/src/services/chatAvailability';
import { createRoleNotification } from '@/src/services/notificationRecords';

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
  confirmedRideId?: string;
  createdAtMs: number;
};


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
    // seatsAvailable is the TOTAL seat count; availableSeats gets overwritten to mean
    // REMAINING seats once requests are accepted, so it must be checked last.
    seats: Number(r.seatsAvailable ?? r.seats ?? r.availableSeats ?? 1),
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
const ACTIVE_REQUEST_STATUSES = new Set(['pending', 'open', 'requested', 'request_sent', 'submitted']);

function isPendingBookingRequest(req: BookingRequest): boolean {
  const status = String(req.status || 'pending').replace(/[-\s]/g, '_').toLowerCase();
  return !req.confirmedRideId && ACTIVE_REQUEST_STATUSES.has(status);
}

function isPostingOutdated(p: Posting, now = Date.now(), hasActivity = false): boolean {
  const status = p.status.toLowerCase();
  if (INACTIVE_STATUSES.has(status)) return true;
  if (hasActivity) return false;
  if (!p.scheduledAt) return false;
  return p.scheduledAt.getTime() < now;
}

export default function MyPostingsScreen() {
  const { colors } = useAppTheme();
  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
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
      backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    },
    headerTitle: {
      flex: 1, marginLeft: 12, fontSize: 24, lineHeight: 30,
      fontWeight: '700', color: colors.textPrimary,
    },
    newBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary,
    },
    tabs: {
      height: 46, flexDirection: 'row', marginBottom: 20,
      backgroundColor: colors.bgSecondary, borderRadius: 18, padding: 3,
    },
    tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
    tabActive: {
      backgroundColor: colors.bgCard, shadowColor: colors.textPrimary, shadowOpacity: 0.06,
      shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
    },
    tabText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    tabTextActive: { color: colors.textPrimary, fontWeight: '700' },
    scheduleList: { gap: 14 },
    scheduleCard: {
      backgroundColor: colors.bgCard, borderRadius: 18, padding: 16, marginBottom: 0,
      borderWidth: 1, borderColor: colors.border,
      shadowColor: colors.textPrimary, shadowOpacity: 0.05, shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 }, elevation: 2,
    },
    scheduleCardPaused: { opacity: 0.78 },
    scheduleTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
    scheduleIcon: {
      width: 34, height: 34, borderRadius: 11, backgroundColor: colors.primaryDim,
      alignItems: 'center', justifyContent: 'center',
    },
    scheduleTitleWrap: { flex: 1, minWidth: 0 },
    scheduleTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 19, fontWeight: '800' },
    scheduleSub: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 2 },
    scheduleBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: colors.primaryDim },
    scheduleBadgePaused: { backgroundColor: colors.bgSecondary },
    scheduleBadgeText: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    scheduleBadgeTextPaused: { color: colors.textSecondary },
    scheduleRoute: { flexDirection: 'row', gap: 12, marginBottom: 14 },
    scheduleDots: { alignItems: 'center', paddingTop: 3 },
    scheduleDotStart: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary },
    scheduleLine: { width: 1.5, height: 22, backgroundColor: colors.border, marginVertical: 2 },
    scheduleDotEnd: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
    scheduleRouteTextWrap: { flex: 1, gap: 6 },
    scheduleRouteText: { color: colors.textPrimary, fontSize: 14, lineHeight: 18, fontWeight: '700' },
    scheduleMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
    scheduleMetaChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: colors.bgSecondary, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6,
    },
    scheduleMetaText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    scheduleActions: {
      flexDirection: 'row', gap: 8, paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    scheduleSecondaryBtn: {
      minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 6, backgroundColor: colors.bgSecondary,
      borderRadius: 21, borderWidth: 1, borderColor: colors.border,
    },
    scheduleSecondaryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
    scheduleDangerBtn: {
      minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 6, backgroundColor: colors.redDim,
      borderRadius: 21, borderWidth: 1, borderColor: colors.redBorder,
    },
    scheduleDangerText: { color: colors.red, fontSize: 13, fontWeight: '800' },
    loadingWrap: { minHeight: 300, alignItems: 'center', justifyContent: 'center' },
    emptyState: {
      minHeight: 280, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.bgCard, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
      borderRadius: 18, paddingHorizontal: 28, paddingVertical: 32,
    },
    emptyIcon: {
      width: 56, height: 56, borderRadius: 28,
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDim,
    },
    emptyTitle: { marginTop: 16, fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    emptyText: { marginTop: 7, fontSize: 13, lineHeight: 19, color: colors.textSecondary, textAlign: 'center' },
    postBtn: {
      minHeight: 44, marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 24, justifyContent: 'center',
    },
    postBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  }), [colors]);
  const { goBack: handleBack } = useReturnNavigation('/(driver)');
  const [postings, setPostings] = useState<Posting[]>([]);
  const [loading, setLoading]   = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [tab, setTab]           = useState<'active' | 'past' | 'schedules'>('active');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [actingSchedule, setActingSchedule] = useState<string | null>(null);
  const [requestsByPostingId, setRequestsByPostingId] = useState<Record<string, BookingRequest[]>>({});
  const [actingOnRequest, setActingOnRequest] = useState<string | null>(null);
  const [confirmedIdByPostingId, setConfirmedIdByPostingId] = useState<Record<string, string>>({});
  const [confirmedRequestIds, setConfirmedRequestIds] = useState<Set<string>>(new Set());
  const [postingFullyCompleted, setPostingFullyCompleted] = useState<Set<string>>(new Set());

  // Subscribe to incoming rider booking requests for this driver's postings
  useEffect(() => {
    const uid   = firebaseAuth.currentUser?.uid;
    const email = firebaseAuth.currentUser?.email;
    if (!uid) return;

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
        if (!isPendingBookingRequest(r)) return;
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
      confirmedRideId: d.confirmedRideId || d.rideIdConfirmed || '',
      createdAtMs: d.createdAt?.toMillis?.() ?? d._localCreatedMs ?? 0,
    });

    const qA = query(collection(firestore, 'ridePostingRequests'), where('driverId', '==', uid));
    const unsubA = onSnapshot(qA, (snap) => {
      snapA.clear();
      snap.forEach((d) => {
        const r = toReq(d.id, d.data());
        if (isPendingBookingRequest(r)) snapA.set(d.id, r);
      });
      flush();
    }, (error) => {
      snapA.clear();
      flush();
      console.warn('[MyPostings] ridePostingRequests driverId listener error:', error);
    });

    let unsubB = () => {};
    if (email) {
      const qB = query(collection(firestore, 'ridePostingRequests'), where('driverEmail', '==', email));
      unsubB = onSnapshot(qB, (snap) => {
        snapB.clear();
        snap.forEach((d) => {
          const r = toReq(d.id, d.data());
          if (isPendingBookingRequest(r)) snapB.set(d.id, r);
        });
        flush();
      }, (error) => {
        snapB.clear();
        flush();
        console.warn('[MyPostings] ridePostingRequests driverEmail listener error:', error);
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
      const requestIds = new Set<string>();
      const byPosting: Record<string, string[]> = {};
      snap.forEach((d) => {
        const data = d.data() as any;
        const postingId = data.ridePostingId;
        if (postingId) {
          map[String(postingId)] = d.id;
          (byPosting[String(postingId)] = byPosting[String(postingId)] || []).push(String(data.status || '').toUpperCase());
        }
        const requestId = data.ridePostingRequestId || data.bookingRequestId || data.requestId;
        if (requestId) requestIds.add(String(requestId));
      });
      // A posting's own `status` field never transitions past 'confirmed' once the
      // trip actually finishes — that only happens on the individual confirmedRides
      // docs. Derive true completion here so it doesn't show as active forever.
      const fullyCompleted = new Set<string>();
      Object.entries(byPosting).forEach(([pid, statuses]) => {
        if (statuses.length > 0 && statuses.every((s) => s === 'COMPLETED')) fullyCompleted.add(pid);
      });
      setConfirmedIdByPostingId(map);
      setConfirmedRequestIds(requestIds);
      setPostingFullyCompleted(fullyCompleted);
    }, (error) => {
      setConfirmedIdByPostingId({});
      setConfirmedRequestIds(new Set());
      setPostingFullyCompleted(new Set());
      console.warn('[MyPostings] confirmedRides listener error:', error);
    });
  }, []);

  // Load recurring schedules when Schedules tab is opened
  useEffect(() => {
    if (tab !== 'schedules') return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    setSchedulesLoading(true);
    (async () => {
      try {
        const token = await firebaseAuth.currentUser?.getIdToken();
        const res = await fetch(`${getApiBaseUrl()}/api/ride-schedules/driver/${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setSchedules(data.schedules || []);
        }
      } catch (e) { console.warn('fetch schedules error', e); }
      finally { setSchedulesLoading(false); }
    })();
  }, [tab]);

  const handleScheduleAction = async (scheduleId: string, action: 'pause' | 'resume' | 'cancel') => {
    if (action === 'cancel') {
      Alert.alert('Cancel schedule?', 'All future unbooked rides in this schedule will be cancelled. Riders who already booked a seat are unaffected.', [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel schedule', style: 'destructive', onPress: () => doScheduleAction(scheduleId, 'cancel') },
      ]);
    } else {
      doScheduleAction(scheduleId, action);
    }
  };

  const doScheduleAction = async (scheduleId: string, action: 'pause' | 'resume' | 'cancel') => {
    setActingSchedule(scheduleId);
    try {
      const token = await firebaseAuth.currentUser?.getIdToken();
      const res = await fetch(`${getApiBaseUrl()}/api/ride-schedules/${scheduleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed');
      }
      setSchedules(prev => action === 'cancel'
        ? prev.filter(s => s.id !== scheduleId)
        : prev.map(s => s.id === scheduleId ? { ...s, status: action === 'pause' ? 'paused' : 'active' } : s));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not update schedule. Please try again.');
    } finally {
      setActingSchedule(null);
    }
  };

  const acceptRequest = useCallback(async (req: BookingRequest) => {
    setActingOnRequest(req.id);
    try {
      const uid = firebaseAuth.currentUser?.uid;
      if (!uid) throw new Error('Driver is not signed in');

      const driverSnap = await getDoc(doc(firestore, 'drivers', uid));
      const driver = driverSnap.exists() ? (driverSnap.data() as any) : {};
      const driverName = [driver.firstName, driver.lastName].filter(Boolean).join(' ').trim()
        || driver.personalInfo?.fullName || driver.displayName || driver.name || 'Driver';
      const driverEmail = driver.personalInfo?.email || driver.email || firebaseAuth.currentUser?.email || '';

      // Accept via the backend — it owns seat allocation, auto-rejection of
      // surplus requests, and creating/updating the canonical confirmedRides doc.
      const base = getApiBaseUrl();
      const token = await firebaseAuth.currentUser?.getIdToken();
      const resp = await fetch(`${base}/api/ride-postings/${encodeURIComponent(req.ridePostingId)}/requests/${encodeURIComponent(req.id)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ driverId: uid, driverName, driverEmail }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({} as any));
        throw new Error(j?.error || 'Failed to accept request');
      }

      setRequestsByPostingId((prev) => {
        const next: Record<string, BookingRequest[]> = {};
        Object.entries(prev).forEach(([postingId, requests]) => {
          const remaining = requests.filter((item) => item.id !== req.id);
          if (remaining.length) next[postingId] = remaining;
        });
        return next;
      });
      await createRoleNotification({
        recipientId: req.riderId,
        recipientRole: 'rider',
        type: 'ride_accepted',
        title: 'Your ride is confirmed',
        message: 'Your request for this posted ride was accepted.',
        driverId: uid,
        riderId: req.riderId,
        ridePostingId: req.ridePostingId,
        ridePostingRequestId: req.id,
        dedupeId: `posting-request-${req.id}-accepted-rider`,
      }).catch(() => {});
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not accept the request. Please try again.');
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
      const chatId = await getOrCreateRideChat({
        context: 'booking-request',
        rideId: req.ridePostingId || req.id,
        driverId: uid,
        riderId: req.riderId,
        ridePostingId: req.ridePostingId || null,
        ridePostingRequestId: req.id,
      });
      router.push(`/(driver)/messages/${chatId}` as any);
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
    }, (error) => {
      snapA = [];
      flush();
      console.warn('[MyPostings] ridePostings driverId listener error:', error);
    });

    let unsubB = () => {};
    if (email) {
      const qB = query(collection(firestore, 'ridePostings'), where('driverEmail', '==', email));
      unsubB = onSnapshot(qB, (snap) => {
        snapB = snap.docs.map((d) => toPosting(d.id, d.data()));
        flush();
      }, (error) => {
        snapB = [];
        flush();
        console.warn('[MyPostings] ridePostings driverEmail listener error:', error);
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
  const hasPostingActivity = (p: Posting) => {
    const incoming = (requestsByPostingId[p.id] || []).filter((req) => isPendingBookingRequest(req) && !confirmedRequestIds.has(req.id));
    return incoming.length > 0 || Boolean(confirmedIdByPostingId[p.id]);
  };
  const active = postings.filter((p) => !postingFullyCompleted.has(p.id) && ACTIVE_STATUSES.has(p.status) && !isPostingOutdated(p, now, hasPostingActivity(p)) && !p.raw?.isRecurring);
  const past = postings.filter((p) => (postingFullyCompleted.has(p.id) || INACTIVE_STATUSES.has(p.status) || isPostingOutdated(p, now, hasPostingActivity(p))) && !p.raw?.isRecurring);
  const shown  = tab === 'active' ? active : past;

  return (
    <View style={s.root}>
      <StatusBar style={colors.statusBar === 'dark-content' ? 'dark' : 'light'} />
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
              <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>My Postings</Text>
            <TouchableOpacity
              onPress={() => router.push('/(driver)/book' as any)}
              style={s.newBtn}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Post a new ride"
            >
              <Ionicons name="add" size={23} color={colors.textInverse} />
            </TouchableOpacity>
          </View>

          <View style={s.tabs}>
            {(['active', 'past', 'schedules'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.tab, tab === t && s.tabActive]}
                onPress={() => setTab(t)}
                activeOpacity={0.75}
              >
                <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                  {t === 'active' ? `Active (${active.length})` : t === 'past' ? `Past (${past.length})` : '↻ Recurring'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'schedules' ? (
            schedulesLoading ? (
              <View style={s.loadingWrap}><ActivityIndicator color={colors.primary} size="large" /></View>
            ) : schedules.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="calendar-outline" size={32} color={colors.primary} style={{ marginBottom: 12 }} />
                <Text style={s.emptyTitle}>No recurring schedules</Text>
                <Text style={s.emptyText}>Use Post a ride and turn on Repeat weekly to create one.</Text>
              </View>
            ) : (
              <View style={s.scheduleList}>
                {schedules.map(schedule => {
                  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                  const days = (schedule.daysOfWeek || []).map((d: number) => DAY_LABELS[d]).join(', ') || 'Weekly';
                  const isPaused = schedule.status === 'paused';
                  const isActing = actingSchedule === schedule.id;
                  return (
                    <View key={schedule.id} style={[s.scheduleCard, isPaused && s.scheduleCardPaused]}>
                      <View style={s.scheduleTop}>
                        <View style={s.scheduleIcon}>
                          <Ionicons name="repeat-outline" size={17} color={isPaused ? colors.textSecondary : colors.primary} />
                        </View>
                        <View style={s.scheduleTitleWrap}>
                          <Text style={s.scheduleTitle} numberOfLines={1}>Recurring ride</Text>
                          <Text style={s.scheduleSub} numberOfLines={1}>Every {days}</Text>
                        </View>
                        <View style={[s.scheduleBadge, isPaused && s.scheduleBadgePaused]}>
                          <Text style={[s.scheduleBadgeText, isPaused && s.scheduleBadgeTextPaused]}>
                            {isPaused ? 'PAUSED' : 'ACTIVE'}
                          </Text>
                        </View>
                      </View>

                      <View style={s.scheduleRoute}>
                        <View style={s.scheduleDots}>
                          <View style={s.scheduleDotStart} />
                          <View style={s.scheduleLine} />
                          <View style={s.scheduleDotEnd} />
                        </View>
                        <View style={s.scheduleRouteTextWrap}>
                          <Text style={s.scheduleRouteText} numberOfLines={1}>{schedule.from || 'Pickup not set'}</Text>
                          <Text style={s.scheduleRouteText} numberOfLines={1}>{schedule.to || 'Dropoff not set'}</Text>
                        </View>
                      </View>

                      <View style={s.scheduleMeta}>
                        <View style={s.scheduleMetaChip}>
                          <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                          <Text style={s.scheduleMetaText}>{schedule.departureTime || 'Time TBD'}</Text>
                        </View>
                        <View style={s.scheduleMetaChip}>
                          <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
                          <Text style={s.scheduleMetaText}>{schedule.seats || 1} seat{schedule.seats === 1 ? '' : 's'}</Text>
                        </View>
                        <View style={s.scheduleMetaChip}>
                          <Ionicons name="cash-outline" size={13} color={colors.textSecondary} />
                          <Text style={s.scheduleMetaText}>${schedule.pricePerSeat || 0}/seat</Text>
                        </View>
                      </View>

                      <View style={s.scheduleActions}>
                        <TouchableOpacity
                          disabled={isActing}
                          onPress={() => handleScheduleAction(schedule.id, isPaused ? 'resume' : 'pause')}
                          style={s.scheduleSecondaryBtn}
                        >
                          {isActing ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <>
                              <Ionicons name={isPaused ? 'play-outline' : 'pause-outline'} size={15} color={colors.textPrimary} />
                              <Text style={s.scheduleSecondaryText}>{isPaused ? 'Resume' : 'Pause'}</Text>
                            </>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          disabled={isActing}
                          onPress={() => handleScheduleAction(schedule.id, 'cancel')}
                          style={s.scheduleDangerBtn}
                        >
                          <Ionicons name="trash-outline" size={15} color={colors.red} />
                          <Text style={s.scheduleDangerText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )
          ) : loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : shown.length === 0 ? (
            <View style={s.emptyState}>
              <View style={s.emptyIcon}>
                <Ionicons name="car-outline" size={28} color={colors.primary} />
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
                  <Ionicons name="add" size={18} color={colors.textInverse} />
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
              incomingRequests={(requestsByPostingId[p.id] || []).filter((req) => isPendingBookingRequest(req) && !confirmedRequestIds.has(req.id))}
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
  const { colors } = useAppTheme();
  const ps = useMemo(() => StyleSheet.create({
    card: {
      backgroundColor: colors.bgCard, borderRadius: 18, padding: 16, marginBottom: 14,
      borderWidth: 1, borderColor: colors.border,
      shadowColor: colors.textPrimary, shadowOpacity: 0.05, shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 }, elevation: 2,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
    cardFlagBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.redDim, alignItems: 'center', justifyContent: 'center' },
    statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
    dateText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
    route: { flexDirection: 'row', gap: 12, marginBottom: 14 },
    routeDots: { alignItems: 'center', paddingTop: 3 },
    dotFilled: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary },
    routeLine: { width: 1.5, height: 22, backgroundColor: colors.border, marginVertical: 2 },
    dotOutline: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
    routeText: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: colors.textPrimary },
    meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
    metaChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.bgSecondary, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5,
    },
    metaLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
    vibes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
    vibeTag: { backgroundColor: colors.primaryDim, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
    vibeText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
    notes: { fontSize: 13, color: colors.textSecondary, marginBottom: 12, lineHeight: 18 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    actionsDivided: {
      marginTop: 16,
      paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    editBtn: {
      minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 5, backgroundColor: colors.bgSecondary,
      borderRadius: 21, borderWidth: 1, borderColor: colors.border,
    },
    editBtnText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    cancelBtn: {
      minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 5, backgroundColor: colors.redDim,
      borderRadius: 21, borderWidth: 1, borderColor: colors.redBorder,
    },
    cancelBtnText: { fontSize: 13, fontWeight: '700', color: colors.red },
    requestRow: {
      marginTop: 12, paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    requestRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    requestDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amber },
    requestName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    requestMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    requestActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
    msgBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 5, minHeight: 40, paddingHorizontal: 14,
      backgroundColor: colors.bgSecondary, borderRadius: 20,
      borderWidth: 1, borderColor: colors.border,
    },
    msgBtnText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    acceptBtn: {
      flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.textPrimary, borderRadius: 20,
    },
    acceptBtnText: { fontSize: 13, fontWeight: '700', color: colors.textInverse },
    declineBtn: {
      flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.redDim, borderRadius: 20, borderWidth: 1, borderColor: colors.redBorder,
    },
    declineBtnText: { fontSize: 13, fontWeight: '700', color: colors.red },
  }), [colors]);

  const hasRequests = incomingRequests.length > 0;
  const [flagVisible, setFlagVisible] = useState(false);
  const isExpired = isPostingOutdated(p, Date.now(), hasRequests || Boolean(confirmedId));

  const statusLabel = p.status === 'cancelled' ? 'Cancelled'
    : p.status === 'completed' ? 'Completed'
    : isExpired ? 'Expired'
    : p.status === 'expired' ? 'Expired'
    : hasRequests ? `${incomingRequests.length} Request${incomingRequests.length > 1 ? 's' : ''}`
    : 'Active';

  const statusColor = p.status === 'cancelled' ? colors.red
    : p.status === 'completed' ? colors.green
    : isExpired ? colors.textSecondary
    : hasRequests ? colors.amber
    : colors.primary;

  return (
    <View style={ps.card}>
      {/* Status row */}
      <View style={ps.cardTop}>
        <View style={[ps.statusPill, { backgroundColor: `${statusColor}15` }]}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor, marginRight: 5 }} />
          <Text style={[ps.statusText, { color: statusColor }]}>{statusLabel.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          {(p.date || p.time) ? (
            <Text style={ps.dateText}>{[p.date, p.time].filter(Boolean).join(' - ')}</Text>
          ) : null}
          {confirmedId ? (
            <TouchableOpacity style={ps.cardFlagBtn} onPress={() => setFlagVisible(true)} activeOpacity={0.75}>
              <Ionicons name="flag-outline" size={14} color={colors.red} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Route */}
      <View style={ps.route}>
        <View style={ps.routeDots}>
          <View style={ps.dotFilled} />
          <View style={ps.routeLine} />
          <View style={ps.dotOutline} />
        </View>
        <View style={{ flex: 1, gap: 10 }}>
          <Text style={ps.routeText} numberOfLines={1}>{p.from}</Text>
          <Text style={ps.routeText} numberOfLines={1}>{p.to}</Text>
        </View>
      </View>

      {/* Meta row */}
      <View style={ps.meta}>
        {p.price != null && (
          <View style={ps.metaChip}>
            <Ionicons name="cash-outline" size={13} color={colors.primary} />
            <Text style={[ps.metaLabel, { color: colors.primary, fontWeight: '700' }]}>${p.price.toFixed(2)}/seat</Text>
          </View>
        )}
        <View style={ps.metaChip}>
          <Ionicons name="people-outline" size={13} color={colors.textSecondary} />
          <Text style={ps.metaLabel}>{p.seats} seat{p.seats !== 1 ? 's' : ''}</Text>
        </View>
        {p.distance ? (
          <View style={ps.metaChip}>
            <Ionicons name="navigate-outline" size={13} color={colors.textSecondary} />
            <Text style={ps.metaLabel}>{p.distance}</Text>
          </View>
        ) : null}
      </View>

      {p.vibes.length > 0 && (
        <View style={ps.vibes}>
          {p.vibes.map((v) => (
            <View key={v} style={ps.vibeTag}>
              <Text style={ps.vibeText}>{v}</Text>
            </View>
          ))}
        </View>
      )}

      {p.notes ? (
        <Text style={ps.notes} numberOfLines={2}>{p.notes}</Text>
      ) : null}

      {/* Incoming booking requests */}
      {incomingRequests.map((req) => {
        const isActing = actingOnRequest === req.id;
        return (
          <View key={req.id} style={ps.requestRow}>
            {/* Tappable rider info → opens rider profile */}
            <TouchableOpacity
              style={ps.requestRowTop}
              activeOpacity={0.7}
              onPress={() => req.riderId && router.push({
                pathname: '/(driver)/rider/[id]',
                params: { id: req.riderId, returnTo: '/(driver)/my-postings' },
              } as any)}
              disabled={!req.riderId}
            >
              <View style={ps.requestDot} />
              <View style={{ flex: 1 }}>
                <Text style={ps.requestName}>{req.riderName}</Text>
                {req.passengers > 0 && (
                  <Text style={ps.requestMeta}>
                    {req.passengers} passenger{req.passengers !== 1 ? 's' : ''}
                    {req.contributionAmount != null ? ` · $${req.contributionAmount.toFixed(2)}` : ''}
                  </Text>
                )}
              </View>
              {req.riderId ? (
                <Ionicons name="chevron-forward" size={15} color={colors.textSecondary} />
              ) : null}
            </TouchableOpacity>

            <View style={ps.requestActions}>
              <TouchableOpacity
                style={ps.msgBtn}
                activeOpacity={0.75}
                onPress={() => onMessage(req)}
                disabled={!req.riderId}
              >
                <Ionicons name="chatbubble-outline" size={14} color={colors.textPrimary} />
                <Text style={ps.msgBtnText}>Message</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[ps.acceptBtn, isActing && { opacity: 0.6 }]}
                onPress={() => onAccept(req)}
                disabled={isActing}
                activeOpacity={0.8}
              >
                {isActing
                  ? <ActivityIndicator size="small" color={colors.textInverse} />
                  : <Text style={ps.acceptBtnText}>Accept</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[ps.declineBtn, isActing && { opacity: 0.6 }]}
                onPress={() => onDecline(req)}
                disabled={isActing}
                activeOpacity={0.8}
              >
                <Text style={ps.declineBtnText}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Actions */}
      {!isPast && (
        <View style={[ps.actions, hasRequests && ps.actionsDivided]}>
          <TouchableOpacity style={ps.editBtn} onPress={onEdit} activeOpacity={0.8}>
            <Ionicons name="pencil-outline" size={14} color={colors.textPrimary} />
            <Text style={ps.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[ps.cancelBtn, cancelling && { opacity: 0.6 }]}
            onPress={onCancel}
            disabled={cancelling}
            activeOpacity={0.8}
          >
            {cancelling
              ? <ActivityIndicator size="small" color={colors.red} />
              : <>
                  <Ionicons name="close-outline" size={14} color={colors.red} />
                  <Text style={ps.cancelBtnText}>Cancel Ride</Text>
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
