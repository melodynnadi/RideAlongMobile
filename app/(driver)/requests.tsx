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
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { firebaseAuth, firestore } from '@/constants/services';
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
import { Ionicons } from '@expo/vector-icons';
import { DriverBottomNav } from '@/components/DriverBottomNav';
import { getDefaultFilters, filterRides as applyRideFilters, hasActiveFilters, type RideFilterOptions } from '@/utils/rideFilters';
import { useRideBrowseStore, type DriverRequestFilter } from '@/stores/rideBrowseStore';

const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';

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

type RequestFilter = DriverRequestFilter;

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
  } catch { return null; }
}

function getRideDateTime(r: any): Date | null {
  const raw = r?.requestedTime ?? r?.pickupTime ?? r?.date ?? (r?.dateString && `${r.dateString} ${r?.timeString || ''}`);
  const dt = toDateField(raw);
  if (dt && r?.time && typeof r.time === 'string') {
    try {
      const timeMatch = r.time.match(/^(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        const [, hh, mm] = timeMatch;
        dt.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
      }
    } catch {}
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

  if (loc && typeof loc === 'object') {
    const lat = loc.lat ?? loc.latitude;
    const lng = loc.lng ?? loc.longitude;
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  }
  if (typeof flatLat === 'number' && typeof flatLng === 'number') return { lat: flatLat, lng: flatLng };
  return null;
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
    if (h && h % 1 !== 0) { const frac = h - Math.floor(h); m += frac * 60; h = Math.floor(h); }
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
    const d = r?.duration;
    if (typeof d?.text === 'string' && d.text.trim()) return normalizeDurationString(d.text.trim());
    if (typeof d === 'string') return normalizeDurationString(d);
    if (typeof d === 'number') {
      const mins = Math.round(d);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60); const m = mins % 60;
      return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    }
    if (r?.durationText && typeof r.durationText === 'string') return normalizeDurationString(r.durationText);
    const seconds = r?.durationSeconds ?? r?.duration_secs ?? r?.durationSec ?? r?.estimatedDuration;
    if (typeof seconds === 'number') {
      const mins = Math.round(seconds / 60);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60); const m = mins % 60;
      return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    }
    if (r?.estimatedTime && typeof r.estimatedTime === 'string') return normalizeDurationString(r.estimatedTime);
    return undefined;
  } catch { return undefined; }
}

function getDistanceInfo(r: any): { text?: string; miles?: number } {
  try {
    const dist = r?.distance;
    if (typeof dist?.text === 'string' && dist.text.trim()) {
      return { text: dist.text.trim(), miles: typeof dist?.miles === 'number' ? dist.miles : undefined };
    }
    if (typeof dist === 'string') return { text: dist };
    if (typeof dist?.miles === 'number') return { text: `${Math.round(dist.miles)} mi`, miles: dist.miles };
    if (typeof dist?.meters === 'number') { const miles = dist.meters / 1609.34; return { text: `${Math.round(miles)} mi`, miles }; }
    if (r?.distanceText && typeof r.distanceText === 'string') return { text: r.distanceText };
    const milesVal = r?.distanceMiles ?? r?.miles ?? r?.estimatedDistance;
    if (typeof milesVal === 'number') return { text: `${Math.round(milesVal)} mi`, miles: milesVal };
    const kmVal = r?.distanceKm ?? r?.kilometers;
    if (typeof kmVal === 'number') { const miles = kmVal * 0.621371; return { text: `${Math.round(miles)} mi`, miles }; }
    return {};
  } catch { return {}; }
}

function isSameDay(dateStr?: string | null, offsetDays = 0) {
  if (!dateStr) return false;
  try {
    const d = parseLocalDateString(dateStr) || new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const cmp = new Date(now); cmp.setDate(now.getDate() + offsetDays);
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return target.getTime() === cmp.getTime();
  } catch { return false; }
}

async function getConfirmedRideRequestIdSet(requestIds: string[]): Promise<Set<string>> {
  try {
    if (!requestIds || requestIds.length === 0) return new Set();
    const out = new Set<string>();
    const chunkSize = 10;
    for (let i = 0; i < requestIds.length; i += chunkSize) {
      const group = requestIds.slice(i, i + chunkSize);
      try {
        const q = query(collection(firestore, 'confirmedRides'), where('status', '==', 'CONFIRMED'), where('rideRequestId', 'in', group));
        const snap = await getDocs(q);
        snap.forEach((d) => { const id = (d.data() as any)?.rideRequestId; if (id) out.add(String(id)); });
      } catch {}
    }
    return out;
  } catch { return new Set(); }
}

