import { FlagRideModal } from '@/components/FlagRideModal';
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Image, Share, Linking, Dimensions, RefreshControl, useColorScheme, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { X, MapPin, Clock, User, Star, DollarSign, Bell, Leaf, Gift, MessageSquare, Shield, Calendar, Megaphone, Flag, Phone, TrendingUp, MessageCircle, Share2 } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { router, useFocusEffect } from 'expo-router';
import { usePromotions } from '@/hooks/usePromotions';
import PromotionCard from '@/components/PromotionCard';
import PromotionDetailsModal from '@/components/PromotionDetailsModal';
import { Promotion } from '@/types';
import { firestore, firebaseAuth, storage, functions } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { httpsCallable } from 'firebase/functions';
import { Button } from '@/components/ui/Button';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { AddressLink } from '@/components/AddressLink';
import {
  collection, onSnapshot, query, where, getCountFromServer,
  getDocs, doc, getDoc, Timestamp, limit as fsLimit,
  updateDoc, setDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import RatingModal from '@/components/RatingModal';
import StudentVerificationBanner from '@/components/StudentVerificationBanner';
import { fetchVerificationStatus, setupVerificationListener, cleanupVerificationListener } from '@/services/verification';
import { showSuccessToast, showErrorToast, showInfoToast, rideToasts } from '@/src/utils/showToast';

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  orange:       '#F4621F',
  orangeLight:  '#FF8C4A',
  orangeGlow:   'rgba(244,98,31,0.15)',
  orangeBorder: 'rgba(244,98,31,0.45)',
  navy:         '#0D1B2A',
  green:        '#10B981',
  darkBg:       '#080E17',
  darkCard:     'rgba(255,255,255,0.07)',
  darkBorder:   'rgba(255,255,255,0.12)',
  darkText:     '#F0F4FF',
  darkSub:      '#7A8FA8',
  lightBg:      '#F2F4F8',
  lightCard:    'rgba(255,255,255,0.85)',
  lightBorder:  'rgba(255,255,255,0.9)',
  lightText:    '#0D1B2A',
  lightSub:     '#5A6A7E',
};

function useAppTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    bg:     dark ? COLORS.darkBg     : COLORS.lightBg,
    card:   dark ? COLORS.darkCard   : COLORS.lightCard,
    border: dark ? COLORS.darkBorder : COLORS.lightBorder,
    text:   dark ? COLORS.darkText   : COLORS.lightText,
    sub:    dark ? COLORS.darkSub    : COLORS.lightSub,
  };
}

// ─── Types (unchanged) ────────────────────────────────────────────────────────
type UpcomingRideCard = {
  id: string; type: 'ride' | 'rideRequest' | 'confirmedRide'; status: string;
  from: string; to: string; dateTime: Date | null; etaText?: string;
  durationText?: string; priceText?: string; distanceText?: string;
  driverName?: string; driverRating?: number | null; vehicleText?: string;
  driverPhone?: string | null; rideRequestId?: string | null;
  ridePostingId?: string | null; riderId?: string | null;
};

type OfferInfo = {
  id: string; rideRequestId: string; status: string; priceText?: string;
  priceNumber?: number; distanceText?: string; durationText?: string;
  driverName?: string; driverId?: string; driverEmail?: string;
  driverPhone?: string; ridePostingId?: string | null; createdAt?: Date | null;
};

// ─── Helper functions (ALL UNCHANGED) ─────────────────────────────────────────
const extractAddress = (obj: any, type: 'pickup' | 'dropoff' | 'destination'): string | null => {
  if (!obj) return null;
  if (type === 'pickup') {
    const addr = obj.pickup || obj.pickupLocation || obj.pickupAddress || obj.from || obj.origin;
    if (typeof addr === 'object' && addr !== null) return addr.address || addr.formatted_address || addr.description || addr.name || null;
    return typeof addr === 'string' ? addr : null;
  } else if (type === 'dropoff') {
    const addr = obj.dropoff || obj.dropoffLocation || obj.dropoffAddress || obj.to || obj.destination;
    if (typeof addr === 'object' && addr !== null) return addr.address || addr.formatted_address || addr.description || addr.name || null;
    return typeof addr === 'string' ? addr : null;
  } else {
    const addr = obj.destination || obj.dropoff || obj.dropoffLocation || obj.to;
    if (typeof addr === 'object' && addr !== null) return addr.address || addr.formatted_address || addr.description || addr.name || null;
    return typeof addr === 'string' ? addr : null;
  }
};

const extractDistance = (obj: any): string | undefined => {
  if (!obj) return undefined;
  const dist = obj.distance || obj.estimatedDistance || obj.distanceText;
  if (typeof dist === 'number') return `${dist.toFixed(1)} mi`;
  if (typeof dist === 'string') return dist;
  return undefined;
};

const getRideDateTime = (obj: any): Date | null => {
  if (!obj) return null;
  if (obj.date || obj.time) { const dt = composeDateTime(obj.date, obj.time); if (dt) return dt; }
  if (obj.pickupTime?.toDate) return obj.pickupTime.toDate();
  if (obj.requestedTime?.toDate) return obj.requestedTime.toDate();
  if (obj.scheduledTime?.toDate) return obj.scheduledTime.toDate();
  if (obj.createdAt?.toDate) return obj.createdAt.toDate();
  return null;
};

