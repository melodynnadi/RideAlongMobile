import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, ScrollView, FlatList, StyleSheet, Text, TouchableOpacity, Modal, ActivityIndicator, Alert, Image, Pressable, Share, Linking, Dimensions, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, MapPin, Clock, User, Star, DollarSign, Bell, Leaf, Gift, Megaphone, Share2, Music, Thermometer, MessageCircle, Cigarette, Heart, Flag, Phone, Check, Hourglass } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import { firestore, firebaseAuth, storage, getApiBaseUrl } from '@/constants/services';
import { theme } from '@/theme';
import { listenDriverCompletedRides, ConfirmedRide } from '@/src/services/ridesData';
import { confirmPickup as actionConfirmPickup, completeRide as actionCompleteRide, cancelRide as actionCancelRide, flagRide, groupPickup, groupComplete, groupFlag } from '@/src/services/rideActions';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import DriverRatingModal from '@/components/DriverRatingModal';
import FlagRideModal from '@/components/FlagRideModal';
import { Button } from '@/components/ui/Button';
import { submitRating } from '@/src/services/functions';
import { computeFilteredAverageRating } from '@/src/services/ratings';
import { PromotionCard } from '@/components/PromotionCard';
import { PromotionDetailsModal } from '@/components/PromotionDetailsModal';
import { usePromotions } from '@/hooks/usePromotions';
import { Promotion } from '@/types';
import { StudentVerificationBanner } from '@/components/StudentVerificationBanner';
import { useVerificationStore } from '@/stores/verificationStore';
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
  orderBy,
  limit as fsLimit,
  updateDoc,
  setDoc,
  addDoc,
  serverTimestamp,
  documentId,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

