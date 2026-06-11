import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  Linking,
  Share,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { firebaseAuth, firestore, storage } from '@/constants/services';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  addDoc,
  serverTimestamp,
  Timestamp,
  getDocs,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { Image } from 'expo-image';
import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors, BRAND } from '@/constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { RideFiltersModal } from '@/components/RideFiltersModal';
import { getDefaultFilters, filterRides as applyRideFilters, hasActiveFilters, type RideFilterOptions } from '@/utils/rideFilters';


type InboxItem = {
  id: string;
  pickup: string;
  dropoff: string;
  date?: string | null;
  time?: string | null;
  price?: number | null;
  seats?: number | null;
  durationText?: string | null;
  distanceText?: string | null;
  distanceMiles?: number | null;
  notes?: string | null;
  requesterName?: string | null;
  requesterId?: string | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  requesterRating?: number | null;
  status: string;
  ridePostingId?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
};

type RequestFilter = 'all' | 'today' | 'tomorrow' | 'open' | 'assigned' | 'best';
type GradientStops = readonly [string, string, ...string[]];

const asGradientStops = (stops: string[]): GradientStops => {
  return stops as unknown as GradientStops;
};

// Local helpers (mirrors logic used in Home)
// Parse 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm[:ss]' as a local date to avoid UTC off-by-one shifts
function parseLocalDateString(s: string): Date | null {
  try {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const [, y, mo, d, hh, mm, ss] = m;
      return new Date(Number(y), Number(mo) - 1, Number(d), hh ? Number(hh) : 0, mm ? Number(mm) : 0, ss ? Number(ss) : 0, 0);
    }
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  } catch { return null; }
}
function toDateField(v: any): Date | null {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (v instanceof Timestamp) return v.toDate();
    if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') return parseLocalDateString(v);
    return null;
  } catch {
    return null;
  }
}

