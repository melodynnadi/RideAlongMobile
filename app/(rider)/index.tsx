import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
  Flag,
  MessageCircle,
  Phone,
  Share2,
  Shield,
  Star,
  X,
} from 'lucide-react-native';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';

import { AddressLink } from '@/components/AddressLink';
import { Button } from '@/components/ui/Button';
import { FlagRideModal } from '@/components/FlagRideModal';
import PromotionCard from '@/components/PromotionCard';
import PromotionDetailsModal from '@/components/PromotionDetailsModal';
import RatingModal from '@/components/RatingModal';
import { RiderRouteSearchCard, type RiderRoutePayload } from '../../components/RiderRouteSearchCard';
import StudentVerificationBanner from '@/components/StudentVerificationBanner';
import { firebaseAuth, firestore, storage } from '@/constants/services';
import { AppColors, BRAND } from '@/constants/theme';
import { useAppTheme } from '@/hooks/ThemeContext';
import { usePromotions } from '@/hooks/usePromotions';
import { fetchVerificationStatus, setupVerificationListener, cleanupVerificationListener } from '@/services/verification';
import { Promotion } from '@/types';
import { logActivity } from '@/utils/activityLogger';
import { submitRating } from '@/src/services/functions';
import { showErrorToast, showSuccessToast } from '@/src/utils/showToast';

type GradientStops = readonly [string, string, ...string[]];
type RideStatus = 'posted' | 'offer' | 'confirmed' | 'in_progress' | 'completed' | 'flagged' | string;

type UpcomingRideCard = {
  id: string;
  type: 'ride' | 'rideRequest' | 'confirmedRide';
  status: RideStatus;
  from: string;
  to: string;
  dateTime: Date | null;
  etaText?: string;
  durationText?: string;
  priceText?: string;
  distanceText?: string;
  driverName?: string;
  driverRating?: number | null;
  vehicleText?: string;
  driverPhone?: string | null;
  driverId?: string | null;
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

const RIDER_ROUTES = {
  book: '/(rider)/book',
  rides: '/(rider)/requests',
  messages: '/(rider)/messages',
  profile: '/(rider)/profile',
  availableRides: '/(rider)/available-rides',
  history: '/(rider)/requests',
} as const;

const asGradientStops = (stops: string[]): GradientStops => {
  return stops as unknown as GradientStops;
};

const currency = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '$0';
  return `$${Math.round(value)}`;
};

const extractAddress = (obj: any, type: 'pickup' | 'dropoff' | 'destination'): string | null => {
  if (!obj) return null;

  const raw =
    type === 'pickup'
      ? obj.pickup || obj.pickupLocation || obj.pickupAddress || obj.from || obj.origin
      : obj.dropoff || obj.dropoffLocation || obj.dropoffAddress || obj.to || obj.destination;

  if (typeof raw === 'object' && raw !== null) {
    return raw.address || raw.formatted_address || raw.description || raw.name || null;
  }

  return typeof raw === 'string' ? raw : null;
};

const extractDistance = (obj: any): string | undefined => {
  if (!obj) return undefined;
  const distance = obj.distance || obj.estimatedDistance || obj.distanceText;
  if (typeof distance === 'number') return `${distance.toFixed(1)} mi`;
  if (typeof distance === 'string') return distance;
  if (typeof distance?.text === 'string') return distance.text;
  return undefined;
};

const toDateField = (value: any): Date | null => {
  try {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value instanceof Timestamp) return value.toDate();
    if (value?.toDate) return value.toDate();
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  } catch {
    return null;
  }
};

