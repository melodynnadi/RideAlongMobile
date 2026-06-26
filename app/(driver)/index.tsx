import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View, ScrollView, StyleSheet, Text, TouchableOpacity, Modal,
  TextInput, Keyboard,
  ActivityIndicator, Alert, Image, Share, Linking, Dimensions,
  RefreshControl, useColorScheme, StatusBar, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from '@/components/platform/NativeMaps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { firestore, firebaseAuth, storage, getApiBaseUrl, GOOGLE_MAPS_API_KEY } from '@/constants/services';
import { listenDriverCompletedRides, ConfirmedRide } from '@/src/services/ridesData';
import {
  confirmPickup as actionConfirmPickup,
  completeRide as actionCompleteRide,
  cancelRide as actionCancelRide,
  flagRide, groupPickup, groupComplete, groupFlag,
} from '@/src/services/rideActions';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import FlagRideModal from '@/components/FlagRideModal';
import { Button } from '@/components/ui/Button';
import { computeFilteredAverageRating, hasUserRatedRide } from '@/src/services/ratings';
import { PromotionDetailsModal } from '@/components/PromotionDetailsModal';
import { usePromotions } from '@/hooks/usePromotions';
import { Promotion } from '@/types';
import { StudentVerificationBanner } from '@/components/StudentVerificationBanner';
import { useVerificationStore } from '@/stores/verificationStore';
import { AddressLink } from '@/components/AddressLink';
import {
  collection, onSnapshot, query, where, getCountFromServer,
  getDocs, doc, getDoc, Timestamp, orderBy, limit as fsLimit,
  updateDoc, setDoc, addDoc, serverTimestamp, documentId,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { DriverBottomNav } from '@/components/DriverBottomNav';
import { DriverHomeUtilityBar } from '@/components/reference/DriverReferenceScreens';
import { DatePickerModal, TimePickerModal, formatDateLabel } from '@/components/DateTimePickerModals';

// ─── Design Tokens (rider palette) ───────────────────────────────────────────
const NAVY   = '#15233A';
const ORANGE = '#DE5D20';
const SECONDARY = '#0D1B48';
const BG     = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED  = '#8B94A6';
const confirmationRepairs = new Set<string>();

const COLORS = {
  orange: '#DE5D20',
  orangeLight: '#F08050',
  orangeDeep: '#C44D10',
  orangeGlow: 'rgba(222,93,32,0.12)',
  orangeBorder: 'rgba(222,93,32,0.28)',

  navy: '#15233A',
  green: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  blue: '#3B82F6',
  violet: '#8B5CF6',

  bg: '#FBFAF7',
  bg2: '#FFFFFF',
  bg3: '#F3EFE8',
  card: '#FFFFFF',
  cardStrong: '#FFFFFF',
  input: 'rgba(21,35,58,0.045)',
  border: '#E5E0D8',
  text: '#15233A',
  sub: '#8B94A6',
};

type DriverHomeSuggestion = { description: string; place_id: string; displayText: string };

function DriverHomeAutocomplete({
  value,
  onChangeText,
  placeholder,
  zIndex,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  zIndex: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DriverHomeSuggestion[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => sub.remove();
  }, []);

  const fetchSuggestions = async (input: string) => {
    const q = input.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }

    try {
      setLoading(true);
      let json: any = null;
      const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);

      if (token) {
        const res = await fetch(`${getApiBaseUrl()}/api/places/autocomplete?input=${encodeURIComponent(q)}`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (res?.ok) json = await res.json().catch(() => null);
      }

      if (!json && GOOGLE_MAPS_API_KEY) {
        const res = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&key=${GOOGLE_MAPS_API_KEY}&components=country:us`).catch(() => null);
        if (res?.ok) json = await res.json().catch(() => null);
      }

      const suggestions = (json?.predictions || []).map((p: any) => {
        const description = String(p.description || p.structured_formatting?.main_text || '').trim();
        return {
          description,
          place_id: String(p.place_id || description),
          displayText: description,
        };
      }).filter((item: DriverHomeSuggestion) => item.description);
      setItems(suggestions);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[s.driverHomeAutocompleteWrap, { zIndex }]}>
      <TextInput
        style={[s.driverHomeInputPill, s.driverHomeInputText]}
        value={value}
        onChangeText={(text) => {
          onChangeText(text);
          setOpen(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void fetchSuggestions(text), 250);
        }}
        onFocus={() => {
          setOpen(true);
          if (value.trim().length >= 2) void fetchSuggestions(value);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        returnKeyType="next"
      />
      {open && (loading || items.length > 0) ? (
        <View style={s.driverHomeAutocompletePanel}>
          {loading ? (
            <View style={s.driverHomeAutocompleteState}>
              <View style={s.driverHomeAutocompleteIcon}>
                <Ionicons name="search-outline" size={15} color={ORANGE} />
              </View>
              <Text style={s.driverHomeAutocompleteSubText}>Searching locations...</Text>
            </View>
          ) : (
            items.slice(0, 6).map((item, index) => (
              <TouchableOpacity
                key={item.place_id}
                style={s.driverHomeAutocompleteItem}
                onPress={() => {
                  onChangeText(item.displayText);
                  setOpen(false);
                  setItems([]);
                }}
                activeOpacity={0.78}
              >
                <View style={s.driverHomeAutocompleteIcon}>
                  <Ionicons name={index === 0 ? 'location' : 'location-outline'} size={15} color={ORANGE} />
                </View>
                <View style={s.driverHomeAutocompleteCopy}>
                  <Text style={s.driverHomeAutocompleteText} numberOfLines={1}>{item.displayText.split(',')[0]}</Text>
                  <Text style={s.driverHomeAutocompleteSubText} numberOfLines={1}>{item.description}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function useDriverHomeTheme() {
  return {
    dark: false,
    bg: BG,
    bg2: '#FFFFFF',
    bg3: '#F3EFE8',
    card: '#FFFFFF',
    cardStrong: '#FFFFFF',
    input: 'rgba(21,35,58,0.045)',
    border: BORDER,
    text: NAVY,
    sub: MUTED,
    statusBar: 'dark-content' as const,
    blurTint: 'light' as const,
    pageGradient: [BG, BG] as unknown as readonly [string, string, ...string[]],
  };
}

// ─── Types (UNCHANGED) ────────────────────────────────────────────────────────
function DriverUberStylePromotionCard({
  promotion,
  onPress,
  width,
  secondary = false,
}: {
  promotion: Promotion;
  onPress: () => void;
  width: number;
  secondary?: boolean;
}) {
  const icon: keyof typeof Ionicons.glyphMap = promotion.type === 'referral'
    ? 'people-outline'
    : promotion.type === 'informational'
      ? 'information-circle-outline'
      : promotion.type === 'reward'
        ? 'gift-outline'
        : 'pricetag-outline';
  const action = promotion.linkText || (promotion.type === 'referral' ? 'Refer now' : 'View offer');

  return (
    <TouchableOpacity
      style={[s.uberPromoCard, { width }]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`${promotion.title}. ${action}`}
    >
      <View style={s.uberPromoCopy}>
        <Text style={s.uberPromoTitle} numberOfLines={3}>{promotion.title}</Text>
        <Text style={s.uberPromoDescription} numberOfLines={2}>{promotion.description}</Text>
        <View style={s.uberPromoCta}>
          <Text style={s.uberPromoCtaText}>{action}</Text>
        </View>
      </View>
      <View style={[s.uberPromoVisual, secondary && s.uberPromoVisualSecondary]}>
        <View style={[s.promoBubble, s.promoBubbleTop, secondary && s.promoBubbleSecondary]} />
        <View style={[s.promoBubble, s.promoBubbleBottom, secondary && s.promoBubbleSecondary]} />
        <View style={[s.promoIconLarge, secondary && s.promoIconLargeSecondary]}>
          <Ionicons name={icon} size={40} color="#FFFFFF" />
        </View>
        <View style={s.promoIconSmall}>
          <Ionicons name="car-outline" size={22} color={secondary ? SECONDARY : ORANGE} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function DriverHomePostRideCard() {
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const openPostRide = () => router.push({
    pathname: '/(driver)/book',
    params: { pickup, dropoff, ...(date.trim() ? { date } : {}), ...(time.trim() ? { time } : {}) },
  } as any);

  return (
    <View style={s.driverHomeSearchCard}>
      <View style={s.driverHomeRouteRow}>
        <View style={s.driverHomeRouteRail}>
          <View style={s.driverHomeNavyDot} />
          <View style={s.driverHomeDashedLine} />
          <View style={s.driverHomeOrangeDot} />
        </View>
        <View style={s.driverHomeRouteInputs}>
          <DriverHomeAutocomplete
            value={pickup}
            onChangeText={setPickup}
            placeholder="Austin, TX"
            zIndex={80}
          />
          <DriverHomeAutocomplete
            value={dropoff}
            onChangeText={setDropoff}
            placeholder="Houston, TX"
            zIndex={70}
          />
        </View>
      </View>
      <View style={s.driverHomeMetaRow}>
        <TouchableOpacity style={s.driverHomeMetaPill} onPress={() => setDateModalOpen(true)} activeOpacity={0.78} accessibilityRole="button">
          <Text style={[s.driverHomeMetaText, !date && s.driverHomePlaceholderText]}>{date ? formatDateLabel(date) : 'Fri, Nov 20'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.driverHomeMetaPill} onPress={() => setTimeModalOpen(true)} activeOpacity={0.78} accessibilityRole="button">
          <Text style={[s.driverHomeMetaText, !time && s.driverHomePlaceholderText]}>{time || 'Anytime'}</Text>
        </TouchableOpacity>
      </View>
      <DatePickerModal
        visible={dateModalOpen}
        selectedDate={date}
        onClose={() => setDateModalOpen(false)}
        onSelect={setDate}
      />
      <TimePickerModal
        visible={timeModalOpen}
        selectedTime={time}
        onClose={() => setTimeModalOpen(false)}
        onSelect={setTime}
      />
      <TouchableOpacity
        style={s.driverHomePrimaryBtn}
        onPress={openPostRide}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel="Post a ride"
      >
        <Text style={s.driverHomePrimaryText}>{'Post a ride ->'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function DriverHomeActivityCard({ ride, hasOfferReceived }: { ride: UpcomingRideCard; hasOfferReceived?: boolean }) {
  const [pickingUp,   setPickingUp]   = React.useState(false);
  const [completing,  setCompleting]  = React.useState(false);
  const [flagVisible, setFlagVisible] = React.useState(false);
  const dateText = ride.dateTime ? formatDate(ride.dateTime) : (ride.dateStr || 'Date pending');
  const rawStatus = String(ride.confirmedStatus || ride.status || '').toLowerCase();
  const isConfirmedOnly = rawStatus === 'confirmed';
  const isInProgress    = rawStatus === 'in_progress';
  const isConfirmed     = isConfirmedOnly || isInProgress;
  const isOfferSent     = rawStatus.includes('offer') || rawStatus === 'sent';
  const isPosting       = ride.type === 'ridePosting';

  const statusLabel = isInProgress ? 'IN PROGRESS'
    : isConfirmedOnly ? 'CONFIRMED'
    : (isPosting && hasOfferReceived) ? 'REQUEST RECEIVED'
    : isOfferSent ? 'OFFER SENT'
    : prettyStatus(rawStatus).toUpperCase();
  const statusColor = isInProgress ? ORANGE
    : isConfirmedOnly ? '#16A34A'
    : (isPosting && hasOfferReceived) ? '#D97706'
    : isOfferSent ? ORANGE
    : MUTED;
  const statusBg    = isInProgress ? 'rgba(222,93,32,0.08)'
    : isConfirmedOnly ? '#EDFAF3'
    : (isPosting && hasOfferReceived) ? 'rgba(245,158,11,0.12)'
    : isOfferSent ? 'rgba(222,93,32,0.08)'
    : '#F1F3F6';

  const openRequest = () => {
    if (ride.type === 'ridePosting') router.push('/(driver)/my-postings' as any);
    else router.push({ pathname: '/(driver)/request/[id]', params: { id: ride.id, returnTo: '/(driver)' } } as any);
  };

  const handlePickup = async () => {
    setPickingUp(true);
    try {
      const pickedUp = await actionConfirmPickup({
        confirmedId: ride.confirmedId,
        rideRequestId: ride.type === 'rideRequest' ? ride.id : undefined,
        ridePostingId: ride.type === 'ridePosting' ? ride.id : undefined,
        riderId: ride.riderId,
      });
      if (pickedUp && ride.confirmedId) {
        router.push(('/(driver)/trip/' + ride.confirmedId) as any);
      }
    } finally {
      setPickingUp(false);
    }
  };

  const handleComplete = async () => {
    const confirmedId = ride.confirmedId;
    if (!confirmedId) return;

    const doComplete = async () => {
      setCompleting(true);
      try {
        await actionCompleteRide({ confirmedId });
      } finally {
        setCompleting(false);
      }
    };

    // Check how far driver is from dropoff — warn if > 0.5 miles
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const raw = ride.raw || {};
        const dropoffRaw = raw.dropoff ?? raw.dropoffLocation ?? raw.dropoffCoords ?? null;
        let dropoffCoords: { latitude: number; longitude: number } | null = null;
        if (dropoffRaw?.latitude) dropoffCoords = { latitude: dropoffRaw.latitude, longitude: dropoffRaw.longitude };
        else if (dropoffRaw?.lat) dropoffCoords = { latitude: dropoffRaw.lat, longitude: dropoffRaw.lng };
        else if (dropoffRaw?.location?.lat) dropoffCoords = { latitude: dropoffRaw.location.lat, longitude: dropoffRaw.location.lng };

        if (dropoffCoords) {
          const dLat = ((dropoffCoords.latitude - loc.coords.latitude) * Math.PI) / 180;
          const dLng = ((dropoffCoords.longitude - loc.coords.longitude) * Math.PI) / 180;
          const h = Math.sin(dLat / 2) ** 2 + Math.cos((loc.coords.latitude * Math.PI) / 180) * Math.cos((dropoffCoords.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
          const distMi = 3958.8 * 2 * Math.asin(Math.sqrt(h));
          if (distMi > 0.5) {
            Alert.alert(
              'Not at dropoff yet',
              `You appear to be ${distMi.toFixed(1)} mi from the dropoff. Complete the ride anyway?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Complete anyway', style: 'destructive', onPress: doComplete },
              ],
            );
            return;
          }
        }
      }
    } catch {}
    doComplete();
  };

  const openChat = async () => {
    // Chats are keyed by confirmedRides doc ID (rideId field), created by Cloud Function on confirmation
    const confirmedId = ride.confirmedId || (isConfirmed ? ride.id : null);
    if (!confirmedId) { Alert.alert('Not available', 'The chat opens once the ride is confirmed.'); return; }
    try {
      const chatSnap = await getDocs(query(collection(firestore, 'chats'), where('rideId', '==', confirmedId)));
      if (!chatSnap.empty) {
        router.push(`/(driver)/messages/${chatSnap.docs[0].id}` as any);
      } else {
        Alert.alert('Not available', 'The chat will be available shortly after confirmation.');
      }
    } catch { Alert.alert('Error', 'Could not open chat. Please try again.'); }
  };

  return (
    <View style={[s.driverActivityCard, { minHeight: undefined }]}>
      {/* Status row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: statusBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{statusLabel}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {ride.priceText ? <Text style={{ color: NAVY, fontSize: 15, fontWeight: '800' }}>{ride.priceText}</Text> : null}
          {isConfirmed && ride.confirmedId ? (
            <TouchableOpacity onPress={() => setFlagVisible(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="flag-outline" size={18} color="#DC2626" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Route */}
      <TouchableOpacity activeOpacity={0.7} onPress={isInProgress && ride.confirmedId ? () => router.push(`/(driver)/trip/${ride.confirmedId}` as any) : openRequest}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ alignItems: 'center', paddingTop: 4, gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: NAVY }} />
            <View style={{ width: 1, flex: 1, minHeight: 16, backgroundColor: BORDER }} />
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: ORANGE }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: NAVY, fontSize: 15, fontWeight: '600', marginBottom: 4 }} numberOfLines={1}>{ride.from || 'Pickup pending'}</Text>
            <Text style={{ color: MUTED, fontSize: 12, marginBottom: 4 }}>{dateText}</Text>
            <Text style={{ color: NAVY, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{ride.to || 'Destination pending'}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER }}>
        {ride.riderId && (
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#F3EFE8', borderRadius: 20, paddingVertical: 10, alignItems: 'center' }}
            onPress={openChat}
            activeOpacity={0.75}
          >
            <Text style={{ color: NAVY, fontSize: 13, fontWeight: '700' }}>Message Rider</Text>
          </TouchableOpacity>
        )}
        {isConfirmedOnly && (
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: ORANGE, borderRadius: 20, paddingVertical: 10, alignItems: 'center', opacity: pickingUp ? 0.6 : 1 }}
            onPress={handlePickup}
            disabled={pickingUp}
            activeOpacity={0.8}
          >
            {pickingUp
              ? <ActivityIndicator size="small" color="#FFF" />
              : <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>Pick Up</Text>}
          </TouchableOpacity>
        )}
        {isInProgress && (
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: NAVY, borderRadius: 20, paddingVertical: 10, alignItems: 'center', opacity: completing ? 0.6 : 1 }}
            onPress={handleComplete}
            disabled={completing}
            activeOpacity={0.8}
          >
            {completing
              ? <ActivityIndicator size="small" color="#FFF" />
              : <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>Complete Ride</Text>}
          </TouchableOpacity>
        )}
        {!isConfirmedOnly && !isInProgress && (
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: NAVY, borderRadius: 20, paddingVertical: 10, alignItems: 'center' }}
            onPress={openRequest}
            activeOpacity={0.8}
          >
            <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}>View Details</Text>
          </TouchableOpacity>
        )}
      </View>

      {ride.confirmedId ? (
        <FlagRideModal
          visible={flagVisible}
          onClose={() => setFlagVisible(false)}
          rideId={ride.confirmedId}
          role="driver"
          onFlagged={() => setFlagVisible(false)}
        />
      ) : null}
    </View>
  );
}

