import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet, Text as RNText, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { firebaseAuth, firestore, GOOGLE_MAPS_API_KEY } from '@/constants/services';
import { PaymentModal } from '@/components/PaymentModal';
import { RideFiltersModal } from '@/components/RideFiltersModal';
import { usePromotions } from '@/hooks/usePromotions';
import { Promotion } from '@/types';
import { applyFiltersToRide, getDefaultFilters, hasActiveFilters, type RideFilterOptions } from '@/utils/rideFilters';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { StatusBar } from 'expo-status-bar';
import {
  getRidePosting,
  MobileRidePosting,
  RiderProfile,
  subscribeAvailableRides,
  subscribeRiderConfirmedRides,
  subscribeRiderProfile,
} from '@/src/services/riderData';
import { appHeader, hitSlop, layout } from '@/theme/designSystem';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { badgeLabel, useRiderUnreadCounts } from '@/hooks/useRiderUnreadCounts';
import { riderCompleteRide } from '@/src/services/rideActions';
import { hasUserRatedRide } from '@/src/services/ratings';
import { useRideBrowseStore, type RiderRideFilter } from '@/stores/rideBrowseStore';
import { ReportIssueModal } from '@/components/ReportIssueModal';
import { CityAutocomplete } from '@/components/CityAutocomplete';
import { DatePickerModal, TimePickerModal, formatDateLabel } from '@/components/DateTimePickerModals';
import { computeRiderSuggestedPrice, formatContributionRange, getRideType } from '@/src/utils/pricing';
import { chatBelongsToRole, roleKey } from '@/src/utils/roleIdentity';
import { getOrCreateRideChat } from '@/src/services/chatAvailability';
import { createRoleNotification } from '@/src/services/notificationRecords';
import { useTripShare } from '@/src/services/tripShare';
import { useAppTheme } from '@/hooks/ThemeContext';
import { lightColors, type AppColors } from '@/constants/theme';

/** Normalize any ride/request status to UPPER_SNAKE consistently. */
const normalizeStatus = (v: unknown): string =>
  String(v || '').trim().replace(/[-\s]+/g, '_').toUpperCase();

const FONT_SANS = Platform.OS === 'web' ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' : undefined;
const FONT_MONO = Platform.OS === 'web' ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : undefined;

const StylesCtx = createContext<ReturnType<typeof makeStyles>>(makeStyles(lightColors));

function useRiderStyles() {
  const { colors } = useAppTheme();
  return useMemo(() => makeStyles(colors), [colors]);
}

function formatCurrentLocationAddress(result?: Location.LocationGeocodedAddress | null): string {
  if (!result) return 'Current location';
  return [result.name, result.street, result.city, result.region].filter(Boolean).join(', ') || 'Current location';
}

async function getCurrentLocationAddressAsync(): Promise<string | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos =
      (await Location.getLastKnownPositionAsync()) ||
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (!pos) return null;
    const rev = await Location.reverseGeocodeAsync({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });
    return formatCurrentLocationAddress(rev?.[0]);
  } catch {
    return null;
  }
}

type TabKey = 'home' | 'find' | 'rides' | 'inbox' | 'profile' | 'you';
type RNTextProps = React.ComponentProps<typeof RNText>;
type Coords = { lat: number; lng: number };

async function geocodeRiderAddress(address: string): Promise<Coords | null> {
  const q = address.trim();
  if (!q || !GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&components=country:US&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    const loc = json?.results?.[0]?.geometry?.location;
    if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') return { lat: loc.lat, lng: loc.lng };
  } catch {}
  return null;
}

