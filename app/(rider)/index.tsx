import { FlagRideModal } from '@/components/FlagRideModal';
import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Image, Share, Linking, Dimensions, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, MapPin, Clock, User, Star, DollarSign, Bell, Leaf, Gift, MessageSquare, Shield, Calendar, Megaphone, Flag, Phone, TrendingUp, MessageCircle, Share2 } from 'lucide-react-native';
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
  collection,
  onSnapshot,
  query,
  where,
  getCountFromServer,
  getDocs,
  doc,
  getDoc,
  Timestamp,
  limit as fsLimit,
  updateDoc,
  setDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import RatingModal from '@/components/RatingModal';
import StudentVerificationBanner from '@/components/StudentVerificationBanner';
import { fetchVerificationStatus, setupVerificationListener, cleanupVerificationListener } from '@/services/verification';
import { showSuccessToast, showErrorToast, showInfoToast, rideToasts } from '@/src/utils/showToast';

type UpcomingRideCard = {
  id: string;
  type: 'ride' | 'rideRequest' | 'confirmedRide';
  status: string;
  from: string;
  to: string;
  dateTime: Date | null; // pickup or requested time
  etaText?: string;
  durationText?: string;
  priceText?: string;
  distanceText?: string;
  // Driver fields when available (for confirmed rides)
  driverName?: string;
  driverRating?: number | null;
  vehicleText?: string;
  driverPhone?: string | null;
  // Linkage
  rideRequestId?: string | null;
  ridePostingId?: string | null;
  riderId?: string | null;
};

type OfferInfo = {
  id: string;
  rideRequestId: string;
  status: string;
  priceText?: string;
  priceNumber?: number;
  distanceText?: string;
  durationText?: string;
  driverName?: string;
  driverId?: string;
  driverEmail?: string;
  driverPhone?: string;
  ridePostingId?: string | null;
  createdAt?: Date | null;
};

// Helper functions for address and data extraction
const extractAddress = (obj: any, type: 'pickup' | 'dropoff' | 'destination'): string | null => {
  if (!obj) return null;
  
  if (type === 'pickup') {
    const addr = obj.pickup || obj.pickupLocation || obj.pickupAddress || obj.from || obj.origin;
    // Handle nested address objects
    if (typeof addr === 'object' && addr !== null) {
      return addr.address || addr.formatted_address || addr.description || addr.name || null;
    }
    return typeof addr === 'string' ? addr : null;
  } else if (type === 'dropoff') {
    const addr = obj.dropoff || obj.dropoffLocation || obj.dropoffAddress || obj.to || obj.destination;
    // Handle nested address objects
    if (typeof addr === 'object' && addr !== null) {
      return addr.address || addr.formatted_address || addr.description || addr.name || null;
    }
    return typeof addr === 'string' ? addr : null;
  } else if (type === 'destination') {
    const addr = obj.destination || obj.dropoff || obj.dropoffLocation || obj.to;
    // Handle nested address objects
    if (typeof addr === 'object' && addr !== null) {
      return addr.address || addr.formatted_address || addr.description || addr.name || null;
    }
    return typeof addr === 'string' ? addr : null;
  }
  return null;
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
  
  // PRIORITY 1: Try date/time string fields first (scheduled ride time)
  if (obj.date || obj.time) {
    const dt = composeDateTime(obj.date, obj.time);
    if (dt) return dt;
  }
  
  // PRIORITY 2: Try timestamp fields (scheduled/pickup time)
  if (obj.pickupTime?.toDate) return obj.pickupTime.toDate();
  if (obj.requestedTime?.toDate) return obj.requestedTime.toDate();
  if (obj.scheduledTime?.toDate) return obj.scheduledTime.toDate();
  
  // LAST RESORT: Fall back to creation time (avoid this if possible)
  if (obj.createdAt?.toDate) return obj.createdAt.toDate();
  
  return null;
};

const composeDateTime = (dateField: any, timeField: any): Date | null => {
  try {
    let dateStr = '';
    let timeStr = '';
    
    if (dateField) {
      if (dateField.toDate) {
        dateStr = dateField.toDate().toISOString().split('T')[0];
      } else if (typeof dateField === 'string') {
        dateStr = dateField;
      }
    }
    
    if (timeField) {
      if (typeof timeField === 'string') {
        timeStr = timeField;
      }
    }
    
    if (dateStr && timeStr) {
      // Parse 12-hour time format like "3:00 PM"
      const timeMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const meridiem = timeMatch[3].toUpperCase();
        
        // Convert to 24-hour format
        if (meridiem === 'PM' && hours < 12) {
          hours += 12;
        } else if (meridiem === 'AM' && hours === 12) {
          hours = 0;
        }
        
        // Parse date string as YYYY-MM-DD and create date in local timezone
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
        return date;
      }
      // Fallback: try direct parsing
      return new Date(`${dateStr}T${timeStr}`);
    } else if (dateStr) {
      const [year, month, day] = dateStr.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
  } catch {}
  return null;
};