type UpcomingRideCard = {
  id: string;
  type: 'ride' | 'rideRequest' | 'ridePostingRequest' | 'ridePosting';
  status: string;
  from?: string;
  to?: string;
  dateTime: Date | null;
  dateStr?: string;
  confirmedId?: string;
  ridePostingId?: string;
  confirmedStatus?: string;
  riderId?: string;
  confirmedDriverComplete?: boolean;
  confirmedDriverPickup?: boolean;
  etaText?: string;
  durationText?: string;
  priceText?: string;
  distanceText?: string;
  seatCount?: number;
  seats?: number;          // ← add this
  seatsAvailable?: number; // ← add this
  driverName?: string;
  driverRating?: number | null;
  vehicleText?: string;
  driverPhone?: string | null;
  riderName?: string;
  riderAvatarUrl?: string | null;
  riderRating?: number | null;
  raw?: Record<string, any>;
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

type LiveRequestMarker = {
  id: string;
  pickup: string;
  dropoff?: string;
  latitude: number;
  longitude: number;
  priceText?: string;
  requestedAt?: Date | null;
};

type HotZone = {
  key: string;
  name: string;
  riders: number;
  dist: string;
  earn: string;
  heat: string;
  bg: string;
};

const toRad = (value: number) => value * Math.PI / 180;

function distanceMiles(
  a?: { latitude: number; longitude: number } | null,
  b?: { latitude: number; longitude: number } | null
) {
  if (!a || !b) return null;

  const R = 3958.8;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function parsePriceText(value?: string) {
  if (!value) return null;
  const n = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function zoneNameFromPickup(pickup: string) {
  const first = pickup.split(',')[0]?.trim();
  if (!first || first.toLowerCase() === 'pickup') return 'Campus pickup zone';
  return first.length > 22 ? `${first.slice(0, 22)}...` : first;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
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



  const [flagModalVisible, setFlagModalVisible] = useState(false);
  const [flaggingRideRef, setFlaggingRideRef] = useState<any | null>(null);
  const [flaggingLoading, setFlaggingLoading] = useState(false);

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
  const [driverUniversity, setDriverUniversity] = useState<string | undefined>(undefined);
  const [stats, setStats] = useState({ totalRides: 0, totalEarnings: 0, avgRating: null as number | null, ratingCount: null as number | null });
  const [monthlyStats, setMonthlyStats] = useState<{ rides: number; earnings: number; rating: number | null; loaded: boolean }>({ rides: 0, earnings: 0, rating: null, loaded: false });
  const [offersByRideId, setOffersByRideId] = useState<Record<string, OfferInfo>>({});
  // Map postingId -> pending request info (to flip posting card to Offer Received)
  const [postingReqByPostingId, setPostingReqByPostingId] = useState<Record<string, { id: string; status: string }>>({});
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const notifReadMapRef = useRef<Record<string, boolean>>({});
  const [confirmedByReqId, setConfirmedByReqId] = useState<Record<string, boolean>>({});
  const [confirmedByPostingId, setConfirmedByPostingId] = useState<Record<string, boolean>>({});
  const [historyOnlySourceKeys, setHistoryOnlySourceKeys] = useState<Set<string>>(new Set());

  const [currentPromotionIndex, setCurrentPromotionIndex] = useState(0);
  const promotionScrollRef = useRef<ScrollView | null>(null);

  const [driverLocation, setDriverLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const [liveRequestMarkers, setLiveRequestMarkers] = useState<LiveRequestMarker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  // Queue ratings per rider (seat) so group rides are rated individually



  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!mounted) return;

        setDriverLocation({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });
      } catch (error) {
        console.warn('Driver location failed', error);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

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

  useEffect(() => {
    const qOpen = query(
      collection(firestore, 'rideRequests'),
      where('status', '==', 'pending')
    );

    const unsub = onSnapshot(qOpen, (snap) => {
      const next: LiveRequestMarker[] = [];

      snap.forEach((d) => {
        const r = d.data() as any;
        const loc = r.pickupLocation || r.pickup || r.from;

        const latitude =
          typeof loc?.latitude === 'number' ? loc.latitude :
          typeof loc?.lat === 'number' ? loc.lat :
          typeof r?.pickupLat === 'number' ? r.pickupLat :
          undefined;

        const longitude =
          typeof loc?.longitude === 'number' ? loc.longitude :
          typeof loc?.lng === 'number' ? loc.lng :
          typeof r?.pickupLng === 'number' ? r.pickupLng :
          undefined;

        if (typeof latitude !== 'number' || typeof longitude !== 'number') return;

        const price =
          parseCurrency(r?.contributionAmount) ??
          parseCurrency(r?.contribution) ??
          parseCurrency(r?.price) ??
          parseCurrency(r?.estimatedFare);

        next.push({
          id: d.id,
          pickup: extractAddress(r, 'pickup') || 'Pickup',
          dropoff: extractAddress(r, 'dropoff'),
          latitude,
          longitude,
          priceText: typeof price === 'number' ? `$${price.toFixed(0)}` : undefined,
          requestedAt: toDateField(r.createdAt || r.requestedTime || r.date),
        });
      });

      setLiveRequestMarkers(next);
    }, (error) => {
      console.warn('live rideRequests map listener error', error);
    });

    return () => unsub();
  }, []);

  // Refresh driver rating stat card reading aggregates from drivers/{uid}
  async function refreshDriverRatingStatCard(userId: string, set: React.Dispatch<React.SetStateAction<{ totalRides: number; totalEarnings: number; avgRating: number | null; ratingCount: number | null }>>) {
    try {
      const { avg, count } = await computeFilteredAverageRating(userId);
      set((s) => ({ ...s, avgRating: typeof avg === 'number' && isFinite(avg) ? avg : s.avgRating, ratingCount: count ?? s.ratingCount }));
    } catch {}
  }

  // average rating helper moved to src/services/ratings

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
        router.push({ pathname: '/(driver)/messages/[chatId]', params: { chatId, returnTo: '/(driver)' } } as any);
      } else {
        // Navigate to messages tab - chat will be auto-created when first message is sent
        router.push('/(driver)/messages');
      }
    } catch (error) {
      console.error('Error finding chat:', error);
      router.push('/(driver)/messages');
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
            setDriverUniversity(driverData?.university || pi?.university || undefined);
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

      const uN1 = onSnapshot(qUserId, mergeAndSet, () => {});
      unsubs.push(uN1);
      const uN2 = onSnapshot(qRecipientId, mergeAndSet, () => {});
      unsubs.push(uN2);
      if (qEmailUser) {
        const uN3 = onSnapshot(qEmailUser, mergeAndSet, () => {});
        unsubs.push(uN3);
      }
      const uN4 = onSnapshot(qRecipients, mergeAndSet, () => {});
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
        if (postingId && ['accepted', 'confirmed'].includes(String(r?.status || '').toLowerCase())) {
          void ensureAcceptedPostingRequestConfirmation(d.id, r, uid ? String(uid) : '').catch((error) => {
            console.warn('Accepted posting request repair failed', d.id, error);
          });
        }
        if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
          byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
        }
        items.push({
          id: d.id,
          type: 'ridePostingRequest',
          status: String(r?.status || 'offer_sent'),
          ridePostingId: postingId ? String(postingId) : undefined,
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
        if (postingId && ['accepted', 'confirmed'].includes(String(r?.status || '').toLowerCase())) {
          void ensureAcceptedPostingRequestConfirmation(d.id, r, uid ? String(uid) : '').catch((error) => {
            console.warn('Accepted posting request repair failed', d.id, error);
          });
        }
          if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
            byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
          }
          items.push({
            id: d.id,
            type: 'ridePostingRequest',
            status: String(r?.status || 'offer_sent'),
          ridePostingId: postingId ? String(postingId) : undefined,
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
        if (postingId && ['accepted', 'confirmed'].includes(String(r?.status || '').toLowerCase())) {
          void ensureAcceptedPostingRequestConfirmation(d.id, r, uid ? String(uid) : '').catch((error) => {
            console.warn('Accepted posting request repair failed', d.id, error);
          });
        }
          if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
            byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
          }
          items.push({
            id: d.id,
            type: 'ridePostingRequest',
            status: String(r?.status || 'pending'),
          ridePostingId: postingId ? String(postingId) : undefined,
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
        if (postingId && ['accepted', 'confirmed'].includes(String(r?.status || '').toLowerCase())) {
          void ensureAcceptedPostingRequestConfirmation(d.id, r, uid ? String(uid) : '').catch((error) => {
            console.warn('Accepted posting request repair failed', d.id, error);
          });
        }
            if (postingId && !['rejected','declined','cancelled','canceled','completed','accepted','confirmed'].includes(String(r?.status || '').toLowerCase())) {
              byPosting[String(postingId)] = { id: d.id, status: String(r?.status || 'pending') };
            }
            items.push({
              id: d.id,
              type: 'ridePostingRequest',
              status: String(r?.status || 'pending'),
          ridePostingId: postingId ? String(postingId) : undefined,
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
        const historyOnlyKeys = new Set<string>();
        const groupBuckets: Record<string, Array<{ id: string; data: any }>> = {};
          snap.forEach((d) => {
          const r = d.data() || {};
          const statusRaw = String(r?.status || '').toUpperCase();
          const statusAtFlagRaw = String(r?.statusAtFlag || r?.statusBeforeFlag || r?.flaggedFromStatus || r?.previousStatus || '').replace(/[-\s]/g, '_').toUpperCase();
          const isHistoryOnly = statusRaw === 'COMPLETED' || (statusRaw === 'FLAGGED' && statusAtFlagRaw === 'COMPLETED');
          // Always flag maps so we can hide posting/request cards even when completed
          if (r.rideRequestId) reqMap[String(r.rideRequestId)] = true;
          if (r.ridePostingId) postMap[String(r.ridePostingId)] = true;
          if (isHistoryOnly) {
            if (r.rideRequestId) historyOnlyKeys.add(`rideRequest:${String(r.rideRequestId)}`);
            if (r.ridePostingId) historyOnlyKeys.add(`ridePosting:${String(r.ridePostingId)}`);
            if (r.ridePostingRequestId) historyOnlyKeys.add(`ridePostingRequest:${String(r.ridePostingRequestId)}`);
          }
          // Accumulate by posting for potential group ride aggregation
          if (r.ridePostingId) {
            const pid = String(r.ridePostingId);
            if (!groupBuckets[pid]) groupBuckets[pid] = [];
            groupBuckets[pid].push({ id: d.id, data: r });
          }
          if (isHistoryOnly) {
            // Add a stub card so it overrides any stale posting/request card in the dedup merge.
            // displayUpcoming will filter it out (completed is in inactiveStatuses), so nothing renders.
            if (r.ridePostingId) {
              cards[`ridePosting-${String(r.ridePostingId)}`] = {
                id: String(r.ridePostingId), type: 'ridePosting',
                status: 'completed', confirmedStatus: 'COMPLETED',
                from: '', to: '', confirmedId: d.id,
              } as any;
            } else if (r.rideRequestId) {
              cards[`rideRequest-${String(r.rideRequestId)}`] = {
                id: String(r.rideRequestId), type: 'rideRequest',
                status: 'completed', confirmedStatus: 'COMPLETED',
                from: '', to: '', confirmedId: d.id,
              } as any;
            }
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
              raw: r,
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
              raw: r,
            };
          }
        });
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
            const anyConfirmed = childStatuses.some((s) => s === 'CONFIRMED');
            const anyPending = childStatuses.some((s) => s === 'PENDING');
            const anyInProgress = childStatuses.some((s) => s === 'IN_PROGRESS');
            const allCompleted = childStatuses.every((s) => s === 'COMPLETED');
            const anyFlagged = childStatuses.some((s) => s === 'FLAGGED');
            // Check if any flagged ride was COMPLETED when flagged
            const anyFlaggedWasCompleted = items.some((it) => 
              String(it.data?.status || '').toUpperCase() === 'FLAGGED' && 
              String(it.data?.statusAtFlag || it.data?.statusBeforeFlag || it.data?.flaggedFromStatus || it.data?.previousStatus || '').replace(/[-\s]/g, '_').toUpperCase() === 'COMPLETED'
            );
            // Skip group ride if any child was flagged after COMPLETED (hide from upcoming)
            if (anyFlaggedWasCompleted) {
              return;
            }
            // Determine aggregated status: PENDING until all seats filled, then follow ride progression
            const aggregatedStatus = anyFlagged
              ? 'FLAGGED'
              : allCompleted
                ? 'COMPLETED'
                : anyInProgress
                  ? 'IN_PROGRESS'
                  : (allConfirmed || anyConfirmed || anyPending)
                    ? 'CONFIRMED'
                    : 'PENDING';
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
        setHistoryOnlySourceKeys(historyOnlyKeys);
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

  // Also query ridePostingRequests by ridePostingId directly — more reliable
  // than relying on driverId being set, since the rider writes that field
  const activeIds = items.map((it) => it.id).filter(Boolean);
  if (activeIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < activeIds.length; i += 30) chunks.push(activeIds.slice(i, i + 30));
    Promise.all(
      chunks.map((chunk) =>
        getDocs(query(
          collection(firestore, 'ridePostingRequests'),
          where('ridePostingId', 'in', chunk),
        )).catch(() => null)
      )
    ).then((snaps) => {
      const byPosting: Record<string, { id: string; status: string }> = {};
      const inactive = new Set(['rejected','declined','cancelled','canceled','completed','accepted','confirmed']);
      snaps.forEach((reqSnap) => {
        if (!reqSnap) return;
        reqSnap.forEach((d) => {
          const r = d.data() as any;
          const status = String(r?.status || 'pending').toLowerCase();
          const pid = String(r?.ridePostingId || r?.rideId || '');
          if (pid && !inactive.has(status)) {
            byPosting[pid] = { id: d.id, status };
          }
        });
      });
      if (Object.keys(byPosting).length > 0) {
        setPostingReqByPostingId((prev) => ({ ...prev, ...byPosting }));
      }
    }).catch(() => {});
  }
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

  // Live listener: watch ridePostingRequests by ridePostingId so "Offer Received"
  // badge updates the moment a rider books, without waiting for the posting to change.
  const _postingIdsKey = useMemo(
    () => Object.keys(upcPostingsDriver).sort().join(','),
    [upcPostingsDriver],
  );
  useEffect(() => {
    const ids = _postingIdsKey ? _postingIdsKey.split(',') : [];
    if (ids.length === 0) return;

    const terminal = new Set(['rejected','declined','cancelled','canceled','completed','accepted','confirmed']);
    const innerUnsubs: Array<() => void> = [];

    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const unsub = onSnapshot(
        query(collection(firestore, 'ridePostingRequests'), where('ridePostingId', 'in', chunk)),
        (snap) => {
          const byPosting: Record<string, { id: string; status: string }> = {};
          snap.forEach((d) => {
            const r = d.data() as any;
            const status = String(r?.status || 'pending').toLowerCase();
            const pid = String(r?.ridePostingId || '');
            if (pid && !terminal.has(status)) {
              byPosting[pid] = { id: d.id, status };
            }
          });
          setPostingReqByPostingId((prev) => {
            const next = { ...prev };
            chunk.forEach((id) => delete next[id]);
            return { ...next, ...byPosting };
          });
        },
        () => {},
      );
      innerUnsubs.push(unsub);
    }

    return () => innerUnsubs.forEach((u) => u());
  }, [_postingIdsKey]);

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
        const res = await fetch(`${apiUrl}/api/connect/driver-earnings?userId=${uid}&summaryOnly=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error('Failed to fetch earnings');
        }
        const data = await res.json();
        if (mounted) {
          setStats((s) => ({ ...s, totalEarnings: data.lifetime || 0 }));
        }
      } catch {
        if (mounted) setStats((s) => ({ ...s, totalEarnings: 0 }));
      }
    }
    fetchEarnings();
    return () => { mounted = false; };
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let mounted = true;
    (async () => {
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const toTs = (v: any): Date | null => {
          if (!v) return null;
          if (v instanceof Timestamp) return v.toDate();
          if (v instanceof Date) return v;
          if (typeof v === 'number') return new Date(v);
          if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
          return null;
        };
        const toNum = (v: any): number => {
          if (typeof v === 'number') return v;
          if (typeof v === 'string') { const n = Number(v.replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
          return 0;
        };

        const snap = await getDocs(query(
          collection(firestore, 'confirmedRides'),
          where('driverId', '==', uid),
          where('status', '==', 'COMPLETED'),
        ));

        let rides = 0;
        let earnings = 0;
        const monthlyRideIds: string[] = [];

        snap.forEach((d) => {
          const r = d.data() as any;
          const rideDate = toTs(r.completedAt ?? r.confirmedAt ?? r.updatedAt ?? r.createdAt);
          if (!rideDate || rideDate < startOfMonth) return;
          rides++;
          monthlyRideIds.push(d.id);
          const raw = r.paymentAmount ?? r.contributionAmount ?? r.price ?? r.fare
            ?? r.originalRidePosting?.pricePerSeat ?? r.originalRideRequest?.maxPrice ?? 0;
          earnings += toNum(raw);
        });

        // Fetch ratings for this month's rides
        let monthlyRating: number | null = null;
        if (monthlyRideIds.length > 0) {
          const stars: number[] = [];
          for (let i = 0; i < monthlyRideIds.length; i += 10) {
            const chunk = monthlyRideIds.slice(i, i + 10);
            try {
              const ratingSnap = await getDocs(query(
                collection(firestore, 'rideRatings'),
                where('rateeId', '==', uid),
                where('rideId', 'in', chunk),
              ));
              ratingSnap.forEach((rd) => {
                const s = (rd.data() as any).stars;
                if (typeof s === 'number' && isFinite(s)) stars.push(s);
              });
            } catch { /* ignore chunk errors */ }
          }
          if (stars.length > 0) {
            monthlyRating = stars.reduce((a, b) => a + b, 0) / stars.length;
          }
        }

        if (mounted) setMonthlyStats({ rides, earnings, rating: monthlyRating, loaded: true });
      } catch {
        if (mounted) setMonthlyStats((s) => ({ ...s, loaded: true }));
      }
    })();
    return () => { mounted = false; };
  }, [uid]);

  const sortedUpcoming = useMemo(() => sortByDate(upcoming), [upcoming]);
  // Dedupe across sources (rideRequest vs ridePosting) by route + time bucket, preferring rideRequest
  // Filter out any items that are cancelled so we do not render cancelled cards in Upcoming
  const displayUpcoming = useMemo(() => {
    const inactiveStatuses = new Set(['cancelled', 'canceled', 'expired', 'completed', 'complete', 'finished', 'rejected', 'declined']);
    return (sortedUpcoming || []).filter((r) => {
      const s = String((r as any)?.status || '').replace(/[-\s]/g, '_').toLowerCase();
      const cs = String((r as any)?.confirmedStatus || '').replace(/[-\s]/g, '_').toLowerCase();
      const raw = (r as any)?.raw || {};
      const statusAtFlag = String((r as any)?.statusAtFlag || (r as any)?.statusBeforeFlag || (r as any)?.flaggedFromStatus || (r as any)?.previousStatus || raw.statusAtFlag || raw.statusBeforeFlag || raw.flaggedFromStatus || raw.previousStatus || '').replace(/[-\s]/g, '_').toLowerCase();
      return !inactiveStatuses.has(s) && !inactiveStatuses.has(cs) && statusAtFlag !== 'completed';
    });
  }, [sortedUpcoming]);

  // Navigate to rate-trip when a confirmed ride reaches COMPLETED (rider confirmed arrival)
  const driverRatingNavRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    Object.entries(upcConfirmed).forEach(async ([, card]) => {
      const cs = String((card as any).confirmedStatus || '').toUpperCase();
      const id = (card as any).confirmedId;
      if (cs === 'COMPLETED' && id && !driverRatingNavRef.current.has(id)) {
        driverRatingNavRef.current.add(id);
        try {
          const snap = await getDoc(doc(firestore, 'confirmedRides', id));
          const alreadyRated = !!snap.data()?.driverRated || !!(uid && await hasUserRatedRide(id, uid));
          if (alreadyRated) return;
        } catch {}
        setTimeout(() => {
          router.push({ pathname: '/(driver)/rate-trip', params: { confirmedRideId: id } } as any);
        }, 500);
      }
    });
  }, [upcConfirmed, uid]);

  // Auto-capture is now server-driven. Client effect removed; server will sweep on completion.

  // Always recompute the combined Upcoming list from the latest maps.
  // This prevents stale-closure issues from individual listeners calling setCombinedUpcoming
  // with out-of-date views of other maps (e.g., after posting a ride, confirmed could be dropped).
  useEffect(() => {
    const isHistoryOnlyCard = (card: UpcomingRideCard) => {
      if (card.type === 'rideRequest') return historyOnlySourceKeys.has(`rideRequest:${card.id}`);
      if (card.type === 'ridePosting') return historyOnlySourceKeys.has(`ridePosting:${card.id}`);
      if (card.type === 'ridePostingRequest') {
        return historyOnlySourceKeys.has(`ridePostingRequest:${card.id}`)
          || (!!card.ridePostingId && historyOnlySourceKeys.has(`ridePosting:${card.ridePostingId}`));
      }
      if (card.type === 'groupRide') return historyOnlySourceKeys.has(`ridePosting:${card.id}`);
      return false;
    };

    const acceptedPostingRequests = [
      ...Object.values(upcPostingReqDriver || {}),
      ...Object.values(upcPostingReqEmail || {}),
      ...Object.values(upcPostingReqOwner || {}),
      ...Object.values(upcPostingReqOwnerEmail || {}),
    ].filter((card) => {
      const status = String(card.status || '').toLowerCase();
      const postingId = card.ridePostingId;
      return ['accepted', 'confirmed'].includes(status)
        && (!postingId || (confirmedCountByPostingId[postingId] || 0) === 0);
    }).filter((card) => !isHistoryOnlyCard(card) && (!card.ridePostingId || !historyOnlySourceKeys.has(`ridePosting:${card.ridePostingId}`)))
      .map((card) => ({ ...card, status: 'CONFIRMED', confirmedStatus: 'CONFIRMED' }));
    const acceptedPostingIds = new Set(
      acceptedPostingRequests.map((card) => card.ridePostingId).filter((id): id is string => Boolean(id)),
    );

    const arr: UpcomingRideCard[] = [
      ...Object.values(upcOffersSent || {}).filter((c) => !isHistoryOnlyCard(c)),
      ...Object.values(upcReqDriver || {}).filter((c) => !isHistoryOnlyCard(c)),
      ...Object.values(upcReqUserId || {}).filter((c) => !isHistoryOnlyCard(c)),
      ...Object.values(upcReqEmail || {}).filter((c) => !isHistoryOnlyCard(c)),
      ...Object.values(upcReqEmailAlt || {}).filter((c) => !isHistoryOnlyCard(c)),
      // We do not render posting request cards directly; they only flip posting cards
      // ...Object.values(upcPostingReqDriver || {}),
      // ...Object.values(upcPostingReqEmail || {}),
      // ...Object.values(upcPostingReqOwner || {}),
      // ...Object.values(upcPostingReqOwnerEmail || {}),
      // Keep posting cards visible until ALL seats are filled (not just ANY)
      // This allows showing "Posted 1/2" or "Offer received" badges for partial fills
  ...Object.values(upcPostingsDriver || {}).filter((c) => {
        if (isHistoryOnlyCard(c)) return false;
        if (c.type !== 'ridePosting') return true;
        const seatsFilled = confirmedCountByPostingId[c.id] || 0;
        return seatsFilled === 0 && !acceptedPostingIds.has(c.id);
      }),
  ...Object.values(upcPostingsEmail || {}).filter((c) => {
        if (isHistoryOnlyCard(c)) return false;
        if (c.type !== 'ridePosting') return true;
        const seatsFilled = confirmedCountByPostingId[c.id] || 0;
        return seatsFilled === 0 && !acceptedPostingIds.has(c.id);
      }),
      // Accepted requests recover older records that predate confirmedRides synchronization.
      ...acceptedPostingRequests,
      // Confirmed at the end so it overrides placeholders with the same (type-id)
  // Include only active confirmed rides in Upcoming.
  ...Object.values(upcConfirmed || {}).filter((c) => {
    if (isHistoryOnlyCard(c)) return false;
    const inactiveStatuses = new Set(['completed', 'complete', 'finished', 'cancelled', 'canceled', 'expired', 'rejected', 'declined']);
    const s = String(c.status || '').replace(/[-\s]/g, '_').toLowerCase();
    const cs = String(c.confirmedStatus || '').replace(/[-\s]/g, '_').toLowerCase();
    const raw = (c as any).raw || {};
    const statusAtFlag = String((c as any).statusAtFlag || (c as any).statusBeforeFlag || (c as any).flaggedFromStatus || (c as any).previousStatus || raw.statusAtFlag || raw.statusBeforeFlag || raw.flaggedFromStatus || raw.previousStatus || '').replace(/[-\s]/g, '_').toLowerCase();
    return !inactiveStatuses.has(s) && !inactiveStatuses.has(cs) && statusAtFlag !== 'completed';
  }),
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
    historyOnlySourceKeys,
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
      // The server owns seat allocation; the client then verifies the canonical
      // confirmedRides document so older backend deployments cannot leave the UI half-confirmed.
      if (!postingId) throw new Error('Missing postingId on request');
      if (!uid) throw new Error('Driver is not signed in');

      const driverSnap = await getDoc(doc(firestore, 'drivers', uid));
      const driver = driverSnap.exists() ? (driverSnap.data() as any) : {};
      const driverName = [driver.firstName, driver.lastName].filter(Boolean).join(' ').trim()
        || driver.personalInfo?.fullName || driver.displayName || driver.name || userName || 'Driver';
      const driverEmail = driver.personalInfo?.email || driver.email || email || firebaseAuth.currentUser?.email || '';
      const base = getApiBaseUrl();
      const token = await firebaseAuth.currentUser?.getIdToken();
      const seatPrice = typeof r?.contributionAmount === 'number'
        ? r.contributionAmount
        : (typeof post?.pricePerSeat === 'number' ? post.pricePerSeat : undefined);
      const resp = await fetch(`${base}/api/ride-postings/${encodeURIComponent(String(postingId))}/requests/${encodeURIComponent(requestId)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ driverId: uid, driverName, driverEmail, seatPrice }),
      });
      if (!resp.ok) {
        let errText = 'Failed to accept request';
        try { const j = await resp.json(); errText = j?.error || errText; } catch {}
        throw new Error(errText);
      }
      const result = await resp.json().catch(() => ({} as any));

      const riderId = r.riderId || r.userId || r.requesterId || r.ownerId;
      if (!riderId) throw new Error('The accepted request is missing its rider ID');

      const totalSeats = Number(result.totalSeats ?? post?.seatsAvailable ?? post?.totalSeats ?? post?.seats ?? 1) || 1;
      const seatsTaken = Number(result.seatsTaken ?? post?.seatsTaken ?? r.passengers ?? 1) || 1;
      const seatsRemaining = Math.max(0, Number(result.seatsRemaining ?? (totalSeats - seatsTaken)) || 0);
      const confirmedId = String(result.confirmedRideId || `${postingId}_${requestId}`);
      const confirmedPayload = deepClean({
        ridePostingRequestId: requestId,
        ridePostingId: String(postingId),
        riderId: String(riderId),
        riderName: r.riderName || r.userName || r.requesterName || 'Rider',
        riderEmail: r.riderEmail || r.userEmail || r.requesterEmail || null,
        riderPhone: r.riderPhone || r.userPhone || r.phone || null,
        driverId: uid,
        driverName,
        driverEmail,
        driverPhone: driver.personalInfo?.phone || driver.phone || null,
        vehicleInfo: driver.vehicleInfo || post?.vehicleInfo || null,
        pickup: post?.pickup || post?.pickupAddress || r.pickup || r.pickupAddress || null,
        dropoff: post?.dropoff || post?.dropoffAddress || r.dropoff || r.dropoffAddress || null,
        date: post?.date || r.date || null,
        time: post?.time || r.time || null,
        passengers: Number(r.passengers ?? r.seats ?? 1) || 1,
        contributionAmount: r.contributionAmount ?? r.price ?? seatPrice ?? null,
        paymentIntentId: r.paymentIntentId || null,
        paymentStatus: r.paymentStatus || 'authorized',
        totalSeats,
        seatsTaken,
        seatsRemaining,
        status: 'CONFIRMED',
        source: 'mobile:accept-posting-request',
        originalRidePosting: post || null,
        originalRidePostingRequest: { id: requestId, ...r },
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(firestore, 'confirmedRides', confirmedId), confirmedPayload, { merge: true });
      await updateDoc(doc(firestore, 'ridePostingRequests', requestId), {
        status: 'accepted',
        confirmedRideId: confirmedId,
        acceptedBy: uid,
        updatedAt: serverTimestamp(),
      });

      setConfirmedCountByPostingId((prev) => ({
        ...prev,
        [String(postingId)]: Math.max(prev[String(postingId)] || 0, seatsTaken),
      }));

      Alert.alert('Ride confirmed', 'The rider has been notified and the confirmed ride is now available to both of you.');

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
      Alert.alert('Accept failed', e instanceof Error ? e.message : 'Failed to accept request. Please try again.');
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
        const cardWidth = Math.min(Dimensions.get('window').width, 430) - 52;
        const scrollPosition = nextIndex * (cardWidth + 12);
        
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

  // ── Pulse animations ────────────────────────────────────────────────────
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const makePulse = (a: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(a, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]));
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(glowAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
      Animated.timing(glowAnim, { toValue: 0.35, duration: 2200, useNativeDriver: true }),
    ]));
    const p1 = makePulse(pulse1, 0);
    const p2 = makePulse(pulse2, 480);
    const p3 = makePulse(pulse3, 960);
    p1.start(); p2.start(); p3.start(); glow.start();
    return () => { p1.stop(); p2.stop(); p3.stop(); glow.stop(); };
  }, []);

  // ─── RENDER ─────────────────────────────────────────────────────────────

  const { width: SW } = Dimensions.get('window');
  const promotionCardWidth = Math.min(SW, 430) - 44;
  const promotionSnapInterval = promotionCardWidth + 12;

  const badgeProps = (
    isOfferReceived: boolean, isOfferSent: boolean, isPosted: boolean,
    isConfirmed: boolean, isInProgress: boolean, isFlagged: boolean,
  ) => {
    if (isFlagged)       return { bg: 'rgba(239,68,68,0.15)',   txt: COLORS.red,   label: 'Flagged' };
    if (isOfferReceived) return { bg: 'rgba(245,158,11,0.15)',  txt: COLORS.amber, label: 'Offer Received' };
    if (isOfferSent)     return { bg: 'rgba(59,130,246,0.15)',  txt: COLORS.blue,  label: 'Offer Sent' };
    if (isInProgress)    return { bg: 'rgba(16,185,129,0.15)',  txt: COLORS.green, label: 'In Progress' };
    if (isConfirmed)     return { bg: 'rgba(16,185,129,0.15)',  txt: COLORS.green, label: 'Confirmed' };
    if (isPosted)        return { bg: 'rgba(150,170,190,0.12)', txt: MUTED, label: 'Posted' };
    return                      { bg: 'rgba(150,170,190,0.12)', txt: MUTED, label: prettyStatus(undefined) };
  };


  const hotZones = useMemo<HotZone[]>(() => {
    const buckets = new Map<string, LiveRequestMarker[]>();

    liveRequestMarkers.forEach((request) => {
      const key = `${request.latitude.toFixed(2)}_${request.longitude.toFixed(2)}`;
      buckets.set(key, [...(buckets.get(key) || []), request]);
    });

    return Array.from(buckets.entries())
      .map(([key, requests]) => {
        const first = requests[0];

        const prices = requests
          .map((request) => parsePriceText(request.priceText))
          .filter((price): price is number => typeof price === 'number');

        const avg = prices.length
          ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length)
          : null;

        const dist = distanceMiles(driverLocation, {
          latitude: first.latitude,
          longitude: first.longitude,
        });

        const heat =
          requests.length >= 4 ? COLORS.red :
          requests.length >= 3 ? COLORS.amber :
          requests.length >= 2 ? COLORS.blue :
          COLORS.green;

        const bg =
          requests.length >= 4 ? 'rgba(239,68,68,0.14)' :
          requests.length >= 3 ? 'rgba(245,158,11,0.14)' :
          requests.length >= 2 ? 'rgba(59,130,246,0.14)' :
          'rgba(16,185,129,0.14)';

        return {
          key,
          name: zoneNameFromPickup(first.pickup),
          riders: requests.length,
          dist: dist == null ? 'Nearby' : `${dist.toFixed(1)} mi`,
          earn: avg == null ? 'Open' : `$${Math.max(1, avg - 2)}-${avg + 2}`,
          heat,
          bg,
        };
      })
      .sort((a, b) => b.riders - a.riders)
      .slice(0, 6);
  }, [driverLocation, liveRequestMarkers]);

  const firstName = userName ? capitalize(userName) : 'Driver';
  const driverHeroPrompt = useMemo(() => {
    const next = displayUpcoming[0];
    if (!next) return 'where to?';

    const status = String(next.confirmedStatus || next.status || '').toLowerCase();
    if (status.includes('progress') || status.includes('driver_completed') || status.includes('rider_completed')) return 'your ride is in progress.';
    if (status.includes('confirmed')) return 'your ride has been confirmed!';
    if (next.type === 'ridePosting') {
      return postingReqByPostingId[next.id] ? 'you received a request!' : 'your ride is posted.';
    }
    if (status.includes('offer_sent') || status === 'sent') return 'your offer has been sent!';
    if (next.type === 'ridePostingRequest' || status.includes('offer') || status.includes('pending')) return 'you have a ride request!';

    return 'your next ride is coming up.';
  }, [displayUpcoming, postingReqByPostingId]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.orange} />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: BG }]}>
      <StatusBar barStyle="dark-content" />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        <ScrollView
          style={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingBottom: 72 + insets.bottom }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing} onRefresh={onRefresh}
              tintColor={COLORS.orange} colors={[COLORS.orange]}
            />
          }
        >
          <DriverHomeUtilityBar
            university={driverUniversity}
            initial={firstName.charAt(0).toUpperCase()}
            avatarUrl={driverAvatarUrl || userPhoto}
          />
          <View style={s.heroCopy}>
            <Text style={s.heroTitle}>
              Hey {firstName} - <Text style={s.heroAccent}>{driverHeroPrompt}</Text>
            </Text>
          </View>

          {/* Verification Banner */}
          <StudentVerificationBanner />

          <View style={[s.section, s.homePrimaryBlock]}>
            {loading ? (
              <View style={s.driverHomeSearchCard}>
                <ActivityIndicator color={ORANGE} />
              </View>
            ) : displayUpcoming.length > 0 ? (
              <DriverHomeActivityCard
                ride={displayUpcoming[0]}
                hasOfferReceived={
                  displayUpcoming[0]?.type === 'ridePosting'
                    ? !!postingReqByPostingId[displayUpcoming[0].id]
                    : false
                }
              />
            ) : (
              <DriverHomePostRideCard />
            )}
          </View>

          {/* ══════════════════════════════════════════════════════════
              HERO MAP
          ══════════════════════════════════════════════════════════ */}
          {false && <View style={s.mapWrap}>
            {MapView && Marker ? (
            <MapView
              style={StyleSheet.absoluteFillObject}
              provider={PROVIDER_GOOGLE}
              showsUserLocation
              showsMyLocationButton={false}
              showsCompass={false}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              toolbarEnabled={false}
              onMapReady={() => setMapReady(true)}
              initialRegion={{
                latitude: driverLocation?.latitude ?? 32.3513,
                longitude: driverLocation?.longitude ?? -95.3011,
                latitudeDelta: 0.045,
                longitudeDelta: 0.045,
              }}
              region={driverLocation ? {
                latitude: driverLocation.latitude,
                longitude: driverLocation.longitude,
                latitudeDelta: 0.045,
                longitudeDelta: 0.045,
              } : undefined}
            >
              {driverLocation && Circle && (
                <Circle
                  center={driverLocation}
                  radius={1800}
                  strokeColor="rgba(244,98,31,0.22)"
                  fillColor="rgba(244,98,31,0.08)"
                />
              )}

              {liveRequestMarkers.map((request) => (
                <Marker
                  key={request.id}
                  coordinate={{
                    latitude: request.latitude,
                    longitude: request.longitude,
                  }}
                  onPress={() => router.push({ pathname: '/(driver)/request/[id]', params: { id: request.id, returnTo: '/(driver)' } } as any)}
                >
                  <View style={s.liveRequestMarker}>
                    <View style={s.liveRequestMarkerDot} />
                    {request.priceText && (
                      <Text style={s.liveRequestMarkerText}>{request.priceText}</Text>
                    )}
                  </View>
                </Marker>
              ))}
            </MapView>
            ) : (
              <View style={s.webMapFallback}>
                <Ionicons name="map-outline" size={30} color={MUTED} />
                <Text style={[s.mapFallbackText, { color: MUTED }]}>
                  Map preview is available on iOS and Android
                </Text>
              </View>
            )}

            {MapView && !mapReady && (
              <View style={s.mapLoadingOverlay}>
                <ActivityIndicator color={COLORS.orange} />
              </View>
            )}

            <View style={s.liveBadge}>
              <View style={s.liveDot} />
              <Text style={s.liveText}>LIVE CAMPUS</Text>
            </View>

            <View style={s.mapOverlay}>
              <View style={{ flex: 1 }}>
                <Text style={s.mapOverlayHeadline}>
                  {liveRequestMarkers.length} live campus request{liveRequestMarkers.length === 1 ? '' : 's'}
                </Text>
                <Text style={s.mapOverlaySub}>
                  Real pickup activity near your current location.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => router.push('/(driver)/requests')}
                style={s.goBtn}
              >
                <View style={s.goBtnInner}>
                  <Ionicons name="navigate" size={16} color="white" />
                  <Text style={s.goBtnText}>View</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>}
           {/* ══════════════════════════════════════════════════════════
              DRIVER PULSE — floating widgets
          ══════════════════════════════════════════════════════════ */}
          
          {/* ══════════════════════════════════════════════════════════
              FIND NEARBY RIDERS CTA
          ══════════════════════════════════════════════════════════ */}
          {/* ══════════════════════════════════════════════════════════
              PROMOTIONS
          ══════════════════════════════════════════════════════════ */}
          <View style={s.section}>
            {promotionsLoading && promotions.length === 0 ? (
              <View style={s.promotionLoading}><ActivityIndicator color={COLORS.orange} /></View>
            ) : promotions.length > 0 ? (
              <>
                <ScrollView
                  ref={promotionScrollRef}
                  horizontal showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.promotionList}
                  snapToInterval={promotionSnapInterval}
                  snapToAlignment="start"
                  decelerationRate="fast"
                  disableIntervalMomentum
                  onScroll={(e) => {
                    const idx = Math.round(e.nativeEvent.contentOffset.x / promotionSnapInterval);
                    setCurrentPromotionIndex(Math.max(0, Math.min(idx, promotions.length - 1)));
                  }}
                  scrollEventThrottle={16}
                >
                  {promotions.map((item, index) => (
                    <DriverUberStylePromotionCard
                      key={item.id}
                      promotion={item}
                      onPress={() => router.push('/(driver)/profile' as any)}
                      width={promotionCardWidth}
                      secondary={index % 2 === 1}
                    />
                  ))}
                </ScrollView>
                {promotions.length > 1 && (
                  <View style={s.dotsRow}>
                    {promotions.map((_, i) => (
                      <View key={i} style={[s.dot, i === currentPromotionIndex && s.dotActive]} />
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={s.promotionEmptyCard}>
                <Ionicons name="gift-outline" size={24} color={COLORS.orange} />
                <View style={{ flex: 1 }}>
                  <Text style={s.promotionEmptyTitle}>No active promotions</Text>
                  <Text style={s.promotionEmptyText}>Check back soon for new driver offers.</Text>
                </View>
              </View>
            )}
          </View>

          {false && <View style={s.section}>
  <View style={s.sectionHdrRow}>
    <Text style={s.sectionTitle}>Hot Zones</Text>
    <Text style={s.sectionSub}>Live from requests</Text>
  </View>

            {hotZones.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                {hotZones.map((zone) => (
                  <TouchableOpacity
                    key={zone.key}
                    onPress={() => router.push('/(driver)/requests' as any)}
                    style={[s.heatCard, { borderColor: `${zone.heat}40` }]}
                    activeOpacity={0.8}
                  >
                    <View style={[StyleSheet.absoluteFillObject, { backgroundColor: zone.bg }]} />

                    <View style={[s.heatPill, { backgroundColor: `${zone.heat}22` }]}>
                      <View style={[s.heatDot, { backgroundColor: zone.heat }]} />
                      <Text style={[s.heatRiders, { color: zone.heat }]}>
                        {zone.riders} rider{zone.riders === 1 ? '' : 's'}
                      </Text>
                    </View>

                    <Text style={s.heatName} numberOfLines={2}>{zone.name}</Text>
                    <Text style={s.heatDist}>{zone.dist} away</Text>

                    <View style={s.heatEarnRow}>
                      <Ionicons name="wallet-outline" size={11} color={zone.heat} />
                      <Text style={[s.heatEarn, { color: zone.heat }]}>{zone.earn} avg</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={s.emptyHotZones}>
                <Ionicons name="radio-outline" size={18} color={COLORS.orange} />
                <Text style={s.emptyHotZonesText}>
                  Hot zones appear when nearby riders request pickups.
                </Text>
              </View>
            )}
          </View>}


         {/* ══════════════════════════════════════════════════════════
              UPCOMING RIDES
          ══════════════════════════════════════════════════════════ */}
          {false && <View style={s.section}>
            <View style={s.sectionHdrRow}>
              <Text style={s.sectionTitle}>Upcoming Rides</Text>
              <TouchableOpacity onPress={() => router.push('/(driver)/settings/driver-ride-history')}>
                <Text style={s.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>

            {displayUpcoming.length === 0 && (
              <View style={s.emptyBox}>
                <View style={s.emptyIconWrap}>
                  <Ionicons name="car-outline" size={28} color={COLORS.orange} />
                </View>
                <Text style={s.emptyTitle}>No active rides</Text>
                <Text style={s.emptyText}>Find nearby riders to get started</Text>
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
              const confirmedStatusRaw = String((r as any).confirmedStatus || '').toUpperCase();
              const hasConfirmedRide = !!(r as any).confirmedId;
              const normalizedStatus = (confirmedStatusRaw === 'DRIVER_COMPLETED' || confirmedStatusRaw === 'RIDER_COMPLETED') ? 'IN_PROGRESS' : confirmedStatusRaw;
              const confirmedStatusKey = normalizedStatus.replace(/[-\s]/g, '_');
              const rawStatusKey = String(r?.status || '').toLowerCase();
              const isFlagged = (confirmedStatusKey === 'FLAGGED') || rawStatusKey === 'flagged';
              const isConfirmed = hasConfirmedRide && (confirmedStatusKey === 'CONFIRMED' || confirmedStatusKey === 'IN_PROGRESS');
              const isInProgress = hasConfirmedRide && confirmedStatusKey === 'IN_PROGRESS';
              const cardKey = `${r.type}-${r.id}`;
              const isWaiting = !!waitingAfterComplete[cardKey] || (!!(r as any).confirmedDriverComplete && confirmedStatusKey === 'IN_PROGRESS');
              const isOfferSent = (r.type !== 'ridePostingRequest') && ['offer sent','offer_sent','sent'].includes(statusKey);
              const pendingPostingReq = (r.type === 'ridePosting') ? postingReqByPostingId[r.id] : undefined;
              const isOfferReceivedForPosting = !!pendingPostingReq;
              const isPosted = !isConfirmed && !hasPendingOffer && !isAcceptedOffer && !isOfferSent && !isOfferReceivedForPosting && (statusKey === 'posted' || statusKey === 'open');
              const dateText = r.dateTime ? formatDate(r.dateTime) : '';

              // ── Group Ride Card ──
              if ((r as any).type === 'groupRide') {
                const gr: any = r as any;
                const postingId = String(gr.ridePostingId || gr.id);
                const rawAggStatus = String((gr.confirmedStatus || gr.status) || '').replace(/[-\s]/g, '_').toUpperCase();
                const aggStatus = (rawAggStatus === 'DRIVER_COMPLETED' || rawAggStatus === 'RIDER_COMPLETED') ? 'IN_PROGRESS' : rawAggStatus;
                const isGrpInProgress = aggStatus === 'IN_PROGRESS';
                const isGrpFlagged = aggStatus === 'FLAGGED';
                const passengers: Array<any> = Array.isArray(gr.passengers) ? gr.passengers : [];
                const waitingCount = passengers.filter((p) => String(p?.status || '').toUpperCase() !== 'COMPLETED').length;
                const allCompleted = passengers.length > 0 && passengers.every((p) => String(p?.status || '').toUpperCase() === 'COMPLETED');
                const badge = isGrpFlagged
                  ? { bg: 'rgba(239,68,68,0.15)', txt: COLORS.red,   label: 'Flagged' }
                  : isGrpInProgress
                  ? { bg: 'rgba(16,185,129,0.15)', txt: COLORS.green, label: 'In Progress' }
                  : { bg: 'rgba(16,185,129,0.15)', txt: COLORS.green, label: 'Confirmed' };

                return (
                  <View key={`groupRide-${postingId}`} style={s.rideCard}>
                     <View style={s.rideCardInner}>
                      <View style={s.rideCardTop}>
                        <View style={[s.statusBadge, { backgroundColor: badge.bg }]}>
                          <Text style={[s.statusBadgeText, { color: badge.txt }]}>{badge.label}</Text>
                        </View>
                        <Text style={s.rideDateText}>Group · {dateText}</Text>
                      </View>
                      {(gr.from || gr.to) && (
                        <View style={s.routeWrap}>
                          {gr.from && <View style={s.routeRow}><View style={s.dotOrange}/><Text style={s.routeFrom} numberOfLines={1}>{gr.from}</Text></View>}
                          <View style={s.routeConnector}/>
                          {gr.to && <View style={s.routeRow}><View style={s.dotGray}/><Text style={s.routeTo} numberOfLines={1}>{gr.to}</Text></View>}
                        </View>
                      )}
                      <View style={s.rideFooter}>
                        <Text style={s.ridePrice}>{gr.priceText || ''}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Text style={s.rideMeta}>{(gr.seatsFilled ?? 0)}/{gr.seatCount ?? 2} seats</Text>
                          <TouchableOpacity onPress={() => { setSelectedRide({ ...(r as any), passengers }); setModalVisible(true); }} style={s.detailsBtn}>
                            <Text style={s.detailsBtnText}>Details</Text>
                            <Ionicons name="chevron-forward" size={14} color={COLORS.orange} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={s.actionRow}>
                        {!isGrpFlagged && (
                          <TouchableOpacity onPress={() => {
                            if (passengers.length > 0 && passengers[0]?.confirmedId) {
                              setFlaggingRideRef({ confirmedId: passengers[0].confirmedId, type: 'groupRide', id: postingId, ridePostingId: postingId });
                              setFlagModalVisible(true);
                            }
                          }} style={s.iconBtn}>
                            <Ionicons name="flag" size={16} color={COLORS.red} />
                          </TouchableOpacity>
                        )}
                        {aggStatus === 'CONFIRMED' && !waitingGroupAfterComplete[postingId] && (
                          <Button size="sm" variant="primary" onPress={async () => { try { await groupPickup(postingId); } catch {} }}>Pick Up</Button>
                        )}
                        {aggStatus === 'IN_PROGRESS' && !waitingGroupAfterComplete[postingId] && (
                          <Button size="sm" variant="primary" onPress={async () => { try { await groupComplete(postingId); setWaitingGroupAfterComplete((m) => ({ ...m, [postingId]: true })); } catch {} }}>Complete Ride</Button>
                        )}
                        {allCompleted && (
                          <Button size="sm" variant="primary" onPress={async () => {
                            try {
                              const base = getApiBaseUrl(); const token = await firebaseAuth.currentUser?.getIdToken();
                              const resp = await fetch(`${base}/driver/posting/${encodeURIComponent(postingId)}/capture-completed`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ userId: firebaseAuth.currentUser?.uid }) });
                              if (!resp.ok) { let msg = 'Payment capture failed'; try { const j = await resp.json(); msg = j?.error || j?.message || msg; } catch {} Alert.alert('Capture Failed', msg); }
                              else Alert.alert('Payments Captured', 'Passenger payments have been captured.');
                            } catch { Alert.alert('Error', 'Could not capture payments.'); }
                          }}>Capture Payments</Button>
                        )}
                      </View>
                      {(waitingGroupAfterComplete[postingId] || (aggStatus === 'IN_PROGRESS' && waitingCount > 0)) && (
                        <Text style={s.waitingText}>Waiting for {waitingCount} rider(s) to confirm…</Text>
                      )}
                    </View>
                  </View>
                );
              }

              // ── Standard Ride Card ──
              const bp = badgeProps(
                isIncomingPendingOffer || isOfferReceivedForPosting,
                isOwnPendingOffer || isOfferSent,
                isPosted,
                isConfirmed && !isInProgress,
                isInProgress,
                isFlagged,
              );
              const badgeLabel = (isIncomingPendingOffer || isOfferReceivedForPosting) ? 'Offer Received'
                : (isOwnPendingOffer || isOfferSent) ? 'Offer Sent'
                : isFlagged ? 'Flagged'
                : isInProgress ? 'In Progress'
                : isConfirmed ? 'Confirmed'
                : isPosted ? 'Posted'
                : prettyStatus(r.status);

              return (
                <View key={`${r.type}-${r.id}`} style={s.rideCard}>
                  <View style={s.rideCardInner}>
                    <View style={s.rideCardTop}>
                      <View style={[s.statusBadge, { backgroundColor: bp.bg }]}>
                        <Text style={[s.statusBadgeText, { color: bp.txt }]}>{badgeLabel}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {r.type === 'ridePosting' && ((r as any).seatCount ?? 1) > 1 && (
                          <Text style={s.rideMeta}>{(confirmedCountByPostingId[r.id] || 0)}/{(r as any).seatCount} pax</Text>
                        )}
                        <Text style={s.rideDateText}>{dateText}</Text>
                      </View>
                    </View>

                    {(r.from || r.to) && (
                      <View style={s.routeWrap}>
                        {r.from && <View style={s.routeRow}><View style={s.dotOrange}/><Text style={s.routeFrom} numberOfLines={1}>{r.from}</Text></View>}
                        <View style={s.routeConnector}/>
                        {r.to && <View style={s.routeRow}><View style={s.dotGray}/><Text style={s.routeTo} numberOfLines={1}>{r.to}</Text></View>}
                      </View>
                    )}

                    <View style={s.rideFooter}>
                      <Text style={s.ridePrice}>{offer?.priceText ?? r.priceText ?? ''}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {(offer?.durationText ?? r.durationText) && (
                          <Text style={s.rideMeta}>{offer?.durationText ?? r.durationText}</Text>
                        )}
                        {r.type === 'ridePosting' && (
                          <TouchableOpacity onPress={() => {
                            const p = new URLSearchParams();
                            const n = (userName || '').split(' ')[0]; if (n) p.set('name', n);
                            if (r.from) p.set('from', r.from); if (r.to) p.set('to', r.to);
                            const url = `https://ridealongapp.com/ride/${r.id}${p.toString() ? '?' + p.toString() : ''}`;
                            Share.share({ message: `I'm offering a ride on RideAlong!\n${url}`, url }).catch(() => {});
                          }}>
                            <Ionicons name="share-outline" size={16} color={COLORS.orange} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={s.detailsBtn} onPress={() => openRideDetails(r)}>
                          <Text style={s.detailsBtnText}>Details</Text>
                          <Ionicons name="chevron-forward" size={14} color={COLORS.orange} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {hasConfirmedRide && confirmedStatusKey === 'CONFIRMED' && !isIncomingPendingOffer && !isOfferReceivedForPosting && !isOwnPendingOffer && !waitingAfterPickup[cardKey] && !waitingAfterComplete[cardKey] && (
                      <View style={s.actionRow}>
                        <TouchableOpacity onPress={() => { setFlaggingRideRef(r); setFlagModalVisible(true); }} style={s.iconBtn}><Ionicons name="flag-outline" size={16} color={COLORS.red}/></TouchableOpacity>
                        <TouchableOpacity onPress={() => openChatForRide(r)} style={s.iconBtn}><Ionicons name="chatbubble-outline" size={16} color={COLORS.orange}/></TouchableOpacity>
                        <Button size="sm" variant="primary"
                          loading={!!rideActionLoading[`pickup-${r.type}-${r.id}`]}
                          disabled={!!rideActionLoading[`pickup-${r.type}-${r.id}`]}
                          onPress={async () => {
                            const key = `pickup-${r.type}-${r.id}`;
                            setRideActionLoading((m) => ({ ...m, [key]: true }));
                            try {
                              const ok = await actionConfirmPickup({ confirmedId: r.confirmedId, rideRequestId: r.type === 'rideRequest' ? r.id : undefined, ridePostingId: r.type === 'ridePosting' ? r.id : undefined, riderId: r.riderId });
                              if (ok) setWaitingAfterPickup((prev) => ({ ...prev, [cardKey]: true }));
                            } finally { setRideActionLoading((m) => ({ ...m, [key]: false })); }
                          }}>Pick Up</Button>
                      </View>
                    )}

                    {waitingAfterPickup[cardKey] && confirmedStatusKey === 'CONFIRMED' && (
                      <Text style={s.waitingText}>Waiting for rider to confirm pickup…</Text>
                    )}

                    {hasConfirmedRide && isInProgress && !isIncomingPendingOffer && !isOfferReceivedForPosting && !isOwnPendingOffer && !isWaiting && (
                      <View style={s.actionRow}>
                        <TouchableOpacity onPress={() => { setFlaggingRideRef(r); setFlagModalVisible(true); }} style={s.iconBtn}><Ionicons name="flag-outline" size={16} color={COLORS.red}/></TouchableOpacity>
                        <TouchableOpacity onPress={() => openChatForRide(r)} style={s.iconBtn}><Ionicons name="chatbubble-outline" size={16} color={COLORS.orange}/></TouchableOpacity>
                        <Button size="sm" variant="primary"
                          loading={!!rideActionLoading[`complete-${r.type}-${r.id}`]}
                          disabled={!!rideActionLoading[`complete-${r.type}-${r.id}`]}
                          onPress={async () => {
                            const key = `complete-${r.type}-${r.id}`;
                            setRideActionLoading((m) => ({ ...m, [key]: true }));
                            try {
                              const ok = await actionCompleteRide({ confirmedId: r.confirmedId, rideRequestId: r.type === 'rideRequest' ? r.id : undefined, ridePostingId: r.type === 'ridePosting' ? r.id : undefined, riderId: r.riderId });
                              if (ok) setWaitingAfterComplete((prev) => ({ ...prev, [cardKey]: true }));
                            } finally { setRideActionLoading((m) => ({ ...m, [key]: false })); }
                          }}>Complete Ride</Button>
                      </View>
                    )}

                    {hasConfirmedRide && isWaiting && (
                      <Text style={s.waitingText}>Waiting for rider to confirm completion…</Text>
                    )}

                    {(isIncomingPendingOffer || isOfferReceivedForPosting) && (
                      <View style={[s.actionRow, { justifyContent: 'flex-end' }]}>
                        <Button size="sm" variant="outline"
                          onPress={() => r.type === 'ridePostingRequest' ? rejectPostingRequest(r.id) : (isOfferReceivedForPosting ? rejectPostingRequest(postingReqByPostingId[r.id].id) : rejectOffer(r.id))}>
                          Reject
                        </Button>
                        <Button size="sm" variant="primary"
                          onPress={() => r.type === 'ridePostingRequest' ? acceptPostingRequest(r.id) : (isOfferReceivedForPosting ? acceptPostingRequest(postingReqByPostingId[r.id].id) : acceptOffer(r.id))}>
                          Accept
                        </Button>
                      </View>
                    )}

                    {(isOwnPendingOffer || isOfferSent) && !isConfirmed && (
                      <View style={[s.actionRow, { justifyContent: 'flex-end' }]}>
                        <Button size="sm" variant="outline" onPress={() => cancelOffer(r.id)}>Cancel Offer</Button>
                      </View>
                    )}

                    {isPosted && r.type === 'ridePosting' && (
                      <View style={[s.actionRow, { justifyContent: 'flex-end' }]}>
                        <Button size="sm" variant="outline" onPress={() => {
                          Alert.alert('Cancel Posting', 'Are you sure you want to cancel this ride posting?', [
                            { text: 'No', style: 'cancel' },
                            { text: 'Yes', style: 'destructive', onPress: async () => {
                              try { await updateDoc(doc(firestore, 'ridePostings', r.id), { status: 'cancelled', cancelledAt: serverTimestamp() }); Alert.alert('Success', 'Ride posting cancelled'); }
                              catch { Alert.alert('Error', 'Failed to cancel posting'); }
                            }},
                          ]);
                        }}>Cancel Posting</Button>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>}

          {/* ══════════════════════════════════════════════════════════
              THIS MONTH SUMMARY
          ══════════════════════════════════════════════════════════ */}
          <View style={[s.section, { marginBottom: 8 }]}>
            <View style={s.sectionHdrRow}>
              <Text style={s.sectionTitle}>This month</Text>
              <TouchableOpacity onPress={() => router.push('/(driver)/earnings' as any)}>
                <Text style={s.viewAll}>View earnings</Text>
              </TouchableOpacity>
            </View>
            <View style={s.monthCard}>
              <View style={s.monthStatRow}>
                <View style={s.monthStat}>
                  <View style={s.monthStatIconWrap}>
                    <Ionicons name="car-outline" size={18} color={ORANGE} />
                  </View>
                  <Text style={s.monthStatValue}>
                    {monthlyStats.loaded ? String(monthlyStats.rides) : '—'}
                  </Text>
                  <Text style={s.monthStatLabel}>Rides</Text>
                </View>
                <View style={s.monthDivider} />
                <View style={s.monthStat}>
                  <View style={s.monthStatIconWrap}>
                    <Ionicons name="cash-outline" size={18} color={ORANGE} />
                  </View>
                  <Text style={s.monthStatValue}>
                    {monthlyStats.loaded ? `$${Math.round(monthlyStats.earnings)}` : '—'}
                  </Text>
                  <Text style={s.monthStatLabel}>Earned</Text>
                </View>
                <View style={s.monthDivider} />
                <View style={s.monthStat}>
                  <View style={s.monthStatIconWrap}>
                    <Ionicons name="star-outline" size={18} color={ORANGE} />
                  </View>
                  <Text style={s.monthStatValue}>
                    {monthlyStats.loaded ? (monthlyStats.rating != null ? monthlyStats.rating.toFixed(1) : '—') : '—'}
                  </Text>
                  <Text style={s.monthStatLabel}>Rating</Text>
                </View>
              </View>
              {monthlyStats.loaded && monthlyStats.rides === 0 && (
                <View style={s.monthEmptyRow}>
                  <Text style={s.monthEmptyText}>No completed rides yet this month — get out there.</Text>
                </View>
              )}
            </View>
          </View>

          {/* ══════════════════════════════════════════════════════════
              RECENT RIDES
          ══════════════════════════════════════════════════════════ */}
          {false && <View style={s.section}>
            <View style={s.sectionHdrRow}>
              <Text style={s.sectionTitle}>Recent Rides</Text>
              <TouchableOpacity onPress={() => router.push('/(driver)/settings/driver-ride-history')}>
                <Text style={s.viewAll}>View All</Text>
              </TouchableOpacity>
            </View>
            {recentConfirmed.length === 0
              ? <View style={s.emptyBox}>
                  <Text style={s.emptyText}>No recent rides yet.</Text>
                </View>
              : recentConfirmed.slice(0, 3).map((cr) => {
                  const key = logicalRideKey(cr);
                  const price = getPriceText(cr);
                  const date = getDateFromConfirmed(cr);
                  const seatCount = (cr as any)?._seatCount;
                  return (
                    <View key={key} style={s.rideCard}>
                      <View style={s.rideCardInner}>
                        <View style={s.rideCardTop}>
                          <View style={[s.statusBadge, { backgroundColor: 'rgba(150,170,190,0.15)' }]}>
                            <Text style={[s.statusBadgeText, { color: '#7A8FA8' }]}>Completed</Text>
                          </View>
                          <Text style={s.rideDateText}>{date ? formatDate(date) : ''}</Text>
                        </View>
                        <View style={s.routeWrap}>
                          {getAddress(cr, 'pickup') && <View style={s.routeRow}><View style={s.dotOrange}/><Text style={s.routeFrom} numberOfLines={1}>{getAddress(cr, 'pickup')}</Text></View>}
                          <View style={s.routeConnector}/>
                          {getAddress(cr, 'dropoff') && <View style={s.routeRow}><View style={s.dotGray}/><Text style={s.routeTo} numberOfLines={1}>{getAddress(cr, 'dropoff')}</Text></View>}
                        </View>
                        <View style={s.rideFooter}>
                          <Text style={s.ridePrice}>{price}{seatCount > 1 ? ` · ${seatCount} seats` : ''}</Text>
                          <TouchableOpacity style={s.detailsBtn} onPress={() => router.push('/(driver)/settings/driver-ride-history')}>
                            <Text style={s.detailsBtnText}>History</Text>
                            <Ionicons name="chevron-forward" size={14} color={COLORS.orange} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })
            }
          </View>}

          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>

      {/* ══════════════════════════════════════════════════════════
          RIDE DETAILS MODAL
      ══════════════════════════════════════════════════════════ */}
      {modalVisible && (
        <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={closeModal}>
          <View style={s.modalOverlay}>
            <View style={s.modalSheet}>
              <View style={s.modalHandle} />
              <View style={s.modalHdr}>
                <Text style={s.modalTitle}>Ride Details</Text>
                <TouchableOpacity onPress={closeModal} style={s.modalCloseBtn}>
                  <Ionicons name="close" size={20} color={NAVY} />
                </TouchableOpacity>
              </View>
              {selectedRide && (
                <ScrollView style={{ paddingHorizontal: 24 }} showsVerticalScrollIndicator={false}>
                  {(() => {
                    const modalOffer = offersByRideId[selectedRide.id];
                    (selectedRide as any).__modalDurationText = modalOffer?.durationText ?? selectedRide.durationText;
                    (selectedRide as any).__modalDistanceText = modalOffer?.distanceText ?? selectedRide.distanceText;
                    return null;
                  })()}

                  {(() => {
                    const isPosting = selectedRide?.type === 'ridePosting';
                    const skStatus = String(selectedRide?.status || '').toLowerCase();
                    const hasPReq = isPosting && postingReqByPostingId[selectedRide!.id];
                    const isPostingConf = isPosting && confirmedByPostingId[selectedRide!.id];
                    if (isPosting && !isPostingConf && !hasPReq && (skStatus === 'posted' || skStatus === 'open')) {
                      return (
                        <View style={s.modalSection}>
                          <Text style={s.modalSectionTitle}>Status</Text>
                          <Text style={{ color: '#7A8FA8' }}>Waiting for rider requests</Text>
                        </View>
                      );
                    }
                    const passengerList: any[] = modalPassengers.length > 0 ? modalPassengers : (Array.isArray((selectedRide as any)?.passengers) ? (selectedRide as any).passengers : []);
                    if (passengerList.length > 0) {
                      return (
                        <View style={s.modalSection}>
                          <Text style={s.modalSectionTitle}>Passengers ({passengerList.length})</Text>
                          {passengerList.map((p, idx) => (
                            <View key={String(p?.riderId || idx)} style={s.passengerRow}>
                              {p?.avatarUrl
                                ? <Image source={{ uri: p.avatarUrl }} style={s.passengerAvatar} />
                                : <View style={[s.passengerAvatar, { backgroundColor: COLORS.orangeGlow, alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="person" size={20} color={COLORS.orange}/></View>
                              }
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={s.passengerName}>{p?.name || 'Passenger'}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                  <Ionicons name="star" size={12} color={COLORS.amber} />
                                  <Text style={s.passengerRating}>{typeof p?.rating === 'number' ? p.rating.toFixed(1) : '—'}</Text>
                                </View>
                              </View>
                              <TouchableOpacity
                                style={[s.callBtn, { backgroundColor: p?.phone ? COLORS.orange : '#F3EFE8' }]}
                                disabled={!p?.phone}
                                onPress={() => p?.phone && Linking.openURL(`tel:${String(p.phone).replace(/[^0-9+]/g, '')}`).catch(() => {})}
                              >
                                <Ionicons name="call" size={18} color={p?.phone ? 'white' : '#7A8FA8'} />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      );
                    }
                    if (modalRider?.name || modalRider?.avatarUrl || typeof modalRider?.rating === 'number') {
                      const riderId = (selectedRide as any)?.riderId;
                      const phone = modalRider?.phone;
                      return (
                        <View style={s.modalSection}>
                          <Text style={s.modalSectionTitle}>Rider</Text>
                          <View style={s.passengerRow}>
                            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                              onPress={() => riderId && router.push({ pathname: '/(driver)/rider/[id]', params: { id: String(riderId), returnTo: '/(driver)' } } as any)}>
                              {modalRider?.avatarUrl
                                ? <Image source={{ uri: modalRider.avatarUrl }} style={s.passengerAvatar} />
                                : <View style={[s.passengerAvatar, { backgroundColor: COLORS.orangeGlow, alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="person" size={20} color={COLORS.orange}/></View>
                              }
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={s.passengerName}>{modalRider?.name ?? 'Loading…'}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                  <Ionicons name="star" size={12} color={COLORS.amber} />
                                  <Text style={s.passengerRating}>{typeof modalRider?.rating === 'number' ? modalRider.rating.toFixed(1) : '—'}</Text>
                                </View>
                              </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[s.callBtn, { backgroundColor: phone ? COLORS.orange : '#F3EFE8' }]}
                              disabled={!phone}
                              onPress={() => phone && Linking.openURL(`tel:${String(phone).replace(/[^0-9+]/g, '')}`).catch(() => {})}
                            >
                              <Ionicons name="call" size={18} color={phone ? 'white' : '#7A8FA8'} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    }
                    return null;
                  })()}

                  {(selectedRide.from || selectedRide.to) && (
                    <View style={s.modalSection}>
                      <Text style={s.modalSectionTitle}>Route</Text>
                      <View style={s.routeCard}>
                        {selectedRide.from && <View style={s.routeRow}><View style={s.dotOrange}/><AddressLink address={selectedRide.from} textStyle={{ ...s.routeFrom }} /></View>}
                        <View style={s.routeConnector}/>
                        {selectedRide.to && <View style={s.routeRow}><View style={s.dotGray}/><AddressLink address={selectedRide.to} textStyle={{ ...s.routeTo }} /></View>}
                      </View>
                    </View>
                  )}

                  <View style={s.modalSection}>
                    <Text style={s.modalSectionTitle}>Trip Info</Text>
                    <View style={s.infoGrid}>
                      {[
                        { label: 'Price',    value: selectedRide.priceText ?? '—',   color: COLORS.green },
                        { label: 'Date',     value: selectedRide.dateTime ? selectedRide.dateTime.toLocaleDateString() : '—', color: NAVY },
                        { label: 'Time',     value: selectedRide.dateTime ? formatTime(selectedRide.dateTime) : '—', color: NAVY },
                        { label: 'Distance', value: (selectedRide as any).__modalDistanceText ?? selectedRide.distanceText ?? '—', color: NAVY },
                      ].map(({ label, value, color }) => (
                        <View key={label} style={s.infoCell}>
                          <Text style={s.infoCellLabel}>{label}</Text>
                          <Text style={[s.infoCellValue, { color }]}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Flag Modal */}
      <FlagRideModal
        visible={flagModalVisible}
        onClose={() => { setFlagModalVisible(false); setFlaggingRideRef(null); }}
        rideId={flaggingRideRef?.confirmedId ?? null}
        onFlagged={() => {
          if (flaggingRideRef) {
            setUpcConfirmed((prev) => {
              const next = { ...prev } as any;
              const key = `${flaggingRideRef.type}-${flaggingRideRef.id}`;
              if (next[key]) next[key] = { ...next[key], status: 'flagged', confirmedStatus: 'flagged' };
              return next;
            });
            setUpcoming((prev) => prev.map((it) =>
              it.type === flaggingRideRef.type && it.id === flaggingRideRef.id
                ? { ...it, status: 'flagged' } : it
            ));
          }
          setFlagModalVisible(false);
          setFlaggingRideRef(null);
        }}
      />

      {/* Promotion Details Modal */}
      <PromotionDetailsModal
        promotion={selectedPromotion}
        visible={promotionModalVisible}
        onClose={() => { setPromotionModalVisible(false); setSelectedPromotion(null); }}
        onClaim={(promotionId: string) => {
          Alert.alert('Promotion Claimed!', 'Your promotion has been activated.');
          setPromotionModalVisible(false);
          setSelectedPromotion(null);
        }}
        isClaimed={false}
      />

      <DriverBottomNav activeTab="home" />
    </View>
  );
}

function formatDate(d: Date) {
  try {
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = formatTime(d);
    return `${dateStr}, ${timeStr}`;
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
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
    if (v instanceof Date) return v;
    if (v instanceof Timestamp) return v.toDate();
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      const d = new Date(v);
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

async function ensureAcceptedPostingRequestConfirmation(requestId: string, request: any, driverId: string) {
  const postingId = request.ridePostingId || request.ridePostId || request.postingId || request.posting?.id;
  if (!postingId || !driverId) return;

  const confirmedId = String(request.confirmedRideId || `${postingId}_${requestId}`);
  if (confirmationRepairs.has(confirmedId)) return;
  confirmationRepairs.add(confirmedId);

  try {
    const confirmedRef = doc(firestore, 'confirmedRides', confirmedId);
    const existing = await getDoc(confirmedRef);
    const existingStatus = existing.exists() ? String(existing.data().status || '').toUpperCase() : '';
    if (existing.exists() && existingStatus && existingStatus !== 'PENDING') return;

    const [postingSnap, driverSnap] = await Promise.all([
      getDoc(doc(firestore, 'ridePostings', String(postingId))),
      getDoc(doc(firestore, 'drivers', driverId)),
    ]);
    const posting = postingSnap.exists() ? postingSnap.data() as any : {};
    const driver = driverSnap.exists() ? driverSnap.data() as any : {};
    const riderId = request.riderId || request.userId || request.requesterId || request.ownerId;
    if (!riderId) throw new Error('Accepted request is missing riderId');

    const totalSeats = Number(posting.seatsAvailable ?? posting.totalSeats ?? posting.seats ?? 1) || 1;
    const seatsTaken = Number(posting.seatsTaken ?? request.passengers ?? 1) || 1;
    const payload = deepClean({
      ridePostingRequestId: requestId,
      ridePostingId: String(postingId),
      riderId: String(riderId),
      riderName: request.riderName || request.userName || request.requesterName || 'Rider',
      riderEmail: request.riderEmail || request.userEmail || request.requesterEmail || null,
      riderPhone: request.riderPhone || request.userPhone || request.phone || null,
      driverId,
      driverName: [driver.firstName, driver.lastName].filter(Boolean).join(' ').trim()
        || driver.personalInfo?.fullName || driver.displayName || driver.name || request.driverName || 'Driver',
      driverEmail: driver.personalInfo?.email || driver.email || request.driverEmail || null,
      driverPhone: driver.personalInfo?.phone || driver.phone || null,
      vehicleInfo: driver.vehicleInfo || posting.vehicleInfo || request.vehicleInfo || null,
      pickup: posting.pickup || posting.pickupAddress || request.pickup || request.pickupAddress || null,
      dropoff: posting.dropoff || posting.dropoffAddress || request.dropoff || request.dropoffAddress || null,
      date: posting.date || request.date || null,
      time: posting.time || request.time || null,
      passengers: Number(request.passengers ?? request.seats ?? 1) || 1,
      contributionAmount: request.contributionAmount ?? request.price ?? posting.pricePerSeat ?? null,
      paymentIntentId: request.paymentIntentId || null,
      paymentStatus: request.paymentStatus || 'authorized',
      totalSeats,
      seatsTaken,
      seatsRemaining: Math.max(0, Number(posting.availableSeats ?? (totalSeats - seatsTaken)) || 0),
      status: 'CONFIRMED',
      source: 'mobile:repair-accepted-posting-request',
      originalRidePosting: posting,
      originalRidePostingRequest: { id: requestId, ...request },
      confirmedAt: request.acceptedAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    });

    await setDoc(confirmedRef, payload, { merge: true });
    await updateDoc(doc(firestore, 'ridePostingRequests', requestId), {
      status: 'accepted',
      confirmedRideId: confirmedId,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    confirmationRepairs.delete(confirmedId);
    throw error;
  }
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



const s = StyleSheet.create({

  // ── Header ────────────────────────────────────────────────────────────────
  hdr:              { flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingTop:8, paddingBottom:14 },
  avatarWrap:       { width:48, height:48, alignItems:'center', justifyContent:'center' },
  avatarGlowRing:   { position:'absolute', width:58, height:58, borderRadius:29, borderWidth:2, borderColor:COLORS.orange },
  avatarImg:        { width:46, height:46, borderRadius:23, alignItems:'center', justifyContent:'center' },
  avatarInitial:    { fontSize:20, fontWeight:'800', color:'white' },
  verifiedDot:      { position:'absolute', bottom:0, right:0, width:14, height:14, borderRadius:7, backgroundColor:COLORS.green, borderWidth:2, borderColor:BG, alignItems:'center', justifyContent:'center' },
  hdrSub:           { fontSize:13, color:MUTED, fontWeight:'500' },
  hdrName:          { fontSize:24, fontWeight:'800', color:NAVY, letterSpacing:-0.5, lineHeight:28 },
  hdrAccent:        { fontSize:24, fontWeight:'800', color:COLORS.orange, letterSpacing:-0.5 },
  streakBadge:      { backgroundColor:COLORS.orangeGlow, borderRadius:20, paddingHorizontal:10, paddingVertical:4, borderWidth:1, borderColor:COLORS.orangeBorder },
  streakText:       { color:COLORS.orange, fontSize:11, fontWeight:'700' },
  notifBtn:         { width:40, height:40, borderRadius:20, backgroundColor:'rgba(21,35,58,0.06)', alignItems:'center', justifyContent:'center' },
  notifBadge:       { position:'absolute', top:-2, right:-2, backgroundColor:COLORS.red, minWidth:16, height:16, borderRadius:8, alignItems:'center', justifyContent:'center', paddingHorizontal:3 },
  notifBadgeText:   { color:'white', fontSize:10, fontWeight:'700' },

  // ── Hero Map ──────────────────────────────────────────────────────────────
  mapWrap:          { marginHorizontal:16, marginBottom:20, height:250, borderRadius:28, overflow:'hidden', borderWidth:1, borderColor:BORDER },
  mapBase:          { ...StyleSheet.absoluteFillObject as any },
  gridH:            { position:'absolute', left:0, right:0, height:1, backgroundColor:'rgba(59,130,246,0.07)' },
  gridV:            { position:'absolute', top:0, bottom:0, width:1, backgroundColor:'rgba(59,130,246,0.07)' },
  road:             { position:'absolute', height:3, backgroundColor:'rgba(30,60,120,0.5)' },
  roadV:            { position:'absolute', width:3, backgroundColor:'rgba(30,60,120,0.5)' },
  dotWrap:          { position:'absolute', width:20, height:20, alignItems:'center', justifyContent:'center' },
  dotPulseRing:     { position:'absolute', width:20, height:20, borderRadius:10, backgroundColor:COLORS.orange },
  dotCore:          { width:10, height:10, borderRadius:5, backgroundColor:COLORS.orange, shadowColor:COLORS.orange, shadowOpacity:1, shadowRadius:8, shadowOffset:{width:0,height:0} },
  myLocWrap:        { position:'absolute', width:24, height:24, alignItems:'center', justifyContent:'center' },
  myLocRing:        { position:'absolute', width:28, height:28, borderRadius:14, borderWidth:2, borderColor:'#3B82F6' },
  myLocCore:        { width:14, height:14, borderRadius:7, backgroundColor:'#3B82F6', borderWidth:3, borderColor:'white', shadowColor:'#3B82F6', shadowOpacity:1, shadowRadius:10, shadowOffset:{width:0,height:0} },
  routeLine2:       { position:'absolute', height:2.5, backgroundColor:'rgba(244,98,31,0.5)', borderRadius:2 },
  liveBadge:        { position:'absolute', top:14, left:14, flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'rgba(16,185,129,0.18)', paddingHorizontal:10, paddingVertical:5, borderRadius:20, borderWidth:1, borderColor:'rgba(16,185,129,0.3)' },
  liveDot:          { width:7, height:7, borderRadius:3.5, backgroundColor:COLORS.green },
  liveText:         { color:COLORS.green, fontSize:10, fontWeight:'800', letterSpacing:1.5 },
  heroCopy:         { paddingHorizontal:20, marginBottom:18 },
  heroTitle:        { color:NAVY, fontSize:30, lineHeight:36, fontWeight:'600' },
  heroAccent:       { color:COLORS.orange, fontStyle:'italic', fontWeight:'600' },
  heroSub:          { color:MUTED, fontSize:15, lineHeight:21, marginTop:5 },
  mapOverlay:       { position:'absolute', bottom:0, left:0, right:0, flexDirection:'row', alignItems:'center', padding:16, borderTopWidth:1, borderTopColor:BORDER, backgroundColor:'rgba(255,255,255,0.96)' },
  mapOverlayHeadline: { color:NAVY, fontSize:16, fontWeight:'800', letterSpacing:-0.3 },
  mapOverlaySub:    { color:MUTED, fontSize:12, marginTop:2 },
  goBtn:            { marginLeft:12 },
  goBtnInner:       { flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:18, paddingVertical:10, borderRadius:20, backgroundColor:COLORS.orange },
  goBtnText:        { color:'white', fontSize:15, fontWeight:'800' },

  // ── Sections ──────────────────────────────────────────────────────────────
  section:          { paddingHorizontal:16, marginBottom:24 },
  homePrimaryBlock: { marginBottom: 34, zIndex: 20, elevation: 20 },
  sectionHdrRow:    { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:14 },
  sectionTitle:     { fontSize:18, fontWeight:'800', color:NAVY, letterSpacing:-0.3 },
  sectionSub:       { fontSize:12, color:MUTED, fontWeight:'500' },
  viewAll:          { fontSize:13, color:COLORS.orange, fontWeight:'600' },
  livePillSmall:    { flexDirection:'row', alignItems:'center', gap:5, backgroundColor:'#F9E8DB', paddingHorizontal:9, paddingVertical:4, borderRadius:12 },
  livePillText:     { color:ORANGE, fontSize:11, fontWeight:'700' },

  driverHomeSearchCard: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: BORDER, padding: 14, shadowColor: NAVY, shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 20, zIndex: 20 },
  driverHomeRouteRow: { flexDirection: 'row' },
  driverHomeRouteRail: { width: 28, alignItems: 'center', paddingTop: 16, paddingBottom: 16 },
  driverHomeNavyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NAVY },
  driverHomeOrangeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  driverHomeDashedLine: { flex: 1, width: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 7 },
  driverHomeRouteInputs: { flex: 1, gap: 9 },
  driverHomeAutocompleteWrap: { position: 'relative' },
  driverHomeInputPill: { height: 48, borderRadius: 13, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', paddingHorizontal: 14, justifyContent: 'center' },
  driverHomeInputText: { color: NAVY, fontSize: 15, fontWeight: '500' },
  driverHomeAutocompletePanel: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E0D8',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: NAVY,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  driverHomeAutocompleteItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1EEE8' },
  driverHomeAutocompleteState: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  driverHomeAutocompleteIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FEF0E8', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  driverHomeAutocompleteCopy: { flex: 1, minWidth: 0 },
  driverHomeAutocompleteText: { color: NAVY, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  driverHomeAutocompleteSubText: { flex: 1, color: MUTED, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  driverHomeMetaRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  driverHomeMetaPill: { flex: 1, height: 44, borderRadius: 13, borderWidth: 1, borderColor: '#D7DCE3', justifyContent: 'center', paddingHorizontal: 13 },
  driverHomeMetaText: { color: NAVY, fontSize: 13, fontWeight: '500' },
  driverHomePlaceholderText: { color: MUTED },
  driverHomePrimaryBtn: { height: 48, borderRadius: 24, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  driverHomePrimaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  driverActivityCard: { borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18, minHeight: 150, shadowColor: NAVY, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 14, elevation: 2 },
  driverActivityRoute: { color: NAVY, fontSize: 18, lineHeight: 24, fontWeight: '800', marginBottom: 16 },
  activityBadge: { alignSelf: 'flex-start', backgroundColor: COLORS.orangeGlow, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: COLORS.orangeBorder },
  activityBadgeText: { color: COLORS.orange, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },

  
  driverSnapshotRow: {
      flexDirection: 'row',
      gap: 10,
      paddingHorizontal: 18,
      marginTop: 14,
      marginBottom: 10,
    },

    driverSnapshotValue: {
      fontSize: 26,
      fontWeight: '400',
      letterSpacing: -0.4,
    },

  // ── CTA ───────────────────────────────────────────────────────────────────
  ctaBtn:           { borderRadius:22, paddingVertical:18, paddingHorizontal:20, flexDirection:'row', alignItems:'center', shadowColor:COLORS.orange, shadowOffset:{width:0,height:8}, shadowOpacity:0.4, shadowRadius:20, elevation:12 },
  ctaIconWrap:      { width:44, height:44, borderRadius:13, backgroundColor:'rgba(255,255,255,0.2)', alignItems:'center', justifyContent:'center' },
  ctaTitle:         { fontSize:17, fontWeight:'800', color:'white', letterSpacing:-0.3 },
  ctaSub:           { fontSize:12, color:'rgba(255,255,255,0.8)', marginTop:2 },
  ctaChevron:       { width:36, height:36, borderRadius:18, backgroundColor:'rgba(255,255,255,0.22)', alignItems:'center', justifyContent:'center' },

  // ── Dots ──────────────────────────────────────────────────────────────────
  dotsRow:          { flexDirection:'row', justifyContent:'center', marginTop:12, gap:6 },
  dot:              { width:6, height:6, borderRadius:3, backgroundColor:'#D6D0C7' },
  dotActive:        { backgroundColor:SECONDARY, width:20, borderRadius:3 },

  // ── Hot Zones ─────────────────────────────────────────────────────────────
  promotionList: { paddingBottom: 12, paddingRight: 8 },
  promotionLoading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  promotionEmptyCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18 },
  promotionEmptyTitle: { color: NAVY, fontSize: 15, fontWeight: '700' },
  promotionEmptyText: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 3 },
  uberPromoCard: { height: 174, marginRight: 12, flexDirection: 'row', overflow: 'hidden', borderRadius: 20, borderWidth: 1, borderColor: '#E3DED6', backgroundColor: '#FFFFFF', shadowColor: NAVY, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 2 },
  uberPromoCopy: { width: '62%', paddingHorizontal: 18, paddingVertical: 17, justifyContent: 'space-between' },
  uberPromoTitle: { color: NAVY, fontSize: 21, lineHeight: 25, fontWeight: '800', letterSpacing: -0.35 },
  uberPromoDescription: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 6 },
  uberPromoCta: { alignSelf: 'flex-start', minHeight: 34, borderRadius: 17, backgroundColor: '#F3EFE8', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  uberPromoCtaText: { color: NAVY, fontSize: 13, fontWeight: '700' },
  uberPromoVisual: { flex: 1, backgroundColor: '#F6D8C6', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  uberPromoVisualSecondary: { backgroundColor: '#DDE5F2' },
  promoBubble: { position: 'absolute', borderRadius: 999, backgroundColor: '#F2B994' },
  promoBubbleSecondary: { backgroundColor: '#B8C6DE' },
  promoBubbleTop: { width: 108, height: 108, top: -45, right: -32 },
  promoBubbleBottom: { width: 92, height: 92, bottom: -32, left: -26 },
  promoIconLarge: { width: 76, height: 76, borderRadius: 24, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }], shadowColor: ORANGE, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 4 },
  promoIconLargeSecondary: { backgroundColor: SECONDARY, shadowColor: SECONDARY },
  promoIconSmall: { position: 'absolute', right: 13, bottom: 14, width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '8deg' }] },

  heatCard:         { width:145, borderRadius:20, borderWidth:1, overflow:'hidden', padding:14, marginRight:12, justifyContent:'flex-start', backgroundColor:'#FFFFFF' },
  heatEmoji:        { fontSize:26, marginBottom:10 },
  heatPill:         { flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:8, paddingVertical:3, borderRadius:12, alignSelf:'flex-start', marginBottom:8 },
  heatDot:          { width:5, height:5, borderRadius:2.5 },
  heatRiders:       { fontSize:11, fontWeight:'700' },
  heatName:         { fontSize:13, fontWeight:'700', color:NAVY, marginBottom:2 },
  heatDist:         { fontSize:11, color:MUTED, marginBottom:6 },
  emptyHotZones:    { marginTop:12, flexDirection:'row', alignItems:'center', gap:8, borderRadius:16, borderWidth:1, borderColor:BORDER, backgroundColor:'#FFFFFF', padding:14 },
  emptyHotZonesText:{ flex:1, color:MUTED, fontSize:12, fontWeight:'500' },
  heatEarnRow:      { flexDirection:'row', alignItems:'center', gap:4 },
  heatEarn:         { fontSize:11, fontWeight:'600' },

  // ── Ride Cards ────────────────────────────────────────────────────────────
  rideCard:         { borderRadius:20, borderWidth:1, borderColor:BORDER, overflow:'hidden', marginBottom:12, backgroundColor:'#FFFFFF', shadowColor:NAVY, shadowOffset:{width:0,height:2}, shadowOpacity:0.06, shadowRadius:12, elevation:2 },
  rideCardInner:    { padding:16 },
  rideCardTop:      { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  rideDateText:     { fontSize:12, color:MUTED, fontWeight:'500' },
  statusBadge:      { paddingHorizontal:10, paddingVertical:4, borderRadius:50 },
  statusBadgeText:  { fontSize:12, fontWeight:'600' },
  routeWrap:        { marginBottom:12 },
  routeRow:         { flexDirection:'row', alignItems:'center', marginBottom:5 },
  routeConnector:   { width:2, height:10, backgroundColor:BORDER, marginLeft:3, marginBottom:5 },
  dotOrange:        { width:8, height:8, borderRadius:4, backgroundColor:COLORS.orange, marginRight:10, flexShrink:0 },
  dotGray:          { width:8, height:8, borderRadius:4, backgroundColor:MUTED, marginRight:10, flexShrink:0 },
  routeFrom:        { fontSize:14, fontWeight:'600', flex:1, color:NAVY },
  routeTo:          { fontSize:14, fontWeight:'400', flex:1, color:MUTED },
  rideFooter:       { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  ridePrice:        { fontSize:15, fontWeight:'700', color:COLORS.orange },
  rideMeta:         { fontSize:12, color:MUTED },
  detailsBtn:       { flexDirection:'row', alignItems:'center', gap:2 },
  detailsBtnText:   { fontSize:13, color:COLORS.orange, fontWeight:'600' },
  actionRow:        { flexDirection:'row', justifyContent:'flex-end', alignItems:'center', gap:8, marginTop:12, flexWrap:'wrap' },
  iconBtn:          { width:36, height:36, borderRadius:18, alignItems:'center', justifyContent:'center', backgroundColor:'#F3EFE8' },
  waitingText:      { fontSize:12, color:MUTED, textAlign:'right', marginTop:8, fontStyle:'italic' },

  // ── Campus Activity ───────────────────────────────────────────────────────
  activityCard:     { borderRadius:18, borderWidth:1, borderColor:BORDER, overflow:'hidden', marginTop:2, backgroundColor:'#FFFFFF' },
  activityRow:      { flexDirection:'row', alignItems:'center', paddingHorizontal:14, paddingVertical:13, gap:12 },
  activityIconWrap: { width:34, height:34, borderRadius:17, backgroundColor:'#F9E8DB', alignItems:'center', justifyContent:'center', flexShrink:0 },
  activityText:     { flex:1, fontSize:13, color:NAVY, lineHeight:18, fontWeight:'500' },
  activityTime:     { fontSize:11, color:MUTED, fontWeight:'700', minWidth:42, textAlign:'right' },
  monthCard:        { borderRadius:18, borderWidth:1, borderColor:BORDER, backgroundColor:'#FFFFFF', overflow:'hidden', marginTop:2 },
  monthStatRow:     { flexDirection:'row', alignItems:'stretch', paddingVertical:4 },
  monthStat:        { flex:1, alignItems:'center', justifyContent:'center', paddingVertical:18, paddingHorizontal:8, gap:6 },
  monthStatIconWrap:{ width:38, height:38, borderRadius:19, backgroundColor:'#FFF2E9', alignItems:'center', justifyContent:'center' },
  monthStatValue:   { fontSize:22, fontWeight:'800', color:NAVY, letterSpacing:-0.5 },
  monthStatLabel:   { fontSize:11, color:MUTED, fontWeight:'600', textTransform:'uppercase', letterSpacing:0.5 },
  monthDivider:     { width:1, backgroundColor:BORDER, marginVertical:16 },
  monthEmptyRow:    { borderTopWidth:1, borderTopColor:BORDER, paddingHorizontal:16, paddingVertical:14 },
  monthEmptyText:   { fontSize:13, color:MUTED, lineHeight:18, textAlign:'center' },

  // ── Challenge ─────────────────────────────────────────────────────────────

  // ── Empty State ───────────────────────────────────────────────────────────
  emptyBox:         { alignItems:'center', paddingVertical:32, gap:8 },
  emptyIconWrap:    { width:56, height:56, borderRadius:18, backgroundColor:COLORS.orangeGlow, alignItems:'center', justifyContent:'center', marginBottom:4 },
  emptyTitle:       { fontSize:15, fontWeight:'700', color:NAVY },
  emptyText:        { fontSize:13, color:MUTED, textAlign:'center' },

  // ── Modal ─────────────────────────────────────────────────────────────────
  modalOverlay:     { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end' },
  modalSheet:       { borderTopLeftRadius:28, borderTopRightRadius:28, maxHeight:'92%', overflow:'hidden', paddingBottom:40, backgroundColor:BG, borderTopWidth:1, borderColor:BORDER },
  modalHandle:      { width:40, height:4, borderRadius:2, backgroundColor:BORDER, alignSelf:'center', marginTop:12, marginBottom:4 },
  modalHdr:         { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:24, paddingVertical:16 },
  modalTitle:       { fontSize:18, fontWeight:'800', color:NAVY, letterSpacing:-0.3 },
  modalCloseBtn:    { width:34, height:34, borderRadius:17, backgroundColor:'#F3EFE8', alignItems:'center', justifyContent:'center' },
  modalSection:     { marginBottom:20, marginTop:4 },
  modalSectionTitle:{ fontSize:11, fontWeight:'700', letterSpacing:1, textTransform:'uppercase', color:MUTED, marginBottom:10 },
  passengerRow:     { flexDirection:'row', alignItems:'center', backgroundColor:'#F3EFE8', borderRadius:14, padding:12, marginBottom:8 },
  passengerAvatar:  { width:44, height:44, borderRadius:22 },
  passengerName:    { fontSize:15, fontWeight:'700', color:NAVY, marginBottom:2 },
  passengerRating:  { fontSize:13, color:MUTED, fontWeight:'500' },
  callBtn:          { width:40, height:40, borderRadius:20, alignItems:'center', justifyContent:'center' },
  routeCard:        { borderRadius:14, borderWidth:1, borderColor:BORDER, padding:16, backgroundColor:'#FFFFFF' },
  infoGrid:         { flexDirection:'row', flexWrap:'wrap', gap:10 },
  infoCell:         { flex:1, minWidth:'44%', borderRadius:12, borderWidth:1, borderColor:BORDER, padding:12, alignItems:'center', backgroundColor:'#F3EFE8' },
  infoCellLabel:    { fontSize:10, fontWeight:'700', letterSpacing:0.5, textTransform:'uppercase', color:MUTED, marginBottom:4 },
  infoCellValue:    { fontSize:15, fontWeight:'700' },
    root: {
    flex: 1,
  },

  scroll: {
    flex: 1,
  },

  quickActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 22,
  },

  quickActionPrimary: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: COLORS.orange,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowColor: COLORS.orange,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  quickActionPrimaryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  liveRequestMarker: {
  minWidth: 44,
  minHeight: 30,
  borderRadius: 16,
  paddingHorizontal: 9,
  paddingVertical: 6,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 5,
  backgroundColor: COLORS.orange,
  borderWidth: 2,
  borderColor: '#FFFFFF',
  shadowColor: COLORS.orange,
  shadowOpacity: 0.35,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6,
}



,

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
    backgroundColor: 'rgba(8,14,23,0.35)',
  },

  webMapFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F3EFE8',
  },

  mapFallbackText: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