const composeDateTime = (dateField: any, timeField: any): Date | null => {
  try {
    let dateStr = ''; let timeStr = '';
    if (dateField) { if (dateField.toDate) dateStr = dateField.toDate().toISOString().split('T')[0]; else if (typeof dateField === 'string') dateStr = dateField; }
    if (timeField && typeof timeField === 'string') timeStr = timeField;
    if (dateStr && timeStr) {
      const timeMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10); const minutes = parseInt(timeMatch[2], 10); const meridiem = timeMatch[3].toUpperCase();
        if (meridiem === 'PM' && hours < 12) hours += 12; else if (meridiem === 'AM' && hours === 12) hours = 0;
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day, hours, minutes, 0, 0);
      }
      return new Date(`${dateStr}T${timeStr}`);
    } else if (dateStr) { const [year, month, day] = dateStr.split('-').map(Number); return new Date(year, month - 1, day); }
  } catch {}
  return null;
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const theme = useAppTheme();
  const oldTheme = useTheme();
  const [selectedRide, setSelectedRide] = useState<UpcomingRideCard | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDriver, setModalDriver] = useState<{ name?: string; rating?: number | null; phone?: string | null; phoneFromProfile?: boolean; avatarUrl?: string | null; vehicleText?: string; driverId?: string; } | null>(null);
  const [modalDistanceText, setModalDistanceText] = useState<string | undefined>(undefined);
  const [upcoming, setUpcoming] = useState<UpcomingRideCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalRides: 0, spent: 0, avgRating: null as number | null });
  const [offersByRideId, setOffersByRideId] = useState<Record<string, OfferInfo>>({});
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [currentPromotionIndex, setCurrentPromotionIndex] = useState(0);
  const statsSourcesRef = useRef<{ hist: Map<string, { spent: number; rating?: number | null }>; conf: Map<string, { spent: number }>}>({ hist: new Map(), conf: new Map() });
  const validRideIdsRef = useRef<Set<string>>(new Set());
  const ratingsByRideIdRef = useRef<Map<string, { stars: number; createdAt?: number }>>(new Map());
  const notifReadMapRef = useRef<Record<string, boolean>>({});
  const confirmedIndexRef = useRef<Record<string, { docId: string; status: 'confirmed'|'in_progress'|'completed'|'flagged'; flags?: any }>>({});
  const confirmedKeysRef = useRef<Set<string>>(new Set());
  const [recent, setRecent] = useState<UpcomingRideCard[]>([]);
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flaggingRideId, setFlaggingRideId] = useState<string | null>(null);
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<{ rideId: string; driverName?: string } | null>(null);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratedRideIds, setRatedRideIds] = useState<Set<string>>(new Set());
  const completedSeenRef = useRef<Set<string>>(new Set());
  const confirmedFallbackSetupRef = useRef<boolean>(false);
  const promotionsScrollRef = useRef<ScrollView>(null);

  const { promotions, claimedPromotions, loading: promotionsLoading, error: promotionsError, refreshPromotions, claimPromotion, isPromotionClaimed } = usePromotions();
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [promotionModalVisible, setPromotionModalVisible] = useState(false);

  const shareReferral = useCallback(async () => {
    const uid2 = firebaseAuth.currentUser?.uid; const email2 = firebaseAuth.currentUser?.email;
    const code = uid2 || (email2 ? encodeURIComponent(email2) : 'guest');
    const link = `https://ridealong.app/referral?r=${code}`;
    try { await Share.share({ message: `Join me on RideAlong and earn ride credits: ${link}` }); } catch { Alert.alert('Unable to share right now'); }
  }, []);

  const handlePromotionPress = useCallback((promotion: Promotion) => { setSelectedPromotion(promotion); setPromotionModalVisible(true); }, []);
  const handleClaimPromotion = useCallback(async (promotionId: string) => {
    try { await claimPromotion(promotionId); showSuccessToast('Promotion Claimed', 'Offer added to your account'); setPromotionModalVisible(false); }
    catch (error) { const message = error instanceof Error ? error.message : 'Failed to claim promotion'; showErrorToast('Claim Failed', message); }
  }, [claimPromotion]);

  const uid = firebaseAuth.currentUser?.uid ?? null;
  const email = firebaseAuth.currentUser?.email ?? null;
  const submitRating = useMemo(() => httpsCallable(functions, 'submitRating'), []);

  const logicalRideKey = (r: any, docId: string) => { const rrid = r?.rideRequestId ?? r?.originalRideRequest?.id; return rrid ? `rr_${rrid}` : `cr_${docId}`; };
  const uLogicalKey = (it: UpcomingRideCard) => {
    if (it.type === 'confirmedRide') { const rrid = it.rideRequestId ?? (typeof it.id === 'string' ? it.id : undefined); return rrid ? `rr_${rrid}` : `cr_${it.id}`; }
    if (it.type === 'rideRequest') return `rr_${it.id}`;
    return `${it.type}_${it.id}`;
  };

  const prettyStatus = (status: string, type?: string) => {
    const s = String(status || '').toLowerCase();
    if (s === 'driver_completed' || s === 'driver-completed') return 'In Progress';
    if (s === 'in_progress' || s === 'in-progress') return 'In Progress';
    if (s === 'confirmed' || s === 'matched') return 'Confirmed';
    if (s === 'pending') return 'Pending'; if (s === 'completed') return 'Completed';
    if (s === 'cancelled' || s === 'canceled') return 'Cancelled'; if (s === 'flagged') return 'Flagged';
    if (s === 'posted' || s === 'open') return 'Posted'; if (s === 'accepted') return 'Accepted';
    if (s === 'rejected' || s === 'declined') return 'Rejected';
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const extractFlags = (r: any) => ({
    driverPickupConfirmed: !!r?.driverPickupConfirmed, riderPickupConfirmed: !!r?.riderPickupConfirmed,
    driverCompleteConfirmed: !!r?.driverCompleteConfirmed, riderCompleteConfirmed: !!r?.riderCompleteConfirmed,
  });

  const mapConfirmedSnapshot = (docs: any[]): UpcomingRideCard[] => {
    const items: UpcomingRideCard[] = [];
    docs.forEach((d) => {
      try {
        const r = d as any; const docId = r.id as string; const status = r?.status || 'CONFIRMED'; const statusLower = String(status).toLowerCase();
        if (statusLower === 'completed') return;
        if (statusLower === 'flagged' && String(r?.statusAtFlag || '').toUpperCase() === 'COMPLETED') return;
        const from = extractAddress(r, 'pickup') || 'Pickup'; const to = extractAddress(r, 'dropoff') || 'Dropoff';
        const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
        const price = r?.contributionAmount; const priceText = typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined);
        items.push({ id: docId, type: 'confirmedRide', status, from, to, dateTime: dt, priceText, driverName: r?.driverName, driverRating: typeof r?.driverRating === 'number' ? r.driverRating : null, vehicleText: r?.vehicleText || r?.vehicle, driverPhone: r?.driverPhone, rideRequestId: r?.rideRequestId ?? r?.originalRideRequest?.id ?? null, ridePostingId: r?.ridePostingId ?? null, riderId: r?.riderId ?? null });
        const key = logicalRideKey(r, docId);
        const statusForIndex = ['in-progress', 'in_progress', 'driver_completed'].includes(statusLower) ? 'in_progress' : ['rider_completed'].includes(statusLower) ? 'completed' : ['flagged'].includes(statusLower) ? 'flagged' : ['completed'].includes(statusLower) ? 'completed' : 'confirmed';
        confirmedIndexRef.current[key] = { docId, status: statusForIndex as any, flags: extractFlags(r) };
        confirmedKeysRef.current.add(key);
      } catch {}
    });
    return items;
  };

  const mergeConfirmedIntoUpcoming = (mapped: UpcomingRideCard[]) => {
    setUpcoming((prev) => {
      const pruned = prev.filter((it) => { if (it.type !== 'confirmedRide') return true; const key = uLogicalKey(it); return confirmedKeysRef.current.has(key); });
      return mergeUpcoming(pruned, mapped);
    });
  };

  const recomputeStats = (_ratingsSumFromHist?: number, _ratingsCountFromHist?: number) => { return; };

  // ALL useEffects and handlers preserved exactly
  useEffect(() => {
    if (!uid) { setUpcoming([]); setLoading(false); return; }
    setLoading(true); notifReadMapRef.current = {}; setUnreadCount(0);
    const unsubs: Array<() => void> = [];
    (async () => {
      try {
        const userDoc = await getDoc(doc(firestore, 'riders', uid));
        const data = userDoc.exists() ? (userDoc.data() as any) : null;
        let firstName: string | undefined = getFirstNameFromProfile(data);
        let profilePhoto: string | undefined;
        if (data) profilePhoto = data.avatarUrl || data.photoURL || data.photoUrl;
        if (!firstName && email) {
          const q = query(collection(firestore, 'riders'), where('email', '==', email), fsLimit(1));
          const snap = await getDocs(q); const docData = snap.docs[0]?.data();
          firstName = getFirstNameFromProfile(docData);
          if (!profilePhoto && docData) profilePhoto = docData.avatarUrl || docData.photoURL || docData.photoUrl;
        }
        if (!firstName) { const dn = firebaseAuth.currentUser?.displayName || undefined; firstName = dn ? dn.split(' ')[0] : undefined; }
        if (!profilePhoto) { const authPhotoURL = firebaseAuth.currentUser?.photoURL; if (authPhotoURL) profilePhoto = authPhotoURL; }
        if (profilePhoto && typeof profilePhoto === 'string') setUserPhoto(profilePhoto);
        setUserName(firstName ?? (email ? email.split('@')[0] : null));
      } catch { setUserName(email ? email.split('@')[0] : null); }
    })();
    fetchVerificationStatus().catch(() => {});
    setupVerificationListener();

    const reqUserIdQ = query(collection(firestore, 'rideRequests'), where('userId', '==', uid), where('status', 'in', ['pending', 'posted', 'open', 'offered']));
    const unsubReqUserId = onSnapshot(reqUserIdQ, (snap) => {
      const items: UpcomingRideCard[] = [];
      snap.forEach((d) => {
        const r = d.data() as any; const requestedTime: Date | null = getRideDateTime(r);
        if (requestedTime) { const now = new Date(); const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); if (requestedTime < oneDayAgo) return; }
        const from = extractAddress(r, 'pickup') || 'Pickup'; const to = extractAddress(r, 'dropoff') || 'Dropoff';
        const price = r?.contributionAmount ?? r?.estimatedFare?.total ?? r?.estimatedFare;
        const statusKey = String(r?.status || '').toLowerCase();
        if (['confirmed','in-progress','in_progress','completed','accepted','matched','rejected','declined','canceled','cancelled','expired'].includes(statusKey)) return;
        items.push({ id: d.id, type: 'rideRequest', status: normalizeStatusForDisplay(r?.status), from, to, dateTime: requestedTime, durationText: typeof r?.duration === 'number' ? `${Math.round(r.duration)} min` : (typeof r?.duration === 'string' ? sanitizeDurationText(r.duration) : undefined), priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined), distanceText: extractDistance(r) });
      });
      setUpcoming((prev) => mergeUpcoming(prev, items));
    }, () => setLoading(false));
    unsubs.push(unsubReqUserId);

    const rprQ = query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', uid), where('status', 'in', ['pending', 'sent']));
    const unsubRpr = onSnapshot(rprQ, async (snap) => {
      const items: UpcomingRideCard[] = [];
      for (const d of snap.docs) {
        const r = d.data() as any; const requestedTime: Date | null = getRideDateTime(r);
        if (requestedTime) { const now = new Date(); const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); if (requestedTime < oneDayAgo) continue; }
        const postingId = r?.ridePostingId || r?.rideId;
        let pricePerSeat = null, pickupFromPosting = null, dropoffFromPosting = null, durationFromPosting = null, distanceFromPosting = null;
        if (postingId) {
          try {
            const postingDoc = await getDoc(doc(firestore, 'ridePostings', postingId));
            if (postingDoc.exists()) { const pd = postingDoc.data(); pricePerSeat = pd?.pricePerSeat ?? pd?.price; pickupFromPosting = pd?.pickupAddress || pd?.pickup || pd?.pickupLocation?.address || pd?.origin || pd?.from || null; dropoffFromPosting = pd?.dropoffAddress || pd?.dropoff || pd?.dropoffLocation?.address || pd?.destination || pd?.to || null; durationFromPosting = pd?.duration; distanceFromPosting = pd?.distance; }
          } catch {}
        }
        const from = pickupFromPosting || extractAddress(r, 'pickup') || 'Pickup';
        const to = dropoffFromPosting || extractAddress(r, 'dropoff') || extractAddress(r, 'destination') || 'Dropoff';
        const price = pricePerSeat ?? r?.contributionAmount;
        const statusKey = String(r?.status || r?.state || '').toLowerCase();
        if (['confirmed','in-progress','in_progress','completed','accepted','matched','rejected','declined','canceled','cancelled','expired'].includes(statusKey)) continue;
        items.push({ id: d.id, type: 'rideRequest', status: 'Offer Sent', from, to, dateTime: requestedTime, durationText: (typeof r?.duration === 'number' ? `${Math.round(r.duration)} min` : (typeof r?.duration === 'string' ? sanitizeDurationText(r.duration) : (typeof durationFromPosting === 'number' ? `${Math.round(durationFromPosting)} min` : (typeof durationFromPosting === 'string' ? sanitizeDurationText(durationFromPosting) : undefined)))), priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined), distanceText: extractDistance(r) || (typeof distanceFromPosting === 'number' ? `${distanceFromPosting.toFixed(1)} mi` : (typeof distanceFromPosting === 'string' ? distanceFromPosting : undefined)), ridePostingId: postingId || null });
      }
      setUpcoming((prev) => mergeUpcoming(prev, items));
    }, () => setLoading(false));
    unsubs.push(unsubRpr);

    try {
      const base = collection(firestore, 'notifications');
      const qUserId = query(base, where('userId', '==', uid)); const qRecipientId = query(base, where('recipientId', '==', uid));
      const qEmailUser = email ? query(base, where('userEmail', '==', email)) : null; const qRecipients = query(base, where('recipients', 'array-contains', uid));
      const mergeAndSet = (snapshot: any) => {
        const partial: Record<string, boolean> = {};
        snapshot.docs.forEach((d: any) => { const data = d.data() || {}; const readBy: string[] = Array.isArray(data.readBy) ? data.readBy : []; partial[d.id] = data.read === true || data.unread === false || readBy.includes(uid!); });
        notifReadMapRef.current = { ...notifReadMapRef.current, ...partial };
        setUnreadCount(Object.values(notifReadMapRef.current).filter((r) => !r).length);
      };
      unsubs.push(onSnapshot(qUserId, mergeAndSet, () => {}), onSnapshot(qRecipientId, mergeAndSet, () => {}));
      if (qEmailUser) unsubs.push(onSnapshot(qEmailUser, mergeAndSet, () => {}));
      unsubs.push(onSnapshot(qRecipients, mergeAndSet, () => {}));
    } catch {}

    const offersBase = collection(firestore, 'rideOffers');
    const mapOffer = (d: any): OfferInfo | null => {
      try {
        const data = d.data() || {}; const rideRequestId = data.rideRequestId || data.requestId || data.rideRequest?.id;
        if (!rideRequestId) return null;
        const status = String(data.status || data.state || 'pending'); const createdAt = toDateField(data.timestamp || data.createdAt || data.time);
        const priceRaw = data.offerPrice ?? data.price ?? data.estimatedFare;
        const priceText = typeof priceRaw === 'number' ? `$${priceRaw.toFixed(2)}` : (typeof priceRaw === 'string' ? priceRaw : undefined);
        const priceNumber = typeof priceRaw === 'number' ? priceRaw : (typeof priceRaw === 'string' ? parseCurrency(priceRaw) : undefined);
        let dist = data.distance?.text || data.distanceText; let dur = data.duration?.text || data.durationText;
        if (!dist) dist = extractDistance(data) || extractDistance(data.route) || extractDistance(data.trip) || extractDistance(data.details) || undefined;
        if (!dur) { const durVal = (typeof data.duration === 'number' ? data.duration : (typeof data.durationMinutes === 'number' ? data.durationMinutes : undefined)); if (typeof durVal === 'number' && isFinite(durVal)) dur = `${Math.round(durVal)} min`; }
        return { id: d.id, rideRequestId, status, priceText, priceNumber, distanceText: typeof dist === 'string' ? dist : undefined, durationText: typeof dur === 'string' ? dur : (typeof data.duration === 'number' ? `${Math.round(data.duration)} min` : undefined), driverName: data.driverName || data.driver?.name, driverId: data.driverId || data.driverUID || data.senderId, driverEmail: data.driverEmail || data.driver?.email, driverPhone: data.driverPhone || data.driver?.phone, ridePostingId: data.ridePostingId || data.ridePostId || null, createdAt };
      } catch { return null; }
    };
    const handleOfferSnap = (snap: any) => {
      const incoming: Record<string, OfferInfo> = {};
      snap.forEach((docu: any) => { const o = mapOffer(docu); if (!o) return; const existing = incoming[o.rideRequestId]; if (!existing || (o.createdAt && existing.createdAt && o.createdAt > existing.createdAt)) incoming[o.rideRequestId] = o; });
      setOffersByRideId((prev) => ({ ...prev, ...incoming }));
    };
    unsubs.push(onSnapshot(query(offersBase, where('recipientId', '==', uid)), handleOfferSnap, () => {}), onSnapshot(query(offersBase, where('riderId', '==', uid)), handleOfferSnap, () => {}));

    try {
      const qConfDone = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid), where('status', '==', 'COMPLETED'));
      unsubs.push(onSnapshot(qConfDone, (snap) => {
        const confRideIds = new Set<string>(); let totalCount = 0; let totalSpent = 0;
        snap.forEach((d) => {
          const r: any = d.data() || {}; totalCount += 1;
          const parseAmount = (ride: any) => { const v = ride?.contributionAmount ?? ride?.estimatedFare?.total ?? ride?.estimatedFare ?? ride?.price; if (typeof v === 'string') { const m = v.match(/([\d.]+)/); return m ? parseFloat(m[1]) || 0 : 0; } return Number(v) || 0; };
          let amt = parseAmount(r); if (!amt && r.originalRideRequest) amt = parseAmount(r.originalRideRequest); if (!amt && r.originalRidePosting) amt = parseAmount(r.originalRidePosting);
          totalSpent += amt; confRideIds.add(String(d.id));
        });
        validRideIdsRef.current = confRideIds; setStats((prev) => ({ ...prev, totalRides: totalCount, spent: totalSpent })); recomputeAvgRatingFromIntersection(); setLoading(false);
      }, () => setLoading(false)));
    } catch { setLoading(false); }

    try {
      unsubs.push(onSnapshot(query(collection(firestore, 'rideRatings'), where('rateeId', '==', uid)), (snap) => {
        const map = new Map<string, { stars: number; createdAt?: number }>();
        snap.forEach((d) => { const r: any = d.data() || {}; const rideId = r?.rideId as string | undefined; const stars = typeof r?.stars === 'number' ? r.stars : (typeof r?.rating === 'number' ? r.rating : undefined); if (!rideId || typeof stars !== 'number') return; let createdAt: number | undefined; const ca = r?.createdAt; if (ca && typeof ca?.toDate === 'function') { try { createdAt = ca.toDate().getTime(); } catch {} } else if (typeof ca === 'string') { const td = new Date(ca).getTime(); if (!isNaN(td)) createdAt = td; } const prev = map.get(rideId); if (!prev || (createdAt || 0) >= (prev.createdAt || 0)) map.set(rideId, { stars, createdAt }); });
        ratingsByRideIdRef.current = map; recomputeAvgRatingFromIntersection();
      }, () => {}));
    } catch {}

    const setupConfirmedFallbackListeners = () => {
      if (confirmedFallbackSetupRef.current) return; confirmedFallbackSetupRef.current = true;
      try {
        const base = collection(firestore, 'confirmedRides'); const statuses = ['CONFIRMED', 'IN_PROGRESS', 'DRIVER_COMPLETED', 'FLAGGED', 'in-progress', 'in_progress', 'driver_completed', 'flagged', 'confirmed'];
        const handler = (snap: any) => { const mapped = mapConfirmedSnapshot(snap.docs.map((d:any)=>({ id:d.id, ...(d.data()||{}) }))); mergeConfirmedIntoUpcoming(mapped); };
        statuses.forEach((st) => { try { unsubs.push(onSnapshot(query(base, where('riderId', '==', uid), where('status', '==', st)), handler, () => {})); } catch {} });
      } catch {}
    };

    try {
      const base = collection(firestore, 'confirmedRides'); const statusIn = ['CONFIRMED', 'confirmed', 'IN_PROGRESS', 'in_progress', 'in-progress', 'IN-PROGRESS', 'DRIVER_COMPLETED', 'driver_completed', 'FLAGGED', 'flagged'];
      const created = new Set<string>();
      for (const fld of ['riderId', 'riderUid', 'rider.id']) {
        try {
          unsubs.push(onSnapshot(query(base, where(fld as any, '==', uid), where('status', 'in', statusIn)), (snap) => { const ids = snap.docs.map((d:any) => d.id); if (!created.has(ids.join(','))) { created.add(ids.join(',')); } const mapped = mapConfirmedSnapshot(snap.docs.map((d:any)=>({ id:d.id, ...(d.data()||{}) }))); mergeConfirmedIntoUpcoming(mapped); }, () => {}));
        } catch {}
      }
      try { unsubs.push(onSnapshot(query(base, where('riderId', '==', uid)), (snap) => { const ids = snap.docs.map((d:any) => d.id); if (!created.has(ids.join(','))) created.add(ids.join(',')); const mapped = mapConfirmedSnapshot(snap.docs.map((d:any)=>({ id:d.id, ...(d.data()||{}) }))); mergeConfirmedIntoUpcoming(mapped); }, () => {})); } catch {}
    } catch { setupConfirmedFallbackListeners(); }

    try {
      unsubs.push(onSnapshot(query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid), where('status', '==', 'COMPLETED')), (snap) => {
        const doneKeys = new Set<string>(); const recents: UpcomingRideCard[] = []; const newlyCompleted: Array<{ id: string; driverName?: string; completedAt?: any; raw: any }> = [];
        snap.docs.forEach((d:any) => {
          const r:any = d.data() || {}; const key = logicalRideKey(r, d.id); doneKeys.add(key); confirmedIndexRef.current[key] = { docId: d.id, status: 'completed', flags: extractFlags(r) };
          const from = extractAddress(r, 'pickup') || 'Pickup'; const to = extractAddress(r, 'dropoff') || 'Dropoff'; const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r); const price = r?.contributionAmount; const priceText = typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined);
          recents.push({ id: d.id, type: 'confirmedRide', status: 'COMPLETED', from, to, dateTime: dt, priceText, rideRequestId: r?.rideRequestId ?? r?.originalRideRequest?.id ?? null });
          if (!completedSeenRef.current.has(d.id)) newlyCompleted.push({ id: d.id, driverName: r?.driverName, completedAt: r?.completedAt || r?.updatedAt || r?.createdAt, raw: r });
        });
        setUpcoming((prev) => prev.filter((u) => { const key = uLogicalKey(u); return !doneKeys.has(key); }));
        setRecent((prev) => { const merged = [...recents, ...prev]; const sorted = merged.sort((a, b) => { const at = a.dateTime ? a.dateTime.getTime() : 0; const bt = b.dateTime ? b.dateTime.getTime() : 0; return bt - at; }); const seen = new Set<string>(); const unique: UpcomingRideCard[] = []; sorted.forEach((c) => { const k = uLogicalKey(c); if (!seen.has(k)) { seen.add(k); unique.push(c); } }); return unique.slice(0, 3); });
        if (newlyCompleted.length > 0) { newlyCompleted.forEach((n) => completedSeenRef.current.add(n.id)); const pickMostRecent = [...newlyCompleted].sort((a, b) => { const ad = toDateField(a.completedAt) || new Date(0); const bd = toDateField(b.completedAt) || new Date(0); return (bd.getTime() - ad.getTime()); })[0]; if (pickMostRecent) maybePromptRatingForRide(pickMostRecent.id, pickMostRecent.driverName); }
      }, () => {}));
    } catch {}

    return () => { unsubs.forEach((u) => u()); cleanupVerificationListener(); };
  }, [uid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshPromotions(); await fetchVerificationStatus();
      if (uid) { try { const userDoc = await getDoc(doc(firestore, 'riders', uid)); const data = userDoc.exists() ? (userDoc.data() as any) : null; const firstName = getFirstNameFromProfile(data); const profilePhoto = data?.avatarUrl || data?.photoURL || data?.photoUrl || firebaseAuth.currentUser?.photoURL; if (profilePhoto && typeof profilePhoto === 'string') setUserPhoto(profilePhoto); setUserName(firstName ?? (email ? email.split('@')[0] : null)); } catch {} }
    } catch {} finally { setRefreshing(false); }
  }, [uid, email, refreshPromotions]);

  useFocusEffect(useCallback(() => {
    if (!loading && !refreshing) {
      (async () => {
        try {
          await refreshPromotions(); await fetchVerificationStatus();
          if (uid) { try { const userDoc = await getDoc(doc(firestore, 'riders', uid)); const data = userDoc.exists() ? (userDoc.data() as any) : null; const firstName = getFirstNameFromProfile(data); const profilePhoto = data?.avatarUrl || data?.photoURL || data?.photoUrl || firebaseAuth.currentUser?.photoURL; if (profilePhoto && typeof profilePhoto === 'string') setUserPhoto(profilePhoto); setUserName(firstName ?? (email ? email.split('@')[0] : null)); } catch {} }
        } catch {}
      })();
    }
  }, [loading, refreshing, uid, email, refreshPromotions]));

  const recomputeAvgRatingFromIntersection = () => {
    try {
      const valid = validRideIdsRef.current; const ratings = ratingsByRideIdRef.current;
      if (!valid || !ratings) { setStats((prev) => ({ ...prev, avgRating: null })); return; }
      let sum = 0; let count = 0;
      ratings.forEach((val, rideId) => { if (valid.has(rideId) && typeof val?.stars === 'number' && isFinite(val.stars)) { sum += val.stars; count += 1; } });
      setStats((prev) => ({ ...prev, avgRating: count ? (sum / count) : null }));
    } catch {}
  };

  const sortedUpcoming = useMemo(() => sortByDate(upcoming), [upcoming]);
  function sortByDate(arr: UpcomingRideCard[]) { return [...arr].sort((a, b) => { const at = a.dateTime ? a.dateTime.getTime() : 0; const bt = b.dateTime ? b.dateTime.getTime() : 0; return at - bt; }); }
  const openRideDetails = (ride: UpcomingRideCard) => { setSelectedRide(ride); setModalDistanceText(ride.distanceText); setModalVisible(true); };

  const acceptOffer = async (rideId: string) => {
    try {
      const offer = offersByRideId[rideId]; if (!offer) return;
      await updateDoc(doc(firestore, 'rideOffers', offer.id), { status: 'accepted' });
      const rrRef = doc(firestore, 'rideRequests', rideId); const rrSnap = await getDoc(rrRef); const r = rrSnap.exists() ? (rrSnap.data() as any) : {};
      const dt = getRideDateTime(r); const dateOnly = dt ? formatDateOnly(dt) : (typeof r?.date === 'string' ? r.date : undefined); const timeStr = dt ? formatTime(dt) : (typeof r?.time === 'string' ? r.time : undefined);
      const pickup = extractAddress(r, 'pickup'); const dropoff = extractAddress(r, 'dropoff'); const contributionAmount = (typeof offer.priceNumber === 'number' ? offer.priceNumber : undefined) ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare)) ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price));
      const riderEmail = email || r?.riderEmail || r?.email; const riderName = (r?.riderName || r?.riderFullName || r?.name || (typeof userName === 'string' ? userName : undefined) || (riderEmail ? riderEmail.split('@')[0] : undefined));
      const passengers = Number(r?.passengers ?? r?.numPassengers ?? r?.seats ?? 1) || 1;
      const confirmedPayload: any = { rideRequestId: rideId, ridePostingId: offer.ridePostingId ?? null, confirmedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), status: 'confirmed', date: dateOnly, time: timeStr, pickup, dropoff, passengers, contributionAmount, driverId: offer.driverId || r?.driverId, driverName: offer.driverName || r?.driverName, driverEmail: offer.driverEmail || r?.driverEmail, driverPhone: offer.driverPhone || r?.driverPhone, riderId: uid, riderName, riderEmail, originalRidePosting: null, originalRideRequest: { id: rideId, requestedTime: r?.requestedTime ?? r?.pickupTime ?? r?.date, estimatedFare: r?.estimatedFare ?? r?.price, pickup, dropoff, riderId: r?.riderId || r?.userId, riderEmail: r?.riderEmail || r?.email, distance: r?.distance } };
      const cleanedPayload = deepClean(confirmedPayload); const safeDriverId = (confirmedPayload.driverId ? String(confirmedPayload.driverId) : `offer_${offer.id}`); const crId = `${rideId}_${safeDriverId}`;
      try { await setDoc(doc(firestore, 'confirmedRides', crId), cleanedPayload, { merge: true }); } catch { try { await addDoc(collection(firestore, 'confirmedRides'), cleanedPayload); } catch (err2) { Alert.alert('Save failed', 'Could not save to confirmed rides.'); throw err2; } }
      await updateDoc(rrRef, { status: 'confirmed' }).catch(() => {});
      setOffersByRideId((prev) => ({ ...prev, [rideId]: { ...prev[rideId], status: 'accepted' } })); setUpcoming((prev) => prev.map((u) => (u.id === rideId ? { ...u, status: 'confirmed' } : u)));
      try { const rrSnap2 = await getDoc(doc(firestore, 'rideRequests', rideId)); const r2 = rrSnap2.exists() ? (rrSnap2.data() as any) : {}; rideToasts.rideConfirmed({ from: extractAddress(r2, 'pickup') || 'Pickup', to: extractAddress(r2, 'dropoff') || 'Dropoff' }); } catch { showSuccessToast('Offer Accepted', 'Ride confirmed'); }
    } catch { showErrorToast('Accept Failed', 'Could not accept the offer'); }
  };

  const doRejectOffer = async (rideId: string) => {
    try { const offer = offersByRideId[rideId]; if (!offer) return; await updateDoc(doc(firestore, 'rideOffers', offer.id), { status: 'rejected' }); setOffersByRideId((prev) => ({ ...prev, [rideId]: { ...prev[rideId], status: 'rejected' } })); showInfoToast('Offer Rejected', 'You declined this offer'); }
    catch { showErrorToast('Reject Failed', 'Could not reject the offer'); Alert.alert('Error', 'Could not reject the offer. Please try again.'); }
  };
  const confirmRejectOffer = (rideId: string) => Alert.alert('Reject this offer?', "You won't be matched with this driver for this ride.", [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => { void doRejectOffer(rideId); } }]);

  const doCancelOfferSent = async (ridePostingRequestId: string) => {
    try { await updateDoc(doc(firestore, 'ridePostingRequests', ridePostingRequestId), { status: 'cancelled' }); setUpcoming((prev) => prev.map((u) => (u.id === ridePostingRequestId ? { ...u, status: 'cancelled' } : u))); showInfoToast('Offer Cancelled', 'Your offer was withdrawn'); }
    catch { showErrorToast('Cancel Failed', 'Could not cancel the offer'); Alert.alert('Error', 'Could not cancel the offer.'); }
  };
  const confirmCancelOffer = (ridePostingRequestId: string) => Alert.alert('Cancel this offer?', 'This will withdraw your offer to the driver.', [{ text: 'Keep', style: 'cancel' }, { text: 'Cancel Offer', style: 'destructive', onPress: () => { void doCancelOfferSent(ridePostingRequestId); } }]);
  const closeModal = () => { setModalVisible(false); setSelectedRide(null); setModalDriver(null); setModalDistanceText(undefined); };

  async function hasUserRated(rideId: string, userId: string): Promise<boolean> { try { const snap = await getDoc(doc(firestore, 'rideRatings', `${rideId}_${userId}`)); return snap.exists(); } catch { return false; } }
  function mapCallableRatingError(e: any): string { const code = String(e?.code || '').replace(/^functions\//, ''); const map: Record<string, string> = { 'already-exists': 'You already rated this ride.', 'permission-denied': 'Only participants can rate.', 'failed-precondition': 'Ride must be completed before rating.', 'out-of-range': 'Rating must be 1–5.', 'invalid-argument': 'Invalid rating.', 'unauthenticated': 'Sign in required.' }; return map[code] || 'Could not submit rating. Please try again.'; }
  async function openRatingForRide(rideId: string, driverName?: string) { if (!uid) return; if (ratedRideIds.has(rideId)) return; const already = await hasUserRated(rideId, uid); if (already) { setRatedRideIds((prev) => new Set(prev).add(rideId)); Alert.alert('Rating', 'You already rated this ride.'); return; } setRatingError(null); setRatingTarget({ rideId, driverName }); setRatingModalVisible(true); }
  async function maybePromptRatingForRide(rideId: string, driverName?: string) { if (!uid) return; const already = await hasUserRated(rideId, uid); if (!already) openRatingForRide(rideId, driverName); else setRatedRideIds((prev) => new Set(prev).add(rideId)); }

  useEffect(() => { if (!uid) return; (async () => { try { const qDone = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid), where('status', '==', 'COMPLETED')); const snap = await getDocs(qDone); if (snap.empty) return; const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as any })).sort((a, b) => { const ad = toDateField(a.data.completedAt || a.data.updatedAt || a.data.createdAt) || new Date(0); const bd = toDateField(b.data.completedAt || b.data.updatedAt || b.data.createdAt) || new Date(0); return bd.getTime() - ad.getTime(); }); for (const row of docs) { const already = await hasUserRated(row.id, uid); if (!already) { await openRatingForRide(row.id, row.data?.driverName); break; } } } catch {} })(); }, [uid]);

  useEffect(() => { let cancelled = false; const run = async () => { if (!uid || recent.length === 0) return; const pending = recent.map((r) => r.id).filter((id) => !ratedRideIds.has(id)); const results: string[] = []; for (const id of pending) { const ok = await hasUserRated(id, uid); if (ok) results.push(id); } if (!cancelled && results.length) setRatedRideIds((prev) => { const next = new Set(prev); results.forEach((id) => next.add(id)); return next; }); }; run(); return () => { cancelled = true; }; }, [recent, uid]);

  useEffect(() => {
    if (!promotions || promotions.length <= 1) return;
    const interval = setInterval(() => { setCurrentPromotionIndex((prevIndex) => { const nextIndex = (prevIndex + 1) % promotions.length; const cardWidth = Dimensions.get('window').width - 24; promotionsScrollRef.current?.scrollTo({ x: nextIndex * cardWidth, animated: true }); return nextIndex; }); }, 5000);
    return () => clearInterval(interval);
  }, [promotions]);

  const callUpdateRideStatus = useMemo(() => httpsCallable(functions, 'updateRideStatus'), []);

  const openChatForRide = async (card: UpcomingRideCard) => {
    const docId = await resolveConfirmedDocId(card); if (!docId || !uid) return;
    try { const q = query(collection(firestore, 'chats'), where('rideId', '==', docId)); const snapshot = await getDocs(q); if (!snapshot.empty) router.push(`/messages/${snapshot.docs[0].id}`); else router.push('/rider/messages'); } catch { router.push('/rider/messages'); }
  };

  const renderConfirmedRideCTA = (card: UpcomingRideCard) => {
    const key = uLogicalKey(card); const idx = confirmedIndexRef.current[key]; const status = (idx?.status || (card.status || '')).toString().toLowerCase(); const flags = idx?.flags || {};
    if (status === 'flagged') return (<View style={s.flaggedBox}><Text style={s.flaggedTitle}>Ride Under Review</Text><Text style={s.flaggedText}>Your safety report has been submitted. Our team will review this ride.</Text></View>);
    const riderPicked = !!flags.riderPickupConfirmed, driverPicked = !!flags.driverPickupConfirmed, riderCompleted = !!flags.riderCompleteConfirmed, driverCompleted = !!flags.driverCompleteConfirmed;
    const onConfirmPickup = async () => { const docId = await resolveConfirmedDocId(card); if (!docId) { Alert.alert('Ride not found', 'We could not find this ride.'); return; } try { await callUpdateRideStatus({ rideId: docId, action: 'rider_pickup' }); } catch { Alert.alert('Error', 'Could not confirm pickup.'); } };
    const onApproveCompletion = async () => { const docId = await resolveConfirmedDocId(card); if (!docId) { Alert.alert('Ride not found', 'We could not find this ride.'); return; } try { await callUpdateRideStatus({ rideId: docId, action: 'rider_complete' }); } catch { Alert.alert('Error', 'Could not approve completion.'); } };
    const onCancelRide = async () => { const docId = await resolveConfirmedDocId(card); if (!docId) { Alert.alert('Ride not found', 'We could not find this ride.'); return; } const doCancel = async () => { try { await callUpdateRideStatus({ rideId: docId, action: 'rider_cancel' }); } catch { try { await updateDoc(doc(firestore, 'confirmedRides', docId), { status: 'cancelled', updatedAt: serverTimestamp() }); } catch {} if (card.rideRequestId) { try { await updateDoc(doc(firestore, 'rideRequests', card.rideRequestId), { status: 'cancelled' }); } catch {} } } setUpcoming((prev) => prev.map((u) => { if (u.type === 'confirmedRide' && u.id === card.id) return { ...u, status: 'cancelled' }; if (card.rideRequestId && u.id === card.rideRequestId) return { ...u, status: 'cancelled' }; return u; })); }; Alert.alert('Cancel this ride?', 'This will cancel your confirmed ride.', [{ text: 'Keep Ride', style: 'cancel' }, { text: 'Cancel Ride', style: 'destructive', onPress: () => { void doCancel(); } }]); };
    const FlagBtn = () => (<TouchableOpacity onPress={async () => { const docId = await resolveConfirmedDocId(card); if (!docId) { Alert.alert('Ride not found', 'We could not find this ride to flag.'); return; } setFlaggingRideId(docId); setFlagModalVisible(true); }} style={s.iconActionBtn}><Flag size={16} color="#DC2626" /></TouchableOpacity>);
    const ChatBtn = () => (<TouchableOpacity onPress={() => openChatForRide(card)} style={s.iconActionBtn}><MessageCircle size={16} color={COLORS.orange} /></TouchableOpacity>);
    if (status === 'pending') return (<View style={s.ctaRow}><FlagBtn /><Button variant="outline" size="sm" onPress={onCancelRide}>Cancel</Button></View>);
    if (['confirmed','confimed','matched'].includes(status)) return (<View style={s.ctaRow}><FlagBtn /><ChatBtn />{!riderPicked ? <><Button variant="outline" size="sm" onPress={onCancelRide}>Cancel</Button><Button variant="primary" size="sm" onPress={onConfirmPickup}>Confirm Pickup</Button></> : null}</View>);
    if (['in_progress','in-progress','driver_completed'].includes(status)) { const shouldShowApprove = (driverCompleted || status === 'driver_completed') && !riderCompleted; if (shouldShowApprove) return (<View style={s.ctaRow}><FlagBtn /><ChatBtn /><Button variant="primary" size="sm" onPress={onApproveCompletion}>Approve Completion</Button></View>); if (riderCompleted && !driverCompleted && status !== 'driver_completed') return (<Text style={s.waitingText}>Waiting for driver to confirm completion</Text>); return (<View style={s.ctaRow}><FlagBtn /><ChatBtn /></View>); }
    return null;
  };

  const resolveConfirmedDocId = async (card: UpcomingRideCard): Promise<string | null> => {
    if (card.type === 'confirmedRide') return card.id;
    const key = uLogicalKey(card); const cached = confirmedIndexRef.current[key]?.docId; if (cached) return cached;
    const rrid = card.rideRequestId ?? (card.type === 'rideRequest' ? card.id : undefined); if (!rrid) return null;
    try {
      const qs = query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', rrid), fsLimit(1)); const snap = await getDocs(qs); const d = snap.docs[0];
      if (!d) { const rp = card.ridePostingId; const rid = card.riderId; if (rp && rid) { for (const fld of ['riderId', 'riderUid', 'rider.id']) { try { const altQ = query(collection(firestore, 'confirmedRides'), where('ridePostingId', '==', rp), where(fld as any, '==', rid), fsLimit(1)); const altSnap = await getDocs(altQ); const altD = altSnap.docs[0]; if (altD) { confirmedIndexRef.current[key] = { docId: altD.id, status: (String((altD.data() as any)?.status || '') as any).toLowerCase() as any, flags: extractFlags(altD.data() as any) }; return altD.id; } } catch {} } } return null; }
      confirmedIndexRef.current[key] = { docId: d.id, status: (String((d.data() as any)?.status || '') as any).toLowerCase() as any, flags: extractFlags(d.data() as any) }; return d.id;
    } catch { return null; }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!modalVisible || !selectedRide) { if (!cancelled) { setModalDriver(null); setModalDistanceText(undefined); } return; }
        let distanceText: string | undefined = selectedRide.distanceText ?? undefined;
        const considerDistance = (source: any) => { if (distanceText) return; const resolved = extractDistance(source); if (resolved) distanceText = resolved; };
        considerDistance(selectedRide);
        const offer = offersByRideId[selectedRide.id]; let driverId: any = offer?.driverId, driverEmail: any = offer?.driverEmail, name: string | undefined = offer?.driverName || selectedRide.driverName, phone: string | null | undefined = offer?.driverPhone || selectedRide.driverPhone, avatarRaw: any = undefined, rating: number | null | undefined = selectedRide.driverRating ?? null;
        if (offer?.distanceText && !distanceText) distanceText = offer.distanceText;
        if (selectedRide.status === 'Offer Sent' || selectedRide.status === 'offer_sent' || selectedRide.status === 'sent') { const postingId = selectedRide.ridePostingId; if (postingId) { try { const postingDoc = await getDoc(doc(firestore, 'ridePostings', postingId)); if (postingDoc.exists()) { const pd = postingDoc.data() as any; driverId = driverId || pd.driverId || pd.driverUID || pd.ownerId || pd.postedBy; driverEmail = driverEmail || pd.driverEmail || pd.ownerEmail || pd.email; name = name || pd.driverName || pd.driver?.name || pd.ownerName; phone = phone || pd.driverPhone || pd.phone; avatarRaw = avatarRaw || pd.driverAvatarUrl || pd.driver?.avatarUrl; rating = rating ?? (pd.driverRating ?? pd.rating ?? null); considerDistance(pd); } } catch {} } }
        if (!driverId && selectedRide.type === 'confirmedRide') { try { const d = await getDoc(doc(firestore, 'confirmedRides', selectedRide.id)); const data = d.exists() ? (d.data() as any) : undefined; if (data) { driverId = driverId || data.driverId; driverEmail = driverEmail || data.driverEmail; name = name || data.driverName; phone = phone || data.driverPhone; avatarRaw = avatarRaw || data.driverAvatarUrl; rating = rating ?? (typeof data.driverRating === 'number' ? data.driverRating : null); considerDistance(data); } } catch {} }
        if (!driverId) { try { const qs = query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', selectedRide.id), fsLimit(1)); const snap = await getDocs(qs); const data = snap.docs[0]?.data() as any | undefined; if (data) { driverId = driverId || data.driverId; driverEmail = driverEmail || data.driverEmail; name = name || data.driverName; phone = phone || data.driverPhone; avatarRaw = avatarRaw || data.driverAvatarUrl; rating = rating ?? (typeof data.driverRating === 'number' ? data.driverRating : null); considerDistance(data); } } catch {} }
        if (!driverId || !name || !avatarRaw) { try { const rr = await getDoc(doc(firestore, 'rideRequests', selectedRide.id)); const r = rr.exists() ? (rr.data() as any) : undefined; if (r) { driverId = driverId || r.driverId; driverEmail = driverEmail || r.driverEmail; name = name || r.driverName; phone = phone || r.driverPhone; avatarRaw = avatarRaw || r.driverAvatarUrl; considerDistance(r); } } catch {} }
        let prof: any = undefined;
        if (driverId) { try { const d1 = await getDoc(doc(firestore, 'drivers', String(driverId))); prof = d1.exists() ? (d1.data() as any) : undefined; } catch {} }
        if (!prof && driverEmail) { try { const q1 = query(collection(firestore, 'drivers'), where('email', '==', driverEmail), fsLimit(1)); const s1 = await getDocs(q1); prof = s1.docs[0]?.data() as any; } catch {} }
        const nameFromProf = getNameFromProfile(prof); const ratingFromProf = typeof prof?.rating === 'number' ? prof.rating as number : (typeof prof?.avgRating === 'number' ? prof.avgRating as number : undefined); const rawAvatarFromProf = prof?.profilePicture || prof?.avatarUrl || prof?.photoURL || prof?.photoUrl; const phoneFromProf = prof?.phone || prof?.phoneNumber;
        let avatarUrl: string | null | undefined = sanitizeAvatar(avatarRaw || rawAvatarFromProf);
        if (avatarUrl && !/^https?:\/\//i.test(avatarUrl) && !avatarUrl.startsWith('data:')) { const s = avatarUrl.replace(/^gs:\/\/[^/]+\//, ''); try { avatarUrl = await getDownloadURL(storageRef(storage, s)); } catch {} }
        const seedName = name || selectedRide.driverName; const finalName = (nameFromProf && nameFromProf.trim()) ? nameFromProf : (seedName && !isGenericName(seedName) ? seedName : (driverEmail ? String(driverEmail).split('@')[0] : undefined)); const finalRating = (selectedRide.driverRating ?? ratingFromProf ?? null) as number | null; const finalPhone = phone ?? (phoneFromProf ?? null); const finalPhoneFromProfile = !!phoneFromProf;
        if (!cancelled) { setModalDriver({ name: finalName, rating: finalRating, phone: finalPhone, phoneFromProfile: finalPhoneFromProfile, avatarUrl: avatarUrl ?? null, vehicleText: selectedRide.vehicleText, driverId: driverId ? String(driverId) : undefined }); setModalDistanceText(distanceText ?? offer?.distanceText ?? selectedRide.distanceText ?? undefined); }
      } catch { if (!cancelled) { setModalDriver(null); setModalDistanceText(selectedRide?.distanceText ?? undefined); } }
    };
    run(); return () => { cancelled = true; };
  }, [modalVisible, selectedRide, offersByRideId]);

  // ─── RENDER ────────────────────────────────────────────────────────────────
  const dark = theme.dark;

  const bgGradient: [string, string, string] = dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F2F5FA', '#FFFFFF'];

  return (
    <View style={s.root}>
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />

      <SafeAreaView style={s.safe} edges={['top']}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.orange} colors={[COLORS.orange]} />}
        >

          {/* ── Hero Section ── */}
          <View style={s.hero}>
            {/* Top bar */}
            <View style={s.topBar}>
              <TouchableOpacity style={s.avatarWrap} onPress={() => router.push('/rider/profile')}>
                {userPhoto
                  ? <Image source={{ uri: userPhoto }} style={s.avatarImg} resizeMode="cover" onError={() => setUserPhoto(null)} />
                  : <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} style={s.avatarGradient}><Text style={s.avatarInitial}>{userName ? userName[0].toUpperCase() : 'R'}</Text></LinearGradient>
                }
              </TouchableOpacity>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[s.greeting, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>Hey {userName ? capitalize(userName) : 'there'} 👋</Text>
                <Text style={[s.heroTagline, { color: dark ? COLORS.darkText : COLORS.lightText }]}>Your ride,</Text>
                <Text style={s.heroTaglineAccent}>your community.</Text>
              </View>
              <TouchableOpacity style={[s.notifBtn, { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)' }]} onPress={() => router.push('/rider/notifications')}>
                <Ionicons name="notifications-outline" size={22} color={dark ? COLORS.darkText : COLORS.lightText} />
                {unreadCount > 0 && (
                  <View style={s.notifBadge}>
                    <Text style={s.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* Student Verification Banner */}
            <StudentVerificationBanner />

            {/* Where to */}
            <TouchableOpacity style={s.searchBar} onPress={() => router.push('/rider/book')} activeOpacity={0.9}>
              <BlurView intensity={dark ? 28 : 55} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              <View style={s.searchBarInner}>
                <Ionicons name="location-outline" size={20} color={COLORS.orange} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[s.searchTitle, { color: dark ? COLORS.darkText : COLORS.lightText }]}>Where are you going?</Text>
                  <Text style={[s.searchSub, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>Book your next ride</Text>
                </View>
                <View style={s.searchArrow}>
                  <Ionicons name="arrow-forward" size={18} color="white" />
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── Stats Row ── */}
          <View style={s.statsRow}>
            {[
              { label: 'Rides\nThis Month', value: String(stats.totalRides), icon: 'car-outline' as const, color: COLORS.orange },
              { label: 'Total\nSpent', value: `$${stats.spent ? Math.round(stats.spent) : 0}`, icon: 'wallet-outline' as const, color: COLORS.green },
              { label: 'Rider\nRating', value: typeof stats.avgRating === 'number' ? stats.avgRating.toFixed(1) : '—', icon: 'star-outline' as const, color: '#F59E0B' },
            ].map((stat) => (
              <View key={stat.label} style={[s.statCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <BlurView intensity={dark ? 22 : 50} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                <View style={[s.statIcon, { backgroundColor: `${stat.color}20` }]}>
                  <Ionicons name={stat.icon} size={16} color={stat.color} />
                </View>
                <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
                <Text style={[s.statLabel, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* ── Quick Actions ── */}
          <View style={s.section}>
            <Text style={[s.sectionTitle, { color: theme.text }]}>Find a Ride</Text>
            <View style={s.quickActions}>
              {[
                { label: 'Find a Ride', sub: 'Join a ride going your way', icon: 'people-outline' as const, route: '/rider/available-rides' },
                { label: 'Book a Ride', sub: 'Request your own ride', icon: 'car-sport-outline' as const, route: '/rider/book' },
                { label: 'Group Ride', sub: 'Ride together with friends', icon: 'person-add-outline' as const, route: '/rider/book' },
              ].map((action) => (
                <TouchableOpacity key={action.label} style={[s.quickCard, { backgroundColor: theme.card, borderColor: theme.border }]} onPress={() => router.push(action.route as any)} activeOpacity={0.8}>
                  <BlurView intensity={dark ? 20 : 45} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                  <View style={[s.quickIcon, { backgroundColor: COLORS.orangeGlow }]}>
                    <Ionicons name={action.icon} size={20} color={COLORS.orange} />
                  </View>
                  <Text style={[s.quickLabel, { color: theme.text }]}>{action.label}</Text>
                  <Text style={[s.quickSub, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{action.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Promotions ── */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>🔥 Promotions</Text>
              {promotionsError && <TouchableOpacity onPress={refreshPromotions}><Text style={s.viewAll}>Retry</Text></TouchableOpacity>}
            </View>
            {promotionsLoading && promotions.length === 0
              ? <View style={s.loadingRow}><ActivityIndicator size="small" color={COLORS.orange} /><Text style={[s.loadingText, { color: theme.sub }]}>Loading offers…</Text></View>
              : promotions.length > 0
                ? <>
                    <ScrollView ref={promotionsScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 0 }} pagingEnabled={false} decelerationRate="fast" snapToInterval={Dimensions.get('window').width - 48} snapToAlignment="start" onScroll={(e) => { const idx = Math.round(e.nativeEvent.contentOffset.x / (Dimensions.get('window').width - 24)); setCurrentPromotionIndex(idx); }} scrollEventThrottle={16}>
                      {promotions.map((promotion) => <PromotionCard key={promotion.id} promotion={promotion} onPress={handlePromotionPress} isLoading={false} isClaimed={isPromotionClaimed(promotion.id)} />)}
                    </ScrollView>
                    {promotions.length > 1 && (
                      <View style={s.dotsRow}>
                        {promotions.map((_, i) => <View key={i} style={[s.dot, currentPromotionIndex === i && s.dotActive]} />)}
                      </View>
                    )}
                  </>
                : <View style={s.emptyBox}><Ionicons name="gift-outline" size={32} color={dark ? COLORS.darkSub : '#CBD5E1'} /><Text style={[s.emptyText, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{promotionsError ? 'Failed to load offers' : 'No promotions available'}</Text></View>
            }
          </View>

          {/* ── Upcoming Rides ── */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Upcoming Ride</Text>
              <TouchableOpacity onPress={() => router.push('/settings/ride-history')}><Text style={s.viewAll}>View all</Text></TouchableOpacity>
            </View>
            {loading
              ? <View style={s.loadingRow}><ActivityIndicator color={COLORS.orange} /></View>
              : (() => {
                  const visible = sortedUpcoming.filter((r) => !['rejected','declined','canceled','cancelled','expired'].includes((r.status || '').toLowerCase()));
                  if (visible.length === 0) return <View style={s.emptyBox}><Ionicons name="calendar-outline" size={32} color={dark ? COLORS.darkSub : '#CBD5E1'} /><Text style={[s.emptyText, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>No upcoming rides found</Text></View>;
                  return visible.map((r) => {
                    const statusKey = (r.status || '').toLowerCase();
                    if (['rejected','declined','canceled','cancelled','expired'].includes(statusKey)) return null;
                    const offer = offersByRideId[r.id]; const offerStatus = (offer?.status || '').toLowerCase();
                    const hasPendingOffer = !!offer && ['pending','sent','offer','offer_sent','received','offer_received'].includes(offerStatus);
                    const isAcceptedOffer = ['accepted','confirmed'].includes(offerStatus);
                    const isOfferSent = statusKey === 'offer sent' || statusKey === 'offer_sent' || statusKey === 'sent';
                    const isConfirmed = r.type === 'confirmedRide' || isAcceptedOffer || ['confirmed','matched','driver-arriving','in-progress','accepted'].includes(statusKey);
                    const dateText = r.dateTime && r.dateTime instanceof Date && !isNaN(r.dateTime.getTime()) ? r.dateTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                    const timeText = r.dateTime && r.dateTime instanceof Date && !isNaN(r.dateTime.getTime()) ? r.dateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
                    const badgeStyle = statusKey === 'flagged' ? s.badgeFlagged : isOfferSent ? s.badgeBlue : hasPendingOffer ? s.badgeAmber : isConfirmed ? s.badgeGreen : s.badgeGray;
                    const badgeTextStyle = statusKey === 'flagged' ? s.badgeTextRed : isOfferSent ? s.badgeTextBlue : hasPendingOffer ? s.badgeTextAmber : isConfirmed ? s.badgeTextGreen : s.badgeTextGray;
                    const badgeLabel = statusKey === 'flagged' ? 'Flagged' : isOfferSent ? 'Offer Sent' : hasPendingOffer ? 'Offer Received' : r.type === 'confirmedRide' ? prettyStatus(r.status, r.type) : isConfirmed ? 'Confirmed' : prettyStatus(r.status, r.type);
                    return (
                      <View key={`${r.type}-${r.id}`} style={[s.rideCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                        <BlurView intensity={dark ? 18 : 50} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                        <View style={s.rideCardInner}>
                          <View style={s.rideCardTop}>
                            <View style={[s.badge, badgeStyle]}><Text style={[s.badgeText, badgeTextStyle]}>{badgeLabel}</Text></View>
                            {(dateText || timeText) && <Text style={[s.rideDateTime, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{dateText}{dateText && timeText ? ' · ' : ''}{timeText}</Text>}
                          </View>
                          <View style={s.routeWrap}>
                            <View style={s.routeRow}>
                              <View style={s.orangeDot} />
                              <Text style={[s.routeFrom, { color: theme.text }]} numberOfLines={1}>{r.from}</Text>
                            </View>
                            <View style={s.routeLine} />
                            <View style={s.routeRow}>
                              <View style={s.grayDot} />
                              <Text style={[s.routeTo, { color: dark ? COLORS.darkSub : COLORS.lightSub }]} numberOfLines={1}>{r.to}</Text>
                            </View>
                          </View>
                          <View style={s.rideCardFooter}>
                            {(offer?.priceText ?? r.priceText) ? <Text style={s.ridePrice}>{offer?.priceText ?? r.priceText}</Text> : <View />}
                            <View style={s.rideFooterRight}>
                              {(offer?.durationText ?? r.durationText) ? <Text style={[s.rideMeta, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{offer?.durationText ?? r.durationText}</Text> : null}
                              {r.type === 'rideRequest' && <TouchableOpacity onPress={() => Share.share({ message: `Looking for a ride on RideAlong!\nhttps://ridealongapp.com/request/${r.id}` }).catch(() => {})} style={{ marginLeft: 8 }}><Ionicons name="share-outline" size={16} color={COLORS.orange} /></TouchableOpacity>}
                              <TouchableOpacity onPress={() => openRideDetails(r)} style={s.detailsBtn}><Text style={s.detailsBtnText}>Details</Text><Ionicons name="chevron-forward" size={14} color={COLORS.orange} /></TouchableOpacity>
                            </View>
                          </View>
                          {(['confirmed','in-progress','in_progress','driver_completed','pending'].includes(statusKey)) && <View style={s.ctaWrap}>{renderConfirmedRideCTA(r)}</View>}
                          {hasPendingOffer && <View style={s.ctaWrap}><Button variant="outline" size="sm" onPress={() => confirmRejectOffer(r.id)}>Reject Offer</Button><Button variant="primary" size="sm" onPress={() => acceptOffer(r.id)}>Accept Offer</Button></View>}
                          {r.type === 'rideRequest' && ['posted','pending','open'].includes(statusKey) && !hasPendingOffer && <View style={s.ctaWrap}><Button variant="outline" size="sm" onPress={() => { Alert.alert('Cancel Ride Request', 'Are you sure?', [{ text: 'No', style: 'cancel' }, { text: 'Yes, Cancel', style: 'destructive', onPress: async () => { try { const { getApiBaseUrl } = require('@/constants/services'); await fetch(`${getApiBaseUrl()}/api/rides/${r.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: 'rideRequests', cancelledBy: 'rider', reason: 'Cancelled by rider' }) }); showSuccessToast('Request Cancelled', 'Your ride request was cancelled'); } catch { showErrorToast('Cancel Failed', 'Failed to cancel ride request'); } } }]); }}>Cancel Request</Button></View>}
                          {isOfferSent && <View style={s.ctaWrap}><Button variant="outline" size="sm" onPress={() => confirmCancelOffer(r.id)}>Cancel Offer</Button></View>}
                        </View>
                      </View>
                    );
                  });
                })()
            }
          </View>

          {/* ── Recent Rides ── */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: theme.text }]}>Recent Rides</Text>
              <TouchableOpacity onPress={() => router.push('/settings/ride-history')}><Text style={s.viewAll}>View all</Text></TouchableOpacity>
            </View>
            {recent.length === 0
              ? <View style={s.emptyBox}><Ionicons name="time-outline" size={32} color={dark ? COLORS.darkSub : '#CBD5E1'} /><Text style={[s.emptyText, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>No recent rides.</Text></View>
              : recent.map((r) => (
                  <View key={`recent-${r.id}`} style={[s.rideCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    <BlurView intensity={dark ? 18 : 50} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                    <View style={s.rideCardInner}>
                      <View style={s.rideCardTop}>
                        <View style={[s.badge, s.badgeGray]}><Text style={[s.badgeText, s.badgeTextGray]}>Completed</Text></View>
                        <Text style={[s.rideDateTime, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{r.dateTime ? formatDate(r.dateTime) : ''}</Text>
                      </View>
                      <View style={s.routeWrap}>
                        <View style={s.routeRow}><View style={s.orangeDot} /><AddressLink address={r.from} textStyle={{ ...s.routeFrom, color: theme.text }} /></View>
                        <View style={s.routeLine} />
                        <View style={s.routeRow}><View style={s.grayDot} /><AddressLink address={r.to} textStyle={{ ...s.routeTo, color: dark ? COLORS.darkSub : COLORS.lightSub }} /></View>
                      </View>
                      <View style={s.rideCardFooter}>
                        {r.priceText ? <Text style={s.ridePrice}>{r.priceText}</Text> : <View />}
                        <View style={s.rideFooterRight}>
                          {(() => { const now = new Date(); const completedAt = r.dateTime as Date | undefined; const showFlag = completedAt && ((now.getTime() - completedAt.getTime()) <= 24 * 60 * 60 * 1000); if (!showFlag) return null; return (<TouchableOpacity onPress={async () => { const docId = await resolveConfirmedDocId(r); if (!docId) { Alert.alert('Ride not found', 'We could not find this confirmed ride to flag.'); return; } setFlaggingRideId(docId); setFlagModalVisible(true); }} style={s.iconActionBtn}><Flag size={16} color="#DC2626" /></TouchableOpacity>); })()}
                          {!ratedRideIds.has(r.id) && <TouchableOpacity style={s.rateBtn} onPress={() => openRatingForRide(r.id)}><Text style={s.rateBtnText}>Rate</Text></TouchableOpacity>}
                          <TouchableOpacity onPress={() => router.push('/settings/ride-history')} style={s.detailsBtn}><Text style={s.detailsBtnText}>History</Text><Ionicons name="chevron-forward" size={14} color={COLORS.orange} /></TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </View>
                ))
            }
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* ── Ride Details Modal ── */}
      {modalVisible && (
        <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={closeModal}>
          <View style={s.modalOverlay}>
            <View style={[s.modalSheet, { backgroundColor: theme.dark ? '#0F1923' : '#FFFFFF' }]}>
              <BlurView intensity={dark ? 40 : 70} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              <View style={[s.modalHandle, { backgroundColor: dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }]} />
              <View style={s.modalHeader}>
                <Text style={[s.modalTitle, { color: theme.text }]}>Ride Details</Text>
                <TouchableOpacity onPress={closeModal} style={[s.modalCloseBtn, { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}><Ionicons name="close" size={20} color={theme.text} /></TouchableOpacity>
              </View>
              {selectedRide && (
                <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
                  {(modalDriver?.name || selectedRide.driverName) && (
                    <View style={s.modalSection}>
                      <Text style={[s.modalSectionTitle, { color: theme.text }]}>Driver</Text>
                      <TouchableOpacity style={[s.driverRow, { backgroundColor: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]} activeOpacity={0.9} onPress={() => { const id = modalDriver?.driverId; if (!id) return; closeModal(); setTimeout(() => { try { router.push(`/driver/${id}`); } catch {} }, 0); }}>
                        {modalDriver?.avatarUrl ? <Image source={{ uri: modalDriver.avatarUrl }} style={s.driverAvatar} /> : <View style={[s.driverAvatarPlaceholder, { backgroundColor: COLORS.orangeGlow }]}><Ionicons name="person" size={24} color={COLORS.orange} /></View>}
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={[s.driverName, { color: theme.text }]}>{modalDriver?.name ?? selectedRide.driverName ?? '—'}</Text>
                          {typeof (modalDriver?.rating ?? selectedRide.driverRating) === 'number' && <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}><Ionicons name="star" size={13} color="#F59E0B" /><Text style={[s.driverRating, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}> {(modalDriver?.rating ?? selectedRide.driverRating)?.toFixed(1)}</Text></View>}
                          {selectedRide.vehicleText && <Text style={[s.driverVehicle, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{selectedRide.vehicleText}</Text>}
                        </View>
                        {(() => { const phoneNumber = (modalDriver?.phone ?? selectedRide.driverPhone) as string | null | undefined; const enabled = !!phoneNumber; return (<TouchableOpacity style={[s.callBtn, { backgroundColor: enabled ? COLORS.orange : (dark ? 'rgba(255,255,255,0.06)' : '#F1F5F9') }]} onPress={() => { if (!enabled) return; Linking.openURL(`tel:${phoneNumber}`).catch(() => {}); }} disabled={!enabled}><Ionicons name="call" size={18} color={enabled ? 'white' : (dark ? COLORS.darkSub : '#94A3B8')} /></TouchableOpacity>); })()}
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={s.modalSection}>
                    <Text style={[s.modalSectionTitle, { color: theme.text }]}>Route</Text>
                    <View style={[s.routeCard, { backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)', borderColor: theme.border }]}>
                      <View style={s.routeRow}><View style={s.orangeDot} /><AddressLink address={selectedRide.from} textStyle={{ ...s.routeFrom, color: theme.text }} /></View>
<View style={s.routeLine} />
<View style={s.routeRow}><View style={s.grayDot} /><AddressLink address={selectedRide.to} textStyle={{ ...s.routeTo, color: dark ? COLORS.darkSub : COLORS.lightSub }} /></View>
                    </View>
                  </View>
                  <View style={s.modalSection}>
                    <Text style={[s.modalSectionTitle, { color: theme.text }]}>Trip Info</Text>
                    <View style={s.infoGrid}>
                      {[
                        { label: 'Price', value: selectedRide.priceText ?? '—', color: COLORS.green },
                        { label: 'Date', value: selectedRide.dateTime ? selectedRide.dateTime.toLocaleDateString() : '—', color: theme.text },
                        { label: 'Time', value: selectedRide.dateTime ? formatTime(selectedRide.dateTime) : '—', color: theme.text },
                        { label: 'Distance', value: modalDistanceText ?? selectedRide.distanceText ?? '—', color: theme.text },
                      ].map(({ label, value, color }) => (
                        <View key={label} style={[s.infoCell, { backgroundColor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)', borderColor: theme.border }]}>
                          <Text style={[s.infoCellLabel, { color: dark ? COLORS.darkSub : COLORS.lightSub }]}>{label}</Text>
                          <Text style={[s.infoCellValue, { color }]}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Rating Modal */}
      {ratingModalVisible && <RatingModal visible={ratingModalVisible} onClose={() => { if (!ratingSubmitting) { setRatingModalVisible(false); setRatingTarget(null); setRatingError(null); } }} onSubmit={async (stars, comment) => { if (!ratingTarget) return; try { setRatingSubmitting(true); setRatingError(null); await submitRating({ rideId: ratingTarget.rideId, stars, comment }); setRatingModalVisible(false); setRatingTarget(null); setRatedRideIds((prev) => new Set(prev).add(ratingTarget.rideId)); showSuccessToast('Thanks!', 'Your rating was submitted'); } catch (e: any) { const msg = mapCallableRatingError(e); setRatingError(msg); showErrorToast('Rating Failed', msg); } finally { setRatingSubmitting(false); } }} title="Rate your driver" subtitle={ratingTarget?.driverName ? `How was your ride with ${ratingTarget.driverName}?` : undefined} submitting={ratingSubmitting} errorText={ratingError} />}

      {/* Flag Modal */}
      <FlagRideModal visible={flagModalVisible} rideId={flaggingRideId} onClose={() => { setFlagModalVisible(false); setFlaggingRideId(null); }} onFlagged={(rid) => { try { setUpcoming((prev) => prev.map((u) => { if (u.type === 'confirmedRide' && u.id === rid) return { ...u, status: 'flagged' }; return u; })); try { const entry = Object.entries(confirmedIndexRef.current).find(([, v]) => v?.docId === rid); if (entry) { const [key, val] = entry as [string, { docId: string; status: any; flags?: any }]; confirmedIndexRef.current[key] = { ...val, status: 'flagged' } as any; } } catch {} showSuccessToast('Ride Flagged', 'Thanks for your report'); } catch {} }} />

      {/* Promotion Details Modal */}
      <PromotionDetailsModal visible={promotionModalVisible} promotion={selectedPromotion} onClose={() => { setPromotionModalVisible(false); setSelectedPromotion(null); }} onClaim={handleClaimPromotion} isClaimed={selectedPromotion ? isPromotionClaimed(selectedPromotion.id) : false} isLoading={false} />
    </View>
  );
}

// ─── Utility functions (ALL UNCHANGED) ───────────────────────────────────────
function formatDate(d: Date | null | undefined) { try { if (!d || !(d instanceof Date) || isNaN(d.getTime())) return ''; return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${formatTime(d)}`; } catch { return ''; } }
function formatTime(d: Date) { try { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } }
function sanitizeDurationText(v: string): string | undefined { try { if (!v) return undefined; let out = String(v); out = out.replace(/(\d+\.\d+)\s*(m|min)\b/g, (_match, num) => `${Math.round(Number(num))} min`); out = out.replace(/(\d+h)\s+(\d+\.\d+)\s*m\b/g, (_match, hours, num) => `${hours} ${Math.round(Number(num))}m`); out = out.replace(/\b(\d+)\s*m\b/g, '$1 min'); return out.replace(/\s+/g, ' ').trim(); } catch { return v; } }
function formatDateOnly(d: Date) { try { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; } catch { return ''; } }
function capitalize(s: string) { if (!s) return s; return s.charAt(0).toUpperCase() + s.slice(1); }
function toDateField(v: any): Date | null { try { if (!v) return null; if (v instanceof Date) return v; if (v instanceof Timestamp) return v.toDate(); if (typeof v === 'number') return new Date(v); if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; } return null; } catch { return null; } }
function parseCurrency(v: any): number | undefined { if (typeof v === 'number') return v; if (typeof v === 'string') { const num = Number(v.replace(/[^0-9.\-]/g, '')); return isNaN(num) ? undefined : num; } return undefined; }
function deepClean<T = any>(obj: T): T { if (obj === null || obj === undefined) return obj as any; if (Array.isArray(obj)) return obj.map((v) => deepClean(v)) as any; if (obj instanceof Date || obj instanceof Timestamp) return obj as any; const isPlain = Object.prototype.toString.call(obj) === '[object Object]'; if (isPlain) { const out: any = {}; Object.entries(obj as any).forEach(([k, v]) => { if (v === undefined) out[k] = null; else if (Array.isArray(v)) out[k] = v.map((item) => (item === undefined ? null : deepClean(item))); else if (v instanceof Date || v instanceof Timestamp) out[k] = v; else if (Object.prototype.toString.call(v) === '[object Object]') out[k] = deepClean(v); else out[k] = v as any; }); return out; } return obj as any; }
function mergeUpcoming(prev: UpcomingRideCard[], incoming: UpcomingRideCard[]) {
  const map = new Map<string, UpcomingRideCard>();
  const logicalKey = (it: UpcomingRideCard) => { if (it.type === 'confirmedRide') { const rrid = it.rideRequestId ?? (typeof it.id === 'string' ? it.id : undefined); return rrid ? `rr_${rrid}` : `cr_${it.id}`; } if (it.type === 'rideRequest') return `rr_${it.id}`; return `${it.type}_${it.id}`; };
  const statusRank = (s: string) => { const key = (s || '').toLowerCase(); if (key === 'flagged') return 4; if (key === 'in-progress' || key === 'in_progress') return 3; if (key === 'confirmed' || key === 'accepted' || key === 'matched') return 2; return 1; };
  const consider = (it: UpcomingRideCard) => { const k = logicalKey(it); const exist = map.get(k); if (!exist) { map.set(k, it); return; } const typeRank = (x: UpcomingRideCard) => (x.type === 'confirmedRide' ? 2 : (x.type === 'rideRequest' ? 1 : 0)); if (typeRank(it) > typeRank(exist)) { map.set(k, it); return; } if (typeRank(it) === typeRank(exist) && statusRank(it.status) >= statusRank(exist.status)) map.set(k, it); };
  [...prev, ...incoming].forEach(consider);
  return [...map.values()].sort((a, b) => { const at = a.dateTime ? a.dateTime.getTime() : 0; const bt = b.dateTime ? b.dateTime.getTime() : 0; return at - bt; });
}
function normalizeStatusForDisplay(s?: string) { const key = (s || '').toLowerCase(); if (key === 'pending' || key === 'open' || key === '') return 'posted'; return key; }
function getFirstNameFromProfile(data: any | undefined): string | undefined { if (!data) return undefined; const direct = data.firstName || data.firstname || data.givenName || data.given_name; if (typeof direct === 'string' && direct.trim()) return direct.trim(); const name = data.name || data.fullName || data.full_name; if (typeof name === 'string' && name.trim()) return name.trim().split(' ')[0]; return undefined; }
function getNameFromProfile(data: any | undefined): string | undefined { if (!data) return undefined; const full = data.name || data.fullName || data.full_name || data.displayName || data.driverName; if (typeof full === 'string' && full.trim()) return full.trim(); const first = data.firstName || data.firstname || data.personalInfo?.firstName; const last = data.lastName || data.lastname || data.personalInfo?.lastName; if (first && last) return `${first} ${last}`.trim(); if (first) return String(first); return undefined; }
function sanitizeAvatar(v: any): string | undefined | null { if (!v || typeof v !== 'string') return undefined; const val = v.trim(); if (!val) return undefined; return val; }
function isGenericName(v: any): boolean { if (typeof v !== 'string') return false; const s = v.trim().toLowerCase(); return s === 'driver' || s === 'owner' || s === 'user' || s === 'provider'; }

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },

  // Hero
  hero: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarWrap: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden' },
  avatarImg: { width: 46, height: 46, borderRadius: 23 },
  avatarGradient: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 20, fontWeight: '800', color: 'white' },
  greeting: { fontSize: 14, fontWeight: '500' },
  heroTagline: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, lineHeight: 32 },
  heroTaglineAccent: { fontSize: 26, fontWeight: '800', letterSpacing: -0.8, color: COLORS.orange },
  notifBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notifBadge: { position: 'absolute', top: -2, right: -2, backgroundColor: '#EF4444', minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  notifBadgeText: { color: 'white', fontSize: 10, fontWeight: '700' },

  // Search
  searchBar: { borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(244,98,31,0.25)', overflow: 'hidden', marginTop: 8 },
  searchBarInner: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  searchTitle: { fontSize: 16, fontWeight: '700' },
  searchSub: { fontSize: 13, fontWeight: '400', marginTop: 1 },
  searchArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.orange, alignItems: 'center', justifyContent: 'center' },

  // Stats
  statsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 24 },
  statCard: { flex: 1, borderRadius: 18, borderWidth: 1.5, overflow: 'hidden', padding: 14, alignItems: 'center' },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontWeight: '500', textAlign: 'center', marginTop: 2, lineHeight: 15 },

  // Section
  section: { paddingHorizontal: 20, marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  viewAll: { fontSize: 14, color: COLORS.orange, fontWeight: '600' },

  // Quick Actions
  quickActions: { flexDirection: 'row', gap: 10 },
  quickCard: { flex: 1, borderRadius: 16, borderWidth: 1.5, overflow: 'hidden', padding: 14 },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  quickLabel: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  quickSub: { fontSize: 11, fontWeight: '400', lineHeight: 15 },

  // Loading / Empty
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
  loadingText: { fontSize: 14, fontWeight: '400' },
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, fontWeight: '400', textAlign: 'center' },

  // Dots
  dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 12, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(150,170,190,0.3)' },
  dotActive: { backgroundColor: COLORS.orange, width: 20, borderRadius: 3 },

  // Ride Card
  rideCard: { borderRadius: 20, borderWidth: 1.5, overflow: 'hidden', marginBottom: 14 },
  rideCardInner: { padding: 18 },
  rideCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  rideDateTime: { fontSize: 12, fontWeight: '500' },

  // Badge
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 50 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  badgeGreen: { backgroundColor: 'rgba(16,185,129,0.12)' },
  badgeTextGreen: { color: '#10B981' },
  badgeAmber: { backgroundColor: 'rgba(245,158,11,0.12)' },
  badgeTextAmber: { color: '#F59E0B' },
  badgeBlue: { backgroundColor: 'rgba(59,130,246,0.12)' },
  badgeTextBlue: { color: '#3B82F6' },
  badgeGray: { backgroundColor: 'rgba(150,170,190,0.12)' },
  badgeTextGray: { color: '#7A8FA8' },
  badgeFlagged: { backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
  badgeTextRed: { color: '#EF4444' },

  // Route
  routeWrap: { marginBottom: 14 },
  routeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  routeLine: { width: 2, height: 12, backgroundColor: 'rgba(150,170,190,0.3)', marginLeft: 3, marginBottom: 6 },
  orangeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.orange, marginRight: 12, flexShrink: 0 },
  grayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#94A3B8', marginRight: 12, flexShrink: 0 },
  routeFrom: { fontSize: 14, fontWeight: '600', flex: 1 },
  routeTo: { fontSize: 14, fontWeight: '400', flex: 1 },

  // Ride Footer
  rideCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ridePrice: { fontSize: 15, fontWeight: '700', color: COLORS.orange },
  rideFooterRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rideMeta: { fontSize: 12, fontWeight: '400' },
  detailsBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  detailsBtnText: { fontSize: 13, color: COLORS.orange, fontWeight: '600' },

  // CTA
  ctaWrap: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
  ctaRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  iconActionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(150,170,190,0.12)' },
  waitingText: { fontSize: 12, color: '#7A8FA8', textAlign: 'right', marginTop: 10 },
  flaggedBox: { backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 10, padding: 12, marginTop: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)' },
  flaggedTitle: { fontSize: 13, color: '#EF4444', fontWeight: '700', marginBottom: 4 },
  flaggedText: { fontSize: 12, color: '#7F1D1D', lineHeight: 18 },

  // Rate
  rateBtn: { backgroundColor: COLORS.navy, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 50 },
  rateBtnText: { color: 'white', fontSize: 12, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '90%', overflow: 'hidden', paddingBottom: 40 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
  modalTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  modalCloseBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  modalBody: { paddingHorizontal: 24 },
  modalSection: { marginBottom: 20 },
  modalSectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10 },

  // Driver row
  driverRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14 },
  driverAvatar: { width: 48, height: 48, borderRadius: 24 },
  driverAvatarPlaceholder: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  driverName: { fontSize: 16, fontWeight: '700' },
  driverRating: { fontSize: 13, fontWeight: '500' },
  driverVehicle: { fontSize: 13, marginTop: 2 },
  callBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  // Route card in modal
  routeCard: { borderRadius: 14, borderWidth: 1, padding: 16 },

  // Info grid
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoCell: { flex: 1, minWidth: '44%', borderRadius: 12, borderWidth: 1, padding: 12, alignItems: 'center' },
  infoCellLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 4 },
  infoCellValue: { fontSize: 15, fontWeight: '700' },
});