function getRideDateTime(r: any): Date | null {
  // Prefer requestedTime; fall back to pickupTime or date; allow ISO strings or Firestore Timestamps
  const raw = r?.requestedTime ?? r?.pickupTime ?? r?.date ?? (r?.dateString && `${r.dateString} ${r?.timeString || ''}`);
  const dt = toDateField(raw);
  
  // If we have a date but also a separate time field, combine them
  if (dt && r?.time && typeof r.time === 'string') {
    try {
      const timeMatch = r.time.match(/^(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        const [, hh, mm] = timeMatch;
        dt.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
      }
    } catch (e) {
      console.warn('[getRideDateTime] failed to parse time:', r.time, e);
    }
  }
  
  return dt;
}

function extractAddress(r: any, kind: 'pickup' | 'dropoff'): string | undefined {
  const loc = kind === 'pickup' ? (r?.pickupLocation || r?.pickup || r?.from) : (r?.dropoffLocation || r?.dropoff || r?.to);
  if (typeof loc === 'string') return loc;
  if (loc?.address) return loc.address;
  const addr = kind === 'pickup' ? (r?.pickupAddress || r?.fromAddress) : (r?.dropoffAddress || r?.toAddress);
  if (typeof addr === 'string') return addr;
  return undefined;
}

function extractCoords(r: any, kind: 'pickup' | 'dropoff'): { lat: number; lng: number } | null {
  const loc = kind === 'pickup'
    ? (r?.pickupLocation || r?.pickup || r?.from)
    : (r?.dropoffLocation || r?.dropoff || r?.to);

  const flatLat = kind === 'pickup' ? r?.pickupLat : r?.dropoffLat;
  const flatLng = kind === 'pickup' ? r?.pickupLng : r?.dropoffLng;

  const lat =
    typeof loc?.latitude === 'number' ? loc.latitude :
    typeof loc?.lat === 'number' ? loc.lat :
    typeof flatLat === 'number' ? flatLat :
    undefined;

  const lng =
    typeof loc?.longitude === 'number' ? loc.longitude :
    typeof loc?.lng === 'number' ? loc.lng :
    typeof flatLng === 'number' ? flatLng :
    undefined;

  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;

  return { lat, lng };
}

function formatDateOnly(d: Date) {
  try {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

function formatTime(d: Date) {
  try {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDateDisplay(dateStr?: string | null) {
  try {
    if (!dateStr) return '';
  const d = parseLocalDateString(dateStr) || new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString();
  } catch { return String(dateStr || ''); }
}

function formatMoney(n?: number | null) {
  if (typeof n !== 'number' || isNaN(n)) return '';
  try {
    return `$${n.toFixed(2)}`;
  } catch { return `$${n}`; }
}

function relativeDayLabel(dateStr?: string | null) {
  if (!dateStr) return '';
  try {
  const d = parseLocalDateString(dateStr) || new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startThat.getTime() - startToday.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return String(dateStr); }
}

function normalizeDurationString(s: string): string {
  try {
    const lower = s.toLowerCase();
    if (/^\d+\s*hr(\s+\d+\s*min)?$/.test(lower) || /^\d+\s*min$/.test(lower)) return s;
    const hMatch = lower.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour|hours)/);
    const mMatch = lower.match(/(\d+(?:\.\d+)?)\s*(m|min|minute|minutes)/);
    let h = hMatch ? parseFloat(hMatch[1]) : 0;
    let m = mMatch ? parseFloat(mMatch[1]) : 0;
    if (!hMatch && !mMatch) {
      const onlyMin = lower.match(/(\d+(?:\.\d+)?)\s*m/);
      if (onlyMin) m = parseFloat(onlyMin[1]);
    }
    if (h && h % 1 !== 0) {
      const frac = h - Math.floor(h);
      m += frac * 60;
      h = Math.floor(h);
    }
    m = Math.round(m);
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
    if (h > 0 && m > 0) return `${h} hr ${m} min`;
    if (h > 0) return `${h} hr`;
    if (m > 0) return `${m} min`;
    return s;
  } catch { return s; }
}

function getDurationText(r: any): string | undefined {
  try {
    // First try the duration object
    const d = r?.duration;
    if (typeof d?.text === 'string' && d.text.trim()) return normalizeDurationString(d.text.trim());
    if (typeof d === 'string') return normalizeDurationString(d);
    if (typeof d === 'number') {
      const mins = Math.round(d);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    }
    
    // Try durationText directly
    if (r?.durationText && typeof r.durationText === 'string') {
      return normalizeDurationString(r.durationText);
    }
    
    // Try various duration seconds fields
    const seconds = r?.durationSeconds ?? r?.duration_secs ?? r?.durationSec ?? r?.estimatedDuration;
    if (typeof seconds === 'number') {
      const mins = Math.round(seconds / 60);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    }
    
    // Try estimatedTime field
    if (r?.estimatedTime && typeof r.estimatedTime === 'string') {
      return normalizeDurationString(r.estimatedTime);
    }
    
    return undefined;
  } catch { return undefined; }
}

function getDistanceInfo(r: any): { text?: string; miles?: number } {
  try {
    // Try distance object first
    const dist = r?.distance;
    if (typeof dist?.text === 'string' && dist.text.trim()) {
      const miles = typeof dist?.miles === 'number' ? dist.miles : undefined;
      return { text: dist.text.trim(), miles };
    }
    if (typeof dist === 'string') {
      return { text: dist };
    }
    if (typeof dist?.miles === 'number') {
      return { text: `${Math.round(dist.miles)} mi`, miles: dist.miles };
    }
    if (typeof dist?.meters === 'number') {
      const miles = dist.meters / 1609.34;
      return { text: `${Math.round(miles)} mi`, miles };
    }
    
    // Try distanceText directly
    if (r?.distanceText && typeof r.distanceText === 'string') {
      return { text: r.distanceText };
    }
    
    // Try various miles fields
    const milesVal = r?.distanceMiles ?? r?.miles ?? r?.estimatedDistance;
    if (typeof milesVal === 'number') {
      return { text: `${Math.round(milesVal)} mi`, miles: milesVal };
    }
    
    // Try kilometers and convert
    const kmVal = r?.distanceKm ?? r?.kilometers;
    if (typeof kmVal === 'number') {
      const miles = kmVal * 0.621371;
      return { text: `${Math.round(miles)} mi`, miles };
    }
    
    return {};
  } catch { return {}; }
}

function isSameDay(dateStr?: string | null, offsetDays = 0) {
  if (!dateStr) return false;
  try {
  const d = parseLocalDateString(dateStr) || new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    now.setHours(0,0,0,0);
    const cmp = new Date(now);
    cmp.setDate(now.getDate() + offsetDays);
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return target.getTime() === cmp.getTime();
  } catch { return false; }
}

// Helper to get confirmed ride request IDs (mirrors web logic)
async function getConfirmedRideRequestIdSet(requestIds: string[]): Promise<Set<string>> {
  try {
    if (!requestIds || requestIds.length === 0) return new Set();
    const out = new Set<string>();
    const chunkSize = 10;
    for (let i = 0; i < requestIds.length; i += chunkSize) {
      const group = requestIds.slice(i, i + chunkSize);
      try {
        const q = query(
          collection(firestore, 'confirmedRides'),
          where('status', '==', 'confirmed'),
          where('rideRequestId', 'in', group)
        );
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const id = (d.data() as any)?.rideRequestId;
          if (id) out.add(String(id));
        });
      } catch {}
    }
    return out;
  } catch {
    return new Set();
  }
}

// Helper to get request IDs the driver already offered on (mirrors web logic)
async function getOfferedRequestIdSet(driverId: string): Promise<Set<string>> {
  try {
    const out = new Set<string>();
    const qy = query(
      collection(firestore, 'rideOffers'),
      where('driverId', '==', driverId),
      where('status', 'in', ['pending', 'accepted'])
    );
    const snap = await getDocs(qy);
    snap.forEach((d) => {
      const rid = (d.data() as any)?.rideRequestId;
      if (rid) out.add(String(rid));
    });
    return out;
  } catch {
    return new Set();
  }
}

export default function RequestsInboxScreen() {
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);
  const router = useRouter();
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const email = firebaseAuth.currentUser?.email ?? null;

  const [items, setItems] = useState<InboxItem[]>([]);
  const [openItems, setOpenItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [avatarByUser, setAvatarByUser] = useState<Record<string, string>>({});
  const [userDataByUserId, setUserDataByUserId] = useState<Record<string, { name: string; rating: number; email: string }>>({});
  const [offeredByReqId, setOfferedByReqId] = useState<Record<string, { id: string; status: string }>>({});
  const [filter, setFilter] = useState<RequestFilter>('all');
  const [search, setSearch] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [basicFilters, setBasicFilters] = useState<RideFilterOptions>(getDefaultFilters());
  const [mapReady, setMapReady] = useState(false);

  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const pulse4 = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const makePulse = (value: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ]));

    const glow = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: isDark ? 0.9 : 0.45, duration: 2200, useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: isDark ? 0.25 : 0.12, duration: 2200, useNativeDriver: true }),
    ]));

    const p1 = makePulse(pulse1, 0);
    const p2 = makePulse(pulse2, 375);
    const p3 = makePulse(pulse3, 750);
    const p4 = makePulse(pulse4, 1125);

    p1.start(); p2.start(); p3.start(); p4.start(); glow.start();

    return () => {
      p1.stop(); p2.stop(); p3.stop(); p4.stop(); glow.stop();
    };
  }, [glowAnim, isDark, pulse1, pulse2, pulse3, pulse4]);

  const allItems = useMemo<InboxItem[]>(() => {
    const map: Record<string, InboxItem> = {};
    [...openItems, ...items].forEach((item) => {
      map[item.id] = item;
    });
    return Object.values(map);
  }, [openItems, items]);

  const scoreRequest = (item: InboxItem) => {
    const payout = typeof item.price === 'number' ? Math.min(item.price * 4, 40) : 12;
    const soon = isSameDay(item.date, 0) ? 25 : isSameDay(item.date, 1) ? 14 : 6;
    const distance = typeof item.distanceMiles === 'number' ? Math.max(0, 20 - item.distanceMiles) : 8;
    const rating = item.requesterId ? (userDataByUserId[item.requesterId]?.rating ?? 5) * 3 : 12;
    return Math.round(Math.min(98, payout + soon + distance + rating));
  };

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();

    return allItems.filter((item) => {
      if (offeredByReqId[item.id]) return false;
      if (filter === 'today' && !isSameDay(item.date, 0)) return false;
      if (filter === 'tomorrow' && !isSameDay(item.date, 1)) return false;
      if (filter === 'open' && !!items.find((x) => x.id === item.id)) return false;
      if (filter === 'assigned' && !items.find((x) => x.id === item.id)) return false;
      if (filter === 'best' && scoreRequest(item) < 60) return false;

      if (!term) return true;

      const userData = item.requesterId ? userDataByUserId[item.requesterId] : undefined;
      const searchable = [
        item.pickup,
        item.dropoff,
        userData?.name,
        item.requesterName,
        item.requesterEmail,
      ].filter(Boolean).join(' ').toLowerCase();

      return searchable.includes(term);
    });
  }, [allItems, items, filter, search, offeredByReqId, userDataByUserId]);

  const finalItems = useMemo(() => {
    const base = hasActiveFilters(basicFilters)
      ? filteredItems.filter((item) => {
          const raw = [{
            id: item.id,
            date: item.date,
            time: item.time,
            pickup: item.pickup,
            dropoff: item.dropoff,
            price: item.price,
            contributionAmount: item.price,
            seats: item.seats,
          }];
          return applyRideFilters(raw, basicFilters, true).length > 0;
        })
      : filteredItems;

    if (filter === 'best') {
      return [...base].sort((a, b) => scoreRequest(b) - scoreRequest(a));
    }

    return base;
  }, [filteredItems, basicFilters, filter, userDataByUserId]);

  const bestMatchCount = useMemo(
    () => allItems.filter((item) => !offeredByReqId[item.id] && scoreRequest(item) >= 60).length,
    [allItems, offeredByReqId, userDataByUserId]
  );

  const estimatedAverage = useMemo(() => {
    const priced = finalItems.map((item) => item.price).filter((price): price is number => typeof price === 'number');
    if (!priced.length) return null;
    return priced.reduce((sum, price) => sum + price, 0) / priced.length;
  }, [finalItems]);

  const mapItems = useMemo(
    () => finalItems.filter(
      (item) => typeof item.pickupLat === 'number' && typeof item.pickupLng === 'number'
    ),
    [finalItems]
  );

  const mapRegion = useMemo(() => {
    const first = mapItems[0];

    return {
      latitude: first?.pickupLat ?? 32.3513,
      longitude: first?.pickupLng ?? -95.3011,
      latitudeDelta: mapItems.length > 1 ? 0.06 : 0.04,
      longitudeDelta: mapItems.length > 1 ? 0.06 : 0.04,
    };
  }, [mapItems]);

  useEffect(() => {
    if (!uid && !email) {
      setItems([]);
      setOpenItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const base = collection(firestore, 'rideRequests');
    const unsubs: Array<() => void> = [];

    const handler = (snap: any) => {
      const rows: InboxItem[] = [];

      snap.forEach((d: any) => {
        const r = d.data() || {};
        const dt = getRideDateTime(r);
        const distInfo = getDistanceInfo(r);
        const pickupCoords = extractCoords(r, 'pickup');
        const dropoffCoords = extractCoords(r, 'dropoff');
        const contribRaw = r.contributionAmount ?? r.contribution ?? r.requestedContribution;
        const contribNum = typeof contribRaw === 'number' ? contribRaw : typeof contribRaw === 'string' ? parseFloat(contribRaw.replace(/[^0-9.\-]/g, '')) : NaN;
        const priceNum = typeof r.price === 'number' ? r.price : typeof r.price === 'string' ? parseFloat(r.price.replace(/[^0-9.\-]/g, '')) : NaN;
        const fareNum = typeof r.estimatedFare === 'number' ? r.estimatedFare : typeof r.estimatedFare === 'string' ? parseFloat(r.estimatedFare.replace(/[^0-9.\-]/g, '')) : NaN;
        const price = !isNaN(contribNum) && contribNum > 0 ? contribNum : !isNaN(priceNum) && priceNum > 0 ? priceNum : !isNaN(fareNum) && fareNum > 0 ? fareNum : null;

        rows.push({
          id: d.id,
          pickup: extractAddress(r, 'pickup') || 'Pickup',
          dropoff: extractAddress(r, 'dropoff') || 'Dropoff',
          date: r.date || (dt ? formatDateOnly(dt) : null),
          time: r.time || (dt ? formatTime(dt) : null),
          price,
          seats: typeof r.passengers === 'number' ? r.passengers : typeof r.numPassengers === 'number' ? r.numPassengers : typeof r.seats === 'number' ? r.seats : null,
          durationText: getDurationText(r) || null,
          distanceText: distInfo.text || null,
          distanceMiles: typeof distInfo.miles === 'number' ? distInfo.miles : null,
          notes: r.notes || null,
          requesterName: r.userName || r.riderName || r.requesterName || r.name || null,
          requesterId: r.userId || r.riderId || r.requesterId || null,
          requesterEmail: r.userEmail || r.riderEmail || r.requesterEmail || r.email || null,
          requesterPhone: r.userPhone || r.phone || r.phoneNumber || r.contactPhone || null,
          status: String(r.status || 'pending'),
          ridePostingId: r.ridePostingId || r.postingId || null,
          pickupLat: pickupCoords?.lat ?? null,
          pickupLng: pickupCoords?.lng ?? null,
          dropoffLat: dropoffCoords?.lat ?? null,
          dropoffLng: dropoffCoords?.lng ?? null,
        });
      });

      setItems((prev) => mergeRows(prev, rows));
      setLoading(false);
    };

    const qs: any[] = [];

    if (uid) {
      qs.push(query(base, where('driverId', '==', uid)));
      qs.push(query(base, where('driverUID', '==', uid)));
      qs.push(query(base, where('driverUid', '==', uid)));
      qs.push(query(base, where('recipientId', '==', uid)));
      qs.push(query(base, where('assignedDriverId', '==', uid)));
      qs.push(query(base, where('providerId', '==', uid)));
      qs.push(query(base, where('recipients', 'array-contains', uid)));
      qs.push(query(base, where('driverIds', 'array-contains', uid)));
    }

    if (email) {
      qs.push(query(base, where('driverEmail', '==', email)));
      qs.push(query(base, where('recipientsEmail', 'array-contains', email)));
    }

    qs.forEach((qy) => {
      try {
        unsubs.push(onSnapshot(qy, handler, () => setLoading(false)));
      } catch {}
    });

    try {
      const qOpen = query(base, where('status', '==', 'pending'));

      const mapOpen = async (snap: any) => {
        let rawDocs = snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} }));

        const confirmedSet = await getConfirmedRideRequestIdSet(rawDocs.map((docItem: any) => String(docItem.id)));
        rawDocs = rawDocs.filter((docItem: any) => !confirmedSet.has(String(docItem.id)));

        if (uid) {
          const offeredSet = await getOfferedRequestIdSet(uid);
          rawDocs = rawDocs.filter((docItem: any) => !offeredSet.has(String(docItem.id)));
        }

        const rows: InboxItem[] = [];

        rawDocs.forEach((docWrapper: any) => {
          const r = docWrapper.data;
          if (uid && r.userId === uid) return;
          if (email && typeof r.userEmail === 'string' && r.userEmail.toLowerCase() === email.toLowerCase()) return;
          if (r.driverId || r.assignedDriverId || r.providerId || r.recipientId) return;

          const dt = getRideDateTime(r);
          if (dt && (Date.now() - dt.getTime()) / 3600000 > 24) return;

          const distInfo = getDistanceInfo(r);
          const pickupCoords = extractCoords(r, 'pickup');
          const dropoffCoords = extractCoords(r, 'dropoff');
          const contribRaw = r.contributionAmount ?? r.contribution ?? r.requestedContribution;
          const contribNum = typeof contribRaw === 'number' ? contribRaw : typeof contribRaw === 'string' ? parseFloat(contribRaw.replace(/[^0-9.\-]/g, '')) : NaN;
          const priceNum = typeof r.price === 'number' ? r.price : typeof r.price === 'string' ? parseFloat(r.price.replace(/[^0-9.\-]/g, '')) : NaN;
          const fareNum = typeof r.estimatedFare === 'number' ? r.estimatedFare : typeof r.estimatedFare === 'string' ? parseFloat(r.estimatedFare.replace(/[^0-9.\-]/g, '')) : NaN;
          const price = !isNaN(contribNum) && contribNum > 0 ? contribNum : !isNaN(priceNum) && priceNum > 0 ? priceNum : !isNaN(fareNum) && fareNum > 0 ? fareNum : null;

          rows.push({
            id: docWrapper.id,
            pickup: extractAddress(r, 'pickup') || 'Pickup',
            dropoff: extractAddress(r, 'dropoff') || 'Dropoff',
            date: r.date || (dt ? formatDateOnly(dt) : null),
            time: r.time || (dt ? formatTime(dt) : null),
            price,
            seats: typeof r.passengers === 'number' ? r.passengers : typeof r.numPassengers === 'number' ? r.numPassengers : typeof r.seats === 'number' ? r.seats : null,
            durationText: getDurationText(r) || null,
            distanceText: distInfo.text || null,
            distanceMiles: typeof distInfo.miles === 'number' ? distInfo.miles : null,
            notes: r.notes || null,
            requesterName: r.userName || r.riderName || r.requesterName || r.name || null,
            requesterId: r.userId || r.riderId || r.requesterId || null,
            requesterEmail: r.userEmail || r.riderEmail || r.requesterEmail || r.email || null,
            requesterPhone: r.userPhone || r.phone || r.phoneNumber || r.contactPhone || null,
            status: String(r.status || 'pending'),
            ridePostingId: r.ridePostingId || r.postingId || null,
            pickupLat: pickupCoords?.lat ?? null,
            pickupLng: pickupCoords?.lng ?? null,
            dropoffLat: dropoffCoords?.lat ?? null,
            dropoffLng: dropoffCoords?.lng ?? null,
          });
        });

        setOpenItems(rows);
        setLoading(false);
      };

      unsubs.push(onSnapshot(qOpen, mapOpen, () => setLoading(false)));
    } catch {}

    try {
      if (uid || email) {
        const offersBase = collection(firestore, 'rideOffers');
        const qo1 = uid ? query(offersBase, where('driverId', '==', uid)) : null;
        const qo2 = email ? query(offersBase, where('driverEmail', '==', email)) : null;

        const mapOffers = (snap: any) => {
          const map: Record<string, { id: string; status: string }> = {};
          snap.forEach((d: any) => {
            const o = d.data() || {};
            const reqId = o.rideRequestId || o.requestId || o.rideRequest?.id;
            if (reqId) map[String(reqId)] = { id: d.id, status: String(o.status || 'pending') };
          });
          setOfferedByReqId((prev) => ({ ...prev, ...map }));
        };

        if (qo1) unsubs.push(onSnapshot(qo1, mapOffers));
        if (qo2) unsubs.push(onSnapshot(qo2, mapOffers));
      }
    } catch {}

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [uid, email]);

  useEffect(() => {
    (async () => {
      const ids = Array.from(new Set([...items, ...openItems].map((item) => item.requesterId).filter(Boolean))) as string[];
      const missing = ids.filter((id) => !avatarByUser[id] || !userDataByUserId[id]);
      if (!missing.length) return;

      const nextAvatars: Record<string, string> = {};
      const nextUserData: Record<string, { name: string; rating: number; email: string }> = {};

      for (const id of missing) {
        try {
          const userSnap = await getDoc(doc(firestore, 'riders', id));
          if (!userSnap.exists()) continue;

          const data: any = userSnap.data();
          const raw = data.profilePicture || data.avatarUrl || data.photoURL || data.photoUrl || data.profileImageUrl || data.imageUrl;

          if (typeof raw === 'string') {
            if (/^(gs:\/\/|\/)/.test(raw)) {
              try {
                nextAvatars[id] = await getDownloadURL(storageRef(storage, raw));
              } catch {}
            } else {
              nextAvatars[id] = raw;
            }
          }

          const name =
            data.fullName ||
            [data.firstName, data.lastName].filter(Boolean).join(' ') ||
            data.name ||
            data.displayName ||
            '';

          const rating = data.rating || data.averageRating || (data.ratingSum && data.ratingCount ? data.ratingSum / data.ratingCount : 5.0);
          nextUserData[id] = { name: String(name).trim(), rating, email: data.email || '' };
        } catch {}
      }

      if (Object.keys(nextAvatars).length) setAvatarByUser((prev) => ({ ...prev, ...nextAvatars }));
      if (Object.keys(nextUserData).length) setUserDataByUserId((prev) => ({ ...prev, ...nextUserData }));
    })();
  }, [items, openItems, avatarByUser, userDataByUserId]);

  const mergeRows = (prev: InboxItem[], cur: InboxItem[]) => {
    const map: Record<string, InboxItem> = {};
    [...prev, ...cur].forEach((row) => {
      map[row.id] = row;
    });
    return Object.values(map).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
  };

  const offerOnRequest = async (item: InboxItem) => {
    try {
      if (!uid) {
        Alert.alert('Sign in required', 'Please sign in to offer a ride.');
        return;
      }

      const driverDoc = await getDoc(doc(firestore, 'drivers', uid));
      const isVerified = driverDoc.exists() && driverDoc.data()?.isVerified === true;

      if (!isVerified) {
        Alert.alert('Verification Required', 'You must verify your student status before sending ride offers.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Verify Now',
            onPress: async () => {
              const token = await firebaseAuth.currentUser?.getIdToken();
              if (token) await Linking.openURL(`https://ridealongapp.com/pages/driver-login?token=${token}`);
            },
          },
        ]);
        return;
      }

      if (offeredByReqId[item.id]) {
        Alert.alert('Already offered', 'You already sent an offer for this request.');
        return;
      }

      const driverEmailFinal = email || null;
      const driverNameFinal = firebaseAuth.currentUser?.displayName || (driverEmailFinal ? String(driverEmailFinal).split('@')[0] : null);

      const payload: any = {
        rideRequestId: item.id,
        driverId: uid,
        driverEmail: driverEmailFinal,
        driverName: driverNameFinal,
        riderId: item.requesterId || null,
        riderEmail: item.requesterEmail || null,
        riderName: item.requesterName || null,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        offerDate: serverTimestamp(),
        emailSent: false,
        offerPrice: item.price ?? null,
        distance: item.distanceMiles != null ? { miles: item.distanceMiles, text: item.distanceText ?? `${Math.round(item.distanceMiles)} mi` } : item.distanceText ? { text: item.distanceText } : null,
        duration: item.durationText ?? null,
        rideDetails: {
          pickup: item.pickup ?? null,
          destination: item.dropoff ?? null,
          date: item.date ?? null,
          time: item.time ?? null,
          passengers: item.seats ?? 1,
          contributionAmount: typeof item.price === 'number' ? item.price.toFixed(2) : item.price || null,
        },
      };

      const offerRef = await addDoc(collection(firestore, 'rideOffers'), payload);
      setOfferedByReqId((prev) => ({ ...prev, [item.id]: { id: offerRef.id, status: 'pending' } }));
      Alert.alert('Offer sent', 'Your offer was sent to the rider.');
    } catch (error) {
      console.warn('offerOnRequest failed', error);
      Alert.alert('Failed', 'Could not send your offer.');
    }
  };

  const dotAnims = [pulse1, pulse2, pulse3, pulse4];
  const dotPositions = [
    { top: '24%', left: '28%', color: colors.primary },
    { top: '50%', left: '62%', color: colors.primary },
    { top: '36%', left: '72%', color: colors.amber },
    { top: '62%', left: '22%', color: colors.primary },
  ];

  const renderItem = ({ item }: { item: InboxItem }) => {
    const isOffered = !!offeredByReqId[item.id];
    const dayLabel = relativeDayLabel(item.date);
    const priceText = formatMoney(item.price);
    const avatarUri = item.requesterId ? avatarByUser[item.requesterId] : undefined;
    const userData = item.requesterId ? userDataByUserId[item.requesterId] : undefined;
    const displayName = userData?.name?.trim() || item.requesterName?.trim() || userData?.email?.split('@')[0] || item.requesterEmail?.split('@')[0] || 'Student';
    const userRating = userData?.rating || 5.0;
    const initial = displayName[0]?.toUpperCase() || 'S';
    const matchScore = scoreRequest(item);

    return (
      <View style={[themed.reqCard, matchScore >= 70 && themed.reqCardBest]}>
        {isDark && <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFillObject} />}

        <View style={styles.reqTop}>
          <View style={styles.reqAvatarWrap}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.reqAvatar} contentFit="cover" />
            ) : (
              <LinearGradient colors={[BRAND.orange, BRAND.orangeDeep]} style={[styles.reqAvatar, styles.center]}>
                <Text style={styles.reqAvatarInitial}>{initial}</Text>
              </LinearGradient>
            )}
            <View style={[styles.reqOnlineDot, { backgroundColor: colors.green, borderColor: colors.bgCard }]} />
          </View>

          <View style={styles.reqIdentity}>
            <Text style={themed.reqName} numberOfLines={1}>{displayName}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={11} color={colors.amber} />
              <Text style={themed.reqRating}>{userRating.toFixed(1)}</Text>
              <Text style={themed.reqVerified}>· Verified Student</Text>
            </View>
          </View>

          <View style={themed.reqPriceBadge}>
            <Text style={themed.reqPriceLabel}>Payout</Text>
            <Text style={themed.reqPriceValue}>{priceText || 'Open'}</Text>
          </View>
        </View>

        <View style={themed.matchStrip}>
          <Ionicons name="sparkles-outline" size={14} color={colors.primary} />
          <Text style={themed.matchText}>Smart Match {matchScore}%</Text>
          {matchScore >= 70 ? <Text style={themed.matchBest}>Best opportunity</Text> : null}
        </View>

        <View style={styles.reqRouteWrap}>
          <View style={styles.reqRouteConnector}>
            <View style={[styles.reqDot, { backgroundColor: colors.primary }]} />
            <View style={[styles.reqDotLine, { backgroundColor: colors.divider }]} />
            <View style={[styles.reqDot, { backgroundColor: colors.blue }]} />
          </View>

          <View style={styles.reqRouteTextWrap}>
            <Text style={themed.reqRouteFrom} numberOfLines={1}>{item.pickup}</Text>
            <Text style={themed.reqRouteTo} numberOfLines={1}>{item.dropoff}</Text>
          </View>
        </View>

        <View style={styles.reqMetaRow}>
          {dayLabel ? <MetaChip icon="calendar-outline" text={dayLabel} colors={colors} themed={themed} /> : null}
          {item.time ? <MetaChip icon="time-outline" text={item.time} colors={colors} themed={themed} /> : null}
          {item.distanceText ? <MetaChip icon="navigate-outline" text={item.distanceText} colors={colors} themed={themed} /> : null}
          {item.durationText ? <MetaChip icon="timer-outline" text={item.durationText} colors={colors} themed={themed} /> : null}
          {item.seats ? <MetaChip icon="people-outline" text={`${item.seats} seat${item.seats > 1 ? 's' : ''}`} colors={colors} themed={themed} /> : null}
        </View>

        <View style={styles.reqActions}>
          <TouchableOpacity
            onPress={() => {
              const params = new URLSearchParams();
              if (displayName !== 'Student') params.set('name', displayName.split(' ')[0]);
              if (item.pickup) params.set('from', item.pickup);
              if (item.dropoff) params.set('to', item.dropoff);
              const url = `https://ridealongapp.com/request/${item.id}${params.toString() ? '?' + params.toString() : ''}`;
              Share.share({ message: `Check out this ride request!\n${url}`, url }).catch(() => {});
            }}
            style={themed.reqShareBtn}
          >
            <Ionicons name="share-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push(`/request/${item.id}` as any)} style={styles.reqDetailsBtn}>
            <Text style={themed.reqDetailsBtnText}>Details</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.reqOfferBtn, isOffered && styles.disabled]}
            disabled={isOffered}
            onPress={() => offerOnRequest(item)}
          >
            <LinearGradient
              colors={isOffered ? asGradientStops(colors.gradientCard) : [BRAND.orange, BRAND.orangeDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.reqOfferBtnGrad}
            >
              <Ionicons name={isOffered ? 'checkmark-circle' : 'flash'} size={15} color="#FFFFFF" />
              <Text style={styles.reqOfferBtnText}>
                {isOffered ? 'Offer Sent' : `Send Offer${priceText ? ` · ${priceText}` : ''}`}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={themed.root}>
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient colors={asGradientStops(colors.gradientBg)} style={StyleSheet.absoluteFillObject} />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.hdr}>
          <View style={styles.hdrText}>
            <Text style={themed.hdrTitle}>Live Requests</Text>
            <Text style={themed.hdrSub}>Campus transportation marketplace</Text>
          </View>

          <Animated.View style={[themed.campusEnergy, { opacity: glowAnim }]}>
            <View style={[styles.campusEnergyDot, { backgroundColor: colors.primary }]} />
            <Text style={themed.campusEnergyText}>{finalItems.length > 0 ? 'HIGH' : 'ACTIVE'}</Text>
          </Animated.View>
        </View>

        <FlatList
          data={finalItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <View style={themed.mapHero}>
                <MapView
                  style={StyleSheet.absoluteFillObject}
                  provider={PROVIDER_GOOGLE}
                  showsUserLocation
                  showsMyLocationButton={false}
                  showsCompass={false}
                  toolbarEnabled={false}
                  onMapReady={() => setMapReady(true)}
                  initialRegion={mapRegion}
                  region={mapRegion}
                >
                  {mapItems.map((item) => (
                    <Marker
                      key={item.id}
                      coordinate={{
                        latitude: item.pickupLat as number,
                        longitude: item.pickupLng as number,
                      }}
                      title={item.pickup}
                      description={item.dropoff}
                      onPress={() => router.push(`/request/${item.id}` as any)}
                    >
                      <View style={styles.liveRequestMarker}>
                        <View style={styles.liveRequestMarkerDot} />
                        <Text style={styles.liveRequestMarkerText}>
                          {typeof item.price === 'number' ? `$${item.price.toFixed(0)}` : 'Open'}
                        </Text>
                      </View>
                    </Marker>
                  ))}
                </MapView>

                {!mapReady && (
                  <View style={styles.mapLoadingOverlay}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                )}

                {mapItems.length === 0 && (
                  <View style={styles.mapPromptWrap} pointerEvents="none">
                    <Ionicons name="map-outline" size={28} color={colors.textTertiary} />
                    <Text style={[styles.mapPromptText, { color: colors.textSecondary }]}>
                      Waiting for geotagged campus requests
                    </Text>
                  </View>
                )}

                <View style={themed.mapOverlay}>
                  {isDark && <BlurView intensity={55} tint="dark" style={StyleSheet.absoluteFillObject} />}

                  <View style={styles.mapOverlayText}>
                    <View style={styles.mapLivePill}>
                      <View style={[styles.mapLiveDot, { backgroundColor: colors.green }]} />
                      <Text style={[styles.mapLiveText, { color: colors.green }]}>CAMPUS LIVE</Text>
                    </View>

                    <Text style={themed.mapOverlayTitle}>
                      {loading
                        ? 'Loading live map...'
                        : mapItems.length > 0
                          ? `${mapItems.length} mapped request${mapItems.length > 1 ? 's' : ''} nearby`
                          : `${finalItems.length} request${finalItems.length === 1 ? '' : 's'} available`}
                    </Text>

                    <Text style={themed.mapOverlaySub}>
                      {mapItems.length > 0
                        ? 'Tap a marker to open request details'
                        : 'New requests with pickup coordinates will appear here'}
                    </Text>
                  </View>

                  <View style={themed.mapEarnBadge}>
                    <Text style={themed.mapEarnLabel}>Avg Earn</Text>
                    <Text style={themed.mapEarnValue}>{estimatedAverage ? `$${estimatedAverage.toFixed(0)}` : '$18'}</Text>
                  </View>
                </View>
              </View>

              <View style={themed.conversionStrip}>
                <Ionicons name="trending-up-outline" size={16} color={colors.primary} />
                <View style={styles.conversionTextWrap}>
                  <Text style={themed.conversionTitle}>Opportunity Engine</Text>
                  <Text style={themed.conversionText}>
                    {bestMatchCount > 0
                      ? `${bestMatchCount} high-fit request${bestMatchCount > 1 ? 's' : ''} available. Prioritize Best Match to improve acceptance.`
                      : 'No high-fit requests yet. Keep filters light to catch the next campus surge.'}
                  </Text>
                </View>
              </View>

              <View style={themed.searchWrap}>
                <Ionicons name="search" size={16} color={colors.textTertiary} style={styles.searchIcon} />
                <TextInput
                  placeholder="Search requests, destinations..."
                  placeholderTextColor={colors.textTertiary}
                  value={search}
                  onChangeText={setSearch}
                  style={themed.searchInput}
                  returnKeyType="search"
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContainer}>
                <TouchableOpacity
                  onPress={() => setFiltersVisible(true)}
                  style={[themed.filterChip, hasActiveFilters(basicFilters) && themed.filterChipActive]}
                >
                  <Ionicons name="options-outline" size={13} color={hasActiveFilters(basicFilters) ? colors.primary : colors.textSecondary} />
                  <Text style={[themed.filterChipText, hasActiveFilters(basicFilters) && themed.filterChipTextActive]}>
                    Filters{hasActiveFilters(basicFilters) ? ` (${Object.values(basicFilters).filter((value) => value !== null && value !== '').length})` : ''}
                  </Text>
                </TouchableOpacity>

                {([
                  { key: 'all', label: 'All' },
                  { key: 'best', label: 'Best Match' },
                  { key: 'today', label: 'Today' },
                  { key: 'tomorrow', label: 'Tomorrow' },
                  { key: 'open', label: 'Open' },
                  { key: 'assigned', label: 'Assigned' },
                ] as const).map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => setFilter(item.key)}
                    style={[themed.filterChip, filter === item.key && themed.filterChipActive]}
                  >
                    <Text style={[themed.filterChipText, filter === item.key && themed.filterChipTextActive]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {!loading && (
                <View style={styles.listHeader}>
                  <Text style={themed.listHeaderText}>
                    {finalItems.length > 0 ? `${finalItems.length} Request${finalItems.length > 1 ? 's' : ''} Available` : 'Campus Intelligence'}
                  </Text>

                  {finalItems.length > 0 && (
                    <View style={themed.listHeaderBadge}>
                      <View style={[styles.listHeaderBadgeDot, { backgroundColor: colors.green }]} />
                      <Text style={[styles.listHeaderBadgeText, { color: colors.green }]}>Live</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={themed.loadingText}>Scanning campus...</Text>
              </View>
            ) : (
              <View style={styles.emptyWrap}>
                <View style={themed.emptyIconWrap}>
                  <Ionicons name="flash" size={30} color={colors.primary} />
                </View>

                <Text style={themed.emptyTitle}>Campus Intelligence</Text>
                <Text style={themed.emptySubtitle}>No requests right now. Your next opportunity will appear here.</Text>

                <View style={styles.emptyPredictions}>
                  {[
                    { icon: 'time-outline', text: 'Watch late afternoon and evening windows for demand spikes.' },
                    { icon: 'trending-up-outline', text: 'Best Match highlights rides most likely to convert.' },
                    { icon: 'cash-outline', text: 'Higher payout requests are prioritized in the opportunity score.' },
                    { icon: 'school-outline', text: 'Campus pickup patterns improve as more students ride.' },
                  ].map((item) => (
                    <View key={item.text} style={themed.emptyPredictionItem}>
                      <Ionicons name={item.icon as any} size={17} color={colors.primary} />
                      <Text style={themed.emptyPredictionText}>{item.text}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )
          }
        />
      </SafeAreaView>

      <RideFiltersModal
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        onApply={(filters) => setBasicFilters(filters)}
        initialFilters={basicFilters}
        showSeatsFilter={false}
      />
    </View>
  );
}

function MetaChip({
  icon,
  text,
  colors,
  themed,
}: {
  icon: any;
  text: string;
  colors: AppColors;
  themed: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={themed.reqMetaChip}>
      <Ionicons name={icon} size={10} color={colors.textSecondary} />
      <Text style={themed.reqMetaText}>{text}</Text>
    </View>
  );
}

const createStyles = (colors: AppColors, isDark: boolean) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    hdrTitle: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
    hdrSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontWeight: '500' },
    campusEnergy: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primaryDim, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: colors.primaryBorder },
    campusEnergyText: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
    mapHero: { marginHorizontal: 16, marginBottom: 10, height: 230, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: colors.blueBorder, backgroundColor: colors.bgCard, shadowColor: BRAND.navyText, shadowOffset: { width: 0, height: 8 }, shadowOpacity: isDark ? 0.16 : 0.08, shadowRadius: 22, elevation: 4 },
    mapGridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.mapGrid },
    mapGridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.mapGrid },
    road: { position: 'absolute', height: 3, backgroundColor: colors.mapRoad },
    roadV: { position: 'absolute', width: 3, backgroundColor: colors.mapRoad },
    mapOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: 14, overflow: 'hidden', borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: isDark ? colors.mapOverlayBg : 'rgba(255,255,255,0.78)' },
    mapOverlayTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
    mapOverlaySub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, fontWeight: '500' },
    mapEarnBadge: { alignItems: 'center', backgroundColor: colors.primaryDim, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.primaryBorder },
    mapEarnLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '700' },
    mapEarnValue: { color: colors.primary, fontSize: 16, fontWeight: '800' },
    conversionStrip: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: isDark ? colors.glassBg : colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.borderMid, padding: 14 },
    conversionTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '800', marginBottom: 2 },
    conversionText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '500' },
    searchWrap: { marginHorizontal: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgInput, borderRadius: 14, borderWidth: 1, borderColor: colors.borderMid },
    searchInput: { flex: 1, paddingHorizontal: 10, paddingVertical: 12, fontSize: 15, color: colors.textPrimary },
    filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.borderMid, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 5 },
    filterChipActive: { backgroundColor: colors.primaryDim, borderColor: colors.primaryBorder },
    filterChipText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    filterChipTextActive: { color: colors.primary },
    listHeaderText: { fontSize: 14, fontWeight: '800', color: colors.textSecondary },
    listHeaderBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.greenDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: colors.greenBorder },
    reqCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.borderMid, overflow: 'hidden', backgroundColor: isDark ? colors.glassBg : colors.bgCard, shadowColor: BRAND.navyText, shadowOffset: { width: 0, height: 3 }, shadowOpacity: isDark ? 0.12 : 0.05, shadowRadius: 12, elevation: 2 },
    reqCardBest: { borderColor: colors.primaryBorder },
    reqName: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    reqRating: { fontSize: 12, color: colors.amber, fontWeight: '700' },
    reqVerified: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
    reqPriceBadge: { alignItems: 'center', backgroundColor: colors.primaryDim, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.primaryBorder },
    reqPriceLabel: { fontSize: 9, color: colors.textSecondary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    reqPriceValue: { fontSize: 15, fontWeight: '800', color: colors.primary },
    matchStrip: { marginHorizontal: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.primaryDim, borderRadius: 12, borderWidth: 1, borderColor: colors.primaryBorder, paddingHorizontal: 10, paddingVertical: 7 },
    matchText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
    matchBest: { marginLeft: 'auto', color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    reqRouteFrom: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
    reqRouteTo: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
    reqMetaChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgInput, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
    reqMetaText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
    reqShareBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgInput, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderMid },
    reqDetailsBtnText: { fontSize: 13, color: colors.primary, fontWeight: '700' },
    loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    emptyIconWrap: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primaryDim, borderWidth: 1, borderColor: colors.primaryBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginBottom: 6 },
    emptySubtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
    emptyPredictionItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: isDark ? colors.glassBg : colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.borderMid, padding: 14 },
    emptyPredictionText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18, fontWeight: '500' },
  });