export default function HomeScreen() {
  const theme = useTheme();
  const [selectedRide, setSelectedRide] = useState<UpcomingRideCard | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDriver, setModalDriver] = useState<{
    name?: string;
    rating?: number | null;
    phone?: string | null;
    phoneFromProfile?: boolean;
    avatarUrl?: string | null;
    vehicleText?: string;
    driverId?: string;
  } | null>(null);
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
  // Aggregate sources for stats (dedup across history and completed confirmed rides)
  const statsSourcesRef = useRef<{ hist: Map<string, { spent: number; rating?: number | null }>; conf: Map<string, { spent: number }>}>({ hist: new Map(), conf: new Map() });
  const validRideIdsRef = useRef<Set<string>>(new Set());
  const ratingsByRideIdRef = useRef<Map<string, { stars: number; createdAt?: number }>>(new Map());
  const notifReadMapRef = useRef<Record<string, boolean>>({});
  // Maintain index of confirmed ride docs by logical key for actions
  const confirmedIndexRef = useRef<Record<string, { docId: string; status: 'confirmed'|'in_progress'|'completed'|'flagged'; flags?: any }>>({});
  // Track the set of logical keys present in the latest confirmedRides snapshot so we can remove stale confirmed cards
  const confirmedKeysRef = useRef<Set<string>>(new Set());
  const [recent, setRecent] = useState<UpcomingRideCard[]>([]);
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flaggingRideId, setFlaggingRideId] = useState<string | null>(null);
  // Ratings state
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<{ rideId: string; driverName?: string } | null>(null);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratedRideIds, setRatedRideIds] = useState<Set<string>>(new Set());
  const completedSeenRef = useRef<Set<string>>(new Set());
  const confirmedFallbackSetupRef = useRef<boolean>(false);
  const promotionsScrollRef = useRef<ScrollView>(null);

  // Promotions state
  const { 
    promotions, 
    claimedPromotions, 
    loading: promotionsLoading, 
    error: promotionsError, 
    refreshPromotions, 
    claimPromotion, 
    isPromotionClaimed 
  } = usePromotions();
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [promotionModalVisible, setPromotionModalVisible] = useState(false);

  // Highlights state (none)

  // Share referral link
  const shareReferral = useCallback(async () => {
    const uid = firebaseAuth.currentUser?.uid;
    const email = firebaseAuth.currentUser?.email;
    const code = uid || (email ? encodeURIComponent(email) : 'guest');
    const link = `https://ridealong.app/referral?r=${code}`;
    try {
      await Share.share({ message: `Join me on RideAlong and earn ride credits: ${link}` });
    } catch (e) {
      Alert.alert('Unable to share right now');
    }
  }, []);

  // Promotion handlers
  const handlePromotionPress = useCallback((promotion: Promotion) => {
    setSelectedPromotion(promotion);
    setPromotionModalVisible(true);
  }, []);

  const handleClaimPromotion = useCallback(async (promotionId: string) => {
    try {
      await claimPromotion(promotionId);
      showSuccessToast('Promotion Claimed', 'Offer added to your account');
      setPromotionModalVisible(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to claim promotion';
      showErrorToast('Claim Failed', message);
    }
  }, [claimPromotion]);

  const uid = firebaseAuth.currentUser?.uid ?? null;
  const email = firebaseAuth.currentUser?.email ?? null;
  const submitRating = useMemo(() => httpsCallable(functions, 'submitRating'), []);

  // Helper functions for confirmed rides mapping
  const logicalRideKey = (r: any, docId: string) => {
    const rrid = r?.rideRequestId ?? r?.originalRideRequest?.id;
    return rrid ? `rr_${rrid}` : `cr_${docId}`;
  };

  const uLogicalKey = (it: UpcomingRideCard) => {
    if (it.type === 'confirmedRide') {
      const rrid = it.rideRequestId ?? (typeof it.id === 'string' ? it.id : undefined);
      return rrid ? `rr_${rrid}` : `cr_${it.id}`;
    }
    if (it.type === 'rideRequest') return `rr_${it.id}`;
    return `${it.type}_${it.id}`;
  };

  // Pretty status display function
  const prettyStatus = (status: string, type?: string) => {
    const s = String(status || '').toLowerCase();
    // Map driver_completed to "In Progress" for rider view (waiting for rider approval)
    if (s === 'driver_completed' || s === 'driver-completed') return 'In Progress';
    if (s === 'in_progress' || s === 'in-progress') return 'In Progress';
    if (s === 'confirmed' || s === 'matched') return 'Confirmed';
    if (s === 'pending') return 'Pending';
    if (s === 'completed') return 'Completed';
    if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
    if (s === 'flagged') return 'Flagged';
    if (s === 'posted' || s === 'open') return 'Posted';
    if (s === 'accepted') return 'Accepted';
    if (s === 'rejected' || s === 'declined') return 'Rejected';
    // Capitalize first letter for unknown statuses
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const extractFlags = (r: any) => {
    return {
      driverPickupConfirmed: !!r?.driverPickupConfirmed,
      riderPickupConfirmed: !!r?.riderPickupConfirmed,
      driverCompleteConfirmed: !!r?.driverCompleteConfirmed,
      riderCompleteConfirmed: !!r?.riderCompleteConfirmed,
    };
  };

  const mapConfirmedSnapshot = (docs: any[]): UpcomingRideCard[] => {
    const items: UpcomingRideCard[] = [];
    docs.forEach((d) => {
      try {
        const r = d as any;
        const docId = r.id as string;
        const status = r?.status || 'CONFIRMED';
        const statusLower = String(status).toLowerCase();
        
        // Skip completed rides - they should not appear in upcoming
        if (statusLower === 'completed') {
          return;
        }
        
        // Skip flagged rides that were COMPLETED when flagged (show only in history)
        if (statusLower === 'flagged' && String(r?.statusAtFlag || '').toUpperCase() === 'COMPLETED') {
          console.log(`[mapConfirmedSnapshot] Hiding flagged ride ${docId} from upcoming (was COMPLETED)`);
          return;
        }
        
        const from = extractAddress(r, 'pickup') || 'Pickup';
        const to = extractAddress(r, 'dropoff') || 'Dropoff';
        const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
        const price = r?.contributionAmount;
        const priceText = typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined);
        const driverName = r?.driverName;
        const driverRating = typeof r?.driverRating === 'number' ? r.driverRating : null;
        const vehicleText = r?.vehicleText || r?.vehicle;
        const driverPhone = r?.driverPhone;
        
        items.push({
          id: docId,
          type: 'confirmedRide',
          status,
          from,
          to,
          dateTime: dt,
          priceText,
          driverName,
          driverRating,
          vehicleText,
          driverPhone,
          rideRequestId: r?.rideRequestId ?? r?.originalRideRequest?.id ?? null,
          ridePostingId: r?.ridePostingId ?? null,
          riderId: r?.riderId ?? null,
        });

        // Update index
        const key = logicalRideKey(r, docId);
        // Map driver_completed to in_progress (rider needs to approve)
        // Map rider_completed and completed to 'completed' for history
        const statusForIndex = ['in-progress', 'in_progress', 'driver_completed'].includes(statusLower) ? 'in_progress' : 
                               ['rider_completed'].includes(statusLower) ? 'completed' :
                               ['flagged'].includes(statusLower) ? 'flagged' :
                               ['completed'].includes(statusLower) ? 'completed' : 'confirmed';
        confirmedIndexRef.current[key] = { docId, status: statusForIndex as any, flags: extractFlags(r) };
        confirmedKeysRef.current.add(key);
      } catch (err) {
        console.warn('mapConfirmedSnapshot: error mapping doc', err);
      }
    });
    return items;
  };

  const mergeConfirmedIntoUpcoming = (mapped: UpcomingRideCard[]) => {
    setUpcoming((prev) => {
      // Remove stale confirmed cards not present in latest snapshot
      const pruned = prev.filter((it) => {
        if (it.type !== 'confirmedRide') return true;
        const key = uLogicalKey(it);
        return confirmedKeysRef.current.has(key);
      });
      return mergeUpcoming(pruned, mapped);
    });
  };

  // Deprecated totals aggregator; totals now come from confirmedRides(all). Avg rating computed via rideRatings ∩ completed rides.
  const recomputeStats = (_ratingsSumFromHist?: number, _ratingsCountFromHist?: number) => {
    // Intentionally no-op to avoid overwriting totals from confirmedRides(all)
    return;
  };

  useEffect(() => {
    if (!uid) {
      setUpcoming([]);
      setLoading(false);
      return;
    }

  setLoading(true);
  // Reset notifications accumulator
  notifReadMapRef.current = {};
  setUnreadCount(0);
  const unsubs: Array<() => void> = [];

  // Fetch profile for name
    (async () => {
      try {
        const userDoc = await getDoc(doc(firestore, 'users', uid));
        const data = userDoc.exists() ? (userDoc.data() as any) : null;
        // Try multiple keys for first name, then auth displayName, then email prefix
        let firstName: string | undefined = getFirstNameFromProfile(data);
        let profilePhoto: string | undefined;
        
        // Get profile photo from Firestore user document (matching profile page logic)
        if (data) {
          profilePhoto = data.avatarUrl || data.photoURL || data.photoUrl;
          console.log('Firestore user data:', { 
            avatarUrl: data.avatarUrl, 
            photoURL: data.photoURL, 
            photoUrl: data.photoUrl,
            resolvedPhoto: profilePhoto
          });
        }
        
        if (!firstName && email) {
          // Fallback: query by email if doc id != uid
          const q = query(collection(firestore, 'users'), where('email', '==', email), fsLimit(1));
          const snap = await getDocs(q);
          const docData = snap.docs[0]?.data();
          firstName = getFirstNameFromProfile(docData);
          
          // Also try to get profile photo from email query result (matching profile page logic)
          if (!profilePhoto && docData) {
            profilePhoto = docData.avatarUrl || docData.photoURL || docData.photoUrl;
          }
        }
        if (!firstName) {
          const dn = firebaseAuth.currentUser?.displayName || undefined;
          firstName = dn ? dn.split(' ')[0] : undefined;
        }
        
        // Also check Firebase Auth profile photo if not found in Firestore
        if (!profilePhoto) {
          const authPhotoURL = firebaseAuth.currentUser?.photoURL;
          console.log('Checking Firebase Auth photoURL:', authPhotoURL);
          if (authPhotoURL) {
            profilePhoto = authPhotoURL;
          }
        }
        
        console.log('Final profilePhoto value:', profilePhoto);
        
        // Set the profile photo state
        if (profilePhoto && typeof profilePhoto === 'string') {
          console.log('Setting userPhoto state to:', profilePhoto);
          setUserPhoto(profilePhoto);
        } else {
          console.log('No profile photo found, userPhoto will remain null');
        }
        
        setUserName(firstName ?? (email ? email.split('@')[0] : null));
      } catch {
        setUserName(email ? email.split('@')[0] : null);
      }
    })();

    // Initialize student verification status
    fetchVerificationStatus().catch((err) => {
      console.warn('Failed to fetch verification status:', err);
    });
    
    // Setup real-time listener for verification changes
    setupVerificationListener();

  // No longer using users doc rating for Avg Rating card; we compute from rideRatings only

    // Ride requests by userId (matching web app behavior)
    console.log('🔧 Setting up rideRequests query for userId:', uid);
    const reqUserIdQ = query(
      collection(firestore, 'rideRequests'),
      where('userId', '==', uid),
      where('status', 'in', ['pending', 'posted', 'open', 'offered'])
    );
    const unsubReqUserId = onSnapshot(reqUserIdQ, (snap) => {
      console.log(`🔍 rideRequests query returned ${snap.size} documents for status in ['pending', 'posted', 'open', 'offered']`);
      const items: UpcomingRideCard[] = [];
      snap.forEach((d) => {
  const r = d.data() as any;
        const rideDate = r?.date || r?.requestedDate || r?.scheduledDate || 'no date';
        const rideTime = r?.time || r?.requestedTime || r?.scheduledTime || 'no time';
        console.log(`📋 rideRequest doc ID: ${d.id}`);
        console.log(`   - status: ${r?.status}`);
        console.log(`   - date: ${rideDate}, time: ${rideTime}`);
        console.log(`   - pickup: ${r?.pickup || r?.pickupLocation}`);
        console.log(`   - dropoff: ${r?.dropoff || r?.dropoffLocation}`);
        const requestedTime: Date | null = getRideDateTime(r);
        
        // Skip rides more than 24 hours in the past (matching web app behavior)
        if (requestedTime) {
          const now = new Date();
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          if (requestedTime < oneDayAgo) {
            console.log(`⏭️ Skipping rideRequest ${d.id} - ride is more than 24 hours old: ${requestedTime.toLocaleString()}`);
            return;
          }
        }
        
        const from = extractAddress(r, 'pickup') || 'Pickup';
        const to = extractAddress(r, 'dropoff') || 'Dropoff';
    // Prioritize contributionAmount (user-entered) over estimatedFare (auto-calculated)
    const price = r?.contributionAmount ?? r?.estimatedFare?.total ?? r?.estimatedFare;
  const statusKey = String(r?.status || '').toLowerCase();
  if (['confirmed','in-progress','in_progress','completed','accepted','matched','rejected','declined','canceled','cancelled','expired'].includes(statusKey)) {
    console.log(`⏭️ Skipping rideRequest ${d.id} due to status: ${statusKey}`);
    return;
  }
        items.push({
          id: d.id,
          type: 'rideRequest',
          status: normalizeStatusForDisplay(r?.status),
          from,
          to,
          dateTime: requestedTime,
          durationText: typeof r?.duration === 'number' ? `${Math.round(r.duration)} min` : (typeof r?.duration === 'string' ? sanitizeDurationText(r.duration) : undefined),
          priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
          distanceText: extractDistance(r),
        });
        console.log(`✅ Added rideRequest card: ${d.id}, from: ${from}, to: ${to}, status: ${normalizeStatusForDisplay(r?.status)}`);
      });
      console.log(`📊 Total rideRequest items to merge: ${items.length}`);
      setUpcoming((prev) => mergeUpcoming(prev, items));
    }, (err) => {
      console.warn('rideRequests(userId) listener error', err);
      setLoading(false);
    });
    unsubs.push(unsubReqUserId);

    // Ride posting requests by riderId (when rider requests a ride posting)
    console.log('🔧 Setting up ridePostingRequests query for riderId:', uid);
    const rprQ = query(
      collection(firestore, 'ridePostingRequests'),
      where('riderId', '==', uid),
      where('status', 'in', ['pending', 'sent'])
    );
    const unsubRpr = onSnapshot(rprQ, async (snap) => {
      console.log(`🔍 ridePostingRequests query returned ${snap.size} documents for status in ['pending', 'sent']`);
      const items: UpcomingRideCard[] = [];
      
      // Process each request and fetch the original ride posting for pricePerSeat
      for (const d of snap.docs) {
        const r = d.data() as any;
        console.log(`📋 ridePostingRequest doc ID: ${d.id}`);
        console.log(`   - status: ${r?.status}`);
        console.log(`   - ridePostingId: ${r?.ridePostingId}`);
        console.log(`   - rideId: ${r?.rideId}`);
        console.log(`   - pickup: ${r?.pickup || r?.pickupLocation}`);
        console.log(`   - dropoff: ${r?.dropoff || r?.dropoffLocation || r?.destination}`);
        
        const requestedTime: Date | null = getRideDateTime(r);
        
        // Skip rides more than 24 hours in the past
        if (requestedTime) {
          const now = new Date();
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          if (requestedTime < oneDayAgo) {
            console.log(`⏭️ Skipping ridePostingRequest ${d.id} - ride is more than 24 hours old`);
            continue;
          }
        }
        
        // Fetch the original ride posting to get pricePerSeat and addresses
        // The backend stores the posting ID as 'rideId' field
        const postingId = r?.ridePostingId || r?.rideId;
        let pricePerSeat = null;
        let pickupFromPosting = null;
        let dropoffFromPosting = null;
        let durationFromPosting = null;
        let distanceFromPosting = null;
        if (postingId) {
          try {
            const postingDoc = await getDoc(doc(firestore, 'ridePostings', postingId));
            if (postingDoc.exists()) {
              const postingData = postingDoc.data();
              pricePerSeat = postingData?.pricePerSeat ?? postingData?.price;
              // Extract addresses using same logic as available-rides page
              pickupFromPosting = postingData?.pickupAddress || postingData?.pickup || postingData?.pickupLocation?.address || postingData?.origin || postingData?.from || null;
              dropoffFromPosting = postingData?.dropoffAddress || postingData?.dropoff || postingData?.dropoffLocation?.address || postingData?.destination || postingData?.to || null;
              durationFromPosting = postingData?.duration;
              distanceFromPosting = postingData?.distance;
              console.log(`   💰 Fetched from posting: price=$${pricePerSeat}, pickup=${pickupFromPosting}, dropoff=${dropoffFromPosting}`);
              console.log(`   📦 Full posting data:`, JSON.stringify(postingData, null, 2));
            } else {
              console.log(`   ❌ Ride posting ${postingId} does not exist`);
            }
          } catch (e) {
            console.warn(`   ⚠️ Could not fetch ride posting ${postingId}:`, e);
          }
        } else {
          console.warn(`   ⚠️ No ridePostingId or rideId found in ridePostingRequest`);
        }
        
        // Prioritize addresses from the original posting, fallback to request data
        const from = pickupFromPosting || extractAddress(r, 'pickup') || 'Pickup';
        const to = dropoffFromPosting || extractAddress(r, 'dropoff') || extractAddress(r, 'destination') || 'Dropoff';
        // Use pricePerSeat from posting, fallback to contributionAmount if available
        const price = pricePerSeat ?? r?.contributionAmount;
        
        const statusKey = String(r?.status || r?.state || '').toLowerCase();
        if (['confirmed','in-progress','in_progress','completed','accepted','matched','rejected','declined','canceled','cancelled','expired'].includes(statusKey)) {
          console.log(`⏭️ Skipping ridePostingRequest ${d.id} due to status: ${statusKey}`);
          continue;
        }
        
        items.push({
          id: d.id,
          type: 'rideRequest', // Use same type so it displays with correct styling
          status: 'Offer Sent', // Display as "Offer Sent" for pending requests
          from,
          to,
          dateTime: requestedTime,
          durationText: (typeof r?.duration === 'number' ? `${Math.round(r.duration)} min` : (typeof r?.duration === 'string' ? sanitizeDurationText(r.duration) : (typeof durationFromPosting === 'number' ? `${Math.round(durationFromPosting)} min` : (typeof durationFromPosting === 'string' ? sanitizeDurationText(durationFromPosting) : undefined)))),
          priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
          distanceText: extractDistance(r) || (typeof distanceFromPosting === 'number' ? `${distanceFromPosting.toFixed(1)} mi` : (typeof distanceFromPosting === 'string' ? distanceFromPosting : undefined)),
          ridePostingId: postingId || null,
        });
        console.log(`✅ Added ridePostingRequest card: ${d.id}, from: ${from}, to: ${to}, status: Offer Sent`);
      }
      console.log(`📊 Total ridePostingRequest items to merge: ${items.length}`);
      setUpcoming((prev) => mergeUpcoming(prev, items));
    }, (err) => {
      console.warn('ridePostingRequests(riderId) listener error', err);
      setLoading(false);
    });
    unsubs.push(unsubRpr);

    // Notifications listeners to compute unread count
    try {
      const base = collection(firestore, 'notifications');
      const qUserId = query(base, where('userId', '==', uid));
      const qRecipientId = query(base, where('recipientId', '==', uid));
      const qEmailUser = email ? query(base, where('userEmail', '==', email)) : null;
      const qRecipients = query(base, where('recipients', 'array-contains', uid));

      const mergeAndSet = (snapshot: any) => {
        const partial: Record<string, boolean> = {};
        snapshot.docs.forEach((d: any) => {
          const data = d.data() || {};
          const readBy: string[] = Array.isArray(data.readBy) ? data.readBy : [];
          const readFromFlags = data.read === true || data.unread === false;
          const read: boolean = readFromFlags || readBy.includes(uid!);
          partial[d.id] = read;
        });
        notifReadMapRef.current = { ...notifReadMapRef.current, ...partial };
        const unread = Object.values(notifReadMapRef.current).filter((r) => !r).length;
        setUnreadCount(unread);
      };

      const uN1 = onSnapshot(qUserId, mergeAndSet, (e) => console.warn('notifications userId listener error', e));
      unsubs.push(uN1);
      const uN2 = onSnapshot(qRecipientId, mergeAndSet, (e) => console.warn('notifications recipientId listener error', e));
      unsubs.push(uN2);
      if (qEmailUser) {
        const uN3 = onSnapshot(qEmailUser, mergeAndSet, (e) => console.warn('notifications userEmail listener error', e));
        unsubs.push(uN3);
      }
      const uN4 = onSnapshot(qRecipients, mergeAndSet, (e) => console.warn('notifications recipients listener error', e));
      unsubs.push(uN4);
    } catch (e) {
      console.warn('notifications listeners setup failed', e);
    }

      // Listen for ride offers sent to this rider
      const offersBase = collection(firestore, 'rideOffers');
      const offersForRecipient = query(offersBase, where('recipientId', '==', uid));
      const offersForRider = query(offersBase, where('riderId', '==', uid));

      const mapOffer = (d: any): OfferInfo | null => {
        try {
          const data = d.data() || {};
          const rideRequestId = data.rideRequestId || data.requestId || data.rideRequest?.id;
          if (!rideRequestId) return null;
          const status = String(data.status || data.state || 'pending');
          const createdAt = toDateField(data.timestamp || data.createdAt || data.time);
          const priceRaw = data.offerPrice ?? data.price ?? data.estimatedFare;
          const priceText = typeof priceRaw === 'number' ? `$${priceRaw.toFixed(2)}` : (typeof priceRaw === 'string' ? priceRaw : undefined);
          const priceNumber = typeof priceRaw === 'number' ? priceRaw : (typeof priceRaw === 'string' ? parseCurrency(priceRaw) : undefined);
          // Distance/Duration: pull from common fields, else fallback to extractor
          let dist = data.distance?.text || data.distanceText; 
          let dur = data.duration?.text || data.durationText;
          if (!dist) {
            dist = extractDistance(data)
              || extractDistance(data.route)
              || extractDistance(data.trip)
              || extractDistance(data.details)
              || undefined;
          }
          if (!dur) {
            const durVal = (typeof data.duration === 'number' ? data.duration
              : (typeof data.durationMinutes === 'number' ? data.durationMinutes
              : (typeof data.durationMin === 'number' ? data.durationMin
              : (typeof data.durationInMinutes === 'number' ? data.durationInMinutes : undefined))));
            if (typeof durVal === 'number' && isFinite(durVal)) dur = `${Math.round(durVal)} min`;
          }
          const driverName = data.driverName || data.driver?.name || data.driver?.fullName;
          const driverId = data.driverId || data.driverUID || data.driverUid || data.driver?.id || data.driver?.uid || data.senderId || data.ownerId || data.postedBy || data.providerId || data.driverProfile?.id;
          const driverEmail = data.driverEmail || data.driver?.email;
          const driverPhone = data.driverPhone || data.driver?.phone || data.driver?.phoneNumber;
          const distanceText = typeof dist === 'string' ? dist : undefined;
          const durationText = typeof dur === 'string' ? dur : (typeof data.duration === 'number' ? `${Math.round(data.duration)} min` : undefined);
          const ridePostingId = data.ridePostingId || data.ridePostId || data.postingId || data.ridePosting?.id || null;
          return {
            id: d.id,
            rideRequestId,
            status,
            priceText,
            priceNumber,
            distanceText,
            durationText,
            driverName,
            driverId,
            driverEmail,
            driverPhone,
            ridePostingId,
            createdAt,
          };
        } catch {
          return null;
        }
      };

      const handleOfferSnap = (snap: any) => {
        const incoming: Record<string, OfferInfo> = {};
        snap.forEach((docu: any) => {
          const o = mapOffer(docu);
          if (!o) return;
          const existing = incoming[o.rideRequestId];
          if (!existing || (o.createdAt && existing.createdAt && o.createdAt > existing.createdAt)) {
            incoming[o.rideRequestId] = o;
          } else if (!existing) {
            incoming[o.rideRequestId] = o;
          }
        });
        // Merge with current map, prefer newest per ride id
        setOffersByRideId((prev) => ({ ...prev, ...incoming }));
      };

      const unsubOffer1 = onSnapshot(offersForRecipient, handleOfferSnap, (e) => console.warn('rideOffers(recipientId) error', e));
      const unsubOffer2 = onSnapshot(offersForRider, handleOfferSnap, (e) => console.warn('rideOffers(riderId) error', e));
      unsubs.push(unsubOffer1, unsubOffer2);

  // Stats from completed confirmedRides only (matching profile page and web app logic)
    try {
      const qConfDone = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid), where('status', '==', 'COMPLETED'));
      const unsubConfDone = onSnapshot(qConfDone, (snap) => {
        const confRideIds = new Set<string>();
        let totalCount = 0;
        let totalSpent = 0;
        snap.forEach((d) => {
          const r: any = d.data() || {};
          totalCount += 1;
          
          // Helper to parse amount from ride (matching web app logic)
          const parseAmount = (ride: any) => {
            const v = ride?.contributionAmount ?? ride?.estimatedFare?.total ?? ride?.estimatedFare ?? ride?.price;
            if (typeof v === 'string') {
              const m = v.match(/([\d.]+)/);
              return m ? parseFloat(m[1]) || 0 : 0;
            }
            return Number(v) || 0;
          };
          
          // Amount: prefer explicit contributionAmount, then estimates on request/posting (matching web app)
          let amt = parseAmount(r);
          if (!amt && r.originalRideRequest) amt = parseAmount(r.originalRideRequest);
          if (!amt && r.originalRidePosting) amt = parseAmount(r.originalRidePosting);
          
          totalSpent += amt;
          confRideIds.add(String(d.id));
        });
        validRideIdsRef.current = confRideIds;
        setStats((prev) => ({ ...prev, totalRides: totalCount, spent: totalSpent }));
        // Recompute avg rating from intersection
        recomputeAvgRatingFromIntersection();
        setLoading(false);
      }, (e) => {
        console.warn('confirmedRides(COMPLETED stats) listener error', e);
        setLoading(false);
      });
      unsubs.push(unsubConfDone);
    } catch {
      setLoading(false);
    }

    // rideRatings by this rider (rateeId == uid) for Avg Rating computation
    try {
      const qRatings = query(collection(firestore, 'rideRatings'), where('rateeId', '==', uid));
      const uRatings = onSnapshot(qRatings, (snap) => {
        const map = new Map<string, { stars: number; createdAt?: number }>();
        snap.forEach((d) => {
          const r: any = d.data() || {};
          const rideId = r?.rideId as string | undefined;
          const stars = typeof r?.stars === 'number' ? r.stars : (typeof r?.rating === 'number' ? r.rating : undefined);
          if (!rideId || typeof stars !== 'number') return;
          let createdAt: number | undefined;
          const ca = r?.createdAt;
          if (ca && typeof ca?.toDate === 'function') {
            try { createdAt = ca.toDate().getTime(); } catch {}
          } else if (typeof ca === 'string') {
            const td = new Date(ca).getTime();
            if (!isNaN(td)) createdAt = td;
          }
          const prev = map.get(rideId);
          if (!prev || (createdAt || 0) >= (prev.createdAt || 0)) {
            map.set(rideId, { stars, createdAt });
          }
        });
        ratingsByRideIdRef.current = map;
        recomputeAvgRatingFromIntersection();
      }, (e) => console.warn('rideRatings listener error', e));
      unsubs.push(uRatings);
    } catch {}

    // Listen for confirmed/active rides for this rider
    const setupConfirmedFallbackListeners = () => {
      if (confirmedFallbackSetupRef.current) return;
      confirmedFallbackSetupRef.current = true;
      try {
        const base = collection(firestore, 'confirmedRides');
  const statuses = ['CONFIRMED', 'IN_PROGRESS', 'DRIVER_COMPLETED', 'FLAGGED', 'in-progress', 'in_progress', 'driver_completed', 'flagged', 'confirmed'];
        const handler = (snap: any) => {
          const mapped = mapConfirmedSnapshot(snap.docs.map((d:any)=>({ id:d.id, ...(d.data()||{}) })));
          mergeConfirmedIntoUpcoming(mapped);
        };
        statuses.forEach((st) => {
          try {
            const qx = query(base, where('riderId', '==', uid), where('status', '==', st));
            const u = onSnapshot(qx, handler, (err)=>console.warn(`confirmedRides(${st}) listener error`, err));
            unsubs.push(u);
          } catch (err) {
            console.warn('confirmedRides fallback query error', err);
          }
        });
      } catch (errAll) {
        console.warn('confirmedRides fallback setup failed', errAll);
      }
    };

    try {
      const base = collection(firestore, 'confirmedRides');
      // Prefer a set of queries across common rider id field variants to be robust to differing doc shapes
      const riderFieldCandidates = ['riderId', 'riderUid', 'rider.id'];
      // Include DRIVER_COMPLETED so rider can approve completion
      // EXCLUDE RIDER_COMPLETED and COMPLETED from active - they should move to history
      const statusIn = ['CONFIRMED', 'confirmed', 'IN_PROGRESS', 'in_progress', 'in-progress', 'IN-PROGRESS', 'DRIVER_COMPLETED', 'driver_completed', 'FLAGGED', 'flagged'];
      const created = new Set<string>();
      for (const fld of riderFieldCandidates) {
        try {
          // Use 'in' filter for status to catch any of the common variants
          const qActive = query(base, where(fld as any, '==', uid), where('status', 'in', statusIn));
          const unsub = onSnapshot(qActive, (snap) => {
            try {
              // Debug: log how many docs arrived and their ids (helps trace missing confirmed rides)
              const ids = snap.docs.map((d:any) => d.id);
              // Only log once per snapshot batch to avoid spamming
              if (!created.has(ids.join(','))) {
                console.debug(`confirmedRides(${fld}) snapshot: ${ids.length} docs`, ids);
                created.add(ids.join(','));
              }
            } catch {}
            const mapped = mapConfirmedSnapshot(snap.docs.map((d:any)=>({ id:d.id, ...(d.data()||{}) })));
            mergeConfirmedIntoUpcoming(mapped);
          }, (e) => {
            console.warn(`confirmedRides(${fld}) listener error`, e);
          });
          unsubs.push(unsub);
        } catch (err) {
          console.warn('confirmedRides active query error for field', fld, err);
        }
      }

      // Also add a broader fallback query that watches any ride where riderId==uid regardless of status
      // This helps capture documents where status field is missing or non-standard
      try {
        const qAny = query(base, where('riderId', '==', uid));
        const unsubAny = onSnapshot(qAny, (snap) => {
          try {
            const ids = snap.docs.map((d:any) => d.id);
            if (!created.has(ids.join(','))) {
              console.debug(`confirmedRides(riderId:any) snapshot: ${ids.length} docs`, ids);
              created.add(ids.join(','));
            }
          } catch {}
          const mapped = mapConfirmedSnapshot(snap.docs.map((d:any)=>({ id:d.id, ...(d.data()||{}) })));
          mergeConfirmedIntoUpcoming(mapped);
        }, (e) => console.warn('confirmedRides(riderId any) listener error', e));
        unsubs.push(unsubAny);
      } catch {}
    } catch (e) {
      setupConfirmedFallbackListeners();
    }

    // Listen for completed rides to remove from Upcoming
    try {
      const qDone = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid), where('status', '==', 'COMPLETED'));
      const uDone = onSnapshot(qDone, (snap) => {
        const doneKeys = new Set<string>();
        const recents: UpcomingRideCard[] = [];
  // Track the most recent completion seen in this batch
  const newlyCompleted: Array<{ id: string; driverName?: string; completedAt?: any; raw: any }> = [];
        snap.docs.forEach((d:any) => {
          const r:any = d.data() || {};
          const key = logicalRideKey(r, d.id);
          doneKeys.add(key);
          // Update index for flags
          confirmedIndexRef.current[key] = { docId: d.id, status: 'completed', flags: extractFlags(r) };

          // Build a recent card
          const from = extractAddress(r, 'pickup') || 'Pickup';
          const to = extractAddress(r, 'dropoff') || 'Dropoff';
          const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
          const price = r?.contributionAmount;
          const priceText = typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined);
          recents.push({
            id: d.id,
            type: 'confirmedRide',
            status: 'COMPLETED',
            from,
            to,
            dateTime: dt,
            priceText,
            rideRequestId: r?.rideRequestId ?? r?.originalRideRequest?.id ?? null,
          });

          // Collect for potential prompt if first time seen
          if (!completedSeenRef.current.has(d.id)) {
            newlyCompleted.push({ id: d.id, driverName: r?.driverName, completedAt: r?.completedAt || r?.updatedAt || r?.createdAt, raw: r });
          }
        });
        setUpcoming((prev) => prev.filter((u) => {
          const key = uLogicalKey(u);
          return !doneKeys.has(key);
        }));
        // Keep the 3 most recent by date
        setRecent((prev) => {
          const merged = [...recents, ...prev];
          const sorted = merged.sort((a, b) => {
            const at = a.dateTime ? a.dateTime.getTime() : 0;
            const bt = b.dateTime ? b.dateTime.getTime() : 0;
            return bt - at;
          });
          // Dedupe by logical key
          const seen = new Set<string>();
          const unique: UpcomingRideCard[] = [];
          sorted.forEach((c) => {
            const k = uLogicalKey(c);
            if (!seen.has(k)) { seen.add(k); unique.push(c); }
          });
        return unique.slice(0, 3);
        });

        // Mark seen and prompt for the most recent newly completed (if any)
        if (newlyCompleted.length > 0) {
          newlyCompleted.forEach((n) => completedSeenRef.current.add(n.id));
          // Sort by completedAt desc, supporting Timestamp/Date/string
          const pickMostRecent = [...newlyCompleted].sort((a, b) => {
            const ad = toDateField(a.completedAt) || new Date(0);
            const bd = toDateField(b.completedAt) || new Date(0);
            return (bd.getTime() - ad.getTime());
          })[0];
          if (pickMostRecent) {
            // Try prompt just for this ride
            maybePromptRatingForRide(pickMostRecent.id, pickMostRecent.driverName);
          }
        }
      }, (e)=>console.warn('confirmedRides(COMPLETED) listener error', e));
      unsubs.push(uDone);
    } catch {}

    return () => {
      unsubs.forEach((u) => u());
      cleanupVerificationListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Refresh promotions
      await refreshPromotions();
      
      // Refresh verification status
      await fetchVerificationStatus();
      
      // Force re-fetch user profile
      if (uid) {
        try {
          const userDoc = await getDoc(doc(firestore, 'users', uid));
          const data = userDoc.exists() ? (userDoc.data() as any) : null;
          const firstName = getFirstNameFromProfile(data);
          const profilePhoto = data?.avatarUrl || data?.photoURL || data?.photoUrl || firebaseAuth.currentUser?.photoURL;
          
          if (profilePhoto && typeof profilePhoto === 'string') {
            setUserPhoto(profilePhoto);
          }
          setUserName(firstName ?? (email ? email.split('@')[0] : null));
        } catch {}
      }
    } catch (error) {
      console.error('Refresh error:', error);
    } finally {
      setRefreshing(false);
    }
  }, [uid, email, refreshPromotions]);

  // Auto-refresh when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      // Refresh data when screen is focused (after navigating back from profile, ride details, etc.)
      // Don't trigger if already loading or refreshing to avoid visual indicator
      if (!loading && !refreshing) {
        // Silently refresh without showing the spinner
        (async () => {
          try {
            await refreshPromotions();
            await fetchVerificationStatus();
            
            if (uid) {
              try {
                const userDoc = await getDoc(doc(firestore, 'users', uid));
                const data = userDoc.exists() ? (userDoc.data() as any) : null;
                const firstName = getFirstNameFromProfile(data);
                const profilePhoto = data?.avatarUrl || data?.photoURL || data?.photoUrl || firebaseAuth.currentUser?.photoURL;
                
                if (profilePhoto && typeof profilePhoto === 'string') {
                  setUserPhoto(profilePhoto);
                }
                setUserName(firstName ?? (email ? email.split('@')[0] : null));
              } catch {}
            }
          } catch (error) {
            console.error('Auto-refresh error:', error);
          }
        })();
      }
    }, [loading, refreshing, uid, email, refreshPromotions])
  );

  // Compute Avg Rating from ratings ∩ valid completed rides
  const recomputeAvgRatingFromIntersection = () => {
    try {
      const valid = validRideIdsRef.current;
      const ratings = ratingsByRideIdRef.current;
      if (!valid || !ratings) {
        setStats((prev) => ({ ...prev, avgRating: null }));
        return;
      }
      let sum = 0;
      let count = 0;
      ratings.forEach((val, rideId) => {
        if (valid.has(rideId) && typeof val?.stars === 'number' && isFinite(val.stars)) {
          sum += val.stars;
          count += 1;
        }
      });
      const avg = count ? (sum / count) : null;
      setStats((prev) => ({ ...prev, avgRating: avg }));
    } catch {}
  };

  // Compute de-duplicated totals (count and spent) from history + completed confirmed maps
  const recomputeTotalsFromStatsSources = () => {
    try {
      const hist = statsSourcesRef.current.hist || new Map<string, { spent: number }>();
      const conf = statsSourcesRef.current.conf || new Map<string, { spent: number }>();
      const seen = new Set<string>();
      let totalCount = 0;
      let totalSpent = 0;
      // Prefer history entries when key overlaps
      hist.forEach((v, k) => {
        if (!seen.has(k)) {
          seen.add(k);
          totalCount += 1;
          totalSpent += Number(v?.spent || 0);
        }
      });
      conf.forEach((v, k) => {
        if (!seen.has(k)) {
          seen.add(k);
          totalCount += 1;
          totalSpent += Number(v?.spent || 0);
        }
      });
      setStats((prev) => ({ ...prev, totalRides: totalCount, spent: totalSpent }));
    } catch {}
  };

  const sortedUpcoming = useMemo(() => sortByDate(upcoming), [upcoming]);

  function sortByDate(arr: UpcomingRideCard[]) {
    return [...arr].sort((a, b) => {
      const at = a.dateTime ? a.dateTime.getTime() : 0;
      const bt = b.dateTime ? b.dateTime.getTime() : 0;
      return at - bt;
    });
  }

  const openRideDetails = (ride: UpcomingRideCard) => {
    setSelectedRide(ride);
    setModalDistanceText(ride.distanceText);
    setModalVisible(true);
  };

  const acceptOffer = async (rideId: string) => {
    try {
      const offer = offersByRideId[rideId];
      if (!offer) return;
      // 1) Mark offer as accepted
      await updateDoc(doc(firestore, 'rideOffers', offer.id), { status: 'accepted' });

      // 2) Fetch ride request for details
      const rrRef = doc(firestore, 'rideRequests', rideId);
      const rrSnap = await getDoc(rrRef);
      const r = rrSnap.exists() ? (rrSnap.data() as any) : {};

      // 3) Compose confirmedRides payload to mirror the web schema
      const dt = getRideDateTime(r);
      const dateOnly = dt ? formatDateOnly(dt) : (typeof r?.date === 'string' ? r.date : undefined);
      const timeStr = dt ? formatTime(dt) : (typeof r?.time === 'string' ? r.time : undefined);
      const pickup = extractAddress(r, 'pickup');
      const dropoff = extractAddress(r, 'dropoff');
      const contributionAmount =
        (typeof offer.priceNumber === 'number' ? offer.priceNumber : undefined)
        ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare))
        ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price));

      const riderEmail = email || r?.riderEmail || r?.email;
      const riderName = (r?.riderName || r?.riderFullName || r?.name || (typeof userName === 'string' ? userName : undefined) || (riderEmail ? riderEmail.split('@')[0] : undefined));
      const passengers = Number(r?.passengers ?? r?.numPassengers ?? r?.seats ?? 1) || 1;

      const confirmedPayload: any = {
        rideRequestId: rideId,
        ridePostingId: offer.ridePostingId ?? null,
        confirmedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'confirmed',
        date: dateOnly,
        time: timeStr,
        pickup: pickup,
        dropoff: dropoff,
        passengers,
        contributionAmount,
        // Driver-facing
        driverId: offer.driverId || r?.driverId,
        driverName: offer.driverName || r?.driverName,
        driverEmail: offer.driverEmail || r?.driverEmail,
        driverPhone: offer.driverPhone || r?.driverPhone,
        // Rider-facing
        riderId: uid,
        riderName,
        riderEmail,
        // Originals
        originalRidePosting: null,
        originalRideRequest: {
          id: rideId,
          requestedTime: r?.requestedTime ?? r?.pickupTime ?? r?.date,
          estimatedFare: r?.estimatedFare ?? r?.price,
          pickup,
          dropoff,
          riderId: r?.riderId || r?.userId,
          riderEmail: r?.riderEmail || r?.email,
          distance: r?.distance,
        },
      };

      if (!confirmedPayload.driverId) {
        console.warn('acceptOffer: missing driverId in offer; confirmed ride will not be visible to driver until driverId is set');
      }

  const cleanedPayload = deepClean(confirmedPayload);

      // 4) Write confirmed ride (idempotent doc id to avoid duplicates)
      const safeDriverId = (confirmedPayload.driverId ? String(confirmedPayload.driverId) : `offer_${offer.id}`);
      const crId = `${rideId}_${safeDriverId}`; // deterministic id
      try {
        await setDoc(doc(firestore, 'confirmedRides', crId), cleanedPayload, { merge: true });
      } catch (err) {
        console.warn('confirmedRides setDoc failed, trying addDoc fallback', err);
        try {
          await addDoc(collection(firestore, 'confirmedRides'), cleanedPayload);
        } catch (err2) {
          console.warn('confirmedRides addDoc failed', err2);
          Alert.alert('Save failed', 'Could not save to confirmed rides. Please try again.');
          throw err2;
        }
      }

      // 5) Reflect status on rideRequest
      await updateDoc(rrRef, { status: 'confirmed' }).catch(() => {});

      // 6) Optimistically update local UI state to avoid flicker back to Posted
      setOffersByRideId((prev) => ({
        ...prev,
        [rideId]: { ...prev[rideId], status: 'accepted' },
      }));
      setUpcoming((prev) => prev.map((u) => (u.id === rideId ? { ...u, status: 'confirmed' } : u)));

      // Toast: accepted -> confirmed
      try {
        // Best-effort pickup/dropoff from request
        const rrSnap2 = await getDoc(doc(firestore, 'rideRequests', rideId));
        const r2 = rrSnap2.exists() ? (rrSnap2.data() as any) : {};
        const from = extractAddress(r2, 'pickup') || 'Pickup';
        const to = extractAddress(r2, 'dropoff') || 'Dropoff';
        rideToasts.rideConfirmed({ from, to });
      } catch {
        showSuccessToast('Offer Accepted', 'Ride confirmed');
      }
    } catch (e) {
      console.warn('acceptOffer error', e);
      showErrorToast('Accept Failed', 'Could not accept the offer');
    }
  };

  // Reject an incoming offer for a given ride request
  const doRejectOffer = async (rideId: string) => {
    try {
      const offer = offersByRideId[rideId];
      if (!offer) return;
      // Mark offer as rejected in Firestore
      await updateDoc(doc(firestore, 'rideOffers', offer.id), { status: 'rejected' });
      // Optimistically update local state
      setOffersByRideId((prev) => ({
        ...prev,
        [rideId]: { ...prev[rideId], status: 'rejected' },
      }));
      showInfoToast('Offer Rejected', 'You declined this offer');
    } catch (e) {
      console.warn('rejectOffer error', e);
      showErrorToast('Reject Failed', 'Could not reject the offer');
      Alert.alert('Error', 'Could not reject the offer. Please try again.');
    }
  };

  const confirmRejectOffer = (rideId: string) => {
    Alert.alert(
      'Reject this offer?',
      'You won’t be matched with this driver for this ride.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => { void doRejectOffer(rideId); } },
      ]
    );
  };

  // Cancel an offer that the rider sent to a driver posting (ridePostingRequests)
  const doCancelOfferSent = async (ridePostingRequestId: string) => {
    try {
      await updateDoc(doc(firestore, 'ridePostingRequests', ridePostingRequestId), { status: 'cancelled' });
      // Optimistically update local UI
      setUpcoming((prev) => prev.map((u) => (u.type === 'ridePostingRequest' && u.id === ridePostingRequestId ? { ...u, status: 'cancelled' } : u)));
      showInfoToast('Offer Cancelled', 'Your offer was withdrawn');
    } catch (e) {
      console.warn('cancelOfferSent error', e);
      showErrorToast('Cancel Failed', 'Could not cancel the offer');
      Alert.alert('Error', 'Could not cancel the offer. Please try again.');
    }
  };

  const confirmCancelOffer = (ridePostingRequestId: string) => {
    Alert.alert(
      'Cancel this offer?',
      'This will withdraw your offer to the driver.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel Offer', style: 'destructive', onPress: () => { void doCancelOfferSent(ridePostingRequestId); } },
      ]
    );
  };

  const closeModal = () => {
    setModalVisible(false);
    setSelectedRide(null);
    setModalDriver(null);
    setModalDistanceText(undefined);
  };

  // ===== Ratings logic =====
  async function hasUserRated(rideId: string, userId: string): Promise<boolean> {
    try {
      const id = `${rideId}_${userId}`;
      const snap = await getDoc(doc(firestore, 'rideRatings', id));
      return snap.exists();
    } catch {
      return false;
    }
  }

  function mapCallableRatingError(e: any): string {
    const code = String(e?.code || '').replace(/^functions\//, '');
    const map: Record<string, string> = {
      'already-exists': 'You already rated this ride.',
      'permission-denied': 'Only participants can rate.',
      'failed-precondition': 'Ride must be completed before rating.',
      'out-of-range': 'Rating must be 1–5.',
      'invalid-argument': 'Invalid rating.',
      'unauthenticated': 'Sign in required.',
    };
    return map[code] || 'Could not submit rating. Please try again.';
  }

  async function openRatingForRide(rideId: string, driverName?: string) {
    if (!uid) return;
    // If we already know this ride is rated, don't open
    if (ratedRideIds.has(rideId)) return;
    const already = await hasUserRated(rideId, uid);
    if (already) {
      setRatedRideIds((prev) => new Set(prev).add(rideId));
      Alert.alert('Rating', 'You already rated this ride.');
      return;
    }
    setRatingError(null);
    setRatingTarget({ rideId, driverName });
    setRatingModalVisible(true);
  }

  async function promptPendingRatingForRider(userId: string) {
    try {
      const qDone = query(collection(firestore, 'confirmedRides'), where('riderId', '==', userId), where('status', '==', 'COMPLETED'));
      const snap = await getDocs(qDone);
      if (snap.empty) return;
      // Sort by completedAt desc (support TS/Date/string); fallback to updatedAt/createdAt
      const docs = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as any }))
        .sort((a, b) => {
          const ad = toDateField(a.data.completedAt || a.data.updatedAt || a.data.createdAt) || new Date(0);
          const bd = toDateField(b.data.completedAt || b.data.updatedAt || b.data.createdAt) || new Date(0);
          return bd.getTime() - ad.getTime();
        });
      for (const row of docs) {
        const already = await hasUserRated(row.id, userId);
        if (!already) {
          await openRatingForRide(row.id, row.data?.driverName);
          break;
        }
      }
    } catch {}
  }

  async function maybePromptRatingForRide(rideId: string, driverName?: string) {
    if (!uid) return;
    const already = await hasUserRated(rideId, uid);
    if (!already) {
      openRatingForRide(rideId, driverName);
    } else {
      setRatedRideIds((prev) => new Set(prev).add(rideId));
    }
  }

  useEffect(() => {
    if (!uid) return;
    // Prompt on auth load (find most recent unrated)
    promptPendingRatingForRider(uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // For the small Recent list, resolve whether each is rated
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!uid || recent.length === 0) return;
      const pending: string[] = recent.map((r) => r.id).filter((id) => !ratedRideIds.has(id));
      const results: string[] = [];
      for (const id of pending) {
        const ok = await hasUserRated(id, uid);
        if (ok) results.push(id);
      }
      if (!cancelled && results.length) {
        setRatedRideIds((prev) => {
          const next = new Set(prev);
          results.forEach((id) => next.add(id));
          return next;
        });
      }
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, uid]);

  // Auto-scroll promotions every 5 seconds
  useEffect(() => {
    if (!promotions || promotions.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentPromotionIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % promotions.length;
        const cardWidth = Dimensions.get('window').width - 24;
        const scrollPosition = nextIndex * cardWidth;
        
        promotionsScrollRef.current?.scrollTo({
          x: scrollPosition,
          animated: true,
        });
        
        return nextIndex;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [promotions]);

  // Callable reference
  const callUpdateRideStatus = useMemo(() => httpsCallable(functions, 'updateRideStatus'), []);

  const openChatForRide = async (card: UpcomingRideCard) => {
    // Find existing chat based on confirmedId (rideId in chats collection)
    const docId = await resolveConfirmedDocId(card);
    if (!docId || !uid) return;
    
    try {
      const chatsRef = collection(firestore, 'chats');
      const q = query(chatsRef, where('rideId', '==', docId));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        // Navigate to existing chat
        const chatId = snapshot.docs[0].id;
        router.push(`/messages/${chatId}`);
      } else {
        // Navigate to messages tab - chat will be auto-created when first message is sent
        router.push('/(tabs)/messages');
      }
    } catch (error) {
      console.error('Error finding chat:', error);
      router.push('/(tabs)/messages');
    }
  };

  // Render CTA/buttons for confirmed rides based on flags and status
  const renderConfirmedRideCTA = (card: UpcomingRideCard) => {
    const key = uLogicalKey(card);
    const idx = confirmedIndexRef.current[key];
    const status = (idx?.status || (card.status || '')).toString().toLowerCase();
    const flags = idx?.flags || {};
    if (status === 'flagged') {
      return (
        <View style={{ paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#FEF2F2', borderRadius: 8, marginTop: 8 }}>
          <Text style={{ fontSize: 14, color: '#991B1B', fontWeight: '600', marginBottom: 4 }}>Ride Under Review</Text>
          <Text style={{ fontSize: 13, color: '#7F1D1D', lineHeight: 18 }}>Your safety report has been submitted. Our team will review this ride and contact you if needed.</Text>
        </View>
      );
    }
    const riderPicked = !!flags.riderPickupConfirmed;
    const driverPicked = !!flags.driverPickupConfirmed;
    const riderCompleted = !!flags.riderCompleteConfirmed;
    const driverCompleted = !!flags.driverCompleteConfirmed;

    const onConfirmPickup = async () => {
      const docId = await resolveConfirmedDocId(card);
      if (!docId) {
        Alert.alert('Ride not found', 'We could not find this ride.');
        return;
      }
      try {
        await callUpdateRideStatus({ rideId: docId, action: 'rider_pickup' });
        // Silently succeed - status will update automatically
      } catch (e: any) {
        console.error('Error confirming pickup:', e);
        Alert.alert('Error', 'Could not confirm pickup. Please try again.');
      }
    };

    const onApproveCompletion = async () => {
      const docId = await resolveConfirmedDocId(card);
      if (!docId) {
        Alert.alert('Ride not found', 'We could not find this ride.');
        return;
      }
      try {
        await callUpdateRideStatus({ rideId: docId, action: 'rider_complete' });
        // Silently succeed - notification will be sent when ride is fully completed
      } catch (e: any) {
        // Only show error if the cloud function actually fails
        console.error('Error approving completion:', e);
        Alert.alert('Error', 'Could not approve completion. Please try again.');
      }
    };

    const onCancelRide = async () => {
      const docId = await resolveConfirmedDocId(card);
      if (!docId) {
        Alert.alert('Ride not found', 'We could not find this ride.');
        return;
      }
      const doCancel = async () => {
        try {
          // Prefer backend callable if it supports rider_cancel
          await callUpdateRideStatus({ rideId: docId, action: 'rider_cancel' });
        } catch (e) {
          // Fallback: update Firestore directly
          try { await updateDoc(doc(firestore, 'confirmedRides', docId), { status: 'cancelled', updatedAt: serverTimestamp() }); } catch {}
          if (card.rideRequestId) {
            try { await updateDoc(doc(firestore, 'rideRequests', card.rideRequestId), { status: 'cancelled' }); } catch {}
          }
        }
        void logActivity({
          type: 'ride_request_cancelled',
          entityType: 'rideRequest',
          entityId: card.rideRequestId ?? docId,
          metadata: {
            confirmedRideId: docId,
          },
        });
        // Optimistic UI update
        setUpcoming((prev) => prev.map((u) => {
          if (u.type === 'confirmedRide' && card.type === 'confirmedRide' && u.id === card.id) return { ...u, status: 'cancelled' };
          if (card.rideRequestId && u.id === card.rideRequestId) return { ...u, status: 'cancelled' };
          return u;
        }));
      };
      Alert.alert(
        'Cancel this ride?',
        'This will cancel your confirmed ride and it may no longer be available.',
        [
          { text: 'Keep Ride', style: 'cancel' },
          { text: 'Cancel Ride', style: 'destructive', onPress: () => { void doCancel(); } },
        ]
      );
    };

    // Pending (1/2 seats filled): allow cancel but no pickup yet
    if (status === 'pending') {
      return (
        <View style={[styles.offerActionsRow, { justifyContent: 'flex-end', alignItems: 'center' }]}>
          <TouchableOpacity onPress={async () => {
            const docId = await resolveConfirmedDocId(card);
            if (!docId) { Alert.alert('Ride not found', 'We could not find this ride to flag.'); return; }
            setFlaggingRideId(docId);
            setFlagModalVisible(true);
          }} style={styles.flagBtn} accessibilityLabel="Flag ride">
            <View style={styles.flagIconWrapper}><Flag size={16} color="#DC2626" /></View>
          </TouchableOpacity>
          <Button variant="outline" size="sm" onPress={onCancelRide}>
            Cancel
          </Button>
        </View>
      );
    }

    if (status === 'confirmed' || status === 'confimed' || status === 'matched') {
      // Always show a flag button for confirmed rides (helps report driver no-show etc.)
      return (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={async () => {
            const docId = await resolveConfirmedDocId(card);
            if (!docId) { Alert.alert('Ride not found', 'We could not find this ride to flag.'); return; }
            setFlaggingRideId(docId);
            setFlagModalVisible(true);
          }} style={styles.flagBtn} accessibilityLabel="Flag ride">
            <View style={styles.flagIconWrapper}><Flag size={16} color="#DC2626" /></View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openChatForRide(card)} style={styles.chatBtn} accessibilityLabel="Chat">
            <View style={styles.chatIconWrapper}><MessageCircle size={16} color="#E05E1A" /></View>
          </TouchableOpacity>
          {!riderPicked ? (
            <>
              <Button variant="outline" size="sm" onPress={onCancelRide}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onPress={onConfirmPickup}>
                Confirm Pickup
              </Button>
            </>
          ) : null}
        </View>
      );
    }
    if (status === 'in_progress' || status === 'in-progress' || status === 'driver_completed' || status === 'pending') {
      // Show Approve Completion if driver has completed (driverCompleteConfirmed) or status is driver_completed
      // This ensures the button shows even if flags aren't synced properly
      const shouldShowApproveButton = (driverCompleted || status === 'driver_completed') && !riderCompleted;
      
      if (shouldShowApproveButton) {
        return (
          <View style={[styles.offerActionsRow, { justifyContent: 'flex-end', alignItems: 'center' }]}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={async () => {
                const docId = await resolveConfirmedDocId(card);
                if (!docId) { Alert.alert('Ride not found', 'We could not find this ride to flag.'); return; }
                setFlaggingRideId(docId);
                setFlagModalVisible(true);
              }} style={styles.flagBtn} accessibilityLabel="Flag ride">
                <View style={styles.flagIconWrapper}><Flag size={16} color="#DC2626" /></View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openChatForRide(card)} style={styles.chatBtn} accessibilityLabel="Chat">
                <View style={styles.chatIconWrapper}><MessageCircle size={16} color="#E05E1A" /></View>
              </TouchableOpacity>
            </View>
            <Button variant="primary" size="sm" onPress={onApproveCompletion}>
              Approve Completion
            </Button>
          </View>
        );
      }
      if (riderCompleted && !driverCompleted && status !== 'driver_completed') {
        return (
          <Text style={{ color: '#64748B', fontSize: 12 }}>Waiting for driver to confirm completion</Text>
        );
      }
      // If in_progress and no completion flags set, show chat/flag only
      if (status === 'in_progress' || status === 'in-progress') {
        return (
          <View style={[styles.offerActionsRow, { justifyContent: 'flex-end', alignItems: 'center' }]}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={async () => {
                const docId = await resolveConfirmedDocId(card);
                if (!docId) { Alert.alert('Ride not found', 'We could not find this ride to flag.'); return; }
                setFlaggingRideId(docId);
                setFlagModalVisible(true);
              }} style={styles.flagBtn} accessibilityLabel="Flag ride">
                <View style={styles.flagIconWrapper}><Flag size={16} color="#DC2626" /></View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openChatForRide(card)} style={styles.chatBtn} accessibilityLabel="Chat">
                <View style={styles.chatIconWrapper}><MessageCircle size={16} color="#E05E1A" /></View>
              </TouchableOpacity>
            </View>
          </View>
        );
      }
      return null;
    }
    // Completed or other states: no CTA
    return null;
  };

  // Resolve confirmedRides doc id for a card (by cached index or Firestore lookup)
  const resolveConfirmedDocId = async (card: UpcomingRideCard): Promise<string | null> => {
    // If the card is itself a confirmed ride, its id is the confirmed doc id
    if (card.type === 'confirmedRide') return card.id;
    const key = uLogicalKey(card);
    const cached = confirmedIndexRef.current[key]?.docId;
    if (cached) return cached;
    const rrid = card.rideRequestId ?? (card.type === 'rideRequest' ? card.id : undefined);
    if (!rrid) return null;
    try {
      const qs = query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', rrid), fsLimit(1));
      const snap = await getDocs(qs);
      const d = snap.docs[0];
      if (!d) {
        // Fallback: rides posted by drivers are keyed by ridePostingId + riderId
        const rp = card.ridePostingId;
        const rid = card.riderId;
        if (rp && rid) {
          // Try common rider field variants
          const riderFieldCandidates = ['riderId', 'riderUid', 'rider.id'];
          for (const fld of riderFieldCandidates) {
            try {
              const altQ = query(
                collection(firestore, 'confirmedRides'),
                where('ridePostingId', '==', rp),
                where(fld as any, '==', rid),
                fsLimit(1)
              );
              const altSnap = await getDocs(altQ);
              const altD = altSnap.docs[0];
              if (altD) {
                confirmedIndexRef.current[key] = {
                  docId: altD.id,
                  status: (String((altD.data() as any)?.status || '') as any).toLowerCase() as any,
                  flags: extractFlags(altD.data() as any),
                };
                return altD.id;
              }
            } catch {}
          }
        }
        return null;
      }
      confirmedIndexRef.current[key] = {
        docId: d.id,
        status: (String((d.data() as any)?.status || '') as any).toLowerCase() as any,
        flags: extractFlags(d.data() as any),
      };
      return d.id;
    } catch {
      return null;
    }
  };

  // Map callable errors to friendly messages
  function handleRideActionError(e: any) {
    const code = String(e?.code || '').replace(/^functions\//, '');
    const map: Record<string, string> = {
      'not-found': 'Ride not found',
      'failed-precondition': 'Action not allowed for current status',
      'permission-denied': 'You don’t have access to this ride',
      'out-of-range': 'Pickup can only be confirmed on ride day',
      'invalid-argument': 'Invalid request',
      'unauthenticated': 'Sign in required',
    };
    const msg = map[code] || 'Something went wrong. Please try again.';
    Alert.alert('Action failed', msg);
  }

  // Load driver info (name, rating, phone, avatar) when opening the modal
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!modalVisible || !selectedRide) {
          if (!cancelled) {
            setModalDriver(null);
            setModalDistanceText(undefined);
          }
          return;
        }

        let distanceText: string | undefined = selectedRide.distanceText ?? undefined;
        const considerDistance = (source: any) => {
          if (distanceText) return;
          const resolved = extractDistance(source);
          if (resolved) distanceText = resolved;
        };
        considerDistance(selectedRide);

        // Seed from card or offer map
        const offer = offersByRideId[selectedRide.id];
        let driverId: any = offer?.driverId;
        let driverEmail: any = offer?.driverEmail;
        let name: string | undefined = offer?.driverName || selectedRide.driverName;
        let phone: string | null | undefined = offer?.driverPhone || selectedRide.driverPhone;
        let avatarRaw: any = undefined;
        let rating: number | null | undefined = selectedRide.driverRating ?? null;
        if (offer?.distanceText && !distanceText) distanceText = offer.distanceText;

        // 0) If this is an "Offer Sent" card, fetch driver from the original ride posting
        if (selectedRide.status === 'Offer Sent' || selectedRide.status === 'offer_sent' || selectedRide.status === 'sent') {
          const postingId = selectedRide.ridePostingId;
          if (postingId) {
            try {
              const postingDoc = await getDoc(doc(firestore, 'ridePostings', postingId));
              if (postingDoc.exists()) {
                const postingData = postingDoc.data() as any;
                driverId = driverId || postingData.driverId || postingData.driverUID || postingData.ownerId || postingData.postedBy;
                driverEmail = driverEmail || postingData.driverEmail || postingData.ownerEmail || postingData.email;
                name = name || postingData.driverName || postingData.driver?.name || postingData.ownerName || postingData.owner?.name;
                phone = phone || postingData.driverPhone || postingData.phone;
                avatarRaw = avatarRaw || postingData.driverAvatarUrl || postingData.driver?.avatarUrl || postingData.profilePicture;
                rating = rating ?? (postingData.driverRating ?? postingData.rating ?? postingData.driver?.rating ?? null);
                considerDistance(postingData);
                console.log(`   📤 Fetched driver from posting: driverId=${driverId}, name=${name}, rating=${rating}`);
              }
            } catch (e) {
              console.warn(`   ⚠️ Could not fetch posting for driver info:`, e);
            }
          }
        }

        // 1) If selectedRide is itself a confirmed ride doc, fetch it by id (covers flagged confirmed rides)
        if (!driverId && selectedRide.type === 'confirmedRide') {
          try {
            const d = await getDoc(doc(firestore, 'confirmedRides', selectedRide.id));
            const data = d.exists() ? (d.data() as any) : undefined;
            if (data) {
              driverId = driverId || data.driverId || data.driverUID || data.providerId;
              driverEmail = driverEmail || data.driverEmail;
              name = name || data.driverName || data.driver?.name || data.driver?.fullName || data.ownerName || data.owner?.name || data.providerName;
              phone = phone || data.driverPhone;
              avatarRaw = avatarRaw || data.driverAvatarUrl || data.driverPhotoUrl || data.profilePicture || data.photoURL;
              // Also capture rating if present on the confirmed ride doc
              rating = rating ?? (typeof data.driverRating === 'number' ? data.driverRating : (data.driver?.rating ?? null));
              considerDistance(data);
              considerDistance(data?.rideRequest);
              considerDistance(data?.originalRideRequest);
              considerDistance(data?.trip);
              considerDistance(data?.route);
              considerDistance(data?.details);
            }
          } catch {}
        }
        // If still no driverId, try finding confirmedRides by rideRequestId (covers when selectedRide is a rideRequest)
        if (!driverId) {
          try {
            const qs = query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', selectedRide.id), fsLimit(1));
            const snap = await getDocs(qs);
            const data = snap.docs[0]?.data() as any | undefined;
            if (data) {
              driverId = driverId || data.driverId || data.driverUID || data.providerId;
              driverEmail = driverEmail || data.driverEmail;
              name = name || data.driverName || data.driver?.name || data.driver?.fullName || data.ownerName || data.owner?.name || data.providerName;
              phone = phone || data.driverPhone;
              avatarRaw = avatarRaw || data.driverAvatarUrl || data.driverPhotoUrl || data.profilePicture || data.photoURL;
              // Also capture rating if present on the confirmed ride doc
              rating = rating ?? (typeof data.driverRating === 'number' ? data.driverRating : (data.driver?.rating ?? null));
              considerDistance(data);
              considerDistance(data?.rideRequest);
              considerDistance(data?.originalRideRequest);
              considerDistance(data?.trip);
              considerDistance(data?.route);
              considerDistance(data?.details);
            }
          } catch {}
        }

        // 2) As a fallback for any state, inspect the rideRequest doc itself
        if (!driverId || !name || !avatarRaw) {
          try {
            const rr = await getDoc(doc(firestore, 'rideRequests', selectedRide.id));
            const r = rr.exists() ? (rr.data() as any) : undefined;
            if (r) {
              driverId = driverId || r.driverId || r.assignedDriverId;
              driverEmail = driverEmail || r.driverEmail;
              name = name || r.driverName || r.driver?.name || r.driver?.fullName || r.ownerName || r.owner?.name;
              phone = phone || r.driverPhone;
              avatarRaw = avatarRaw || r.driverAvatarUrl || r.driverPhotoUrl || r.profilePicture || r.photoURL;
              considerDistance(r);
              considerDistance(r?.ridePosting);
              considerDistance(r?.details);
              considerDistance(r?.trip);
              considerDistance(r?.estimatedRoute);
            }
          } catch {}
        }

        // 4) Fetch driver profile by id/email to enrich name/rating/avatar
        let prof: any = undefined;
        if (driverId) {
          try {
            const d1 = await getDoc(doc(firestore, 'drivers', String(driverId)));
            prof = d1.exists() ? (d1.data() as any) : undefined;
          } catch {}
        }
        if (!prof && driverEmail) {
          try {
            const q1 = query(collection(firestore, 'drivers'), where('email', '==', driverEmail), fsLimit(1));
            const s1 = await getDocs(q1);
            prof = s1.docs[0]?.data() as any;
          } catch {}
        }
        if (!prof && driverId) {
          try {
            const d2 = await getDoc(doc(firestore, 'users', String(driverId)));
            prof = d2.exists() ? (d2.data() as any) : undefined;
          } catch {}
        }
        if (!prof && driverEmail) {
          try {
            const q2 = query(collection(firestore, 'users'), where('email', '==', driverEmail), fsLimit(1));
            const s2 = await getDocs(q2);
            prof = s2.docs[0]?.data() as any;
          } catch {}
        }

  // Normalize fields
  const nameFromProf = getNameFromProfile(prof);
  const ratingFromProf = typeof prof?.rating === 'number' ? prof.rating as number : (typeof prof?.avgRating === 'number' ? prof.avgRating as number : undefined);
  const rawAvatarFromProf = prof?.profilePicture || prof?.avatarUrl || prof?.avatarURL || prof?.photoURL || prof?.photoUrl || prof?.profileImageUrl || prof?.imageUrl || prof?.picture || prof?.avatar || prof?.personalInfo?.profilePicture || prof?.personalInfo?.photoURL || prof?.personalInfo?.photoUrl || prof?.personalInfo?.imageUrl;
  // Detect phone stored on profile (drivers or users collection)
  const phoneFromProf = prof?.phone || prof?.phoneNumber || prof?.phone_number || prof?.contact?.phone || prof?.personalInfo?.phone;

  let avatarUrl: string | null | undefined = sanitizeAvatar(avatarRaw || rawAvatarFromProf);

        // Resolve Firebase Storage paths to https URL
        if (avatarUrl && !/^https?:\/\//i.test(avatarUrl) && !avatarUrl.startsWith('data:')) {
          const s = avatarUrl.replace(/^gs:\/\/[^/]+\//, '');
          try {
            avatarUrl = await getDownloadURL(storageRef(storage, s));
          } catch {
            // leave as is if resolution fails
          }
        }

        const seedName = name || selectedRide.driverName;
        const finalName = (nameFromProf && nameFromProf.trim())
          ? nameFromProf
          : (seedName && !isGenericName(seedName) ? seedName : (driverEmail ? String(driverEmail).split('@')[0] : undefined));
        const finalRating = (selectedRide.driverRating ?? ratingFromProf ?? null) as number | null;
        const finalPhone = phone ?? (phoneFromProf ?? null);
        const finalPhoneFromProfile = !!phoneFromProf;

        if (!cancelled) {
          setModalDriver({ name: finalName, rating: finalRating, phone: finalPhone, phoneFromProfile: finalPhoneFromProfile, avatarUrl: avatarUrl ?? null, vehicleText: selectedRide.vehicleText, driverId: driverId ? String(driverId) : undefined });
          setModalDistanceText(distanceText ?? offer?.distanceText ?? selectedRide.distanceText ?? undefined);
        }
      } catch {
        if (!cancelled) {
          setModalDriver(null);
          setModalDistanceText(selectedRide?.distanceText ?? undefined);
        }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [modalVisible, selectedRide, offersByRideId]);



  console.log('Render - userPhoto state:', userPhoto);
  
  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Static Header - Profile, Welcome, Notifications */}
        <View style={[styles.staticHeader, isScrolled && styles.staticHeaderScrolled]}>
          <View style={styles.headerRow}>
            <View style={styles.userIcon}>
              {userPhoto ? (
                <Image 
                  source={{ uri: userPhoto }} 
                  style={styles.profileImage}
                  onError={(error) => {
                    console.log('Image load error:', error);
                    // Fallback to null to show default icon
                    setUserPhoto(null);
                  }}
                  onLoad={() => console.log('Image loaded successfully:', userPhoto)}
                  resizeMode="cover"
                />
              ) : (
                <User size={20} color="#64748B" />
              )}
            </View>
            <View style={styles.greetingSection}>
              <Text style={styles.greetingText}>Welcome back,</Text>
              <Text style={styles.userNameText}>{userName ? capitalize(userName) : 'Melody'}</Text>
            </View>
            <TouchableOpacity 
              style={styles.cleanNotificationButton}
              onPress={() => router.push('/(tabs)/notifications')}
              accessibilityLabel="Notifications"
            >
              <Bell size={20} color="#1A2942" />
              {unreadCount > 0 && (
                <View style={styles.cleanNotificationBadge}>
                  <Text style={styles.cleanNotificationBadgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Scrollable Content */}
        <ScrollView 
          style={styles.scrollView} 
          contentContainerStyle={styles.scrollViewContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#E05E1A"
              colors={['#E05E1A']}
            />
          }
          onScroll={(event) => {
            const scrollY = event.nativeEvent.contentOffset.y;
            setIsScrolled(scrollY > 10);
          }}
          scrollEventThrottle={16}
        >
          {/* Student Verification Banner - Below Welcome */}
          <StudentVerificationBanner />

          {/* Where to Button */}
          <View style={styles.whereToContainer}>
            <TouchableOpacity 
              style={styles.whereToButton}
              onPress={() => router.push('/(tabs)/book')}
            >
              <MapPin size={24} color="#FFFFFF" />
              <View style={styles.whereToTextContainer}>
                <Text style={styles.whereToTitle}>Where to?</Text>
                <Text style={styles.whereToSubtitle}>Book your next ride now</Text>
              </View>
              <View style={styles.whereToArrow}>
                <Text style={styles.whereToArrowText}>→</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Your Activity Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Activity</Text>
            
            {/* Activity Stats */}
            <View style={styles.activityStats}>
              <View style={styles.activityStatCardRides}>
                <Text style={styles.activityStatNumber}>{stats.totalRides}</Text>
                <Text style={styles.activityStatLabel}>Rides</Text>
              </View>
              <View style={styles.activityStatCardSaved}>
                <Text style={styles.activityStatNumberGreen}>${stats.spent?.toFixed ? Math.round(stats.spent) : '0'}</Text>
                <Text style={styles.activityStatLabel}>Spent</Text>
              </View>
              <View style={styles.activityStatCardRating}>
                <Text style={styles.activityStatNumberOrange}>{(typeof stats.avgRating === 'number') ? stats.avgRating.toFixed(1) : '—'}</Text>
                <Text style={styles.activityStatLabel}>Rating</Text>
              </View>
            </View>
          </View>

          {/* Promotions Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Promotions</Text>
              {promotionsError && (
                <TouchableOpacity onPress={refreshPromotions}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>

            {promotionsLoading && promotions.length === 0 ? (
              <View style={styles.promotionsLoading}>
                <ActivityIndicator size="small" color="#E05E1A" />
                <Text style={styles.loadingText}>Loading offers...</Text>
              </View>
            ) : promotions.length > 0 ? (
              <>
                <ScrollView 
                  ref={promotionsScrollRef}
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.promotionsScrollContainer}
                  style={styles.promotionsScroll}
                  pagingEnabled={false}
                  decelerationRate="fast"
                  snapToInterval={Dimensions.get('window').width - 24}
                  snapToAlignment="start"
                  onScroll={(event) => {
                    const scrollX = event.nativeEvent.contentOffset.x;
                    const cardWidth = Dimensions.get('window').width - 24; // Card width plus spacing
                    const newIndex = Math.round(scrollX / cardWidth);
                    setCurrentPromotionIndex(newIndex);
                  }}
                  scrollEventThrottle={16}
                >
                  {promotions.map((promotion) => (
                    <PromotionCard
                      key={promotion.id}
                      promotion={promotion}
                      onPress={handlePromotionPress}
                      isLoading={false}
                      isClaimed={isPromotionClaimed(promotion.id)}
                    />
                  ))}
                </ScrollView>
                {promotions.length > 1 && (
                  <View style={styles.promotionIndicators}>
                    {promotions.map((_, index) => (
                      <View
                        key={index}
                        style={[
                          styles.promotionIndicator,
                          currentPromotionIndex === index && styles.promotionIndicatorActive
                        ]}
                      />
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.emptyPromotions}>
                <Gift size={32} color="#999" />
                <Text style={styles.emptyPromotionsText}>
                  {promotionsError ? 'Failed to load offers' : 'No promotions available'}
                </Text>
                {promotionsError && (
                  <TouchableOpacity onPress={refreshPromotions} style={styles.retryButton}>
                    <Text style={styles.retryButtonText}>Try Again</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Upcoming Rides Section - Working Version */}
          <View style={styles.upcomingSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Upcoming Rides</Text>
              <TouchableOpacity onPress={() => router.push('/ride-history')}>
                <Text style={styles.viewAllText}>View All</Text>
              </TouchableOpacity>
            </View>
            {loading && (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color="#E05E1A" />
              </View>
            )}

            {!loading && (() => {
              // Filter out rejected/declined/canceled/expired rides before checking length
              const visibleRides = sortedUpcoming.filter((r) => {
                const statusKey = (r.status || '').toLowerCase();
                return !['rejected','declined','canceled','cancelled','expired'].includes(statusKey);
              });
              
              if (visibleRides.length === 0) {
                return (
                  <View style={styles.emptyUpcoming}>
                    <Text style={styles.emptyUpcomingText}>No upcoming rides found</Text>
                  </View>
                );
              }
              
              return null;
            })()}

            {!loading && sortedUpcoming.map((r) => {
              const statusKey = (r.status || '').toLowerCase();
              // Hide rejected/declined/canceled/expired cards entirely
              if (['rejected','declined','canceled','cancelled','expired'].includes(statusKey)) return null;
              const offer = offersByRideId[r.id];
              const offerStatus = (offer?.status || '').toLowerCase();
              const hasPendingOffer = !!offer && ['pending','sent','offer','offer_sent','received','offer_received'].includes(offerStatus);
              const isAcceptedOffer = ['accepted','confirmed'].includes(offerStatus);
              const isOfferSent = statusKey === 'offer sent' || statusKey === 'offer_sent' || statusKey === 'sent';
              const isConfirmed = r.type === 'confirmedRide' || isAcceptedOffer || ['confirmed','matched','driver-arriving','in-progress','accepted'].includes(statusKey);
              const dateText = r.dateTime && r.dateTime instanceof Date && !isNaN(r.dateTime.getTime())
                ? r.dateTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '';
              const timeText = r.dateTime && r.dateTime instanceof Date && !isNaN(r.dateTime.getTime()) 
                ? r.dateTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) 
                : '';
              return (
                <View key={`${r.type}-${r.id}`} style={styles.rideCard}>
                  <View style={styles.rideHeader}>
            <View style={
              statusKey === 'flagged' ? styles.statusBadgeFlagged :
              (isOfferSent ? styles.statusBadgeOfferSent :
              (hasPendingOffer ? styles.statusBadgeOfferReceived
                : ((r.type === 'confirmedRide' && statusKey === 'pending') ? styles.statusBadgePending : (isConfirmed ? styles.statusBadge : styles.statusBadgePending))))
            }>
                      <Text style={
                        statusKey === 'flagged' ? styles.statusTextFlagged :
                        (isOfferSent ? styles.statusTextOfferSent :
                        (hasPendingOffer ? styles.statusTextOfferReceived
                            : ((r.type === 'confirmedRide' && statusKey === 'pending') ? styles.statusTextPending : (isConfirmed ? styles.statusText : styles.statusTextPending))))
                      }>
                        {statusKey === 'flagged' ? 'Flagged' : (isOfferSent ? 'Offer Sent' : (hasPendingOffer ? 'Offer Received' : (r.type === 'confirmedRide' ? prettyStatus(r.status, r.type) : (isConfirmed ? 'Confirmed' : prettyStatus(r.status, r.type)))))}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {(dateText || timeText) && (
                        <Text style={styles.rideDate}>
                          {dateText}{dateText && timeText && ' • '}{timeText}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.rideRoute}>
                    <View style={styles.routePoint}>
                      <View style={styles.orangeDot} />
                      <Text style={styles.routeText}>{r.from}</Text>
                    </View>
                    <View style={styles.routePoint}>
                      <View style={styles.grayDot} />
                      <Text style={styles.routeTextGray}>{r.to}</Text>
                    </View>
                  </View>
                  <View style={styles.rideFooter}>
                    <Text style={[styles.ridePrice, { flex: 1 }]}>{offer?.priceText ?? r.priceText ?? ''}</Text>
                    <Text style={[styles.rideTime, { textAlign: 'right', marginRight: 12 }]}>
                      {(offer?.durationText ?? r.durationText) ?? ''}{(offer?.distanceText ?? r.distanceText) ? ((offer?.durationText ?? r.durationText) ? ` • ${(offer?.distanceText ?? r.distanceText)}` : (offer?.distanceText ?? r.distanceText)) : ''}
                    </Text>
                    {r.type === 'rideRequest' && (
                      <TouchableOpacity
                        onPress={() => Share.share({ message: `Looking for a ride on RideAlong!\nhttps://ridealongapp.com/request/${r.id}`, url: `https://ridealongapp.com/request/${r.id}` }).catch(() => {})}
                        style={{ marginRight: 12, padding: 2 }}
                        accessibilityRole="button"
                        accessibilityLabel="Share this ride request"
                      >
                        <Share2 size={16} color="#E05E1A" />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => openRideDetails(r)}>
                      <Text style={styles.viewDetailsText}>View Details →</Text>
                    </TouchableOpacity>
                  </View>

                  {(['confirmed','in-progress','in_progress','driver_completed','pending'].includes(statusKey)) && (
                    <View style={[styles.offerActionsRow, { justifyContent: 'flex-end' }]}>
                      {renderConfirmedRideCTA(r)}
                    </View>
                  )}

                  {hasPendingOffer && (
                    <View style={[styles.offerActionsRow, { justifyContent: 'flex-end' }]}>
                      <Button variant="outline" size="sm" onPress={() => confirmRejectOffer(r.id)}>
                        Reject Offer
                      </Button>
                      <Button variant="primary" size="sm" onPress={() => acceptOffer(r.id)}>
                        Accept Offer
                      </Button>
                    </View>
                  )}
                  
                  {/* Cancel button for rider's own posted ride requests */}
                  {r.type === 'rideRequest' && ['posted', 'pending', 'open'].includes(statusKey) && !hasPendingOffer && (
                    <View style={[styles.offerActionsRow, { justifyContent: 'flex-end' }]}>
                      <Button variant="outline" size="sm" onPress={() => {
                        Alert.alert(
                          'Cancel Ride Request',
                          'Are you sure you want to cancel this ride request?',
                          [
                            { text: 'No', style: 'cancel' },
                            {
                              text: 'Yes, Cancel',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  const { getApiBaseUrl } = require('@/constants/services');
                                  const apiUrl = getApiBaseUrl();
                                  await fetch(`${apiUrl}/api/rides/${r.id}/cancel`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      collection: 'rideRequests',
                                      cancelledBy: 'rider',
                                      reason: 'Cancelled by rider'
                                    })
                                  });
                                  showSuccessToast('Request Cancelled', 'Your ride request was cancelled');
                                } catch (error) {
                                  console.error('Cancel error:', error);
                                  showErrorToast('Cancel Failed', 'Failed to cancel ride request');
                                }
                              }
                            }
                          ]
                        );
                      }}>
                        Cancel Request
                      </Button>
                    </View>
                  )}
                  
                  {/* Cancel button for Offer Sent cards (ridePostingRequests) */}
                  {isOfferSent && (
                    <View style={[styles.offerActionsRow, { justifyContent: 'flex-end' }]}>
                      <Button variant="outline" size="sm" onPress={() => confirmCancelOffer(r.id)}>
                        Cancel Offer
                      </Button>
                    </View>
                  )}
                </View>
              );
            })}
          </View>




        {/* Recent Rides Section (Completed) */}
        <View style={styles.upcomingSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Rides</Text>
            <TouchableOpacity onPress={() => router.push('/ride-history')}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          {recent.length === 0 ? (
            <View style={styles.emptyUpcoming}>
              <Text style={styles.emptyUpcomingText}>No recent rides.</Text>
            </View>
          ) : (
            recent.map((r) => (
              <View key={`recent-${r.id}`} style={styles.rideCard}>
                <View style={styles.rideHeader}>
                  <View style={styles.statusBadgePosted}>
                    <Text style={styles.statusTextPosted}>Completed</Text>
                  </View>
                  <Text style={styles.rideDate}>{r.dateTime ? formatDate(r.dateTime) : ''}</Text>
                </View>
                <View style={styles.rideRoute}>
                  <View style={styles.routePoint}>
                    <View style={styles.orangeDot} />
                    <AddressLink address={r.from} textStyle={styles.routeText} />
                  </View>
                  <View style={styles.routePoint}>
                    <View style={styles.grayDot} />
                    <AddressLink address={r.to} textStyle={styles.routeTextGray} />
                  </View>
                </View>
                <View style={styles.rideFooter}>
                  <Text style={[styles.ridePrice, { flex: 1 }]}>{r.priceText ?? ''}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    {(() => {
                      const now = new Date();
                      const completedAt = r.dateTime as Date | undefined;
                      const showFlag = completedAt && ((now.getTime() - completedAt.getTime()) <= 24 * 60 * 60 * 1000);
                      if (!showFlag) return null;
                      return (
                        <TouchableOpacity onPress={async () => {
                          const docId = await resolveConfirmedDocId(r);
                          if (!docId) { Alert.alert('Ride not found', 'We could not find this confirmed ride to flag.'); return; }
                          setFlaggingRideId(docId);
                          setFlagModalVisible(true);
                        }} style={styles.flagBtn} accessibilityLabel="Flag ride">
                          <View style={styles.flagIconWrapper}>
                            <Flag size={16} color="#DC2626" />
                          </View>
                        </TouchableOpacity>
                      );
                    })()}
                    {!ratedRideIds.has(r.id) && (
                      <TouchableOpacity style={styles.rateBtn} onPress={() => openRatingForRide(r.id)}>
                        <Text style={styles.rateBtnText}>Rate</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => router.push('/ride-history')}>
                      <Text style={styles.viewDetailsText}>View History →</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
        </ScrollView>
      </SafeAreaView>

    {/* Ride Details Modal */}
    {modalVisible && (
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeModal}
      >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Ride Details</Text>
            <TouchableOpacity onPress={closeModal} style={styles.closeButton}>
              <X size={24} color="#64748B" />
            </TouchableOpacity>
          </View>

          {selectedRide && (
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Driver Information */}
              {(
                modalDriver?.name || modalDriver?.avatarUrl || modalDriver?.phone || (typeof modalDriver?.rating === 'number') ||
                selectedRide.driverName || selectedRide.vehicleText || selectedRide.driverPhone || selectedRide.driverRating
              ) ? (
                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitleModal}>Driver Information</Text>
                  <TouchableOpacity
                    style={styles.driverInfo}
                    activeOpacity={0.9}
                    onPress={() => {
                      const id = modalDriver?.driverId ?? undefined;
                      if (!id) return;
                      // Close the modal before navigating
                      closeModal();
                      // Defer navigation to avoid navigating before the Root Layout mounts
                      setTimeout(() => {
                        try { router.push(`/driver/${id}`); } catch (e) { /* swallow navigation race error */ }
                      }, 0);
                    }}
                  >
                    {modalDriver?.avatarUrl ? (
                      <Image source={{ uri: modalDriver.avatarUrl }} style={styles.driverAvatarImg} />
                    ) : (
                      <View style={styles.driverAvatar}>
                        <User size={24} color="#64748B" />
                      </View>
                    )}
                    <View style={styles.driverDetails}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'column', justifyContent: 'center' }}>
                          <Text style={styles.driverName}>{modalDriver?.name ?? selectedRide.driverName ?? '—'}</Text>
                          {/* Rating shown under the name */}
                          {((typeof modalDriver?.rating === 'number' ? modalDriver.rating : selectedRide.driverRating) || (typeof modalDriver?.rating === 'number' && modalDriver?.rating === 0)) && (
                            <View style={[styles.ratingModalContainer, { marginTop: 2 }]}> 
                              <Star size={14} color="#F59E0B" fill="#F59E0B" />
                              <Text style={[styles.ratingModalText, { marginLeft: 6, fontSize: 13 }]}>{(typeof modalDriver?.rating === 'number' ? modalDriver.rating : selectedRide.driverRating)}</Text>
                            </View>
                          )}
                        </View>
                        {/* Phone call button: always render, but disable/dim when phone not available */}
                        {(() => {
                          const phoneNumber = (modalDriver?.phone ?? selectedRide.driverPhone) as string | undefined | null;
                          const enabled = !!phoneNumber;
                          const fromProfile = !!modalDriver?.phoneFromProfile;
                          const btnStyle = [styles.driverCallBtn, !enabled && { backgroundColor: '#E6EAF0' }];
                          if (fromProfile && enabled) btnStyle.push({ backgroundColor: theme.colors.secondary });
                          return (
                            <TouchableOpacity
                              style={btnStyle}
                              onPress={() => {
                                if (!enabled) return;
                                Linking.openURL(`tel:${phoneNumber}`).catch(() => {});
                              }}
                              accessibilityLabel={enabled ? 'Call driver' : 'Driver phone not available'}
                              disabled={!enabled}
                            >
                              <Phone size={18} color={enabled ? (fromProfile ? '#FFFFFF' : '#FFFFFF') : '#94A3B8'} />
                            </TouchableOpacity>
                          );
                        })()}
                      </View>
                      <Text style={styles.driverVehicle}>{selectedRide.vehicleText}</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitleModal}>Status</Text>
                  <Text style={{ color: '#64748B' }}>Seeking Driver</Text>
                </View>
              )}

              {/* Status Badge */}
              <View style={[
                styles.statusBadgeModal,
                (selectedRide.status || '').toLowerCase() === 'posted' || (selectedRide.status || '').toLowerCase() === 'open'
                  ? styles.statusBadgePosted
                  : ((selectedRide.type === 'confirmedRide' && (selectedRide.status || '').toLowerCase() === 'pending')
                      ? styles.statusBadgePendingModal
                      : (['confirmed','matched','driver-arriving','in-progress'].includes((selectedRide.status || '').toLowerCase()) ? styles.statusBadgeConfirmed : styles.statusBadgePendingModal))
              ]}>
                <Text style={[
                  styles.statusTextModal,
                  (selectedRide.status || '').toLowerCase() === 'posted' || (selectedRide.status || '').toLowerCase() === 'open'
                    ? styles.statusTextPosted
                    : ((selectedRide.type === 'confirmedRide' && (selectedRide.status || '').toLowerCase() === 'pending')
                        ? styles.statusTextPendingModal
                        : (['confirmed','matched','driver-arriving','in-progress'].includes((selectedRide.status || '').toLowerCase()) ? styles.statusTextConfirmed : styles.statusTextPendingModal))
                ]}>
                  {prettyStatus(selectedRide.status, selectedRide.type)}
                </Text>
              </View>

              {/* Route Information */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionTitleModal}>Route</Text>
                <View style={styles.routeModalContainer}>
                  <View style={styles.routeModalPoint}>
                    <View style={styles.orangeDotModal} />
                    <AddressLink address={selectedRide.from} textStyle={styles.locationModalText} />
                  </View>
                  <View style={styles.routeModalLine} />
                  <View style={styles.routeModalPoint}>
                    <MapPin size={16} color="#EF4444" />
                    <AddressLink address={selectedRide.to} textStyle={styles.locationModalText} />
                  </View>
                </View>
              </View>

              {/* Trip Information */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionTitleModal}>Trip Information</Text>
                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <DollarSign size={16} color="#10B981" />
                    <Text style={styles.infoLabel}>Price</Text>
                    <Text style={styles.infoValue}>{selectedRide.priceText ?? '—'}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Date</Text>
                    <Text style={styles.infoValue}>{selectedRide.dateTime ? selectedRide.dateTime.toLocaleDateString() : '—'}</Text>
                  </View>
                </View>
                <View style={styles.infoGrid}>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Time</Text>
                    <Text style={styles.infoValue}>{selectedRide.dateTime ? formatTime(selectedRide.dateTime) : '—'}</Text>
                  </View>
                  <View style={styles.infoItem}>
                    <Text style={styles.infoLabel}>Distance</Text>
                    <Text style={styles.infoValue}>{modalDistanceText ?? selectedRide.distanceText ?? '—'}</Text>
                  </View>
                </View>
                {/* Intentionally no action buttons inside the details modal */}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
      </Modal>
    )}
    {/* Rating Modal */}
    {ratingModalVisible && (
      <RatingModal
        visible={ratingModalVisible}
        onClose={() => { if (!ratingSubmitting) { setRatingModalVisible(false); setRatingTarget(null); setRatingError(null); } }}
        onSubmit={async (stars, comment) => {
          if (!ratingTarget) return;
          try {
            setRatingSubmitting(true);
            setRatingError(null);
            await submitRating({ rideId: ratingTarget.rideId, stars, comment });
            setRatingModalVisible(false);
            setRatingTarget(null);
            // Mark as rated to hide CTA
            setRatedRideIds((prev) => new Set(prev).add(ratingTarget.rideId));
            showSuccessToast('Thanks!', 'Your rating was submitted');
            // User stat card (Avg Rating) is live via users doc onSnapshot
          } catch (e: any) {
            const msg = mapCallableRatingError(e);
            setRatingError(msg);
            showErrorToast('Rating Failed', msg);
          } finally {
            setRatingSubmitting(false);
          }
        }}
        title="Rate your driver"
        subtitle={ratingTarget?.driverName ? `How was your ride with ${ratingTarget.driverName}?` : undefined}
        submitting={ratingSubmitting}
        errorText={ratingError}
      />
    )}

    {/* Flag Ride Modal */}
    <FlagRideModal
      visible={flagModalVisible}
      rideId={flaggingRideId}
      onClose={() => {
        setFlagModalVisible(false);
        setFlaggingRideId(null);
      }}
      onFlagged={(rid) => {
        // Optimistically mark the confirmed ride as flagged and keep it visible
        try {
          setUpcoming((prev) => prev.map((u) => {
            if (u.type === 'confirmedRide' && u.id === rid) {
              return { ...u, status: 'flagged' };
            }
            return u;
          }));
          // Update cached index status if we can resolve the key by docId
          try {
            const entry = Object.entries(confirmedIndexRef.current).find(([, v]) => v?.docId === rid);
            if (entry) {
              const [key, val] = entry as [string, { docId: string; status: any; flags?: any }];
              confirmedIndexRef.current[key] = { ...val, status: 'flagged' } as any;
            }
          } catch {}
          showSuccessToast('Ride Flagged', 'Thanks for your report');
        } catch {}
      }}
    />

    {/* Promotion Details Modal */}
    <PromotionDetailsModal
      visible={promotionModalVisible}
      promotion={selectedPromotion}
      onClose={() => {
        setPromotionModalVisible(false);
        setSelectedPromotion(null);
      }}
      onClaim={handleClaimPromotion}
      isClaimed={selectedPromotion ? isPromotionClaimed(selectedPromotion.id) : false}
      isLoading={false}
    />
    </View>
  );
}

