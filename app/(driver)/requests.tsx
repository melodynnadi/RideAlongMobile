import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, TextInput, Platform, ScrollView, Linking, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { firebaseAuth, firestore, storage } from '@/constants/services';
import { collection, doc, getDoc, onSnapshot, query, updateDoc, where, addDoc, serverTimestamp, Timestamp, getDocs, limit as fsLimit } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { Image } from 'expo-image';
import { Clock, ChevronRight, Star, MapPin, User, Filter, Share2 } from 'lucide-react-native';
import { Button } from '@/components/ui/Button';
import { theme } from '@/theme';
import { RideFiltersModal } from '@/components/RideFiltersModal';
import { getDefaultFilters, filterRides as applyRideFilters, hasActiveFilters, type RideFilterOptions } from '@/utils/rideFilters';
import { AddressLink } from '@/components/AddressLink';

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
  const theme = useTheme();
  const router = useRouter();
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const email = firebaseAuth.currentUser?.email ?? null;
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [avatarByUser, setAvatarByUser] = useState<Record<string, string>>({});
  const [userDataByUserId, setUserDataByUserId] = useState<Record<string, { name: string; rating: number; email: string }>>({});
  const [openItems, setOpenItems] = useState<InboxItem[]>([]);
  const [offeredByReqId, setOfferedByReqId] = useState<Record<string, { id: string; status: string }>>({});
  const [filter, setFilter] = useState<'all' | 'today' | 'tomorrow' | 'open' | 'assigned'>('all');
  const [search, setSearch] = useState('');

  const [filtersVisible, setFiltersVisible] = useState(false);
  const [basicFilters, setBasicFilters] = useState<RideFilterOptions>(getDefaultFilters());
  // const [prefFilters, setPrefFilters] = useState<any>({});
  // const [prefsByUserId, setPrefsByUserId] = useState<Record<string, any>>({});
  const allItems = useMemo<InboxItem[]>(() => {
    // de-dupe by id, prefer assigned items over open to keep status context
    const map: Record<string, InboxItem> = {};
    [...openItems, ...items].forEach((i) => { map[i.id] = i; });
    return Object.values(map);
  }, [openItems, items]);
      const filteredItems = useMemo(() => {
        const term = search.trim().toLowerCase();
        return allItems.filter((i) => {
          // Hide requests where driver has already sent an offer
          if (offeredByReqId[i.id]) return false;
          
          if (filter === 'today' && !isSameDay(i.date, 0)) return false;
          if (filter === 'tomorrow' && !isSameDay(i.date, 1)) return false;
          if (filter === 'open' && !!items.find((x) => x.id === i.id)) return false;
          if (filter === 'assigned' && !items.find((x) => x.id === i.id)) return false;
          if (!term) return true;
          
          // Include fetched user name in search
          const userData = i.requesterId ? userDataByUserId[i.requesterId] : undefined;
          const searchableFields = [
            i.pickup, 
            i.dropoff, 
            userData?.name, // Prioritize fetched user name
            i.requesterName, 
            i.requesterEmail
          ];
          
          const hay = searchableFields
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return hay.includes(term);
        });
      }, [allItems, items, filter, search, offeredByReqId]);
  
  // Apply basic filters from RideFiltersModal
  const basicFilteredItems = useMemo(() => {
    if (!hasActiveFilters(basicFilters)) return filteredItems;
    // Convert to format expected by applyRideFilters
    const rawRequests = filteredItems.map(item => ({
      id: item.id,
      date: item.date,
      time: item.time,
      pickup: item.pickup,
      dropoff: item.dropoff,
      price: item.price,
      contributionAmount: item.price,
      seats: item.seats
    }));
    const filtered = applyRideFilters(rawRequests, basicFilters, true);
    const filteredIds = new Set(filtered.map((r: any) => r.id));
    return filteredItems.filter(item => filteredIds.has(item.id));
  }, [filteredItems, basicFilters]);
  
  const finalItems = basicFilteredItems;
  // Preference filtering disabled - uncomment if needed
  // const finalItems = useMemo(() => {
  //   const hasAnyPref = Object.values(prefFilters || {}).some((v) => Array.isArray(v) && v.length > 0);
  //   if (!hasAnyPref) return basicFilteredItems;
  //   return basicFilteredItems;
  // }, [basicFilteredItems]);

  // const togglePref = (key: string, val: string) => {
  //   // setPrefFilters implementation
  // };


  useEffect(() => {
    if (!uid && !email) {
      setItems([]);
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
        const contribRaw = r.contributionAmount ?? r.contribution ?? r.requestedContribution;
        const contribNum = typeof contribRaw === 'number'
          ? contribRaw
          : (typeof contribRaw === 'string'
              ? (() => { const n = parseFloat(contribRaw.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? NaN : n; })()
              : NaN);
        const priceFieldNum = typeof r.price === 'number' ? r.price : (typeof r.price === 'string' ? (() => { const n = parseFloat(r.price.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? NaN : n; })() : NaN);
        const estFareNum = typeof r.estimatedFare === 'number' ? r.estimatedFare : (typeof r.estimatedFare === 'string' ? (() => { const n = parseFloat(r.estimatedFare.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? NaN : n; })() : NaN);
        const price = !isNaN(contribNum) && contribNum > 0 ? contribNum : (!isNaN(priceFieldNum) && priceFieldNum > 0 ? priceFieldNum : (!isNaN(estFareNum) && estFareNum > 0 ? estFareNum : null));
        const dt = getRideDateTime(r);
        const pickup = extractAddress(r, 'pickup') || 'Pickup';
        const dropoff = extractAddress(r, 'dropoff') || 'Dropoff';
        const seats = (typeof r.passengers === 'number') ? r.passengers
          : (typeof r.numPassengers === 'number' ? r.numPassengers
          : (typeof r.seats === 'number' ? r.seats : null));
        const durText = getDurationText(r);
        const distInfo = getDistanceInfo(r);
        const requesterName = r.userName || r.riderName || r.requesterName || r.name || null;
        const requesterId = r.userId || r.riderId || r.requesterId || null;
        const requesterEmail = r.userEmail || r.riderEmail || r.requesterEmail || r.email || null;
        const requesterPhone = r.userPhone || r.phone || r.phoneNumber || r.contactPhone || null;
        rows.push({
          id: d.id,
          pickup,
          dropoff,
          date: r.date || (dt ? formatDateOnly(dt) : null),
          time: r.time || (dt ? formatTime(dt) : null),
          price,
          seats,
          durationText: durText || null,
          distanceText: distInfo.text || null,
          distanceMiles: typeof distInfo.miles === 'number' ? distInfo.miles : null,
          notes: r.notes || null,
          requesterName,
          requesterId,
          requesterEmail,
          requesterPhone,
          status: String(r.status || 'pending'),
          ridePostingId: r.ridePostingId || r.postingId || null,
        });
      });
      setItems((prev) => mergeRows(prev, rows));
      setLoading(false);
    };

    // Build many alternate queries to cover various backend schemas
    const qs: any[] = [];
    if (uid) {
      qs.push(query(base, where('driverId', '==', uid)));
      qs.push(query(base, where('driverUID', '==', uid)));
      qs.push(query(base, where('driverUid', '==', uid)));
      qs.push(query(base, where('userId', '==', uid))); // some systems store requester as userId
      qs.push(query(base, where('recipientId', '==', uid)));
      qs.push(query(base, where('assignedDriverId', '==', uid)));
      qs.push(query(base, where('providerId', '==', uid)));
      qs.push(query(base, where('recipients', 'array-contains', uid)));
      qs.push(query(base, where('driverIds', 'array-contains', uid)));
      // nested driver field variants
      try { qs.push(query(base, where('driver.id', '==', uid))); } catch {}
      try { qs.push(query(base, where('assignedDriver.id', '==', uid))); } catch {}
    }
    if (email) {
      qs.push(query(base, where('driverEmail', '==', email)));
      qs.push(query(base, where('email', '==', email)));
      qs.push(query(base, where('userEmail', '==', email)));
      qs.push(query(base, where('riderEmail', '==', email)));
      qs.push(query(base, where('requesterEmail', '==', email)));
      qs.push(query(base, where('recipientsEmail', 'array-contains', email)));
      // nested email variants
      try { qs.push(query(base, where('driver.email', '==', email))); } catch {}
      try { qs.push(query(base, where('assignedDriver.email', '==', email))); } catch {}
    }

    // Attach listeners
    qs.forEach((q) => {
      try { unsubs.push(onSnapshot(q, handler, () => setLoading(false))); } catch {}
    });

    // Optional: fallback to alternate collection names
    if (unsubs.length === 0) {
      try {
        const altBase = collection(firestore, 'ride_requests');
        const altQs: any[] = [];
        if (uid) {
          altQs.push(query(altBase, where('driverId', '==', uid)));
          altQs.push(query(altBase, where('userId', '==', uid)));
        }
        if (email) {
          altQs.push(query(altBase, where('driverEmail', '==', email)));
          altQs.push(query(altBase, where('email', '==', email)));
        }
        altQs.forEach((q) => {
          try { unsubs.push(onSnapshot(q, handler, () => setLoading(false))); } catch {}
        });
      } catch {}
    }

    // Dev aid: peek at a few docs to log available fields (non-blocking)
    (async () => {
      try {
        const snap = await getDocs(query(base, fsLimit(3)));
        const sample = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // eslint-disable-next-line no-console
        console.log('[Requests] sample rideRequests docs:', sample);
      } catch (e) {
        // ignore
      }
    })();

    // Listen to OPEN rider requests that any driver can offer on (web uses status==pending only)
    try {
      // Match web: query only pending status, then exclude confirmed and already-offered client-side
      const qOpen = query(base, where('status', '==', 'pending'));
  const mapOpen = async (snap: any) => {
        console.log('[Requests] open snapshot size=', snap.size);
        let rawDocs = snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} }));
        console.log('[Requests] raw pending docs:', rawDocs.length);
        
        // Exclude confirmed rides (web joins confirmedRides collection)
        try {
          const confirmedSet = await getConfirmedRideRequestIdSet(rawDocs.map((doc: any) => String(doc.id)));
          if (confirmedSet.size > 0) {
            const before = rawDocs.length;
            rawDocs = rawDocs.filter((doc: any) => !confirmedSet.has(String(doc.id)));
            console.log('[Requests] filtered', before - rawDocs.length, 'confirmed rides');
          }
        } catch (e) {
          console.warn('[Requests] confirmed join error', e);
        }
        
        // Exclude requests the current driver already offered on (web checks rideOffers)
        if (uid) {
          try {
            const offeredSet = await getOfferedRequestIdSet(uid);
            if (offeredSet.size > 0) {
              const before = rawDocs.length;
              rawDocs = rawDocs.filter((doc: any) => !offeredSet.has(String(doc.id)));
              console.log('[Requests] filtered', before - rawDocs.length, 'already-offered requests');
            }
          } catch (e) {
            console.warn('[Requests] offered join error', e);
          }
        }
        
        const rows: InboxItem[] = [];
        rawDocs.forEach((docWrapper: any) => {
          const d = { id: docWrapper.id };
          const r = docWrapper.data;
          // Exclude requests created by me
          if (uid && (r.userId === uid)) return;
          if (email && typeof r.userEmail === 'string' && r.userEmail.toLowerCase() === email.toLowerCase()) return;
          // Exclude requests already assigned to a driver (client-side filter)
          if (r.driverId || r.assignedDriverId || r.providerId || r.recipientId) return;
          
          // Filter: Exclude rides scheduled >24h in the past
          const dt = getRideDateTime(r);
          if (dt) {
            const now = new Date();
            const diffMs = now.getTime() - dt.getTime();
            const hrs = diffMs / (1000 * 60 * 60);
            console.log('[Requests] checking ride', d.id, '| scheduled:', dt.toISOString(), '| hours ago:', hrs.toFixed(2), '| date:', r.date, '| time:', r.time);
            if (hrs > 24) {
              console.log('[Requests] ❌ skipping ride scheduled >24h ago:', d.id);
              return;
            }
            console.log('[Requests] ✅ including ride (within 24h):', d.id);
          } else {
            console.log('[Requests] ⚠️ no datetime found for ride:', d.id, '| date:', r.date, '| time:', r.time);
          }
          
          const pickup = extractAddress(r, 'pickup') || 'Pickup';
          const dropoff = extractAddress(r, 'dropoff') || 'Dropoff';
          const seats = (typeof r.passengers === 'number') ? r.passengers
            : (typeof r.numPassengers === 'number' ? r.numPassengers
            : (typeof r.seats === 'number' ? r.seats : null));
          const contribRaw = r.contributionAmount ?? r.contribution ?? r.requestedContribution;
          const contribNum = typeof contribRaw === 'number'
            ? contribRaw
            : (typeof contribRaw === 'string'
                ? (() => { const n = parseFloat(contribRaw.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? NaN : n; })()
                : NaN);
          const priceFieldNum = typeof r.price === 'number' ? r.price : (typeof r.price === 'string' ? (() => { const n = parseFloat(r.price.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? NaN : n; })() : NaN);
          const estFareNum = typeof r.estimatedFare === 'number' ? r.estimatedFare : (typeof r.estimatedFare === 'string' ? (() => { const n = parseFloat(r.estimatedFare.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? NaN : n; })() : NaN);
          const price = !isNaN(contribNum) && contribNum > 0 ? contribNum : (!isNaN(priceFieldNum) && priceFieldNum > 0 ? priceFieldNum : (!isNaN(estFareNum) && estFareNum > 0 ? estFareNum : null));
          const durText = getDurationText(r);
          const distInfo = getDistanceInfo(r);
          rows.push({
            id: d.id,
            pickup,
            dropoff,
            date: r.date || (dt ? formatDateOnly(dt) : null),
            time: r.time || (dt ? formatTime(dt) : null),
            price,
            seats,
            durationText: durText || null,
            distanceText: distInfo.text || null,
            distanceMiles: typeof distInfo.miles === 'number' ? distInfo.miles : null,
            notes: r.notes || null,
            requesterName: r.userName || r.riderName || r.requesterName || r.name || null,
            requesterId: r.userId || r.riderId || r.requesterId || null,
            requesterEmail: r.userEmail || r.riderEmail || r.requesterEmail || r.email || null,
            requesterPhone: r.userPhone || r.phone || r.phoneNumber || r.contactPhone || null,
            status: String(r.status || 'pending'),
            ridePostingId: r.ridePostingId || r.postingId || null,
          });
        });
        console.log('[Requests] open rows after local filters:', rows.length);
        setOpenItems(rows);
      };
      unsubs.push(onSnapshot(qOpen, mapOpen, (e) => console.warn('[Requests] open listener error', e)));
    } catch {}

    // Track rideOffers I have already sent (to hide those requests)
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
    // preload avatars and user data for requesterId across both open and assigned items
    (async () => {
      const ids = Array.from(new Set([...items, ...openItems].map((i) => i.requesterId).filter(Boolean))) as string[];
      const missing = ids.filter((id) => !avatarByUser[id] || !userDataByUserId[id]);
      if (!missing.length) return;
      const nextAvatars: Record<string, string> = {};
      const nextUserData: Record<string, { name: string; rating: number; email: string }> = {};
      // const nextPrefs: Record<string, any> = {};
      
      for (const id of missing) {
        try {
          const u = await getDoc(doc(firestore, 'users', id));
          if (u.exists()) {
            const d: any = u.data();
            
            // Extract avatar URL
            const raw = d.profilePicture || d.avatarUrl || d.photoURL || d.photoUrl || d.profileImageUrl || d.imageUrl;
            if (typeof raw === 'string') {
              if (/^(gs:\/\/|\/)/.test(raw)) {
                try { nextAvatars[id] = await getDownloadURL(storageRef(storage, raw)); } catch {}
              } else { nextAvatars[id] = raw; }
            }
            
            // Extract user data (name, rating, email)
            let name = '';
            if (d.fullName && typeof d.fullName === 'string') {
              name = d.fullName.trim();
            } else if (d.firstName && d.lastName && typeof d.firstName === 'string' && typeof d.lastName === 'string') {
              name = `${d.firstName.trim()} ${d.lastName.trim()}`;
            } else if (d.name && typeof d.name === 'string') {
              name = d.name.trim();
            } else if (d.displayName && typeof d.displayName === 'string') {
              name = d.displayName.trim();
            }
            
            const rating = d.rating || d.averageRating || d.ratingSum && d.ratingCount ? (d.ratingSum / d.ratingCount) : 5.0;
            const email = d.email || '';
            
            nextUserData[id] = { name, rating, email };
            try {
              // nextPrefs[id] = d.preferences || d.profile || d;
            } catch {}
          }
        } catch {}
      }
      
      if (Object.keys(nextAvatars).length) setAvatarByUser((p) => ({ ...p, ...nextAvatars }));
      if (Object.keys(nextUserData).length) setUserDataByUserId((p) => ({ ...p, ...nextUserData }));
      // if (Object.keys(nextPrefs).length) setPrefsByUserId((p) => ({ ...p, ...nextPrefs }));
    })();
  }, [items, openItems]);

  const mergeRows = (prev: InboxItem[], cur: InboxItem[]) => {
    const map: Record<string, InboxItem> = {};
    [...prev, ...cur].forEach((r) => { map[r.id] = r; });
    return Object.values(map).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
  };

  const offerOnRequest = async (item: InboxItem) => {
    try {
      if (!uid) { Alert.alert('Sign in required', 'Please sign in to offer a ride.'); return; }
      
      // Check verification status
      const userDoc = await getDoc(doc(firestore, 'users', uid));
      const isVerified = userDoc.exists() && userDoc.data()?.isVerified === true;
      if (!isVerified) {
        const verificationDeadline = userDoc.data()?.verificationDeadline;
        const deadlineText = verificationDeadline ? ` Your deadline: ${new Date(verificationDeadline.toDate ? verificationDeadline.toDate() : verificationDeadline).toLocaleDateString()}.` : '';
        Alert.alert(
          'Verification Required',
          `You must verify your student status before sending ride offers.${deadlineText}`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Verify Now', 
              onPress: async () => {
                try {
                  const token = await firebaseAuth.currentUser?.getIdToken();
                  if (token) {
                    await Linking.openURL(`https://ridealongapp.com/pages/driver-login?token=${token}`);
                  }
                } catch (e) {
                  console.warn('Failed to open verification URL', e);
                }
              }
            }
          ]
        );
        return;
      }
      
      if (offeredByReqId[item.id]) { Alert.alert('Already offered', 'You already sent an offer for this request.'); return; }
      // Shape payload to match web offer schema (see RIDE_OFFER_IMPLEMENTATION.md)
      const driverEmailFinal = email || null;
      const driverNameFinal = firebaseAuth.currentUser?.displayName
        || (driverEmailFinal ? String(driverEmailFinal).split('@')[0] : null);
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
        // Optional: for convenience
        offerPrice: item.price ?? null,
        distance: item.distanceMiles != null ? { miles: item.distanceMiles, text: item.distanceText ?? `${Math.round(item.distanceMiles)} mi` } : (item.distanceText ? { text: item.distanceText } : null),
        duration: item.durationText ?? null,
        // Web shape: details nested
        rideDetails: {
          pickup: item.pickup ?? null,
          destination: item.dropoff ?? null,
          date: item.date ?? null,
          time: item.time ?? null,
          passengers: item.seats ?? 1,
          contributionAmount: (typeof item.price === 'number' ? item.price.toFixed(2) : (item.price || null)),
        },
      };
      const ref = await addDoc(collection(firestore, 'rideOffers'), payload);
      setOfferedByReqId((prev) => ({ ...prev, [item.id]: { id: ref.id, status: 'pending' } }));
      Alert.alert('Offer sent', 'Your offer was sent to the rider.');
    } catch (e) {
      console.warn('offerOnRequest failed', e);
      Alert.alert('Failed', 'Could not send your offer.');
    }
  };

  const renderItem = ({ item }: { item: InboxItem }) => {
    const isOffered = !!offeredByReqId[item.id];
    const dayLabel = relativeDayLabel(item.date);
    const priceText = formatMoney(item.price);
    const avatarUri = item.requesterId ? avatarByUser[item.requesterId] : undefined;
    const userData = item.requesterId ? userDataByUserId[item.requesterId] : undefined;
    
    // Better name fallback logic - userData only has name, rating, email fields
    let displayName = 'Requester';
    if (userData?.name && userData.name.trim()) {
      displayName = userData.name.trim();
    } else if (item.requesterName && item.requesterName.trim()) {
      displayName = item.requesterName.trim();
    } else if (userData?.email && userData.email.trim()) {
      displayName = userData.email.trim();
    } else if (item.requesterEmail && item.requesterEmail.trim()) {
      displayName = item.requesterEmail.trim();
    }
    
    const userRating = userData?.rating || 5.0;
    
    return (
      <View style={[styles.card, theme.shadows.md]}>
        {/* Header: Avatar, name, rating, day/time */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.avatarWrap}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} contentFit="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <User size={18} color="#64748B" />
                </View>
              )}
            </View>
            <View style={{ marginLeft: 12 }}>
              <Text style={[styles.name, { color: theme.colors.secondary }]} numberOfLines={1}>
                {displayName}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Star size={14} color={theme.colors.primary} />
                <Text style={[styles.ratingText, { color: theme.colors.primary }]}>
                  {userRating.toFixed(1)}
                </Text>
              </View>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.dayLabel, { color: '#64748B' }]}>{dayLabel}</Text>
            <Text style={[styles.timeLabel, { color: theme.colors.primary }]}>{item.time || ''}</Text>
          </View>
        </View>

        {/* Addresses */}
        <View style={{ marginTop: 10 }}>
          <View style={styles.addrRow}> 
            <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
            <AddressLink address={item.pickup} textStyle={{ ...styles.addrTextBold, color: theme.colors.secondary }} numberOfLines={1} />
          </View>
          <View style={[styles.addrRow, { marginTop: 6 }]}> 
            <View style={[styles.dot, { backgroundColor: '#9CA3AF' }]} />
            <AddressLink address={item.dropoff} textStyle={{ ...styles.addrText, color: '#6B7280' }} numberOfLines={1} />
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Meta row */}
        <View style={styles.metaRow}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            <View style={styles.metaGroup}>
              <Clock size={16} color={'#64748B'} />
              <Text style={styles.metaText}>{getDurationText(item as any) || ''}</Text>
            </View>
            <View style={styles.metaGroup}>
              <MapPin size={16} color={'#64748B'} />
              <Text style={styles.metaText}>{(() => {
                if (typeof item.distanceMiles === 'number') {
                  return `${Math.round(item.distanceMiles)} mi`;
                } else {
                  const distanceInfo = getDistanceInfo(item as any);
                  return distanceInfo.text || item.distanceText || '';
                }
              })()}</Text>
            </View>
          </View>
                <TouchableOpacity
                  onPress={() => {
                    const p = new URLSearchParams();
                    const n = (displayName && displayName !== 'Requester' ? displayName : '').split(' ')[0];
                    if (n) p.set('name', n);
                    if (item.pickup) p.set('from', item.pickup);
                    if (item.dropoff) p.set('to', item.dropoff);
                    const q = p.toString();
                    const url = `https://ridealongapp.com/request/${item.id}${q ? '?' + q : ''}`;
                    Share.share({ message: `Check out this ride request on RideAlong!\n${url}`, url }).catch(() => {});
                  }}
                  style={{ marginRight: 12, padding: 2 }}
                  accessibilityRole="button"
                  accessibilityLabel="Share this ride request"
                >
                  <Share2 size={16} color={theme.colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push(`/request/${item.id}`)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.viewDetails, { color: theme.colors.primary }]}>View Details</Text>
                  <ChevronRight size={16} color={theme.colors.primary} />
                </TouchableOpacity>
        </View>

        {/* Button */}
        <View style={{ marginTop: 12 }}>
          <Button
            variant="primary"
            size="md"
            fullWidth
            style={styles.offerBtnCompact}
            disabled={isOffered}
            onPress={() => offerOnRequest(item)}
          >
            {isOffered ? 'Offer sent' : `Offer Ride • ${priceText || ''}`}
          </Button>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={['top']}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Text style={{ fontSize: 28, fontWeight: 'bold', color: theme.colors.secondary }}>Ride Requests</Text>
        <Text style={{ color: '#64748B', marginTop: 4 }}>Find rider requests and send offers.</Text>
          {/* Search */}
          <View style={styles.searchWrap}>
            <TextInput
              placeholder="Search requests, destinations..."
              placeholderTextColor="#94A3B8"
              value={search}
              onChangeText={setSearch}
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
        {/* Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersContainer}
        >
          {/* Filter Modal Button */}
          <TouchableOpacity
            onPress={() => setFiltersVisible(true)}
            style={[
              styles.chip, 
              { 
                flexDirection: 'row', 
                alignItems: 'center', 
                gap: 6,
              },
              hasActiveFilters(basicFilters) && { 
                backgroundColor: theme.colors.primary, 
                borderColor: theme.colors.primary 
              }
            ]}
          >
            <Filter size={16} color={hasActiveFilters(basicFilters) ? '#FFFFFF' : '#111827'} />
            <Text style={{ color: hasActiveFilters(basicFilters) ? '#FFFFFF' : '#111827', fontWeight: '600' }}>
              Filters{hasActiveFilters(basicFilters) && ` (${Object.values(basicFilters).filter(v => v !== null && v !== '').length})`}
            </Text>
          </TouchableOpacity>
          
          {(['all','today','tomorrow','open','assigned'] as const).map((k) => (
            <TouchableOpacity
              key={k}
              onPress={() => setFilter(k)}
              style={[
                styles.chip, 
                filter === k && { 
                  backgroundColor: theme.colors.primary, 
                  borderColor: theme.colors.primary 
                }
              ]}
            >
              <Text style={{ color: filter === k ? '#FFFFFF' : '#111827', fontWeight: '600' }}>
                {k === 'all' ? 'All' : k === 'today' ? 'Today' : k === 'tomorrow' ? 'Tomorrow' : k === 'open' ? 'Open' : 'Assigned'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={finalItems}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconContainer}>
                <MapPin size={64} color="#CBD5E1" />
              </View>
              <Text style={styles.emptyStateTitle}>No ride requests</Text>
              <Text style={styles.emptyStateSubtitle}>New requests will appear here</Text>
            </View>
          }
        />
      )}

      
      {/* Ride Filters Modal */}
      <RideFiltersModal
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        onApply={(filters) => setBasicFilters(filters)}
        initialFilters={basicFilters}
        showSeatsFilter={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    marginTop: 12,
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    fontSize: 16,
    color: '#111827',
  },
  filtersContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarPlaceholder: {
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    maxWidth: 180,
  },
  ratingText: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  dayLabel: {
    fontSize: 12,
  },
  timeLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  addrLeft: {
    flex: 1,
    minWidth: 0,
  },
  addrRight: {
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  titleArrow: {
    marginHorizontal: 8,
    fontSize: 16,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addrTextBold: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  addrText: {
    fontSize: 16,
    flex: 1,
    minWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 16,
  },
  meta: {
    color: '#6B7280',
    marginTop: 6,
  },
  metaText: {
    color: '#64748B',
  },
  price: {
    color: '#1F2937',
    fontWeight: '700',
  },
  viewDetails: {
    fontWeight: '600',
    marginRight: 4,
  },
  status: {
    color: '#6B7280',
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  offerBtnCompact: {
    minHeight: 35,
    paddingVertical: 5,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  modalSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  infoCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    marginTop: 8,
  },
  badgeConfirmed: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8F7E9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 12,
  },
  badgeConfirmedText: {
        color: '#16A34A',
        fontWeight: '700',
      },
      badgePending: {
        alignSelf: 'flex-start',
        backgroundColor: '#FEF3C7',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        marginTop: 12,
      },
      badgePendingText: {
        color: '#D97706',
        fontWeight: '700',
      },
      badgeNeutral: {
        alignSelf: 'flex-start',
        backgroundColor: '#E5E7EB',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        marginTop: 12,
      },
      badgeNeutralText: {
        color: '#374151',
        fontWeight: '700',
      },
      grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 8,
      },
      tile: {
        width: '48%',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#EEF2F7',
        paddingVertical: 12,
        paddingHorizontal: 12,
      },
      tileLabel: {
        color: '#059669',
        fontWeight: '600',
        marginBottom: 4,
      },
      tileValue: {
        color: '#111827',
        fontWeight: '700',
      },
      // Homepage modal style parity
      modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
      },
      modalContent: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '90%',
        paddingTop: 20,
      },
      modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
      },
      modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1F2937',
      },
      closeButton: {
        padding: 4,
      },
      modalBody: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 20,
      },
      statusBadgeModal: {
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        marginBottom: 20,
      },
      statusBadgeConfirmed: {
        backgroundColor: '#DCFCE7',
      },
      statusBadgeCompleted: {
        backgroundColor: '#F3F4F6',
      },
      statusBadgePendingModal: {
        backgroundColor: '#FEF3C7',
      },
      statusTextModal: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'capitalize',
      },
      statusTextConfirmed: {
        color: '#166534',
      },
      statusTextCompleted: {
        color: '#6B7280',
      },
      statusTextPendingModal: {
        color: '#92400E',
      },
      modalSection: {
        marginBottom: 24,
      },
      sectionTitleModal: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
        marginBottom: 12,
      },
      routeModalContainer: {
        paddingLeft: 8,
      },
      routeModalPoint: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
      },
      routeModalLine: {
        width: 2,
        height: 20,
        backgroundColor: '#D1D5DB',
        marginLeft: 7,
        marginBottom: 8,
      },
      orangeDotModal: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#E05E1A',
        marginRight: 12,
      },
      locationModalText: {
        fontSize: 14,
        color: '#1F2937',
        fontWeight: '500',
      },
      infoGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 12,
      },
      infoItem: {
        flex: 1,
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#F8FAFC',
        borderRadius: 8,
        marginHorizontal: 0,
        minWidth: 0,
      },
      infoLabel: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 4,
        marginBottom: 2,
      },
      infoValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1F2937',
        textAlign: 'center',
        flexWrap: 'wrap',
      },
      driverInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
      },
      driverAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#E2E8F0',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
      },
      driverAvatarImg: {
        width: 48,
        height: 48,
        borderRadius: 24,
        marginRight: 12,
        backgroundColor: '#E2E8F0',
      },
      driverDetails: {
        flex: 1,
      },
      driverName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
        marginBottom: 2,
      },
      driverVehicle: {
        fontSize: 14,
        color: '#64748B',
        marginBottom: 2,
      },
      driverPhone: {
        fontSize: 14,
        color: '#64748B',
        marginBottom: 4,
      },
      ratingModalContainer: {
        flexDirection: 'row',
        alignItems: 'center',
      },
      ratingModalText: {
        fontSize: 14,
        color: '#64748B',
        marginLeft: 4,
      },
      callIconBtn: {
        marginLeft: 12,
        padding: 8,
        borderRadius: theme.borderRadius.full,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
        justifyContent: 'center',
      },
      // Empty state
      emptyState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 80,
      },
      emptyIconContainer: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
      },
      emptyStateTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1F2937',
        marginBottom: 8,
      },
      emptyStateSubtitle: {
        fontSize: 16,
        color: '#64748B',
        textAlign: 'center',
      },
});
// end of file