async function fetchRiderRouteMetrics(origin: Coords, destination: Coords) {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const origins = `${origin.lat},${origin.lng}`;
    const destinations = `${destination.lat},${destination.lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinations)}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    const element = json?.rows?.[0]?.elements?.[0];
    const distanceMeters = element?.distance?.value;
    const durationSeconds = element?.duration?.value;
    if (typeof distanceMeters !== 'number' || typeof durationSeconds !== 'number') return null;
    return {
      distanceText: element?.distance?.text || null,
      durationText: element?.duration?.text || null,
      distanceMiles: distanceMeters / 1609.34,
      durationMinutes: durationSeconds / 60,
    };
  } catch {}
  return null;
}

function Text({ style, ...props }: RNTextProps) {
  const styles = useRiderStyles();
  return <RNText {...props} style={[styles.defaultText, style]} />;
}

function PhoneScreen({
  title,
  activeTab,
  children,
  showBack = false,
  rightIcon,
  rightAction,
  bottomAction,
  onBack,
}: {
  title?: string;
  activeTab?: TabKey;
  children: React.ReactNode;
  showBack?: boolean;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  rightAction?: React.ReactNode;
  bottomAction?: React.ReactNode;
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { goBack } = useReturnNavigation('/(rider)');
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const bottomNavHeight = 78;

  return (
    <StylesCtx.Provider value={styles}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
    <View style={styles.root}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {Platform.OS === 'web' ? (
          <View style={styles.status}>
            <Text style={styles.statusTime}>9:41</Text>
            <View style={styles.notch} />
            <View style={styles.statusIcons}>
              <Ionicons name="cellular" size={16} color={colors.textPrimary} />
              <Ionicons name="wifi" size={14} color={colors.textPrimary} />
              <Ionicons name="battery-full" size={18} color={colors.textPrimary} />
            </View>
          </View>
        ) : null}

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[
            styles.content,
            title ? styles.contentWithScrollableHeader : null,
            { paddingBottom: 16 + insets.bottom },
            activeTab ? { paddingBottom: bottomNavHeight } : null,
            bottomAction ? { paddingBottom: 84 + insets.bottom } : null,
          ]}
        >
        {title ? (
          <View style={styles.header}>
            {showBack ? (
              <TouchableOpacity style={styles.circleBtn} onPress={onBack || goBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={hitSlop}>
                <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            ) : (
              <Text style={styles.mark}>R</Text>
            )}
            <Text style={[styles.headerTitle, showBack && styles.headerTitleAfterBack]}>{title}</Text>
            <View style={{ flex: 1 }} />
            {rightAction ?? (rightIcon ? (
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={() => rightIcon === 'person-circle' ? router.push('/(rider)/profile' as any) : undefined}
                disabled={rightIcon !== 'person-circle'}
                accessibilityRole="button"
                accessibilityLabel={rightIcon === 'person-circle' ? 'Open profile' : 'More options'}
                accessibilityState={{ disabled: rightIcon !== 'person-circle' }}
                hitSlop={hitSlop}
              >
                <Ionicons name={rightIcon} size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            ) : null)}
          </View>
        ) : null}

          {children}
        </ScrollView>

        {bottomAction ? <View style={[styles.bottomAction, { bottom: insets.bottom + 12 }]}>{bottomAction}</View> : null}
        {activeTab ? <BottomNav active={activeTab} /> : null}
      </SafeAreaView>
    </View>
    </KeyboardAvoidingView>
    </StylesCtx.Provider>
  );
}

function BottomNav({ active }: { active: TabKey }) {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const { messageCount } = useRiderUnreadCounts();
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; href?: string }[] = [
    { key: 'home', label: 'Home', icon: 'home', href: '/(rider)' },
    { key: 'find', label: 'Request', icon: 'add-circle-outline', href: '/(rider)/book' },
    { key: 'rides', label: 'Rides', icon: 'ticket-outline', href: '/(rider)/available-rides' },
    { key: 'inbox', label: 'Inbox', icon: 'chatbubble', href: '/(rider)/messages' },
    { key: 'profile', label: 'Profile', icon: 'person', href: '/(rider)/profile' },
  ];

  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.navItem, selected ? styles.navItemActive : null]}
            onPress={() => tab.href && router.push(tab.href as any)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            hitSlop={hitSlop}
          >
            <View style={styles.navIconWrap}>
              <Ionicons name={tab.icon} size={23} color={selected ? colors.primary : colors.textSecondary} />
              {tab.key === 'inbox' && messageCount > 0 ? <View style={styles.iconBadge}><Text style={styles.iconBadgeText}>{badgeLabel(messageCount)}</Text></View> : null}
            </View>
            <Text style={[styles.navText, selected && { color: colors.primary }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function RouteDots({ compact = false, connected = false }: { compact?: boolean; connected?: boolean }) {
  const styles = useRiderStyles();
  return (
    <View style={[styles.routeRail, compact && { paddingVertical: 4 }, connected && styles.connectedRouteRail]}>
      <View style={styles.navyDot} />
      <View style={[styles.dashedLine, connected && styles.connectedRouteLine]} />
      <View style={styles.orangeDot} />
    </View>
  );
}

function HomeUtilityBar({ university, initial, avatarUrl }: { university?: string; initial: string; avatarUrl?: string }) {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const { notificationCount } = useRiderUnreadCounts();
  return (
    <View style={styles.homeUtilityBar}>
      <View style={styles.homeBrandMark}>
        <Image source={require('../../assets/ridealonglogo.png')} style={styles.homeBrandLogo} resizeMode="contain" />
      </View>
      <View style={styles.campusChip}>
        <Ionicons name="school-outline" size={15} color={colors.textPrimary} />
        <Text style={styles.campusText} numberOfLines={1}>{university || 'Your campus'}</Text>
      </View>
      <TouchableOpacity
        style={styles.utilityButton}
        onPress={() => router.push({ pathname: '/(rider)/notifications', params: { returnTo: '/(rider)' } } as any)}
        accessibilityRole="button"
        accessibilityLabel="Open notifications"
        hitSlop={hitSlop}
      >
        <Ionicons name="notifications-outline" size={21} color={colors.textPrimary} />
        {notificationCount > 0 ? <View style={styles.utilityBadge}><Text style={styles.iconBadgeText}>{badgeLabel(notificationCount)}</Text></View> : null}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.homeAvatar}
        onPress={() => router.push('/(rider)/profile' as any)}
        accessibilityRole="button"
        accessibilityLabel="Open profile"
        hitSlop={hitSlop}
      >
        {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.homeAvatarImage} resizeMode="cover" /> : <Text style={styles.homeAvatarText}>{initial}</Text>}
      </TouchableOpacity>
    </View>
  );
}

function RouteCard({ footer = true, cta = false, from = '', to = '', onChangeFrom, onChangeTo, onSearch }: {
  footer?: boolean;
  cta?: boolean;
  from?: string;
  to?: string;
  onChangeFrom?: (value: string) => void;
  onChangeTo?: (value: string) => void;
  onSearch?: () => void;
}) {
  const styles = useRiderStyles();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [timeModalOpen, setTimeModalOpen] = useState(false);

  return (
    <View style={[styles.searchCard, styles.autocompleteSearchCard]}>
      <View style={styles.routeRow}>
        <RouteDots />
        <View style={styles.routeInputs}>
          <CityAutocomplete
            value={from}
            onChangeText={onChangeFrom || (() => undefined)}
            onSelected={onChangeFrom || (() => undefined)}
            placeholder="Austin, TX"
            apiKey={GOOGLE_MAPS_API_KEY}
            containerStyle={styles.autocompleteField}
            inputStyle={styles.inputPill}
            zIndex={80}
          />
          <CityAutocomplete
            value={to}
            onChangeText={onChangeTo || (() => undefined)}
            onSelected={onChangeTo || (() => undefined)}
            placeholder="Houston, TX"
            apiKey={GOOGLE_MAPS_API_KEY}
            containerStyle={styles.autocompleteField}
            inputStyle={styles.inputPill}
            zIndex={70}
          />
        </View>
      </View>
      {footer ? (
        <View style={[styles.metaRow, styles.homeMetaRowFullWidth]}>
          <TouchableOpacity style={styles.metaPill} onPress={() => setDateModalOpen(true)} activeOpacity={0.78} accessibilityRole="button">
            <Text style={[styles.metaText, !date && styles.metaPlaceholderText]}>{date ? formatDateLabel(date) : 'Fri, Nov 20'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.metaPill} onPress={() => setTimeModalOpen(true)} activeOpacity={0.78} accessibilityRole="button">
            <Text style={[styles.metaText, !time && styles.metaPlaceholderText]}>{time || 'Anytime'}</Text>
          </TouchableOpacity>
          <DatePickerModal visible={dateModalOpen} selectedDate={date} onClose={() => setDateModalOpen(false)} onSelect={setDate} />
          <TimePickerModal visible={timeModalOpen} selectedTime={time} onClose={() => setTimeModalOpen(false)} onSelect={setTime} />
        </View>
      ) : null}
      {cta ? (
        <TouchableOpacity style={styles.searchPrimaryBtn} onPress={onSearch || (() => router.push('/(rider)/available-rides' as any))} accessibilityRole="button" accessibilityLabel="Find a ride">
          <Text style={styles.primaryText}>{'Find a ride ->'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  const styles = useRiderStyles();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

function UberStylePromotionCard({ promotion, claimed, onPress, width, secondary = false }: { promotion: Promotion; claimed: boolean; onPress: () => void; width: number; secondary?: boolean }) {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const icon: keyof typeof Ionicons.glyphMap = promotion.type === 'referral'
    ? 'people-outline'
    : promotion.type === 'informational'
      ? 'information-circle-outline'
      : promotion.type === 'reward'
        ? 'gift-outline'
        : 'pricetag-outline';
  const action = claimed ? 'Claimed' : promotion.linkText || (promotion.type === 'referral' ? 'Refer now' : 'View offer');

  return (
    <TouchableOpacity
      style={[styles.uberPromoCard, { width }]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`${promotion.title}. ${action}`}
    >
      <View style={styles.uberPromoCopy}>
        <Text style={styles.uberPromoTitle} numberOfLines={3}>{promotion.title}</Text>
        <Text style={styles.uberPromoDescription} numberOfLines={2}>{promotion.description}</Text>
        <View style={[styles.uberPromoCta, claimed && styles.uberPromoCtaClaimed]}>
          {claimed ? <Ionicons name="checkmark" size={15} color={colors.textPrimary} /> : null}
          <Text style={styles.uberPromoCtaText}>{action}</Text>
        </View>
      </View>
      <View style={[styles.uberPromoVisual, secondary && styles.uberPromoVisualSecondary]}>
        <View style={[styles.promoBubble, styles.promoBubbleTop, secondary && styles.promoBubbleSecondary]} />
        <View style={[styles.promoBubble, styles.promoBubbleBottom, secondary && styles.promoBubbleSecondary]} />
        <View style={[styles.promoIconLarge, secondary && styles.promoIconLargeSecondary]}>
          <Ionicons name={icon} size={40} color="#FFFFFF" />
        </View>
        <View style={styles.promoIconSmall}>
          <Ionicons name="car-outline" size={22} color={secondary ? colors.textPrimary : colors.primary} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function MiniRideCard({ price = '$28' }: { price?: string }) {
  const styles = useRiderStyles();
  return (
    <TouchableOpacity style={styles.rideCard} onPress={() => router.push('/(rider)/available-rides' as any)}>
      <View style={styles.rideMain}>
        <RouteDots compact />
        <View style={{ flex: 1 }}>
          <View style={styles.rideLine}>
            <Text style={styles.ridePlace}>Austin, TX</Text>
            <Text style={styles.rideTime}>FRI · 3:00 PM</Text>
          </View>
          <Text style={styles.rideMeta}>165 mi · ~2h 40m</Text>
          <View style={styles.rideLine}>
            <Text style={styles.ridePlace}>Houston, TX</Text>
            <Text style={styles.rideTime}>FRI · 5:40 PM</Text>
          </View>
        </View>
      </View>
      <View style={styles.driverFooter}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>JT</Text>
        </View>
        <Text style={styles.driverSmall}>Jordan T.{'\n'}★ 4.94 · 21 Civic · 3 seats</Text>
        <Text style={styles.cardPrice}>{price}</Text>
      </View>
    </TouchableOpacity>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderHomeReferencePlaceholder() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  return (
    <PhoneScreen activeTab="home">
      <HomeUtilityBar university="UT Austin" initial="M" />
      <View style={styles.heroCopy}>
        <Text style={styles.heroTitle}>
          Hey Melody - <Text style={styles.heroAccent}>where to?</Text>
        </Text>
        <Text style={styles.heroSub}>Friday, Nov 14 · 47 students heading out today</Text>
      </View>

      <RouteCard cta />

      <View style={styles.promotionEmptyCard}>
        <Ionicons name="gift-outline" size={24} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.promotionEmptyTitle}>Loading your offers</Text>
          <Text style={styles.promotionEmptyText}>Student deals will appear here.</Text>
        </View>
      </View>

    </PhoneScreen>
  );
}

export function RiderHomeReference() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { width: windowWidth } = useWindowDimensions();
  const uid = firebaseAuth.currentUser?.uid;
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [confirmed, setConfirmed] = useState<MobileRidePosting[]>([]);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [requestsWithOffers, setRequestsWithOffers] = useState<Map<string, { offerId: string; driverId?: string; offerPrice?: number; offerCount: number }>>(new Map());
  const [confirmedRideStatus, setConfirmedRideStatus] = useState<string | null>(null);
  const [confirmedRideId, setConfirmedRideId] = useState<string | null>(null);
  const [driverEnRoute, setDriverEnRoute] = useState(false);
  const [verificationCode, setVerificationCode] = useState<string | null>(null);
  const [completedRideSourceKeys, setCompletedRideSourceKeys] = useState<Set<string>>(new Set());
  const ratingNavRef = useRef<Set<string>>(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const triedHomeLocationRef = useRef(false);
  const [promotionIndex, setPromotionIndex] = useState(0);
  const promotionScrollRef = useRef<ScrollView>(null);
  const { promotions, loading: promotionsLoading, isPromotionClaimed } = usePromotions();
  const promotionCardWidth = Math.min(windowWidth, 430) - 52;
  const promotionSnapInterval = promotionCardWidth + 12;

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (triedHomeLocationRef.current || from.trim()) return;
    triedHomeLocationRef.current = true;
    getCurrentLocationAddressAsync().then((address) => {
      if (!cancelled && address && !from.trim()) setFrom(address);
    });
    return () => { cancelled = true; };
  }, [from]);

  useEffect(() => {
    if (!uid) { setInitialized(true); return; }
    return subscribeRiderProfile(uid, (p) => {
      setProfile(p);
      setInitialized(true);
    });
  }, [uid]);
  useEffect(() => uid ? subscribeRiderConfirmedRides(uid, setConfirmed) : undefined, [uid]);
  useEffect(() => {
    if (!uid) {
      setCompletedRideSourceKeys(new Set());
      return undefined;
    }

    const q = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid));
    return onSnapshot(q, (snap) => {
      const keys = new Set<string>();
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const status = String(data.status || '').replace(/[-\s]/g, '_').toUpperCase();
        const statusAtFlag = String(data.statusAtFlag || data.statusBeforeFlag || data.flaggedFromStatus || data.previousStatus || '').replace(/[-\s]/g, '_').toUpperCase();
        if (status !== 'COMPLETED' && statusAtFlag !== 'COMPLETED') return;

        if (data.rideRequestId) keys.add(`rideRequest:${String(data.rideRequestId)}`);
        if (data.ridePostingRequestId) keys.add(`ridePostingRequest:${String(data.ridePostingRequestId)}`);
        if (data.ridePostingId) keys.add(`ridePosting:${String(data.ridePostingId)}`);
      });
      setCompletedRideSourceKeys(keys);
    }, (error) => {
      setCompletedRideSourceKeys(new Set());
      console.warn('[RiderHomeReference] completed ride source listener error:', error);
    });
  }, [uid]);
  useEffect(() => {
    if (!uid) return undefined;
    const inactive = new Set(['cancelled', 'canceled', 'completed', 'rejected', 'declined']);
    const seen = new Map<string, any>();
    let snapA: any[] = [];
    let snapB: any[] = [];

    const merge = () => {
      seen.clear();
      [...snapA, ...snapB].forEach((r) => seen.set(r.id, r));
      const ts = (r: any) => r.createdAt?.toMillis?.() ?? r._localCreatedMs ?? 0;
      const merged = Array.from(seen.values())
        .filter((r) => !inactive.has(String(r.status || r.state || '').toLowerCase()))
        .filter((r) => {
          if ((r as any)._isPostingRequest) {
            const postingId = (r as any).ridePostingId || (r as any).rideId || (r as any).postingId;
            return !completedRideSourceKeys.has(`ridePostingRequest:${r.id}`)
              && !(postingId && completedRideSourceKeys.has(`ridePosting:${String(postingId)}`));
          }
          return !completedRideSourceKeys.has(`rideRequest:${r.id}`);
        })
        .sort((a, b) => ts(b) - ts(a));
      setActiveRequests(merged);
    };

    // Standard ride requests (rider-initiated, driver browses)
    const qA = query(collection(firestore, 'rideRequests'), where('riderId', '==', uid));
    const unsubA = onSnapshot(qA, (snap) => {
      snapA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      merge();
    }, (error) => {
      snapA = [];
      merge();
      console.warn('[RiderHomeReference] rideRequests listener error:', error);
    });

    // Rider booking from a driver's posting (ridePostingRequests)
    const qB = query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', uid));
    const unsubB = onSnapshot(qB, (snap) => {
      snapB = snap.docs.map((d) => ({ id: d.id, _isPostingRequest: true, ...d.data() }));
      merge();
    }, (error) => {
      snapB = [];
      merge();
      console.warn('[RiderHomeReference] ridePostingRequests listener error:', error);
    });

    return () => { unsubA(); unsubB(); };
  }, [uid, completedRideSourceKeys]);

  useEffect(() => {
    if (!uid) return undefined;
    const activeOfferStatuses = ['pending', 'sent', 'offer', 'offer_sent', 'offered'];
    const q = query(
      collection(firestore, 'rideOffers'),
      where('riderId', '==', uid),
    );
    return onSnapshot(q, (snap) => {
      const map = new Map<string, { offerId: string; driverId?: string; offerPrice?: number; offerCount: number }>();
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        const status = String(data.status || '').toLowerCase();
        if (activeOfferStatuses.includes(status) && data.rideRequestId) {
          const key = String(data.rideRequestId);
          const existing = map.get(key);
          map.set(key, {
            offerId: d.id,
            driverId: data.driverId,
            offerPrice: Number(data.offerPrice ?? data.price ?? data.amount ?? 0) || undefined,
            offerCount: (existing?.offerCount ?? 0) + 1,
          });
        }
      });
      setRequestsWithOffers(map);
    }, (error) => {
      setRequestsWithOffers(new Map());
      console.warn('[RiderHomeReference] rideOffers listener error:', error);
    });
  }, [uid]);
  useEffect(() => {
    if (promotions.length < 2) return;
    const interval = setInterval(() => {
      setPromotionIndex((current) => {
        const next = (current + 1) % promotions.length;
        promotionScrollRef.current?.scrollTo({ x: next * promotionSnapInterval, animated: true });
        return next;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [promotions.length, promotionSnapInterval]);

  useEffect(() => {
    if (from.trim()) return;
    let cancelled = false;

    (async () => {
      const current = await getCurrentLocationAddressAsync();
      if (!cancelled && current) setFrom(current);
    })();

    return () => {
      cancelled = true;
    };
  }, [from]);

  const nextRide = useMemo(() => {
    // Prioritise any ride that's actively in progress (needs rider action)
    const activeStatuses = new Set(['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED']);
    const active = confirmed.find((r) => activeStatuses.has(String(r.status || '').toUpperCase()));
    if (active) return active;
    return confirmed.find((ride) => !ride.date || ride.date.getTime() >= Date.now()) || null;
  }, [confirmed]);
  const nextRequest = activeRequests[0] || null;
  const firstName = profile?.firstName || profile?.displayName?.split(' ')[0] || firebaseAuth.currentUser?.displayName?.split(' ')[0] || 'there';
  const nextRequestOfferInfo = useMemo(() => {
    if (!nextRequest) return null;
    if (requestsWithOffers.has(nextRequest.id)) return requestsWithOffers.get(nextRequest.id)!;
    const rawStatus = String(nextRequest.status || nextRequest.state || '').toLowerCase();
    const offerCount = Number(nextRequest.offerCount || nextRequest.offersCount || nextRequest.driverOfferCount || 0);
    const hasOffer =
      rawStatus.includes('offer') || rawStatus.includes('matched') ||
      offerCount > 0 || (Array.isArray(nextRequest.offers) && nextRequest.offers.length > 0) ||
      !!nextRequest.offerId || !!nextRequest.rideOfferId;
    return hasOffer
      ? {
          offerId: nextRequest.offerId || nextRequest.rideOfferId || '',
          driverId: nextRequest.driverId,
          offerPrice: Number(nextRequest.offerPrice ?? nextRequest.price ?? 0) || undefined,
        }
      : null;
  }, [nextRequest, requestsWithOffers]);

  const nextRequestHasOffer = !!nextRequestOfferInfo;

  const nextRequestIsConfirmed = !!nextRequest && ['accepted', 'confirmed'].includes(String(nextRequest.status || nextRequest.state || '').toLowerCase());

  // Watch confirmedRides for live status updates (CONFIRMED → IN_PROGRESS → DRIVER_COMPLETED → COMPLETED).
  // For posting-request rides we run two parallel subscriptions and take whichever finds data first:
  //   1. Direct doc by ID  "${postingId}_${requestId}"  (precise, no index needed)
  //   2. Collection query  where('ridePostingId', '==', postingId)  (catches mismatched requestId)
  // For classic rides, query by rideRequestId.
  const _postingId = (nextRequest as any)?.ridePostingId || (nextRequest as any)?.rideId || null;
  const _isPostingReq = !!(nextRequest as any)?._isPostingRequest;
  const _requestId = nextRequest?.id || null;
  useEffect(() => {
    if (!_requestId || !nextRequestIsConfirmed) {
      setConfirmedRideStatus(null);
      setConfirmedRideId(null);
      return;
    }

    const applySnap = async (docId: string, rideData: any) => {
      const status = String(rideData.status || '').toUpperCase();
      setConfirmedRideId(docId);
      setConfirmedRideStatus(status);
      // Clear en-route once ride is in progress or beyond
      const stillEnRoute = !!rideData.driverEnRoute && status === 'CONFIRMED';
      setDriverEnRoute(stillEnRoute);
      setVerificationCode(rideData.verificationCode || null);
      if (status === 'COMPLETED' && !ratingNavRef.current.has(docId)) {
        ratingNavRef.current.add(docId);
        const alreadyRated = !!rideData.riderRated || await hasUserRatedRide(docId, uid);
        if (!alreadyRated) router.push({ pathname: '/(rider)/rate-trip', params: { confirmedRideId: docId } } as any);
      }
    };

    if (_isPostingReq && _postingId) {
      // Strategy 1: direct doc reference — no query, no index
      const directId = `${_postingId}_${_requestId}`;
      const directRef = doc(firestore, 'confirmedRides', directId);
      const unsub1 = onSnapshot(directRef, (snap) => {
        if (snap.exists()) {
          applySnap(snap.id, snap.data());
        } else {
          // Only clear if the collection query also finds nothing (handled by unsub2)
        }
      }, (error) => {
        console.warn('[RiderHomeReference] confirmed direct listener error:', error);
      });

      // Strategy 2: collection query by postingId — handles accepted-with-different-requestId
      const q = query(collection(firestore, 'confirmedRides'), where('ridePostingId', '==', _postingId));
      const unsub2 = onSnapshot(q, (snap) => {
        const d = snap.docs.find((d) => d.data().riderId === uid) ?? snap.docs[0] ?? null;
        if (d) {
          applySnap(d.id, d.data());
        } else if (!snap.docs.length) {
          setConfirmedRideId(null);
          setConfirmedRideStatus(null);
        }
      }, (error) => {
        setConfirmedRideId(null);
        setConfirmedRideStatus(null);
        console.warn('[RiderHomeReference] confirmed posting listener error:', error);
      });

      return () => { unsub1(); unsub2(); };
    }

    // Classic ride request — query by riderId (allowed by rules), filter client-side for matching rideRequestId
    const q = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid));
    return onSnapshot(q, async (snap) => {
      const d = snap.docs.find((doc) => {
        const data = doc.data();
        return data.rideRequestId === _requestId || data.rideId === _requestId;
      }) ?? snap.docs[0] ?? null;
      if (d) {
        applySnap(d.id, d.data());
      } else {
        setConfirmedRideId(null);
        setConfirmedRideStatus(null);
      }
    }, (error) => {
      setConfirmedRideId(null);
      setConfirmedRideStatus(null);
      console.warn('[RiderHomeReference] confirmed request listener error:', error);
    });
  }, [_requestId, nextRequestIsConfirmed, _isPostingReq, _postingId]);

  const activeRideStatus = String(confirmedRideStatus || nextRide?.status || '').replace(/[-\s]/g, '_').toUpperCase();
  const isRideInProgress = ['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED'].includes(activeRideStatus);
  const isDriverCompleted = activeRideStatus === 'DRIVER_COMPLETED';

  const heroPrompt = useMemo(() => {
    if (activeRideStatus === 'COMPLETED') return 'where to?';
    if (isDriverCompleted) return 'confirm your arrival!';
    if (isRideInProgress) return 'your ride is in progress!';
    if (activeRideStatus === 'PENDING' && nextRide) return 'your seat is reserved!';
    if (nextRide || nextRequestIsConfirmed) return 'your ride is confirmed!';
    if (nextRequest) {
      if ((nextRequest as any)._isPostingRequest) {
        const s = String((nextRequest as any).status || '').toLowerCase();
        if (s === 'accepted') return 'your ride is confirmed!';
        return 'your request is pending.';
      }
      return nextRequestHasOffer ? 'you have a ride offer!' : 'your ride is visible to drivers.';
    }
    return 'where to?';
  }, [nextRequest, nextRide, nextRequestHasOffer, nextRequestIsConfirmed, isRideInProgress, isDriverCompleted, activeRideStatus]);
  const search = () => router.push({ pathname: '/(rider)/available-rides', params: { from: from.trim(), to: to.trim() } } as any);

  if (!initialized) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <PhoneScreen activeTab="home">
        <HomeUtilityBar university={profile?.university} initial={firstName.charAt(0).toUpperCase()} avatarUrl={profile?.avatarUrl} />
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Hey {firstName} - <Text style={styles.heroAccent}>{heroPrompt}</Text></Text>
        </View>
        {(nextRide || nextRequest) && confirmedRideStatus !== 'COMPLETED' ? (
          <View style={styles.homePrimaryBlock}>
            {nextRide ? <LiveRideCard ride={nextRide} /> : <RiderActivityCard request={nextRequest} offerInfo={nextRequestOfferInfo} confirmedRideStatus={confirmedRideStatus} confirmedRideId={confirmedRideId} driverEnRoute={driverEnRoute} verificationCode={verificationCode} />}
          </View>
        ) : (
          <View style={styles.homePrimarySearchBlock}>
            <RouteCard cta from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} onSearch={search} />
          </View>
        )}

        {/* Also upcoming — additional rides/requests beyond the hero */}
        {(() => {
          const now = Date.now();
          // Additional confirmed rides (excluding the one shown as hero)
          const additionalRides = confirmed.filter((r) => {
            if (nextRide && r.id === nextRide.id) return false;
            const s = String(r.status || '').toUpperCase();
            if (['COMPLETED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(s)) return false;
            return !r.date || r.date.getTime() >= now - 2 * 60 * 60 * 1000;
          });
          // Additional requests (excluding the one shown as hero)
          const additionalRequests = activeRequests.slice(1);
          const hasMore = additionalRides.length > 0 || additionalRequests.length > 0;
          if (!hasMore) return null;
          return (
            <View style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: '700' }}>Also upcoming</Text>
              </View>
              {additionalRides.map((ride) => (
                <View key={ride.id} style={{ marginBottom: 10 }}>
                  <LiveRideCard ride={ride} />
                </View>
              ))}
              {additionalRequests.map((req) => {
                const offer = requestsWithOffers.get(req.id);
                const offerInfo = offer ? { offerId: offer.offerId, driverId: offer.driverId, offerPrice: offer.offerPrice, offerCount: offer.offerCount } : null;
                return (
                  <View key={req.id} style={{ marginBottom: 10 }}>
                    <RiderActivityCard
                      request={req}
                      offerInfo={offerInfo}
                      confirmedRideStatus={null}
                      confirmedRideId={null}
                      driverEnRoute={false}
                      verificationCode={null}
                    />
                  </View>
                );
              })}
            </View>
          );
        })()}

        {promotionsLoading && promotions.length === 0 ? (
          <View style={styles.promotionLoading}><ActivityIndicator color={colors.primary} /></View>
        ) : promotions.length > 0 ? (
          <>
          <ScrollView
            ref={promotionScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.promotionList}
            snapToInterval={promotionSnapInterval}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            onMomentumScrollEnd={(event) => {
              const next = Math.round(event.nativeEvent.contentOffset.x / promotionSnapInterval);
              setPromotionIndex(Math.max(0, Math.min(next, promotions.length - 1)));
            }}
          >
            {promotions.map((promotion, index) => (
              <UberStylePromotionCard
                key={promotion.id}
                promotion={promotion}
                claimed={isPromotionClaimed(promotion.id)}
                onPress={() => router.push('/(rider)/profile' as any)}
                width={promotionCardWidth}
                secondary={index % 2 === 1}
              />
            ))}
          </ScrollView>
          {promotions.length > 1 ? (
            <View style={styles.promotionDots}>
              {promotions.map((promotion, index) => (
                <View key={promotion.id} style={[styles.promotionDot, index === promotionIndex && styles.promotionDotActive]} />
              ))}
            </View>
          ) : null}
          </>
        ) : (
          <View style={styles.promotionEmptyCard}>
            <Ionicons name="gift-outline" size={24} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.promotionEmptyTitle}>No active promotions</Text>
              <Text style={styles.promotionEmptyText}>Check back soon for new student offers.</Text>
            </View>
          </View>
        )}
        <RideAgainSection />
    </PhoneScreen>
  );
}

function LiveRideCard({ ride }: { ride: MobileRidePosting }) {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const rawStatus = String(ride.status || '').replace(/[-\s]/g, '_').toUpperCase();
  const isDriverCompleted = rawStatus === 'DRIVER_COMPLETED';
  const isInProgress = ['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED'].includes(rawStatus);
  const isPending = rawStatus === 'PENDING';
  const statusLabel = isDriverCompleted ? 'CONFIRM ARRIVAL' : isInProgress ? 'IN PROGRESS' : isPending ? 'WAITING FOR PASSENGERS' : 'CONFIRMED';
  const statusColor = isInProgress ? colors.primary : isPending ? colors.primary : colors.green;
  const statusBg    = isInProgress ? colors.primaryDim : isPending ? colors.primaryDim : colors.greenDim;
  const totalSeats = Number(ride.raw?.totalSeats) || 0;
  const seatsTaken = Number(ride.raw?.seatsTaken) || 0;
  const dateText = ride.date
    ? ride.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' · ' + ride.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'Date pending';

  const [driverName, setDriverName] = useState(ride.driverName);
  const [vehicleText, setVehicleText] = useState(ride.vehicle);
  const [driverPhotoURL, setDriverPhotoURL] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const { shareTrip, sharing } = useTripShare(
    isInProgress ? ride.id : null,
    isInProgress,
    { pickup: ride.from, dropoff: ride.to },
  );

  useEffect(() => {
    setDriverName(ride.driverName);
    setVehicleText(ride.vehicle);
    setDriverPhotoURL(null);
    const driverId = ride.driverId || ride.raw?.driverId;
    if (!driverId) return;
    let cancelled = false;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8000));
    Promise.race([getDoc(doc(firestore, 'drivers', driverId)), timeout]).then((snap) => {
      if (cancelled || !snap || !('exists' in snap) || !snap.exists()) return;
      const d = snap.data();
      const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim()
        || d.displayName || d.name || '';
      if (name) setDriverName(name);
      const vi = d.vehicleInfo || {};
      const vehicle = [vi.year, vi.color, vi.make, vi.model].filter(Boolean).join(' ');
      if (vehicle) setVehicleText(vehicle);
      const photo = d.avatarUrl || d.avatarUrl1 || d.photoURL || d.profilePicture || null;
      setDriverPhotoURL(photo);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ride.id]);

  const openDetails = () => router.push({ pathname: '/(rider)/ride/[id]', params: { id: ride.id, returnTo: '/(rider)' } } as any);
  const openTrip = () => {}; // trip-in-progress page removed for riders

  return (
    <View style={styles.rideCard}>
      {/* Status + price + flag */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: statusBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{statusLabel}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {totalSeats > 1 && <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '700' }}>{seatsTaken}/{totalSeats} seats</Text>}
          {ride.price > 0 && <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '800' }}>${ride.price.toFixed(2)}</Text>}
        </View>
      </View>

      {/* Route — inline dots */}
      <TouchableOpacity activeOpacity={0.7} onPress={isInProgress ? openTrip : openDetails}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ alignItems: 'center', paddingTop: 4, gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.textPrimary }} />
            <View style={{ width: 1, flex: 1, minHeight: 16, backgroundColor: colors.border }} />
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors.primary }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 4 }} numberOfLines={1}>{ride.from || 'Pickup pending'}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>{dateText}</Text>
            <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{ride.to || 'Destination pending'}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Driver info */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
        <View style={[styles.avatar, { overflow: 'hidden' }]}>
          {driverPhotoURL
            ? <Image source={{ uri: driverPhotoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            : <Text style={styles.avatarText}>{driverName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2)}</Text>}
        </View>
        <Text style={styles.driverSmall}>
          {driverName}{'\n'}{ride.driverRating ? `★ ${ride.driverRating.toFixed(2)} · ` : ''}{vehicleText}
        </Text>
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {isDriverCompleted ? (
          <>
            <TouchableOpacity
              style={[styles.actionBtnPrimary, { flex: 2, backgroundColor: colors.textPrimary }, confirming && { opacity: 0.6 }]}
              disabled={confirming}
              activeOpacity={0.8}
              onPress={async () => {
                setConfirming(true);
                const completed = await riderCompleteRide(ride.id);
                setConfirming(false);
                if (completed) await openRiderRatingIfNeeded(ride.id);
              }}
            >
              {confirming
                ? <ActivityIndicator size="small" color={colors.textInverse} />
                : <Text style={styles.actionBtnPrimaryText}>Confirm Arrival</Text>}
            </TouchableOpacity>
          </>
        ) : isInProgress ? (
          <>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' }]}
              onPress={shareTrip}
              disabled={sharing}
              activeOpacity={0.75}
            >
              <Ionicons name="share-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.actionBtnSecondaryText}>Share Trip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' }]}
              onPress={() => setReportVisible(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="alert-circle-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.actionBtnSecondaryText}>Report</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.actionBtnSecondary, { flex: 1 }]} onPress={openDetails} activeOpacity={0.75}>
            <Text style={styles.actionBtnSecondaryText}>View Details</Text>
          </TouchableOpacity>
        )}
      </View>

      <ReportIssueModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        confirmedRideId={ride.id}
        reportedDuringRide={true}
      />
    </View>
  );
}

// Each confirmed ride has exactly one chat, created by Cloud Function when confirmedRides doc is made.
// rideId on the chat doc = the confirmedRides document ID (NOT rideRequests ID).
async function openChatForConfirmedRide(rideRequestId: string, navigate: (chatId: string) => void) {
  const confirmedSnap = await getDocs(
    query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', rideRequestId))
  );
  if (confirmedSnap.empty) {
    Alert.alert('Not available', 'The chat opens once the ride is confirmed.');
    return;
  }
  const confirmedRideId = confirmedSnap.docs[0].id;

  // Retry up to 3 times — the Cloud Function that creates the chat may lag by a second or two
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const chatSnap = await getDocs(
      query(collection(firestore, 'chats'), where('rideId', '==', confirmedRideId))
    );
    if (!chatSnap.empty) {
      navigate(chatSnap.docs[0].id);
      return;
    }
  }
  Alert.alert('Chat not ready', 'The chat is still being set up. Try again in a moment.');
}

async function openRiderRatingIfNeeded(confirmedRideId: string) {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) return;
  const alreadyRated = await hasUserRatedRide(confirmedRideId, uid).catch(() => false);
  if (!alreadyRated) {
    router.push({ pathname: '/(rider)/rate-trip', params: { confirmedRideId } } as any);
  }
}

function RiderActivityCard({ request, offerInfo, confirmedRideStatus, confirmedRideId, driverEnRoute, verificationCode }: { request: any; offerInfo?: { offerId: string; driverId?: string; offerPrice?: number; offerCount?: number } | null; confirmedRideStatus?: string | null; confirmedRideId?: string | null; driverEnRoute?: boolean; verificationCode?: string | null }) {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const pickup = request.pickupAddress || request.pickup || request.from || 'Pickup pending';
  const dropoff = request.dropoffAddress || request.dropoff || request.to || 'Destination pending';
  const price = Number(request.maxPrice || request.estimatedFare || request.price || 0);
  const reqStatus       = normalizeStatus(request.status ?? request.state);
  const isConfirmed     = reqStatus === 'ACCEPTED' || reqStatus === 'CONFIRMED';
  const confirmedNorm   = normalizeStatus(confirmedRideStatus);
  const isInProgress    = ['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED'].includes(confirmedNorm);
  const isDriverCompleted = confirmedNorm === 'DRIVER_COMPLETED';
  const hasOffer = !isConfirmed && !!offerInfo;
  const [acting, setActing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [offerPaymentVisible, setOfferPaymentVisible] = useState(false);
  const [localCode, setLocalCode] = useState<string | null>(verificationCode ?? null);
  const [reportVisible, setReportVisible] = useState(false);
  const { shareTrip, sharing } = useTripShare(
    confirmedRideId ?? null,
    isInProgress,
    { pickup: request.pickupAddress || request.pickup, dropoff: request.dropoffAddress || request.dropoff },
  );

  // Fetch code directly if not provided via prop (listener may not have fired yet)
  useEffect(() => {
    if (verificationCode) { setLocalCode(verificationCode); return; }
    if (!confirmedRideId || !isConfirmed) return;
    getDoc(doc(firestore, 'confirmedRides', confirmedRideId)).then((snap) => {
      const code = snap.exists() ? snap.data()?.verificationCode : null;
      if (code) setLocalCode(code);
    }).catch(() => {});
  }, [confirmedRideId, verificationCode, isConfirmed]);
  const [driverName, setDriverName] = useState<string>('');
  const [vehicleText, setVehicleText] = useState<string>('');
  const [driverPhotoURL, setDriverPhotoURL] = useState<string | null>(null);
  const [driverRating, setDriverRating] = useState<number | null>(null);

  const driverId = offerInfo?.driverId || request.driverId || null;

  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8000));
    Promise.race([getDoc(doc(firestore, 'drivers', driverId)), timeout]).then((snap) => {
      if (cancelled || !snap || !('exists' in snap) || !snap.exists()) return;
      const d = snap.data() as any;
      const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim() || d.displayName || d.name || '';
      if (name) setDriverName(name);
      const vi = d.vehicleInfo || {};
      const vehicle = [vi.year, vi.color, vi.make, vi.model].filter(Boolean).join(' ');
      if (vehicle) setVehicleText(vehicle);
      const photo = d.avatarUrl || d.avatarUrl1 || d.photoURL || d.profilePicture || null;
      setDriverPhotoURL(photo);
      if (typeof d.rating === 'number') setDriverRating(d.rating);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [driverId]);

  const openChat = async () => {
    const riderId = firebaseAuth.currentUser?.uid;
    if (!riderId || !driverId) return;
    try {
      // Use the same key as the pre-confirmation chat so we don't open a second thread.
      const ridePostingRequestId = (request as any)._isPostingRequest
        ? request.id
        : (request.raw?.ridePostingRequestId || null);
      const chatId = await getOrCreateRideChat({
        context: ridePostingRequestId ? 'booking-request' : 'confirmed-ride',
        rideId: confirmedRideId || request.id,
        driverId,
        riderId,
        ridePostingId: request.raw?.ridePostingId || null,
        ridePostingRequestId,
      });
      router.push(`/(rider)/messages/${chatId}` as any);
    } catch {
      Alert.alert('Error', 'Could not open chat. Please try again.');
    }
  };

  const openOfferChat = async () => {
    const riderId = firebaseAuth.currentUser?.uid;
    if (!riderId || !offerInfo?.driverId || !offerInfo.offerId) return;
    try {
      const chatId = await getOrCreateRideChat({
        context: 'ride-offer',
        rideId: request.id,
        rideRequestId: request.id,
        rideOfferId: offerInfo.offerId,
        driverId: offerInfo.driverId,
        riderId,
      });
      router.push(`/(rider)/messages/${chatId}` as any);
    } catch {
      Alert.alert('Error', 'Could not open chat. Please try again.');
    }
  };

  // Step 1: show payment gate; Step 2 (onPaymentSuccess) confirms with the server
  const handleAccept = () => {
    if (!offerInfo?.offerId) return;
    if (!firebaseAuth.currentUser) return;
    Alert.alert('Accept offer?', 'You\'ll need to authorize payment before confirming.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue to payment', onPress: () => setOfferPaymentVisible(true) },
    ]);
  };

  const handleOfferPaymentSuccess = async (paymentIntentId: string) => {
    setOfferPaymentVisible(false);
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid || !offerInfo?.offerId) return;
    setActing(true);

    // Write paymentIntentId onto the rideRequests doc so the backend can read it
    // even if the request body field is ignored by older server versions
    try {
      await updateDoc(doc(firestore, 'rideRequests', request.id), {
        paymentIntentId,
        paymentStatus: 'authorized',
      });
    } catch {}

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const { getApiBaseUrl } = await import('@/constants/services');
      const res = await fetch(`${getApiBaseUrl()}/api/accept-ride-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offerInfo.offerId, riderId: uid, driverId: offerInfo.driverId, paymentIntentId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `Server error ${res.status}`);
      }
      router.push('/(rider)/requests' as any);
    } catch (e: any) {
      clearTimeout(timeout);
      // Void the authorized payment so the rider is not charged
      try {
        const { cancelRidePayment } = await import('@/services/payments');
        await cancelRidePayment({ paymentIntentId, rideId: offerInfo.offerId });
      } catch {}
      const msg = e?.name === 'AbortError'
        ? 'Request timed out. Your payment was not charged. Please try again.'
        : (e?.message || 'Could not accept the offer. Your payment was not charged.');
      Alert.alert('Failed', msg);
    } finally {
      setActing(false);
    }
  };

  const handleCancel = () => {
    Alert.alert('Cancel request?', 'Drivers will no longer see this request.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: async () => {
          setActing(true);
          try {
            const { doc, updateDoc, serverTimestamp: st } = await import('firebase/firestore');
            const { firestore: db } = await import('@/constants/services');
            const col = request._isPostingRequest ? 'ridePostingRequests' : 'rideRequests';
            await updateDoc(doc(db, col, request.id), { status: 'cancelled', updatedAt: st() });
          } catch {
            Alert.alert('Failed', 'Could not cancel the request. Please try again.');
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  };

  const isEnRoute   = !!driverEnRoute && isConfirmed && !isInProgress && !isDriverCompleted;
  const statusColor = isDriverCompleted ? colors.primary : isInProgress ? colors.primary : isEnRoute ? colors.primary : isConfirmed ? colors.green : hasOffer ? colors.primary : colors.textSecondary;
  const statusBg    = isDriverCompleted ? colors.primaryDim : isInProgress ? colors.primaryDim : isEnRoute ? colors.primaryDim : isConfirmed ? colors.greenDim : hasOffer ? colors.primaryDim : colors.bgSecondary;
  const statusLabel = isDriverCompleted ? 'CONFIRM ARRIVAL' : isInProgress ? 'IN PROGRESS' : isEnRoute ? '🚗 DRIVER EN ROUTE' : isConfirmed ? 'CONFIRMED' : hasOffer ? 'OFFER RECEIVED' : 'PENDING';
  const showDriverInfo = (isConfirmed || isInProgress || isDriverCompleted) && !!driverName;

  return (
    <View style={styles.rideCard}>
      {/* Status + price + flag */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: statusBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{statusLabel}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {price > 0 && <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '800' }}>${price.toFixed(0)}</Text>}
        </View>
      </View>

      {/* Route — inline dots */}
      <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/(rider)/requests' as any)}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ alignItems: 'center', paddingTop: 4, gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.textPrimary }} />
            <View style={{ width: 1, flex: 1, minHeight: 16, backgroundColor: colors.border }} />
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors.primary }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 4 }} numberOfLines={1}>{pickup}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>
              {request.date || 'Date pending'}{request.time ? ` · ${request.time}` : ''}
            </Text>
            <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{dropoff}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Verification code — shown to rider when ride is CONFIRMED, before pickup */}
      {isConfirmed && !isInProgress && !isDriverCompleted && localCode && (
        <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' }}>Your verification code</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {localCode.split('').map((digit, i) => (
              <View key={i} style={{ width: 52, height: 64, borderRadius: 14, backgroundColor: colors.primaryDim, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.primary, fontSize: 32, fontWeight: '800' }}>{digit}</Text>
              </View>
            ))}
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 10, textAlign: 'center' }}>
            Give this code to your driver when they arrive
          </Text>
        </View>
      )}

      {/* Driver info (when confirmed/in-progress) — tappable → driver profile */}
      {showDriverInfo && (
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}
          onPress={() => driverId && router.push({ pathname: '/(rider)/driver/[driverId]', params: { driverId, returnTo: '/(rider)' } } as any)}
          activeOpacity={driverId ? 0.7 : 1}
        >
          <View style={[styles.avatar, { overflow: 'hidden' }]}>
            {driverPhotoURL
              ? <Image source={{ uri: driverPhotoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              : <Text style={styles.avatarText}>{driverName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2)}</Text>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.driverSmall}>{driverName}</Text>
            {(driverRating || vehicleText) ? (
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                {driverRating ? `★ ${driverRating.toFixed(2)}` : ''}{driverRating && vehicleText ? ' · ' : ''}{vehicleText}
              </Text>
            ) : null}
          </View>
          {driverId && <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />}
        </TouchableOpacity>
      )}
      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {isDriverCompleted ? (
          <>
            <TouchableOpacity
              style={[styles.actionBtnPrimary, { flex: 2, backgroundColor: colors.textPrimary }, confirming && { opacity: 0.6 }]}
              disabled={confirming}
              activeOpacity={0.8}
              onPress={async () => {
                if (!confirmedRideId) return;
                setConfirming(true);
                const completed = await riderCompleteRide(confirmedRideId);
                setConfirming(false);
                if (completed) await openRiderRatingIfNeeded(confirmedRideId);
              }}
            >
              {confirming
                ? <ActivityIndicator size="small" color={colors.textInverse} />
                : <Text style={styles.actionBtnPrimaryText}>Confirm Arrival</Text>}
            </TouchableOpacity>
          </>
        ) : isInProgress ? (
          <>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' }]}
              onPress={shareTrip}
              disabled={sharing}
              activeOpacity={0.75}
            >
              <Ionicons name="share-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.actionBtnSecondaryText}>Share Trip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' }]}
              onPress={() => setReportVisible(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="alert-circle-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.actionBtnSecondaryText}>Report</Text>
            </TouchableOpacity>
          </>
        ) : isConfirmed ? (
          <>
            <TouchableOpacity style={styles.actionBtnSecondary} onPress={openChat} activeOpacity={0.75}>
              <Text style={styles.actionBtnSecondaryText}>Message Driver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1 }]}
              onPress={() => router.push({ pathname: '/(rider)/ride/[id]', params: { id: request.id, returnTo: '/(rider)' } } as any)}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>View Details</Text>
            </TouchableOpacity>
            {/* Driver no-show — visible 30 min after scheduled departure */}
            {(() => {
              const rideDate = request.date || '';
              const rideTime = request.time || '';
              if (!rideDate || !rideTime) return null;
              const [h = 0, m = 0] = rideTime.split(':').map(Number);
              const scheduled = new Date(`${rideDate}T00:00:00`);
              scheduled.setHours(h, m, 0, 0);
              const gracePassed = Date.now() > scheduled.getTime() + 30 * 60 * 1000;
              if (!gracePassed || !confirmedRideId) return null;
              return (
                <TouchableOpacity
                  style={[styles.actionBtnSecondary, { flex: 1, borderColor: colors.red }]}
                  onPress={() => Alert.alert(
                    'Driver no-show?',
                    'Report that your driver did not show up after 30 minutes. You will receive a full refund.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Report no-show', style: 'destructive', onPress: async () => {
                        try {
                          const { getApiBaseUrl } = await import('@/constants/services');
                          const token = await firebaseAuth.currentUser?.getIdToken();
                          const res = await fetch(`${getApiBaseUrl()}/api/rides/${confirmedRideId}/driver-no-show`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                          });
                          const json = await res.json();
                          if (!res.ok) throw new Error(json?.error || 'Failed');
                          Alert.alert('Reported', 'No-show reported. A full refund will be issued to your account.');
                        } catch (e: any) {
                          Alert.alert('Error', e?.message || 'Could not report no-show. Please try again.');
                        }
                      }},
                    ]
                  )}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.actionBtnSecondaryText, { color: colors.red }]}>Didn't show?</Text>
                </TouchableOpacity>
              );
            })()}
          </>
        ) : hasOffer ? (
          <>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => router.push('/(rider)/requests' as any)}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>View Offers</Text>
            </TouchableOpacity>
            {(offerInfo?.offerCount ?? 1) > 1 ? (
              // Multiple offers — send rider to choose rather than accepting an arbitrary one
              <TouchableOpacity
                style={styles.actionBtnPrimary}
                onPress={() => router.push('/(rider)/requests' as any)}
                activeOpacity={0.8}
              >
                <Text style={styles.actionBtnPrimaryText}>Choose ({offerInfo!.offerCount})</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtnPrimary, acting && { opacity: 0.6 }]}
                onPress={handleAccept}
                disabled={acting}
                activeOpacity={0.8}
              >
                <Text style={styles.actionBtnPrimaryText}>{acting ? 'Accepting…' : 'Accept'}</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtnCancel, acting && { opacity: 0.6 }]}
            onPress={handleCancel}
            disabled={acting}
            activeOpacity={0.8}
          >
            <Text style={styles.actionBtnCancelText}>{acting ? 'Cancelling…' : 'Cancel Request'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {confirmedRideId && (
        <ReportIssueModal
          visible={reportVisible}
          onClose={() => setReportVisible(false)}
          confirmedRideId={confirmedRideId}
          reportedDuringRide={isInProgress}
        />
      )}

      {/* Payment authorization for offer acceptance — must be authorized before confirming with driver */}
      <PaymentModal
        visible={offerPaymentVisible}
        onClose={() => setOfferPaymentVisible(false)}
        rideId={offerInfo?.offerId || request.id}
        driverId={offerInfo?.driverId || null}
        baseFare={offerInfo?.offerPrice ?? price}
        onPaymentSuccess={handleOfferPaymentSuccess}
      />
    </View>
  );
}