type UpcomingRideCard = {
  id: string;
  type: 'ride' | 'rideRequest' | 'ridePostingRequest' | 'ridePosting';
  status: string;
  from?: string;
  to?: string;
  dateTime: Date | null; // pickup or requested time
  dateStr?: string; // YYYY-MM-DD from confirmedRides when available
  // Confirmed rides metadata for actions
  confirmedId?: string;
  confirmedStatus?: string; // e.g., CONFIRMED | IN_PROGRESS
  riderId?: string; // only when available
  confirmedDriverComplete?: boolean; // persist waiting-for-rider flag
  confirmedDriverPickup?: boolean; // persist waiting-for-rider (pickup)
  etaText?: string;
  durationText?: string;
  priceText?: string;
  distanceText?: string;
  // Posting fields
  seatCount?: number;
  // Driver fields when available (for confirmed rides)
  driverName?: string;
  driverRating?: number | null;
  vehicleText?: string;
  driverPhone?: string | null;
  // Rider fields when available (for offer sent cards)
  riderName?: string;
  riderAvatarUrl?: string | null;
  riderRating?: number | null;
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

export default function HomeScreen() {
  const [selectedRide, setSelectedRide] = useState<UpcomingRideCard | null>(null);
  // Enriched passengers (avatars + phones) for group ride modal
  const [modalPassengers, setModalPassengers] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalRider, setModalRider] = useState<{
    name?: string;
    rating?: number | null;
    phone?: string | null;
    avatarUrl?: string | null;
    vehicleText?: string;
    preferences?: any;
  } | null>(null);
  // Inline rider profile panel toggle
  const [showRiderProfile, setShowRiderProfile] = useState(false);

  const [upcoming, setUpcoming] = useState<UpcomingRideCard[]>([]);
  const [recentConfirmed, setRecentConfirmed] = useState<ConfirmedRide[]>([]);
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingModalRide, setRatingModalRide] = useState<ConfirmedRide | null>(null);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flaggingRideRef, setFlaggingRideRef] = useState<any | null>(null);
  const [flaggingLoading, setFlaggingLoading] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [rideActionLoading, setRideActionLoading] = useState<Record<string, boolean>>({});
  const [waitingAfterComplete, setWaitingAfterComplete] = useState<Record<string, boolean>>({});
  const [waitingAfterPickup, setWaitingAfterPickup] = useState<Record<string, boolean>>({});
  const [waitingGroupAfterComplete, setWaitingGroupAfterComplete] = useState<Record<string, boolean>>({});
  // Maintain per-source maps so deletions are reflected (no stale cards)
  const [upcReqDriver, setUpcReqDriver] = useState<Record<string, UpcomingRideCard>>({});
  const [upcReqUserId, setUpcReqUserId] = useState<Record<string, UpcomingRideCard>>({});
  const [upcReqEmail, setUpcReqEmail] = useState<Record<string, UpcomingRideCard>>({});
  const [upcReqEmailAlt, setUpcReqEmailAlt] = useState<Record<string, UpcomingRideCard>>({});
  const [upcPostingReqDriver, setUpcPostingReqDriver] = useState<Record<string, UpcomingRideCard>>({});
  const [upcPostingReqEmail, setUpcPostingReqEmail] = useState<Record<string, UpcomingRideCard>>({});
  // Additional owner-based sources for posting requests
  const [upcPostingReqOwner, setUpcPostingReqOwner] = useState<Record<string, UpcomingRideCard>>({});
  const [upcPostingReqOwnerEmail, setUpcPostingReqOwnerEmail] = useState<Record<string, UpcomingRideCard>>({});
  const [upcPostingsDriver, setUpcPostingsDriver] = useState<Record<string, UpcomingRideCard>>({});
  const [upcPostingsEmail, setUpcPostingsEmail] = useState<Record<string, UpcomingRideCard>>({});
  // Offers I've sent (against rider requests) should show as Offer Sent
  const [upcOffersSent, setUpcOffersSent] = useState<Record<string, UpcomingRideCard>>({});
  // Confirmed rides (source of truth) to guarantee visibility even if rideRequests doesn't assign driverId
  const [upcConfirmed, setUpcConfirmed] = useState<Record<string, UpcomingRideCard>>({});
  const [confirmedCountByPostingId, setConfirmedCountByPostingId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [userPhoto, setUserPhoto] = useState<string | null>(null);
  const [driverAvatarUrl, setDriverAvatarUrl] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalRides: 0, totalEarnings: 0, avgRating: null as number | null, ratingCount: null as number | null });
  const [offersByRideId, setOffersByRideId] = useState<Record<string, OfferInfo>>({});
  // Map postingId -> pending request info (to flip posting card to Offer Received)
  const [postingReqByPostingId, setPostingReqByPostingId] = useState<Record<string, { id: string; status: string }>>({});
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const notifReadMapRef = useRef<Record<string, boolean>>({});
  const [confirmedByReqId, setConfirmedByReqId] = useState<Record<string, boolean>>({});
  const [confirmedByPostingId, setConfirmedByPostingId] = useState<Record<string, boolean>>({});
  const [ratedByMe, setRatedByMe] = useState<Record<string, boolean>>({});
  const [currentPromotionIndex, setCurrentPromotionIndex] = useState(0);
  const promotionScrollRef = useRef<ScrollView | null>(null);
  // Queue ratings per rider (seat) so group rides are rated individually
  const [ratingQueue, setRatingQueue] = useState<Array<{ rideId: string; riderName?: string }>>([]);
  const [ratingIdx, setRatingIdx] = useState<number>(0);

  // Student verification state (shared via store so profile tab stays in sync)
  const { isVerified, verificationStatus, verificationDeadline } = useVerificationStore();
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  const [showVerificationSuccess, setShowVerificationSuccess] = useState<boolean>(false);

  // Promotions state
  const { promotions, loading: promotionsLoading } = usePromotions();
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [promotionModalVisible, setPromotionModalVisible] = useState(false);
  // Guard to auto-capture payments once per posting when all riders are completed
  const captureSentRef = useRef<Record<string, boolean>>({});

  const uid = firebaseAuth.currentUser?.uid ?? null;
  const email = firebaseAuth.currentUser?.email ?? null;

  // Check if the current driver has already rated this ride
  async function hasUserRated(rideId: string, userId: string): Promise<boolean> {
    try {
      const d = await getDoc(doc(firestore, 'rideRatings', `${rideId}_${userId}`));
      return d.exists();
    } catch {
      return false;
    }
  }

  // Preload ratedByMe flags for recent rides (limit to 10 to reduce reads)
  async function hydrateRatedByMe(userId: string, rides: ConfirmedRide[], set: React.Dispatch<React.SetStateAction<Record<string, boolean>>>) {
    try {
      const recent = [...rides].slice(0, 10);
      const results = await Promise.all(recent.map((r) => hasUserRated(r.id, userId)));
      const next: Record<string, boolean> = {};
      recent.forEach((r, i) => { next[r.id] = results[i]; });
      set((prev) => ({ ...prev, ...next }));
    } catch {}
  }

  // Refresh driver rating stat card reading aggregates from drivers/{uid}
  async function refreshDriverRatingStatCard(userId: string, set: React.Dispatch<React.SetStateAction<{ totalRides: number; totalEarnings: number; avgRating: number | null; ratingCount: number | null }>>) {
    try {
      const { avg, count } = await computeFilteredAverageRating(userId);
      set((s) => ({ ...s, avgRating: typeof avg === 'number' && isFinite(avg) ? avg : s.avgRating, ratingCount: count ?? s.ratingCount }));
    } catch {}
  }

  // average rating helper moved to src/services/ratings

  // Show the rating modal for a specific confirmed ride after re-checking not already rated
  async function showDriverRatingModal(ride: ConfirmedRide) {
    if (!uid) return;
    // Avoid duplicate prompts for already rated
    const rated = await hasUserRated(ride.id, uid);
    if (rated) {
      setRatedByMe((prev) => ({ ...prev, [ride.id]: true }));
      return;
    }
    setRatingModalRide(ride);
    setRatingError(null);
    setRatingModalVisible(true);
  }

  // Open rating modal for a grouped card: build a per-seat queue and prompt sequentially
  async function showRatingForGroup(group: any) {
    if (!uid) return;
    console.log('showRatingForGroup called with group:', { 
      id: group?.id, 
      riderName: group?.riderName, 
      hasChildren: Array.isArray(group?._groupChildren),
      childrenCount: group?._groupChildren?.length,
      children: group?._groupChildren 
    });
    
    const children: Array<{ rideId: string; riderName?: string }> = Array.isArray(group?._groupChildren)
      ? (group._groupChildren as any[]).map((c) => {
          console.log('Mapping child:', { id: c.id, riderName: c.riderName });
          return { rideId: String(c.id), riderName: c.riderName };
        })
      : [{ rideId: String(group?.id), riderName: (group as any)?.riderName }];
    
    console.log('Built children array:', children);
    
    // Filter out already-rated seats
    const checks = await Promise.all(children.map((c) => hasUserRated(c.rideId, uid)));
    const pending = children.filter((c, i) => !checks[i]);
    
    console.log('Pending ratings:', pending);
    
    if (pending.length === 0) {
      // Nothing to rate; mark this logical group as rated
      if (group?.id) setRatedByMe((prev) => ({ ...prev, [String(group.id)]: true }));
      Alert.alert('All set', 'You have already rated these riders.');
      return;
    }
    setRatingQueue(pending);
    setRatingIdx(0);
    setRatingModalRide(null); // Don't use group object with combined names
    setRatingError(null);
    setRatingModalVisible(true);
  }

  // Find the most recent COMPLETED, unrated ride and open modal
  async function promptPendingRatingForDriver(userId: string, rides: ConfirmedRide[]) {
    try {
      if (!rides || rides.length === 0) return;
      if (ratingModalVisible) return; // do not stack
      // Sort by completedAt desc
      const sorted = [...rides].sort((a, b) => {
  const ad = toDateField((a as any)?.completedAt) || getDateFromConfirmed(a) || null;
  const bd = toDateField((b as any)?.completedAt) || getDateFromConfirmed(b) || null;
  const at = ad ? ad.getTime() : 0;
  const bt = bd ? bd.getTime() : 0;
        return bt - at;
      });
      for (const r of sorted) {
        if (String(r.status || '').toUpperCase() !== 'COMPLETED') continue;
        if (String(r.driverId) !== String(userId)) continue;
        // Skip if we already know it's rated
        if (ratedByMe[r.id]) continue;
        
        // Check if this is a grouped ride
        if ((r as any)?._groupChildren && Array.isArray((r as any)._groupChildren)) {
          // Use showRatingForGroup for group rides to handle individual ratings
          showRatingForGroup(r);
          break;
        }
        
        const rated = await hasUserRated(r.id, userId);
        if (!rated) {
          setRatingModalRide(r);
          setRatingError(null);
          setRatingModalVisible(true);
          break;
        } else {
          setRatedByMe((prev) => ({ ...prev, [r.id]: true }));
        }
      }
    } catch {}
  }

  // Open chat for a specific ride card
  const openChatForRide = async (card: UpcomingRideCard) => {
    // Find existing chat based on confirmedId (rideId in chats collection)
    const confirmedId = card.confirmedId || card.id;
    if (!confirmedId || !uid) return;
    
    try {
      const chatsRef = collection(firestore, 'chats');
      const q = query(chatsRef, where('rideId', '==', confirmedId));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        // Navigate to existing chat
        const chatId = snapshot.docs[0].id;
        router.push(`/messages/${chatId}`);
      } else {
        // Navigate to messages tab - chat will be auto-created when first message is sent
        router.push('/driver/messages');
      }
    } catch (error) {
      console.error('Error finding chat:', error);
      router.push('/driver/messages');
    }
  };

  // Combine all per-source maps and set the unified, sorted list
  const setCombinedUpcoming = (overrides?: Partial<{
    offersSent: Record<string, UpcomingRideCard>;
    confirmed: Record<string, UpcomingRideCard>;
    reqDriver: Record<string, UpcomingRideCard>;
    reqUserId: Record<string, UpcomingRideCard>;
    reqEmail: Record<string, UpcomingRideCard>;
    reqEmailAlt: Record<string, UpcomingRideCard>;
    postingReqDriver: Record<string, UpcomingRideCard>;
    postingReqEmail: Record<string, UpcomingRideCard>;
    postingReqOwner: Record<string, UpcomingRideCard>;
    postingReqOwnerEmail: Record<string, UpcomingRideCard>;
    postingsDriver: Record<string, UpcomingRideCard>;
    postingsEmail: Record<string, UpcomingRideCard>;
  }>) => {
    const maps = {
      offersSent: upcOffersSent,
  confirmed: upcConfirmed,
      reqDriver: upcReqDriver,
      reqUserId: upcReqUserId,
      reqEmail: upcReqEmail,
      reqEmailAlt: upcReqEmailAlt,
      postingReqDriver: upcPostingReqDriver,
      postingReqEmail: upcPostingReqEmail,
      postingReqOwner: upcPostingReqOwner,
      postingReqOwnerEmail: upcPostingReqOwnerEmail,
      postingsDriver: upcPostingsDriver,
      postingsEmail: upcPostingsEmail,
      ...(overrides || {}),
    };
    const arr: UpcomingRideCard[] = [
      // Place offersSent first so that if the ride later becomes assigned/confirmed,
      // the assigned card (below) will override the Offer Sent placeholder.
      ...Object.values(maps.offersSent || {}),
      ...Object.values(maps.reqDriver || {}),
      ...Object.values(maps.reqUserId || {}),
      ...Object.values(maps.reqEmail || {}),
      ...Object.values(maps.reqEmailAlt || {}),
      // Do not add posting request cards directly to Upcoming; instead,
      // we reflect them on the driver's posting card via postingReqByPostingId
      // ...Object.values(maps.postingReqDriver || {}),
      // ...Object.values(maps.postingReqEmail || {}),
      // ...Object.values(maps.postingReqOwner || {}),
      // ...Object.values(maps.postingReqOwnerEmail || {}),
      ...Object.values(maps.postingsDriver || {}),
      ...Object.values(maps.postingsEmail || {}),
      // Confirmed last so it overrides any previous placeholders
      ...Object.values(maps.confirmed || {}),
    ];
    // Dedupe by (type-id)
    const uniq = new Map<string, UpcomingRideCard>();
    for (const it of arr) uniq.set(`${it.type}-${it.id}`, it);
    setUpcoming(sortByDate([...uniq.values()]));
  };

  useEffect(() => {
  if (!uid) {
  setUpcOffersSent({});
  setUpcConfirmed({});
      setUpcReqDriver({});
      setUpcReqUserId({});
      setUpcReqEmail({});
      setUpcReqEmailAlt({});
      setUpcPostingReqDriver({});
      setUpcPostingReqEmail({});
      setUpcPostingsDriver({});
      setUpcPostingsEmail({});
  setUpcoming([]);
  setRecentConfirmed([]);
      setLoading(false);
      return;
    }

  setLoading(true);
  // Reset notifications accumulator
  notifReadMapRef.current = {};
  setUnreadCount(0);
    const unsubs: Array<() => void> = [];

    // Listen to user document for student verification status changes
    const userDocRef = doc(firestore, 'drivers', uid);
    const unsubUser = onSnapshot(userDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        const rawIsVerified = data?.isVerified === true;
        const vs_status = data?.verificationStatus || null;
        const verified = rawIsVerified || vs_status === 'approved' || vs_status === 'auto-approved';
        const prevVerified = useVerificationStore.getState().isVerified;
        const vs = useVerificationStore.getState();

        vs.setIsVerified(verified);
        vs.setVerificationStatus(data?.verificationStatus || null);

        // Parse deadline
        const deadlineField = data?.verificationDeadline;
        if (deadlineField) {
          const deadlineDate = typeof deadlineField?.toDate === 'function' 
            ? deadlineField.toDate() 
            : new Date(deadlineField);
          vs.setVerificationDeadline(deadlineDate);
        } else {
          vs.setVerificationDeadline(null);
        }
        
        // Show success toast when verification becomes true
        if (!prevVerified && verified && !showVerificationSuccess) {
          setShowVerificationSuccess(true);
          setTimeout(() => {
            Alert.alert('✓ Verified!', 'Your student status has been verified! You can now post rides.');
            setShowVerificationSuccess(false);
          }, 500);
        }
      }
    }, (err) => {
      console.warn('User verification listener error', err);
    });
    unsubs.push(unsubUser);

    // Fetch verification status from API on launch
    (async () => {
      try {
        const token = await firebaseAuth.currentUser?.getIdToken();
        if (token) {
          const apiUrl = getApiBaseUrl();
          const res = await fetch(`${apiUrl}/api/student-verifications/status`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const json = await res.json();
            const vs = useVerificationStore.getState();
            if (typeof json?.isVerified === 'boolean') {
              vs.setIsVerified(json.isVerified);
            }
            if (json?.verificationStatus) {
              vs.setVerificationStatus(json.verificationStatus);
            }
            if (json?.deadline) {
              vs.setVerificationDeadline(new Date(json.deadline));
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch verification status', e);
      }
    })();

    // Fetch profile for name and rating
    (async () => {
      try {
        const userDoc = await getDoc(doc(firestore, 'drivers', uid));
        const data = userDoc.exists() ? (userDoc.data() as any) : null;
        const rating = typeof data?.rating === 'number' ? (data.rating as number) : null;
        // Try multiple keys for first name, then auth displayName, then email prefix
        let firstName: string | undefined = getFirstNameFromProfile(data);
        let profilePhoto: string | undefined;
        
        // Get profile photo from Firestore user document
        if (data) {
          profilePhoto = data.avatarUrl || data.photoURL || data.photoUrl;
        }
        if (!firstName && email) {
          // Fallback: query by email if doc id != uid
          const q = query(collection(firestore, 'drivers'), where('email', '==', email), fsLimit(1));
          const snap = await getDocs(q);
          const docData = snap.docs[0]?.data();
          firstName = getFirstNameFromProfile(docData);
          
          // Also try to get profile photo from email query result
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
          if (authPhotoURL) {
            profilePhoto = authPhotoURL;
          }
        }
        
        // Set the profile photo state
        if (profilePhoto && typeof profilePhoto === 'string') {
          setUserPhoto(profilePhoto);
        } else {
          setUserPhoto(null);
        }
        
        // Also fetch from drivers collection for driver-specific avatar
        try {
          const driverDoc = await getDoc(doc(firestore, 'drivers', uid));
          if (driverDoc.exists()) {
            const driverData = driverDoc.data() as any;
            const pi = driverData?.personalInfo || driverData?.profile || {};
            const drvAvatar = driverData?.avatarUrl || pi?.avatarUrl || null;
            setDriverAvatarUrl(typeof drvAvatar === 'string' && drvAvatar ? drvAvatar : null);
          } else {
            setDriverAvatarUrl(null);
          }
        } catch {
          setDriverAvatarUrl(null);
        }
        
        setUserName(firstName ?? (email ? firstNameFromEmail(email) : null));
        // Seed with users.rating if present
  if (typeof rating === 'number') setStats((s) => ({ ...s, avgRating: rating }));
        // Compute filtered average from rideRatings joined to COMPLETED confirmedRides
        try {
          const { avg, count } = await computeFilteredAverageRating(uid!);
          if (typeof avg === 'number' && isFinite(avg)) {
            setStats((s) => ({ ...s, avgRating: avg, ratingCount: count }));
          }
        } catch {}
      } catch {
        setUserName(email ? firstNameFromEmail(email) : null);
      }
    })();

  // Ride requests by this driver (driverId)
    const reqQ = query(
      collection(firestore, 'rideRequests'),
  where('driverId', '==', uid)
    );
    const unsubReq = onSnapshot(reqQ, (snap) => {
      const items: UpcomingRideCard[] = [];
      snap.forEach((d) => {
        const r = d.data() as any;
        const requestedTime: Date | null = getRideDateTime(r);
  const from = extractAddress(r, 'pickup');
  const to = extractAddress(r, 'dropoff');
  // Prefer rider-entered contribution fields over estimated fare
  const price = (
    (typeof r?.contributionAmount === 'number' ? r.contributionAmount : parseCurrency(r?.contributionAmount))
    ?? (typeof r?.contribution === 'number' ? r.contribution : parseCurrency(r?.contribution))
    ?? (typeof r?.requestedContribution === 'number' ? r.requestedContribution : parseCurrency(r?.requestedContribution))
    ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price))
    ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare))
  );
        items.push({
          id: d.id,
          type: 'rideRequest',
          status: normalizeStatusForDisplay(r?.status),
          from,
          to,
          dateTime: requestedTime,
          durationText: getDurationText(r),
          priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
          distanceText: extractDistance(r),
        });
      });
  const next: Record<string, UpcomingRideCard> = {};
  items.forEach((it) => { next[it.id] = it; });
  setUpcReqDriver(next);
  setCombinedUpcoming({ reqDriver: next });
    }, (err) => {
      console.warn('rideRequests listener error', err);
      setLoading(false);
    });
    unsubs.push(unsubReq);

    // Ride requests by userId (alternate field some backends use)
    const reqUserIdQ = query(
      collection(firestore, 'rideRequests'),
      where('userId', '==', uid)
    );
    const unsubReqUserId = onSnapshot(reqUserIdQ, (snap) => {
      const items: UpcomingRideCard[] = [];
      snap.forEach((d) => {
        const r = d.data() as any;
        const requestedTime: Date | null = getRideDateTime(r);
  const from = extractAddress(r, 'pickup');
  const to = extractAddress(r, 'dropoff');
        // Prefer rider-entered contribution fields over estimated fare
        const price = (
          (typeof r?.contributionAmount === 'number' ? r.contributionAmount : parseCurrency(r?.contributionAmount))
          ?? (typeof r?.contribution === 'number' ? r.contribution : parseCurrency(r?.contribution))
          ?? (typeof r?.requestedContribution === 'number' ? r.requestedContribution : parseCurrency(r?.requestedContribution))
          ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price))
          ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare))
        );
        items.push({
          id: d.id,
          type: 'rideRequest',
          status: normalizeStatusForDisplay(r?.status),
          from,
          to,
          dateTime: requestedTime,
          durationText: getDurationText(r),
          priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
          distanceText: extractDistance(r),
        });
      });
  const next: Record<string, UpcomingRideCard> = {};
  items.forEach((it) => { next[it.id] = it; });
  setUpcReqUserId(next);
  setCombinedUpcoming({ reqUserId: next });
    }, (err) => console.warn('rideRequests(userId) listener error', err));
    unsubs.push(unsubReqUserId);

  // Fallback: ride requests by email (web app might store driverEmail)
  if (email) {
      const reqEmailQ = query(
        collection(firestore, 'rideRequests'),
  where('driverEmail', '==', email)
      );
      const unsubReqEmail = onSnapshot(reqEmailQ, (snap) => {
        const items: UpcomingRideCard[] = [];
        snap.forEach((d) => {
          const r = d.data() as any;
          const requestedTime: Date | null = getRideDateTime(r);
          const from = extractAddress(r, 'pickup');
          const to = extractAddress(r, 'dropoff');
          // Prefer rider-entered contribution fields over estimated fare
          const price = (
            (typeof r?.contributionAmount === 'number' ? r.contributionAmount : parseCurrency(r?.contributionAmount))
            ?? (typeof r?.contribution === 'number' ? r.contribution : parseCurrency(r?.contribution))
            ?? (typeof r?.requestedContribution === 'number' ? r.requestedContribution : parseCurrency(r?.requestedContribution))
            ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price))
            ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare))
          );
          items.push({
            id: d.id,
            type: 'rideRequest',
            status: normalizeStatusForDisplay(r?.status),
            from,
            to,
            dateTime: requestedTime,
            durationText: getDurationText(r),
            priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
            distanceText: extractDistance(r),
          });
        });
  const next: Record<string, UpcomingRideCard> = {};
  items.forEach((it) => { next[it.id] = it; });
  setUpcReqEmail(next);
  setCombinedUpcoming({ reqEmail: next });
      }, (err) => {
        console.warn('rideRequests(email) listener error', err);
      });
      unsubs.push(unsubReqEmail);

      // Also check alternate field 'email'
      const reqEmailAltQ = query(
        collection(firestore, 'rideRequests'),
        where('email', '==', email)
      );
      const unsubReqEmailAlt = onSnapshot(reqEmailAltQ, (snap) => {
        const items: UpcomingRideCard[] = [];
        snap.forEach((d) => {
          const r = d.data() as any;
          const requestedTime: Date | null = getRideDateTime(r);
          const from = extractAddress(r, 'pickup');
          const to = extractAddress(r, 'dropoff');
          // Prefer rider-entered contribution fields over estimated fare
          const price = (
            (typeof r?.contributionAmount === 'number' ? r.contributionAmount : parseCurrency(r?.contributionAmount))
            ?? (typeof r?.contribution === 'number' ? r.contribution : parseCurrency(r?.contribution))
            ?? (typeof r?.requestedContribution === 'number' ? r.requestedContribution : parseCurrency(r?.requestedContribution))
            ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price))
            ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare))
          );
          items.push({
            id: d.id,
            type: 'rideRequest',
            status: normalizeStatusForDisplay(r?.status),
            from,
            to,
            dateTime: requestedTime,
            durationText: getDurationText(r),
            priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
            distanceText: extractDistance(r),
          });
        });
  const next: Record<string, UpcomingRideCard> = {};
  items.forEach((it) => { next[it.id] = it; });
  setUpcReqEmailAlt(next);
  setCombinedUpcoming({ reqEmailAlt: next });
      }, (err) => console.warn('rideRequests(email alt) listener error', err));
      unsubs.push(unsubReqEmailAlt);
    }

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

  // Driver-initiated requests against rider postings (Offer Sent)
    const rprQ = query(
      collection(firestore, 'ridePostingRequests'),
  where('driverId', '==', uid)
    );
    const unsubRpr = onSnapshot(rprQ, (snap) => {
      const items: UpcomingRideCard[] = [];
      const byPosting: Record<string, { id: string; status: string }> = {};
      snap.forEach((d) => {
        const r = d.data() as any;
        const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
  const from = extractAddress(r, 'pickup');
  const to = extractAddress(r, 'dropoff');
        const price = r?.contributionAmount ?? r?.price ?? r?.estimatedFare;
        const distance = r?.distance;
        const postingId = r.ridePostingId || r.ridePostId || r.postingId || r.posting?.id;
        if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
          byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
        }
        items.push({
          id: d.id,
          type: 'ridePostingRequest',
          status: String(r?.status || 'offer_sent'),
          from,
          to,
          dateTime: dt,
          durationText: getDurationText(r),
          priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
          distanceText: typeof distance === 'number' ? `${distance} mi` : (typeof distance === 'string' ? distance : undefined),
        });
      });
  const next: Record<string, UpcomingRideCard> = {};
  items.forEach((it) => { next[it.id] = it; });
  setUpcPostingReqDriver(next);
  setPostingReqByPostingId((prev) => ({ ...prev, ...byPosting }));
  setCombinedUpcoming({ postingReqDriver: next });
  }, (err) => console.warn('ridePostingRequests(driverId) listener error', err));
    unsubs.push(unsubRpr);

    if (email) {
      const rprEmailQ = query(
        collection(firestore, 'ridePostingRequests'),
  where('driverEmail', '==', email)
      );
      const unsubRprEmail = onSnapshot(rprEmailQ, (snap) => {
        const items: UpcomingRideCard[] = [];
        const byPosting: Record<string, { id: string; status: string }> = {};
        snap.forEach((d) => {
          const r = d.data() as any;
          const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
          const from = extractAddress(r, 'pickup');
          const to = extractAddress(r, 'dropoff');
          const price = r?.contributionAmount ?? r?.price ?? r?.estimatedFare;
          const distance = r?.distance;
          const postingId = r.ridePostingId || r.ridePostId || r.postingId || r.posting?.id;
          if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
            byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
          }
          items.push({
            id: d.id,
            type: 'ridePostingRequest',
            status: String(r?.status || 'offer_sent'),
            from,
            to,
            dateTime: dt,
            durationText: getDurationText(r),
            priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
            distanceText: typeof distance === 'number' ? `${distance} mi` : (typeof distance === 'string' ? distance : undefined),
          });
        });
  const next: Record<string, UpcomingRideCard> = {};
  items.forEach((it) => { next[it.id] = it; });
  setUpcPostingReqEmail(next);
  setPostingReqByPostingId((prev) => ({ ...prev, ...byPosting }));
  setCombinedUpcoming({ postingReqEmail: next });
  }, (err) => console.warn('ridePostingRequests(driverEmail) listener error', err));
      unsubs.push(unsubRprEmail);
    }

    // Additional listeners: when backend stores posting owner on the request
    try {
      const rprOwnerQ = query(
        collection(firestore, 'ridePostingRequests'),
        where('ownerId', '==', uid)
      );
      const unsubRprOwner = onSnapshot(rprOwnerQ, (snap) => {
        const items: UpcomingRideCard[] = [];
        const byPosting: Record<string, { id: string; status: string }> = {};
        snap.forEach((d) => {
          const r = d.data() as any;
          const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
          const from = extractAddress(r, 'pickup');
          const to = extractAddress(r, 'dropoff');
          const price = r?.contributionAmount ?? r?.price ?? r?.estimatedFare;
          const distance = r?.distance;
          const postingId = r.ridePostingId || r.ridePostId || r.postingId || r.posting?.id;
          if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
            byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
          }
          items.push({
            id: d.id,
            type: 'ridePostingRequest',
            status: String(r?.status || 'pending'),
            from,
            to,
            dateTime: dt,
            durationText: getDurationText(r),
            priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
            distanceText: typeof distance === 'number' ? `${distance} mi` : (typeof distance === 'string' ? distance : undefined),
          });
        });
        const next: Record<string, UpcomingRideCard> = {};
        items.forEach((it) => { next[it.id] = it; });
        setUpcPostingReqOwner(next);
        setPostingReqByPostingId((prev) => ({ ...prev, ...byPosting }));
        setCombinedUpcoming({ postingReqOwner: next });
      }, (err) => console.warn('ridePostingRequests(ownerId) listener error', err));
      unsubs.push(unsubRprOwner);
    } catch {}

    if (email) {
      try {
        const rprOwnerEmailQ = query(
          collection(firestore, 'ridePostingRequests'),
          where('ownerEmail', '==', email)
        );
        const unsubRprOwnerEmail = onSnapshot(rprOwnerEmailQ, (snap) => {
          const items: UpcomingRideCard[] = [];
          const byPosting: Record<string, { id: string; status: string }> = {};
          snap.forEach((d) => {
            const r = d.data() as any;
            const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
            const from = extractAddress(r, 'pickup');
            const to = extractAddress(r, 'dropoff');
            const price = r?.contributionAmount ?? r?.price ?? r?.estimatedFare;
            const distance = r?.distance;
            const postingId = r.ridePostingId || r.ridePostId || r.postingId || r.posting?.id;
            if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
              byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
            }
            items.push({
              id: d.id,
              type: 'ridePostingRequest',
              status: String(r?.status || 'pending'),
              from,
              to,
              dateTime: dt,
              dateStr: typeof r?.date === 'string' ? r.date : undefined,
              durationText: getDurationText(r),
              priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
              distanceText: typeof distance === 'number' ? `${distance} mi` : (typeof distance === 'string' ? distance : undefined),
            });
          });
          const next: Record<string, UpcomingRideCard> = {};
          items.forEach((it) => { next[it.id] = it; });
          setUpcPostingReqOwnerEmail(next);
          setPostingReqByPostingId((prev) => ({ ...prev, ...byPosting }));
          setCombinedUpcoming({ postingReqOwnerEmail: next });
        }, (err) => console.warn('ridePostingRequests(ownerEmail) listener error', err));
        unsubs.push(unsubRprOwnerEmail);
      } catch {}
    }

  // Listen for ride offers sent to this driver
  const offersBase = collection(firestore, 'rideOffers');
  const offersForRecipient = query(offersBase, where('recipientId', '==', uid));
  const offersForRider = query(offersBase, where('driverId', '==', uid));
  const offersForDriverEmail = email ? query(offersBase, where('driverEmail', '==', email)) : null;

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
      const dist = data.distance?.text || data.distanceText || extractDistance(data) || extractDistance(data?.rideDetails); 
      // Use seconds-aware duration parsing
      const durationText = getDurationText(data);
          const driverName = data.driverName || data.driver?.name || data.driver?.fullName;
          const driverId = data.driverId || data.driverUID || data.driverUid || data.driver?.id || data.driver?.uid || data.senderId || data.ownerId || data.postedBy || data.providerId || data.driverProfile?.id;
          const driverEmail = data.driverEmail || data.driver?.email;
          const driverPhone = data.driverPhone || data.driver?.phone || data.driver?.phoneNumber;
          const distanceText = typeof dist === 'string' ? dist : undefined;
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
        const offerCards: Record<string, UpcomingRideCard> = {};
        snap.forEach((docu: any) => {
          const o = mapOffer(docu);
          if (!o) return;
          const existing = incoming[o.rideRequestId];
          if (!existing || (o.createdAt && existing.createdAt && o.createdAt > existing.createdAt)) {
            incoming[o.rideRequestId] = o;
          } else if (!existing) {
            incoming[o.rideRequestId] = o;
          }

          // Build an UpcomingRideCard for offers we (this driver) sent that are still pending/sent
          try {
            const data = docu.data() || {};
            const statusKey = String(o.status || '').toLowerCase();
            const isPending = ['pending','sent','offer','offer_sent','offer-sent'].includes(statusKey);
            const isMine = ((!!o.driverId && uid && String(o.driverId) === String(uid))
              || (!!o.driverEmail && !!email && String(o.driverEmail).toLowerCase() === String(email).toLowerCase()));
            if (isMine && isPending && o.rideRequestId) {
              const rd = data?.rideDetails || {};
              const dt = composeDateTime(rd?.date || data?.date, rd?.time || data?.time) || toDateField(data?.offerDate || data?.createdAt || data?.date);
              // From nested rideDetails if present; else fallback to flat fields
              const from = (typeof rd?.pickup === 'string' && rd.pickup) ? rd.pickup : extractAddress(data, 'pickup');
              const toAddr = (typeof rd?.destination === 'string' && rd.destination) ? rd.destination : extractAddress(data, 'dropoff');
              // Price precedence: nested contributionAmount -> offerPrice -> textual price
              const priceRaw = (typeof rd?.contributionAmount === 'string' ? rd.contributionAmount : undefined);
              const priceNumber = (priceRaw ? parseCurrency(priceRaw) : (typeof data?.offerPrice === 'number' ? data.offerPrice : parseCurrency(data?.offerPrice)));
              const priceText = (typeof priceNumber === 'number') ? `$${priceNumber.toFixed(2)}` : (o.priceText || undefined);
              const durationText = o.durationText || (typeof data?.duration === 'string' ? data.duration : undefined);
              const distanceText = o.distanceText
                || extractDistance(data)
                || extractDistance(data?.rideDetails)
                || (typeof data?.distance?.text === 'string' ? data.distance.text : undefined);
              
              // Get rider information from the offer data
              let riderName = data?.riderName || null;
              let riderAvatarUrl = data?.riderAvatarUrl || null;
              let riderRating = (typeof data?.riderRating === 'number') ? data.riderRating : null;
              
              // Also try to get rider info and full addresses from the rideRequest if available
              (async () => {
                try {
                  const rideRequestDoc = await getDoc(doc(firestore, 'rideRequests', o.rideRequestId));
                  if (rideRequestDoc.exists()) {
                    const rrData = rideRequestDoc.data() as any;
                    riderName = riderName || rrData?.userName || rrData?.requesterName || rrData?.name || rrData?.fullName;
                    riderAvatarUrl = riderAvatarUrl || rrData?.userAvatarUrl || rrData?.profilePicture || rrData?.photoURL;
                    riderRating = riderRating || (typeof rrData?.rating === 'number' ? rrData.rating : null);
                    const rrDistanceText = extractDistance(rrData);
                    
                    // Extract full addresses from the rideRequest document
                    const fullPickupAddress = extractAddress(rrData, 'pickup');
                    const fullDropoffAddress = extractAddress(rrData, 'dropoff');
                    
                    // Update the card with fetched rider info and full addresses
                    setUpcOffersSent((prev) => ({
                      ...prev,
                      [String(o.rideRequestId)]: {
                        ...prev[String(o.rideRequestId)],
                        riderName,
                        riderAvatarUrl,
                        riderRating,
                        from: fullPickupAddress || prev[String(o.rideRequestId)]?.from || from,
                        to: fullDropoffAddress || prev[String(o.rideRequestId)]?.to || toAddr,
                        distanceText: prev[String(o.rideRequestId)]?.distanceText || rrDistanceText || distanceText,
                      }
                    }));
                    if (rrDistanceText) {
                      setOffersByRideId((prev) => {
                        const existingOffer = prev[String(o.rideRequestId)];
                        if (!existingOffer || existingOffer.distanceText) return prev;
                        return {
                          ...prev,
                          [String(o.rideRequestId)]: {
                            ...existingOffer,
                            distanceText: existingOffer.distanceText || rrDistanceText,
                          },
                        };
                      });
                    }
                  }
                } catch (error) {
                  console.warn('Failed to fetch rider info for offer:', error);
                }
              })();
              
              offerCards[String(o.rideRequestId)] = {
                id: String(o.rideRequestId),
                type: 'rideRequest',
                status: 'offer_sent',
                from,
                to: toAddr,
                dateTime: dt,
                durationText,
                priceText,
                distanceText,
                riderId: data?.riderId || data?.userId,
                riderName,
                riderAvatarUrl,
                riderRating,
              };
            }
          } catch {}
        });
        // Merge with current map, prefer newest per ride id
        setOffersByRideId((prev) => ({ ...prev, ...incoming }));
        // Replace offersSent map with latest snapshot view
        setUpcOffersSent(offerCards);
        setCombinedUpcoming({ offersSent: offerCards });
      };

      const unsubOffer1 = onSnapshot(offersForRecipient, handleOfferSnap, (e) => console.warn('rideOffers(recipientId) error', e));
      const unsubOffer2 = onSnapshot(offersForRider, handleOfferSnap, (e) => console.warn('rideOffers(driverId) error', e));
      unsubs.push(unsubOffer1, unsubOffer2);
      if (offersForDriverEmail) {
        const unsubOffer3 = onSnapshot(offersForDriverEmail, handleOfferSnap, (e) => console.warn('rideOffers(driverEmail) error', e));
        unsubs.push(unsubOffer3);
      }

    // Listen for confirmedRides for this driver to gate the Confirmed badge strictly by DB
    try {
      const crBase = collection(firestore, 'confirmedRides');
      const crByDriver = query(crBase, where('driverId', '==', uid));
      const unCr1 = onSnapshot(crByDriver, (snap) => {
        const reqMap: Record<string, boolean> = {};
        const postMap: Record<string, boolean> = {};
        const cards: Record<string, UpcomingRideCard> = {};
        const groupBuckets: Record<string, Array<{ id: string; data: any }>> = {};
          snap.forEach((d) => {
          const r = d.data() || {};
          const statusRaw = String(r?.status || '').toUpperCase();
          console.log(`[confirmedRides listener] Doc ${d.id}: status="${r?.status}", statusRaw="${statusRaw}"`);
          // Always flag maps so we can hide posting/request cards even when completed
          if (r.rideRequestId) reqMap[String(r.rideRequestId)] = true;
          if (r.ridePostingId) postMap[String(r.ridePostingId)] = true;
          // Accumulate by posting for potential group ride aggregation
          if (r.ridePostingId) {
            const pid = String(r.ridePostingId);
            if (!groupBuckets[pid]) groupBuckets[pid] = [];
            groupBuckets[pid].push({ id: d.id, data: r });
          }
          if (statusRaw === 'COMPLETED') {
            // Do not render an individual confirmed card for completed; Recent/History handles it,
            // but keep it in groupBuckets so group ride remains visible until all complete.
            return;
          }
          // Hide flagged rides from upcoming section if they were COMPLETED when flagged
          if (statusRaw === 'FLAGGED' && String(r?.statusAtFlag || '').toUpperCase() === 'COMPLETED') {
            console.log(`[confirmedRides] Hiding flagged ride ${d.id} from upcoming (was COMPLETED)`);
            return;
          }
            // Build an UpcomingRideCard directly from confirmed ride
            const dt =
              composeDateTime(r?.date, r?.time)
              || composeDateTime(r?.originalRidePosting?.date, r?.originalRidePosting?.time)
              || composeDateTime(r?.originalRidePostingRequest?.date, r?.originalRidePostingRequest?.time)
              || getRideDateTime(r)
              || getRideDateTime(r?.originalRidePosting)
              || getRideDateTime(r?.originalRidePostingRequest)
              || toDateField(r?.confirmedAt || r?.createdAt);
          const from = extractAddress(r, 'pickup');
          const to = extractAddress(r, 'dropoff');
          // Contribution precedence for confirmed rides
          const price = (
            (typeof r?.contributionAmount === 'number' ? r.contributionAmount : parseCurrency(r?.contributionAmount))
            ?? (typeof r?.contribution === 'number' ? r.contribution : parseCurrency(r?.contribution))
            ?? (typeof r?.requestedContribution === 'number' ? r.requestedContribution : parseCurrency(r?.requestedContribution))
            ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price))
            ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare))
          );
            // Prefer explicit metrics; else fallback to originals
            const durationText = getDurationText(r) || getDurationText(r?.originalRidePosting) || getDurationText(r?.originalRidePostingRequest);
            const distanceText = extractDistance(r) || extractDistance(r?.originalRidePosting) || extractDistance(r?.originalRidePostingRequest);
      if (r.rideRequestId) {
            cards[`rideRequest-${String(r.rideRequestId)}`] = {
              id: String(r.rideRequestId),
              type: 'rideRequest',
              status: statusRaw,
              from,
              to,
              dateTime: dt,
              dateStr: typeof r?.date === 'string' ? r.date : undefined,
              durationText,
              priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : undefined,
              distanceText,
              confirmedId: d.id,
              confirmedStatus: String(r?.status || 'CONFIRMED'),
              riderId: r.riderId || r.userId || r.requesterId || r.ownerId || r.user?.id,
        confirmedDriverComplete: r.driverCompleteConfirmed === true,
              confirmedDriverPickup: r.driverPickupConfirmed === true,
            };
          } else if (r.ridePostingId) {
            cards[`ridePosting-${String(r.ridePostingId)}`] = {
              id: String(r.ridePostingId),
              type: 'ridePosting',
              status: statusRaw,
              from,
              to,
              dateTime: dt,
              durationText,
              priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : undefined,
              distanceText,
              confirmedId: d.id,
              confirmedStatus: String(r?.status || 'CONFIRMED'),
              riderId: r.riderId || r.userId || r.requesterId || r.ownerId || r.user?.id,
        confirmedDriverComplete: r.driverCompleteConfirmed === true,
              confirmedDriverPickup: r.driverPickupConfirmed === true,
            };
          }
        });
        console.log('[confirmedRides] groupBuckets:', Object.keys(groupBuckets).map(pid => ({
          postingId: pid,
          count: groupBuckets[pid].length,
          ids: groupBuckets[pid].map(i => i.id),
          statuses: groupBuckets[pid].map(i => i.data?.status),
          seatCount: Number(
            groupBuckets[pid]?.[0]?.data?.seatsAvailable
            || groupBuckets[pid]?.[0]?.data?.originalRidePosting?.seatsAvailable
            || 1
          )
        })));
        // Aggregate group rides (2+ seats) into a single card per posting as soon as first passenger is confirmed
        Object.entries(groupBuckets).forEach(([pid, items]) => {
          const seatCount = Number(
            items?.[0]?.data?.originalRidePosting?.seatsAvailable
            || items?.[0]?.data?.originalRidePosting?.seats
            || items?.[0]?.data?.seatsAvailable
            || items?.[0]?.data?.seats
            || items?.[0]?.data?.originalRidePosting?.availableSeats // legacy fallback
            || items?.[0]?.data?.availableSeats // legacy fallback (remaining if newer schema)
            || 1
          );
          // Show group ride card ONLY when ALL seats are confirmed (ride is full)
          // Until then, show the Posted card with seat count and Offer received badges
          if (seatCount >= 2 && items.length >= seatCount) {
            // Derive common fields from first item
            const base = items[0].data || {};
            const dt =
              composeDateTime(base?.date, base?.time)
              || composeDateTime(base?.originalRidePosting?.date, base?.originalRidePosting?.time)
              || composeDateTime(base?.originalRidePostingRequest?.date, base?.originalRidePostingRequest?.time)
              || getRideDateTime(base)
              || getRideDateTime(base?.originalRidePosting)
              || getRideDateTime(base?.originalRidePostingRequest)
              || toDateField(base?.confirmedAt || base?.createdAt);
            const from = extractAddress(base, 'pickup')
              || extractAddress(base?.originalRidePosting, 'pickup')
              || extractAddress(base?.originalRidePostingRequest, 'pickup');
            const to = extractAddress(base, 'dropoff')
              || extractAddress(base?.originalRidePosting, 'dropoff')
              || extractAddress(base?.originalRidePostingRequest, 'dropoff');
            const pricePerSeat = (
              (typeof base?.originalRidePosting?.pricePerSeat === 'number' ? base.originalRidePosting.pricePerSeat : undefined)
              ?? (typeof base?.contributionAmount === 'number' ? base.contributionAmount : parseCurrency(base?.contributionAmount))
              ?? (typeof base?.contribution === 'number' ? base.contribution : parseCurrency(base?.contribution))
              ?? (typeof base?.requestedContribution === 'number' ? base.requestedContribution : parseCurrency(base?.requestedContribution))
              ?? (typeof base?.price === 'number' ? base.price : parseCurrency(base?.price))
              ?? (typeof base?.estimatedFare === 'number' ? base.estimatedFare : parseCurrency(base?.estimatedFare))
            );
            const childStatuses = items.map((it) => {
              const raw = String(it.data?.status || '').toUpperCase();
              // Normalize DRIVER_COMPLETED and RIDER_COMPLETED to IN_PROGRESS for UI display
              return (raw === 'DRIVER_COMPLETED' || raw === 'RIDER_COMPLETED') ? 'IN_PROGRESS' : raw;
            });
            const allConfirmed = childStatuses.every((s) => s === 'CONFIRMED');
            const anyPending = childStatuses.some((s) => s === 'PENDING');
            const anyInProgress = childStatuses.some((s) => s === 'IN_PROGRESS');
            const allCompleted = childStatuses.every((s) => s === 'COMPLETED');
            const anyFlagged = childStatuses.some((s) => s === 'FLAGGED');
            // Check if any flagged ride was COMPLETED when flagged
            const anyFlaggedWasCompleted = items.some((it) => 
              String(it.data?.status || '').toUpperCase() === 'FLAGGED' && 
              String(it.data?.statusAtFlag || '').toUpperCase() === 'COMPLETED'
            );
            // Skip group ride if any child was flagged after COMPLETED (hide from upcoming)
            if (anyFlaggedWasCompleted) {
              console.log('[groupRide aggregation]', pid, 'skipping - contains flagged completed ride');
              return;
            }
            // Determine aggregated status: PENDING until all seats filled, then follow ride progression
            const seatsNotFilled = items.length < seatCount;
            const aggregatedStatus = anyFlagged
              ? 'FLAGGED'
              : seatsNotFilled
                ? 'PENDING'
                : allCompleted
                  ? 'COMPLETED'
                  : anyInProgress
                    ? 'IN_PROGRESS'
                    : allConfirmed
                      ? 'CONFIRMED'
                      : 'PENDING';
            console.log('[groupRide aggregation]', pid, 'childStatuses:', childStatuses, '=>', aggregatedStatus);
            // Remove individual posting/request cards for this posting once group view is available
            Object.keys(cards).forEach((k) => { if (k === `ridePosting-${pid}`) delete (cards as any)[k]; });
            items.forEach((it) => {
              const rid = it?.data?.rideRequestId;
              if (rid) delete (cards as any)[`rideRequest-${String(rid)}`];
            });
            // Compose passengers list
            const passengers = items.map((it) => ({
              confirmedId: it.id,
              riderId: it.data?.riderId || it.data?.userId || it.data?.requesterId || it.data?.ownerId || it.data?.user?.id,
              name: it.data?.riderName || it.data?.user?.name || it.data?.userName || 'Passenger',
              status: String(it.data?.status || 'CONFIRMED').toUpperCase(),
              phone: it.data?.riderPhone || it.data?.user?.phone || it.data?.riderPhoneNumber || null,
              avatarUrl: sanitizeAvatar(
                it.data?.riderAvatarUrl
                || it.data?.userAvatarUrl
                || it.data?.profilePicture
                || it.data?.photoURL
                || it.data?.user?.profilePicture
                || it.data?.user?.avatarUrl
              ) || null,
              rating: (typeof it.data?.riderRating === 'number') ? it.data.riderRating
                : (typeof it.data?.user?.rating === 'number') ? it.data.user.rating
                : (typeof it.data?.rating === 'number') ? it.data.rating
                : null,
              paymentCaptured: it.data?.paymentCaptured === true,
            }));
            (cards as any)[`groupRide-${pid}`] = {
              id: String(pid),
              type: 'groupRide',
              ridePostingId: String(pid),
              status: aggregatedStatus,
              confirmedStatus: aggregatedStatus,
              from,
              to,
              dateTime: dt,
              priceText: (typeof pricePerSeat === 'number') ? `$${pricePerSeat.toFixed(2)} per seat` : (pricePerSeat ? `${pricePerSeat} per seat` : undefined),
              seatsFilled: items.length,
              seatCount,
              passengers,
            } as any;
          }
        });
        // Update counts for 0/2 and 1/2 indicators on posting cards
        // Count all non-cancelled children, including PENDING, to reflect seats taken
        const counts: Record<string, number> = {};
        Object.entries(groupBuckets).forEach(([pid, items]) => {
          const active = items.filter((it) => {
            const st = String(it?.data?.status || '').toUpperCase();
            return st !== 'CANCELLED' && st !== 'CANCELED';
          });
          counts[pid] = active.length;
        });
        setConfirmedCountByPostingId((prev) => ({ ...prev, ...counts }));
        setConfirmedByReqId((prev) => ({ ...prev, ...reqMap }));
        setConfirmedByPostingId((prev) => ({ ...prev, ...postMap }));
        // Set confirmed cards - useEffect will merge with other sources
        const simple: Record<string, UpcomingRideCard> = {};
        Object.values(cards).forEach((c) => { simple[`${c.type}-${c.id}`] = c; });
        setUpcConfirmed(simple);
      }, (e) => console.warn('confirmedRides(driverId) listener error', e));
      unsubs.push(unCr1);
      // Removed redundant driverEmail listener - server always sets driverId on confirmed rides,
      // so querying by driverId is sufficient. The email listener was causing duplicate cards.
    } catch (e) {
      console.warn('confirmedRides listener setup failed', e);
    }

    // Driver's own ride postings should appear as Posted
    try {
      const postingsQ = query(collection(firestore, 'ridePostings'), where('driverId', '==', uid));
      const unsubPostings = onSnapshot(postingsQ, (snap) => {
        const items: UpcomingRideCard[] = [];
        snap.forEach((d) => {
          const r = d.data() as any;
          const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
          const from = extractAddress(r, 'pickup');
          const to = extractAddress(r, 'dropoff');
          const price = r?.pricePerSeat ?? r?.contributionAmount ?? r?.price ?? r?.estimatedFare;
          const durationText = getDurationText(r);
          const rawStatus = String(r?.status || '').toLowerCase();
          if (rawStatus === 'confirmed') {
            // Do not surface confirmed posting cards here; confirmed rides should come from confirmedRides only
            return;
          }
          items.push({
            id: d.id,
            type: 'ridePosting',
            status: normalizeStatusForDisplay(r?.status),
            from,
            to,
            dateTime: dt,
            durationText,
            priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
            distanceText: extractDistance(r),
            // seatCount should be TOTAL seats. Prefer seatsAvailable (total), then seats; avoid using availableSeats (remaining).
            seatCount: typeof r?.seatsAvailable === 'number'
              ? r.seatsAvailable
              : (typeof r?.seats === 'number' ? r.seats : (typeof r?.availableSeats === 'number' ? r.availableSeats : undefined)),
          });
        });
  const next: Record<string, UpcomingRideCard> = {};
  items.forEach((it) => { next[it.id] = it; });
  setUpcPostingsDriver(next);
  setCombinedUpcoming({ postingsDriver: next });
      }, (err) => console.warn('ridePostings(driverId) listener error', err));
      unsubs.push(unsubPostings);
    } catch (e) {
      console.warn('ridePostings listener setup failed', e);
    }

    if (email) {
      try {
        const postingsEmailQ = query(collection(firestore, 'ridePostings'), where('driverEmail', '==', email));
        const unsubPostingsEmail = onSnapshot(postingsEmailQ, (snap) => {
          const items: UpcomingRideCard[] = [];
          snap.forEach((d) => {
            const r = d.data() as any;
            const dt = composeDateTime(r?.date, r?.time) || getRideDateTime(r);
            console.log(`[ridePostings] Processing posting ${d.id}: date="${r?.date}", time="${r?.time}", dt hours=${dt?.getHours()}`);
            const from = extractAddress(r, 'pickup') || 'Pickup';
            const to = extractAddress(r, 'dropoff') || 'Dropoff';
            const price = r?.pricePerSeat ?? r?.contributionAmount ?? r?.price ?? r?.estimatedFare;
            const durationText = getDurationText(r);
            const rawStatus = String(r?.status || '').toLowerCase();
            if (rawStatus === 'confirmed') {
              // Do not surface confirmed posting cards here; confirmed rides should come from confirmedRides only
              return;
            }
            items.push({
              id: d.id,
              type: 'ridePosting',
              status: normalizeStatusForDisplay(r?.status),
              from,
              to,
              dateTime: dt,
              durationText,
              priceText: typeof price === 'number' ? `$${price.toFixed(2)}` : (typeof price === 'string' ? price : undefined),
              distanceText: extractDistance(r),
              seatCount: typeof r?.availableSeats === 'number' ? r.availableSeats : (typeof r?.seats === 'number' ? r.seats : undefined),
            });
          });
          const next: Record<string, UpcomingRideCard> = {};
          items.forEach((it) => { next[it.id] = it; });
          setUpcPostingsEmail(next);
          setCombinedUpcoming({ postingsEmail: next });
        }, (err) => console.warn('ridePostings(driverEmail) listener error', err));
        unsubs.push(unsubPostingsEmail);
      } catch (e) {
        console.warn('ridePostings by email listener setup failed', e);
      }
    }

    // Stats: total completed rides for this driver (count all individual rides, matching profile page)
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(firestore, 'confirmedRides'),
          where('driverId', '==', uid),
          where('status', '==', 'COMPLETED')
        ));
        // Count all completed rides individually (not grouped by posting)
        setStats((s) => ({ ...s, totalRides: snap.size }));
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();

      // Completed confirmed rides listener for Recent Rides: mirror Ride History query and grouping
      try {
        let currentUnsub: (() => void) | null = null;
        const subscribe = (useOrder: boolean) => {
          const base = [
            collection(firestore, 'confirmedRides'),
            where('driverId', '==', uid),
            where('status', '==', 'COMPLETED'),
          ] as any[];
          if (useOrder) base.push(orderBy('completedAt', 'desc'));
          base.push(fsLimit(25));
          const qy = query.apply(null, base as any);
          currentUnsub = onSnapshot(
            qy,
            async (snap) => {
              const data: any[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
              // Group like ride-history.tsx by ridePostingId
              const byPosting = new Map<string, any[]>();
              data.forEach((r) => {
                const key = r.ridePostingId || r.originalRidePosting?.id || r.id;
                const arr = byPosting.get(key) || [];
                arr.push(r);
                byPosting.set(key, arr);
              });
              const grouped: any[] = [];
              byPosting.forEach((arr, key) => {
                if (arr.length === 1) {
                  grouped.push(arr[0]);
                } else {
                  const sorted = [...arr].sort((a, b) => {
                    const at = (getDateFromConfirmed(a)?.getTime?.() ?? (a?.completedAt?.toMillis?.() ?? 0));
                    const bt = (getDateFromConfirmed(b)?.getTime?.() ?? (b?.completedAt?.toMillis?.() ?? 0));
                    return bt - at;
                  });
                  const latest = sorted[0];
                  const riderNames = arr.map((r) => r.riderName).filter(Boolean) as string[];
                  const priceSum = arr.reduce((s, r) => {
                    const v = r?.contributionAmount ?? r?.price;
                    const num = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : 0);
                    return s + (isNaN(num) ? 0 : num);
                  }, 0);
                  grouped.push({
                    ...latest,
                    id: key,
                    riderName: riderNames.slice(0, 3).join(', ') + (riderNames.length > 3 ? ` +${riderNames.length - 3} more` : ''),
                    contributionAmount: priceSum,
                    _seatCount: arr.length,
                    _groupChildren: arr.map((c) => ({ id: c.id, riderName: c.riderName })),
                  });
                }
              });
              // Sort final groups by same date logic as history
              grouped.sort((a, b) => {
                const at = (getDateFromConfirmed(a)?.getTime?.() ?? (a?.completedAt?.toMillis?.() ?? 0));
                const bt = (getDateFromConfirmed(b)?.getTime?.() ?? (b?.completedAt?.toMillis?.() ?? 0));
                return bt - at;
              });
              setRecentConfirmed(grouped as any);
              // Hydrate rated flags using underlying seat docs
              try { await hydrateRatedByMe(uid, data.slice(0, 10) as any, setRatedByMe); } catch {}
              // Prompt using seat-level rides for correctness
              await promptPendingRatingForDriver(uid, data as any);
            },
            (err) => {
              if (String(err?.code) === 'failed-precondition' && useOrder) {
                if (currentUnsub) currentUnsub();
                subscribe(false);
              } else if (useOrder) {
                if (currentUnsub) currentUnsub();
                subscribe(false);
              }
            }
          );
        };
        subscribe(true);
        unsubs.push(() => { if (currentUnsub) currentUnsub(); });
      } catch (e) {
        console.warn('recent completed rides listener failed', e);
      }

    return () => {
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Pull-to-refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Refresh driver rating stats
      if (uid) {
        await refreshDriverRatingStatCard(uid, setStats);
        
        // Re-fetch user profile
        try {
          const userDoc = await getDoc(doc(firestore, 'drivers', uid));
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
  }, [uid, email]);

  // Auto-refresh when screen comes into focus (silently, without showing spinner)
  useFocusEffect(
    useCallback(() => {
      // Refresh data when screen is focused (after navigating back from profile, ride details, etc.)
      if (!loading && uid) {
        // Execute refresh logic inline without setting refreshing=true to avoid visual spinner
        (async () => {
          try {
            await refreshDriverRatingStatCard(uid, setStats);
            
            // Re-fetch user profile
            try {
              const userDoc = await getDoc(doc(firestore, 'drivers', uid));
              const data = userDoc.exists() ? (userDoc.data() as any) : null;
              const firstName = getFirstNameFromProfile(data);
              const profilePhoto = data?.avatarUrl || data?.photoURL || data?.photoUrl || firebaseAuth.currentUser?.photoURL;
              
              if (profilePhoto && typeof profilePhoto === 'string') {
                setUserPhoto(profilePhoto);
              }
              setUserName(firstName ?? (email ? email.split('@')[0] : null));
            } catch {}
          } catch (error) {
            console.error('Auto-refresh error:', error);
          }
        })();
      }
    }, [loading, uid, email])
  );

  // On first auth/load, also prompt for any pending rating
  useEffect(() => {
    if (uid && recentConfirmed) {
  hydrateRatedByMe(uid, recentConfirmed.slice(0, 3), setRatedByMe).catch(() => {});
  promptPendingRatingForDriver(uid, recentConfirmed).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Fetch total earnings from earnings API (match Earnings page)
  useEffect(() => {
    if (!uid) {
      setStats((s) => ({ ...s, totalEarnings: 0 }));
      return;
    }
    let mounted = true;
    async function fetchEarnings() {
      try {
        const user = firebaseAuth.currentUser;
        if (!user) return;
        const token = await user.getIdToken();
        const apiUrl = getApiBaseUrl();
        console.log('[Earnings] Fetching from:', `${apiUrl}/api/connect/driver-earnings?userId=${uid}&summaryOnly=1`);
        const res = await fetch(`${apiUrl}/api/connect/driver-earnings?userId=${uid}&summaryOnly=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log('[Earnings] Response status:', res.status, res.statusText);
        if (!res.ok) {
          const errorText = await res.text();
          console.error('[Earnings] Error response:', errorText);
          throw new Error('Failed to fetch earnings');
        }
        const data = await res.json();
        console.log('[Earnings] Response data:', JSON.stringify(data, null, 2));
        console.log('[Earnings] Setting totalEarnings to:', data.lifetime || 0);
        if (mounted) {
          setStats((s) => ({ ...s, totalEarnings: data.lifetime || 0 }));
        }
      } catch (err) {
        console.error('[Earnings] Error fetching earnings:', err);
        if (mounted) setStats((s) => ({ ...s, totalEarnings: 0 }));
      }
    }
    fetchEarnings();
    return () => { mounted = false; };
  }, [uid]);

  const sortedUpcoming = useMemo(() => sortByDate(upcoming), [upcoming]);
  // Dedupe across sources (rideRequest vs ridePosting) by route + time bucket, preferring rideRequest
  // Filter out any items that are cancelled so we do not render cancelled cards in Upcoming
  const displayUpcoming = useMemo(() => {
    return (sortedUpcoming || []).filter((r) => {
      const s = String((r as any)?.status || '').replace(/[-\s]/g, '_').toLowerCase();
      const cs = String((r as any)?.confirmedStatus || '').replace(/[-\s]/g, '_').toLowerCase();
      return s !== 'cancelled' && s !== 'canceled' && s !== 'expired'
        && cs !== 'cancelled' && cs !== 'canceled';
    });
  }, [sortedUpcoming]);

  // Auto-capture is now server-driven. Client effect removed; server will sweep on completion.

  // Always recompute the combined Upcoming list from the latest maps.
  // This prevents stale-closure issues from individual listeners calling setCombinedUpcoming
  // with out-of-date views of other maps (e.g., after posting a ride, confirmed could be dropped).
  useEffect(() => {
    const arr: UpcomingRideCard[] = [
      ...Object.values(upcOffersSent || {}),
      ...Object.values(upcReqDriver || {}),
      ...Object.values(upcReqUserId || {}),
      ...Object.values(upcReqEmail || {}),
      ...Object.values(upcReqEmailAlt || {}),
      // We do not render posting request cards directly; they only flip posting cards
      // ...Object.values(upcPostingReqDriver || {}),
      // ...Object.values(upcPostingReqEmail || {}),
      // ...Object.values(upcPostingReqOwner || {}),
      // ...Object.values(upcPostingReqOwnerEmail || {}),
      // Keep posting cards visible until ALL seats are filled (not just ANY)
      // This allows showing "Posted 1/2" or "Offer received" badges for partial fills
  ...Object.values(upcPostingsDriver || {}).filter((c) => {
        if (c.type !== 'ridePosting') return true;
        const seatsFilled = confirmedCountByPostingId[c.id] || 0;
        const totalSeats = Number(c.seatsAvailable || c.seats || 1);
        // Only hide Posted card when ALL seats are filled
        const isFull = seatsFilled >= totalSeats;
        return !isFull; // show Posted until all seats are filled
      }),
  ...Object.values(upcPostingsEmail || {}).filter((c) => {
        if (c.type !== 'ridePosting') return true;
        const seatsFilled = confirmedCountByPostingId[c.id] || 0;
        const totalSeats = Number(c.seatsAvailable || c.seats || 1);
        const isFull = seatsFilled >= totalSeats;
        return !isFull; // show Posted until all seats are filled
      }),
      // Confirmed at the end so it overrides placeholders with the same (type-id)
  // Include only non-completed confirmed rides in Upcoming; completed are shown in Recent
  ...Object.values(upcConfirmed || {}).filter((c) => String(c.status || '').toLowerCase() !== 'completed'),
    ];
    const uniq = new Map<string, UpcomingRideCard>();
    for (const it of arr) uniq.set(`${it.type}-${it.id}`, it);
    setUpcoming(sortByDate([...uniq.values()]));
  }, [
    upcOffersSent,
    upcConfirmed,
    upcReqDriver,
    upcReqUserId,
    upcReqEmail,
    upcReqEmailAlt,
    upcPostingReqDriver,
    upcPostingReqEmail,
    upcPostingReqOwner,
    upcPostingReqOwnerEmail,
    upcPostingsDriver,
    upcPostingsEmail,
    confirmedCountByPostingId,
  ]);

  function sortByDate(arr: UpcomingRideCard[]) {
    return [...arr].sort((a, b) => {
      const at = a.dateTime ? a.dateTime.getTime() : 0;
      const bt = b.dateTime ? b.dateTime.getTime() : 0;
      return at - bt;
    });
  }

  const openRideDetails = (ride: UpcomingRideCard) => {
    setSelectedRide(ride);
    setModalVisible(true);
  };

  const acceptOffer = async (rideId: string) => {
    // Block if not verified
    if (!checkVerificationAndBlock('accept ride request')) return;
    
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
      // Rider fields come from the original ride request
      const riderId = r?.userId || r?.riderId || r?.requesterId || r?.ownerId || r?.user?.id;
      const riderEmail = r?.userEmail || r?.riderEmail || r?.requesterEmail || r?.email || r?.user?.email;
      const riderName = r?.userName || r?.riderName || r?.requesterName || r?.name || r?.fullName || r?.displayName || r?.user?.name || r?.user?.fullName;
      const riderPhone = r?.userPhone || r?.riderPhone || r?.phone || r?.phoneNumber;
      const riderAvatarUrl = r?.userAvatarUrl || r?.riderAvatarUrl || r?.profilePicture || r?.photoURL || r?.user?.profilePicture;
      const contributionAmount =
        (typeof offer.priceNumber === 'number' ? offer.priceNumber : undefined)
        ?? (typeof r?.estimatedFare === 'number' ? r.estimatedFare : parseCurrency(r?.estimatedFare))
        ?? (typeof r?.price === 'number' ? r.price : parseCurrency(r?.price));

  const driverEmail = email || r?.driverEmail || r?.email;
  const driverName = (r?.driverName || r?.driverFullName || r?.name || (typeof userName === 'string' ? userName : undefined) || (driverEmail ? driverEmail.split('@')[0] : undefined));
      const passengers = Number(r?.passengers ?? r?.numPassengers ?? r?.seats ?? 1) || 1;
      const duration = (r?.duration && typeof r.duration === 'object') ? r.duration : (offer?.durationText ? { text: offer.durationText } : undefined);
      const distance = (r?.distance && typeof r.distance === 'object') ? r.distance : (offer?.distanceText ? { text: offer.distanceText } : undefined);

      const confirmedPayload: any = {
        rideRequestId: rideId,
        ridePostingId: offer.ridePostingId ?? null,
        confirmedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
  status: 'CONFIRMED',
        requestType: 'ride_request',
        date: dateOnly,
        time: timeStr,
        pickup: pickup,
        dropoff: dropoff,
        passengers,
        contributionAmount,
  // Driver-facing
  driverId: (offer.driverId || r?.driverId || uid),
  driverName: (offer.driverName || r?.driverName || driverName),
  driverEmail: (offer.driverEmail || r?.driverEmail || driverEmail),
  driverPhone: (offer.driverPhone || r?.driverPhone || null),
        // Rider-facing
        riderId: riderId || null,
        riderEmail: riderEmail || null,
        riderName: riderName || null,
        riderPhone: riderPhone || null,
        riderAvatarUrl: riderAvatarUrl || null,
        // Trip metrics
        duration: duration || null,
        distance: distance || null,
        // Originals
        originalRidePosting: null,
        originalRideRequest: {
          id: rideId,
          requestedTime: r?.requestedTime ?? r?.pickupTime ?? r?.date,
          estimatedFare: r?.estimatedFare ?? r?.price,
          pickup,
          dropoff,
          driverId: r?.driverId || r?.userId,
          driverEmail: r?.driverEmail || r?.email,
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
  await updateDoc(rrRef, { status: 'CONFIRMED' }).catch(() => {});

      // 6) Optimistically update local UI state to avoid flicker back to Posted
      setOffersByRideId((prev) => ({
        ...prev,
        [rideId]: { ...prev[rideId], status: 'accepted' },
      }));
  setUpcoming((prev) => prev.map((u) => (u.id === rideId ? { ...u, status: 'CONFIRMED' } : u)));
    } catch (e) {
      console.warn('acceptOffer error', e);
    }
  };

  const rejectOffer = async (rideId: string) => {
    try {
      const offer = offersByRideId[rideId];
      if (!offer) return;
      await updateDoc(doc(firestore, 'rideOffers', offer.id), { status: 'rejected' });
    } catch (e) {
      console.warn('rejectOffer error', e);
    }
  };

  const cancelOffer = async (rideId: string) => {
    try {
      const offer = offersByRideId[rideId];
      if (!offer) {
        Alert.alert('Error', 'Offer not found');
        return;
      }
      
      Alert.alert(
        'Cancel Offer',
        'Are you sure you want to cancel this offer?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes, Cancel',
            style: 'destructive',
            onPress: async () => {
              try {
                await updateDoc(doc(firestore, 'rideOffers', offer.id), { 
                  status: 'cancelled',
                  cancelledAt: serverTimestamp(),
                });
                // Remove from local state immediately
                setOffersByRideId((prev) => {
                  const next = { ...prev };
                  delete next[rideId];
                  return next;
                });
                setUpcOffersSent((prev) => {
                  const next = { ...prev };
                  delete next[rideId];
                  return next;
                });
                Alert.alert('Offer Cancelled', 'Your offer has been cancelled successfully.');
              } catch (e) {
                console.warn('cancelOffer error', e);
                Alert.alert('Error', 'Failed to cancel offer. Please try again.');
              }
            }
          }
        ]
      );
    } catch (e) {
      console.warn('cancelOffer error', e);
      Alert.alert('Error', 'Failed to cancel offer. Please try again.');
    }
  };

  // Accept a rider's request against our ride posting
  const acceptPostingRequest = async (requestId: string) => {
    // Block if not verified
    if (!checkVerificationAndBlock('accept ride request')) return;
    
    try {
      const d = await getDoc(doc(firestore, 'ridePostingRequests', requestId));
      if (!d.exists()) return;
      const r: any = d.data() || {};
      // Resolve posting to enrich route/time if needed
      let post: any = undefined;
      const postingId: string | undefined = r.ridePostingId || r.ridePostId || r.postingId || r.posting?.id;
      if (postingId) {
        const pd = await getDoc(doc(firestore, 'ridePostings', String(postingId)));
        post = pd.exists() ? (pd.data() as any) : undefined;
      }
      // Call server to accept with concurrency + payment authorization
      if (!postingId) throw new Error('Missing postingId on request');
      const base = getApiBaseUrl();
      const token = await firebaseAuth.currentUser?.getIdToken();
      const seatPrice = (typeof (r?.contributionAmount) === 'number' ? r.contributionAmount : (typeof post?.pricePerSeat === 'number' ? post.pricePerSeat : undefined));
      const resp = await fetch(`${base}/driver/posting/${encodeURIComponent(String(postingId))}/accept-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ requestId, userId: uid, seatPrice }),
      });
      if (!resp.ok) {
        let errText = 'Failed to accept request';
        try { const j = await resp.json(); errText = j?.error || errText; } catch {}
        Alert.alert('Accept failed', errText);
        return;
      }
      const result = await resp.json().catch(() => ({} as any));

      // Show success message
      Alert.alert('Success', 'Ride request accepted! The rider has been notified.');

      // Remove pending badge for this posting; confirmed child doc will flow in via listeners
      setPostingReqByPostingId((prev) => {
        if (!postingId) return prev;
        const next = { ...prev } as Record<string, { id: string; status: string }>;
        delete next[String(postingId!)];
        return next;
      });
      
      // Force refresh the ride data to update the card status
      // The confirmed ride listener should pick it up automatically
    } catch (e) {
      console.warn('acceptPostingRequest error', e);
      Alert.alert('Error', 'Failed to accept request. Please try again.');
    }
  };

  const rejectPostingRequest = async (requestId: string) => {
    try {
      // Mark rejected and prune pending mapping for that posting so UI stops showing Offer Received
      const d = await getDoc(doc(firestore, 'ridePostingRequests', requestId)).catch(() => undefined);
      const r: any = d && d.exists() ? (d.data() as any) : undefined;
      const postingId: string | undefined = r?.ridePostingId || r?.ridePostId || r?.postingId || r?.posting?.id;
      await updateDoc(doc(firestore, 'ridePostingRequests', requestId), { status: 'rejected' });
      if (postingId) {
        setPostingReqByPostingId((prev) => {
          const next = { ...prev } as Record<string, { id: string; status: string }>;
          delete next[String(postingId!)];
          return next;
        });
      }
    } catch (e) {
      console.warn('rejectPostingRequest error', e);
    }
  };

  // Verification helpers
  const handleVerifyStudent = async () => {
    try {
      const token = await firebaseAuth.currentUser?.getIdToken();
      if (!token) {
        Alert.alert('Error', 'Please sign in to verify your student status.');
        return;
      }
      const url = `https://ridealongapp.com/pages/driver-login?token=${encodeURIComponent(token)}`;
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', 'Could not open verification page.');
      }
    } catch (e) {
      console.warn('handleVerifyStudent error', e);
      Alert.alert('Error', 'Failed to open verification page.');
    }
  };

  const checkVerificationAndBlock = (action: string): boolean => {
    // Only block if not verified AND past deadline (matching server logic)
    if (isVerified) return true;
    
    const isPastDeadline = verificationDeadline ? new Date() > verificationDeadline : false;
    
    // Allow action if deadline hasn't passed yet
    if (!isPastDeadline) return true;
    
    // Block only if past deadline
    Alert.alert(
      'Verification Deadline Passed',
      'Your verification deadline has passed. Please verify your student status immediately to continue offering rides.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Verify Now', 
          onPress: handleVerifyStudent,
          style: 'default'
        },
      ]
    );
    return false;
  };

  const closeModal = () => {
    setModalVisible(false);
    setSelectedRide(null);
    setModalRider(null);
    // Reset inline panel when closing details modal
    setShowRiderProfile(false);
    setModalPassengers([]);
  };

  // Load rider info (name, rating, phone, avatar) when opening the modal
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!modalVisible || !selectedRide) {
          if (!cancelled) setModalRider(null);
          return;
        }

        // For ride posting cards that are just posted/open with no pending request and not confirmed,
        // do not resolve or display rider information.
        if (selectedRide.type === 'ridePosting') {
          const statusKey = String(selectedRide.status || '').toLowerCase();
          const hasPendingPostingReq = !!postingReqByPostingId[selectedRide.id];
          const isPostingConfirmed = !!confirmedByPostingId[selectedRide.id];
          if (!isPostingConfirmed && !hasPendingPostingReq && (statusKey === 'posted' || statusKey === 'open')) {
            if (!cancelled) setModalRider(null);
            return;
          }
        }

  // Offer context (may contain ridePostingId)
  const offerCtx = offersByRideId[selectedRide.id];
  let postingId: string | null | undefined = offerCtx?.ridePostingId || null;

        // We'll resolve rider info from the underlying ride/documents
  let riderId: any = undefined;
  let riderEmail: any = undefined;
        let name: string | undefined = undefined;
        let phone: string | null | undefined = undefined;
        let avatarRaw: any = undefined;
        let rating: number | null | undefined = null;

        // 1) Try confirmedRides to get rider fields (by rideRequestId first, then ridePostingId)
        try {
          const qs = query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', selectedRide.id), fsLimit(1));
          const snap = await getDocs(qs);
          const data = snap.docs[0]?.data() as any | undefined;
          if (data) {
            riderId = data.riderId || data.userId || data.requesterId || data.riderUID || data.passengerId || data.user?.id;
            riderEmail = data.riderEmail || data.userEmail || data.requesterEmail || data.passengerEmail || data.email || data.user?.email;
            name = name || data.riderName || data.userName || data.requesterName || data.passengerName || data.user?.name || data.user?.fullName || data.name || data.fullName || data.displayName;
            phone = phone || data.riderPhone || data.userPhone || data.passengerPhone || data.phone || data.phoneNumber;
            avatarRaw = avatarRaw || data.riderAvatarUrl || data.userAvatarUrl || data.profilePicture || data.photoURL || data.user?.profilePicture;
            postingId = postingId || data.ridePostingId || data.ridePostId || data.postingId;
          }
        } catch {}

        // If not found by rideRequestId and we have a postingId, try lookup by ridePostingId
        if (!riderId && postingId) {
          try {
            const qs2 = query(collection(firestore, 'confirmedRides'), where('ridePostingId', '==', postingId), fsLimit(1));
            const snap2 = await getDocs(qs2);
            const data2 = snap2.docs[0]?.data() as any | undefined;
            if (data2) {
              riderId = data2.riderId || data2.userId || data2.requesterId || data2.riderUID || data2.passengerId || data2.user?.id;
              riderEmail = riderEmail || data2.riderEmail || data2.userEmail || data2.requesterEmail || data2.passengerEmail || data2.email || data2.user?.email;
              name = name || data2.riderName || data2.userName || data2.requesterName || data2.passengerName || data2.user?.name || data2.user?.fullName || data2.name || data2.fullName || data2.displayName;
              phone = phone || data2.riderPhone || data2.userPhone || data2.passengerPhone || data2.phone || data2.phoneNumber;
              avatarRaw = avatarRaw || data2.riderAvatarUrl || data2.userAvatarUrl || data2.profilePicture || data2.photoURL || data2.user?.profilePicture;
            }
          } catch {}
        }

        // 2) For offer sent against a rider posting, try ridePostingRequests to get posting owner (rider)
        if (selectedRide.type === 'ridePostingRequest') {
          try {
            const d = await getDoc(doc(firestore, 'ridePostingRequests', selectedRide.id));
            const r = d.exists() ? (d.data() as any) : undefined;
            if (r) {
              // Rider is generally the posting owner
              riderId = r.posting?.userId || r.ownerId || r.posterId || r.postingUserId || r.userId || r.owner?.id;
              riderEmail = r.posting?.userEmail || r.ownerEmail || r.userEmail || r.owner?.email || r.requesterEmail;
              name = name || r.posting?.userName || r.ownerName || r.userName || r.owner?.name || r.posting?.ownerName || r.requesterName || r.name || r.fullName || r.displayName;
              phone = phone || r.posting?.userPhone || r.ownerPhone || r.userPhone || r.requesterPhone || r.phone || r.phoneNumber;
              avatarRaw = avatarRaw || r.posting?.userAvatarUrl || r.posting?.profilePicture || r.profilePicture || r.photoURL || r.owner?.profilePicture;

              // If still missing, try the referenced ridePosting document
        postingId = postingId || r.ridePostingId || r.ridePostId || r.postingId || offerCtx?.ridePostingId || r.posting?.id;
        if ((!riderId || !name || !avatarRaw) && typeof postingId === 'string' && postingId) {
                try {
          const pd = await getDoc(doc(firestore, 'ridePostings', postingId));
                  const p = pd.exists() ? (pd.data() as any) : undefined;
                  if (p) {
                    riderId = riderId || p.userId || p.ownerId || p.createdBy || p.creatorId || p.posterId || p.user?.id;
                    riderEmail = riderEmail || p.userEmail || p.ownerEmail || p.createdByEmail || p.user?.email;
                    name = name || p.userName || p.ownerName || p.createdByName || p.posterName || p.user?.name || p.profile?.name || p.profile?.fullName;
                    phone = phone || p.userPhone || p.ownerPhone || p.phone || p.phoneNumber;
                    avatarRaw = avatarRaw || p.userAvatarUrl || p.profilePicture || p.photoURL || p.user?.profilePicture || p.profile?.avatarUrl;
                  }
                } catch {}
              }
            }
          } catch {}
        }

        // 3) Always inspect the rideRequest doc itself (primary source)
        {
          try {
            const rr = await getDoc(doc(firestore, 'rideRequests', selectedRide.id));
            const r = rr.exists() ? (rr.data() as any) : undefined;
            if (r) {
              riderId = riderId || r.userId || r.riderId || r.requesterId || r.ownerId || r.user?.id;
              riderEmail = riderEmail || r.userEmail || r.riderEmail || r.requesterEmail || r.passengerEmail || r.email || r.user?.email;
              name = name || r.userName || r.riderName || r.requesterName || r.passengerName || r.name || r.fullName || r.displayName || r.user?.name || r.user?.fullName;
              phone = phone || r.userPhone || r.riderPhone || r.passengerPhone || r.phone || r.phoneNumber;
              avatarRaw = avatarRaw || r.userAvatarUrl || r.riderAvatarUrl || r.passengerAvatarUrl || r.profilePicture || r.photoURL || r.user?.profilePicture;
              // derive posting id from rideRequest if present
              postingId = postingId || r.ridePostingId || r.ridePostId || r.postingId || r.posting?.id;
              // If still no riderId but we have an email, try confirmedRides by riderEmail
              if (!riderId && typeof riderEmail === 'string' && riderEmail) {
                try {
                  const qcr = query(collection(firestore, 'confirmedRides'), where('riderEmail', '==', riderEmail), fsLimit(1));
                  const scr = await getDocs(qcr);
                  const cd = scr.docs[0]?.data() as any | undefined;
                  if (cd) {
                    riderId = cd.riderId || cd.userId || cd.requesterId;
                    name = name || cd.riderName || cd.userName;
                    phone = phone || cd.riderPhone || cd.userPhone;
                  }
                } catch {}
              }
            }
          } catch {}
        }

        // Fallback 3.5) As a last resort, look up recent confirmedRides for this driver to infer rider
        if (!riderId) {
          try {
            const qd = query(collection(firestore, 'confirmedRides'), where('driverId', '==', uid));
            const sd = await getDocs(qd);
            // Choose best match: by rideRequestId, then by ridePostingId match, then by route pickup including selectedRide.from
            let best: any | undefined;
            const fromStr = (selectedRide.from || '').toLowerCase();
            const toStr = (selectedRide.to || '').toLowerCase();
            sd.forEach((docu) => {
              const d = docu.data() || {};
              if (!best && d.rideRequestId === selectedRide.id) { best = d; return; }
              if (!best && postingId && (d.ridePostingId === postingId)) { best = d; return; }
              const pick = String(d.pickup || '').toLowerCase();
              const drop = String(d.dropoff || d.drop || '').toLowerCase();
              if (!best && fromStr && pick.includes(fromStr) && (!toStr || (drop && drop.includes(toStr)))) { best = d; }
            });
            if (!best && sd.docs.length > 0) best = sd.docs[0].data();
            if (best) {
              riderId = best.riderId || best.userId || best.requesterId;
              riderEmail = riderEmail || best.riderEmail || best.userEmail || best.requesterEmail;
              name = name || best.riderName || best.userName;
              phone = phone || best.riderPhone || best.userPhone;
              avatarRaw = avatarRaw || best.riderAvatarUrl || best.userAvatarUrl || best.profilePicture || best.photoURL;
            }
          } catch {}
        }

        // 4) Fetch rider profile by id/email to enrich name/rating/avatar
        let prof: any = undefined;
        if (riderId) {
          try {
            const d1 = await getDoc(doc(firestore, 'riders', String(riderId)));
            prof = d1.exists() ? (d1.data() as any) : undefined;
          } catch {}
        }
        if (!prof && riderEmail) {
          try {
            const q1 = query(collection(firestore, 'riders'), where('email', '==', riderEmail), fsLimit(1));
            const s1 = await getDocs(q1);
            prof = s1.docs[0]?.data() as any;
          } catch {}
        }
        // Optional: look into a 'riders' collection if present
        if (!prof && riderId) {
          try {
            const d2 = await getDoc(doc(firestore, 'riders', String(riderId)));
            prof = d2.exists() ? (d2.data() as any) : undefined;
          } catch {}
        }
        if (!prof && riderEmail) {
          try {
            const q2 = query(collection(firestore, 'riders'), where('email', '==', riderEmail), fsLimit(1));
            const s2 = await getDocs(q2);
            prof = s2.docs[0]?.data() as any;
          } catch {}
        }

        // Normalize fields
        const nameFromProf = getNameFromProfile(prof);
        const ratingFromProf = typeof prof?.rating === 'number' ? prof.rating as number : (typeof prof?.avgRating === 'number' ? prof.avgRating as number : undefined);
        const rawAvatarFromProf = prof?.profilePicture || prof?.avatarUrl || prof?.avatarURL || prof?.photoURL || prof?.photoUrl || prof?.profileImageUrl || prof?.imageUrl || prof?.picture || prof?.avatar || prof?.personalInfo?.profilePicture || prof?.personalInfo?.photoURL || prof?.personalInfo?.photoUrl || prof?.personalInfo?.imageUrl;

  // Also probe phone fields on the fetched profile (users doc often stores phoneNumber)
  const phoneFromProf = prof?.phone || prof?.phoneNumber || prof?.phone_number || prof?.personalInfo?.phone || prof?.personalInfo?.phoneNumber;
  if (!phone && phoneFromProf) phone = phoneFromProf;

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

  const seedName = name || (typeof riderEmail === 'string' ? firstNameFromEmail(riderEmail) : undefined);
        const finalName = (nameFromProf && nameFromProf.trim())
          ? nameFromProf
          : (seedName && !isGenericName(seedName) ? seedName : (riderEmail ? String(riderEmail).split('@')[0] : undefined));
        const finalRating = (ratingFromProf ?? null) as number | null;
        const finalPhone = phone ?? null;

        if (!cancelled) {
          setModalRider({ 
            name: finalName, 
            rating: finalRating, 
            phone: finalPhone, 
            avatarUrl: avatarUrl ?? null, 
            vehicleText: undefined,
            preferences: prof?.ridePreferences || null
          });
        }
      } catch {
        if (!cancelled) setModalRider(null);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [modalVisible, selectedRide, offersByRideId, postingReqByPostingId, confirmedByPostingId]);

  // Resolve passenger avatars & phones for group rides (multi-seat) when modal opens
  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      try {
        if (!modalVisible || !selectedRide || !Array.isArray((selectedRide as any).passengers) || (selectedRide as any).passengers.length === 0) {
          if (!cancelled) setModalPassengers([]);
          return;
        }
        const rawList: any[] = (selectedRide as any).passengers;
        const enriched = await Promise.all(rawList.map(async (p) => {
          let avatar = p.avatarUrl;
          let phone = p.phone;
          let rating = (typeof p.rating === 'number') ? p.rating : null;
          // If missing phone/avatar, attempt user document lookup by riderId
          const riderId = p.riderId;
          let userDoc: any = undefined;
          if (riderId) {
            try {
              const d = await getDoc(doc(firestore, 'riders', String(riderId)));
              userDoc = d.exists() ? d.data() : undefined;
            } catch {}
          }
          if (!phone && userDoc) {
            phone = userDoc.phone || userDoc.phoneNumber || userDoc.phone_number || userDoc.personalInfo?.phone || userDoc.personalInfo?.phoneNumber || phone;
          }
          if (rating === null && userDoc) {
            const r = (typeof userDoc.rating === 'number') ? userDoc.rating : (typeof userDoc.avgRating === 'number' ? userDoc.avgRating : undefined);
            if (typeof r === 'number') rating = r;
          }
          if (!avatar && userDoc) {
            avatar = userDoc.profilePicture || userDoc.avatarUrl || userDoc.avatarURL || userDoc.photoURL || userDoc.photoUrl || userDoc.profileImageUrl || userDoc.imageUrl || userDoc.picture || userDoc.avatar || userDoc.personalInfo?.profilePicture || userDoc.personalInfo?.photoURL || userDoc.personalInfo?.photoUrl || avatar;
          }
          // Resolve gs:// storage paths
          if (avatar && typeof avatar === 'string' && !/^https?:\/\//i.test(avatar) && !avatar.startsWith('data:')) {
            // Strip gs://bucket/ if present
            const cleaned = avatar.replace(/^gs:\/\/[^/]+\//, '');
            try {
              avatar = await getDownloadURL(storageRef(storage, cleaned));
            } catch {
              // If resolution fails, drop avatar so placeholder shows
              avatar = undefined;
            }
          }
          // Final sanitization: only allow http(s) or data URIs
          if (!(avatar && ( /^https?:\/\//i.test(avatar) || avatar.startsWith('data:') ))) {
            avatar = undefined;
          }
          return { ...p, avatarUrl: avatar || null, phone: phone || null, rating: (typeof rating === 'number' ? rating : null) };
        }));
        if (!cancelled) setModalPassengers(enriched);
      } catch {
        if (!cancelled) setModalPassengers(rawList => rawList.map(p => ({ ...p, avatarUrl: null })));
      }
    };
    resolve();
    return () => { cancelled = true; };
  }, [modalVisible, selectedRide]);

  // Auto-scroll promotions every 5 seconds
  useEffect(() => {
    if (!promotions || promotions.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentPromotionIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % promotions.length;
        const cardWidth = Dimensions.get('window').width - 36;
        const scrollPosition = nextIndex * cardWidth;
        
        // Scroll to the next promotion using scrollTo
        if (promotionScrollRef.current) {
          promotionScrollRef.current.scrollTo({
            x: scrollPosition,
            animated: true,
          });
        }
        
        return nextIndex;
      });
    }, 5000); // 5 seconds

    return () => clearInterval(interval);
  }, [promotions]);

  return (
    <View style={styles.outerContainer}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Welcome Header - Outside ScrollView */}
        <View style={styles.fixedHeader}>
          <View style={styles.headerRow}>
            <View style={styles.userIcon}>
              {(driverAvatarUrl || userPhoto) ? (
                <Image 
                  source={{ uri: (driverAvatarUrl || userPhoto) as string }} 
                  style={styles.profileImage}
                  onError={() => {
                    // Fallback to default icon if image fails to load
                    if (driverAvatarUrl) {
                      setDriverAvatarUrl(null);
                    } else {
                      setUserPhoto(null);
                    }
                  }}
                  resizeMode="cover"
                />
              ) : (
                <User size={20} color="#64748B" />
              )}
            </View>
            <View style={styles.greetingSection}>
              <Text style={styles.greetingText}>Welcome back,</Text>
              <Text style={styles.userNameText}>{userName ? capitalize(userName) : 'Driver'}</Text>
            </View>
            <TouchableOpacity 
              style={styles.cleanNotificationButton}
              onPress={() => router.push('/driver/notifications')}
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

        {/* Content with ScrollView */}
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
        >
          {/* Student Verification Banner */}
          {!isVerified && !bannerDismissed && (
            <StudentVerificationBanner
              isVerified={isVerified}
              verificationStatus={verificationStatus}
              verificationDeadline={verificationDeadline}
              onDismiss={() => setBannerDismissed(true)}
              onVerifyPress={handleVerifyStudent}
            />
          )}

          {/* Find Rides Button - Inside ScrollView */}
          <View style={styles.findRidesContainer}>
            <TouchableOpacity 
              style={styles.findRidesButton}
              onPress={() => router.push('/driver/requests')}
            >
              <MapPin size={24} color="#FFFFFF" />
              <View style={styles.findRidesTextContainer}>
                <Text style={styles.findRidesTitle}>Find Rides</Text>
                <Text style={styles.findRidesSubtitle}>See ride requests and send an offer</Text>
              </View>
              <View style={styles.findRidesArrow}>
                <Text style={styles.findRidesArrowText}>→</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Your Activity Section */}
          <View style={styles.upcomingSection}>
            <Text style={styles.sectionTitle}>Your Activity</Text>
            
            {/* Activity Stats */}
            <View style={styles.statsContainer}>
              <View style={[styles.statBox, { backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE' }]}>
                <Text style={styles.statNumber}>{stats.totalRides}</Text>
                <Text style={styles.statLabel}>Rides</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: '#DCFCE7', borderWidth: 1, borderColor: '#BBF7D0' }]}>
                <Text style={styles.statNumberGreen}>${stats.totalEarnings?.toFixed ? stats.totalEarnings.toFixed(0) : 0}</Text>
                <Text style={styles.statLabel}>Earned</Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA' }]}>
                <Text style={styles.statNumberOrange}>
                  {stats.avgRating ? `${stats.avgRating.toFixed(1)}` : '—'}
                </Text>
                <Text style={styles.statLabel}>Rating</Text>
              </View>
            </View>
          </View>

          {/* Promotions Section */}
          <View style={styles.upcomingSection}>
            <Text style={styles.sectionTitle}>Promotions</Text>
            
            {promotionsLoading ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color="#E05E1A" />
              </View>
            ) : promotions.length > 0 ? (
              <>
                <View style={{ marginTop: 12 }}>
                  <ScrollView
                    ref={promotionScrollRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingRight: 12 }}
                    snapToInterval={Dimensions.get('window').width - 36}
                    decelerationRate="fast"
                    onScroll={(event) => {
                      const scrollX = event.nativeEvent.contentOffset.x;
                      const itemWidth = Dimensions.get('window').width - 36;
                      const newIndex = Math.round(scrollX / itemWidth);
                      setCurrentPromotionIndex(Math.max(0, Math.min(newIndex, promotions.length - 1)));
                    }}
                    scrollEventThrottle={16}
                  >
                    {promotions.map((item, index) => (
                      <PromotionCard
                        key={item.id}
                        promotion={item}
                        variant={index === 0 ? 'primary' : index === 1 ? 'secondary' : 'tertiary'}
                        onPress={() => {
                          setSelectedPromotion(item);
                          setPromotionModalVisible(true);
                        }}
                      />
                    ))}
                  </ScrollView>
                </View>
                
                {/* Pagination Dots */}
                {promotions.length > 1 && (
                  <View style={styles.paginationDots}>
                    {promotions.map((_, index) => (
                      <View
                        key={index}
                        style={[
                          styles.dot,
                          index === currentPromotionIndex ? styles.activeDot : styles.inactiveDot
                        ]}
                      />
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.emptyUpcoming}>
                <Text style={styles.emptyUpcomingText}>No active promotions at the moment</Text>
              </View>
            )}
          </View>

        {/* Upcoming Rides Section */}
        <View style={styles.upcomingSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming Rides</Text>
            <TouchableOpacity onPress={() => router.push('/settings/ride-history')}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          {loading && (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color="#E05E1A" />
            </View>
          )}

          {!loading && displayUpcoming.length === 0 && (
            <View style={styles.emptyUpcoming}>
              <Text style={styles.emptyUpcomingText}>No rides yet. Offer one to get started.</Text>
            </View>
          )}

          {!loading && displayUpcoming.map((r) => {
            const statusKey = (r.status || '').toLowerCase();
            const offer = offersByRideId[r.id];
            const offerStatus = (offer?.status || '').toLowerCase();
            const hasPendingOffer = !!offer && ['pending','sent','offer','offer_sent','received','offer_received'].includes(offerStatus);
            const isOwnPendingOffer = hasPendingOffer && offer?.driverId && uid && String(offer.driverId) === String(uid);
            const isIncomingPendingOffer = hasPendingOffer && !isOwnPendingOffer;
            const isAcceptedOffer = ['accepted','confirmed'].includes(offerStatus);
            // Confirmed cards should come only from confirmedRides (has a confirmedId)
            const confirmedStatusRaw = String((r as any).confirmedStatus || '').toUpperCase();
            const hasConfirmedRide = !!(r as any).confirmedId;
            // Normalize DRIVER_COMPLETED and RIDER_COMPLETED to IN_PROGRESS for UI display
            const normalizedStatus = (confirmedStatusRaw === 'DRIVER_COMPLETED' || confirmedStatusRaw === 'RIDER_COMPLETED') ? 'IN_PROGRESS' : confirmedStatusRaw;
            const confirmedStatusKey = normalizedStatus.replace(/[-\s]/g, '_');
            const rawStatusKey = String(r?.status || '').toLowerCase();
            const isFlagged = (confirmedStatusKey === 'FLAGGED') || rawStatusKey === 'flagged' || String(r?.status || '').toUpperCase() === 'FLAGGED';
            console.log('[DEBUG] Status check:', {
              id: r.id,
              status: r.status,
              confirmedStatus: (r as any).confirmedStatus,
              confirmedStatusKey,
              rawStatusKey,
              isFlagged
            });
            // isConfirmed means the badge shows "Confirmed" or "In Progress"
            const isConfirmed = hasConfirmedRide && (confirmedStatusKey === 'CONFIRMED' || confirmedStatusKey === 'IN_PROGRESS');
            // isInProgress means the badge shows "In Progress" (after pickup, before completion)
            const isInProgress = hasConfirmedRide && confirmedStatusKey === 'IN_PROGRESS';
            const cardKey = `${r.type}-${r.id}`;
            const isWaiting = !!waitingAfterComplete[cardKey] || (!!(r as any).confirmedDriverComplete && confirmedStatusKey === 'IN_PROGRESS');
            // We no longer render ridePostingRequest cards directly; we only flip the posting card below
            const isOfferReceived = false;
            // Keep legacy "Offer Sent" for other types if needed
            const isOfferSent = (r.type !== 'ridePostingRequest') && ['offer sent','offer_sent','sent'].includes(statusKey);
            // If this is our posting card and there is a pending posting request referencing it, show Offer Received
            const pendingPostingReq = (r.type === 'ridePosting') ? postingReqByPostingId[r.id] : undefined;
            const isOfferReceivedForPosting = !!pendingPostingReq;
            const isPosted = !isConfirmed && !hasPendingOffer && !isAcceptedOffer && !isOfferSent && !isOfferReceivedForPosting && (statusKey === 'posted' || statusKey === 'open');
            const dateText = r.dateTime ? formatDate(r.dateTime) : '';
            
            // Debug log for the problematic ride
            if (r.dateTime && r.dateTime.getHours() === 3) {
              console.log(`[DEBUG] Found 3 AM ride:`, {
                id: r.id,
                type: r.type,
                status: r.status,
                dateTime: r.dateTime.toString(),
                from: r.from,
                to: r.to,
              });
            }

            // --- Group ride aggregated card ---
            if ((r as any).type === 'groupRide') {
              const gr: any = r as any;
              const postingId = String(gr.ridePostingId || gr.id);
              const rawAggStatus = String((gr.confirmedStatus || gr.status) || '').replace(/[-\s]/g, '_').toUpperCase();
              // Normalize DRIVER_COMPLETED and RIDER_COMPLETED to IN_PROGRESS for UI display
              const aggStatus = (rawAggStatus === 'DRIVER_COMPLETED' || rawAggStatus === 'RIDER_COMPLETED') ? 'IN_PROGRESS' : rawAggStatus;
              const isGrpInProgress = aggStatus === 'IN_PROGRESS';
              const isGrpFlagged = aggStatus === 'FLAGGED';
              const passengers: Array<any> = Array.isArray(gr.passengers) ? gr.passengers : [];
              const waitingCount = passengers.filter((p) => String(p?.status || '').toUpperCase() !== 'COMPLETED').length;
              const allCompleted = passengers.length > 0 && passengers.every((p) => String(p?.status || '').toUpperCase() === 'COMPLETED');
              return (
                <View key={`groupRide-${postingId}`} style={styles.rideCard}>
                  <View style={styles.rideHeader}>
                    <View style={[
                      styles.statusBadge,
                      isGrpFlagged ? styles.statusBadgeFlagged : (isGrpInProgress ? styles.statusBadgePending : styles.statusBadgeConfirmed),
                    ]}>
                      <Text style={[
                        styles.statusText,
                        isGrpFlagged ? styles.statusTextFlagged : (isGrpInProgress ? styles.statusTextPending : styles.statusTextConfirmed),
                      ]}>
                        {isGrpFlagged ? 'Flagged' : (isGrpInProgress ? 'In Progress' : 'Confirmed')}
                      </Text>
                    </View>
                    <Text style={[styles.rideDate, { marginLeft: 8 }]}>Group ride</Text>
                    <View style={{ marginLeft: 'auto' }}>
                      <Text style={styles.rideDate}>{dateText}</Text>
                    </View>
                  </View>
                  {(gr.from || gr.to) && (
                    <View style={styles.rideRoute}>
                      {gr.from && (
                        <View style={styles.routePoint}>
                          <View style={styles.orangeDot} />
                          <AddressLink address={gr.from} textStyle={styles.routeText} />
                        </View>
                      )}
                      {gr.to && (
                        <View style={styles.routePoint}>
                          <View style={styles.grayDot} />
                          <AddressLink address={gr.to} textStyle={styles.routeTextGray} />
                        </View>
                      )}
                    </View>
                  )}
                  {/* Summary row with seats and View Details inline */}
                  <View style={[styles.rideFooter, { marginTop: 4, alignItems: 'center' }]}>
                    <Text style={[styles.ridePrice, { flex: 1 }]}>{gr.priceText || ''}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[styles.rideTime, { textAlign: 'right' }]}> {(gr.seatsFilled ?? 0)}/{gr.seatCount ?? 2} seats</Text>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedRide({ ...(r as any), passengers });
                          setModalVisible(true);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="View group ride details"
                      >
                        <Text style={styles.viewDetailsText}>View Details →</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* Primary action */}
                  <View style={[styles.actionRow, { marginTop: 12 }]}> 
                    {!isGrpFlagged && (
                      <TouchableOpacity 
                        onPress={() => { 
                          // Flag entire group ride - use first confirmed ride as reference
                          if (passengers.length > 0 && passengers[0]?.confirmedId) {
                            setFlaggingRideRef({
                              confirmedId: passengers[0].confirmedId,
                              type: 'groupRide',
                              id: postingId,
                              ridePostingId: postingId,
                            });
                            setFlagModalVisible(true);
                          }
                        }} 
                        accessibilityRole="button" 
                        accessibilityLabel="Flag group ride" 
                        style={styles.flagBtn}
                      >
                        <Flag size={22} color="#DC2626" />
                      </TouchableOpacity>
                    )}
                    {aggStatus === 'CONFIRMED' && !waitingGroupAfterComplete[postingId] && (
                      <Button
                        size="sm"
                        variant="primary"
                        onPress={async () => {
                          try {
                            const res = await groupPickup(postingId);
                            try { console.log('analytics', 'group_ride_pickup', { ridePostingId: postingId, riderIds: res.riderIds }); } catch {}
                          } catch {}
                        }}
                      >
                        Pick Up
                      </Button>
                    )}
                    {aggStatus === 'IN_PROGRESS' && !waitingGroupAfterComplete[postingId] && (
                      <Button
                        size="sm"
                        variant="primary"
                        onPress={async () => {
                          try {
                            const res = await groupComplete(postingId);
                            setWaitingGroupAfterComplete((m) => ({ ...m, [postingId]: true }));
                            try { console.log('analytics', 'group_ride_complete_request', { ridePostingId: postingId, riderIds: res.riderIds }); } catch {}
                          } catch {}
                        }}
                      >
                        Complete Ride
                      </Button>
                    )}
                    {allCompleted && (
                      <Button
                        size="sm"
                        variant="primary"
                        onPress={async () => {
                          try {
                            const base = getApiBaseUrl();
                            const token = await firebaseAuth.currentUser?.getIdToken();
                            const resp = await fetch(`${base}/driver/posting/${encodeURIComponent(postingId)}/capture-completed`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                              body: JSON.stringify({ userId: firebaseAuth.currentUser?.uid }),
                            });
                            if (!resp.ok) {
                              let msg = 'Payment capture failed';
                              try { const j = await resp.json(); msg = j?.error || j?.message || msg; } catch {}
                              Alert.alert('Capture Failed', msg);
                            } else {
                              const data = await resp.json().catch(() => ({}));
                              try { console.log('payments_capture', data); } catch {}
                              Alert.alert('Payments Captured', 'Passenger payments have been captured.');
                            }
                          } catch (e) {
                            Alert.alert('Error', 'Could not capture payments.');
                          }
                        }}
                      >
                        Capture Payments
                      </Button>
                    )}
                  </View>
                  {(waitingGroupAfterComplete[postingId] || (aggStatus === 'IN_PROGRESS' && waitingCount > 0)) && (
                    <Text style={styles.waitingText}>
                      Waiting for {waitingCount} rider(s) to confirm completion…
                    </Text>
                  )}
                </View>
              );
            }
            return (
              <View key={`${r.type}-${r.id}`} style={styles.rideCard}>
                <View style={styles.rideHeader}>
                  <View style={(isIncomingPendingOffer || isOfferReceivedForPosting || isOwnPendingOffer || isOfferSent)
                    ? styles.statusBadgeOffer
                    : (isPosted
                      ? styles.statusBadgePosted
                      : [styles.statusBadge, isFlagged ? styles.statusBadgeFlagged : (isConfirmed ? styles.statusBadgeConfirmed : styles.statusBadgePending)])}>
                    <Text style={(isIncomingPendingOffer || isOfferReceivedForPosting || isOwnPendingOffer || isOfferSent)
                      ? styles.statusTextOffer
                      : (isPosted
                        ? styles.statusTextPosted
                        : [styles.statusText, isFlagged ? styles.statusTextFlagged : (isConfirmed ? styles.statusTextConfirmed : styles.statusTextPending)])}>
                      {(isIncomingPendingOffer || isOfferReceivedForPosting)
                        ? 'Offer Received'
                        : ((isOwnPendingOffer || isOfferSent)
                          ? 'Offer Sent'
                          : (isFlagged
                            ? 'Flagged'
                            : (isConfirmed
                              ? (isInProgress ? 'In Progress' : 'Confirmed')
                              : prettyStatus(r.status))))}
                    </Text>
                  </View>
                  <Text style={styles.rideDate}>{dateText}</Text>
                  {r.type === 'ridePosting' && ((r as any).seatCount ?? 1) > 1 && (
                    <Text style={[styles.rideDate, { marginLeft: 8 }]}>
                      {(confirmedCountByPostingId[r.id] || 0)}/{(r as any).seatCount} passengers
                    </Text>
                  )}
                </View>
                {(r.from || r.to) && (
                  <View style={styles.rideRoute}>
                    {r.from && (
                      <View style={styles.routePoint}>
                        <View style={styles.orangeDot} />
                        <AddressLink address={r.from} textStyle={styles.routeText} />
                      </View>
                    )}
                    {r.to && (
                      <View style={styles.routePoint}>
                        <View style={styles.grayDot} />
                        <AddressLink address={r.to} textStyle={styles.routeTextGray} />
                      </View>
                    )}
                  </View>
                )}
                <View style={styles.rideFooter}>
                  <Text style={[styles.ridePrice, { flex: 1 }]}>{offer?.priceText ?? r.priceText ?? ''}</Text>
                  <Text style={[styles.rideTime, { textAlign: 'right', marginRight: 12 }]}>
                    {(offer?.durationText ?? r.durationText) ?? ''}{(offer?.distanceText ?? r.distanceText) ? ((offer?.durationText ?? r.durationText) ? ` • ${(offer?.distanceText ?? r.distanceText)}` : (offer?.distanceText ?? r.distanceText)) : ''}
                  </Text>
                  {r.type === 'ridePosting' && (
                    <TouchableOpacity
                      onPress={() => {
                        const p = new URLSearchParams();
                        const n = (userName || (r as any).driverName || '').toString().split(' ')[0];
                        if (n) p.set('name', n);
                        if (r.from) p.set('from', r.from);
                        if (r.to) p.set('to', r.to);
                        const q = p.toString();
                        const url = `https://ridealongapp.com/ride/${r.id}${q ? '?' + q : ''}`;
                        Share.share({ message: `I'm offering a ride on RideAlong!\n${url}`, url }).catch(() => {});
                      }}
                      style={{ marginRight: 12, padding: 2 }}
                      accessibilityRole="button"
                      accessibilityLabel="Share this ride posting"
                    >
                      <Share2 size={16} color="#E05E1A" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => openRideDetails(r)}>
                    <Text style={styles.viewDetailsText}>View Details →</Text>
                  </TouchableOpacity>
                </View>

                {/* Primary actions for confirmed or in-progress rides at the bottom of the card */}
                {hasConfirmedRide && confirmedStatusKey === 'CONFIRMED' && !isIncomingPendingOffer && !isOfferReceivedForPosting && !isOwnPendingOffer && !waitingAfterPickup[cardKey] && !waitingAfterComplete[cardKey] && (
                  <View style={[styles.actionRow, { marginTop: 10 }]}> 
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity onPress={() => { setFlaggingRideRef(r); setFlagModalVisible(true); }} accessibilityRole="button" accessibilityLabel="Flag ride" style={styles.flagBtn}>
                        <Flag size={22} color="#DC2626" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openChatForRide(r)} accessibilityRole="button" accessibilityLabel="Chat" style={styles.chatBtn}>
                        <MessageCircle size={22} color="#E05E1A" />
                      </TouchableOpacity>
                    </View>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={!!rideActionLoading[`pickup-${r.type}-${r.id}`]}
                      disabled={!!rideActionLoading[`pickup-${r.type}-${r.id}`]}
                      style={[styles.primaryBtn, { opacity: rideActionLoading[`pickup-${r.type}-${r.id}`] ? 0.6 : 1 }]}
                      onPress={async () => {
                        const key = `pickup-${r.type}-${r.id}`;
                        setRideActionLoading((m) => ({ ...m, [key]: true }));
                        try {
                          const ok = await actionConfirmPickup({
                            confirmedId: r.confirmedId,
                            rideRequestId: r.type === 'rideRequest' ? r.id : undefined,
                            ridePostingId: r.type === 'ridePosting' ? r.id : undefined,
                            riderId: r.riderId,
                          });
                          if (ok) setWaitingAfterPickup((prev) => ({ ...prev, [cardKey]: true }));
                        } finally {
                          setRideActionLoading((m) => ({ ...m, [key]: false }));
                        }
                      }}
                    >
                      Pick up
                    </Button>
                  </View>
                )}

                {/* Waiting message after pickup remains below actions */}

                {waitingAfterPickup[cardKey] && confirmedStatusKey === 'CONFIRMED' && (
                  <Text style={styles.waitingText}>Waiting for rider to confirm pickup…</Text>
                )}

                {/* Complete action when ride is in progress - bottom-left */}
                {hasConfirmedRide && isInProgress && !isIncomingPendingOffer && !isOfferReceivedForPosting && !isOwnPendingOffer && !isWaiting && (
                  <View style={[styles.actionRow, { marginTop: 10 }]}> 
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity onPress={() => { setFlaggingRideRef(r); setFlagModalVisible(true); }} accessibilityRole="button" accessibilityLabel="Flag ride" style={styles.flagBtn}>
                        <Flag size={22} color="#DC2626" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => openChatForRide(r)} accessibilityRole="button" accessibilityLabel="Chat" style={styles.chatBtn}>
                        <MessageCircle size={22} color="#E05E1A" />
                      </TouchableOpacity>
                    </View>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={!!rideActionLoading[`complete-${r.type}-${r.id}`]}
                      disabled={!!rideActionLoading[`complete-${r.type}-${r.id}`]}
                      style={[styles.primaryBtn, { opacity: rideActionLoading[`complete-${r.type}-${r.id}`] ? 0.6 : 1 }]}
                      onPress={async () => {
                        const key = `complete-${r.type}-${r.id}`;
                        setRideActionLoading((m) => ({ ...m, [key]: true }));
                        try {
                          const ok = await actionCompleteRide({
                            confirmedId: r.confirmedId,
                            rideRequestId: r.type === 'rideRequest' ? r.id : undefined,
                            ridePostingId: r.type === 'ridePosting' ? r.id : undefined,
                            riderId: r.riderId,
                          });
                          if (ok) {
                            setWaitingAfterComplete((prev) => ({ ...prev, [cardKey]: true }));
                          }
                        } finally {
                          setRideActionLoading((m) => ({ ...m, [key]: false }));
                        }
                      }}
                    >
                      Complete ride
                    </Button>
                  </View>
                )}

                {hasConfirmedRide && isWaiting && (
                  <Text style={styles.waitingText}>Waiting for rider to confirm completion…</Text>
                )}

  {(isIncomingPendingOffer || isOfferReceived || isOfferReceivedForPosting) && (
                  <View style={[styles.offerActionsRow, { justifyContent: 'flex-end' }]}>
                    <Button
                      size="sm"
                      variant="outline"
                      style={styles.rejectBtn}
                      onPress={() => (r.type === 'ridePostingRequest' ? rejectPostingRequest(r.id) : (isOfferReceivedForPosting ? rejectPostingRequest(postingReqByPostingId[r.id].id) : rejectOffer(r.id)))}
                    >
                      Reject Offer
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      style={styles.acceptBtn}
                      onPress={() => (r.type === 'ridePostingRequest' ? acceptPostingRequest(r.id) : (isOfferReceivedForPosting ? acceptPostingRequest(postingReqByPostingId[r.id].id) : acceptOffer(r.id)))}
                    >
                      Accept Offer
                    </Button>
                  </View>
                )}

                {/* Cancel button for Offer Sent cards */}
                {(isOwnPendingOffer || isOfferSent) && !isConfirmed && (
                  <View style={[styles.offerActionsRow, { justifyContent: 'flex-end', marginTop: 10 }]}>
                    <Button
                      size="sm"
                      variant="outline"
                      style={styles.rejectBtn}
                      onPress={() => cancelOffer(r.id)}
                    >
                      Cancel Offer
                    </Button>
                  </View>
                )}

                {/* Cancel Posting button for Posted rides */}
                {isPosted && r.type === 'ridePosting' && (
                  <View style={[styles.offerActionsRow, { justifyContent: 'flex-end', marginTop: 10 }]}>
                    <Button
                      size="sm"
                      variant="outline"
                      style={styles.rejectBtn}
                      onPress={() => {
                        Alert.alert(
                          'Cancel Posting',
                          'Are you sure you want to cancel this ride posting?',
                          [
                            { text: 'No', style: 'cancel' },
                            {
                              text: 'Yes',
                              style: 'destructive',
                              onPress: async () => {
                                try {
                                  const postingRef = doc(firestore, 'ridePostings', r.id);
                                  await updateDoc(postingRef, {
                                    status: 'cancelled',
                                    cancelledAt: serverTimestamp(),
                                  });
                                  Alert.alert('Success', 'Ride posting cancelled');
                                } catch (err) {
                                  console.error('Failed to cancel posting:', err);
                                  Alert.alert('Error', 'Failed to cancel posting');
                                }
                              },
                            },
                          ]
                        );
                      }}
                    >
                      Cancel Posting
                    </Button>
                  </View>
                )}
              </View>
            );
          })}
        </View>

  {/* Removed redundant Active Rides section */}

        {/* Recent Completed Rides */}
        <View style={styles.upcomingSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Rides</Text>
          </View>
          {recentConfirmed.length === 0 ? (
            <View style={styles.emptyUpcoming}><Text style={styles.emptyUpcomingText}>No recent rides.</Text></View>
          ) : (
            recentConfirmed.slice(0, 3).map((cr) => {
              const key = logicalRideKey(cr);
              const price = getPriceText(cr);
              const date = getDateFromConfirmed(cr);
              const canRate = uid ? (canDriverRateRide(cr, uid) && ratedByMe[cr.id] !== true) : false;
              const seatCount = (cr as any)?._seatCount;
              return (
                <View key={key} style={styles.rideCard}>
                  <View style={styles.rideHeader}>
                    <View style={[styles.statusBadge, styles.statusBadgeCompleted]}>
                      <Text style={[styles.statusText, styles.statusTextCompleted]}>Completed</Text>
                    </View>
                    <Text style={styles.rideDate}>{date ? formatDate(date) : ''}</Text>
                  </View>
                  {(getAddress(cr, 'pickup') || getAddress(cr, 'dropoff')) && (
                    <View style={styles.rideRoute}>
                      {getAddress(cr, 'pickup') && (
                        <View style={styles.routePoint}>
                          <View style={styles.orangeDot} />
                          <Text style={styles.routeText}>{getAddress(cr, 'pickup')}</Text>
                        </View>
                      )}
                      {getAddress(cr, 'dropoff') && (
                        <View style={styles.routePoint}>
                          <View style={styles.grayDot} />
                          <Text style={styles.routeTextGray}>{getAddress(cr, 'dropoff')}</Text>
                        </View>
                      )}
                    </View>
                  )}
                  <View style={styles.rideFooter}>
                    <Text style={[styles.ridePrice, { flex: 1 }]}>{price}{seatCount > 1 ? ` · ${seatCount} seats` : ''}</Text>
                    <TouchableOpacity onPress={() => router.push('/settings/ride-history')} accessibilityRole="button" accessibilityLabel="View ride history">
                      <Text style={styles.viewDetailsText}>View History →</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
        </ScrollView>
      </SafeAreaView>

    {/* Inline rider profile shown below rider info (no second modal) */}

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
              {(() => {
                // Compute effective duration/distance for modal from offer or selected card
                const modalOffer = offersByRideId[selectedRide.id];
                // @ts-ignore local shadowing is fine within IIFE scope for rendering
                var _modalDurationText = modalOffer?.durationText ?? selectedRide.durationText;
                // @ts-ignore
                var _modalDistanceText = modalOffer?.distanceText ?? selectedRide.distanceText;
                // Stash on selectedRide for simple interpolation below via closure
                (selectedRide as any).__modalDurationText = _modalDurationText;
                (selectedRide as any).__modalDistanceText = _modalDistanceText;
                return null;
              })()}
              {/* Rider Information or Status (hide for posted ride postings with no requests) */}
              {(() => {
                const isPosting = selectedRide?.type === 'ridePosting';
                const statusKey = String(selectedRide?.status || '').toLowerCase();
                const hasPendingPostingReq = isPosting && postingReqByPostingId[selectedRide!.id];
                const isPostingConfirmed = isPosting && confirmedByPostingId[selectedRide!.id];
                const hideRiderInfo = isPosting && !isPostingConfirmed && !hasPendingPostingReq && (statusKey === 'posted' || statusKey === 'open');
                if (hideRiderInfo) {
                  return (
                    <View style={styles.modalSection}>
                      <Text style={styles.sectionTitleModal}>Status</Text>
                      <Text style={{ color: '#64748B' }}>Waiting for rider requests</Text>
                    </View>
                  );
                }
                // Multi-passenger (group ride) rendering: show all passengers if present on selectedRide
                const passengerList: any[] = (modalPassengers.length > 0)
                  ? modalPassengers
                  : (Array.isArray((selectedRide as any)?.passengers) ? (selectedRide as any).passengers : []);
                if (passengerList.length > 0) {
                  return (
                    <View style={styles.modalSection}>
                      <Text style={styles.sectionTitleModal}>Passengers ({passengerList.length})</Text>
                      <View style={{ gap: 12 }}>
                        {passengerList.map((p, idx) => {
                          const pid = p?.riderId || p?.id || `p-${idx}`;
                          const pName = p?.name || 'Passenger';
                          const pRating = (typeof p?.rating === 'number') ? p.rating : null;
                          const canCall = !!p?.phone;
                          return (
                            <View key={String(pid)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12 }}>
                              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => {
                                if (pid) router.push({ pathname: '/rider/[id]', params: { id: String(pid) } });
                              }} accessibilityRole="button" accessibilityLabel={`Open ${pName} profile`}>
                                {p?.avatarUrl ? (
                                  <Image source={{ uri: p.avatarUrl }} style={styles.driverAvatarImg} />
                                ) : (
                                  <View style={styles.driverAvatar}>
                                    <User size={24} color="#64748B" />
                                  </View>
                                )}
                                <View style={{ marginLeft: 12, flex: 1 }}>
                                  <Text style={styles.driverName}>{pName}</Text>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                    <Star size={14} color="#F59E0B" fill="#F59E0B" />
                                    <Text style={{ marginLeft: 4, fontSize: 13, color: '#64748B', fontWeight: '500' }}>{pRating !== null ? pRating.toFixed(1) : '—'}</Text>
                                  </View>
                                </View>
                              </TouchableOpacity>
                              {canCall ? (
                                <TouchableOpacity
                                  onPress={() => {
                                    const telUrl = `tel:${String(p.phone).replace(/[^0-9+]/g, '')}`;
                                    Linking.openURL(telUrl).catch(() => {
                                      Alert.alert('Unable to open dialer', 'Please try again or check device permissions.');
                                    });
                                  }}
                                  style={[styles.callIconBtn, { backgroundColor: theme.colors.secondary, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Call ${pName}`}
                                >
                                  <Phone size={20} color="#FFFFFF" />
                                </TouchableOpacity>
                              ) : (
                                <View style={[styles.callIconBtn, { backgroundColor: '#F1F5F9', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: 0.5 }]} accessibilityRole="image" accessibilityLabel={`Phone for ${pName} not provided`}>
                                  <Phone size={20} color="#94A3B8" />
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                }
                // Fallback to single rider detail rendering
                return (
                  (modalRider?.name || modalRider?.avatarUrl || (typeof modalRider?.rating === 'number')) ? (
                    <View style={styles.modalSection}>
                      <Text style={styles.sectionTitleModal}>Rider Information</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={[styles.driverInfo, { flex: 1, marginRight: 8 }] }>
                          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => {
                            const rid = (selectedRide as any)?.riderId || (modalRider as any)?.id;
                            if (rid) router.push({ pathname: '/rider/[id]', params: { id: String(rid) } });
                          }}>
                            {modalRider?.avatarUrl ? (
                              <Image source={{ uri: modalRider.avatarUrl }} style={styles.driverAvatarImg} />
                            ) : (
                              <View style={styles.driverAvatar}>
                                <User size={24} color="#64748B" />
                              </View>
                            )}
                            <View style={[styles.driverDetails, { flex: 1 }] }>
                              <Text style={styles.driverName}>{modalRider?.name ?? 'Loading…'}</Text>
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={styles.ratingModalContainer}>
                                  <Star size={14} color="#F59E0B" fill="#F59E0B" />
                                  <Text style={styles.ratingModalText}>
                                    {typeof modalRider?.rating === 'number' ? modalRider.rating.toFixed(1) : '4.9'}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </TouchableOpacity>
                          {(() => {
                            const s: any = selectedRide as any;
                            const phone = s?.riderPhone
                              || s?.driverPhone
                              || s?.phone
                              || s?.phoneNumber
                              || s?.rider?.phone
                              || s?.rider?.phoneNumber
                              || s?.riderPhoneNumber
                              || s?.rider_phone
                              || s?.driver?.phoneNumber
                              || s?.driver?.phone
                              || modalRider?.phone
                              || (modalRider as any)?.phoneNumber;
                            if (phone) {
                              return (
                                <TouchableOpacity
                                  onPress={() => {
                                    const telUrl = `tel:${String(phone).replace(/[^0-9+]/g, '')}`;
                                    Linking.openURL(telUrl).catch(() => {
                                      Alert.alert('Unable to open dialer', 'Please try again or check device permissions.');
                                    });
                                  }}
                                  style={[styles.callIconBtn, { backgroundColor: theme.colors.secondary, width: 44, height: 44, borderRadius: 22, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' }]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Call rider`}
                                >
                                  <Phone size={20} color="#FFFFFF" />
                                </TouchableOpacity>
                              );
                            }
                            return (
                              <View style={[styles.callIconBtn, { backgroundColor: '#F1F5F9', width: 44, height: 44, borderRadius: 22, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }]} accessibilityRole="image" accessibilityLabel="Phone not provided">
                                <Phone size={20} color="#94A3B8" />
                              </View>
                            );
                          })()}
                        </View>
                      </View>
                      {showRiderProfile && (
                        <View style={{ marginTop: 12, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {modalRider?.avatarUrl ? (
                              <Image source={{ uri: modalRider.avatarUrl }} style={styles.driverAvatarImg} />
                            ) : (
                              <View style={styles.driverAvatar}>
                                <User size={24} color="#64748B" />
                              </View>
                            )}
                            <View style={{ marginLeft: 12 }}>
                              <Text style={styles.driverName}>{modalRider?.name ?? ''}</Text>
                              <View style={styles.ratingModalContainer}>
                                <Star size={14} color="#F59E0B" fill="#F59E0B" />
                                <Text style={styles.ratingModalText}>
                                  {typeof modalRider?.rating === 'number' ? modalRider.rating.toFixed(1) : '4.9'}
                                </Text>
                              </View>
                            </View>
                          </View>
                          <View style={{ marginTop: 12 }}>
                            <Text style={styles.sectionTitleModal}>Ride Preferences</Text>
                            {modalRider?.preferences ? (
                              <View style={{ gap: 8 }}>
                                {Object.entries(modalRider.preferences).map(([key, value]) => (
                                  <View key={key} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EEF2F7', borderRadius: 10, padding: 10 }}>
                                    <View style={{ marginRight: 10 }}>
                                      {key === 'musicPreference' ? <Music size={16} color="#64748B" />
                                        : key === 'temperaturePreference' ? <Thermometer size={16} color="#64748B" />
                                        : key === 'conversationLevel' ? <MessageCircle size={16} color="#64748B" />
                                        : key === 'allowSmoking' ? <Cigarette size={16} color="#64748B" />
                                        : key === 'allowPets' ? <Heart size={16} color="#64748B" />
                                        : <User size={16} color="#64748B" />}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 14, fontWeight: '500', color: '#1F2937' }}>
                                        {key === 'musicPreference' ? 'Music' :
                                          key === 'temperaturePreference' ? 'Temperature' :
                                          key === 'conversationLevel' ? 'Conversation' :
                                          key === 'allowSmoking' ? 'Smoking' :
                                          key === 'allowPets' ? 'Pets' : key}
                                      </Text>
                                      <Text style={{ fontSize: 13, color: '#64748B' }}>
                                        {key === 'musicPreference' ? (value === 'none' ? 'No music' : value === 'quiet' ? 'Quiet music' : value === 'normal' ? 'Normal volume' : 'Loud music')
                                          : key === 'temperaturePreference' ? (value === 'cold' ? 'Cool' : value === 'normal' ? 'Normal' : 'Warm')
                                          : key === 'conversationLevel' ? (value === 'quiet' ? 'Quiet ride' : value === 'normal' ? 'Normal conversation' : 'Chatty')
                                          : key === 'allowSmoking' ? (value ? 'Smoking allowed' : 'No smoking')
                                          : key === 'allowPets' ? (value ? 'Pets welcome' : 'No pets')
                                          : String(value)}
                                      </Text>
                                    </View>
                                  </View>
                                ))}
                              </View>
                            ) : (
                              <Text style={{ color: '#64748B', fontStyle: 'italic' }}>No preferences specified</Text>
                            )}
                          </View>
                        </View>
                      )}
                    </View>
                  ) : null
                );
              })()}

              {/* Status Badge */}
              {(() => {
                const effStatusKey = String(((selectedRide as any).confirmedStatus || selectedRide.status) || '').toLowerCase();
                const isPosted = effStatusKey === 'posted' || effStatusKey === 'open';
                const isGood = ['confirmed','matched','driver-arriving','in-progress','in_progress'].includes(effStatusKey);
                return (
                  <View style={[
                    styles.statusBadgeModal,
                    isPosted ? styles.statusBadgePosted : (isGood ? styles.statusBadgeConfirmed : styles.statusBadgePendingModal)
                  ]}>
                    <Text style={[
                      styles.statusTextModal,
                      isPosted ? styles.statusTextPosted : (isGood ? styles.statusTextConfirmed : styles.statusTextPendingModal)
                    ]}>
                      {prettyStatus((selectedRide as any).confirmedStatus || selectedRide.status)}
                    </Text>
                  </View>
                );
              })()}

              {/* Route Information */}
              {(selectedRide.from || selectedRide.to) && (
                <View style={styles.modalSection}>
                  <Text style={styles.sectionTitleModal}>Route</Text>
                  <View style={styles.routeModalContainer}>
                    {selectedRide.from && (
                      <View style={styles.routeModalPoint}>
                        <View style={styles.orangeDotModal} />
                        <AddressLink address={selectedRide.from} textStyle={styles.locationModalText} />
                      </View>
                    )}
                    {selectedRide.from && selectedRide.to && (<View style={styles.routeModalLine} />)}
                    {selectedRide.to && (
                      <View style={styles.routeModalPoint}>
                        <MapPin size={16} color="#EF4444" />
                        <AddressLink address={selectedRide.to} textStyle={styles.locationModalText} />
                      </View>
                    )}
                  </View>
                </View>
              )}


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
        <Text style={styles.infoValue}>{(selectedRide as any).__modalDistanceText ?? selectedRide.distanceText ?? '—'}</Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
      </Modal>
    )}

    {/* Flag Ride Modal */}
    <FlagRideModal
      visible={flagModalVisible}
      onClose={() => { setFlagModalVisible(false); setFlaggingRideRef(null); }}
      onSubmit={async (data) => {
        // Compose payload
        const payload = {
          reason: data.reason,
          details: data.details || null,
          flaggedByRole: 'driver',
          flaggedById: firebaseAuth.currentUser?.uid ?? null,
        };
        // optimistic UI: set ride status locally to 'flagged' and keep visible
        if (!flaggingRideRef) return false;
        const cardKey = `${flaggingRideRef.type}-${flaggingRideRef.id}`;
        try {
          setFlaggingLoading(true);
          // update local confirmed map if present
          if (flaggingRideRef.confirmedId) {
            setUpcConfirmed((prev) => {
              const next = { ...prev } as any;
              const key = `${flaggingRideRef.type}-${flaggingRideRef.id}`;
              if (next[key]) {
                next[key] = { ...next[key], status: 'flagged', confirmedStatus: 'flagged' };
              }
              return next;
            });
            // Also update combined upcoming list
            setUpcoming((prev) => prev.map((it) => (it.type === flaggingRideRef.type && it.id === flaggingRideRef.id) ? { ...it, status: 'flagged' } : it));
          }

          const success = await flagRide({
            confirmedId: flaggingRideRef.confirmedId,
            rideRequestId: flaggingRideRef.type === 'rideRequest' ? flaggingRideRef.id : undefined,
            ridePostingId: flaggingRideRef.type === 'ridePosting' ? flaggingRideRef.id : undefined,
            riderId: flaggingRideRef.riderId,
          }, payload as any);

          // Analytics events - simple console events (no analytics lib found)
          try { console.log('analytics', 'driver_flag_submitted', { ride: flaggingRideRef.id }); } catch {}

          if (!success) {
            // rollback optimistic
            if (flaggingRideRef.confirmedId) {
              setUpcConfirmed((prev) => {
                const next = { ...prev } as any;
                const key = `${flaggingRideRef.type}-${flaggingRideRef.id}`;
                if (next[key]) {
                  next[key] = { ...next[key], status: 'CONFIRMED', confirmedStatus: 'CONFIRMED' };
                }
                return next;
              });
              setUpcoming((prev) => prev.map((it) => (it.type === flaggingRideRef.type && it.id === flaggingRideRef.id) ? { ...it, status: 'CONFIRMED' } : it));
            }
            try { console.log('analytics', 'driver_flag_failed', { ride: flaggingRideRef.id }); } catch {}
          }

          return success;
        } catch (e) {
          try { console.log('analytics', 'driver_flag_failed', { ride: flaggingRideRef?.id }); } catch {}
          return false;
        } finally {
          setFlaggingLoading(false);
        }
      }}
    />
    {/* Driver Rating Modal */}
  <DriverRatingModal
      visible={ratingModalVisible}
      riderName={ratingQueue.length > 0 && ratingIdx < ratingQueue.length ? ratingQueue[ratingIdx]?.riderName : (ratingModalRide?.riderName || undefined)}
      onClose={() => {
        setRatingModalVisible(false);
        setRatingModalRide(null);
        setRatingError(null);
        setRatingQueue([]);
        setRatingIdx(0);
      }}
      onSubmit={async ({ stars, comment }) => {
        const target = ratingQueue.length > 0 ? ratingQueue[ratingIdx] : (ratingModalRide ? { rideId: ratingModalRide.id, riderName: ratingModalRide.riderName } : null);
        if (!target) return;
        try {
          setRatingSubmitting(true);
          setRatingError(null);
          // Use callable; do not use fetch
          await submitRating({ rideId: target.rideId, stars, comment });
          // Mark seat rated
          setRatedByMe((prev) => ({ ...prev, [target.rideId]: true }));
          
          // Close current modal first
          setRatingModalVisible(false);
          
          // Show success message
          Alert.alert('Thanks!', 'Your rating was submitted.');
          
          // Refresh stat card after success
          if (uid) await refreshDriverRatingStatCard(uid, setStats);
          
          if (ratingQueue.length > 0 && ratingIdx < ratingQueue.length - 1) {
            // Wait a moment then open modal for next rider
            setTimeout(() => {
              setRatingIdx((i) => i + 1);
              setRatingError(null);
              setRatingModalVisible(true);
            }, 500);
          } else {
            // Done with queue
            setRatingModalRide(null);
            setRatingQueue([]);
            setRatingIdx(0);
          }
        } catch (e: any) {
          const code = e?.code || e?.message;
          const map: Record<string, string> = {
            'already-exists': 'You already rated this ride.',
            'permission-denied': 'Only participants can rate.',
            'failed-precondition': 'Ride must be completed before rating.',
            'out-of-range': 'Rating must be 1–5.',
          };
          const msg = map[String(code)] || (e?.message || 'Failed to submit rating.');
          setRatingError(msg);
          return;
        } finally {
          setRatingSubmitting(false);
        }
      }}
      submitting={ratingSubmitting}
      errorText={ratingError}
    />

    {/* Promotion Details Modal */}
    <PromotionDetailsModal
      promotion={selectedPromotion}
      visible={promotionModalVisible}
      onClose={() => {
        setPromotionModalVisible(false);
        setSelectedPromotion(null);
      }}
      onActivate={(promotion) => {
        // TODO: Implement promotion activation logic
        Alert.alert('Promotion Activated', `You've activated: ${promotion.title}`);
        setPromotionModalVisible(false);
        setSelectedPromotion(null);
      }}
      onSetReminder={(promotion) => {
        // TODO: Implement reminder logic
        Alert.alert('Reminder Set', `We'll remind you about: ${promotion.title}`);
      }}
    />
    </View>
  );
}

function formatDate(d: Date) {
  try {
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = formatTime(d);
    const result = `${dateStr}, ${timeStr}`;
    console.log(`[formatDate] Input Date: ${d.toString()}, Output: "${result}"`);
    return result;
  } catch {
    return d.toString();
  }
}

function isSameLocalDate(a: Date, b: Date) {
  try {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  } catch { return false; }
}

function formatTime(d: Date) {
  try {
    const result = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    console.log(`[formatTime] Date hours: ${d.getHours()}, Result: "${result}"`);
    return result;
  } catch {
    return '';
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

function prettyStatus(s?: string) {
  if (!s) return 'posted';
  const map: Record<string, string> = {
    posted: 'Posted',
  pending: 'Posted',
    open: 'Posted',
  'offer sent': 'Offer Sent',
  'offer_sent': 'Offer Sent',
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
  const key = String(s).toLowerCase();
  return map[key] ?? capitalize(key);
}

function toDateField(v: any): Date | null {
  try {
    if (!v) return null;
    if (v instanceof Date) {
      console.log(`[toDateField] Already a Date: ${v.toString()}`);
      return v;
    }
    if (v instanceof Timestamp) {
      const result = v.toDate();
      console.log(`[toDateField] Timestamp converted: ${result.toString()}`);
      return result;
    }
    if (typeof v === 'number') {
      // Assume millis
      const result = new Date(v);
      console.log(`[toDateField] Number (millis) converted: ${result.toString()}`);
      return result;
    }
    if (typeof v === 'string') {
      console.log(`[toDateField] String input: "${v}"`);
      const d = new Date(v);
      console.log(`[toDateField] String parsed to: ${d.toString()}, Hours: ${d.getHours()}`);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

function extractAddress(r: any, kind: 'pickup' | 'dropoff'): string | undefined {
  // Try multiple shapes used across app surfaces
  const loc = kind === 'pickup' ? (r?.pickupLocation || r?.pickup || r?.from) : (r?.dropoffLocation || r?.dropoff || r?.to);
  if (typeof loc === 'string') return loc;
  if (loc?.address) return loc.address;
  // Alternate explicit fields
  const addr = kind === 'pickup' ? (r?.pickupAddress || r?.fromAddress) : (r?.dropoffAddress || r?.toAddress);
  if (typeof addr === 'string') return addr;
  return undefined;
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
  [...prev, ...incoming].forEach((it) => map.set(`${it.type}-${it.id}`, it));
  return [...map.values()].sort((a, b) => {
    const at = a.dateTime ? a.dateTime.getTime() : 0;
    const bt = b.dateTime ? b.dateTime.getTime() : 0;
    return at - bt;
  });
}

// Helpers for confirmed rides UI
function logicalRideKey(cr: ConfirmedRide): string {
  // Ensure keys are unique even if multiple rides share the same posting+rider
  const base = cr.rideRequestId
    ? `rr_${cr.rideRequestId}`
    : (cr.ridePostingId && cr.riderId)
      ? `rp_${cr.ridePostingId}_${cr.riderId}`
      : 'cr';
  const idPart = cr.id ? String(cr.id) : String(cr.completedAt || cr.confirmedAt || Math.random());
  return `${base}_${idPart}`;
}

// activeConfirmedDedupe removed with Active Rides section

function getAddress(cr: any, kind: 'pickup' | 'dropoff'): string | undefined {
  const loc = kind === 'pickup' ? (cr?.pickup || cr?.pickupLocation) : (cr?.dropoff || cr?.dropoffLocation);
  if (typeof loc === 'string') return loc;
  if (loc?.address) return String(loc.address);
  const addr = kind === 'pickup' ? cr?.pickupAddress : cr?.dropoffAddress;
  if (typeof addr === 'string') return addr;
  return undefined;
}

function getPriceText(cr: any): string {
  const v = cr?.contributionAmount ?? cr?.price;
  if (typeof v === 'number') return `$${v.toFixed(2)}`;
  if (typeof v === 'string') return v;
  return '';
}

function getContributionNumber(cr: any): number | undefined {
  const v = cr?.contributionAmount ?? cr?.price;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseCurrency(v);
  return undefined;
}

function getDistanceText(cr: any): string {
  return extractDistance(cr) ?? '';
}

function getDateFromConfirmed(cr: any): Date | null {
  // Prefer scheduled date/time; fall back to nested originals; finally, use completed/confirmed timestamps
  return (
    composeDateTime(cr?.date, cr?.time) ||
    composeDateTime(cr?.originalRidePosting?.date, cr?.originalRidePosting?.time) ||
    composeDateTime(cr?.originalRideRequest?.date, cr?.originalRideRequest?.time) ||
    composeDateTime(cr?.originalRidePostingRequest?.date, cr?.originalRidePostingRequest?.time) ||
    toDateField(cr?.completedAt || cr?.confirmedAt || cr?.createdAt)
  );
}

// Determine if the current driver can rate the given completed ride
function canDriverRateRide(cr: ConfirmedRide, uid: string): boolean {
  try {
    if (!cr || String(cr.status || '').toUpperCase() !== 'COMPLETED') return false;
    if (!cr.driverId || String(cr.driverId) !== String(uid)) return false;
    // We will check rating existence lazily when opening modal via Firestore; here show CTA optimistically.
    return true;
  } catch {
    return false;
  }
}

function getRideDateTime(r: any): Date | null {
  // Prefer requestedTime; fall back to pickupTime or date, or a composed date/time
  const time = r?.requestedTime ?? r?.pickupTime ?? r?.date ?? (r?.dateString && `${r.dateString} ${r?.timeString || ''}`);
  return toDateField(time);
}

function composeDateTime(dateStr?: any, timeStr?: any): Date | null {
  try {
    if (!dateStr && !timeStr) return null;
    if (dateStr && timeStr && typeof dateStr === 'string' && typeof timeStr === 'string') {
      // Parse date and time components to avoid timezone issues
      const [year, month, day] = dateStr.split('-').map(Number);
      let raw = timeStr.trim();
      let hour: number | undefined;
      let minute: number | undefined;
      // Handle AM/PM (e.g. "3:00 PM", "3 PM", "12:15am", "03:00PM")
      const ampmMatch = /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)$/i.exec(raw.replace(/\s+/g, '')) || /^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)$/i.exec(raw);
      if (ampmMatch) {
        hour = parseInt(ampmMatch[1], 10);
        minute = parseInt(ampmMatch[2] || '0', 10);
        const mer = ampmMatch[3].toLowerCase();
        if (mer === 'pm' && hour < 12) hour += 12;
        if (mer === 'am' && hour === 12) hour = 0;
      } else {
        // Strip any stray AM/PM tokens still attached to minutes segment like "00PM"
        raw = raw.replace(/\s+/g, '');
        raw = raw.replace(/(am|pm)$/i, '');
        const parts = raw.split(':');
        if (parts.length >= 1) hour = Number(parts[0]);
        if (parts.length >= 2) minute = Number(parts[1]);
      }
      if (year && month && day) {
        const d = new Date(year, month - 1, day, (hour ?? 0), (minute ?? 0));
        return isNaN(d.getTime()) ? null : d;
      }
      // Fallback for non-standard formats
      const d = new Date(`${dateStr}T${timeStr}`);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof dateStr === 'string') {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof timeStr === 'string') {
      const d = new Date(timeStr);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch {
    return null;
  }
}

function formatMiles(miles: number | null | undefined) {
  if (typeof miles !== 'number' || !isFinite(miles)) return undefined;
  const precision = miles >= 100 ? 0 : 1;
  return `${miles.toFixed(precision)} mi`;
}

function formatKilometers(km: number | null | undefined) {
  if (typeof km !== 'number' || !isFinite(km)) return undefined;
  return `${km.toFixed(1)} km`;
}

function extractDistance(r: any): string | undefined {
  try {
    if (!r) return undefined;
    const distanceField = r?.distance;
    if (typeof distanceField === 'string' && distanceField.trim()) {
      return distanceField.trim();
    }
    if (typeof distanceField === 'number') {
      return formatMiles(distanceField);
    }
    if (distanceField && typeof distanceField === 'object') {
      if (typeof distanceField.text === 'string' && distanceField.text.trim()) {
        return distanceField.text.trim();
      }
      const milesFromObj =
        formatMiles(distanceField.miles) ||
        formatMiles(distanceField.mi) ||
        formatMiles(distanceField.value ? distanceField.value / 1609.344 : undefined) ||
        formatMiles(distanceField.meters ? distanceField.meters / 1609.344 : undefined);
      if (milesFromObj) return milesFromObj;
      const kmFromObj =
        formatKilometers(distanceField.kilometers) ||
        formatKilometers(distanceField.km) ||
        formatKilometers(distanceField.value ? distanceField.value / 1000 : undefined) ||
        formatKilometers(distanceField.meters ? distanceField.meters / 1000 : undefined);
      if (kmFromObj) return kmFromObj;
    }

    const stringFallbacks = [
      r?.distanceText,
      r?.distanceStr,
      r?.distance_string,
      r?.distance_string_mi,
      r?.distance_string_km,
      r?.distance_label,
    ];
    for (const str of stringFallbacks) {
      if (typeof str === 'string' && str.trim()) return str.trim();
    }

    const mileCandidates = [
      r?.distanceInMiles,
      r?.distanceMiles,
      r?.miles,
      r?.distance_mi,
      r?.distanceMi,
      r?.distanceMI,
    ];
    for (const candidate of mileCandidates) {
      const formatted = formatMiles(candidate);
      if (formatted) return formatted;
    }

    const kmCandidates = [
      r?.distanceKm,
      r?.distanceKM,
      r?.distance_km,
      r?.kilometers,
    ];
    for (const candidate of kmCandidates) {
      const formatted = formatKilometers(candidate);
      if (formatted) return formatted;
    }

    const meterCandidates = [
      r?.distanceMeters,
      r?.distance_meters,
      r?.distanceValue,
      r?.distance_value,
    ];
    for (const candidate of meterCandidates) {
      if (typeof candidate === 'number' && isFinite(candidate)) {
        const formatted =
          formatMiles(candidate / 1609.344) || formatKilometers(candidate / 1000);
        if (formatted) return formatted;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function normalizeStatusForDisplay(s?: string) {
  const key = (s || '').toLowerCase();
  if (key === 'pending' || key === 'open' || key === 'available' || key === 'active' || key === '') return 'posted';
  return key;
}

function getDurationText(r: any): string | undefined {
  // Accept forms: r.duration.text (string), r.duration (string or number minutes), or seconds
  try {
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
    const seconds = r?.durationSeconds ?? r?.duration_secs ?? r?.durationSec;
    if (typeof seconds === 'number') {
      const mins = Math.round(seconds / 60);
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Normalize strings like "3h 18.516m" or "3 hours 18.516 minutes" => "3 hr 19 min"
function normalizeDurationString(s: string): string {
  try {
    const lower = s.toLowerCase();
    // Fast path if it already matches our target pattern
    if (/^\d+\s*hr(\s+\d+\s*min)?$/.test(lower) || /^\d+\s*min$/.test(lower)) return s;
    // Extract hours and minutes as floats
    const hMatch = lower.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour|hours)/);
    const mMatch = lower.match(/(\d+(?:\.\d+)?)\s*(m|min|minute|minutes)/);
    let h = hMatch ? parseFloat(hMatch[1]) : 0;
    let m = mMatch ? parseFloat(mMatch[1]) : 0;
    if (!hMatch && !mMatch) {
      // Try a plain "X.Y min"
      const onlyMin = lower.match(/(\d+(?:\.\d+)?)\s*m/);
      if (onlyMin) m = parseFloat(onlyMin[1]);
    }
    // Convert fractional hours to minutes
    if (h && h % 1 !== 0) {
      const frac = h - Math.floor(h);
      m += frac * 60;
      h = Math.floor(h);
    }
    // Round minutes and carry over to hours
    m = Math.round(m);
    if (m >= 60) {
      h += Math.floor(m / 60);
      m = m % 60;
    }
    if (h > 0 && m > 0) return `${h} hr ${m} min`;
    if (h > 0) return `${h} hr`;
    if (m > 0) return `${m} min`;
    return s;
  } catch {
    return s;
  }
}

// Build a signature key for deduping visually identical rides
// (no-op) route/time signature removed; we now show all upcoming items

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

function firstNameFromEmail(email: string): string | null {
  try {
    const prefix = String(email || '').split('@')[0] || '';
    if (!prefix) return null;
    const token = prefix.split(/[._-]+/)[0] || prefix;
    return token || null;
  } catch {
    return null;
  }
}

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
    marginTop: -16,
    paddingTop: 16,
  },

  // Clean Header Styles
  fixedHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  cleanHeader: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  findRidesContainer: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  userIcon: {
    backgroundColor: '#F1F5F9',
    borderRadius: 25,
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
  findRidesButton: {
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
  findRidesTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  findRidesTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  findRidesSubtitle: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  findRidesArrow: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  findRidesArrowText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },

  // Promotions Section
  promotionsContainer: {
    gap: 12,
    marginTop: 12,
  },
  promotionsScrollContainer: {
    paddingLeft: 0,
    paddingRight: 0,
  },
  promotionsScroll: {
    marginTop: 16,
  },
  paginationDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  activeDot: {
    backgroundColor: '#E05E1A',
    width: 24,
  },
  inactiveDot: {
    backgroundColor: '#E5E7EB',
  },
  primaryPromotionCard: {
    backgroundColor: '#E05E1A',
    borderRadius: 16,
    padding: 16,
    marginRight: 16,
    width: Dimensions.get('window').width - 56, // Reduced width for better fit
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  secondaryPromotionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginRight: 16,
    width: Dimensions.get('window').width - 56, // Reduced width for better fit
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  tertiaryPromotionCard: {
    backgroundColor: '#1A2942',
    borderRadius: 16,
    padding: 16,
    marginRight: 16,
    width: Dimensions.get('window').width - 56, // Reduced width for better fit
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  promotionIcon: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
  },
  secondaryPromotionIcon: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
  },
  tertiaryPromotionIcon: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
  },
  promotionContent: {
    flex: 1,
  },
  promotionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  promotionSubtitle: {
    fontSize: 14,
    color: '#FFFFFF',
    opacity: 0.9,
  },
  secondaryPromotionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  secondaryPromotionSubtitle: {
    fontSize: 14,
    color: '#64748B',
  },
  promotionArrow: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  promotionArrowText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryPromotionArrowText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Full Width Promotion Cards
  fullWidthPromotionCard: {
    backgroundColor: '#E05E1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  fullWidthSecondaryPromotionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  fullWidthTertiaryPromotionCard: {
    backgroundColor: '#1A2942',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 35,
    flexGrow: 1,
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
  // Activity Stats
  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    marginTop: 12,
  },
  statBox: {
    borderRadius: 12,
    padding: 16,
    flex: 1,
    alignItems: 'center',
    borderWidth: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
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
  // Section Styles  
  upcomingSection: {
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
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
  // Empty state for Upcoming Rides
  emptyUpcoming: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyUpcomingText: {
    color: '#6B7280',
    textAlign: 'center',
  },
  // Ride Cards
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
  statusBadgeFlagged: {
    backgroundColor: '#FEE2E2',
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
  rideTime: {
    fontSize: 12,
    color: '#6B7280',
  },
  ridePrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  statusTextFlagged: {
    color: '#991B1B',
    fontWeight: '700',
  },
  statusBadgeSmall: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeSmallText: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '500',
  },
  flagBtn: {
  padding: 8,
  borderRadius: 8,
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 0,
  },
  chatBtn: {
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 0,
  },
  viewDetailsText: {
    fontSize: 12,
    color: '#E05E1A',
    fontWeight: '500',
  },
  viewProfileButton: {
    // circular by default when used as contact icon; width/height overridden inline for small square
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    marginTop: 12,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewProfileButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  callIconBtn: { marginLeft: 12, padding: 8, borderRadius: theme.borderRadius.full, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  // Community & Promotions
  communitySection: {
    marginTop: 5,
    marginBottom: 30,
    gap: 12,
  },
  communityCard: {
    backgroundColor: '#1A2942',
    borderRadius: 16,
  padding: 16,
  // Extra right padding so text doesn't overlap the icon bubble
  paddingRight: 20,
    position: 'relative',
  },
  communityTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  communitySubtitle: {
    color: '#E5E7EB',
  lineHeight: 18,
  maxWidth: '88%',
  },
  communityIconWrap: {
    position: 'absolute',
    right: 16,
    top: '50%',
    transform: [{ translateY: -22 }],
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityIconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginTop: 30,
  },
  promosRow: {
    flexDirection: 'row',
    gap: 12,
  },
  promoCard: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
  },
  promoPrimary: {
    backgroundColor: '#4F46E5',
  },
  promoSecondary: {
    backgroundColor: '#F1F5F9',
  },
  promoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  promoHeaderText: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  promoTitle: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  promoSubtitle: {
    color: '#374151',
    fontSize: 12,
  },
  promoCodePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  promoCodeText: {
    color: '#111827',
    fontWeight: '700',
    letterSpacing: 1,
  },
  shareBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0B1220',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  offerActionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  gap: 10,
  justifyContent: 'flex-end',
    marginBottom: 8,
  },
  acceptBtn: {
  // keep size via padding, let Button control colors/radius
  paddingHorizontal: 14,
  paddingVertical: 10,
  },
  primaryBtn: {
  // keep size via padding, let Button control colors/radius
  paddingHorizontal: 16,
  paddingVertical: 10,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  smallPrimaryBtn: {
  // keep size via padding, let Button control colors/radius
  paddingHorizontal: 12,
  paddingVertical: 8,
  },
  smallPrimaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryBtn: {
  // outline variant should show border; keep padding only
  paddingHorizontal: 16,
  paddingVertical: 10,
  },
  secondaryBtnText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
  },
  waitingText: {
    marginTop: 8,
    alignSelf: 'flex-end',
    color: '#6B7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
  acceptBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  rejectBtn: {
  // outline variant should show border; keep padding only
  paddingHorizontal: 14,
  paddingVertical: 10,
  },
  rejectBtnText: {
    color: '#111827',
    fontWeight: '600',
    fontSize: 14,
  },
  // Modal Styles
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
  // Rider information styles for offer sent cards
  riderInfoSection: {
    marginTop: 8,
    marginBottom: 4,
  },
  riderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
  },
  riderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 10,
    backgroundColor: '#E2E8F0',
  },
  riderAvatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  riderDetails: {
    flex: 1,
  },
  riderNameText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1F2937',
    marginBottom: 2,
  },
  riderRatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  riderRatingText: {
    fontSize: 12,
    color: '#64748B',
    marginLeft: 4,
  },
  // Pagination dots for promotions carousel
  paginationDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activeDot: {
    backgroundColor: '#E05E1A',
    width: 20,
    borderRadius: 3,
  },
  inactiveDot: {
    backgroundColor: '#D1D5DB',
  },
});