const composeDateTime = (dateField: any, timeField: any): Date | null => {
  try {
    let dateStr = '';
    let timeStr = '';

    if (dateField) {
      if (dateField.toDate) dateStr = dateField.toDate().toISOString().split('T')[0];
      else if (typeof dateField === 'string') dateStr = dateField;
    }

    if (timeField && typeof timeField === 'string') timeStr = timeField;
    if (!dateStr) return null;

    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, (month || 1) - 1, day || 1);

    if (timeStr) {
      const match = timeStr.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
      if (match) {
        let hours = Number(match[1]);
        const minutes = Number(match[2] || 0);
        const meridiem = match[3]?.toUpperCase();
        if (meridiem === 'PM' && hours < 12) hours += 12;
        if (meridiem === 'AM' && hours === 12) hours = 0;
        date.setHours(hours, minutes, 0, 0);
      }
    }

    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

const getRideDateTime = (obj: any): Date | null => {
  if (!obj) return null;
  if (obj.date || obj.time) {
    const composed = composeDateTime(obj.date, obj.time);
    if (composed) return composed;
  }
  return (
    toDateField(obj.pickupTime) ||
    toDateField(obj.requestedTime) ||
    toDateField(obj.scheduledTime) ||
    toDateField(obj.createdAt)
  );
};

const formatDate = (date?: Date | null) => {
  if (!date) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatTime = (date?: Date | null) => {
  if (!date) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const formatDateTime = (date?: Date | null) => {
  if (!date) return 'Time pending';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? `Today, ${formatTime(date)}` : `${formatDate(date)}, ${formatTime(date)}`;
};

const prettyStatus = (status?: string) => {
  const key = String(status || '').toLowerCase().replace(/[-\s]/g, '_');
  const map: Record<string, string> = {
    posted: 'Posted',
    pending: 'Posted',
    open: 'Posted',
    offer: 'Offer Received',
    offer_sent: 'Offer Sent',
    accepted: 'Confirmed',
    confirmed: 'Confirmed',
    in_progress: 'In Progress',
    driver_completed: 'In Progress',
    rider_completed: 'In Progress',
    completed: 'Completed',
    flagged: 'Flagged',
  };
  return map[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const badgeForStatus = (status?: string) => {
  const key = String(status || '').toLowerCase().replace(/[-\s]/g, '_');
  if (key === 'flagged') return { label: 'Flagged', semantic: 'red' as const };
  if (key === 'in_progress' || key === 'driver_completed' || key === 'rider_completed') {
    return { label: 'In Progress', semantic: 'green' as const };
  }
  if (key === 'confirmed' || key === 'accepted') return { label: 'Confirmed', semantic: 'green' as const };
  if (key.includes('offer')) return { label: 'Offer Received', semantic: 'orange' as const };
  return { label: prettyStatus(status), semantic: 'blue' as const };
};

const mergeUpcoming = (prev: UpcomingRideCard[], incoming: UpcomingRideCard[]) => {
  const map = new Map<string, UpcomingRideCard>();
  const keyFor = (item: UpcomingRideCard) => {
    if (item.type === 'confirmedRide') {
      return item.rideRequestId ? `rr_${item.rideRequestId}` : `cr_${item.id}`;
    }
    if (item.type === 'rideRequest') return `rr_${item.id}`;
    return `${item.type}_${item.id}`;
  };

  [...prev, ...incoming].forEach((item) => map.set(keyFor(item), item));
  return [...map.values()].sort((a, b) => {
    const at = a.dateTime ? a.dateTime.getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b.dateTime ? b.dateTime.getTime() : Number.MAX_SAFE_INTEGER;
    return at - bt;
  });
};

const deepClean = <T,>(obj: T): T => {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map((value) => deepClean(value)) as T;
  if (obj instanceof Date || obj instanceof Timestamp) return obj;
  if (Object.prototype.toString.call(obj) !== '[object Object]') return obj;

  const out: Record<string, any> = {};
  Object.entries(obj as Record<string, any>).forEach(([key, value]) => {
    if (value === undefined) out[key] = null;
    else out[key] = deepClean(value);
  });
  return out as T;
};

export default function RiderHomeScreen() {
  const { colors, isDark } = useAppTheme();
  const themed = createStyles(colors, isDark);
  const uid = firebaseAuth.currentUser?.uid ?? null;
  const email = firebaseAuth.currentUser?.email ?? null;

  const [selectedRide, setSelectedRide] = useState<UpcomingRideCard | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDriver, setModalDriver] = useState<{
    name?: string;
    rating?: number | null;
    phone?: string | null;
    phoneFromProfile?: boolean;
    avatarUrl?: string | null;
    vehicleText?: string;
    driverId?: string | null;
  } | null>(null);
  const [modalDistanceText, setModalDistanceText] = useState<string | undefined>(undefined);
  const [upcoming, setUpcoming] = useState<UpcomingRideCard[]>([]);
  const [recent, setRecent] = useState<UpcomingRideCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ totalRides: 0, totalSpent: 0, avgRating: null as number | null });
  const [userName, setUserName] = useState('Rider');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [offersByRideId, setOffersByRideId] = useState<Record<string, OfferInfo>>({});
  const [ratedRideIds, setRatedRideIds] = useState<Set<string>>(new Set());
  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flaggingRideId, setFlaggingRideId] = useState<string | null>(null);
  const [ratingModalVisible, setRatingModalVisible] = useState(false);
  const [ratingTarget, setRatingTarget] = useState<{ rideId: string; driverName?: string } | null>(null);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [promotionModalVisible, setPromotionModalVisible] = useState(false);
  const [currentPromotionIndex, setCurrentPromotionIndex] = useState(0);

  const promotionScrollRef = useRef<ScrollView>(null);
  const confirmedKeysRef = useRef<Set<string>>(new Set());
  const completedSeenRef = useRef<Set<string>>(new Set());
  const confirmedIndexRef = useRef<Record<string, { docId: string; status: string }>>({});

  const {
    promotions,
    loading: promotionsLoading,
    refreshPromotions,
    claimPromotion,
    isPromotionClaimed,
  } = usePromotions();

  const displayUpcoming = useMemo(
    () => upcoming.filter((ride) => !['completed', 'cancelled'].includes(String(ride.status).toLowerCase())).slice(0, 3),
    [upcoming]
  );

  const nextRide = displayUpcoming[0];
  const activeRideCount = displayUpcoming.length;
  const firstName = userName.split(' ')[0] || 'there';

  const statCards = useMemo(
    () => [
      { label: 'This month', value: currency(stats.totalSpent), color: colors.primary },
      { label: 'Rides done', value: String(stats.totalRides || 0), color: colors.textPrimary },
      { label: 'Rating', value: stats.avgRating ? `★${stats.avgRating.toFixed(2)}` : '★--', color: colors.textPrimary },
    ],
    [colors.primary, colors.textPrimary, stats.avgRating, stats.totalRides, stats.totalSpent]
  );

  const riderInsightText = useMemo(() => {
    if (activeRideCount > 0) return `${activeRideCount} active ride${activeRideCount === 1 ? '' : 's'} in motion.`;
    if (promotions.length > 0) return `${promotions.length} promotion${promotions.length === 1 ? '' : 's'} available today.`;
    return 'Book earlier for smoother pickup windows around campus.';
  }, [activeRideCount, promotions.length]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshPromotions?.();
    setTimeout(() => setRefreshing(false), 450);
  }, [refreshPromotions]);

  const shareReferral = useCallback(async () => {
    try {
      await Share.share({
        message: 'Try RideAlong for campus rides: https://ridealongapp.com',
      });
    } catch {}
  }, []);

  const handleClaimPromotion = useCallback(
    async (promotionId: string) => {
      try {
        await claimPromotion(promotionId);
        showSuccessToast('Promotion claimed', 'Offer added to your account');
        setPromotionModalVisible(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to claim promotion';
        showErrorToast('Claim failed', message);
      }
    },
    [claimPromotion]
  );

  const openChatForRide = useCallback(async (ride: UpcomingRideCard) => {
    try {
      const user = firebaseAuth.currentUser;
      if (!user) return;

      const otherId = ride.driverId;
      if (!otherId) {
        Alert.alert('Chat unavailable', 'Driver information is not available yet.');
        return;
      }

      const chatQuery = query(
        collection(firestore, 'chats'),
        where('participants', 'array-contains', user.uid)
      );
      const snap = await getDocs(chatQuery);
      const existing = snap.docs.find((item) => {
        const data = item.data() as any;
        const participants = Array.isArray(data.participants) ? data.participants : [];
        return participants.includes(otherId) && data.rideId === (ride.rideRequestId || ride.id);
      });

      if (existing) {
        router.push(`/(rider)/messages/${existing.id}` as any);
        return;
      }

      const docRef = await addDoc(collection(firestore, 'chats'), {
        participants: [user.uid, otherId],
        riderId: user.uid,
        driverId: otherId,
        rideId: ride.rideRequestId || ride.id,
        lastMessage: '',
        lastMessageTimestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      router.push(`/(rider)/messages/${docRef.id}` as any);
    } catch {
      Alert.alert('Chat unavailable', 'Could not open this conversation.');
    }
  }, []);

  const openRideDetails = useCallback(async (ride: UpcomingRideCard) => {
    setSelectedRide(ride);
    setModalDistanceText(ride.distanceText);
    setModalDriver({
      name: ride.driverName,
      rating: ride.driverRating,
      phone: ride.driverPhone,
      vehicleText: ride.vehicleText,
      driverId: ride.driverId,
    });
    setModalVisible(true);

    try {
      const driverId = ride.driverId;
      if (!driverId) return;

      const driverDoc = await getDoc(doc(firestore, 'drivers', driverId));
      if (!driverDoc.exists()) return;

      const driver = driverDoc.data() as any;
      let avatar: string | null = driver.avatarUrl || driver.photoURL || driver.profilePicture || null;

      if (!avatar && driver.profilePicturePath) {
        try {
          avatar = await getDownloadURL(storageRef(storage, driver.profilePicturePath));
        } catch {}
      }

      setModalDriver((prev) => ({
        ...prev,
        name:
          driver.fullName ||
          driver.name ||
          [driver.firstName, driver.lastName].filter(Boolean).join(' ') ||
          prev?.name,
        rating: typeof driver.rating === 'number' ? driver.rating : prev?.rating,
        phone: driver.phone || driver.phoneNumber || prev?.phone,
        avatarUrl: avatar || prev?.avatarUrl,
        vehicleText:
          driver.vehicleText ||
          [driver.vehicle?.color, driver.vehicle?.make, driver.vehicle?.model].filter(Boolean).join(' ') ||
          prev?.vehicleText,
        driverId,
      }));
    } catch {}
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setSelectedRide(null);
    setModalDriver(null);
    setModalDistanceText(undefined);
  }, []);

  const openRatingForRide = useCallback((rideId: string, driverName?: string) => {
    setRatingTarget({ rideId, driverName });
    setRatingError(null);
    setRatingModalVisible(true);
  }, []);

  useEffect(() => {
    if (!uid) {
      setUpcoming([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubs: Array<() => void> = [];

    const loadProfile = async () => {
      try {
        const userDoc = await getDoc(doc(firestore, 'riders', uid));
        const userData = userDoc.exists() ? (userDoc.data() as any) : null;
        const fallbackName = firebaseAuth.currentUser?.displayName || firebaseAuth.currentUser?.email?.split('@')[0] || 'Rider';
        setUserName(
          userData?.fullName ||
            userData?.name ||
            [userData?.firstName, userData?.lastName].filter(Boolean).join(' ') ||
            fallbackName
        );
        setAvatarUrl(userData?.avatarUrl || userData?.profilePicture || firebaseAuth.currentUser?.photoURL || null);
      } catch {}
    };

    const hydrateStats = async () => {
      try {
        const completedQ = query(
          collection(firestore, 'confirmedRides'),
          where('riderId', '==', uid),
          where('status', '==', 'COMPLETED')
        );
        const snap = await getDocs(completedQ);
        let spent = 0;
        snap.forEach((item) => {
          const data = item.data() as any;
          const raw = data.contributionAmount ?? data.price ?? data.fare;
          const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[^0-9.-]/g, '')) : 0;
          if (!Number.isNaN(num)) spent += num;
        });

        setStats((prev) => ({ ...prev, totalRides: snap.size, totalSpent: spent }));
      } catch {}

      try {
        const ratingsQ = query(collection(firestore, 'ratings'), where('riderId', '==', uid));
        const ratings = await getDocs(ratingsQ);
        let sum = 0;
        let count = 0;
        ratings.forEach((item) => {
          const value = (item.data() as any)?.stars ?? (item.data() as any)?.rating;
          if (typeof value === 'number') {
            sum += value;
            count += 1;
          }
        });
        if (count > 0) setStats((prev) => ({ ...prev, avgRating: sum / count }));
      } catch {}
    };

    const mapRideRequest = (id: string, data: any): UpcomingRideCard => {
      const price = data.contributionAmount ?? data.contribution ?? data.price;
      const priceText =
        typeof price === 'number' ? `$${price.toFixed(2)}` : typeof price === 'string' ? price : undefined;

      return {
        id,
        type: 'rideRequest',
        status: data.status || 'posted',
        from: extractAddress(data, 'pickup') || 'Pickup',
        to: extractAddress(data, 'dropoff') || 'Dropoff',
        dateTime: getRideDateTime(data),
        priceText,
        distanceText: extractDistance(data),
        durationText: data.durationText || data.duration?.text || undefined,
        rideRequestId: id,
        driverId: data.driverId || data.assignedDriverId || null,
        driverName: data.driverName || undefined,
        driverPhone: data.driverPhone || undefined,
      };
    };

    const mapConfirmed = (id: string, data: any): UpcomingRideCard => {
      const price = data.contributionAmount ?? data.price ?? data.fare;
      const priceText =
        typeof price === 'number' ? `$${price.toFixed(2)}` : typeof price === 'string' ? price : undefined;

      return {
        id,
        type: 'confirmedRide',
        status: data.status || 'confirmed',
        from: extractAddress(data, 'pickup') || 'Pickup',
        to: extractAddress(data, 'dropoff') || 'Dropoff',
        dateTime: getRideDateTime(data),
        priceText,
        distanceText: extractDistance(data),
        durationText: data.durationText || data.duration?.text || undefined,
        driverId: data.driverId || data.driverUID || data.driverUid || null,
        driverName: data.driverName || data.providerName || undefined,
        driverPhone: data.driverPhone || data.phone || undefined,
        driverRating: typeof data.driverRating === 'number' ? data.driverRating : null,
        vehicleText: data.vehicleText || data.vehicle || undefined,
        rideRequestId: data.rideRequestId || data.originalRideRequest?.id || null,
        ridePostingId: data.ridePostingId || null,
      };
    };

    const listenRequests = () => {
      const requestQueries = [
        query(collection(firestore, 'rideRequests'), where('userId', '==', uid)),
        query(collection(firestore, 'rideRequests'), where('riderId', '==', uid)),
      ];

      if (email) {
        requestQueries.push(query(collection(firestore, 'rideRequests'), where('userEmail', '==', email)));
      }

      requestQueries.forEach((qy) => {
        try {
          unsubs.push(
            onSnapshot(
              qy,
              (snap) => {
                const items: UpcomingRideCard[] = [];
                snap.forEach((item) => {
                  const data = item.data() as any;
                  if (['completed', 'cancelled'].includes(String(data.status || '').toLowerCase())) return;
                  items.push(mapRideRequest(item.id, data));
                });
                setUpcoming((prev) => mergeUpcoming(prev, items));
                setLoading(false);
              },
              () => setLoading(false)
            )
          );
        } catch {}
      });
    };

    const listenConfirmed = () => {
      const statuses = ['CONFIRMED', 'IN_PROGRESS', 'DRIVER_COMPLETED', 'FLAGGED', 'confirmed', 'in_progress', 'flagged'];
      statuses.forEach((status) => {
        try {
          unsubs.push(
            onSnapshot(
              query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid), where('status', '==', status)),
              (snap) => {
                const items: UpcomingRideCard[] = [];
                snap.forEach((item) => {
                  const data = item.data() as any;
                  const mapped = mapConfirmed(item.id, data);
                  const key = mapped.rideRequestId ? `rr_${mapped.rideRequestId}` : `cr_${item.id}`;
                  confirmedKeysRef.current.add(key);
                  confirmedIndexRef.current[key] = { docId: item.id, status: mapped.status };
                  items.push(mapped);
                });
                setUpcoming((prev) => mergeUpcoming(prev, items));
                setLoading(false);
              },
              () => setLoading(false)
            )
          );
        } catch {}
      });

      try {
        unsubs.push(
          onSnapshot(
            query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid), where('status', '==', 'COMPLETED')),
            (snap) => {
              const recents: UpcomingRideCard[] = [];
              const completedKeys = new Set<string>();

              snap.forEach((item) => {
                const data = item.data() as any;
                const mapped = mapConfirmed(item.id, { ...data, status: 'COMPLETED' });
                const key = mapped.rideRequestId ? `rr_${mapped.rideRequestId}` : `cr_${item.id}`;
                completedKeys.add(key);
                recents.push(mapped);
                completedSeenRef.current.add(item.id);
              });

              setUpcoming((prev) =>
                prev.filter((item) => {
                  const key = item.type === 'confirmedRide' && item.rideRequestId ? `rr_${item.rideRequestId}` : `${item.type}_${item.id}`;
                  return !completedKeys.has(key);
                })
              );
              setRecent((prev) => mergeUpcoming(recents, prev).slice(0, 3));
            }
          )
        );
      } catch {}
    };

    const listenOffers = () => {
      try {
        unsubs.push(
          onSnapshot(query(collection(firestore, 'rideOffers'), where('riderId', '==', uid)), (snap) => {
            const next: Record<string, OfferInfo> = {};
            snap.forEach((item) => {
              const data = item.data() as any;
              const rideRequestId = String(data.rideRequestId || '');
              if (!rideRequestId) return;
              next[rideRequestId] = {
                id: item.id,
                rideRequestId,
                status: String(data.status || 'pending'),
                priceText:
                  typeof data.price === 'number'
                    ? `$${data.price.toFixed(2)}`
                    : typeof data.price === 'string'
                    ? data.price
                    : undefined,
                priceNumber: typeof data.price === 'number' ? data.price : undefined,
                distanceText: data.distanceText || data.distance?.text || undefined,
                durationText: data.durationText || data.duration?.text || undefined,
                driverName: data.driverName || undefined,
                driverId: data.driverId || undefined,
                driverEmail: data.driverEmail || undefined,
                driverPhone: data.driverPhone || undefined,
                ridePostingId: data.ridePostingId || null,
                createdAt: toDateField(data.createdAt),
              };
            });
            setOffersByRideId(next);
          })
        );
      } catch {}
    };

    const listenNotifications = () => {
      try {
        const notifQueries = [
          query(collection(firestore, 'notifications'), where('userId', '==', uid)),
          query(collection(firestore, 'notifications'), where('recipientId', '==', uid)),
          query(collection(firestore, 'notifications'), where('recipients', 'array-contains', uid)),
        ];

        notifQueries.forEach((qy) => {
          unsubs.push(
            onSnapshot(qy, (snap) => {
              let unread = 0;
              snap.forEach((item) => {
                const data = item.data() as any;
                const readBy = Array.isArray(data.readBy) ? data.readBy : [];
                const read = data.read === true || data.unread === false || readBy.includes(uid);
                if (!read) unread += 1;
              });
              setUnreadCount((prev) => Math.max(prev, unread));
            })
          );
        });
      } catch {}
    };

    const initVerification = async () => {
      try {
        await fetchVerificationStatus();
        setupVerificationListener();
      } catch {}
    };

    void loadProfile();
    void hydrateStats();
    void initVerification();
    listenRequests();
    listenConfirmed();
    listenOffers();
    listenNotifications();

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
      cleanupVerificationListener();
    };
  }, [email, uid]);

  useFocusEffect(
    useCallback(() => {
      if (!uid) return undefined;

      const checkRated = async () => {
        try {
          const qy = query(collection(firestore, 'ratings'), where('riderId', '==', uid), fsLimit(50));
          const snap = await getDocs(qy);
          const ids = new Set<string>();
          snap.forEach((item) => {
            const rideId = (item.data() as any)?.rideId;
            if (rideId) ids.add(String(rideId));
          });
          setRatedRideIds(ids);
        } catch {}
      };

      void checkRated();
      return undefined;
    }, [uid])
  );

  const acceptOffer = async (ride: UpcomingRideCard, offer: OfferInfo) => {
    try {
      await updateDoc(doc(firestore, 'rideOffers', offer.id), {
        status: 'accepted',
        acceptedAt: serverTimestamp(),
      });

      await setDoc(
        doc(firestore, 'rideRequests', ride.rideRequestId || ride.id),
        deepClean({
          status: 'accepted',
          driverId: offer.driverId || null,
          driverName: offer.driverName || null,
          driverPhone: offer.driverPhone || null,
          acceptedOfferId: offer.id,
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      );

      void logActivity({
        type: 'ride_offer_accepted',
        entityType: 'rideOffer',
        entityId: offer.id,
        metadata: { rideRequestId: ride.rideRequestId || ride.id },
      });

      showSuccessToast('Offer accepted', 'Your driver has been notified.');
    } catch {
      showErrorToast('Could not accept offer', 'Please try again.');
    }
  };

  const cancelRide = async (ride: UpcomingRideCard) => {
    Alert.alert('Cancel ride', 'Cancel this ride request?', [
      { text: 'Keep ride', style: 'cancel' },
      {
        text: 'Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            const collectionName = ride.type === 'confirmedRide' ? 'confirmedRides' : 'rideRequests';
            await updateDoc(doc(firestore, collectionName, ride.id), {
              status: 'cancelled',
              cancelledAt: serverTimestamp(),
            });
            setUpcoming((prev) => prev.filter((item) => item.id !== ride.id));
          } catch {
            Alert.alert('Could not cancel', 'Please try again.');
          }
        },
      },
    ]);
  };

  const renderRideCard = (ride: UpcomingRideCard, compact = false) => {
    const offer = offersByRideId[ride.rideRequestId || ride.id];
    const badge = badgeForStatus(offer?.status || ride.status);
    const badgeStyle =
      badge.semantic === 'green'
        ? themed.badgeGreen
        : badge.semantic === 'red'
        ? themed.badgeRed
        : badge.semantic === 'orange'
        ? themed.badgeOrange
        : themed.badgeBlue;

    return (
      <TouchableOpacity
        key={`${ride.type}-${ride.id}`}
        style={themed.rideCard}
        activeOpacity={0.88}
        onPress={() => openRideDetails(ride)}
      >
        {isDark && <BlurView intensity={18} tint="dark" style={StyleSheet.absoluteFillObject} />}
        <View style={styles.rideCardInner}>
          <View style={styles.rideTopRow}>
            <View style={[styles.statusBadge, badgeStyle]}>
              <Text style={[styles.statusBadgeText, { color: badgeStyle.color }]}>{badge.label}</Text>
            </View>
            <Text style={themed.rideTime}>{formatDateTime(ride.dateTime)}</Text>
          </View>

          <View style={styles.routeBlock}>
            <View style={styles.routeLineWrap}>
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <View style={[styles.routeLine, { backgroundColor: colors.primaryBorder }]} />
              <View style={[styles.routeDot, { backgroundColor: colors.textTertiary }]} />
            </View>
            <View style={styles.routeTextWrap}>
              <Text style={themed.routeFrom} numberOfLines={1}>
                {ride.from}
              </Text>
              <Text style={themed.routeTo} numberOfLines={1}>
                {ride.to}
              </Text>
            </View>
          </View>

          <View style={styles.rideFooter}>
            <Text style={themed.ridePrice}>{offer?.priceText || ride.priceText || '$--'}</Text>
            <View style={styles.rideFooterActions}>
              {(offer?.durationText || ride.durationText) && (
                <Text style={themed.rideMeta}>{offer?.durationText || ride.durationText}</Text>
              )}
              {ride.driverId && (
                <TouchableOpacity onPress={() => openChatForRide(ride)} style={themed.iconBtn}>
                  <MessageCircle size={15} color={colors.primary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.detailsBtn} onPress={() => openRideDetails(ride)}>
                <Text style={styles.detailsBtnText}>Details</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {!compact && offer && ['pending', 'sent', 'offer', 'received'].includes(String(offer.status).toLowerCase()) && (
            <View style={styles.offerActionRow}>
              <TouchableOpacity style={themed.declineBtn} onPress={() => cancelRide(ride)}>
                <Text style={themed.declineBtnText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.acceptBtn} onPress={() => acceptOffer(ride, offer)}>
                <LinearGradient
                  colors={asGradientStops([BRAND.orange, BRAND.orangeDeep])}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.acceptBtnGrad}
                >
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={themed.root}>
      <StatusBar barStyle={colors.statusBar} />
      <LinearGradient colors={asGradientStops(colors.gradientBg)} style={StyleSheet.absoluteFillObject} />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <View style={styles.header}>
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => router.push(RIDER_ROUTES.profile as any)}
              style={[styles.avatarRing, { borderColor: colors.primary }]}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              ) : (
                <LinearGradient colors={asGradientStops([BRAND.orange, BRAND.orangeDeep])} style={styles.avatar}>
                  <Text style={styles.avatarInitial}>{firstName[0]?.toUpperCase() || 'R'}</Text>
                </LinearGradient>
              )}
            </TouchableOpacity>

            <View style={styles.headerTextWrap}>
              <Text style={themed.hdrSub}>Good to see you, {firstName}</Text>
              <Text style={themed.hdrTitle}>
                Your campus ride{'\n'}
                <Text style={themed.hdrAccent}>is one tap away.</Text>
              </Text>
            </View>

            <TouchableOpacity
              style={themed.notifBtn}
              activeOpacity={0.86}
              onPress={() => router.push(RIDER_ROUTES.messages as any)}
            >
              <Ionicons name="chatbubble-outline" size={20} color={colors.textPrimary} />
              {unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>{Math.min(unreadCount, 9)}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <StudentVerificationBanner />

          <View style={styles.snapshotRow}>
            {statCards.map((item) => (
              <View key={item.label} style={themed.snapshotCard}>
                <Text style={[styles.snapshotValue, { color: item.color }]} numberOfLines={1}>
                  {item.value}
                </Text>
                <Text style={themed.snapshotLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <RiderRouteSearchCard
            onContinue={(route: RiderRoutePayload) => {
              router.push({
                pathname: RIDER_ROUTES.book,
                params: {
                  pickup: route.pickup,
                  dropoff: route.dropoff,
                  pickupLat: String(route.pickupCoords.lat),
                  pickupLng: String(route.pickupCoords.lng),
                  dropoffLat: String(route.dropoffCoords.lat),
                  dropoffLng: String(route.dropoffCoords.lng),
                  distanceText: route.distanceText,
                  durationText: route.durationText,
                  minContribution: route.minContribution ? String(route.minContribution) : '',
                },
              } as any);
            }}
          />

          {nextRide && (
            <View style={themed.nextRideCard}>
              <View style={styles.nextTop}>
                <Text style={styles.nextEyebrow}>NEXT RIDE</Text>
                <Text style={styles.nextPrice}>{nextRide.priceText || '$--'}</Text>
              </View>
              <Text style={styles.nextTitle} numberOfLines={1}>
                {nextRide.from} → {nextRide.to}
              </Text>
              <Text style={styles.nextSub}>
                {formatDateTime(nextRide.dateTime)}
                {nextRide.driverName ? ` · ${nextRide.driverName}` : ''}
              </Text>
              <View style={styles.nextActions}>
                <TouchableOpacity style={styles.nextGhostBtn} onPress={() => openRideDetails(nextRide)}>
                  <Text style={styles.nextGhostText}>View ride</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.nextPrimaryBtn} onPress={() => openChatForRide(nextRide)}>
                  <Text style={styles.nextPrimaryText}>Message</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.quickActions}>
            <TouchableOpacity
              style={themed.quickAction}
              onPress={() => router.push(RIDER_ROUTES.availableRides as any)}
              activeOpacity={0.86}
            >
              <Ionicons name="search" size={18} color={colors.primary} />
              <Text style={themed.quickActionText}>Find Rides</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickActionPrimary}
              onPress={() => router.push(RIDER_ROUTES.book as any)}
              activeOpacity={0.88}
            >
              <Ionicons name="add-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.quickActionPrimaryText}>Book Ride</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={themed.quickAction}
              onPress={() => router.push(RIDER_ROUTES.messages as any)}
              activeOpacity={0.86}
            >
              <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
              <Text style={themed.quickActionText}>Messages</Text>
            </TouchableOpacity>
          </View>

          <View style={themed.insightStrip}>
            <View style={themed.insightIcon}>
              <Shield size={16} color={colors.primary} />
            </View>
            <View style={styles.insightTextWrap}>
              <Text style={themed.insightTitle}>RideAlong Pulse</Text>
              <Text style={themed.insightText}>{riderInsightText}</Text>
            </View>
          </View>

          {(promotions.length > 0 || promotionsLoading) && (
            <View style={styles.section}>
              <Text style={themed.sectionTitle}>Promotions</Text>
              {promotionsLoading && promotions.length === 0 ? (
                <ActivityIndicator color={colors.primary} style={styles.sectionLoader} />
              ) : (
                <>
                  <ScrollView
                    ref={promotionScrollRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={320}
                    decelerationRate="fast"
                    onScroll={(event) => {
                      const index = Math.round(event.nativeEvent.contentOffset.x / 320);
                      setCurrentPromotionIndex(Math.max(0, Math.min(index, promotions.length - 1)));
                    }}
                    scrollEventThrottle={16}
                  >
                    {promotions.map((promotion) => (
                      <TouchableOpacity
                        key={promotion.id}
                        activeOpacity={0.9}
                        onPress={() => {
                          setSelectedPromotion(promotion);
                          setPromotionModalVisible(true);
                        }}
                        style={styles.promotionShell}
                      >
                        <PromotionCard promotion={promotion} onPress={() => {}} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {promotions.length > 1 && (
                    <View style={styles.dotsRow}>
                      {promotions.map((_, index) => (
                        <View key={index} style={[styles.dot, index === currentPromotionIndex && styles.dotActive]} />
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.sectionHdrRow}>
              <Text style={themed.sectionTitle}>Upcoming Rides</Text>
              <TouchableOpacity onPress={() => router.push(RIDER_ROUTES.rides as any)}>
                <Text style={themed.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>

            {loading && <ActivityIndicator color={colors.primary} style={styles.sectionLoader} />}

            {!loading && displayUpcoming.length === 0 && (
              <View style={themed.emptyBox}>
                <View style={themed.emptyIconWrap}>
                  <Ionicons name="car-outline" size={28} color={colors.primary} />
                </View>
                <Text style={themed.emptyTitle}>No active rides</Text>
                <Text style={themed.emptyText}>Search your route to get matched with a driver.</Text>
              </View>
            )}

            {!loading && displayUpcoming.map((ride) => renderRideCard(ride))}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHdrRow}>
              <Text style={themed.sectionTitle}>Campus Insights</Text>
              <View style={themed.liveBadge}>
                <View style={[styles.liveDot, { backgroundColor: colors.green }]} />
                <Text style={[styles.liveText, { color: colors.green }]}>Active now</Text>
              </View>
            </View>

            <View style={themed.insightsCard}>
              {[
                { icon: 'time-outline', text: 'Evening windows usually convert faster near housing and dining.', label: 'Pattern' },
                { icon: 'wallet-outline', text: 'Clear pickup notes help drivers accept sooner.', label: 'Tip' },
                { icon: 'school-outline', text: 'Verified student rides help keep the marketplace trusted.', label: 'Trust' },
                { icon: 'flash-outline', text: 'Book earlier when campus events create demand spikes.', label: 'Now' },
              ].map((item, index) => (
                <View key={item.text} style={[styles.insightRow, index > 0 && themed.insightRowBorder]}>
                  <View style={themed.smallInsightIcon}>
                    <Ionicons name={item.icon as any} size={15} color={colors.primary} />
                  </View>
                  <Text style={themed.smallInsightText}>{item.text}</Text>
                  <Text style={themed.smallInsightLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHdrRow}>
              <Text style={themed.sectionTitle}>Recent Rides</Text>
              <TouchableOpacity onPress={() => router.push(RIDER_ROUTES.rides as any)}>
                <Text style={themed.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>

            {recent.length === 0 ? (
              <View style={themed.emptyBoxCompact}>
                <Text style={themed.emptyTitle}>No recent rides yet</Text>
                <Text style={themed.emptyText}>Completed trips will appear here.</Text>
              </View>
            ) : (
              recent.map((ride) => (
                <View key={`recent-${ride.id}`} style={themed.recentCard}>
                  <View style={styles.recentTop}>
                    <View style={themed.completedPill}>
                      <Text style={themed.completedText}>Completed</Text>
                    </View>
                    <Text style={themed.recentDate}>{formatDateTime(ride.dateTime)}</Text>
                  </View>
                  <View style={styles.recentRoute}>
                    <View style={[styles.routeDotSmall, { backgroundColor: colors.primary }]} />
                    <Text style={themed.recentRouteText} numberOfLines={1}>
                      {ride.from}
                    </Text>
                  </View>
                  <View style={styles.recentRoute}>
                    <View style={[styles.routeDotSmall, { backgroundColor: colors.textTertiary }]} />
                    <Text style={themed.recentRouteText} numberOfLines={1}>
                      {ride.to}
                    </Text>
                  </View>
                  <View style={styles.recentFooter}>
                    <Text style={themed.recentPrice}>{ride.priceText || '$--'}</Text>
                    <View style={styles.recentActions}>
                      {!ratedRideIds.has(ride.id) && (
                        <TouchableOpacity style={themed.rateBtn} onPress={() => openRatingForRide(ride.id, ride.driverName)}>
                          <Text style={themed.rateBtnText}>Rate</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={() => openRideDetails(ride)} style={styles.detailsBtn}>
                        <Text style={styles.detailsBtnText}>History</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {modalVisible && (
        <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={closeModal}>
          <View style={styles.modalOverlay}>
            <View style={themed.modalSheet}>
              {isDark && <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFillObject} />}
              <View style={themed.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={themed.modalTitle}>Ride Details</Text>
                <TouchableOpacity onPress={closeModal} style={themed.modalCloseBtn}>
                  <X size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              {selectedRide && (
                <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                  {(modalDriver?.name || selectedRide.driverName) && (
                    <View style={styles.modalSection}>
                      <Text style={themed.modalSectionTitle}>Driver</Text>
                      <TouchableOpacity
                        style={themed.driverRow}
                        activeOpacity={0.9}
                        onPress={() => {
                          if (!modalDriver?.driverId) return;
                          closeModal();
                          router.push(`/(rider)/driver/${modalDriver.driverId}` as any);
                        }}
                      >
                        {modalDriver?.avatarUrl ? (
                          <Image source={{ uri: modalDriver.avatarUrl }} style={styles.driverAvatar} />
                        ) : (
                          <View style={themed.driverAvatarPlaceholder}>
                            <Ionicons name="person" size={24} color={colors.primary} />
                          </View>
                        )}
                        <View style={styles.driverInfo}>
                          <Text style={themed.driverName}>{modalDriver?.name || selectedRide.driverName || 'Driver'}</Text>
                          {typeof (modalDriver?.rating ?? selectedRide.driverRating) === 'number' && (
                            <View style={styles.driverRatingRow}>
                              <Star size={13} color={colors.amber} fill={colors.amber} />
                              <Text style={themed.driverRating}>
                                {(modalDriver?.rating ?? selectedRide.driverRating)?.toFixed(1)}
                              </Text>
                            </View>
                          )}
                          {!!(modalDriver?.vehicleText || selectedRide.vehicleText) && (
                            <Text style={themed.driverVehicle}>{modalDriver?.vehicleText || selectedRide.vehicleText}</Text>
                          )}
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.callBtn,
                            { backgroundColor: modalDriver?.phone ? colors.primary : colors.bgInput },
                          ]}
                          disabled={!modalDriver?.phone}
                          onPress={() => {
                            if (modalDriver?.phone) Linking.openURL(`tel:${modalDriver.phone}`).catch(() => {});
                          }}
                        >
                          <Phone size={18} color={modalDriver?.phone ? '#FFFFFF' : colors.textTertiary} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.modalSection}>
                    <Text style={themed.modalSectionTitle}>Route</Text>
                    <View style={themed.modalRouteCard}>
                      <View style={styles.modalRouteRow}>
                        <View style={[styles.routeDotSmall, { backgroundColor: colors.primary }]} />
                        <AddressLink address={selectedRide.from} textStyle={themed.modalRouteText} />
                      </View>
                      <View style={[styles.modalRouteLine, { backgroundColor: colors.primaryBorder }]} />
                      <View style={styles.modalRouteRow}>
                        <View style={[styles.routeDotSmall, { backgroundColor: colors.textTertiary }]} />
                        <AddressLink address={selectedRide.to} textStyle={themed.modalRouteText} />
                      </View>
                    </View>
                  </View>

                  <View style={styles.modalSection}>
                    <Text style={themed.modalSectionTitle}>Trip Info</Text>
                    <View style={styles.infoGrid}>
                      {[
                        { label: 'Date', value: formatDate(selectedRide.dateTime) || '--' },
                        { label: 'Time', value: formatTime(selectedRide.dateTime) || '--' },
                        { label: 'Distance', value: modalDistanceText || selectedRide.distanceText || '--' },
                        { label: 'Price', value: selectedRide.priceText || '--' },
                      ].map((item) => (
                        <View key={item.label} style={themed.infoCell}>
                          <Text style={themed.infoLabel}>{item.label}</Text>
                          <Text style={themed.infoValue}>{item.value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <View style={styles.modalActions}>
                    {!!selectedRide.driverId && (
                      <TouchableOpacity style={themed.modalActionBtn} onPress={() => openChatForRide(selectedRide)}>
                        <MessageCircle size={16} color={colors.primary} />
                        <Text style={themed.modalActionText}>Message</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={themed.modalActionBtn}
                      onPress={() => {
                        setFlaggingRideId(selectedRide.id);
                        setFlagModalVisible(true);
                      }}
                    >
                      <Flag size={16} color="#EF4444" />
                      <Text style={themed.modalActionText}>Report</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={themed.modalActionBtn}
                      onPress={() => Share.share({ message: `${selectedRide.from} to ${selectedRide.to}` }).catch(() => {})}
                    >
                      <Share2 size={16} color={colors.primary} />
                      <Text style={themed.modalActionText}>Share</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      )}

      {ratingModalVisible && (
        <RatingModal
          visible={ratingModalVisible}
          onClose={() => {
            if (!ratingSubmitting) {
              setRatingModalVisible(false);
              setRatingTarget(null);
              setRatingError(null);
            }
          }}
          onSubmit={async (stars, comment) => {
            if (!ratingTarget) return;
            try {
              setRatingSubmitting(true);
              setRatingError(null);
              await submitRating({ rideId: ratingTarget.rideId, stars, comment });
              setRatedRideIds((prev) => new Set(prev).add(ratingTarget.rideId));
              setRatingModalVisible(false);
              setRatingTarget(null);
              showSuccessToast('Thanks', 'Your rating was submitted.');
            } catch (error: any) {
              const message = error?.message || 'Failed to submit rating.';
              setRatingError(message);
              showErrorToast('Rating failed', message);
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

      <FlagRideModal
        visible={flagModalVisible}
        rideId={flaggingRideId}
        onClose={() => {
          setFlagModalVisible(false);
          setFlaggingRideId(null);
        }}
        onFlagged={(rideId) => {
          setUpcoming((prev) => prev.map((ride) => (ride.id === rideId ? { ...ride, status: 'flagged' } : ride)));
          showSuccessToast('Ride reported', 'Thanks for your report.');
        }}
      />

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

const createStyles = (colors: AppColors, isDark: boolean) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    hdrSub: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
      marginBottom: 2,
    },
    hdrTitle: {
      color: colors.textPrimary,
      fontSize: 25,
      lineHeight: 29,
      fontWeight: '800',
      letterSpacing: 0,
    },
    hdrAccent: {
      color: colors.primary,
      fontWeight: '800',
    },
    notifBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      borderWidth: 1,
      borderColor: colors.borderMid,
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.14 : 0.08,
      shadowRadius: 12,
      elevation: 2,
    },
    snapshotCard: {
      flex: 1,
      minHeight: 88,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      padding: 14,
      justifyContent: 'center',
    },
    snapshotLabel: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 4,
    },
    nextRideCard: {
      marginHorizontal: 18,
      marginBottom: 18,
      borderRadius: 22,
      backgroundColor: BRAND.navyText,
      padding: 18,
      overflow: 'hidden',
    },
    quickAction: {
      flex: 1,
      minHeight: 54,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
    },
    quickActionText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    insightStrip: {
      marginHorizontal: 18,
      marginBottom: 20,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    insightIcon: {
      width: 38,
      height: 38,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryDim,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
    },
    insightTitle: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 2,
    },
    insightText: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '600',
    },
    sectionTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: 0,
    },
    viewAll: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    rideCard: {
      marginTop: 12,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      overflow: 'hidden',
      shadowColor: BRAND.navyText,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: isDark ? 0.12 : 0.05,
      shadowRadius: 12,
      elevation: 2,
    },
    badgeGreen: {
      backgroundColor: colors.greenDim,
      borderColor: colors.greenBorder,
      color: colors.green,
    },
    badgeRed: {
      backgroundColor: 'rgba(239,68,68,0.13)',
      borderColor: 'rgba(239,68,68,0.28)',
      color: '#EF4444',
    },
    badgeOrange: {
      backgroundColor: colors.primaryDim,
      borderColor: colors.primaryBorder,
      color: colors.primary,
    },
    badgeBlue: {
      backgroundColor: colors.blueDim,
      borderColor: colors.blueBorder,
      color: colors.blue,
    },
    rideTime: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: '700',
    },
    routeFrom: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
      marginBottom: 10,
    },
    routeTo: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    ridePrice: {
      color: colors.primary,
      fontSize: 16,
      fontWeight: '800',
    },
    rideMeta: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '700',
    },
    iconBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryDim,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
    },
    declineBtn: {
      flex: 1,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.borderMid,
      minHeight: 42,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF',
    },
    declineBtnText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    emptyBox: {
      marginTop: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      alignItems: 'center',
      padding: 24,
    },
    emptyBoxCompact: {
      marginTop: 12,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
      padding: 18,
    },
    emptyIconWrap: {
      width: 58,
      height: 58,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryDim,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      marginBottom: 12,
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
      marginBottom: 5,
      textAlign: 'center',
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      textAlign: 'center',
    },
    liveBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.greenDim,
      borderWidth: 1,
      borderColor: colors.greenBorder,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 12,
    },
    insightsCard: {
      marginTop: 12,
      borderRadius: 20,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
    },
    insightRowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    smallInsightIcon: {
      width: 34,
      height: 34,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryDim,
    },
    smallInsightText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      fontWeight: '700',
    },
    smallInsightLabel: {
      color: colors.textTertiary,
      fontSize: 10,
      fontWeight: '800',
    },
    recentCard: {
      marginTop: 12,
      padding: 16,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: isDark ? colors.glassBg : colors.bgCard,
    },
    completedPill: {
      backgroundColor: colors.bgInput,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    completedText: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: '800',
    },
    recentDate: {
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: '700',
    },
    recentRouteText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '700',
    },
    recentPrice: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '800',
    },
    rateBtn: {
      borderRadius: 13,
      backgroundColor: colors.primaryDim,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    rateBtnText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '800',
    },
    modalSheet: {
      maxHeight: '90%',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      overflow: 'hidden',
      paddingBottom: 40,
      backgroundColor: isDark ? colors.bgCard : '#FFFFFF',
    },
    modalHandle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 12,
      marginBottom: 4,
      backgroundColor: colors.borderMid,
    },
    modalTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '800',
    },
    modalCloseBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bgInput,
    },
    modalSectionTitle: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 10,
    },
    driverRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: colors.bgInput,
      padding: 12,
    },
    driverAvatarPlaceholder: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryDim,
    },
    driverName: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '800',
    },
    driverRating: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      marginLeft: 4,
    },
    driverVehicle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 2,
    },
    modalRouteCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: colors.bgInput,
      padding: 14,
    },
    modalRouteText: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
    infoCell: {
      flex: 1,
      minWidth: '47%',
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: colors.bgInput,
      padding: 13,
    },
    infoLabel: {
      color: colors.textTertiary,
      fontSize: 10,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: 5,
    },
    infoValue: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    modalActionBtn: {
      flex: 1,
      minHeight: 42,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.borderMid,
      backgroundColor: colors.bgInput,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 7,
    },
    modalActionText: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
  });

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 16,
  },
  avatarRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    padding: 2,
    marginRight: 12,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
  },
  headerTextWrap: {
    flex: 1,
  },
  notifBadge: {
    position: 'absolute',
    top: -2,
    right: -1,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  snapshotRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  snapshotValue: {
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: 0,
  },
  nextTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  nextEyebrow: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  nextPrice: {
    color: BRAND.orange,
    fontSize: 28,
    fontWeight: '800',
  },
  nextTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  nextSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 18,
  },
  nextActions: {
    flexDirection: 'row',
    gap: 10,
  },
  nextGhostBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextGhostText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  nextPrimaryBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BRAND.orange,
  },
  nextPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    marginBottom: 18,
  },
  quickActionPrimary: {
    flex: 1.25,
    minHeight: 54,
    borderRadius: 15,
    backgroundColor: BRAND.orange,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    shadowColor: BRAND.orange,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 15,
    elevation: 3,
  },
  quickActionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  insightTextWrap: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 18,
  },
  sectionHdrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLoader: {
    marginTop: 16,
  },
  promotionShell: {
    width: 318,
    marginTop: 12,
    marginRight: 12,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(148,163,184,0.35)',
  },
  dotActive: {
    width: 22,
    backgroundColor: BRAND.orange,
  },
  rideCardInner: {
    padding: 16,
  },
  rideTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statusBadge: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  routeBlock: {
    flexDirection: 'row',
    marginBottom: 13,
  },
  routeLineWrap: {
    width: 14,
    alignItems: 'center',
    paddingVertical: 3,
    marginRight: 10,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  routeLine: {
    width: 2,
    flex: 1,
    marginVertical: 4,
  },
  routeTextWrap: {
    flex: 1,
  },
  rideFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rideFooterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
  },
  detailsBtnText: {
    color: BRAND.orange,
    fontSize: 12,
    fontWeight: '800',
  },
  offerActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.35)',
  },
  acceptBtn: {
    flex: 1,
    borderRadius: 15,
    overflow: 'hidden',
  },
  acceptBtnGrad: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800',
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
  },
  recentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  recentRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 9,
  },
  routeDotSmall: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  recentFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  recentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingVertical: 16,
  },
  modalBody: {
    paddingHorizontal: 22,
  },
  modalSection: {
    marginBottom: 20,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  driverInfo: {
    flex: 1,
    marginLeft: 12,
  },
  driverRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  callBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  modalRouteLine: {
    width: 2,
    height: 18,
    marginLeft: 3,
    marginVertical: 4,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 24,
  },
});