type RideAgainRoute = {
  key: string;
  from: string;
  to: string;
  meta: string;
  price?: number | null;
  updatedAt: number;
};

function routeText(value: any): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const candidate = value.address || value.description || value.name || value.formattedAddress || value.fullAddress;
    return typeof candidate === 'string' ? candidate.trim() : '';
  }
  return '';
}

function routeTimestamp(value: any): number {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function routePrice(data: any): number | null {
  const raw = data?.contributionAmount ?? data?.estimatedFare ?? data?.maxPrice ?? data?.price ?? data?.pricePerSeat ?? data?.paymentAmount;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function makeRideAgainRoute(id: string, data: any, source: string): RideAgainRoute | null {
  const from = routeText(data?.pickup) || routeText(data?.pickupAddress) || routeText(data?.from) || routeText(data?.origin) || routeText(data?.originalRideRequest?.pickup) || routeText(data?.originalRidePosting?.pickup);
  const to = routeText(data?.dropoff) || routeText(data?.dropoffAddress) || routeText(data?.to) || routeText(data?.destination) || routeText(data?.originalRideRequest?.dropoff) || routeText(data?.originalRidePosting?.dropoff);
  if (!from || !to) return null;
  const updatedAt = routeTimestamp(data?.completedAt || data?.updatedAt || data?.createdAt || data?.confirmedAt || data?.date) || Date.now();
  return {
    key: `${source}:${id}`,
    from,
    to,
    meta: source === 'completed' ? 'Completed before' : 'Recently requested',
    price: routePrice(data),
    updatedAt,
  };
}

function RideAgainSection() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const uid = firebaseAuth.currentUser?.uid;
  const [routes, setRoutes] = useState<RideAgainRoute[]>([]);

  useEffect(() => {
    if (!uid) {
      setRoutes([]);
      return undefined;
    }

    const byKey = new Map<string, RideAgainRoute>();
    const snapshots: Record<string, RideAgainRoute[]> = { requests: [], requestsByUser: [], postingRequests: [], postingRequestsByUser: [], completed: [] };
    const emit = () => {
      byKey.clear();
      [...snapshots.requests, ...snapshots.requestsByUser, ...snapshots.postingRequests, ...snapshots.postingRequestsByUser, ...snapshots.completed]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .forEach((route) => {
          const routeKey = `${route.from.toLowerCase()}::${route.to.toLowerCase()}`;
          if (!byKey.has(routeKey)) byKey.set(routeKey, route);
        });
      setRoutes(Array.from(byKey.values()).slice(0, 3));
    };

    const unsubs = [
      onSnapshot(query(collection(firestore, 'rideRequests'), where('riderId', '==', uid)), (snap) => {
        snapshots.requests = snap.docs.map((d) => makeRideAgainRoute(d.id, d.data(), 'requested')).filter((route): route is RideAgainRoute => !!route);
        emit();
      }, (error) => {
        snapshots.requests = [];
        emit();
        console.warn('[RideAgainSection] rideRequests riderId listener error:', error);
      }),
      onSnapshot(query(collection(firestore, 'rideRequests'), where('userId', '==', uid)), (snap) => {
        snapshots.requestsByUser = snap.docs.map((d) => makeRideAgainRoute(d.id, d.data(), 'requested')).filter((route): route is RideAgainRoute => !!route);
        emit();
      }, (error) => {
        snapshots.requestsByUser = [];
        emit();
        console.warn('[RideAgainSection] rideRequests userId listener error:', error);
      }),
      onSnapshot(query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', uid)), (snap) => {
        snapshots.postingRequests = snap.docs.map((d) => makeRideAgainRoute(d.id, d.data(), 'requested')).filter((route): route is RideAgainRoute => !!route);
        emit();
      }, (error) => {
        snapshots.postingRequests = [];
        emit();
        console.warn('[RideAgainSection] ridePostingRequests riderId listener error:', error);
      }),
      onSnapshot(query(collection(firestore, 'ridePostingRequests'), where('userId', '==', uid)), (snap) => {
        snapshots.postingRequestsByUser = snap.docs.map((d) => makeRideAgainRoute(d.id, d.data(), 'requested')).filter((route): route is RideAgainRoute => !!route);
        emit();
      }, (error) => {
        snapshots.postingRequestsByUser = [];
        emit();
        console.warn('[RideAgainSection] ridePostingRequests userId listener error:', error);
      }),
      onSnapshot(query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid)), (snap) => {
        snapshots.completed = snap.docs
          .filter((d) => String((d.data() as any).status || '').replace(/[-\s]/g, '_').toUpperCase() === 'COMPLETED')
          .map((d) => makeRideAgainRoute(d.id, d.data(), 'completed'))
          .filter((route): route is RideAgainRoute => !!route);
        emit();
      }, (error) => {
        snapshots.completed = [];
        emit();
        console.warn('[RideAgainSection] confirmedRides listener error:', error);
      }),
    ];

    return () => unsubs.forEach((unsub) => unsub());
  }, [uid]);

  if (!routes.length) {
    return (
      <View style={styles.homeSection}>
        <SectionHeader title="Start here" action="Browse" />
        <View style={styles.popularRouteList}>
          <TouchableOpacity
            style={styles.popularRouteCard}
            onPress={() => router.push('/(rider)/book' as any)}
            accessibilityRole="button"
          >
            <View style={styles.popularRouteIcon}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.popularRouteCopy}>
              <Text style={styles.popularRouteTitle}>Request a ride</Text>
              <Text style={styles.popularRouteMeta}>Post your first route</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.popularRouteCard}
            onPress={() => router.push('/(rider)/available-rides' as any)}
            accessibilityRole="button"
          >
            <View style={styles.popularRouteIcon}>
              <Ionicons name="ticket-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.popularRouteCopy}>
              <Text style={styles.popularRouteTitle}>Browse available rides</Text>
              <Text style={styles.popularRouteMeta}>See what drivers have posted</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.homeSection}>
      <SectionHeader title="Ride again" action="Request" />
      <View style={styles.popularRouteList}>
        {routes.map((route) => (
          <TouchableOpacity
            key={route.key}
            style={styles.popularRouteCard}
            onPress={() => router.push({ pathname: '/(rider)/book', params: { pickup: route.from, dropoff: route.to } } as any)}
            accessibilityRole="button"
          >
            <View style={styles.popularRouteIcon}>
              <Ionicons name="refresh-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.popularRouteCopy}>
              <Text style={styles.popularRouteTitle}>{route.from} {'->'} {route.to}</Text>
              <Text style={styles.popularRouteMeta}>{route.meta}</Text>
            </View>
            {route.price ? <Text style={styles.popularRoutePrice}>${Math.round(route.price)}</Text> : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderRequestReferencePlaceholder() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const riderPageTitleColor = colors.statusBar === 'light-content' ? '#FFFFFF' : colors.textPrimary;
  return (
    <PhoneScreen activeTab="find">
      <View style={styles.pageIntro}>
        <Text style={[styles.pageTitle, { color: riderPageTitleColor }]}>Request a ride</Text>
      </View>
      <Text style={styles.eyebrow}>WHERE & WHEN</Text>
      <View style={styles.searchCard}>
        <View style={styles.routeRow}>
          <RouteDots />
          <View style={styles.routeInputs}>
            <TextInput style={styles.inputPill} defaultValue="Jester West, Austin" />
            <Text style={styles.stopText}>+ stop</Text>
            <TextInput style={styles.inputPill} defaultValue="Galleria, Houston" />
          </View>
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaPill}><Text style={styles.metaText}>Fri, Nov 20</Text></View>
          <View style={styles.metaPill}><Text style={styles.metaText}>3:00 PM +/- 1h</Text></View>
        </View>
      </View>

      <Text style={styles.eyebrow}>CONTRIBUTION AMOUNT</Text>
      <View style={styles.priceBox}>
        <Text style={styles.bigPrice}>$32</Text>
        <Text style={styles.suggested}>SUGGESTED $24-32</Text>
        <View style={styles.slider}><View style={styles.sliderFill} /><View style={styles.sliderThumb} /></View>
      </View>

      <Text style={styles.eyebrow}>PREFERENCES</Text>
      <View style={styles.chipRow}>
        {['UT students only', 'No smoking', 'Trunk space', 'Quiet ride'].map((chip, index) => (
          <View key={chip} style={[styles.chip, (index === 0 || index === 2) && styles.chipActive]}>
            <Text style={[styles.chipText, (index === 0 || index === 2) && styles.chipTextActive]}>{chip}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.eyebrow}>NOTE</Text>
      <TextInput
        style={styles.noteBox}
        multiline
        defaultValue={'One large suitcase + backpack. Can swing 5\nmin for pickup.'}
      />
      <TouchableOpacity style={[styles.primaryBtnFull, styles.requestSubmitButton]}><Text style={styles.primaryText}>{'Post request ->'}</Text></TouchableOpacity>
    </PhoneScreen>
  );
}

export function RiderRequestReference() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const riderPageTitleColor = colors.statusBar === 'light-content' ? '#FFFFFF' : colors.textPrimary;
  const params = useLocalSearchParams<{ pickup?: string; dropoff?: string }>();
  const initialPickup = String(params.pickup || '');
  const [pickup, setPickup] = useState(initialPickup);
  const [dropoff, setDropoff] = useState(String(params.dropoff || ''));
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [price, setPrice] = useState('');
  const [priceEdited, setPriceEdited] = useState(false);
  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [distanceText, setDistanceText] = useState<string | null>(null);
  const [durationText, setDurationText] = useState<string | null>(null);
  const [pickupCoords, setPickupCoords] = useState<Coords | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<Coords | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requestPaymentVisible, setRequestPaymentVisible] = useState(false);
  const pendingRequestDataRef = useRef<any>(null);
  const triedRequestLocationRef = useRef(false);
  const suggestedPrice = distanceMiles && distanceMiles > 0 ? computeRiderSuggestedPrice(distanceMiles, 1) : 0;
  const suggestedText = distanceMiles && distanceMiles > 0 ? formatContributionRange(distanceMiles, 1) : 'Select route to calculate';

  useEffect(() => {
    let cancelled = false;
    if (triedRequestLocationRef.current || pickup.trim()) return;
    triedRequestLocationRef.current = true;
    getCurrentLocationAddressAsync().then((address) => {
      if (!cancelled && address && !pickup.trim()) setPickup(address);
    });
    return () => { cancelled = true; };
  }, [pickup]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!pickup.trim() || !dropoff.trim()) {
        setDistanceMiles(null);
        setDurationMinutes(null);
        setDistanceText(null);
        setDurationText(null);
        return;
      }
      const [pickupGeo, dropoffGeo] = await Promise.all([
        geocodeRiderAddress(pickup),
        geocodeRiderAddress(dropoff),
      ]);
      if (cancelled) return;
      setPickupCoords(pickupGeo);
      setDropoffCoords(dropoffGeo);
      if (!pickupGeo || !dropoffGeo) {
        setDistanceMiles(null);
        setDurationMinutes(null);
        setDistanceText(null);
        setDurationText(null);
        return;
      }
      const metrics = await fetchRiderRouteMetrics(pickupGeo, dropoffGeo);
      if (cancelled) return;
      if (metrics) {
        setDistanceMiles(metrics.distanceMiles);
        setDurationMinutes(metrics.durationMinutes);
        setDistanceText(metrics.distanceText);
        setDurationText(metrics.durationText);
        const nextSuggested = computeRiderSuggestedPrice(metrics.distanceMiles, 1);
        if (!priceEdited && nextSuggested > 0) setPrice(nextSuggested.toFixed(2));
      } else {
        setDistanceMiles(null);
        setDurationMinutes(null);
        setDistanceText(null);
        setDurationText(null);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pickup, dropoff, priceEdited]);

  const submit = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) return Alert.alert('Sign in required', 'Please sign in again.');
    if (!pickup.trim() || !dropoff.trim() || !date.trim()) return Alert.alert('Missing details', 'Add pickup, destination, and date.');
    try {
      // Check both rider and driver docs — dual-role users verified on the driver
      // side should not be blocked on the rider side.
      const [riderDoc, driverDoc] = await Promise.all([
        getDoc(doc(firestore, 'riders', user.uid)),
        getDoc(doc(firestore, 'drivers', user.uid)),
      ]);
      const riderData = riderDoc.exists() ? (riderDoc.data() as any) : null;
      const driverData = driverDoc.exists() ? (driverDoc.data() as any) : null;
      const isVerified =
        riderData?.isVerified === true ||
        driverData?.isVerified === true ||
        ['approved', 'auto-approved'].includes(String(driverData?.verificationStatus || '').toLowerCase()) ||
        ['approved', 'auto-approved'].includes(String(riderData?.verificationStatus || '').toLowerCase());
      const deadline = riderData?.verificationDeadline ?? driverData?.verificationDeadline;
      const isPastDeadline = deadline
        ? new Date() > (typeof deadline?.toDate === 'function' ? deadline.toDate() : new Date(deadline))
        : false;
      if (!isVerified && isPastDeadline) {
        Alert.alert(
          'Verification Required',
          'Your verification deadline has passed. Please verify your student status to post ride requests.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Verify Now', onPress: async () => {
                try {
                  const token = await firebaseAuth.currentUser?.getIdToken();
                  if (token) {
                    const { Linking } = require('react-native');
                    await Linking.openURL(`https://ridealongapp.com/pages/verify?token=${encodeURIComponent(token)}`);
                  }
                } catch {}
              }},
            ]
          );
          return;
        }
    } catch {}
    try {
      setSubmitting(true);
      let submitPickupCoords = pickupCoords;
      let submitDropoffCoords = dropoffCoords;
      if (!submitPickupCoords) {
        submitPickupCoords = await geocodeRiderAddress(pickup);
        if (submitPickupCoords) setPickupCoords(submitPickupCoords);
      }
      if (!submitDropoffCoords) {
        submitDropoffCoords = await geocodeRiderAddress(dropoff);
        if (submitDropoffCoords) setDropoffCoords(submitDropoffCoords);
      }
      let submitDistanceMiles = distanceMiles;
      let submitDurationMinutes = durationMinutes;
      let submitDistanceText = distanceText;
      let submitDurationText = durationText;
      if (submitPickupCoords && submitDropoffCoords && (submitDistanceMiles == null || submitDurationMinutes == null)) {
        const metrics = await fetchRiderRouteMetrics(submitPickupCoords, submitDropoffCoords);
        if (metrics) {
          submitDistanceMiles = metrics.distanceMiles;
          submitDurationMinutes = metrics.durationMinutes;
          submitDistanceText = metrics.distanceText;
          submitDurationText = metrics.durationText;
          setDistanceMiles(metrics.distanceMiles);
          setDurationMinutes(metrics.durationMinutes);
          setDistanceText(metrics.distanceText);
          setDurationText(metrics.durationText);
        }
      }
      const routeSuggestedPrice = submitDistanceMiles && submitDistanceMiles > 0 ? computeRiderSuggestedPrice(submitDistanceMiles, 1) : 0;
      const enteredPrice = Number(String(price).replace(/[^0-9.\-]/g, ''));
      const resolvedPrice = !Number.isNaN(enteredPrice) && enteredPrice > 0 ? enteredPrice : routeSuggestedPrice;
      if (!resolvedPrice || resolvedPrice <= 0) return Alert.alert('Missing price', 'Add a max price or enter a route so we can suggest one.');

      // Prevent duplicate pending requests for the same route + date
      try {
        const dupSnap = await getDocs(
          query(
            collection(firestore, 'rideRequests'),
            where('riderId', '==', user.uid),
            where('status', '==', 'pending'),
          )
        );
        const isDuplicate = dupSnap.docs.some((d) => {
          const r = d.data() as any;
          return (
            String(r.pickup || r.pickupAddress || '').trim().toLowerCase() === pickup.trim().toLowerCase() &&
            String(r.dropoff || r.dropoffAddress || '').trim().toLowerCase() === dropoff.trim().toLowerCase() &&
            String(r.date || '').trim() === date.trim()
          );
        });
        if (isDuplicate) {
          Alert.alert(
            'Request already pending',
            'You already have a pending request for this route and date.',
            [{ text: 'OK' }]
          );
          return;
        }
      } catch {}

      // Store the resolved data and open the payment modal.
      // The Firestore doc is created only after payment is authorized.
      pendingRequestDataRef.current = {
        riderId: user.uid,
        riderEmail: user.email || null,
        pickup: pickup.trim(),
        pickupAddress: pickup.trim(),
        dropoff: dropoff.trim(),
        dropoffAddress: dropoff.trim(),
        pickupCoords: submitPickupCoords || null,
        dropoffCoords: submitDropoffCoords || null,
        pickupLat: submitPickupCoords?.lat ?? null,
        pickupLng: submitPickupCoords?.lng ?? null,
        dropoffLat: submitDropoffCoords?.lat ?? null,
        dropoffLng: submitDropoffCoords?.lng ?? null,
        date: date.trim(),
        time: time.trim() || null,
        seats: 1,
        maxPrice: resolvedPrice,
        estimatedFare: resolvedPrice,
        contributionAmount: resolvedPrice,
        rideType: submitDistanceMiles && submitDistanceMiles > 0 ? getRideType(submitDistanceMiles) : null,
        distance: (submitDistanceText || submitDistanceMiles != null) ? {
          text: submitDistanceText || null,
          miles: submitDistanceMiles != null ? Number(submitDistanceMiles.toFixed(3)) : null,
          meters: submitDistanceMiles != null ? Math.round(submitDistanceMiles * 1609.34) : null,
        } : null,
        duration: (submitDurationText || submitDurationMinutes != null) ? {
          text: submitDurationText || null,
          minutes: submitDurationMinutes != null ? Number(submitDurationMinutes.toFixed(3)) : null,
          seconds: submitDurationMinutes != null ? Math.round(submitDurationMinutes * 60) : null,
        } : null,
        notes: notes.trim(),
        resolvedPrice,
      };
      setRequestPaymentVisible(true);
    } catch (error: any) {
      Alert.alert('Could not post request', error?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestPaymentSuccess = async (paymentIntentId: string) => {
    setRequestPaymentVisible(false);
    const data = pendingRequestDataRef.current;
    if (!data) return;
    pendingRequestDataRef.current = null;
    try {
      await addDoc(collection(firestore, 'rideRequests'), {
        ...data,
        paymentIntentId,
        paymentStatus: 'authorized',
        status: 'pending',
        state: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Request posted', 'Drivers can now send you offers.');
      router.navigate('/(rider)/requests' as any);
    } catch (error: any) {
      // Payment was authorized but doc creation failed — void the hold.
      try {
        const { cancelRidePayment } = await import('@/services/payments');
        await cancelRidePayment({ paymentIntentId, rideId: paymentIntentId });
      } catch {}
      Alert.alert('Could not post request', 'Your payment was not charged. Please try again.');
    }
  };

  return (
    <PhoneScreen activeTab="find">
      <View style={styles.pageIntro}>
        <Text style={[styles.pageTitle, { color: riderPageTitleColor }]}>Request a ride</Text>
      </View>
      <Text style={styles.eyebrow}>WHERE & WHEN</Text>
      <View style={[styles.searchCard, styles.autocompleteSearchCard]}>
        <View style={styles.routeRow}>
          <RouteDots />
          <View style={styles.routeInputs}>
            <CityAutocomplete
              value={pickup}
              onChangeText={setPickup}
              onSelected={setPickup}
              placeholder="Pickup location"
              apiKey={GOOGLE_MAPS_API_KEY}
              containerStyle={styles.autocompleteField}
              inputStyle={styles.inputPill}
              zIndex={80}
            />
            <CityAutocomplete
              value={dropoff}
              onChangeText={setDropoff}
              onSelected={setDropoff}
              placeholder="Destination"
              apiKey={GOOGLE_MAPS_API_KEY}
              containerStyle={styles.autocompleteField}
              inputStyle={styles.inputPill}
              zIndex={70}
            />
          </View>
        </View>
        <View style={styles.metaRow}>
          <TouchableOpacity style={styles.metaPill} onPress={() => setDateModalOpen(true)} activeOpacity={0.78} accessibilityRole="button">
            <Text style={[styles.metaText, !date && styles.metaPlaceholderText]}>{date ? formatDateLabel(date) : 'Fri, Nov 20'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.metaPill} onPress={() => setTimeModalOpen(true)} activeOpacity={0.78} accessibilityRole="button">
            <Text style={[styles.metaText, !time && styles.metaPlaceholderText]}>{time || 'Anytime'}</Text>
          </TouchableOpacity>
          <DatePickerModal visible={dateModalOpen} selectedDate={date} onClose={() => setDateModalOpen(false)} onSelect={setDate} />
          <TimePickerModal visible={timeModalOpen} selectedTime={time} onClose={() => setTimeModalOpen(false)} onSelect={setTime} />
        </View>
      </View>
      <Text style={styles.eyebrow}>CONTRIBUTION AMOUNT</Text>
      <View style={styles.priceBox}>
        <View style={styles.priceInputGroup}>
          <Text style={styles.bigPrice}>$</Text>
          <TextInput
            style={styles.priceInput}
            value={price}
            onChangeText={(value) => {
              setPriceEdited(true);
              setPrice(value.replace(/[^0-9.]/g, ''));
            }}
            keyboardType="decimal-pad"
            placeholder={suggestedPrice > 0 ? suggestedPrice.toFixed(2) : '0.00'}
            placeholderTextColor={colors.textSecondary}
          />
        </View>
        <View style={styles.requestSuggestedWrap}>
          <Text style={styles.requestSuggestedLabel}>MIN / MAX</Text>
          <Text style={styles.requestSuggestedText}>{suggestedText}</Text>
        </View>
      </View>
      <Text style={styles.eyebrow}>NOTE</Text>
      <TextInput style={styles.noteBox} multiline value={notes} onChangeText={setNotes} placeholder="Luggage, pickup flexibility, or anything drivers should know" placeholderTextColor={colors.textSecondary} />
      <TouchableOpacity disabled={submitting} style={[styles.primaryBtnFull, styles.requestSubmitButton]} onPress={submit}><Text style={styles.primaryText}>{submitting ? 'Posting...' : 'Post request ->'}</Text></TouchableOpacity>
      <PaymentModal
        visible={requestPaymentVisible}
        onClose={() => { setRequestPaymentVisible(false); pendingRequestDataRef.current = null; }}
        rideId={`req_${firebaseAuth.currentUser?.uid ?? 'anon'}_${Date.now()}`}
        driverId={null}
        baseFare={pendingRequestDataRef.current?.resolvedPrice ?? 0}
        onPaymentSuccess={handleRequestPaymentSuccess}
      />
    </PhoneScreen>
  );
}

const rides = [
  ['Jordan T.', '★ 4.94 · 21 Civic · 3 seats', '$28', '3:00 PM', 'JT'],
  ['Sara A.', '★ 4.89 · 19 Mazda 3 · 2 seats', '$26', '4:15 PM', 'SA'],
  ['Devin K.', '★ 5.00 · 23 Tesla 3 · 2 seats', '$34', '6:30 PM', 'DK'],
  ['Lia P.', '★ 4.78 · 18 Outback · 4 seats', '$22', 'Sat · 9:00 AM', 'LP'],
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderAvailableReferencePlaceholder() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const riderPageTitleColor = colors.statusBar === 'light-content' ? '#FFFFFF' : colors.textPrimary;
  return (
    <PhoneScreen activeTab="rides">
      <View style={styles.pageIntro}>
        <Text style={[styles.pageTitle, { color: riderPageTitleColor }]}>Available rides</Text>
      </View>
      <View style={styles.findSearch}>
        <Ionicons name="search" size={18} color={colors.textPrimary} />
        <View style={{ flex: 1 }}><Text style={styles.findSearchLabel}>YOUR ROUTE</Text><Text style={styles.findSearchText}>{'Austin -> Houston · Fri, Nov 20'}</Text></View>
        <Ionicons name="options-outline" size={19} color={colors.textPrimary} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {['ALL\n12', 'Morning', 'Afternoon', 'Evening', '★\n4.8+'].map((filter, index) => (
          <View key={filter} style={[styles.filterPill, index === 0 && styles.filterActive]}>
            <Text style={[styles.filterText, index === 0 && styles.filterTextActive]}>{filter}</Text>
          </View>
        ))}
      </ScrollView>

      {rides.map(([name, meta, price, time, initials]) => (
        <TouchableOpacity key={name} style={styles.availableCard} onPress={() => router.push('/(rider)/available-rides' as any)}>
          <View style={styles.availableTop}>
            <View style={styles.navyDot} />
            <Text style={styles.availableRoute}>{'Austin -> Houston'}</Text>
            <Text style={styles.availableTime}>Fri · {time}</Text>
          </View>
          <View style={styles.availableDash} />
          <View style={styles.availableBottom}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.driverName}>{name}</Text>
              <Text style={styles.driverMeta}>{meta}</Text>
            </View>
            <Text style={styles.availablePrice}>{price}</Text>
          </View>
        </TouchableOpacity>
      ))}
    </PhoneScreen>
  );
}

type TimeFilter = RiderRideFilter;

export function RiderAvailableReference() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const riderPageTitleColor = colors.statusBar === 'light-content' ? '#FFFFFF' : colors.textPrimary;
  const { from, to } = useLocalSearchParams<{ from?: string; to?: string }>();
  const uid = firebaseAuth.currentUser?.uid;
  const [liveRides, setLiveRides] = useState<MobileRidePosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRequestedPostingIds, setMyRequestedPostingIds] = useState<Set<string>>(new Set());
  const searchQuery = useRideBrowseStore((state) => state.riderSearch);
  const timeFilter = useRideBrowseStore((state) => state.riderFilter);
  const setSearchQuery = useRideBrowseStore((state) => state.setRiderSearch);
  const setTimeFilter = useRideBrowseStore((state) => state.setRiderFilter);
  const [filterOptions, setFilterOptions] = useState<RideFilterOptions>(getDefaultFilters());
  const [showFilterModal, setShowFilterModal] = useState(false);

  useEffect(() => {
    const routeSearch = [from, to]
      .map((value) => Array.isArray(value) ? value[0] : value)
      .filter(Boolean)
      .join(' ')
      .trim();
    if (routeSearch && !useRideBrowseStore.getState().riderSearch) setSearchQuery(routeSearch);
  }, [from, to, setSearchQuery]);

  useEffect(() => subscribeAvailableRides((items) => { setLiveRides(items); setLoading(false); }, () => setLoading(false)), []);

  // Track which posting IDs this rider has already requested (so we can hide them)
  useEffect(() => {
    if (!uid) return undefined;
    const inactive = new Set(['cancelled', 'canceled', 'rejected', 'declined', 'completed', 'expired']);
    const buckets = new Map<string, Set<string>>();
    const applySnapshot = (key: string, snap: any) => {
      const ids = new Set<string>();
      snap.forEach((d) => {
        const r = d.data() as any;
        const status = String(r.status || r.state || 'pending').replace(/[-\s]+/g, '_').toLowerCase();
        if (inactive.has(status)) return;
        const postingId = String(r.ridePostingId || r.postingId || r.rideId || '');
        if (postingId) ids.add(postingId);
      });
      buckets.set(key, ids);
      const merged = new Set<string>();
      buckets.forEach((bucket) => bucket.forEach((id) => merged.add(id)));
      setMyRequestedPostingIds(merged);
    };
    const unsubRider = onSnapshot(
      query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', uid)),
      (snap) => applySnapshot('riderId', snap),
      (error) => {
        buckets.delete('riderId');
        setMyRequestedPostingIds(new Set(Array.from(buckets.values()).flatMap((bucket) => Array.from(bucket))));
        console.warn('[RiderAvailableReference] requested postings riderId listener error:', error);
      },
    );
    const unsubUser = onSnapshot(
      query(collection(firestore, 'ridePostingRequests'), where('userId', '==', uid)),
      (snap) => applySnapshot('userId', snap),
      (error) => {
        buckets.delete('userId');
        setMyRequestedPostingIds(new Set(Array.from(buckets.values()).flatMap((bucket) => Array.from(bucket))));
        console.warn('[RiderAvailableReference] requested postings userId listener error:', error);
      },
    );
    return () => {
      unsubRider();
      unsubUser();
    };
  }, [uid]);

  const shareRide = async (ride: MobileRidePosting) => {
    const parts = [
      `Available ride on RideAlong!`,
      ride.driverName ? `Driver: ${ride.driverName}` : null,
      `From: ${ride.from}`,
      `To: ${ride.to}`,
      ride.date ? `Date: ${ride.date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : null,
      `Price: $${Math.round(ride.price)} per seat`,
    ].filter(Boolean).join('\n');
    await Share.share({ message: parts }).catch(() => {});
  };

  const visibleRidePool = useMemo(
    () => liveRides.filter((ride) => !myRequestedPostingIds.has(ride.id)),
    [liveRides, myRequestedPostingIds],
  );

  const filteredRides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let result = visibleRidePool.filter((ride) => {
      if (q) {
        const searchable = [ride.driverName, ride.from, ride.to, ride.vehicle].join(' ').toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      if (timeFilter === 'rating') return (ride.driverRating ?? 0) >= 4.8;
      if (timeFilter !== 'all' && ride.date) {
        const hour = ride.date.getHours();
        if (timeFilter === 'morning' && hour >= 12) return false;
        if (timeFilter === 'afternoon' && (hour < 12 || hour >= 17)) return false;
        if (timeFilter === 'evening' && hour < 17) return false;
      }
      return true;
    });
    result = result.filter((ride) => applyFiltersToRide(ride, filterOptions, true));
    return result;
  }, [visibleRidePool, searchQuery, timeFilter, filterOptions]);

  const formatRideTime = (date: Date | null | undefined) => {
    if (!date) return '';
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow =
      date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() &&
      date.getDate() === tomorrow.getDate();
    if (isToday) return `Today · ${time}`;
    if (isTomorrow) return `Tomorrow · ${time}`;
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${time}`;
  };

  const chips: { key: TimeFilter; label: string }[] = [
    { key: 'all', label: `ALL\n${visibleRidePool.length}` },
    { key: 'morning', label: 'Morning' },
    { key: 'afternoon', label: 'Afternoon' },
    { key: 'evening', label: 'Evening' },
    { key: 'rating', label: '★\n4.8+' },
  ];

  return (
    <PhoneScreen activeTab="rides">
      <View style={styles.pageIntro}>
        <Text style={[styles.pageTitle, { color: riderPageTitleColor }]}>Available rides</Text>
      </View>

      <View style={styles.findSearch}>
        <Ionicons name="search" size={18} color={colors.textPrimary} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by driver, city..."
          placeholderTextColor={colors.textSecondary}
          style={styles.availableSearchInput}
          returnKeyType="search"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={hitSlop}>
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.availableFilterBtn} onPress={() => setShowFilterModal(true)} activeOpacity={0.7}>
          <Ionicons name="options-outline" size={19} color={hasActiveFilters(filterOptions) ? colors.primary : colors.textPrimary} />
          {hasActiveFilters(filterOptions) && <View style={styles.availableFilterDot} />}
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {chips.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTimeFilter(key)}
            style={[styles.filterPill, timeFilter === key && styles.filterActive]}
            accessibilityRole="button"
          >
            <Text style={[styles.filterText, timeFilter === key && styles.filterTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={{ minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Loading rides…</Text>
        </View>
      ) : null}

      {!loading && filteredRides.map((ride) => {
        const isBooked = myRequestedPostingIds.has(ride.id);
        const initials = ride.driverName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2);
        const meta = [
          ride.driverRating ? `★ ${ride.driverRating.toFixed(2)}` : null,
          ride.vehicle,
          ride.seats ? `${ride.seats} seats` : null,
        ].filter(Boolean).join(' · ');

        return (
          <TouchableOpacity key={ride.id} style={styles.availableCard} onPress={() => router.push({
            pathname: '/(rider)/ride/[id]',
            params: { id: ride.id, returnTo: '/(rider)/available-rides' },
          } as any)}>
            {/* Date/time — very top of card */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 }}>
              <Text style={{ flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700' }}>{formatRideTime(ride.date) || 'Date TBD'}</Text>
              {ride.isFull && !isBooked && (
                <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: '#DC2626', fontSize: 10, fontWeight: '800' }}>FULL</Text>
                </View>
              )}
              {ride.isRecurring && (
                <View style={{ backgroundColor: colors.primaryDim, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '800' }}>↻ Recurring</Text>
                </View>
              )}
              {isBooked && (
                <View style={{ backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)', paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: '#16a34a', fontSize: 10, fontWeight: '800' }}>Booked</Text>
                </View>
              )}
            </View>
            <View style={styles.availableLocationsBlock}>
              <View style={styles.availableRouteRail}>
                <View style={styles.availablePickupDot} />
                <View style={styles.availableRouteLine} />
                <View style={styles.availableDropoffDot} />
              </View>
              <View style={[styles.availableLocationCopy, { paddingRight: 0 }]}>
                <View style={styles.availableLocationTextWrap}>
                  <Text style={styles.availableRouteLabel}>Pickup</Text>
                  <Text style={styles.availableLocationText} numberOfLines={2}>{ride.from || 'Pickup pending'}</Text>
                </View>
                <View style={styles.availableLocationTextWrap}>
                  <Text style={[styles.availableRouteLabel, styles.availableDropoffLabel]}>Dropoff</Text>
                  <Text style={styles.availableLocationText} numberOfLines={2}>{ride.to || 'Dropoff pending'}</Text>
                </View>
              </View>
            </View>
            <View style={styles.availableDash} />
            <View style={[styles.availableBottom, { paddingTop: 0 }]}>
              <View style={styles.avatar}>{ride.driverAvatarUrl ? <Image source={{ uri: ride.driverAvatarUrl }} style={styles.availableAvatarImage} resizeMode="cover" /> : <Text style={styles.avatarText}>{initials}</Text>}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.driverName}</Text>
                <Text style={styles.driverMeta}>{meta}</Text>
              </View>
              <Text style={styles.availablePrice}>${Math.round(ride.price)}</Text>
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); shareRide(ride); }}
                style={{ padding: 6, marginLeft: 4 }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        );
      })}

      {!loading && !filteredRides.length ? (
        <View style={styles.availableEmptyState}>
          <View style={styles.availableEmptyIcon}><Ionicons name="car-outline" size={27} color={colors.primary} /></View>
          <Text style={styles.availableEmptyTitle}>{visibleRidePool.length ? 'No rides match' : 'No rides posted yet'}</Text>
          <Text style={styles.availableEmptyText}>
            {visibleRidePool.length
              ? 'Try a different search or clear the filters.'
              : 'Request your trip and let nearby drivers send you an offer.'}
          </Text>
          <TouchableOpacity
            style={styles.availableEmptyPrimary}
            onPress={() => visibleRidePool.length ? (setSearchQuery(''), setTimeFilter('all'), setFilterOptions(getDefaultFilters())) : router.push('/(rider)/book')}
            accessibilityRole="button"
          >
            <Ionicons name={visibleRidePool.length ? 'refresh-outline' : 'add-circle-outline'} size={18} color="#FFFFFF" />
            <Text style={styles.availableEmptyPrimaryText}>{visibleRidePool.length ? 'Clear filters' : 'Request a ride'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <RideFiltersModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={(f) => { setFilterOptions(f); setShowFilterModal(false); }}
        initialFilters={filterOptions}
        showSeatsFilter={true}
      />
    </PhoneScreen>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderDetailReferencePlaceholder() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  return (
    <PhoneScreen
      title="Ride Details"
      showBack
      bottomAction={<TouchableOpacity style={styles.primaryBtnFull} onPress={() => router.push('/(rider)/booking-confirmed' as any)}><Text style={styles.primaryText}>Book seat - $29.50</Text></TouchableOpacity>}
    >
      <View style={styles.detailCard}>
        <View style={styles.detailDriver}>
          <View style={[styles.avatar, styles.avatarLarge]}><Text style={styles.avatarTextLarge}>JT</Text></View>
          <View>
            <Text style={styles.detailName}>Jordan T.</Text>
            <Text style={styles.detailMeta}>{"★ 4.94 · 47 rides · UT Austin '25"}</Text>
          </View>
        </View>
        <View style={styles.detailRoute}>
          <RouteDots compact />
          <View style={{ flex: 1 }}>
            <Text style={styles.ridePlace}>Austin, TX <Text style={styles.detailTime}>FRI · 3:00 PM</Text></Text>
            <Text style={styles.rideMeta}>165 mi · ~2h 40m</Text>
            <Text style={styles.ridePlace}>Houston, TX <Text style={styles.detailTime}>FRI · 5:40 PM</Text></Text>
          </View>
        </View>
      </View>

      <View style={styles.detailCard}>
        <View style={styles.vehicleIcon}><Ionicons name="car-sport" size={24} color={colors.textSecondary} /></View>
        <View>
          <Text style={styles.vehicleTitle}>2021 Honda Civic</Text>
          <Text style={styles.driverMeta}>Silver · TX 8RZP-129</Text>
          <View style={styles.chipRowSmall}>
            {['A/C', 'USB', 'Bags ok'].map((chip) => <Text key={chip} style={styles.miniChip}>{chip}</Text>)}
          </View>
        </View>
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.eyebrow}>NOTE FROM JORDAN</Text>
        <Text style={styles.noteText}>{'"Heading home for the weekend. Pickup near Jester West, will swing past Mueller. Aux is open 🎵"'}</Text>
      </View>

      <View style={styles.detailCard}>
        <View style={styles.fareRow}><Text style={styles.fareLabel}>Seat fare</Text><Text style={styles.fareValue}>$28.00</Text></View>
        <View style={styles.fareRow}><Text style={styles.fareLabel}>Service fee</Text><Text style={styles.fareValue}>$1.50</Text></View>
        <View style={styles.fareDash} />
        <View style={styles.fareRow}><Text style={styles.fareLabel}>You pay</Text><Text style={styles.fareTotal}>$29.50</Text></View>
      </View>
    </PhoneScreen>
  );
}

export function RiderDetailReference() {
  const styles = useRiderStyles();
  const { colors } = useAppTheme();
  const { id, returnTo } = useLocalSearchParams<{ id?: string; returnTo?: string | string[] }>();
  const rideId = Array.isArray(id) ? id[0] : id;
  const returnTarget = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const goBackFromDetails = () => router.navigate((returnTarget || '/(rider)/available-rides') as any);
  const [ride, setRide] = useState<MobileRidePosting | null>(null);
  const [confirmedRequest, setConfirmedRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [postingVehicleImageUrl, setPostingVehicleImageUrl] = useState<string | null>(null);
  const [scheduleInstances, setScheduleInstances] = useState<{ id: string; date: Date }[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [myWaitlistEntry, setMyWaitlistEntry] = useState<import('@/src/services/waitlistService').WaitlistEntry | null>(null);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);

  const handleRequestSeat = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in again.');
      return;
    }
    try {
      setCheckingVerification(true);
      const [riderDoc2, driverDoc2] = await Promise.all([
        getDoc(doc(firestore, 'riders', user.uid)),
        getDoc(doc(firestore, 'drivers', user.uid)),
      ]);
      const riderData2 = riderDoc2.exists() ? (riderDoc2.data() as any) : null;
      const driverData2 = driverDoc2.exists() ? (driverDoc2.data() as any) : null;
      const isVerified2 =
        riderData2?.isVerified === true ||
        driverData2?.isVerified === true ||
        ['approved', 'auto-approved'].includes(String(driverData2?.verificationStatus || '').toLowerCase()) ||
        ['approved', 'auto-approved'].includes(String(riderData2?.verificationStatus || '').toLowerCase());
      const deadline2 = riderData2?.verificationDeadline ?? driverData2?.verificationDeadline;
      const isPastDeadline2 = deadline2
        ? new Date() > (typeof deadline2?.toDate === 'function' ? deadline2.toDate() : new Date(deadline2))
        : false;
      if (!isVerified2 && isPastDeadline2) {
        Alert.alert(
          'Verification Required',
          'Your verification deadline has passed. Please verify your student status to book rides.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Verify Now', onPress: async () => {
                try {
                  const token = await firebaseAuth.currentUser?.getIdToken();
                  if (token) {
                    const { Linking } = require('react-native');
                    await Linking.openURL(`https://ridealongapp.com/pages/verify?token=${encodeURIComponent(token)}`);
                  }
                } catch {}
              }},
            ]
          );
          return;
        }

      // Guard: ensure rider has at least one saved payment method
      const { listPaymentMethods } = await import('@/services/payments');
      const methods = await listPaymentMethods(user.uid).catch(() => [] as any[]);
      if (!methods || methods.length === 0) {
        Alert.alert(
          'No payment method',
          'Add a card before booking a ride.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add card',
              onPress: () => router.push('/(rider)/settings/payment-methods' as any),
            },
          ],
        );
        return;
      }
    } catch {} finally {
      setCheckingVerification(false);
    }
    setPaymentVisible(true);
  };

  const rawText = (value: any): string => {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object') {
      const candidate =
        value.address ||
        value.formattedAddress ||
        value.formatted_address ||
        value.fullAddress ||
        value.full_address ||
        value.description ||
        value.name ||
        value.location?.address ||
        value.place?.address;
      return typeof candidate === 'string' ? candidate.trim() : '';
    }
    return '';
  };

  const vehicleImageFrom = useCallback(function resolveVehicleImageFrom(...values: any[]): string | null {
    for (const value of values) {
      if (!value) continue;
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        const nested = resolveVehicleImageFrom(...value);
        if (nested) return nested;
        continue;
      }
      if (typeof value === 'object') {
        const nested = resolveVehicleImageFrom(
          value.imageUrl,
          value.vehicleImageUrl,
          value.photoUrl,
          value.photoURL,
          value.url,
          value.uri,
          value.downloadUrl,
          value.downloadURL,
          value.imageList,
          value.images,
        );
        if (nested) return nested;
      }
    }
    return null;
  }, []);

  const detailAddress = (kind: 'pickup' | 'dropoff') => {
    const raw = ride?.raw || {};
    if (kind === 'pickup') {
      return rawText(ride?.from)
        || rawText(raw.pickup)
        || rawText(raw.pickupAddress)
        || rawText(raw.pickupLocation)
        || rawText(raw.pickupGeo)
        || rawText(raw.from)
        || rawText(raw.origin)
        || 'Pickup pending';
    }
    return rawText(ride?.to)
      || rawText(raw.dropoff)
      || rawText(raw.dropoffAddress)
      || rawText(raw.destinationAddress)
      || rawText(raw.toAddress)
      || rawText(raw.dropoffLocation)
      || rawText(raw.dropoffGeo)
      || rawText(raw.dropoffCoords)
      || rawText(raw.destinationLocation)
      || rawText(raw.destinationGeo)
      || rawText(raw.destinationCoords)
      || rawText(raw.arrival)
      || rawText(raw.destination)
      || rawText(raw.to)
      || 'Dropoff pending';
  };

  useEffect(() => {
    if (!rideId) { setLoading(false); return; }
    (async () => {
      try {
        const posting = await getRidePosting(rideId);
        if (posting) { setRide(posting); return; }
        // Fall back: treat rideId as a rideRequests doc
        const { getDoc: gd, doc: dc, collection: col, query: q, where: wh, getDocs: gds } = await import('firebase/firestore');
        const { firestore: db } = await import('@/constants/services');
        const confirmedDirectSnap = await gd(dc(db, 'confirmedRides', rideId));
        if (confirmedDirectSnap.exists()) {
          const confirmedData = confirmedDirectSnap.data() as any;
          const requestId = confirmedData.rideRequestId || confirmedData.requestId || null;
          let reqData = confirmedData;
          if (requestId) {
            const linkedReqSnap = await gd(dc(db, 'rideRequests', String(requestId))).catch(() => null);
            if (linkedReqSnap?.exists()) reqData = { ...linkedReqSnap.data(), ...confirmedData };
          }
          const driverId = confirmedData?.driverId || reqData.confirmedDriver || reqData.driverId;
          let driverData: any = null;
          if (driverId) {
            const driverSnap = await gd(dc(db, 'drivers', driverId));
            if (driverSnap.exists()) driverData = driverSnap.data();
          }
          setConfirmedRequest({ req: { ...reqData, id: requestId || rideId }, confirmed: confirmedData, driver: driverData, driverId, confirmedRideId: rideId });
          return;
        }
        const reqSnap = await gd(dc(db, 'rideRequests', rideId));
        if (!reqSnap.exists()) return;
        const reqData = reqSnap.data() as any;
        // Also try to get confirmed ride doc for driver info
        const confirmedSnap = await gds(q(col(db, 'confirmedRides'), wh('rideRequestId', '==', rideId)));
        const confirmedDoc = !confirmedSnap.empty ? confirmedSnap.docs[0] : null;
        const confirmedData = confirmedDoc ? confirmedDoc.data() as any : null;
        // Fetch driver profile if we have driverId
        const driverId = confirmedData?.driverId || reqData.confirmedDriver || reqData.driverId;
        let driverData: any = null;
        if (driverId) {
          const driverSnap = await gd(dc(db, 'drivers', driverId));
          if (driverSnap.exists()) driverData = driverSnap.data();
        }
        setConfirmedRequest({ req: reqData, confirmed: confirmedData, driver: driverData, driverId, confirmedRideId: confirmedDoc?.id || null });
      } catch {}
      finally { setLoading(false); }
    })();
  }, [rideId]);

  // Fetch all future instances of a recurring schedule so rider can pick a date
  useEffect(() => {
    if (!ride?.isRecurring || !ride?.scheduleId) { setScheduleInstances([]); return; }
    setLoadingInstances(true);
    const now = new Date();
    const activeStatuses = new Set(['available', 'open', 'posted', 'active']);
    getDocs(query(
      collection(firestore, 'ridePostings'),
      where('scheduleId', '==', ride.scheduleId),
    )).then((snap) => {
      const instances = snap.docs
        .map((d) => {
          const r = d.data() as any;
          if (!activeStatuses.has(String(r.status || '').toLowerCase())) return null;
          const dateStr = r.date || r.scheduleDate || '';
          const timeStr = r.time || r.departureTime || '';
          const dt = dateStr ? new Date(`${dateStr}T${timeStr || '00:00'}`) : null;
          return dt && !isNaN(dt.getTime()) ? { id: d.id, date: dt } : null;
        })
        .filter((x): x is { id: string; date: Date } => x !== null && x.date > now)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      setScheduleInstances(instances);
    }).catch(() => setScheduleInstances([])).finally(() => setLoadingInstances(false));
  }, [ride?.scheduleId, ride?.isRecurring]);

  const selectInstance = async (instanceId: string) => {
    if (instanceId === ride?.id) return;
    try {
      const { getRidePosting: fetchPosting } = await import('@/src/services/riderData');
      const posting = await fetchPosting(instanceId);
      if (posting) setRide(posting);
    } catch {}
  };

  // Subscribe to my waitlist entry for this ride
  useEffect(() => {
    if (!ride?.id || !ride?.isFull) { setMyWaitlistEntry(null); return; }
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    import('@/src/services/waitlistService').then(({ subscribeMyWaitlistEntry }) => {
      const unsub = subscribeMyWaitlistEntry(ride.id, uid, setMyWaitlistEntry);
      return unsub;
    }).catch(() => {});
  }, [ride?.id, ride?.isFull]);

  const handleJoinWaitlist = async () => {
    if (!ride) return;
    setJoiningWaitlist(true);
    try {
      const { joinWaitlist } = await import('@/src/services/waitlistService');
      const { position } = await joinWaitlist(ride.id);
      Alert.alert('You\'re on the waitlist!', `You're #${position} in line. We'll notify you if a seat opens.`);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not join waitlist. Please try again.');
    } finally {
      setJoiningWaitlist(false);
    }
  };

  const handleLeaveWaitlist = async () => {
    if (!ride) return;
    Alert.alert('Leave waitlist?', 'You\'ll lose your spot.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: async () => {
        try {
          const { leaveWaitlist } = await import('@/src/services/waitlistService');
          await leaveWaitlist(ride.id);
        } catch (e: any) {
          Alert.alert('Error', e?.message || 'Could not leave waitlist.');
        }
      }},
    ]);
  };

  useEffect(() => {
    setPostingVehicleImageUrl(null);
    if (!ride) return;
    const embedded = vehicleImageFrom(
      ride.raw?.vehicleInfo,
      ride.raw?.vehicle,
      ride.raw?.vehicleImageUrl,
      ride.raw?.vehiclePhotoUrl,
      ride.raw?.carImageUrl,
      ride.raw?.imageUrl,
    );
    if (embedded) setPostingVehicleImageUrl(embedded);
    const driverId = ride.driverId || rawText(ride.raw?.driverId) || rawText(ride.raw?.driverUid) || rawText(ride.raw?.driverUID);
    if (!driverId) return;
    let cancelled = false;
    getDoc(doc(firestore, 'drivers', driverId)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const data = snap.data() as any;
      const imageUrl = vehicleImageFrom(
        data.vehicleInfo,
        data.vehicle,
        data.vehicleImageUrl,
        data.vehiclePhotoUrl,
        data.carImageUrl,
        data.imageUrl,
      );
      if (imageUrl) setPostingVehicleImageUrl(imageUrl);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ride, vehicleImageFrom]);

  if (loading) {
    return <PhoneScreen title="Ride Details" showBack onBack={goBackFromDetails}><ActivityIndicator color={colors.primary} size="large" /></PhoneScreen>;
  }

  // Confirmed request view
  if (confirmedRequest) {
    const { req, driver, driverId } = confirmedRequest;
    const confirmedRideDocId = confirmedRequest.confirmedRideId || null;
    const linkedRideRequestId = req.id || confirmedRequest.confirmed?.rideRequestId || rideId;
    const driverName = driver?.fullName || driver?.name || driver?.displayName || '';
    const driverInitials = driverName.split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
    const driverProfile = driver?.personalInfo || driver?.profile || {};
    const driverAvatarUrl = rawText(driver?.avatarUrl)
      || rawText(driver?.photoURL)
      || rawText(driver?.photoUrl)
      || rawText(driver?.profilePicture)
      || rawText(driverProfile.avatarUrl)
      || rawText(driverProfile.photoURL)
      || rawText(driverProfile.photoUrl)
      || rawText(driverProfile.profilePicture)
      || rawText(driver?.avatarUrl1)
      || null;
    const driverRating = driver?.rating ? Number(driver.rating).toFixed(1) : null;
    const driverVehicleInfo = driver?.vehicleInfo || {};
    const vehicle = [driverVehicleInfo.year || driver?.vehicleYear, driverVehicleInfo.color || driver?.vehicleColor, driverVehicleInfo.make || driver?.vehicleMake, driverVehicleInfo.model || driver?.vehicleModel].filter(Boolean).join(' ')
      || rawText(driver?.vehicle)
      || rawText(confirmedRequest.confirmed?.vehicleInfo)
      || rawText(req.vehicleInfo)
      || '';
    const vehicleImageUrl = vehicleImageFrom(
      driverVehicleInfo,
      driver?.vehicle,
      driver?.vehicleImageUrl,
      driver?.vehiclePhotoUrl,
      driver?.carImageUrl,
      confirmedRequest.confirmed?.vehicleInfo,
      confirmedRequest.confirmed?.vehicleImageUrl,
      req.vehicleInfo,
      req.vehicleImageUrl,
    );
    const pickup = req.pickupAddress || req.pickup || req.from || 'Pickup';
    const dropoff = req.dropoffAddress || req.dropoff || req.to || 'Destination';
    const fare = req.estimatedFare ? `$${Number(req.estimatedFare).toFixed(2)}` : req.maxPrice ? `$${Number(req.maxPrice).toFixed(0)}` : null;
    const rideStatus = String(confirmedRequest.confirmed?.status || req.status || (confirmedRequest.confirmed ? 'CONFIRMED' : 'PENDING')).replace(/[-\s]/g, '_').toUpperCase();
    const hasAssignedDriver = !!confirmedRequest.confirmed || ['CONFIRMED', 'IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED', 'COMPLETED'].includes(rideStatus);
    const hasDriverInfo = hasAssignedDriver && (!!driverId || !!driverName || !!driverAvatarUrl);
    const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
      PENDING: { label: confirmedRequest.confirmed ? 'WAITING FOR PASSENGERS' : 'PENDING OFFER', color: colors.primary, bg: colors.primaryDim },
      CONFIRMED: { label: 'CONFIRMED', color: colors.green, bg: colors.greenDim },
      IN_PROGRESS: { label: 'IN PROGRESS', color: colors.primary, bg: colors.primaryDim },
      DRIVER_COMPLETED: { label: 'CONFIRM ARRIVAL', color: colors.primary, bg: colors.primaryDim },
      RIDER_COMPLETED: { label: 'ARRIVAL CONFIRMED', color: colors.green, bg: colors.greenDim },
      COMPLETED: { label: 'COMPLETED', color: colors.green, bg: colors.greenDim },
      FLAGGED: { label: 'FLAGGED', color: colors.red, bg: colors.redDim },
    };
    const currentStatus = statusMeta[rideStatus] || { label: rideStatus.replace(/_/g, ' '), color: colors.textPrimary, bg: colors.bgSecondary };

    const openDriverChat = async () => {
      const riderId = firebaseAuth.currentUser?.uid;
      if (!riderId || !driverId) return;
      try {
        // Choose the same context/scopeId used when the original pre-confirmation
        // chat was created, so we reuse that thread instead of making a duplicate.
        const rideOfferId = confirmedRequest.confirmed?.rideOfferId || null;
        const ridePostingRequestId = confirmedRequest.confirmed?.ridePostingRequestId || null;
        const context = ridePostingRequestId ? 'booking-request'
          : rideOfferId ? 'ride-offer'
          : 'confirmed-ride';
        const chatId = await getOrCreateRideChat({
          context,
          rideId: confirmedRideDocId || linkedRideRequestId || '',
          rideRequestId: confirmedRequest.confirmed?.rideRequestId || null,
          rideOfferId,
          driverId,
          riderId,
          ridePostingId: confirmedRequest.confirmed?.ridePostingId || null,
          ridePostingRequestId,
        });
        router.push(`/(rider)/messages/${chatId}` as any);
      } catch {
        Alert.alert('Error', 'Could not open chat. Please try again.');
      }
    };

    const shareConfirmedRide = async () => {
      const parts = [
        'My ride on RideAlong!',
        `From: ${pickup}`,
        `To: ${dropoff}`,
        req.date ? `Date: ${req.date}` : null,
        fare ? `Fare: ${fare}` : null,
      ].filter(Boolean).join('\n');
      await Share.share({ message: parts }).catch(() => {});
    };

    const cancelRide = () => {
      // Block cancellation once the ride has started
      if (['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED', 'COMPLETED'].includes(rideStatus)) {
        Alert.alert('Cannot cancel', 'You cannot cancel a ride that is already in progress or completed.');
        return;
      }
      const isConfirmed = rideStatus === 'CONFIRMED';

      // Calculate whether the 48-hour free cancellation window applies
      let cancelMessage = 'Your request will be cancelled and any payment hold fully released.';
      if (isConfirmed) {
        const rideDate = ride?.raw?.date || ride?.raw?.scheduledDate || '';
        const rideTime = ride?.raw?.time || ride?.raw?.departureTime || '';
        let hoursUntilRide: number | null = null;
        if (rideDate) {
          const [h = 0, m = 0] = (rideTime || '').split(':').map(Number);
          const rideTs = new Date(`${rideDate}T00:00:00`);
          rideTs.setHours(h, m, 0, 0);
          hoursUntilRide = (rideTs.getTime() - Date.now()) / (60 * 60 * 1000);
        }
        if (hoursUntilRide !== null && hoursUntilRide >= 48) {
          cancelMessage = `Free cancellation — your ride is ${Math.floor(hoursUntilRide)} hours away. You will receive a full refund.`;
        } else if (hoursUntilRide !== null && hoursUntilRide < 2) {
          cancelMessage = `Late cancellation — your ride is in less than 2 hours. The full ride amount will be charged since the driver can no longer find a replacement.`;
        } else {
          cancelMessage = 'Cancelling within 48 hours of your ride incurs a 50% cancellation fee. The remaining balance will be released to your card within 3–5 business days.';
        }
      }

      Alert.alert(
        'Cancel ride?',
        cancelMessage,
        [
          { text: 'Keep ride', style: 'cancel' },
          {
            text: 'Cancel ride',
            style: 'destructive',
            onPress: async () => {
              try {
                const { getApiBaseUrl } = await import('@/constants/services');
                const targetCollection = confirmedRideDocId ? 'confirmedRides' : 'rideRequests';
                const targetId = confirmedRideDocId || rideId!;
                const res = await fetch(`${getApiBaseUrl()}/api/rides/${targetId}/cancel`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ collection: targetCollection, cancelledBy: 'rider' }),
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  if (body.code === 'ride_in_progress') {
                    Alert.alert('Cannot cancel', 'You cannot cancel a ride that is already in progress.');
                    return;
                  }
                  throw new Error(body.error || `Server error ${res.status}`);
                }
                goBackFromDetails();
                Alert.alert(
                  'Ride cancelled',
                  isConfirmed
                    ? 'Your ride has been cancelled. A 50% cancellation fee was charged; the rest will be released within 3–5 business days.'
                    : 'Your ride has been cancelled and your payment hold fully released.',
                );
              } catch (e: any) {
                Alert.alert('Failed', e?.message || 'Could not cancel the ride. Please try again.');
              }
            },
          },
        ],
      );
    };

    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          >
            {/* Header */}
            <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingTop: 4, marginBottom: 16 }}>
              <TouchableOpacity
                onPress={goBackFromDetails}
                style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.75}
              >
                <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={{ color: colors.textPrimary, fontSize: 24, fontWeight: '700', letterSpacing: -0.25, marginLeft: 12, flex: 1 }}>Ride Details</Text>
              <TouchableOpacity
                onPress={shareConfirmedRide}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.75}
              >
                <Ionicons name="share-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {/* Status badge */}
            <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: currentStatus.bg }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: currentStatus.color }} />
              <Text style={{ color: currentStatus.color, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>{currentStatus.label}</Text>
            </View>

            {/* Verification code — shown when ride is CONFIRMED, before pickup */}
            {rideStatus === 'CONFIRMED' && confirmedRequest.confirmed?.verificationCode && (
              <View style={{ backgroundColor: colors.primaryDim, borderRadius: 18, borderWidth: 1.5, borderColor: colors.primary, padding: 20, marginBottom: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: colors.primary, letterSpacing: 1.2, marginBottom: 12, textTransform: 'uppercase' }}>Your verification code</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                  {String(confirmedRequest.confirmed.verificationCode).split('').map((digit: string, i: number) => (
                    <View key={i} style={{ width: 56, height: 68, borderRadius: 14, backgroundColor: colors.bg, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: colors.primary, fontSize: 34, fontWeight: '800' }}>{digit}</Text>
                    </View>
                  ))}
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center' }}>
                  Give this code to your driver when they arrive to pick you up
                </Text>
              </View>
            )}

            {/* Driver / request card */}
            <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }}>
              {hasDriverInfo ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' }}>
                  {driverAvatarUrl ? (
                    <Image source={{ uri: driverAvatarUrl }} style={{ width: 48, height: 48, borderRadius: 24 }} resizeMode="cover" />
                  ) : (
                    <Text style={{ color: colors.textPrimary, fontSize: 18, fontWeight: '700' }}>{driverInitials || '?'}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700' }}>{driverName}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>{driverRating ? `★ ${driverRating}` : 'Driver confirmed'}</Text>
                </View>
                {driverId && (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/(rider)/driver/[driverId]', params: { driverId, returnTo: `/(rider)/ride/${rideId}` } } as any)}
                    style={{ backgroundColor: colors.bgSecondary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}
                  >
                    <Text style={{ color: colors.textPrimary, fontSize: 12, fontWeight: '700' }}>View profile</Text>
                  </TouchableOpacity>
                )}
              </View>
              ) : (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700' }}>Ride request</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 3 }}>Waiting for a driver offer.</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ alignItems: 'center', paddingTop: 4, gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.textPrimary }} />
                  <View style={{ width: 1, flex: 1, backgroundColor: colors.border }} />
                  <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors.primary }} />
                </View>
                <View style={{ flex: 1, gap: 10 }}>
                  <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600' }}>{pickup}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{req.date || ''}{req.time ? ` · ${req.time}` : ''}</Text>
                  <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600' }}>{dropoff}</Text>
                </View>
              </View>
            </View>

            {/* Vehicle */}
            {vehicle ? (
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 54, height: 46, borderRadius: 12, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {vehicleImageUrl ? (
                    <Image source={{ uri: vehicleImageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  ) : (
                    <Ionicons name="car-sport-outline" size={20} color={colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '600' }}>{vehicle}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>Verified vehicle</Text>
                </View>
              </View>
            ) : null}

            {/* Fare */}
            {fare ? (
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Fare</Text>
                  <Text style={{ color: colors.textPrimary, fontSize: 13, fontWeight: '700' }}>{fare}</Text>
                </View>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginBottom: 10 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Status</Text>
                  <Text style={{ color: currentStatus.color, fontSize: 13, fontWeight: '700' }}>{currentStatus.label}</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Bottom actions */}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32, gap: 10 }}>
            {driverId && (
              <TouchableOpacity
                style={{ backgroundColor: colors.textPrimary, borderRadius: 28, paddingVertical: 14, alignItems: 'center' }}
                onPress={openDriverChat}
                activeOpacity={0.85}
              >
                <Text style={{ color: colors.textInverse, fontSize: 15, fontWeight: '700' }}>Message Driver</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={{ backgroundColor: colors.redDim, borderRadius: 28, paddingVertical: 14, alignItems: 'center' }}
              onPress={cancelRide}
              activeOpacity={0.85}
            >
              <Text style={{ color: colors.red, fontSize: 15, fontWeight: '700' }}>Cancel Ride</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!ride || !rideId) {
    return <PhoneScreen title="Ride Details" showBack onBack={goBackFromDetails}><View style={styles.emptyCard}><Text style={styles.ridePlace}>Ride not found</Text><Text style={styles.heroSub}>It may have been filled or removed.</Text></View></PhoneScreen>;
  }

  const initials = ride.driverName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2);
  const note = String(ride.raw.notes || ride.raw.driverNotes || 'No additional notes from the driver.');
  const detailPickup = detailAddress('pickup');
  const detailDropoff = detailAddress('dropoff');
  const sharePosting = async () => {
    const parts = [
      `Available ride on RideAlong!`,
      ride.driverName ? `Driver: ${ride.driverName}` : null,
      `From: ${detailPickup}`,
      `To: ${detailDropoff}`,
      ride.date ? `Date: ${ride.date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : null,
      `Price: $${ride.price.toFixed(2)} per seat`,
    ].filter(Boolean).join('\n');
    await Share.share({ message: parts }).catch(() => {});
  };
  return (
    <>
      <PhoneScreen
        title="Ride Details"
        showBack
        onBack={goBackFromDetails}
        rightAction={
          <TouchableOpacity
            onPress={sharePosting}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.75}
          >
            <Ionicons name="share-outline" size={18} color={colors.primary} />
          </TouchableOpacity>
        }
        bottomAction={
          ride.isFull ? (
            myWaitlistEntry ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={[styles.primaryBtnFull, { flex: 1.4, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', borderRadius: 27, paddingVertical: 16 }]}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 15 }}>#{myWaitlistEntry.position} in line</Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtnFull, { flex: 1, backgroundColor: colors.bgCard, borderWidth: 1.5, borderColor: '#DC2626', justifyContent: 'center', alignItems: 'center', borderRadius: 27, paddingVertical: 16 }]}
                  onPress={handleLeaveWaitlist}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 15 }}>Leave</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtnFull, { opacity: joiningWaitlist ? 0.6 : 1 }]}
                onPress={handleJoinWaitlist}
                disabled={joiningWaitlist}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryText}>{joiningWaitlist ? 'Joining...' : 'Join Waitlist'}</Text>
              </TouchableOpacity>
            )
          ) : (
            <TouchableOpacity style={[styles.primaryBtnFull, (checkingVerification || paymentVisible) && { opacity: 0.6 }]} onPress={handleRequestSeat} disabled={checkingVerification || paymentVisible}>
              <Text style={styles.primaryText}>{checkingVerification ? 'Checking...' : `Request seat - $${ride.price.toFixed(2)}`}</Text>
            </TouchableOpacity>
          )
        }
      >
        <View style={styles.detailCard}>
          <TouchableOpacity
            style={styles.detailDriver}
            onPress={() => ride.driverId && router.push({
              pathname: '/(rider)/driver/[driverId]',
              params: { driverId: ride.driverId, returnTo: `/(rider)/ride/${ride.id}` },
            } as any)}
            disabled={!ride.driverId}
            activeOpacity={0.72}
            accessibilityRole={ride.driverId ? "button" : undefined}
            accessibilityLabel={ride.driverId ? `View ${ride.driverName}'s profile` : undefined}
          >
            <View style={[styles.avatar, styles.avatarLarge]}>
              {ride.driverAvatarUrl ? <Image source={{ uri: ride.driverAvatarUrl }} style={styles.detailAvatarImage} resizeMode="cover" /> : <Text style={styles.avatarTextLarge}>{initials}</Text>}
            </View>
            <View style={styles.detailDriverCopy}>
              <Text style={styles.detailName} numberOfLines={1}>{ride.driverName}</Text>
              <Text style={styles.detailMeta}>{ride.driverRating ? `★ ${ride.driverRating.toFixed(2)} · ` : ''}{ride.seats} seats available{ride.isRecurring ? ' · Recurring' : ''}</Text>
            </View>
            {ride.driverId ? <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} /> : null}
          </TouchableOpacity>
          <View style={styles.detailRoute}>
            <RouteDots compact connected />
            <View style={styles.detailRouteCopy}>
              <View>
                <View style={styles.detailLocationRow}>
                  <Text style={styles.detailLocation} numberOfLines={2}>{detailPickup}</Text>
                  <Text style={styles.detailTime}>{ride.date ? ride.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'TIME TBD'}</Text>
                </View>
                <Text style={styles.rideMeta}>{ride.seats} seats available</Text>
              </View>
              <Text style={styles.detailLocation} numberOfLines={2}>{detailDropoff}</Text>
            </View>
          </View>
        </View>

        {ride.isRecurring && scheduleInstances.length > 0 && (
          <View style={{ marginTop: 14, marginBottom: 6 }}>
            <Text style={[styles.eyebrow, { marginBottom: 10 }]}>PICK A DATE</Text>
            {loadingInstances ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
                {scheduleInstances.map((inst) => {
                  const isSelected = inst.id === ride.id;
                  const label = inst.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                  const timeLabel = inst.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                  return (
                    <TouchableOpacity
                      key={inst.id}
                      onPress={() => selectInstance(inst.id)}
                      activeOpacity={0.75}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 14,
                        borderWidth: 1.5,
                        borderColor: isSelected ? colors.primary : colors.border,
                        backgroundColor: isSelected ? colors.primaryDim : colors.bgCard,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: isSelected ? colors.primary : colors.textPrimary, fontSize: 13, fontWeight: '700' }}>{label}</Text>
                      <Text style={{ color: isSelected ? colors.primary : colors.textSecondary, fontSize: 11, marginTop: 2 }}>{timeLabel}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}

        <View style={[styles.detailCard, styles.detailInfoRow]}>
          <View style={[styles.detailInfoIcon, postingVehicleImageUrl && styles.detailVehicleImageWrap]}>
            {postingVehicleImageUrl ? (
              <Image source={{ uri: postingVehicleImageUrl }} style={styles.detailVehicleImage} resizeMode="cover" />
            ) : (
              <Ionicons name="car-sport" size={23} color={colors.textSecondary} />
            )}
          </View>
          <View style={styles.detailInfoCopy}>
            <Text style={styles.detailInfoTitle}>{ride.vehicle}</Text>
            <Text style={styles.detailInfoText}>Driver and vehicle details are verified through RideAlong.</Text>
          </View>
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.eyebrow}>NOTE FROM DRIVER</Text>
          <Text style={styles.noteText}>{note}</Text>
        </View>

        <View style={styles.detailCard}>
          <View style={styles.fareRow}><Text style={styles.fareLabel}>Seat fare</Text><Text style={styles.fareValue}>${ride.price.toFixed(2)}</Text></View>
          <View style={styles.fareDash} />
          <View style={styles.fareRow}><Text style={styles.fareLabel}>Payment</Text><Text style={styles.fareValue} numberOfLines={2}>Authorized now, captured after completion</Text></View>
        </View>
      </PhoneScreen>
      <PaymentModal
        visible={paymentVisible}
        onClose={() => setPaymentVisible(false)}
        rideId={ride.id}
        driverId={ride.driverId || null}
        baseFare={ride.price}
        onPaymentSuccess={async (paymentIntentId: string) => {
          setPaymentVisible(false);
          const riderId = firebaseAuth.currentUser?.uid;
          const user = firebaseAuth.currentUser;

          if (!riderId) {
            Alert.alert('Error', 'Session expired. Please sign in again.');
            return;
          }

          try {
            // ride.raw is the raw Firestore data already loaded when this screen opened.
            const raw = ride.raw ?? {} as any;

            const rawStr = (v: unknown): string | null =>
              typeof v === 'string' && v.trim() ? v.trim() : null;

            const pickup =
              rawStr(raw.pickup) || rawStr(raw.pickupAddress) || rawStr(raw.from) || rawStr(raw.origin)
              || rawStr(raw.pickupGeo?.address) || rawStr(raw.pickupLocation?.address) || '';
            const dropoff =
              rawStr(raw.dropoff) || rawStr(raw.dropoffAddress) || rawStr(raw.to) || rawStr(raw.destination)
              || rawStr(raw.dropoffGeo?.address) || rawStr(raw.dropoffLocation?.address) || '';
            const date = rawStr(raw.date) || rawStr(raw.departureDate) || rawStr(raw.scheduledDate) || '';
            const time = rawStr(raw.time) || rawStr(raw.departureTime) || rawStr(raw.scheduledTime) || '';

            // Fetch rider profile for name
            const riderSnap = await getDoc(doc(firestore, 'riders', riderId)).catch(() => null);
            const rd = riderSnap?.exists() ? riderSnap.data() as any : {};
            const riderName = [rd.firstName, rd.lastName].filter(Boolean).join(' ').trim()
              || user?.displayName || 'Rider';

            const driverId = rawStr(raw.driverId) || ride.driverId || null;
            const driverSnap = driverId
              ? await getDoc(doc(firestore, 'drivers', driverId)).catch(() => null)
              : null;
            const dd = driverSnap?.exists() ? driverSnap.data() as any : {};
            const driverFullName = [dd.firstName, dd.lastName].filter(Boolean).join(' ').trim()
              || dd.displayName || rawStr(raw.driverName) || ride.driverName || 'Driver';
            const driverEmail = dd.email || rawStr(raw.driverEmail) || '';

            // Use ride.id (the currently selected instance) — may differ from the URL rideId
            // if the rider picked a different date from the recurring schedule.
            const targetPostingId = ride.id;

            const reqData: Record<string, any> = {
              ridePostingId: targetPostingId,
              rideId: targetPostingId,
              riderId,
              riderName,
              riderEmail: user?.email || '',
              driverId,
              driverName: driverFullName,
              driverEmail,
              pickup,
              dropoff,
              from: pickup,
              to: dropoff,
              date,
              time,
              passengers: 1,
              contributionAmount: ride.price,
              price: ride.price,
              paymentIntentId,
              paymentStatus: 'authorized',
              status: 'pending',
              state: 'pending',
              distance: raw.distance || null,
              duration: raw.duration || null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              _localCreatedMs: Date.now(),
            };

            // Deterministic doc ID prevents duplicate requests from double-taps or retries
            const reqDocId = `${riderId}_${targetPostingId}`;
            const reqRef = doc(firestore, 'ridePostingRequests', reqDocId);

            // Cancel any stale pending docs for this (rider, posting) pair
            const staleSnap = await getDocs(
              query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', riderId))
            ).catch(() => null);
            if (staleSnap) {
              const terminal = new Set(['cancelled', 'canceled', 'rejected', 'completed', 'accepted', 'confirmed']);
              await Promise.all(
                staleSnap.docs
                  .filter((d) => {
                    if (d.id === reqDocId) return false;
                    const r = d.data() as any;
                    const pid = r.ridePostingId || r.rideId || '';
                    return pid === targetPostingId && !terminal.has(String(r.status || '').toLowerCase());
                  })
                  .map((d) => updateDoc(doc(firestore, 'ridePostingRequests', d.id), {
                    status: 'cancelled',
                    updatedAt: serverTimestamp(),
                  }))
              ).catch(() => {});
            }

            await setDoc(reqRef, reqData);

            // Best-effort: notify server so driver receives a push notification
            try {
              const { getApiBaseUrl } = await import('@/constants/services');
              const base = getApiBaseUrl();
              await fetch(`${base}/api/rides/${targetPostingId}/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentIntentId, riderId, driverId }),
              });
            } catch {
              await createRoleNotification({
                recipientId: driverId,
                recipientRole: 'driver',
                type: 'new_ride_request',
                title: 'New ride request',
                message: 'A rider requested a seat on your posted ride.',
                driverId,
                riderId,
                ridePostingId: targetPostingId,
                ridePostingRequestId: reqDocId,
                dedupeId: `posting-request-${reqDocId}-driver`,
              }).catch(() => {});
            }

            // Only navigate to confirmed screen after the booking is persisted
            router.replace({
              pathname: '/(rider)/booking-confirmed',
              params: { rideId: targetPostingId, driverId: ride.driverId || '', driverName: ride.driverName || '', ridePostingRequestId: reqDocId },
            } as any);
          } catch (e: any) {
            // Booking creation failed — void the authorized payment so the rider is not charged
            try {
              const { cancelRidePayment } = await import('@/services/payments');
              await cancelRidePayment({ paymentIntentId, rideId });
            } catch {}
            Alert.alert(
              'Booking failed',
              'Your payment was not charged. Please try again.',
            );
          }
        }}
      />
    </>
  );
}

export function RiderConfirmedReference() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { rideId, driverId: driverIdParam, driverName: driverNameParam, ridePostingRequestId: ridePostingRequestIdParam } = useLocalSearchParams<{ rideId?: string; driverId?: string; driverName?: string; ridePostingRequestId?: string }>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading]       = useState(true);
  const [driverId, setDriverId]     = useState(driverIdParam || '');
  const [driverName, setDriverName] = useState(driverNameParam || '');
  const [driverRating, setDriverRating] = useState<number | null>(null);
  const [from, setFrom]             = useState('');
  const [to, setTo]                 = useState('');
  const [dateLabel, setDateLabel]   = useState('');
  const [price, setPrice]           = useState<number | null>(null);
  const [seats, setSeats]           = useState<number | null>(null);

  const extractAddr = (r: any, key: 'pickup' | 'dropoff'): string => {
    const v = r?.[key] ?? r?.[`${key}Location`] ?? r?.[`${key}Address`]
      ?? r?.[key === 'pickup' ? 'from' : 'to'] ?? r?.[key === 'pickup' ? 'origin' : 'destination'];
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object') return (v.address || v.description || v.name || '').trim();
    return '';
  };

  useEffect(() => {
    if (!rideId) { setLoading(false); return; }
    getDoc(doc(firestore, 'ridePostings', rideId)).then(async (snap) => {
      if (!snap.exists()) { setLoading(false); return; }
      const r = snap.data() as any;

      setFrom(extractAddr(r, 'pickup'));
      setTo(extractAddr(r, 'dropoff'));

      const p = r.pricePerSeat ?? r.contributionAmount ?? r.price;
      if (p != null) setPrice(Number(p));

      const s = r.availableSeats ?? r.seats ?? r.seatsAvailable;
      if (s != null) setSeats(Number(s));

      const dateStr = r.date || '';
      const timeStr = r.time || '';
      setDateLabel([dateStr, timeStr].filter(Boolean).join(' · '));

      // Resolve driver ID
      const resolvedDriverId = r.driverId || driverIdParam || '';
      if (resolvedDriverId) setDriverId(resolvedDriverId);

      // Try name from posting first, then fetch from drivers collection
      const nameFromPosting = [r.driverFirstName, r.driverLastName].filter(Boolean).join(' ').trim()
        || r.driverName || driverNameParam || '';

      if (nameFromPosting) {
        setDriverName(nameFromPosting);
        if (r.driverRating || r.rating) setDriverRating(Number(r.driverRating ?? r.rating));
      } else if (resolvedDriverId) {
        const dSnap = await getDoc(doc(firestore, 'drivers', resolvedDriverId)).catch(() => null);
        if (dSnap?.exists()) {
          const d = dSnap.data() as any;
          const fullName = [d.firstName, d.lastName].filter(Boolean).join(' ').trim()
            || d.displayName || d.name || 'Your driver';
          setDriverName(fullName);
          if (d.rating) setDriverRating(Number(d.rating));
        }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [rideId]);

  const firstName = driverName.split(' ')[0] || 'Your driver';

  if (loading) {
    return (
      <LinearGradient colors={[colors.primaryDim, colors.bgSecondary, colors.bg]} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </LinearGradient>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <LinearGradient colors={[colors.primaryDim, colors.bgSecondary, colors.bg]} locations={[0, 0.45, 1]} style={{ flex: 1 }}>
        <SafeAreaView edges={['top']} />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={{ alignItems: 'center', paddingTop: 44, paddingBottom: 32 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
              marginBottom: 24,
              shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
            }}>
              <Ionicons name="checkmark" size={36} color={colors.textInverse} />
            </View>

            <RNText style={{ fontFamily: FONT_SANS, fontSize: 30, fontWeight: '600', color: colors.textPrimary, textAlign: 'center', lineHeight: 36 }}>
              {'Request '}
              <RNText style={{ fontFamily: FONT_SANS, color: colors.primary, fontStyle: 'italic', fontWeight: '600' }}>
                successful!
              </RNText>
            </RNText>
            <RNText style={{ fontSize: 15, color: colors.textSecondary, fontWeight: '500', marginTop: 10, textAlign: 'center', lineHeight: 22 }}>
              {firstName} has been notified and will{'\n'}respond soon.
            </RNText>
          </View>

          {/* Details card */}
          <View style={{
            backgroundColor: colors.bgCard, borderRadius: 20,
            padding: 20, borderWidth: 1, borderColor: colors.border,
          }}>
            {from && to && (
              <>
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                  <View style={{ alignItems: 'center', paddingTop: 3, gap: 0 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary }} />
                    <View style={{ width: 1.5, height: 24, backgroundColor: colors.border, marginVertical: 2 }} />
                    <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.textPrimary }} />
                  </View>
                  <View style={{ flex: 1, gap: 12 }}>
                    <RNText style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }} numberOfLines={1}>{from}</RNText>
                    <RNText style={{ fontSize: 14, fontWeight: '600', color: colors.textPrimary }} numberOfLines={1}>{to}</RNText>
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 14 }} />
              </>
            )}

            {[
              dateLabel ? ['When', dateLabel] : null,
              ['Driver', [firstName, driverRating != null ? `★ ${driverRating.toFixed(2)}` : null].filter(Boolean).join('  ')],
              seats != null ? ['Seats available', `${seats}`] : null,
              price != null ? ['Charged', `$${price.toFixed(2)}`] : null,
            ].filter(Boolean).map(([label, value]) => (
              <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <RNText style={{ fontSize: 13, color: colors.textSecondary, fontWeight: '500' }}>{label}</RNText>
                <RNText style={{ fontSize: 13, color: colors.textPrimary, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>{value}</RNText>
              </View>
            ))}
          </View>

          <RNText style={{ fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: 14, lineHeight: 18 }}>
            Payment is authorized now and only captured after your ride is completed.
          </RNText>
        </ScrollView>

        {/* Actions */}
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          paddingHorizontal: 20, paddingBottom: insets.bottom + 16, paddingTop: 14,
          gap: 10,
        }}>
          <TouchableOpacity
            style={{ backgroundColor: colors.textPrimary, borderRadius: 28, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            onPress={async () => {
              const riderId = firebaseAuth.currentUser?.uid;
              if (!riderId || !driverId) { router.replace('/(rider)/messages' as any); return; }
              try {
                const chatId = await getOrCreateRideChat({
                  context: 'booking-request',
                  rideId: rideId || driverId,
                  ridePostingId: rideId || null,
                  ridePostingRequestId: ridePostingRequestIdParam || null,
                  driverId,
                  riderId,
                });
                router.replace({ pathname: '/(rider)/messages/[chatId]', params: { chatId } } as any);
              } catch {
                router.replace('/(rider)/messages' as any);
              }
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="chatbubble-outline" size={18} color={colors.textInverse} />
            <RNText style={{ color: colors.textInverse, fontSize: 16, fontWeight: '800' }}>Message {firstName}</RNText>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ paddingVertical: 12, alignItems: 'center' }}
            onPress={() => router.replace('/(rider)/' as any)}
            activeOpacity={0.75}
          >
            <RNText style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '700' }}>Back to home</RNText>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

function makeStyles(colors: AppColors) {
  const pageTitleColor = colors.statusBar === 'light-content' ? '#FFFFFF' : colors.textPrimary;

  return StyleSheet.create({
  defaultText: { fontFamily: FONT_SANS },
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: colors.bg },
  status: { height: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24 },
  statusTime: { fontFamily: FONT_SANS, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  notch: { position: 'absolute', top: 9, left: '37%', right: '37%', height: 32, borderRadius: 16, backgroundColor: '#000' },
  statusIcons: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { ...appHeader.row, height: 64, paddingHorizontal: layout.screenPadding, marginHorizontal: -layout.screenPadding },
  mark: { color: colors.primary, fontSize: 14, fontWeight: '700', marginRight: 9 },
  headerTitle: { ...appHeader.title, fontFamily: FONT_SANS, color: colors.textPrimary },
  headerTitleAfterBack: { flexShrink: 1, marginLeft: 12 },
  circleBtn: { ...appHeader.iconButton, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingTop: 24 },
  contentWithScrollableHeader: { paddingTop: 0 },
  homeUtilityBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -6, marginBottom: 24 },
  homeBrandMark: { width: 36, height: 36, borderRadius: 12, overflow: 'hidden' },
  homeBrandLogo: { width: '100%', height: '100%' },
  campusChip: { flex: 1, minWidth: 0, height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 19, backgroundColor: colors.bgSecondary },
  campusText: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  utilityButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  homeAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDim, borderWidth: 2, borderColor: '#FFFFFF', overflow: 'hidden' },
  homeAvatarImage: { width: '100%', height: '100%', borderRadius: 20 },
  homeAvatarText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  pageIntro: { marginBottom: 12 },
  pageTitle: { ...appHeader.title, fontFamily: FONT_SANS, color: pageTitleColor },
  heroCopy: { marginBottom: 22 },
  heroTitle: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: '600' },
  heroAccent: { fontFamily: FONT_SANS, color: colors.primary, fontStyle: 'italic', fontWeight: '600' },
  heroSub: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, marginTop: 5 },
  homePrimaryBlock: { marginBottom: 30 },
  homePrimarySearchBlock: { marginBottom: 4 },
  searchCard: { backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 28, shadowColor: colors.textPrimary, shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  autocompleteSearchCard: { zIndex: 30, elevation: 30 },
  routeRow: { flexDirection: 'row' },
  routeRail: { width: 28, alignItems: 'center', paddingTop: 16, paddingBottom: 16 },
  navyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.textPrimary },
  orangeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  dashedLine: { flex: 1, width: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.border, marginVertical: 7 },
  connectedRouteLine: { width: 2, borderLeftWidth: 0, borderStyle: 'solid', backgroundColor: colors.border, marginVertical: 0 },
  connectedRouteRail: { height: 92, minHeight: 0, alignSelf: 'stretch', paddingTop: 2, paddingBottom: 2 },
  routeInputs: { flex: 1, gap: 9, zIndex: 30 },
  autocompleteField: { flex: 0 },
  inputPill: { fontFamily: FONT_SANS, height: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, paddingHorizontal: 14, justifyContent: 'center', color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  inputText: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  stopText: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 10, fontWeight: '500', marginLeft: 12 },
  metaRow: { flexDirection: 'row', gap: 9, paddingLeft: 28, marginTop: 9 },
  homeMetaRowFullWidth: { paddingLeft: 0 },
  metaPill: { flex: 1, height: 44, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, justifyContent: 'center', paddingHorizontal: 13 },
  metaText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  metaPlaceholderText: { color: colors.textSecondary },
  primaryBtn: { height: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 34 },
  searchPrimaryBtn: { height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryBtnFull: { height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  requestSubmitButton: { marginTop: 22, marginBottom: 0 },
  primaryText: { fontFamily: FONT_SANS, color: colors.textInverse, fontSize: 17, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontFamily: FONT_SANS, flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  sectionAction: { fontFamily: FONT_MONO, color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  promotionList: { paddingBottom: 12, paddingRight: 8 },
  promotionDots: { height: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 18 },
  promotionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  promotionDotActive: { width: 20, backgroundColor: colors.textPrimary },
  uberPromoCard: { height: 174, marginRight: 12, flexDirection: 'row', overflow: 'hidden', borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 2 },
  uberPromoCopy: { width: '62%', paddingHorizontal: 18, paddingVertical: 17, justifyContent: 'space-between' },
  uberPromoTitle: { color: colors.textPrimary, fontSize: 21, lineHeight: 25, fontWeight: '800', letterSpacing: -0.35 },
  uberPromoDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 5 },
  uberPromoCta: { minHeight: 38, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 19, backgroundColor: colors.bgSecondary, paddingHorizontal: 15, justifyContent: 'center' },
  uberPromoCtaClaimed: { backgroundColor: colors.primaryDim },
  uberPromoCtaText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  uberPromoVisual: { flex: 1, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  uberPromoVisualSecondary: { backgroundColor: colors.bgSecondary },
  promoBubble: { position: 'absolute', borderRadius: 999, backgroundColor: colors.primaryDim },
  promoBubbleSecondary: { backgroundColor: colors.bgSecondary },
  promoBubbleTop: { width: 108, height: 108, top: -45, right: -32 },
  promoBubbleBottom: { width: 92, height: 92, bottom: -32, left: -26 },
  promoIconLarge: { width: 76, height: 76, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }], shadowColor: colors.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 12, elevation: 4 },
  promoIconLargeSecondary: { backgroundColor: colors.textPrimary, shadowColor: colors.textPrimary },
  promoIconSmall: { position: 'absolute', right: 13, bottom: 14, width: 42, height: 42, borderRadius: 21, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '8deg' }] },
  promotionLoading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  promotionEmptyCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 18, marginBottom: 28 },
  promotionEmptyTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  promotionEmptyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 3 },
  homeSection: { marginBottom: 28 },
  popularRouteList: { gap: 10 },
  popularRouteCard: { minHeight: 66, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  popularRouteIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  popularRouteCopy: { flex: 1, minWidth: 0 },
  popularRouteTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  popularRouteMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 3 },
  popularRoutePrice: { color: colors.primary, fontSize: 20, fontWeight: '500' },
  quickList: { gap: 12, paddingBottom: 16 },
  quickCard: { width: 132, height: 94, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 14 },
  quickKicker: { fontFamily: FONT_MONO, color: colors.textTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  quickCity: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginTop: 8 },
  quickPrice: { color: colors.primary, fontSize: 23, fontWeight: '300', marginTop: 4 },
  rideCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 18 },
  confirmedCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  confirmedFareBlock: { alignItems: 'flex-end', flexShrink: 0 },
  confirmedFareLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 1 },
  confirmedSchedule: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 18, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  confirmedScheduleItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyCard: { borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.bgCard, padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  rideMain: { flexDirection: 'row' },
  rideLine: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  ridePlace: { fontFamily: FONT_SANS, flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  rideTime: { fontFamily: FONT_SANS, color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  rideMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginVertical: 5 },
  driverFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.border, paddingTop: 14, marginTop: 12 },
  activityCardActions: { flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  actionBtnPrimary: { flex: 1, backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  actionBtnPrimaryText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  actionBtnSecondary: { flex: 1, backgroundColor: colors.bgSecondary, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  actionBtnSecondaryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  actionBtnCancel: { flex: 1, backgroundColor: colors.redDim, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  actionBtnCancelText: { color: colors.red, fontSize: 13, fontWeight: '700' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDim },
  availableAvatarImage: { width: '100%', height: '100%', borderRadius: 21 },
  avatarText: { fontFamily: FONT_SANS, color: colors.primary, fontSize: 14, fontWeight: '600' },
  driverSmall: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  cardPrice: { color: colors.primary, fontSize: 24, fontWeight: '700' },
  eyebrow: { fontFamily: FONT_SANS, color: colors.textTertiary, fontSize: 11, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 8, marginTop: 16 },
  seatRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  seatPill: { flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard },
  seatActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  seatText: { fontFamily: FONT_SANS, color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  seatTextActive: { color: colors.textInverse },
  priceBox: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceInputGroup: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  bigPrice: { color: colors.primary, fontSize: 32, lineHeight: 38, fontWeight: '400', marginRight: 2 },
  priceInput: { flex: 1, minWidth: 72, color: colors.textPrimary, fontSize: 32, lineHeight: 38, fontWeight: '400', paddingVertical: 0, paddingHorizontal: 0 },
  requestSuggestedWrap: { width: 142, alignItems: 'flex-end', flexShrink: 0 },
  requestSuggestedLabel: { fontFamily: FONT_MONO, color: colors.textTertiary, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  requestSuggestedText: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '600', textAlign: 'right', marginTop: 2 },
  suggested: { fontFamily: FONT_MONO, position: 'absolute', right: 14, top: 34, color: colors.textTertiary, fontSize: 9, fontWeight: '500', letterSpacing: 1 },
  slider: { height: 3, borderRadius: 2, backgroundColor: colors.border, marginTop: 12 },
  sliderFill: { width: '62%', height: 3, backgroundColor: colors.primary },
  sliderThumb: { position: 'absolute', left: '62%', top: -5, width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.bgCard },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: colors.bgCard },
  chipActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  chipText: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: colors.textInverse },
  noteBox: { fontFamily: FONT_SANS, minHeight: 74, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 12, color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  findSearch: { minHeight: 56, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 7, marginBottom: 16, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 },
  availableSearchInput: { flex: 1, height: 54, paddingVertical: 0, color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
  filterButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgSecondary },
  filterButtonActive: { backgroundColor: colors.textPrimary },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  resultsCount: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  clearFiltersText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  findSearchLabel: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 3 },
  findSearchText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  filterRow: { gap: 8, paddingBottom: 20 },
  filterPill: { minWidth: 72, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 },
  filterActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  filterText: { fontFamily: FONT_SANS, color: colors.textSecondary, fontSize: 14, fontWeight: '500', textAlign: 'center' },
  filterTextActive: { color: colors.textInverse },
  availableCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, marginBottom: 14, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 1 },
  availableCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  availableDeparture: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  seatBadge: { minWidth: 42, height: 28, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.bgSecondary, paddingHorizontal: 9 },
  seatBadgeText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  availableRouteBlock: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 12 },
  availableTop: { display: 'none' },
  availableLocationsBlock: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  availableLocationsTime: { display: 'none' },
  availableRouteRail: { width: 12, alignItems: 'center', paddingTop: 4, paddingBottom: 4 },
  availableRouteLine: { width: 2, flex: 1, minHeight: 28, backgroundColor: colors.border, marginVertical: 4 },
  availableLocationCopy: { flex: 1, minWidth: 0, gap: 10 },
  availableLocationTextWrap: { flex: 1, minWidth: 0 },
  availableRouteLabel: { color: colors.textSecondary, fontSize: 9, lineHeight: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
  availableDropoffLabel: { color: colors.primary },
  availablePickupDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.textPrimary },
  availableDropoffDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  availableLocationText: { color: colors.textPrimary, fontSize: 14, lineHeight: 18, fontWeight: '700' },
  availableRouteIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  availableRoute: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  availableRouteMeta: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', marginTop: 1, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 },
  availableDestination: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 2 },
  availableTimeBadge: { maxWidth: 92, borderRadius: 12, backgroundColor: colors.bgSecondary, paddingHorizontal: 10, paddingVertical: 7 },
  availableTime: { fontFamily: FONT_MONO, color: colors.textPrimary, fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  availableDash: { borderTopWidth: 1, borderColor: colors.border, marginVertical: 15 },
  availableBottom: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14 },
  driverName: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  driverMeta: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 3 },
  availablePriceBlock: { alignItems: 'flex-end' },
  availablePrice: { color: colors.primary, fontSize: 28, fontWeight: '500' },
  availablePerSeat: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', marginTop: -2 },
  availableEmptyState: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48, minHeight: 340 },
  availableEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  availableEmptyTitle: { color: colors.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  availableEmptyText: { maxWidth: 280, color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  availableFilterBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  availableFilterDot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.bgCard },
  availableEmptyPrimary: { minHeight: 46, borderRadius: 23, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 22, marginTop: 18 },
  availableEmptyPrimaryText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  bottomNav: { position: 'absolute', left: 24, right: 24, bottom: 14, height: 58, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: 29, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 5, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 10 },
  navItem: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, gap: 1 },
  navItemActive: { backgroundColor: colors.bgSecondary },
  navIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', top: -7, right: -11, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  iconBadgeText: { color: colors.textInverse, fontSize: 9, lineHeight: 11, fontWeight: '800' },
  utilityBadge: { position: 'absolute', top: -4, right: -5, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  navText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  bottomAction: { position: 'absolute', left: 18, right: 18, bottom: 20 },
  detailCard: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 14, marginBottom: 12 },
  detailDriver: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailDriverCopy: { flex: 1, minWidth: 0 },
  detailAvatarImage: { width: '100%', height: '100%', borderRadius: 24 },
  avatarLarge: { width: 48, height: 48, borderRadius: 24 },
  avatarTextLarge: { fontFamily: FONT_SANS, color: colors.primary, fontSize: 14, fontWeight: '600' },
  detailName: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  detailMeta: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 3 },
  detailRoute: { flexDirection: 'row', gap: 10, marginTop: 14, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: colors.border, paddingTop: 12 },
  detailRouteCopy: { flex: 1, minWidth: 0, minHeight: 92, justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  detailLocationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailLocation: { flex: 1, minWidth: 0, color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  detailTime: { maxWidth: 96, flexShrink: 0, fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 10, lineHeight: 15, fontWeight: '600', textAlign: 'right' },
  vehicleIcon: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center', position: 'absolute', left: 14, top: 14 },
  vehicleTitle: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 13, fontWeight: '600', marginLeft: 62 },
  detailInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  detailInfoIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  detailVehicleImageWrap: { width: 58, height: 46, overflow: 'hidden' },
  detailVehicleImage: { width: '100%', height: '100%' },
  detailInfoCopy: { flex: 1, minWidth: 0 },
  detailInfoTitle: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  detailInfoText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  chipRowSmall: { flexDirection: 'row', gap: 6, marginLeft: 62, marginTop: 8 },
  miniChip: { fontFamily: FONT_MONO, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.textSecondary, fontSize: 11, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 7 },
  noteText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  fareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  fareLabel: { flex: 1, color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  fareValue: { maxWidth: '68%', flexShrink: 1, fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'right' },
  fareDash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.border, marginVertical: 4 },
  fareTotal: { color: colors.primary, fontSize: 22, fontWeight: '300' },
  confirmHero: { alignItems: 'center', paddingTop: 34, paddingBottom: 34 },
  checkCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  confirmTitle: { color: colors.textPrimary, fontSize: 30, fontWeight: '300', marginBottom: 14 },
  confirmCard: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, shadowColor: colors.textPrimary, shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  confirmCode: { fontFamily: FONT_MONO, color: colors.textTertiary, fontSize: 9, fontWeight: '500', letterSpacing: 2, textAlign: 'center', marginBottom: 16 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 11 },
  confirmValue: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  confirmPrice: { color: colors.primary, fontSize: 22, fontWeight: '300' },
  confirmActions: { gap: 16 },
  secondaryBtn: { minHeight: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  });
}
