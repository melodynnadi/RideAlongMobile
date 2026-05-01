import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, FlatList, ActivityIndicator, Image, Alert, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, MapPin, Clock, Users, DollarSign, Star, Filter, Share2 } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { collection, onSnapshot, query, where, orderBy, getDoc, doc, getDocs, limit as fsLimit, addDoc, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { firestore, firebaseAuth, storage, getApiBaseUrl } from '@/constants/services';
import { PaymentModal } from '@/components/PaymentModal';
import { checkCanRequestRide } from '@/services/verification';
import { RideFiltersModal } from '@/components/RideFiltersModal';
import { getDefaultFilters, filterRides as applyRideFilters, hasActiveFilters, type RideFilterOptions } from '@/utils/rideFilters';
import { AddressLink } from '@/components/AddressLink';

export default function AvailableRidesScreen() {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [rides, setRides] = useState<any[]>([]);
  const [excludedPostingIds, setExcludedPostingIds] = useState<Set<string>>(new Set());
  const [profilesByKey, setProfilesByKey] = useState<Record<string, any>>({}); // key by driverId or driverEmail
  const [rideAvatars, setRideAvatars] = useState<Record<string, string>>({}); // cache avatar by ridePosting id
  const [loading, setLoading] = useState(true);

  const [paymentModalVisible, setPaymentModalVisible] = useState(false);
  const [paymentRide, setPaymentRide] = useState<{ id: string; baseFare: number; driverId: string | null } | null>(null);
  const [cancelingRideId, setCancelingRideId] = useState<string | null>(null);
  const [viewerProfile, setViewerProfile] = useState<any | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [prefFilters, setPrefFilters] = useState<RidePreferenceFilters | undefined>(undefined);
  const [basicFilters, setBasicFilters] = useState<RideFilterOptions>(getDefaultFilters());

  useEffect(() => {
    // Listen for ride postings from Firestore
    // We try to include common statuses used by the web: available/open
    const base = collection(firestore, 'ridePostings');
    // Prefer ordering by createdAt if available; Firestore requires index if combined with where; so keep it simple.
    const q1 = query(base);
    const unsub = onSnapshot(
      q1,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Store raw postings; downstream memo applies availability/exclusion filters so updates to excludedPostingIds take effect
        setRides(data as any[]);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  // Fetch viewer (rider) profile/preferences
  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(firestore, 'riders', uid);
    getDoc(ref).then((snap) => { if (snap.exists()) setViewerProfile(snap.data()); }).catch(() => {});
  }, []);

  // Hide postings that the current user has already requested (Offer Sent / pending / accepted)
  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;

    console.log('🔍 [available-rides] Setting up ridePostingRequests listener for riderId:', uid);
    
    const rprCol = collection(firestore, 'ridePostingRequests');
    const unsubRpr = onSnapshot(query(rprCol, where('riderId', '==', uid)), (snap) => {
      console.log(`📥 [available-rides] ridePostingRequests listener fired: ${snap.size} documents`);
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data: any = d.data();
        console.log(`   📄 Doc ID: ${d.id}, ridePostingId: ${data.ridePostingId}, status: ${data.status}`);
        const status = String(data?.status || data?.state || '').toLowerCase();
        // Only exclude when request is active (not cancelled/declined/rejected/expired/completed)
        const inactive = ['cancelled','canceled','declined','rejected','expired','completed'].includes(status);
        if (inactive) return;
        // Collect any identifiers that map back to the posting
        if (data.ridePostingId) ids.add(String(data.ridePostingId));
        if (data.postingId) ids.add(String(data.postingId));
        if (data.rideId) ids.add(String(data.rideId));
        // DocumentReference mapping
        const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
        if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
        // Alternate field names sometimes used
        if (data.originalPostingId) ids.add(String(data.originalPostingId));
        if (data.parentPostingId) ids.add(String(data.parentPostingId));
        if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
  // Do not use the request document id as a posting id; only rely on explicit fields/refs
      });
      console.log(`   🚫 Excluding ${ids.size} posting IDs:`, Array.from(ids));
      if (ids.size) {
        setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
      }
    }, () => {});

    // Also inspect rider-created rideRequests that reference a posting
    const rrCol = collection(firestore, 'rideRequests');
    const unsubRr = onSnapshot(query(rrCol, where('riderId', '==', uid)), (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data: any = d.data();
        const status = String(data?.status || data?.state || '').toLowerCase();
        const inactive = ['cancelled','canceled','declined','rejected','expired','completed'].includes(status);
        if (inactive) return;
        if (data.ridePostingId) ids.add(String(data.ridePostingId));
        if (data.postingId) ids.add(String(data.postingId));
        if (data.rideId) ids.add(String(data.rideId));
        const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
        if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
        if (data.originalPostingId) ids.add(String(data.originalPostingId));
        if (data.parentPostingId) ids.add(String(data.parentPostingId));
        if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
      });
      if (ids.size) {
        setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
      }
    }, () => {});

    return () => { unsubRpr(); unsubRr(); };
  }, []);

  // Also hide postings for requests matched by riderEmail (some documents set riderEmail but not riderId)
  useEffect(() => {
    const email = firebaseAuth.currentUser?.email;
    if (!email) return;

    const rprCol = collection(firestore, 'ridePostingRequests');
    const unsubRprEmail = onSnapshot(query(rprCol, where('riderEmail', '==', email)), (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data: any = d.data();
        const status = String(data?.status || data?.state || '').toLowerCase();
        const inactive = ['cancelled','canceled','declined','rejected','expired','completed'].includes(status);
        if (inactive) return;
        if (data.ridePostingId) ids.add(String(data.ridePostingId));
        if (data.postingId) ids.add(String(data.postingId));
        if (data.rideId) ids.add(String(data.rideId));
        const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
        if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
  if (data.originalPostingId) ids.add(String(data.originalPostingId));
        if (data.parentPostingId) ids.add(String(data.parentPostingId));
        if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
  // Do not use the request document id as a posting id; only rely on explicit fields/refs
      });
      if (ids.size) setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
    }, () => {});

    const rrCol = collection(firestore, 'rideRequests');
    const unsubRrEmail = onSnapshot(query(rrCol, where('riderEmail', '==', email)), (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data: any = d.data();
        const status = String(data?.status || data?.state || '').toLowerCase();
        const inactive = ['cancelled','canceled','declined','rejected','expired','completed'].includes(status);
        if (inactive) return;
        if (data.ridePostingId) ids.add(String(data.ridePostingId));
        if (data.postingId) ids.add(String(data.postingId));
        if (data.rideId) ids.add(String(data.rideId));
        const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
        if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
        if (data.originalPostingId) ids.add(String(data.originalPostingId));
        if (data.parentPostingId) ids.add(String(data.parentPostingId));
        if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
      });
      if (ids.size) setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
    }, () => {});

    return () => { unsubRprEmail(); unsubRrEmail(); };
  }, []);

  // Listen to confirmedRides and rideHistory for THIS rider only, to hide postings they have joined or completed
  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    const email = firebaseAuth.currentUser?.email;
    const unsubs: Array<() => void> = [];

    if (uid) {
      const q1 = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid));
      unsubs.push(onSnapshot(q1, (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.postingId) ids.add(String(data.postingId));
          if (data.ridePostingId) ids.add(String(data.ridePostingId));
          if (data.rideId) ids.add(String(data.rideId));
          const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
          if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
          if (data.originalPostingId) ids.add(String(data.originalPostingId));
          if (data.parentPostingId) ids.add(String(data.parentPostingId));
          if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
        });
        if (ids.size) setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
      }, () => {}));
    }
    if (email) {
      const q2 = query(collection(firestore, 'confirmedRides'), where('riderEmail', '==', email));
      unsubs.push(onSnapshot(q2, (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.postingId) ids.add(String(data.postingId));
          if (data.ridePostingId) ids.add(String(data.ridePostingId));
          if (data.rideId) ids.add(String(data.rideId));
          const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
          if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
          if (data.originalPostingId) ids.add(String(data.originalPostingId));
          if (data.parentPostingId) ids.add(String(data.parentPostingId));
          if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
        });
        if (ids.size) setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
      }, () => {}));
    }

    if (uid) {
      const q3 = query(collection(firestore, 'rideHistory'), where('riderId', '==', uid));
      unsubs.push(onSnapshot(q3, (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.postingId) ids.add(String(data.postingId));
          if (data.ridePostingId) ids.add(String(data.ridePostingId));
          if (data.rideId) ids.add(String(data.rideId));
          const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
          if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
          if (data.originalPostingId) ids.add(String(data.originalPostingId));
          if (data.parentPostingId) ids.add(String(data.parentPostingId));
          if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
        });
        if (ids.size) setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
      }, () => {}));
    }
    if (email) {
      const q4 = query(collection(firestore, 'rideHistory'), where('riderEmail', '==', email));
      unsubs.push(onSnapshot(q4, (snap) => {
        const ids = new Set<string>();
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (data.postingId) ids.add(String(data.postingId));
          if (data.ridePostingId) ids.add(String(data.ridePostingId));
          if (data.rideId) ids.add(String(data.rideId));
          const refObj = data.postingRef || data.ridePostingRef || data.rideRef || data.sourcePostingRef;
          if (refObj && typeof refObj === 'object' && refObj.id) ids.add(String(refObj.id));
          if (data.originalPostingId) ids.add(String(data.originalPostingId));
          if (data.parentPostingId) ids.add(String(data.parentPostingId));
          if (data.sourcePostingId) ids.add(String(data.sourcePostingId));
        });
        if (ids.size) setExcludedPostingIds((prev) => new Set([...Array.from(prev), ...Array.from(ids)]));
      }, () => {}));
    }

    return () => { unsubs.forEach((u) => u()); };
  }, []);

  // When rides load/update, fetch missing driver profiles by driverId or driverEmail
  useEffect(() => {
    if (!rides || rides.length === 0) return;

    const ids = new Set<string>();
    const emails = new Set<string>();
  const docRefs: any[] = [];
    for (const r of rides) {
  // ID-like fields
  if (typeof r.driverId === 'string' && r.driverId) ids.add(r.driverId);
  if (typeof r.driverUID === 'string' && r.driverUID) ids.add(r.driverUID);
  if (typeof r.driverUid === 'string' && r.driverUid) ids.add(r.driverUid);
  if (typeof r.ownerId === 'string' && r.ownerId) ids.add(r.ownerId);
  if (typeof r.postedBy === 'string' && r.postedBy) ids.add(r.postedBy);
  if (typeof r.userId === 'string' && r.userId) ids.add(r.userId);
  if (typeof r.uid === 'string' && r.uid) ids.add(r.uid);
  if (typeof r.creatorId === 'string' && r.creatorId) ids.add(r.creatorId);
  if (typeof r.creatorUID === 'string' && r.creatorUID) ids.add(r.creatorUID);
  if (typeof r.authorId === 'string' && r.authorId) ids.add(r.authorId);
  if (typeof r.authorUID === 'string' && r.authorUID) ids.add(r.authorUID);
  if (typeof r.createdById === 'string' && r.createdById) ids.add(r.createdById);
  if (typeof r.createdByUID === 'string' && r.createdByUID) ids.add(r.createdByUID);
  if (r.createdBy?.id) ids.add(String(r.createdBy.id));
  if (r.createdBy?.uid) ids.add(String(r.createdBy.uid));
  if (r.ownerUID) ids.add(String(r.ownerUID));
  // Nested driver/owner/poster/profile ids
  if (r.driver?.id) ids.add(String(r.driver.id));
  if (r.driver?.uid) ids.add(String(r.driver.uid));
  if (r.owner?.id) ids.add(String(r.owner.id));
  if (r.owner?.uid) ids.add(String(r.owner.uid));
  if (r.poster?.id) ids.add(String(r.poster.id));
  if (r.poster?.uid) ids.add(String(r.poster.uid));
  if (r.profile?.id) ids.add(String(r.profile.id));
  if (r.profile?.uid) ids.add(String(r.profile.uid));

  // Email-like fields
  if (typeof r.driverEmail === 'string' && r.driverEmail) emails.add(r.driverEmail);
  if (typeof r.email === 'string' && r.email) emails.add(r.email);
  if (typeof r.ownerEmail === 'string' && r.ownerEmail) emails.add(r.ownerEmail);
  if (typeof r.postedByEmail === 'string' && r.postedByEmail) emails.add(r.postedByEmail);
  if (typeof r.userEmail === 'string' && r.userEmail) emails.add(r.userEmail);
  if (typeof r.creatorEmail === 'string' && r.creatorEmail) emails.add(r.creatorEmail);
  if (typeof r.createdByEmail === 'string' && r.createdByEmail) emails.add(r.createdByEmail);
  if (r.createdBy?.email) emails.add(String(r.createdBy.email));
  if (r.profile?.email) emails.add(String(r.profile.email));
  // Nested emails commonly used on web
  if (r.driver?.email) emails.add(String(r.driver.email));
  if (r.owner?.email) emails.add(String(r.owner.email));
  if (r.poster?.email) emails.add(String(r.poster.email));

  // DocumentReference-style fields (fetch directly if present)
  const maybeRefs = [r.driverRef, r.ownerRef, r.userRef, r.createdByRef, r.profileRef, r.posterRef];
  for (const ref of maybeRefs) {
    if (ref && typeof ref === 'object' && typeof ref.id === 'string') {
      docRefs.push(ref);
      ids.add(String(ref.id));
    }
  }
    }

    // Normalize any id values that look like path strings (e.g., "users/UID")
    // by also adding the last segment (UID) as a candidate id key.
    const extraIds: string[] = [];
    ids.forEach((val) => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed.includes('/')) {
          const last = trimmed.split('/').filter(Boolean).pop();
          if (last) extraIds.push(last);
        }
      }
    });
    extraIds.forEach((x) => ids.add(x));

    const missingIdKeys = Array.from(ids).filter((k) => !profilesByKey[k]);
    const missingEmailKeys = Array.from(emails).filter((k) => !profilesByKey[k]);
    if (missingIdKeys.length === 0 && missingEmailKeys.length === 0) return;

    (async () => {
      const updates: Record<string, any> = {};
      // Try to resolve any DocumentReference fields directly
      await Promise.all(docRefs.map(async (ref: any) => {
        try {
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const d: any = snap.data();
            const prof = normalizeProfile(d);
            const raw = d.profilePicture || d.avatarUrl || d.avatarURL || d.photoURL || d.photoUrl || d.profileImageUrl || d.imageUrl || d.picture || d.avatar;
            if (!prof.avatarUrl && typeof raw === 'string') {
              const s = String(raw).trim();
              const isHttp = /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
              if (!isHttp) {
                try { prof.avatarUrl = await getDownloadURL(storageRef(storage, s)); } catch {}
              }
            }
            updates[ref.id] = prof;
            if (typeof d.email === 'string' && d.email) updates[d.email] = prof;
          }
        } catch {}
      }));
      // Fetch by doc id for ids
      await Promise.all(missingIdKeys.map(async (uid) => {
        try {
          // Try users/<uid>
          const snapUser = await getDoc(doc(firestore, 'drivers', uid));
          if (snapUser.exists()) {
            const d: any = snapUser.data();
            const prof = normalizeProfile(d);
            // Try resolve Storage avatar paths (gs:// or relative storage path) to https URL
            const raw = d.profilePicture || d.avatarUrl || d.avatarURL || d.photoURL || d.photoUrl || d.profileImageUrl || d.imageUrl || d.picture || d.avatar;
            if (!prof.avatarUrl && typeof raw === 'string') {
              const s = String(raw).trim();
              const isHttp = /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
              if (!isHttp) {
                try {
                  prof.avatarUrl = await getDownloadURL(storageRef(storage, s));
                } catch {}
              }
            }
            updates[uid] = prof;
            if (typeof d.email === 'string' && d.email) updates[d.email] = prof;
          } else {
            // Try drivers/<uid>
            const snapDriver = await getDoc(doc(firestore, 'drivers', uid));
            if (snapDriver.exists()) {
              const d: any = snapDriver.data();
              const prof = normalizeProfile(d);
              const raw = d.profilePicture || d.avatarUrl || d.avatarURL || d.photoURL || d.photoUrl || d.profileImageUrl || d.imageUrl || d.picture || d.avatar;
              if (!prof.avatarUrl && typeof raw === 'string') {
                const s = String(raw).trim();
                const isHttp = /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
                if (!isHttp) {
                  try {
                    prof.avatarUrl = await getDownloadURL(storageRef(storage, s));
                  } catch {}
                }
              }
              updates[uid] = prof;
              if (typeof d.email === 'string' && d.email) updates[d.email] = prof;
            }
          }
        } catch {}
      }));

      // Fetch by email using 'in' chunks (max 10)
      const emailArr = missingEmailKeys.slice();
      while (emailArr.length) {
        const chunk = emailArr.splice(0, 10);
        try {
          const q = query(collection(firestore, 'drivers'), where('email', 'in', chunk), fsLimit(10));
          const snap = await getDocs(q);
          snap.forEach((docu) => {
            const d: any = docu.data();
            const prof = normalizeProfile(d);
            const raw = d.profilePicture || d.avatarUrl || d.avatarURL || d.photoURL || d.photoUrl || d.profileImageUrl || d.imageUrl || d.picture || d.avatar;
            // Note: cannot await inside forEach reliably; use thenable but it's okay if late update
            if (!prof.avatarUrl && typeof raw === 'string') {
              const s = String(raw).trim();
              const isHttp = /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
              if (!isHttp) {
                getDownloadURL(storageRef(storage, s)).then((url) => {
                setProfilesByKey((prev) => ({ ...prev, [d.email || docu.id]: { ...(prev[d.email || docu.id] || prof), avatarUrl: url } }));
              }).catch(() => {});
              }
            }
            if (typeof d.email === 'string' && d.email) updates[d.email] = prof;
            updates[docu.id] = prof;
          });
        } catch {}
        try {
          const q2 = query(collection(firestore, 'drivers'), where('email', 'in', chunk), fsLimit(10));
          const snap2 = await getDocs(q2);
          snap2.forEach((docu) => {
            const d: any = docu.data();
            const prof = normalizeProfile(d);
            const raw = d.profilePicture || d.avatarUrl || d.avatarURL || d.photoURL || d.photoUrl || d.profileImageUrl || d.imageUrl || d.picture || d.avatar;
            if (!prof.avatarUrl && typeof raw === 'string') {
              const s = String(raw).trim();
              const isHttp = /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
              if (!isHttp) {
                getDownloadURL(storageRef(storage, s)).then((url) => {
                setProfilesByKey((prev) => ({ ...prev, [d.email || docu.id]: { ...(prev[d.email || docu.id] || prof), avatarUrl: url } }));
              }).catch(() => {});
              }
            }
            if (typeof d.email === 'string' && d.email) updates[d.email] = prof;
            updates[docu.id] = prof;
          });
        } catch {}
      }

      if (Object.keys(updates).length) setProfilesByKey((prev) => ({ ...prev, ...updates }));
    })();
  }, [rides]);

  const filters = [
    { id: 'open-filters', label: 'Filters' },
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'tomorrow', label: 'Tomorrow' },
    { id: 'low-price', label: '< $15' },
    { id: 'high-rating', label: '4.8+' }
  ];

  // Note: Removed demo placeholder rides. We only show real posted rides now.

  const filteredRides = useMemo(() => {
  // Apply availability/exclusion filters here so changes to excludedPostingIds reflect immediately
  const base = rides.filter((r: any) => {
      // Filter out rides older than 24 hours based on scheduled ride date/time
      const dateStr = r?.date || r?.departureDate || r?.travelDate || r?.dateString;
      const timeStr = r?.time || r?.departureTime || r?.pickupTime || r?.timeString;
      if (dateStr && timeStr) {
        try {
          const [year, month, day] = dateStr.split('-').map(Number);
          const [hours, minutes] = timeStr.split(':').map(Number);
          const rideDateTime = new Date(year, month - 1, day, hours, minutes);
          const now = new Date();
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          if (rideDateTime < oneDayAgo) return false; // Skip rides more than 24 hours old
        } catch (err) {
          // Keep if parsing fails
        }
      }
      
      const status = String(r?.status || r?.state || '').toLowerCase();
      // Keep postings visible unless they are fully confirmed or not offerable
      // Allow 'accepted' (1/2) to show so second passenger can join
      const nonAvailableStatuses = new Set([
        'confirmed', 'completed', 'in-progress', 'in_progress', 'inprogress',
        'closed', 'unavailable', 'inactive', 'cancelled', 'canceled', 'expired'
      ]);
      if (nonAvailableStatuses.has(status)) return false;
      
      // Additional check: filter out if both driver and rider confirmed completion
      if (r?.driverCompleteConfirmed && r?.riderCompleteConfirmed) return false;
      
      // Additional check: filter out if explicitly marked as completed (any casing)
      const statusUpper = String(r?.status || r?.state || '').toUpperCase();
      if (statusUpper === 'COMPLETED') return false;

      // Compute remaining capacity; prefer explicit available fields; else derive from capacity - filled
      const explicitAvail = coerceNum(r?.availableSeats ?? r?.seatsAvailable ?? null);
      const capacity = coerceNum(
        r?.seatsTotal ?? r?.totalSeats ?? r?.seatsOffered ?? r?.passengerCapacity ?? r?.maxPassengers ?? r?.seats ?? null
      );
      const filledCandidates = [
        r?.seatsFilled, r?.seatsBooked, r?.seatsUsed, r?.passengersCount,
        Array.isArray(r?.passengers) ? r.passengers.length : null,
        Array.isArray(r?.acceptedOffers) ? r.acceptedOffers.length : null
      ];
      const filled = coerceNum(filledCandidates.find((v: any) => typeof v === 'number'));
      let seatsLeft: number | null = null;
      if (typeof explicitAvail === 'number') seatsLeft = explicitAvail;
      else if (typeof capacity === 'number' && typeof filled === 'number') seatsLeft = capacity - filled;
      if (typeof seatsLeft === 'number' && seatsLeft <= 0) return false;

      if (r?.id && excludedPostingIds.has(r.id)) return false;
      if (r?.postingId && excludedPostingIds.has(String(r.postingId))) return false;
      if (r?.rideId && excludedPostingIds.has(String(r.rideId))) return false;
      const postingRef = r?.postingRef || r?.ridePostingRef || r?.rideRef || r?.sourcePostingRef;
      if (postingRef && typeof postingRef === 'object' && postingRef.id && excludedPostingIds.has(String(postingRef.id))) return false;
      const altIds = [r?.originalPostingId, r?.parentPostingId, r?.sourcePostingId].filter(Boolean);
      for (const alt of altIds) { if (excludedPostingIds.has(String(alt))) return false; }
      return true;
    });

  const list = base.map((posting: any) => {
      // Normalize ridePosting schema to the UI model
      const pickupAddr = posting.pickupAddress || posting.pickup || posting.pickupLocation?.address || posting.origin || posting.from || 'Pickup';
      const dropAddr = posting.dropoffAddress || posting.dropoff || posting.dropoffLocation?.address || posting.destination || posting.to || 'Dropoff';
      const dateVal = posting.date || posting.departureDate || posting.travelDate || posting.dateString;
      const timeVal = posting.time || posting.departureTime || posting.pickupTime || posting.timeString;
      const durationText = posting.duration?.text || posting.durationLabel || (typeof posting.duration === 'number' ? `${Math.round(posting.duration)} min` : posting.duration) || '';
      const distanceText = posting.distance?.text || posting.distanceText || (typeof posting.distance === 'number' ? `${posting.distance.toFixed?.(1) ?? posting.distance} mi` : undefined);
      const seats = posting.availableSeats ?? posting.seatsAvailable ?? posting.seats ?? 0;
      const price = (typeof posting.pricePerSeat === 'number' ? posting.pricePerSeat : (typeof posting.contributionAmount === 'number' ? posting.contributionAmount : (typeof posting.estimatedFare === 'number' ? posting.estimatedFare : 0)));
      const profFallback =
        // direct id keys
        profilesByKey[posting.driverId] || profilesByKey[posting.driverUID] || profilesByKey[posting.driverUid] ||
        profilesByKey[posting.ownerId] || profilesByKey[posting.ownerUID] || profilesByKey[posting.postedBy] ||
        profilesByKey[posting.userId] || profilesByKey[posting.uid] || profilesByKey[posting.creatorId] || profilesByKey[posting.creatorUID] ||
        profilesByKey[posting.authorId] || profilesByKey[posting.authorUID] || profilesByKey[posting.createdById] || profilesByKey[posting.createdByUID] ||
        // nested id keys
        profilesByKey[posting.driver?.id] || profilesByKey[posting.driver?.uid] ||
        profilesByKey[posting.owner?.id] || profilesByKey[posting.owner?.uid] ||
        profilesByKey[posting.poster?.id] || profilesByKey[posting.poster?.uid] ||
        profilesByKey[posting.profile?.id] || profilesByKey[posting.profile?.uid] ||
        profilesByKey[posting.createdBy?.id] || profilesByKey[posting.createdBy?.uid] ||
        // direct email keys
        profilesByKey[posting.driverEmail] || profilesByKey[posting.email] || profilesByKey[posting.ownerEmail] || profilesByKey[posting.postedByEmail] ||
        profilesByKey[posting.userEmail] || profilesByKey[posting.creatorEmail] || profilesByKey[posting.createdByEmail] ||
        // nested email keys
        profilesByKey[posting.driver?.email] || profilesByKey[posting.owner?.email] || profilesByKey[posting.poster?.email] ||
        profilesByKey[posting.profile?.email] || profilesByKey[posting.createdBy?.email];

      let driverName =
        profFallback?.name ||
        posting.driverName || posting.driver?.name || posting.driver?.fullName ||
        ((posting.driverFirstName || posting.firstName) && (posting.driverLastName || posting.lastName)
          ? `${posting.driverFirstName || posting.firstName} ${posting.driverLastName || posting.lastName}`
          : undefined) ||
        posting.ownerName || posting.posterName || posting.postedByName ||
        posting.userName || posting.userFullName || posting.displayName || posting.profile?.name || posting.profile?.fullName ||
        posting.owner?.fullName || posting.owner?.name || posting.createdByName || posting.createdBy?.name ||
        'Driver';
      // If still placeholder, derive from any known email
      if (driverName === 'Driver') {
        const emailGuess = posting.driverEmail || posting.ownerEmail || posting.email || posting.postedByEmail || posting.userEmail || posting.creatorEmail || posting.createdByEmail || posting.driver?.email || posting.owner?.email || posting.poster?.email || posting.profile?.email || posting.createdBy?.email;
        if (typeof emailGuess === 'string' && emailGuess.includes('@')) {
          const base = emailGuess.split('@')[0];
          const pretty = base.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          if (pretty) driverName = pretty;
        }
      }
      const driverRating = posting.driverRating || posting.rating || posting.driver?.rating || posting.ownerRating || profFallback?.rating || 0;
      const rawAvatar = (
        profFallback?.avatarUrl ||
        posting.driver?.avatarUrl || posting.driver?.photoURL || posting.driver?.photoUrl ||
        posting.driver?.profilePicture ||
        posting.driver?.personalInfo?.profilePicture || posting.driver?.personalInfo?.photoURL || posting.driver?.personalInfo?.photoUrl || posting.driver?.personalInfo?.imageUrl ||
        posting.owner?.avatarUrl || posting.owner?.photoURL || posting.owner?.photoUrl ||
        posting.owner?.profilePicture ||
        posting.owner?.personalInfo?.profilePicture || posting.owner?.personalInfo?.photoURL || posting.owner?.personalInfo?.photoUrl || posting.owner?.personalInfo?.imageUrl ||
        posting.poster?.avatarUrl || posting.poster?.photoURL || posting.poster?.photoUrl ||
        posting.poster?.profilePicture ||
        posting.poster?.personalInfo?.profilePicture || posting.poster?.personalInfo?.photoURL || posting.poster?.personalInfo?.photoUrl || posting.poster?.personalInfo?.imageUrl ||
        posting.profile?.avatarUrl || posting.profile?.photoURL || posting.profile?.photoUrl ||
        posting.profile?.profilePicture ||
        posting.profile?.personalInfo?.profilePicture || posting.profile?.personalInfo?.photoURL || posting.profile?.personalInfo?.photoUrl || posting.profile?.personalInfo?.imageUrl ||
        posting.createdBy?.avatarUrl || posting.createdBy?.photoURL || posting.createdBy?.photoUrl ||
        posting.createdBy?.profilePicture ||
        posting.createdBy?.personalInfo?.profilePicture || posting.createdBy?.personalInfo?.photoURL || posting.createdBy?.personalInfo?.photoUrl || posting.createdBy?.personalInfo?.imageUrl ||
        posting.driverAvatarUrl || posting.avatarUrl || posting.driverPhotoUrl || posting.profilePicture || posting.photoURL || posting.photoUrl || posting.profileImageUrl || posting.imageUrl ||
        null
      );
      const driverAvatarUrl = rideAvatars[posting.id] || sanitizeAvatar(rawAvatar);
      const vehicle = posting.vehicle || posting.vehicleInfo?.model || posting.carModel || '';
      const notes =
        posting.notes ||
        posting.driverNotes ||
        posting.additionalNotes ||
        posting.additionalNote ||
        posting.driverAdditionalNote ||
        '';

      // Extract driver ID from various possible fields
      const driverId = posting.driverId || posting.driverUID || posting.driverUid || 
                       posting.ownerId || posting.ownerUID || posting.postedBy ||
                       posting.userId || posting.uid || posting.creatorId || posting.creatorUID ||
                       posting.authorId || posting.authorUID || posting.createdById || posting.createdByUID ||
                       posting.driver?.id || posting.driver?.uid ||
                       posting.owner?.id || posting.owner?.uid ||
                       posting.poster?.id || posting.poster?.uid ||
                       posting.profile?.id || posting.profile?.uid ||
                       posting.createdBy?.id || posting.createdBy?.uid;

      return {
        id: posting.id,
        driver: { 
          id: driverId,
          name: driverName, 
          rating: driverRating, 
          avatarUrl: driverAvatarUrl 
        },
        pickup: pickupAddr,
        dropoff: dropAddr,
        pickupTime: formatTimeString(timeVal) || '',
        date: formatDateLabel(dateVal) || '',
        availableSeats: seats,
        pricePerSeat: price,
        duration: durationText,
        distance: distanceText,
        preferences: posting.preferences ?? [],
  vehicle,
        notes,
        // for preference filter source
        prefSource: profFallback || posting,
      };
    });
    let res = list.filter((ride) => {
    const matchesSearch = 
      ride.pickup.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ride.dropoff.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ride.driver.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    let matchesFilter = true;
    switch (selectedFilter) {
      case 'today':
        matchesFilter = ride.date === 'Today';
        break;
      case 'tomorrow':
        matchesFilter = ride.date === 'Tomorrow';
        break;
      case 'low-price':
        matchesFilter = ride.pricePerSeat < 15;
        break;
      case 'high-rating':
        matchesFilter = ride.driver.rating >= 4.8;
        break;
    }
    
      return matchesSearch && matchesFilter;
    });
    
    // Apply basic filters from the filters modal
    if (hasActiveFilters(basicFilters)) {
      // Map the filtered ride list back to raw ride objects for filtering
      const rideMap = new Map(list.map(r => [r.id, r]));
      const rawRides = list.map(r => rides.find(raw => raw.id === r.id)).filter(Boolean);
      const basicFiltered = applyRideFilters(rawRides, basicFilters, true);
      const filteredIds = new Set(basicFiltered.map((r: any) => r.id));
      res = res.filter(r => filteredIds.has(r.id));
    }
    
    // Apply preference filters against driver profile/preferences
    if (prefFilters) {
      res = res.filter((ride: any) => {
        const source = (ride as any).prefSource || profilesByKey[ride?.driver?.id] || {};
        return prefMatchMobile('rider', prefFilters, source);
      });
      // Optional: sort by match score
      res = res.slice().sort((a: any, b: any) => {
        const sa = scoreMatchMobile(prefFilters, (a as any).prefSource || profilesByKey[a?.driver?.id] || {});
        const sb = scoreMatchMobile(prefFilters, (b as any).prefSource || profilesByKey[b?.driver?.id] || {});
        return sb - sa;
      });
    }
    return res;
  }, [rides, searchQuery, selectedFilter, profilesByKey, rideAvatars, excludedPostingIds, prefFilters, basicFilters]);

  // Helper to normalize numeric values (accept strings like "2")
  function coerceNum(val: any): number | null {
    if (typeof val === 'number' && !isNaN(val)) return val;
    if (typeof val === 'string') {
      const n = Number(val);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  // Re-rank by best match if viewer profile present
  const displayData = useMemo(() => {
    if (!viewerProfile) return filteredRides;
    try {
      const sorted = getMatchesForRider(rides, viewerProfile, {}, 'best');
      const order = new Map(sorted.map((p: any, i: number) => [p.id, i]));
      return filteredRides.slice().sort((a: any, b: any) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    } catch {
      return filteredRides;
    }
  }, [filteredRides, viewerProfile, rides]);
  const hasAnyRides = rides.length > 0;

  // Attempt to resolve Storage avatar URLs directly from ride postings when not http(s)
  useEffect(() => {
    const run = async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        rides.map(async (posting: any) => {
          if (!posting?.id || rideAvatars[posting.id]) return;
          const raw = (
            posting.driver?.avatarUrl || posting.driver?.photoURL || posting.driver?.photoUrl ||
            posting.driver?.profilePicture ||
            posting.driver?.personalInfo?.profilePicture || posting.driver?.personalInfo?.photoURL || posting.driver?.personalInfo?.photoUrl || posting.driver?.personalInfo?.imageUrl ||
            posting.owner?.avatarUrl || posting.owner?.photoURL || posting.owner?.photoUrl ||
            posting.owner?.profilePicture ||
            posting.owner?.personalInfo?.profilePicture || posting.owner?.personalInfo?.photoURL || posting.owner?.personalInfo?.photoUrl || posting.owner?.personalInfo?.imageUrl ||
            posting.poster?.avatarUrl || posting.poster?.photoURL || posting.poster?.photoUrl ||
            posting.poster?.profilePicture ||
            posting.poster?.personalInfo?.profilePicture || posting.poster?.personalInfo?.photoURL || posting.poster?.personalInfo?.photoUrl || posting.poster?.personalInfo?.imageUrl ||
            posting.profile?.avatarUrl || posting.profile?.photoURL || posting.profile?.photoUrl ||
            posting.profile?.profilePicture ||
            posting.profile?.personalInfo?.profilePicture || posting.profile?.personalInfo?.photoURL || posting.profile?.personalInfo?.photoUrl || posting.profile?.personalInfo?.imageUrl ||
            posting.createdBy?.avatarUrl || posting.createdBy?.photoURL || posting.createdBy?.photoUrl ||
            posting.createdBy?.profilePicture ||
            posting.createdBy?.personalInfo?.profilePicture || posting.createdBy?.personalInfo?.photoURL || posting.createdBy?.personalInfo?.photoUrl || posting.createdBy?.personalInfo?.imageUrl ||
            posting.driverAvatarUrl || posting.avatarUrl || posting.driverPhotoUrl || posting.profilePicture || posting.photoURL || posting.photoUrl || posting.profileImageUrl || posting.imageUrl ||
            null
          );
          if (typeof raw === 'string') {
            const s = raw.trim();
            const isHttp = /^https?:\/\//i.test(s) || /^data:image\//i.test(s);
            if (!isHttp) {
              try {
                const url = await getDownloadURL(storageRef(storage, s));
                updates[posting.id] = url;
              } catch {}
            }
          }
        })
      );
      if (Object.keys(updates).length) setRideAvatars((prev) => ({ ...prev, ...updates }));
    };
    if (rides.length) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rides]);

  const openRideDetails = (ride: any) => {
    router.push(`/ride/${ride.id}`);
  };

  const isPostedByCurrentUser = (ride: any) => {
    const currentUid = firebaseAuth.currentUser?.uid;
    const currentEmail = firebaseAuth.currentUser?.email;
    if (!currentUid && !currentEmail) return false;

    const posting = rides.find((r) => r.id === ride.id) || ride;
    const posterId = posting.driverId || posting.driverUID || posting.driverUid || 
                     posting.ownerId || posting.ownerUID || posting.postedBy ||
                     posting.userId || posting.uid || posting.creatorId || posting.creatorUID ||
                     posting.riderId || posting.riderUID || posting.riderUid;
    const posterEmail = posting.driverEmail || posting.email || posting.ownerEmail || 
                        posting.postedByEmail || posting.userEmail || posting.creatorEmail ||
                        posting.riderEmail;

    return (currentUid && posterId === currentUid) || (currentEmail && posterEmail === currentEmail);
  };

  const handleCancelRide = async (rideId: string) => {
    Alert.alert(
      'Cancel Ride Posting',
      'Are you sure you want to cancel this ride posting? This action cannot be undone.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              setCancelingRideId(rideId);
              const apiUrl = getApiBaseUrl();
              const response = await fetch(`${apiUrl}/api/rides/${rideId}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  collection: 'ridePostings',
                  cancelledBy: 'rider',
                  reason: 'Cancelled by poster'
                })
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to cancel ride');
              }

              Alert.alert('Success', 'Your ride posting has been cancelled.');
            } catch (error: any) {
              console.error('Cancel ride error:', error);
              Alert.alert('Error', error.message || 'Failed to cancel ride posting. Please try again.');
            } finally {
              setCancelingRideId(null);
            }
          }
        }
      ]
    );
  };

  const handleOpenPayment = (ride: any) => {
    // Check verification status before proceeding
    if (!checkCanRequestRide()) {
      return;
    }

    const posting = rides.find((r) => r.id === ride.id) || {};
    const driverId = posting.driverId || posting.driverUID || posting.driverUid || posting.ownerId || posting.postedBy || null;
    const baseFare = typeof posting.pricePerSeat === 'number' ? posting.pricePerSeat : (typeof posting.contributionAmount === 'number' ? posting.contributionAmount : (typeof posting.estimatedFare === 'number' ? posting.estimatedFare : (typeof ride.pricePerSeat === 'number' ? ride.pricePerSeat : 0)));
    setPaymentRide({ id: ride.id, baseFare, driverId });
    setPaymentModalVisible(true);
  };

  const handlePaymentSuccess = async (paymentIntentId: string) => {
    console.log('🎉 handlePaymentSuccess called with paymentIntentId:', paymentIntentId);
    
    // Close modals - the PaymentModal will show the success alert
    setPaymentModalVisible(false);
    setPaymentRide(null);
    
    // The available-rides listener and home screen listener will automatically:
    // 1. Remove this ride from available rides list (via excludedPostingIds)
    // 2. Show "Offer Sent" card on home screen
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]} edges={['top']}>
  <View style={styles.header}>
        <View style={styles.headerContent}>
      <Text style={styles.headerTitle}>
            Available Rides
          </Text>
      <Text style={styles.headerSubtitle}>
            Find rides posted by other students
          </Text>
        </View>
      </View>

      <FlatList
        data={loading ? [] : displayData}
        keyExtractor={(item: any) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            {/* Search Bar */}
            <View style={styles.searchContainer}>
              <View style={[styles.searchBar, { backgroundColor: 'white' }]}>
                <Search size={20} color="#64748B" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search rides, destinations..."
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholderTextColor="#64748B"
                  returnKeyType="search"
                />
              </View>
            </View>
            {/* Filters */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filtersContainer}
            >
              {/* Filter Modal Button */}
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  { flexDirection: 'row', alignItems: 'center', gap: 6 },
                  hasActiveFilters(basicFilters) && [styles.activeFilterChip, { backgroundColor: theme.colors.primary }]
                ]}
                onPress={() => setFiltersVisible(true)}
              >
                <Filter size={16} color={hasActiveFilters(basicFilters) ? 'white' : theme.colors.secondary} />
                <Text style={[
                  styles.filterText,
                  hasActiveFilters(basicFilters) && styles.activeFilterText
                ]}>
                  Filters
                  {hasActiveFilters(basicFilters) && ` (${Object.values(basicFilters).filter(v => v !== null && v !== '').length})`}
                </Text>
              </TouchableOpacity>
              
              {filters.filter((f) => f.id !== 'open-filters').map((filter) => (
                <TouchableOpacity
                  key={filter.id}
                  style={[
                    styles.filterChip,
                    selectedFilter === filter.id && [styles.activeFilterChip, { backgroundColor: theme.colors.primary }]
                  ]}
                  onPress={() => setSelectedFilter(filter.id)}
                >
                  <Text
                    style={[
                      styles.filterText,
                      selectedFilter === filter.id && styles.activeFilterText
                    ]}
                  >
                    {filter.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={[styles.emptyState, { paddingTop: 40 }]}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={[styles.emptySubtitle, { marginTop: 8 }]}>Loading rides...</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconContainer}>
                <MapPin size={64} color="#CBD5E1" />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.colors.secondary }]}>
                {hasAnyRides ? 'No rides match your search' : 'No rides available'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {hasAnyRides ? 'Try adjusting your search or filters' : 'Try again later'}
              </Text>
            </View>
          )
        }
    contentContainerStyle={styles.content}
    renderItem={({ item, index }: any) => (
      <Card key={item.id} style={[styles.rideCard, index === (displayData.length - 1) ? styles.rideCardLast : null]}>
              {/* Driver Info */}
              <View style={styles.driverInfo}>
                <View style={styles.driverLeft}>
                  {item.driver?.avatarUrl ? (
                    <Image source={{ uri: item.driver.avatarUrl }} style={styles.driverAvatarImg} />
                  ) : (
                    <View style={[styles.driverAvatar, { backgroundColor: theme.colors.primary }]}>
                      <Text style={styles.driverInitial}>
                        {item.driver.name?.charAt?.(0) || 'D'}
                      </Text>
                    </View>
                  )}
                  <View>
                    <Text style={[styles.driverName, { color: theme.colors.secondary }]}>
                      {item.driver.name}
                    </Text>
                    <View style={styles.ratingContainer}>
                      <Star size={14} color="#F59E0B" fill="#F59E0B" />
                      <Text style={styles.rating}>{item.driver.rating}</Text>
                      <Text style={styles.vehicle}>{item.vehicle}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.rideDateTime}>
                  <Text style={styles.rideDate}>{item.date}</Text>
                  <Text style={[styles.rideTime, { color: theme.colors.primary }]}>
                    {item.pickupTime}
                  </Text>
                </View>
              </View>

              {/* Route */}
              <View style={styles.routeContainer}>
                <View style={styles.routeItem}>
                  <View style={styles.locationDot}>
                    <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
                  </View>
                  <AddressLink address={item.pickup} textStyle={[styles.locationText, { color: theme.colors.secondary }]} />
                </View>
                <View style={styles.routeItem}>
                  <View style={styles.locationDot}>
                    <View style={[styles.dot, { backgroundColor: '#6B7280' }]} />
                  </View>
                  <AddressLink address={item.dropoff} textStyle={styles.destinationText} />
                </View>
              </View>

              {/* Preferences */}
              <View style={styles.preferencesContainer}>
                {item.preferences.slice(0, 3).map((pref: string, index: number) => (
                  <View key={index} style={styles.preferenceBadge}>
                    <Text style={styles.preferenceText}>{pref}</Text>
                  </View>
                ))}
              </View>

              {/* Ride Details */}
              <View style={styles.rideFooter}>
                <View style={styles.rideDetails}>
                  <View style={styles.detailItem}>
                    <Clock size={16} color="#64748B" />
                    <Text style={styles.detailText}>{item.duration}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Users size={16} color="#64748B" />
                    <Text style={styles.detailText}>{item.availableSeats} seats</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <TouchableOpacity
                    onPress={() => Share.share({ message: `Check out this ride on RideAlong!\nhttps://ridealongapp.com/ride/${item.id}`, url: `https://ridealongapp.com/ride/${item.id}` }).catch(() => {})}
                    style={{ padding: 2 }}
                    accessibilityRole="button"
                    accessibilityLabel="Share this ride"
                  >
                    <Share2 size={16} color="#E05E1A" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => openRideDetails(item)}
                    accessibilityRole="button"
                    accessibilityLabel="View ride details"
                  >
                    <Text style={styles.viewDetailsText}>View Details →</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {/* CTA */}
              {isPostedByCurrentUser(item) ? (
                <View style={styles.postedByYouContainer}>
                  <Text style={styles.postedByYouText}>Posted by You</Text>
                  <Button
                    variant="outline"
                    size="sm"
                    fullWidth
                    style={styles.cancelButton}
                    onPress={() => handleCancelRide(item.id)}
                    disabled={cancelingRideId === item.id}
                  >
                    {cancelingRideId === item.id ? 'Canceling...' : 'Cancel Posting'}
                  </Button>
                </View>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  style={styles.requestCta}
                  onPress={() => handleOpenPayment(item)}
                >
                  {`Request • $${item.pricePerSeat.toFixed(2)}`}
                </Button>
              )}
      </Card>
    )}
        showsVerticalScrollIndicator={false}
  />
  
    {/* Basic Filters Modal */}
    <RideFiltersModal
      visible={filtersVisible}
      onClose={() => setFiltersVisible(false)}
      onApply={(filters) => setBasicFilters(filters)}
      initialFilters={basicFilters}
      showSeatsFilter={true}
    />
    
    {/* Payment Modal */}
    <PaymentModal
      visible={paymentModalVisible}
      onClose={() => { 
        setPaymentModalVisible(false); 
        setPaymentRide(null); 
      }}
      rideId={paymentRide?.id || ''}
      driverId={paymentRide?.driverId ?? null}
      baseFare={paymentRide?.baseFare || 0}
    />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 16,
  paddingTop: 20,
  paddingBottom: 24,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
  fontSize: 28,
  fontWeight: 'bold',
  color: '#1F2937',
  marginBottom: 8,
  },
  headerSubtitle: {
  fontSize: 16,
  color: '#6B7280',
  },
  searchContainer: {
    paddingHorizontal: 0,
    paddingBottom: 15,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
  },
  filtersContainer: {
  paddingHorizontal: 16,
  paddingBottom: 15,
  gap: 8,
  },
  filterChip: {
  height: 36,
  paddingHorizontal: 12,
  borderRadius: 18,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 8,
  },
  activeFilterChip: {
    borderColor: 'transparent',
  },
  filterText: {
  fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  activeFilterText: {
    color: 'white',
  },
  content: {
  paddingHorizontal: 16,
  paddingBottom: 0,
  },
  rideCard: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 16,
  },
  rideCardLast: {
    marginBottom: 0,
  },
  driverInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  driverLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  driverAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  driverAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#E5E7EB',
  },
  driverInitial: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rating: {
    fontSize: 14,
    color: '#F59E0B',
    fontWeight: '500',
  },
  vehicle: {
    fontSize: 14,
    color: '#64748B',
    marginLeft: 4,
  },
  rideDateTime: {
    alignItems: 'flex-end',
  },
  rideDate: {
    fontSize: 14,
    color: '#64748B',
  },
  rideTime: {
    fontSize: 16,
    fontWeight: '600',
  },
  routeContainer: {
    marginBottom: 12,
  },
  routeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationDot: {
    width: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  locationText: {
    fontSize: 16,
    fontWeight: '500',
  },
  destinationText: {
    fontSize: 16,
    color: '#64748B',
  },
  preferencesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  preferenceBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  preferenceText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  rideFooter: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingTop: 12,
  borderTopWidth: 1,
  borderTopColor: '#E2E8F0',
  },
  rideDetails: {
    flexDirection: 'row',
    gap: 16,
  },
  viewDetailsText: {
  fontSize: 12,
  color: '#E05E1A',
  fontWeight: '500',
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 14,
    color: '#64748B',
  },
  priceText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  requestCta: {
    marginTop: 12,
  },
  postedByYouContainer: {
    marginTop: 12,
    gap: 8,
  },
  postedByYouText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
    textAlign: 'center',
  },
  cancelButton: {
    borderColor: '#EF4444',
  },
  // Modal styles (aligned with Home screen)
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
  closeButton: { padding: 4 },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  modalSection: { marginBottom: 24 },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionTitleModal: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 12,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  prefChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  prefChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  prefChipText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '500',
  },
  prefChipTextActive: {
    color: '#FFFFFF',
  },
  input: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },
  routeModalContainer: { paddingLeft: 8 },
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
    marginBottom: 12,
  },
  infoItem: {
    flex: 1,
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    marginHorizontal: 4,
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
  },
  driverInfoModal: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
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
  notesText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  driverVehicleModal: {
    fontSize: 14,
    color: '#64748B',
  },
  emptyState: {
    alignItems: 'center',
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
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 24,
  },

  // Placeholders
  placeholderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  placeholderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  placeholderLine: {
    height: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 6,
  },
  placeholderPill: {
    height: 22,
    width: 60,
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
  },
  placeholderButton: {
    height: 32,
    width: 96,
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
  },
});