async function getOfferedRequestIdSet(driverId: string): Promise<Set<string>> {
  try {
    const out = new Set<string>();
    const qy = query(collection(firestore, 'rideOffers'), where('driverId', '==', driverId), where('status', 'in', ['pending', 'accepted']));
    const snap = await getDocs(qy);
    snap.forEach((d) => { const rid = (d.data() as any)?.rideRequestId; if (rid) out.add(String(rid)); });
    return out;
  } catch { return new Set(); }
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatMoney(price?: number | null): string {
  if (price == null || isNaN(price)) return '';
  return `$${Math.round(price)}`;
}

function relativeDayLabel(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = parseLocalDateString(dateStr) || new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startThat.getTime() - startToday.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch { return String(dateStr); }
}

function shortCity(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return 'Campus';
  const first = text.split(',')[0]?.trim() || text;
  return first.length > 14 ? `${first.slice(0, 13)}...` : first;
}

function mergeRows(prev: InboxItem[], cur: InboxItem[]): InboxItem[] {
  const map: Record<string, InboxItem> = {};
  [...prev, ...cur].forEach((row) => { map[row.id] = row; });
  return Object.values(map).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
}

export default function RequestsInboxScreen() {
  const router = useRouter();
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const email = firebaseAuth.currentUser?.email ?? null;

  const [items, setItems] = useState<InboxItem[]>([]);
  const [openItems, setOpenItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userDataByUserId, setUserDataByUserId] = useState<Record<string, { name: string; rating: number; email: string }>>({});
  const [offeredByReqId, setOfferedByReqId] = useState<Record<string, { id: string; status: string }>>({});
  const filter = useRideBrowseStore((state) => state.driverFilter);
  const search = useRideBrowseStore((state) => state.driverSearch);
  const setFilter = useRideBrowseStore((state) => state.setDriverFilter);
  const setSearch = useRideBrowseStore((state) => state.setDriverSearch);

  const allItems = useMemo<InboxItem[]>(() => {
    const map: Record<string, InboxItem> = {};
    [...openItems, ...items].forEach((item) => { map[item.id] = item; });
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
      const searchable = [item.pickup, item.dropoff, userData?.name, item.requesterName, item.requesterEmail].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(term);
    });
  }, [allItems, items, filter, search, offeredByReqId, userDataByUserId]);

  const finalItems = useMemo(() => {
    if (filter === 'best') return [...filteredItems].sort((a, b) => scoreRequest(b) - scoreRequest(a));
    return filteredItems;
  }, [filteredItems, filter, userDataByUserId]);

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

  useEffect(() => {
    if (!uid && !email) {
      setItems([]); setOpenItems([]); setLoading(false);
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
    qs.forEach((qy) => { try { unsubs.push(onSnapshot(qy, handler, () => setLoading(false))); } catch {} });

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

    return () => { unsubs.forEach((u) => u()); };
  }, [uid, email]);

  useEffect(() => {
    (async () => {
      const ids = Array.from(new Set([...items, ...openItems].map((item) => item.requesterId).filter(Boolean))) as string[];
      const missing = ids.filter((id) => !userDataByUserId[id]);
      if (!missing.length) return;
      const nextUserData: Record<string, { name: string; rating: number; email: string }> = {};
      for (const id of missing) {
        try {
          const userSnap = await getDoc(doc(firestore, 'riders', id));
          if (!userSnap.exists()) continue;
          const data: any = userSnap.data();
          const name = data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ') || data.name || data.displayName || '';
          const rating = data.rating || data.averageRating || (data.ratingSum && data.ratingCount ? data.ratingSum / data.ratingCount : 5.0);
          nextUserData[id] = { name: String(name).trim(), rating, email: data.email || '' };
        } catch {}
      }
      if (Object.keys(nextUserData).length) setUserDataByUserId((prev) => ({ ...prev, ...nextUserData }));
    })();
  }, [items, openItems, userDataByUserId]);

  const chips: { key: RequestFilter; label: string }[] = [
    { key: 'all', label: `ALL\n${allItems.length}` },
    { key: 'open', label: 'Open' },
    { key: 'today', label: 'Today' },
    { key: 'tomorrow', label: 'Tmrw' },
    { key: 'best', label: '★\nBest' },
  ];

  const renderItem = ({ item }: { item: InboxItem }) => {
    const isOffered = !!offeredByReqId[item.id];
    const dayLabel = relativeDayLabel(item.date);
    const userData = item.requesterId ? userDataByUserId[item.requesterId] : undefined;
    const displayName = userData?.name?.trim() || item.requesterName?.trim() || 'Rider';
    const userRating = userData?.rating || 5.0;
    const initials = displayName.split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase() || 'R';
    const seatsLabel = item.seats ? `${item.seats} seat${item.seats !== 1 ? 's' : ''}` : '1 seat';

    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => router.push({ pathname: '/(driver)/request/[id]', params: { id: item.id, returnTo: '/(driver)/requests' } } as any)}
        activeOpacity={0.88}
      >
        <View style={s.cardTop}>
          <View style={s.dot} />
          <Text style={s.route} numberOfLines={1}>
            {shortCity(item.pickup)} → {shortCity(item.dropoff)}
          </Text>
          <Text style={s.time}>{[dayLabel, item.time].filter(Boolean).join('\n')}</Text>
        </View>

        <View style={s.dash} />

        <View style={s.cardBottom}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.riderName} numberOfLines={1}>{displayName}</Text>
            <Text style={s.riderMeta}>★ {userRating.toFixed(2)} · {seatsLabel}</Text>
          </View>
          {item.price ? (
            <Text style={s.price}>${Math.round(item.price)}</Text>
          ) : (
            <Text style={s.priceOpen}>Open</Text>
          )}
        </View>

        <View style={s.actions}>
          <TouchableOpacity
            style={s.declineBtn}
            onPress={() => {
              setOpenItems((prev) => prev.filter((r) => r.id !== item.id));
              setItems((prev) => prev.filter((r) => r.id !== item.id));
            }}
          >
            <Text style={s.declineBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.offerBtn, isOffered && s.disabled]}
            disabled={isOffered}
            onPress={() => offerOnRequest(item)}
          >
            <Text style={s.offerBtnText}>{isOffered ? 'Sent ✓' : 'Offer ride'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <FlatList
          data={finalItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <View style={s.pageHeader}>
                <Text style={s.pageTitle}>Requests</Text>
              </View>

              <View style={s.searchBar}>
                <Ionicons name="search" size={18} color={NAVY} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search by rider or destination..."
                  placeholderTextColor={MUTED}
                  style={s.searchInput}
                  returnKeyType="search"
                />
                {search ? (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <Ionicons name="close" size={18} color={MUTED} />
                  </TouchableOpacity>
                ) : null}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                {chips.map(({ key, label }) => (
                  <TouchableOpacity
                    key={key}
                    style={[s.chip, filter === key && s.chipActive]}
                    onPress={() => setFilter(key)}
                    accessibilityRole="button"
                  >
                    <Text style={[s.chipText, filter === key && s.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <View style={s.loadingWrap}>
                <ActivityIndicator color={ORANGE} size="large" />
                <Text style={s.loadingText}>Loading requests...</Text>
              </View>
            ) : (
              <View style={s.emptyCard}>
                <View style={s.emptyIcon}>
                  <Ionicons name="car-outline" size={27} color={ORANGE} />
                </View>
                <Text style={s.emptyTitle}>No requests yet</Text>
                <Text style={s.emptyText}>
                  {filter !== 'all'
                    ? 'Try a different filter.'
                    : 'Rider requests will appear here as students post trips.'}
                </Text>
              </View>
            )
          }
        />
      </SafeAreaView>

      <DriverBottomNav activeTab="requests" />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 102, flexGrow: 1 },
  pageHeader: { marginBottom: 16 },
  pageTitle: { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25 },
  searchBar: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 12,
    marginBottom: 16,
    shadowColor: NAVY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  searchInput: { flex: 1, height: 54, paddingVertical: 0, color: NAVY, fontSize: 14, fontWeight: '500' },
  chipRow: { gap: 8, paddingBottom: 20 },
  chip: {
    minWidth: 72,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#D7DCE3',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  chipActive: { backgroundColor: NAVY, borderColor: NAVY },
  chipText: { color: '#6B7280', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  chipTextActive: { color: '#FFFFFF' },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 14,
    shadowColor: NAVY,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NAVY },
  route: { flex: 1, color: NAVY, fontSize: 16, fontWeight: '700' },
  time: { color: MUTED, fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'right' },
  dash: { borderTopWidth: 1, borderColor: '#ECE8E1', marginVertical: 14 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F9E8DB',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: ORANGE, fontSize: 14, fontWeight: '600' },
  riderName: { color: NAVY, fontSize: 16, fontWeight: '600' },
  riderMeta: { color: MUTED, fontSize: 13, fontWeight: '600', marginTop: 3 },
  price: { color: ORANGE, fontSize: 28, fontWeight: '500', marginLeft: 8 },
  priceOpen: { color: MUTED, fontSize: 16, fontWeight: '600', marginLeft: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  declineBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#D7DCE3',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtnText: { color: NAVY, fontSize: 14, fontWeight: '700' },
  offerBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  loadingWrap: { alignItems: 'center', paddingTop: 60, gap: 14 },
  loadingText: { color: MUTED, fontSize: 14, fontWeight: '500' },
  emptyCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: BORDER,
    backgroundColor: '#FFFFFF',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 180,
    marginTop: 20,
  },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F9E8DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  emptyText: { maxWidth: 280, color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
});