const styles = StyleSheet.create({
  safe: { flex: 1 },
  hdr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  hdrText: { flex: 1 },
  campusEnergyDot: { width: 6, height: 6, borderRadius: 3 },
  listContent: { paddingBottom: 60 },
  mapDotWrap: { position: 'absolute', width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  mapDotRing: { position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  mapDotCore: { width: 10, height: 10, borderRadius: 5 },
  mapOverlayText: { flex: 1 },
  mapLivePill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  mapLiveDot: { width: 6, height: 6, borderRadius: 3 },
  mapLiveText: { fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  conversionTextWrap: { flex: 1 },
  searchIcon: { marginLeft: 14 },
  filtersContainer: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 10 },
  listHeaderBadgeDot: { width: 5, height: 5, borderRadius: 2.5 },
  listHeaderBadgeText: { fontSize: 10, fontWeight: '800' },
  reqTop: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 10 },
  reqAvatarWrap: { width: 44, height: 44, position: 'relative' },
  reqAvatar: { width: 44, height: 44, borderRadius: 22 },
  reqAvatarInitial: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  reqOnlineDot: { position: 'absolute', bottom: 1, right: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  reqIdentity: { flex: 1, marginLeft: 10 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  reqRouteWrap: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  reqRouteConnector: { width: 14, alignItems: 'center', paddingTop: 4, paddingBottom: 4 },
  reqDot: { width: 8, height: 8, borderRadius: 4 },
  reqDotLine: { width: 2, flex: 1, marginVertical: 3 },
  reqRouteTextWrap: { flex: 1 },
  reqMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingBottom: 12 },
  reqActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  reqDetailsBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 8 },
  reqOfferBtn: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  reqOfferBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14 },
  reqOfferBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  center: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.55 },
  loadingWrap: { alignItems: 'center', paddingTop: 60, gap: 14 },
  emptyWrap: { padding: 24, alignItems: 'center' },
  emptyPredictions: { width: '100%', gap: 10 },
  liveRequestMarker: {
  minWidth: 46,
  minHeight: 30,
  borderRadius: 16,
  paddingHorizontal: 9,
  paddingVertical: 6,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 5,
  backgroundColor: BRAND.orange,
  borderWidth: 2,
  borderColor: '#FFFFFF',
  shadowColor: BRAND.orange,
  shadowOpacity: 0.35,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
},

liveRequestMarkerDot: {
  width: 6,
  height: 6,
  borderRadius: 3,
  backgroundColor: '#FFFFFF',
},

liveRequestMarkerText: {
  color: '#FFFFFF',
  fontSize: 11,
  fontWeight: '900',
},

mapLoadingOverlay: {
  ...StyleSheet.absoluteFillObject,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(8,14,23,0.25)',
},

mapPromptWrap: {
  ...StyleSheet.absoluteFillObject,
  alignItems: 'center',
  justifyContent: 'center',
  paddingBottom: 58,
  gap: 8,
},

mapPromptText: {
  fontSize: 12,
  fontWeight: '600',
  textAlign: 'center',
},
});