// Helpers for date/time display similar to Home screen
function formatDateLabel(dateVal: any): string | undefined {
  if (!dateVal) return undefined;
  try {
    // Handle date string in YYYY-MM-DD format (avoid timezone issues)
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      const [year, month, day] = dateVal.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      if (isNaN(d.getTime())) return dateVal;
      
      const today = new Date();
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diff = Math.round((dd.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      return d.toLocaleDateString();
    }
    
    // Fallback to Date constructor for other formats
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return typeof dateVal === 'string' ? dateVal : undefined;
    const today = new Date();
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((dd.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return d.toLocaleDateString();
  } catch {
    return typeof dateVal === 'string' ? dateVal : undefined;
  }
}

function formatTimeString(timeVal: any): string | undefined {
  if (!timeVal) return undefined;
  if (typeof timeVal === 'string') return timeVal;
  try {
    const d = new Date(timeVal);
    if (isNaN(d.getTime())) return undefined;
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return undefined;
  }
}

function normalizeProfile(d: any) {
  if (!d) return {};
  const name = d.fullName || d.fullname || (d.firstName && d.lastName ? `${d.firstName} ${d.lastName}`
    : d.firstName || d.firstname || d.name || d.full_name || d.displayName || d.username || d.handle || undefined);
  const avatarUrl = sanitizeAvatar(d.profilePicture || d.avatarUrl || d.avatarURL || d.photoURL || d.photoUrl || d.profileImageUrl || d.imageUrl || d.picture || d.avatar || undefined);
  const rating = typeof d.rating === 'number' ? d.rating : (typeof d.avgRating === 'number' ? d.avgRating : undefined);
  return { name, avatarUrl, rating, email: d.email };
}

// Ignore non-URL avatar strings coming from the web (e.g., '../assets/images/user.png')
function sanitizeAvatar(v: any): string | undefined | null {
  if (!v) return undefined;
  const s = String(v).trim();
  // Allow http(s) and data URIs; otherwise ignore (RN Image can't load relative paths or gs://)
  if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
  return undefined;
}