function formatDate(d: Date | null | undefined) {
  try {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) {
      return '';
    }
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${formatTime(d)}`;
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

// Clean up odd duration strings like "3h 55.949999999999999m" to a friendly form
function sanitizeDurationText(v: string): string | undefined {
  try {
    if (!v) return undefined;
    // Turn awkward decimal minute strings into friendly rounded minutes.
    // Examples:
    //  - "21.7833333333333333335 min" -> "22 min"
    //  - "3h 55.949999999999999m" -> "3h 56m"
    let out = String(v);

    // Replace decimal minutes like "21.7833 min" or "21.7833m" with rounded integer minutes
    out = out.replace(/(\d+\.\d+)\s*(m|min)\b/g, (_match, num) => {
      const n = Math.round(Number(num));
      return `${n} min`;
    });

    // Replace occurrences inside hour+minute strings: "3h 55.9499m" -> "3h 56m"
    out = out.replace(/(\d+h)\s+(\d+\.\d+)\s*m\b/g, (_match, hours, num) => {
      const n = Math.round(Number(num));
      return `${hours} ${n}m`;
    });

    // Normalize short 'm' to 'min' for consistency: '15 m' -> '15 min'
    out = out.replace(/\b(\d+)\s*m\b/g, '$1 min');

    // Collapse multiple spaces and trim
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  } catch {
    return v;
  }
}

function formatDateOnly(d: Date) {
  // Format as YYYY-MM-DD to align with web example like '2025-08-20'
  try {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}

function capitalize(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettyStatus(s?: string, cardType?: string) {
  if (!s) return 'posted';
  const key = String(s).toLowerCase();
  // Show appropriate message for intermediate completion statuses
  if (key === 'driver_completed') {
    return 'In Progress';
  }
  if (key === 'rider_completed') {
    return 'Completed';
  }
  // Special-case: confirmed ride with pending (1/2 seats)
  if ((cardType === 'confirmedRide' || cardType === 'confirmedride') && key === 'pending') {
    return 'Waiting for 1 more passenger';
  }
  const map: Record<string, string> = {
    posted: 'Posted',
    pending: 'Posted',
    open: 'Posted',
    matched: 'Matched',
    'driver-arriving': 'Driver Arriving',
    'in-progress': 'In Progress',
    'in_progress': 'In Progress',
    confirmed: 'Confirmed',
    accepted: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    'ride requested': 'Ride Requested',
  };
  return map[key] ?? capitalize(key);
}

function toDateField(v: any): Date | null {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (v instanceof Timestamp) return v.toDate();
    if (typeof v === 'number') {
      // Assume millis
      return new Date(v);
    }
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

function parseCurrency(v: any): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const num = Number(v.replace(/[^0-9.\-]/g, ''));
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

function deepClean<T = any>(obj: T): T {
  if (obj === null || obj === undefined) return obj as any;
  if (Array.isArray(obj)) return obj.map((v) => deepClean(v)) as any;
  if (obj instanceof Date || obj instanceof Timestamp) return obj as any;
  // Only recurse into plain objects so Firestore sentinels (e.g., serverTimestamp()) and other special objects pass through
  const isPlain = Object.prototype.toString.call(obj) === '[object Object]';
  if (isPlain) {
    const out: any = {};
    Object.entries(obj as any).forEach(([k, v]) => {
      if (v === undefined) {
        // Drop undefined by converting to null (valid Firestore value) or skip? Use null for explicitness
        out[k] = null;
      } else if (Array.isArray(v)) {
        out[k] = v.map((item) => (item === undefined ? null : deepClean(item)));
      } else if (v instanceof Date || v instanceof Timestamp) {
        out[k] = v;
      } else if (Object.prototype.toString.call(v) === '[object Object]') {
        out[k] = deepClean(v);
      } else {
        // Non-plain objects (including Firestore FieldValue sentinels) left as-is
        out[k] = v as any;
      }
    });
    return out;
  }
  return obj as any;
}

function mergeUpcoming(prev: UpcomingRideCard[], incoming: UpcomingRideCard[]) {
  const map = new Map<string, UpcomingRideCard>();

  const logicalKey = (it: UpcomingRideCard) => {
    // Local logical key computation (do not call in-component uLogicalKey which is out of scope here)
    if (it.type === 'confirmedRide') {
      const rrid = it.rideRequestId ?? (typeof it.id === 'string' ? it.id : undefined);
      return rrid ? `rr_${rrid}` : `cr_${it.id}`;
    }
    if (it.type === 'rideRequest') return `rr_${it.id}`;
    if (it.type === 'ridePostingRequest') return `rpr_${it.id}`;
    return `${it.type}_${it.id}`;
  };

  const statusRank = (s: string) => {
    const key = (s || '').toLowerCase();
    if (key === 'flagged') return 4;
    if (key === 'in-progress' || key === 'in_progress') return 3;
    if (key === 'confirmed' || key === 'accepted' || key === 'matched') return 2;
    return 1;
  };

  const consider = (it: UpcomingRideCard) => {
    const k = logicalKey(it);
    try { console.debug('mergeUpcoming: considering key', k, 'type', it.type, 'status', it.status); } catch {}
    const exist = map.get(k);
    if (!exist) {
      map.set(k, it);
      return;
    }
    // Prefer confirmedRide type over rideRequest/posting; and prefer higher status
    const typeRank = (x: UpcomingRideCard) => (x.type === 'confirmedRide' ? 2 : (x.type === 'rideRequest' ? 1 : 0));
    if (typeRank(it) > typeRank(exist)) {
      map.set(k, it);
      return;
    }
    if (typeRank(it) === typeRank(exist) && statusRank(it.status) >= statusRank(exist.status)) {
      map.set(k, it);
    }
  };

  [...prev, ...incoming].forEach(consider);
  try { console.debug('mergeUpcoming: final keys', Array.from(map.keys())); } catch {}

  return [...map.values()].sort((a, b) => {
    const at = a.dateTime ? a.dateTime.getTime() : 0;
    const bt = b.dateTime ? b.dateTime.getTime() : 0;
    return at - bt;
  });
}

function normalizeStatusForDisplay(s?: string) {
  const key = (s || '').toLowerCase();
  if (key === 'pending' || key === 'open' || key === '') return 'posted';
  return key;
}

function getFirstNameFromProfile(data: any | undefined): string | undefined {
  if (!data) return undefined;
  const direct = data.firstName || data.firstname || data.givenName || data.given_name;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const name = data.name || data.fullName || data.full_name;
  if (typeof name === 'string' && name.trim()) return name.trim().split(' ')[0];
  return undefined;
}

function getNameFromProfile(data: any | undefined): string | undefined {
  if (!data) return undefined;
  const full = data.name || data.fullName || data.full_name || data.displayName || data.driverName || data.ownerName;
  if (typeof full === 'string' && full.trim()) return full.trim();
  const first = data.firstName || data.firstname || data.givenName || data.given_name || data.personalInfo?.firstName;
  const last = data.lastName || data.lastname || data.familyName || data.family_name || data.personalInfo?.lastName;
  if (first && last) return `${first} ${last}`.trim();
  if (first) return String(first);
  return undefined;
}

// ...existing code...

function sanitizeAvatar(v: any): string | undefined | null {
  if (!v || typeof v !== 'string') return undefined;
  const val = v.trim();
  if (!val) return undefined;
  // Allow http(s) or data URIs directly; gs:// or relative will be resolved later
  if (/^(https?:\/\/|data:)/i.test(val)) return val;
  return val; // return raw for potential getDownloadURL resolution
}

function isGenericName(v: any): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'driver' || s === 'owner' || s === 'user' || s === 'provider';
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Match header background
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Match header background
  },
  contentCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 16,
    paddingTop: 0,
  },

  // Clean Header Styles
  cleanHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
  },
  staticHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 5,
    zIndex: 1000,
  },
  staticHeaderScrolled: {
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 0,
    elevation: 2,
  },
  whereToContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  userIcon: {
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  profileImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  greetingSection: {
    flex: 1,
  },
  greetingText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
  },
  userNameText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E293B',
  },
  cleanNotificationButton: {
    backgroundColor: '#e8e8e8ff',
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  cleanNotificationBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#EF4444',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cleanNotificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  whereToButton: {
    backgroundColor: '#E05E1A',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  whereToTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  whereToTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  whereToSubtitle: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  whereToArrow: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  whereToArrowText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },

  // Section Styles
  section: {
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
  },
  viewAllText: {
    fontSize: 14,
    color: '#E05E1A',
    fontWeight: '600',
  },

  // Empty State
  emptyState: {
    padding: 20,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    color: '#64748B',
  },

  // Ride Card Styles
  rideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#94A3B820',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  rideCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rideStatusBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rideStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
  },
  rideTime: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  ridePrice: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E05E1A',
  },
  rideDuration: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 12,
  },
  rideLocations: {
    gap: 8,
  },
  rideLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 12,
  },
  locationDotGray: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
    marginRight: 12,
  },
  rideLocationText: {
    fontSize: 14,
    color: '#64748B',
  },

  // Activity Stats
  activityStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    marginTop: 16,
  },
  activityStatCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  activityStatCardRides: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  activityStatCardSaved: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  activityStatCardRating: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  activityStatNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  activityStatNumberGreen: {
    fontSize: 24,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 4,
  },
  activityStatNumberOrange: {
    fontSize: 24,
    fontWeight: '700',
    color: '#E05E1A',
    marginBottom: 4,
  },
  activityStatLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },

  // Feature Cards
  featureCards: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  featureCard: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
  },
  featureCardIcon: {
    backgroundColor: '#DBEAFE',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  featureCardIconOrange: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  featureCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },

  // Quick Actions
  quickActionsGrid: {
    gap: 12,
    marginTop: 16,
  },
  quickActionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  quickActionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E293B',
    flex: 1,
    marginLeft: 12,
  },
  quickActionArrow: {
    fontSize: 16,
    color: '#64748B',
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 35,
  },
  // Welcome Card
  welcomeCard: {
    backgroundColor: '#E05E1A',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: 30,
    paddingBottom: 35,
  },
  welcomeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  textContainer: {
    flex: 1,
    paddingRight: 16, // More space for the button
  },
  welcomeTitle: {  
    fontSize: 40,
    fontWeight: 'bold',
    color: '#FFFFFF',
    lineHeight: 45,
  },
  welcomeSubtitle: {
    fontSize: 18,
    color: '#FFFFFF',
    marginTop: 8,
    opacity: 0.9,
  },
  notificationButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 0,
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    position: 'absolute',
    right: 0,
    top: -10,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  notificationIcon: {},
  notificationBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#FFFFFF',
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
  },
  notificationBadgeText: {
    color: '#E05E1A',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 12,
    textAlign: 'center',
  },
  // Stats
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    marginTop: 20,
    gap: 12,
  },
  statBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    minWidth: 80,
    alignItems: 'center',
    flex: 1,
    maxWidth: 120,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 2,
  },
  statNumberGreen: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#10B981',
    marginBottom: 2,
  },
  statNumberOrange: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F59E0B',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 14,
  },
  // Carousel
  carouselContainer: {
    marginBottom: 24,
  },
  // Highlights
  highlightsSection: {
    marginBottom: 24,
  },
  heroCard: {
    backgroundColor: '#1A2942',
    borderColor: '#1A2942',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  heroLeft: {
    flex: 1,
    paddingRight: 12,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 18,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  gridCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    marginBottom: 12,
  },
  gridPromo: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  gridReferral: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E5E7EB',
  },
  // pruned unused grid variants
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  gridTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 6,
  },
  gridText: {
    fontSize: 13,
    color: '#E5E7EB',
  },
  gridPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  gridPillText: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 1,
  },
  // pruned gridBtnLight styles
  gridBtnDark: {
    backgroundColor: '#0B1220',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  gridBtnDarkText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  // pruned poll option styles
  slideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
  padding: 14,
  marginRight: 0,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  slideImpact: {
    backgroundColor: '#1A2942',
    borderColor: '#1A2942',
  },
  slideReferral: {
    backgroundColor: '#0B1220',
    borderColor: '#0B1220',
  },
  slidePromo: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
    overflow: 'hidden',
  paddingVertical: 12,
  },
  slideSpotlight: {
    backgroundColor: '#F8FAFC',
    borderColor: '#F1F5F9',
  },
  slideHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  slideIconCircle: {
  width: 32,
  height: 32,
  borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
  fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    flexShrink: 1,
    flex: 1,
  },
  slideText: {
  fontSize: 13,
    color: '#E5E7EB',
  },
  promoDecorCircle: {
    position: 'absolute',
    right: -30,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  promoDecorCircle2: {
    position: 'absolute',
    right: -10,
    top: 40,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  slideActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  pollOption: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  pollOptionSelected: {
    backgroundColor: '#DBEAFE',
  },
  pollOptionText: { color: '#111827', fontWeight: '600' },
  pollOptionTextSelected: { color: '#1D4ED8' },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 10,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
  },
  dotActive: {
    backgroundColor: '#E05E1A',
  },
  referralButton: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  promoCodePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  promoCodePillDark: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  promoCodeText: { color: '#9A3412', fontWeight: '700' },
  promoCodeTextDark: { color: '#FFFFFF', fontWeight: '700', letterSpacing: 1 },
  promoCtaButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  promoCtaText: { color: '#4F46E5', fontWeight: '800' },
  spotlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  spotlightAvatar: {
  width: 36,
  height: 36,
  borderRadius: 18,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Upcoming Rides
  upcomingSection: {
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },


  // Empty state for Upcoming Rides
  emptyUpcoming: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginVertical: 8,
  },
  emptyUpcomingText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },

  rideHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
  gap: 8,
  },
  statusBadge: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgePending: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgePosted: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeOffer: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  // New: distinct styles for Offer Received vs Offer Sent
  statusBadgeOfferReceived: {
    backgroundColor: '#FEF3C7', // warm amber for received
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeOfferSent: {
    backgroundColor: '#DBEAFE', // cool blue for sent
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeFlagged: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F87171',
  },
  statusText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '500',
  },
  statusTextPending: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
  statusTextPosted: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  statusTextOffer: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
  },
  statusTextOfferReceived: {
    fontSize: 12,
    color: '#92400E', // amber/dark text
    fontWeight: '600',
  },
  statusTextOfferSent: {
    fontSize: 12,
    color: '#1D4ED8', // blue/dark text
    fontWeight: '600',
  },
  statusTextFlagged: {
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '700',
  },
  rideDate: {
  fontSize: 12,
  color: '#6B7280',
  flexShrink: 1,
  textAlign: 'right',
  },
  rideRoute: {
    marginBottom: 12,
  },
  routePoint: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  marginBottom: 8,
  },
  orangeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E05E1A',
    marginRight: 12,
  },
  grayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#9CA3AF',
    marginRight: 12,
  },
  routeText: {
  fontSize: 14,
  color: '#1F2937',
  fontWeight: '500',
  flex: 1,
  flexShrink: 1,
  flexWrap: 'wrap',
  },
  routeTextGray: {
  fontSize: 14,
  color: '#6B7280',
  flex: 1,
  flexShrink: 1,
  flexWrap: 'wrap',
  },
  rideFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  viewDetailsText: {
    fontSize: 12,
    color: '#E05E1A',
    fontWeight: '500',
  },
  offerActionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    maxWidth: '100%',
  },
  acceptBtn: {
    backgroundColor: '#0B1220',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  acceptBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  rejectBtn: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  rejectBtnText: {
    color: '#111827',
    fontWeight: '600',
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: '#0B1220',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallPrimaryBtn: {
    backgroundColor: '#0B1220',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  rateBtn: {
    backgroundColor: '#0B1220',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  rateBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 12 },
  flagBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7F6',
    marginRight: 0,
  },
  flagIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7F0',
    marginRight: 0,
  },
  chatIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
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
    justifyContent: 'center',
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 0,
    marginTop: 16,
  },
  driverVehicle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 0,
  },
  driverPhone: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 2,
    marginTop: 10,
    paddingTop: 10,
  },
  ratingModalContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingModalText: {
    fontSize: 13,
    color: '#64748B',
    marginLeft: 6,
    lineHeight: 16,
  },
  driverCallBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },

  // Promotion Styles
  promotionsScroll: {
    marginTop: 8,
  },
  promotionsScrollContainer: {
    paddingLeft: 0,
    paddingRight: 0,
  },
  promotionIndicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 16,
  },
  promotionIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 4,
  },
  promotionIndicatorActive: {
    backgroundColor: '#E05E1A',
    width: 24,
  },


  promotionArrowText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  secondaryPromotionArrowText: {
    fontSize: 18,
    color: '#10B981',
    fontWeight: '600',
  },
  // New promotion styles
  retryText: {
    fontSize: 14,
    color: '#E05E1A',
    fontWeight: '600',
  },
  promotionsLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#666',
  },
  emptyPromotions: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  emptyPromotionsText: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#E05E1A',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  ridePrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B1220',
  },
  rideTime: {
    fontSize: 12,
    color: '#6B7280',
  },
  rideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    overflow: 'hidden',
  },
});
