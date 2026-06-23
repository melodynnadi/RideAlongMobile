import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text as RNText, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { firebaseAuth, firestore } from '@/constants/services';
import * as Location from 'expo-location';
import { PaymentModal } from '@/components/PaymentModal';
import { RideFiltersModal } from '@/components/RideFiltersModal';
import { usePromotions } from '@/hooks/usePromotions';
import { Promotion } from '@/types';
import { applyFiltersToRide, getDefaultFilters, hasActiveFilters, type RideFilterOptions } from '@/utils/rideFilters';
import { addDoc, collection, doc, getDoc, getDocs, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
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

const NAVY = '#15233A';
const SECONDARY = '#0D1B48';
const ORANGE = '#DE5D20';
const BG = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED = '#8B94A6';
const FONT_SANS = Platform.OS === 'web' ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' : undefined;
const FONT_MONO = Platform.OS === 'web' ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : undefined;

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

type TabKey = 'home' | 'find' | 'rides' | 'inbox' | 'you';
type RNTextProps = React.ComponentProps<typeof RNText>;

function Text({ style, ...props }: RNTextProps) {
  return <RNText {...props} style={[styles.defaultText, style]} />;
}

function PhoneScreen({
  title,
  activeTab,
  children,
  showBack = false,
  rightIcon,
  bottomAction,
  onBack,
}: {
  title?: string;
  activeTab?: TabKey;
  children: React.ReactNode;
  showBack?: boolean;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  bottomAction?: React.ReactNode;
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { goBack } = useReturnNavigation('/(rider)');
  const bottomNavHeight = 78;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        {Platform.OS === 'web' ? (
          <View style={styles.status}>
            <Text style={styles.statusTime}>9:41</Text>
            <View style={styles.notch} />
            <View style={styles.statusIcons}>
              <Ionicons name="cellular" size={16} color="#0F172A" />
              <Ionicons name="wifi" size={14} color="#0F172A" />
              <Ionicons name="battery-full" size={18} color="#0F172A" />
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
                <Ionicons name="arrow-back" size={18} color={NAVY} />
              </TouchableOpacity>
            ) : (
              <Text style={styles.mark}>R</Text>
            )}
            <Text style={[styles.headerTitle, showBack && styles.headerTitleAfterBack]}>{title}</Text>
            <View style={{ flex: 1 }} />
            {rightIcon ? (
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={() => rightIcon === 'person-circle' ? router.push('/(rider)/profile' as any) : undefined}
                disabled={rightIcon !== 'person-circle'}
                accessibilityRole="button"
                accessibilityLabel={rightIcon === 'person-circle' ? 'Open profile' : 'More options'}
                accessibilityState={{ disabled: rightIcon !== 'person-circle' }}
                hitSlop={hitSlop}
              >
                <Ionicons name={rightIcon} size={18} color={NAVY} />
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

          {children}
        </ScrollView>

        {bottomAction ? <View style={[styles.bottomAction, { bottom: insets.bottom + 12 }]}>{bottomAction}</View> : null}
        {activeTab ? <BottomNav active={activeTab} /> : null}
      </SafeAreaView>
    </View>
  );
}

function BottomNav({ active }: { active: TabKey }) {
  const { messageCount } = useRiderUnreadCounts();
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; href?: string }[] = [
    { key: 'home', label: 'Home', icon: 'home', href: '/(rider)' },
    { key: 'find', label: 'Request', icon: 'add-circle-outline', href: '/(rider)/book' },
    { key: 'rides', label: 'Rides', icon: 'ticket-outline', href: '/(rider)/available-rides' },
    { key: 'inbox', label: 'Inbox', icon: 'chatbubble', href: '/(rider)/messages' },
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
              <Ionicons name={tab.icon} size={23} color={selected ? ORANGE : '#6B7280'} />
              {tab.key === 'inbox' && messageCount > 0 ? <View style={styles.iconBadge}><Text style={styles.iconBadgeText}>{badgeLabel(messageCount)}</Text></View> : null}
            </View>
            <Text style={[styles.navText, selected && { color: ORANGE }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function RouteDots({ compact = false, connected = false }: { compact?: boolean; connected?: boolean }) {
  return (
    <View style={[styles.routeRail, compact && { paddingVertical: 4 }, connected && styles.connectedRouteRail]}>
      <View style={styles.navyDot} />
      <View style={[styles.dashedLine, connected && styles.connectedRouteLine]} />
      <View style={styles.orangeDot} />
    </View>
  );
}

function HomeUtilityBar({ university, initial, avatarUrl }: { university?: string; initial: string; avatarUrl?: string }) {
  const { notificationCount } = useRiderUnreadCounts();
  return (
    <View style={styles.homeUtilityBar}>
      <View style={styles.homeBrandMark}>
        <Image source={require('../../assets/ridealonglogo.png')} style={styles.homeBrandLogo} resizeMode="contain" />
      </View>
      <View style={styles.campusChip}>
        <Ionicons name="school-outline" size={15} color={NAVY} />
        <Text style={styles.campusText} numberOfLines={1}>{university || 'Your campus'}</Text>
      </View>
      <TouchableOpacity
        style={styles.utilityButton}
        onPress={() => router.push({ pathname: '/(rider)/notifications', params: { returnTo: '/(rider)' } } as any)}
        accessibilityRole="button"
        accessibilityLabel="Open notifications"
        hitSlop={hitSlop}
      >
        <Ionicons name="notifications-outline" size={21} color={NAVY} />
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

function RouteCard({ footer = true, cta = false, from = 'Austin, TX', to = 'Houston, TX', onChangeFrom, onChangeTo, onSearch }: {
  footer?: boolean;
  cta?: boolean;
  from?: string;
  to?: string;
  onChangeFrom?: (value: string) => void;
  onChangeTo?: (value: string) => void;
  onSearch?: () => void;
}) {
  return (
    <View style={styles.searchCard}>
      <View style={styles.routeRow}>
        <RouteDots />
        <View style={styles.routeInputs}>
          <TextInput style={styles.inputPill} value={from} onChangeText={onChangeFrom} placeholder="Leaving from" placeholderTextColor={MUTED} />
          <TextInput style={styles.inputPill} value={to} onChangeText={onChangeTo} placeholder="Going to" placeholderTextColor={MUTED} />
        </View>
      </View>
      {footer ? (
        <View style={styles.metaRow}>
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>Fri, Nov 20</Text>
          </View>
          <View style={styles.metaPill}>
            <Text style={styles.metaText}>Anytime</Text>
          </View>
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
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

function UberStylePromotionCard({ promotion, claimed, onPress, width, secondary = false }: { promotion: Promotion; claimed: boolean; onPress: () => void; width: number; secondary?: boolean }) {
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
          {claimed ? <Ionicons name="checkmark" size={15} color={NAVY} /> : null}
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
          <Ionicons name="car-outline" size={22} color={secondary ? SECONDARY : ORANGE} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function MiniRideCard({ price = '$28' }: { price?: string }) {
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
        <Ionicons name="gift-outline" size={24} color={ORANGE} />
        <View style={{ flex: 1 }}>
          <Text style={styles.promotionEmptyTitle}>Loading your offers</Text>
          <Text style={styles.promotionEmptyText}>Student deals will appear here.</Text>
        </View>
      </View>

    </PhoneScreen>
  );
}

export function RiderHomeReference() {
  const { width: windowWidth } = useWindowDimensions();
  const uid = firebaseAuth.currentUser?.uid;
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [confirmed, setConfirmed] = useState<MobileRidePosting[]>([]);
  const [activeRequests, setActiveRequests] = useState<any[]>([]);
  const [requestsWithOffers, setRequestsWithOffers] = useState<Map<string, { offerId: string; driverId?: string }>>(new Map());
  const [confirmedRideStatus, setConfirmedRideStatus] = useState<string | null>(null);
  const [confirmedRideId, setConfirmedRideId] = useState<string | null>(null);
  const ratingNavRef = useRef<Set<string>>(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('Houston, TX');
  const [promotionIndex, setPromotionIndex] = useState(0);
  const promotionScrollRef = useRef<ScrollView>(null);
  const { promotions, loading: promotionsLoading, isPromotionClaimed } = usePromotions();
  const promotionCardWidth = Math.min(windowWidth, 430) - 52;
  const promotionSnapInterval = promotionCardWidth + 12;

  useEffect(() => uid ? subscribeRiderProfile(uid, setProfile) : undefined, [uid]);
  useEffect(() => uid ? subscribeRiderConfirmedRides(uid, setConfirmed) : undefined, [uid]);
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
        .sort((a, b) => ts(b) - ts(a));
      setActiveRequests(merged);
    };

    // Standard ride requests (rider-initiated, driver browses)
    const qA = query(collection(firestore, 'rideRequests'), where('riderId', '==', uid));
    const unsubA = onSnapshot(qA, (snap) => {
      snapA = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      merge();
    });

    // Rider booking from a driver's posting (ridePostingRequests)
    const qB = query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', uid));
    const unsubB = onSnapshot(qB, (snap) => {
      snapB = snap.docs.map((d) => ({ id: d.id, _isPostingRequest: true, ...d.data() }));
      merge();
    });

    return () => { unsubA(); unsubB(); };
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    const activeOfferStatuses = ['pending', 'sent', 'offer', 'offer_sent', 'offered'];
    const q = query(
      collection(firestore, 'rideOffers'),
      where('riderId', '==', uid),
    );
    return onSnapshot(q, (snap) => {
      const map = new Map<string, { offerId: string; driverId?: string }>();
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        const status = String(data.status || '').toLowerCase();
        if (activeOfferStatuses.includes(status) && data.rideRequestId) {
          map.set(String(data.rideRequestId), { offerId: d.id, driverId: data.driverId });
        }
      });
      setRequestsWithOffers(map);
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
    const inProgress = confirmed.find((r) => String(r.status || '').toUpperCase() === 'IN_PROGRESS');
    if (inProgress) return inProgress;
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
    return hasOffer ? { offerId: nextRequest.offerId || nextRequest.rideOfferId || '', driverId: nextRequest.driverId } : null;
  }, [nextRequest, requestsWithOffers]);

  const nextRequestHasOffer = !!nextRequestOfferInfo;

  const nextRequestIsConfirmed = !!nextRequest && ['accepted', 'confirmed'].includes(String(nextRequest.status || nextRequest.state || '').toLowerCase());

  // Watch confirmedRides by rideRequestId so we get live status updates (e.g. CONFIRMED → IN_PROGRESS)
  // rideRequests.status never gets updated by the backend after pickup, so this is the only reliable source.
  useEffect(() => {
    if (!nextRequest?.id || !nextRequestIsConfirmed) {
      setConfirmedRideStatus(null);
      setConfirmedRideId(null);
      return;
    }
    const q = query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', nextRequest.id));
    return onSnapshot(q, async (snap) => {
      if (!snap.empty) {
        const d = snap.docs[0];
        const rideData = d.data();
        const status = String(rideData.status || '').toUpperCase();
        setConfirmedRideId(d.id);
        setConfirmedRideStatus(status);
        if (status === 'COMPLETED' && !ratingNavRef.current.has(d.id)) {
          ratingNavRef.current.add(d.id);
          const alreadyRated = !!rideData.riderRated || await hasUserRatedRide(d.id, uid);
          if (!alreadyRated) router.push({ pathname: '/(rider)/rate-trip', params: { confirmedRideId: d.id } } as any);
        }
      } else {
        setConfirmedRideId(null);
        setConfirmedRideStatus(null);
      }
    });
  }, [nextRequest?.id, nextRequestIsConfirmed]);

  const isRideInProgress = ['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED'].includes(confirmedRideStatus ?? '');
  const isDriverCompleted = confirmedRideStatus === 'DRIVER_COMPLETED';

  const heroPrompt = useMemo(() => {
    if (confirmedRideStatus === 'COMPLETED') return 'where to?';
    if (isDriverCompleted) return 'your driver has completed the ride!';
    if (isRideInProgress) return 'your ride is in progress!';
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
  }, [nextRequest, nextRide, nextRequestHasOffer, nextRequestIsConfirmed, isRideInProgress, isDriverCompleted, confirmedRideStatus]);
  const search = () => router.push({ pathname: '/(rider)/available-rides', params: { from: from.trim(), to: to.trim() } } as any);

  return (
    <PhoneScreen activeTab="home">
        <HomeUtilityBar university={profile?.university} initial={firstName.charAt(0).toUpperCase()} avatarUrl={profile?.avatarUrl} />
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Hey {firstName} - <Text style={styles.heroAccent}>{heroPrompt}</Text></Text>
        </View>
        {(nextRide || nextRequest) && confirmedRideStatus !== 'COMPLETED' ? (
          <View style={styles.homePrimaryBlock}>
            {nextRide ? <LiveRideCard ride={nextRide} /> : <RiderActivityCard request={nextRequest} offerInfo={nextRequestOfferInfo} confirmedRideStatus={confirmedRideStatus} confirmedRideId={confirmedRideId} />}
          </View>
        ) : (
          <View style={styles.homePrimarySearchBlock}>
            <RouteCard cta from={from} to={to} onChangeFrom={setFrom} onChangeTo={setTo} onSearch={search} />
          </View>
        )}
        {promotionsLoading && promotions.length === 0 ? (
          <View style={styles.promotionLoading}><ActivityIndicator color={ORANGE} /></View>
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
            <Ionicons name="gift-outline" size={24} color={ORANGE} />
            <View style={{ flex: 1 }}>
              <Text style={styles.promotionEmptyTitle}>No active promotions</Text>
              <Text style={styles.promotionEmptyText}>Check back soon for new student offers.</Text>
            </View>
          </View>
        )}
        <PopularRoutesSection />
    </PhoneScreen>
  );
}

function LiveRideCard({ ride }: { ride: MobileRidePosting }) {
  const isInProgress = String(ride.status || '').toUpperCase() === 'IN_PROGRESS';
  const statusLabel = isInProgress ? 'IN PROGRESS' : 'CONFIRMED';
  const statusColor = isInProgress ? '#DE5D20' : '#16A34A';
  const statusBg    = isInProgress ? 'rgba(222,93,32,0.08)' : '#EDFAF3';
  const rideDate = ride.date
    ? ride.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    : 'Date pending';
  const rideTime = ride.date
    ? ride.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'Time pending';

  const [driverName, setDriverName] = useState(ride.driverName);
  const [vehicleText, setVehicleText] = useState(ride.vehicle);
  const [driverPhotoURL, setDriverPhotoURL] = useState<string | null>(null);

  useEffect(() => {
    setDriverName(ride.driverName);
    setVehicleText(ride.vehicle);
    setDriverPhotoURL(null);
    const driverId = ride.driverId || ride.raw?.driverId;
    if (!driverId) return;
    let cancelled = false;
    getDoc(doc(firestore, 'drivers', driverId)).then((snap) => {
      if (cancelled || !snap.exists()) return;
      const d = snap.data();
      const name = [d.firstName, d.lastName].filter(Boolean).join(' ').trim()
        || d.displayName || d.name || '';
      if (name) setDriverName(name);
      const vi = d.vehicleInfo || {};
      const vehicle = [vi.year, vi.color, vi.make, vi.model].filter(Boolean).join(' ');
      if (vehicle) setVehicleText(vehicle);
      const photo = d.photoURL || d.avatarUrl || d.profilePicture || null;
      setDriverPhotoURL(photo);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ride.id]);

  return (
    <TouchableOpacity style={styles.rideCard} onPress={() => isInProgress ? router.push(`/(rider)/trip/${ride.id}` as any) : router.push(`/(rider)/ride/${ride.id}` as any)}>
      <View style={styles.confirmedCardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: statusBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>{statusLabel}</Text>
        </View>
        <View style={styles.confirmedFareBlock}>
          <Text style={styles.confirmedFareLabel}>TOTAL</Text>
          <Text style={styles.cardPrice}>${ride.price.toFixed(2)}</Text>
        </View>
      </View>
      <View style={styles.rideMain}>
        <RouteDots compact />
        <View style={{ flex: 1 }}>
          <View style={styles.rideLine}><Text style={styles.ridePlace}>{ride.from}</Text></View>
          <View style={styles.rideLine}><Text style={styles.ridePlace}>{ride.to}</Text></View>
        </View>
      </View>
      <View style={styles.confirmedSchedule}>
        <View style={styles.confirmedScheduleItem}>
          <Ionicons name="calendar-outline" size={16} color={MUTED} />
          <Text style={styles.rideTime}>{rideDate}</Text>
        </View>
        <View style={styles.confirmedScheduleItem}>
          <Ionicons name="time-outline" size={16} color={MUTED} />
          <Text style={styles.rideTime}>{rideTime}</Text>
        </View>
      </View>
      <View style={styles.driverFooter}>
        <View style={[styles.avatar, { overflow: 'hidden' }]}>
          {driverPhotoURL
            ? <Image source={{ uri: driverPhotoURL }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            : <Text style={styles.avatarText}>{driverName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}</Text>}
        </View>
        <Text style={styles.driverSmall}>{driverName}{'\n'}{ride.driverRating ? `★ ${ride.driverRating.toFixed(2)} · ` : ''}{vehicleText}</Text>
      </View>
    </TouchableOpacity>
  );
}

// Each confirmed ride has exactly one chat, created by Cloud Function when confirmedRides doc is made.
// rideId on the chat doc = the confirmedRides document ID (NOT rideRequests ID).
async function openChatForConfirmedRide(rideRequestId: string, navigate: (chatId: string) => void) {
  // Look up the confirmedRides doc for this request
  const confirmedSnap = await getDocs(
    query(collection(firestore, 'confirmedRides'), where('rideRequestId', '==', rideRequestId))
  );
  if (confirmedSnap.empty) {
    Alert.alert('Not available', 'The chat opens once the ride is confirmed.');
    return;
  }
  const confirmedRideId = confirmedSnap.docs[0].id;
  // Find the chat created by the Cloud Function
  const chatSnap = await getDocs(
    query(collection(firestore, 'chats'), where('rideId', '==', confirmedRideId))
  );
  if (!chatSnap.empty) {
    navigate(chatSnap.docs[0].id);
  } else {
    Alert.alert('Not available', 'The chat will be available shortly after confirmation.');
  }
}

function RiderActivityCard({ request, offerInfo, confirmedRideStatus, confirmedRideId }: { request: any; offerInfo?: { offerId: string; driverId?: string } | null; confirmedRideStatus?: string | null; confirmedRideId?: string | null }) {
  const pickup = request.pickupAddress || request.pickup || request.from || 'Pickup pending';
  const dropoff = request.dropoffAddress || request.dropoff || request.to || 'Destination pending';
  const price = Number(request.maxPrice || request.estimatedFare || request.price || 0);
  const rawStatus = String(request.status || request.state || '').toLowerCase();
  const isConfirmed = rawStatus === 'accepted' || rawStatus === 'confirmed';
  const normalizedStatus = String(confirmedRideStatus || '').toUpperCase();
  const isInProgress = ['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED'].includes(normalizedStatus);
  const isDriverCompleted = normalizedStatus === 'DRIVER_COMPLETED';
  const hasOffer = !isConfirmed && !!offerInfo;
  const [acting, setActing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const openChat = async () => {
    try {
      await openChatForConfirmedRide(request.id, (chatId) => router.push(`/(rider)/messages/${chatId}` as any));
    } catch {
      Alert.alert('Error', 'Could not open chat. Please try again.');
    }
  };

  const handleAccept = async () => {
    if (!offerInfo?.offerId) return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    Alert.alert('Accept offer?', 'This will confirm the ride with the driver.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Accept',
        onPress: async () => {
          setActing(true);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);
          try {
            const { getApiBaseUrl } = await import('@/constants/services');
            const res = await fetch(`${getApiBaseUrl()}/api/accept-ride-offer`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ offerId: offerInfo.offerId, riderId: uid, driverId: offerInfo.driverId }),
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
            const msg = e?.name === 'AbortError'
              ? 'Request timed out. Please check your connection and try again.'
              : (e?.message || 'Could not accept the offer. Please try again.');
            Alert.alert('Failed', msg);
          } finally {
            setActing(false);
          }
        },
      },
    ]);
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

  return (
    <View style={styles.rideCard}>
      {/* Status row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 5,
          backgroundColor: isDriverCompleted ? '#FFF3EE' : isInProgress ? 'rgba(222,93,32,0.08)' : isConfirmed ? '#EDFAF3' : hasOffer ? '#FFF3EE' : '#F1F3F6',
          borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
          alignSelf: 'flex-start',
        }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isDriverCompleted ? ORANGE : isInProgress ? ORANGE : isConfirmed ? '#16A34A' : hasOffer ? ORANGE : '#8B94A6' }} />
          <Text style={{ color: isDriverCompleted ? ORANGE : isInProgress ? ORANGE : isConfirmed ? '#16A34A' : hasOffer ? ORANGE : '#8B94A6', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>
            {isDriverCompleted ? 'CONFIRM ARRIVAL' : isInProgress ? 'IN PROGRESS' : isConfirmed ? 'CONFIRMED' : hasOffer ? 'OFFER RECEIVED' : 'PENDING'}
          </Text>
        </View>
        {price > 0 && (
          <Text style={{ color: NAVY, fontSize: 15, fontWeight: '800' }}>${price.toFixed(0)}</Text>
        )}
      </View>

      {/* Route */}
      <TouchableOpacity activeOpacity={0.7} onPress={() => router.push('/(rider)/requests' as any)}>
        <View style={styles.rideMain}>
          <RouteDots compact />
          <View style={{ flex: 1 }}>
            <Text style={styles.ridePlace}>{pickup}</Text>
            <Text style={[styles.rideMeta, { marginVertical: 6 }]}>
              {request.date || 'Date pending'}{request.time ? ` · ${request.time}` : ''}
            </Text>
            <Text style={styles.ridePlace}>{dropoff}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Actions */}
      <View style={styles.activityCardActions}>
        {isDriverCompleted ? (
          <>
            <TouchableOpacity
              style={[styles.actionBtnPrimary, { flex: 2, backgroundColor: NAVY }, confirming && { opacity: 0.6 }]}
              disabled={confirming}
              activeOpacity={0.8}
              onPress={async () => {
                if (!confirmedRideId) return;
                setConfirming(true);
                await riderCompleteRide(confirmedRideId);
                setConfirming(false);
              }}
            >
              {confirming
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={styles.actionBtnPrimaryText}>Confirm Arrival</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1 }]}
              onPress={() => confirmedRideId && router.push(`/(rider)/trip/${confirmedRideId}` as any)}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>View Map</Text>
            </TouchableOpacity>
          </>
        ) : isInProgress ? (
          <>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={openChat}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>Message Driver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1 }]}
              onPress={() => confirmedRideId && router.push(`/(rider)/trip/${confirmedRideId}` as any)}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>Live View</Text>
            </TouchableOpacity>
          </>
        ) : isConfirmed ? (
          <>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={openChat}
              disabled={false}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>Message Driver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnSecondary, { flex: 1 }]}
              onPress={() => router.push(`/(rider)/ride/${request.id}` as any)}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>View Details</Text>
            </TouchableOpacity>
          </>
        ) : hasOffer ? (
          <>
            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => offerInfo?.driverId && router.push({ pathname: '/(rider)/driver/[driverId]', params: { driverId: offerInfo.driverId } } as any)}
              disabled={acting || !offerInfo?.driverId}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnSecondaryText}>View Driver</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtnPrimary, acting && { opacity: 0.6 }]}
              onPress={handleAccept}
              disabled={acting}
              activeOpacity={0.8}
            >
              <Text style={styles.actionBtnPrimaryText}>{acting ? 'Accepting…' : 'Accept'}</Text>
            </TouchableOpacity>
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
    </View>
  );
}

function PopularRoutesSection() {
  const routes = [
    { from: 'Austin', to: 'Houston', meta: 'Most active Fridays', price: '$28' },
    { from: 'Austin', to: 'Dallas', meta: 'Weekend favorite', price: '$32' },
    { from: 'Austin', to: 'San Antonio', meta: 'Quick campus trips', price: '$18' },
  ];

  return (
    <View style={styles.homeSection}>
      <SectionHeader title="Popular routes" action="Browse" />
      <View style={styles.popularRouteList}>
        {routes.map((route) => (
          <TouchableOpacity
            key={`${route.from}-${route.to}`}
            style={styles.popularRouteCard}
            onPress={() => router.push({ pathname: '/(rider)/available-rides', params: { from: route.from, to: route.to } } as any)}
            accessibilityRole="button"
          >
            <View style={styles.popularRouteIcon}>
              <Ionicons name="navigate-outline" size={18} color={ORANGE} />
            </View>
            <View style={styles.popularRouteCopy}>
              <Text style={styles.popularRouteTitle}>{route.from} {'->'} {route.to}</Text>
              <Text style={styles.popularRouteMeta}>{route.meta}</Text>
            </View>
            <Text style={styles.popularRoutePrice}>{route.price}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderRequestReferencePlaceholder() {
  return (
    <PhoneScreen activeTab="find">
      <View style={styles.pageIntro}>
        <Text style={styles.pageTitle}>Request a ride</Text>
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

      <Text style={styles.eyebrow}>MAX PRICE PER SEAT</Text>
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
  const params = useLocalSearchParams<{ pickup?: string; dropoff?: string }>();
  const initialPickup = String(params.pickup || '');
  const [pickup, setPickup] = useState(initialPickup);
  const [dropoff, setDropoff] = useState(String(params.dropoff || ''));
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [price, setPrice] = useState('28');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialPickup.trim()) return;
    let cancelled = false;

    (async () => {
      const current = await getCurrentLocationAddressAsync();
      if (!cancelled && current) setPickup(current);
    })();

    return () => {
      cancelled = true;
    };
  }, [initialPickup]);

  const submit = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) return Alert.alert('Sign in required', 'Please sign in again.');
    if (!pickup.trim() || !dropoff.trim() || !date.trim()) return Alert.alert('Missing details', 'Add pickup, destination, and date.');
    try {
      setSubmitting(true);
      await addDoc(collection(firestore, 'rideRequests'), {
        riderId: user.uid,
        riderEmail: user.email || null,
        pickup: pickup.trim(),
        pickupAddress: pickup.trim(),
        dropoff: dropoff.trim(),
        dropoffAddress: dropoff.trim(),
        date: date.trim(),
        time: time.trim() || null,
        seats: 1,
        maxPrice: Number(price) || 0,
        estimatedFare: Number(price) || 0,
        notes: notes.trim(),
        status: 'pending',
        state: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Request posted', 'Drivers can now send you offers.');
      router.replace('/(rider)/requests' as any);
    } catch (error: any) {
      Alert.alert('Could not post request', error?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PhoneScreen activeTab="find">
      <View style={styles.pageIntro}>
        <Text style={styles.pageTitle}>Request a ride</Text>
      </View>
      <Text style={styles.eyebrow}>WHERE & WHEN</Text>
      <View style={styles.searchCard}>
        <View style={styles.routeRow}><RouteDots /><View style={styles.routeInputs}><TextInput style={styles.inputPill} value={pickup} onChangeText={setPickup} placeholder="Pickup location" placeholderTextColor={MUTED} /><TextInput style={styles.inputPill} value={dropoff} onChangeText={setDropoff} placeholder="Destination" placeholderTextColor={MUTED} /></View></View>
        <View style={styles.metaRow}><TextInput style={styles.metaPill} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={MUTED} /><TextInput style={styles.metaPill} value={time} onChangeText={setTime} placeholder="Time" placeholderTextColor={MUTED} /></View>
      </View>
      <Text style={styles.eyebrow}>MAX PRICE PER SEAT</Text>
      <View style={styles.priceBox}><Text style={styles.bigPrice}>$</Text><TextInput style={styles.priceInput} value={price} onChangeText={setPrice} keyboardType="decimal-pad" /></View>
      <Text style={styles.eyebrow}>NOTE</Text>
      <TextInput style={styles.noteBox} multiline value={notes} onChangeText={setNotes} placeholder="Luggage, pickup flexibility, or anything drivers should know" placeholderTextColor={MUTED} />
      <TouchableOpacity disabled={submitting} style={[styles.primaryBtnFull, styles.requestSubmitButton]} onPress={submit}><Text style={styles.primaryText}>{submitting ? 'Posting...' : 'Post request ->'}</Text></TouchableOpacity>
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
  return (
    <PhoneScreen activeTab="rides">
      <View style={styles.pageIntro}>
        <Text style={styles.pageTitle}>Available rides</Text>
      </View>
      <View style={styles.findSearch}>
        <Ionicons name="search" size={18} color={NAVY} />
        <View style={{ flex: 1 }}><Text style={styles.findSearchLabel}>YOUR ROUTE</Text><Text style={styles.findSearchText}>{'Austin -> Houston · Fri, Nov 20'}</Text></View>
        <Ionicons name="options-outline" size={19} color={NAVY} />
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
  const { from, to } = useLocalSearchParams<{ from?: string; to?: string }>();
  const [liveRides, setLiveRides] = useState<MobileRidePosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRequestedPostingIds, setMyRequestedPostingIds] = useState<Set<string>>(new Set());
  const searchQuery = useRideBrowseStore((state) => state.riderSearch);
  const timeFilter = useRideBrowseStore((state) => state.riderFilter);
  const setSearchQuery = useRideBrowseStore((state) => state.setRiderSearch);
  const setTimeFilter = useRideBrowseStore((state) => state.setRiderFilter);

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
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return undefined;
    const inactive = new Set(['cancelled', 'canceled', 'rejected', 'declined', 'completed']);
    const q = query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', uid));
    return onSnapshot(q, (snap) => {
      const ids = new Set<string>();
      snap.forEach((d) => {
        const r = d.data() as any;
        const status = String(r.status || '').toLowerCase();
        if (inactive.has(status)) return;
        const postingId = r.ridePostingId || r.rideId || '';
        if (postingId) ids.add(postingId);
      });
      setMyRequestedPostingIds(ids);
    });
  }, []);

  const filteredRides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return liveRides.filter((ride) => {
      // Hide rides this rider has already requested (unless they cancel, which removes from the set)
      if (myRequestedPostingIds.has(ride.id)) return false;
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
  }, [liveRides, searchQuery, timeFilter, myRequestedPostingIds]);

  const formatRideTime = (date: Date | null | undefined) => {
    if (!date) return '';
    return date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  };

  const chips: { key: TimeFilter; label: string }[] = [
    { key: 'all', label: `ALL\n${liveRides.length}` },
    { key: 'morning', label: 'Morning' },
    { key: 'afternoon', label: 'Afternoon' },
    { key: 'evening', label: 'Evening' },
    { key: 'rating', label: '★\n4.8+' },
  ];

  return (
    <PhoneScreen activeTab="rides">
      <View style={styles.pageIntro}>
        <Text style={styles.pageTitle}>Available rides</Text>
      </View>

      <View style={styles.findSearch}>
        <Ionicons name="search" size={18} color={NAVY} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by driver, city..."
          placeholderTextColor={MUTED}
          style={styles.availableSearchInput}
          returnKeyType="search"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={hitSlop}>
            <Ionicons name="close" size={18} color={MUTED} />
          </TouchableOpacity>
        ) : null}
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

      {loading ? <ActivityIndicator color={ORANGE} size="large" /> : null}

      {filteredRides.map((ride) => {
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
            <View style={styles.availableTop}>
              <View style={styles.navyDot} />
              <Text style={[styles.availableRoute, { flex: 1 }]} numberOfLines={1}>{ride.from} → {ride.to}</Text>
              <Text style={styles.availableTime}>{formatRideTime(ride.date)}</Text>
            </View>
            <View style={styles.availableDash} />
            <View style={[styles.availableBottom, { paddingTop: 0 }]}>
              <View style={styles.avatar}>{ride.driverAvatarUrl ? <Image source={{ uri: ride.driverAvatarUrl }} style={styles.availableAvatarImage} resizeMode="cover" /> : <Text style={styles.avatarText}>{initials}</Text>}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.driverName}</Text>
                <Text style={styles.driverMeta}>{meta}</Text>
              </View>
              <Text style={styles.availablePrice}>${Math.round(ride.price)}</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      {!loading && !filteredRides.length ? (
        <View style={styles.availableEmptyState}>
          <View style={styles.availableEmptyIcon}><Ionicons name="car-outline" size={27} color={ORANGE} /></View>
          <Text style={styles.availableEmptyTitle}>{liveRides.length ? 'No rides match' : 'No rides posted yet'}</Text>
          <Text style={styles.availableEmptyText}>
            {liveRides.length
              ? 'Try a different search or clear the filter.'
              : 'Request your trip and let nearby drivers send you an offer.'}
          </Text>
          <TouchableOpacity
            style={styles.availableEmptyPrimary}
            onPress={() => liveRides.length ? (setSearchQuery(''), setTimeFilter('all')) : router.push('/(rider)/book')}
            accessibilityRole="button"
          >
            <Ionicons name={liveRides.length ? 'refresh-outline' : 'add-circle-outline'} size={18} color="#FFFFFF" />
            <Text style={styles.availableEmptyPrimaryText}>{liveRides.length ? 'Clear filters' : 'Request a ride'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </PhoneScreen>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderDetailReferencePlaceholder() {
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
        <View style={styles.vehicleIcon}><Ionicons name="car-sport" size={24} color="#6B7280" /></View>
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
  const { id } = useLocalSearchParams<{ id?: string }>();
  const rideId = Array.isArray(id) ? id[0] : id;
  const { goBack: goBackFromDetails } = useReturnNavigation('/(rider)/available-rides');
  const [ride, setRide] = useState<MobileRidePosting | null>(null);
  const [confirmedRequest, setConfirmedRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paymentVisible, setPaymentVisible] = useState(false);

  useEffect(() => {
    if (!rideId) { setLoading(false); return; }
    (async () => {
      try {
        const posting = await getRidePosting(rideId);
        if (posting) { setRide(posting); return; }
        // Fall back: treat rideId as a rideRequests doc
        const { getDoc: gd, doc: dc, collection: col, query: q, where: wh, getDocs: gds } = await import('firebase/firestore');
        const { firestore: db } = await import('@/constants/services');
        const reqSnap = await gd(dc(db, 'rideRequests', rideId));
        if (!reqSnap.exists()) return;
        const reqData = reqSnap.data() as any;
        // Also try to get confirmed ride doc for driver info
        const confirmedSnap = await gds(q(col(db, 'confirmedRides'), wh('rideRequestId', '==', rideId)));
        const confirmedData = !confirmedSnap.empty ? confirmedSnap.docs[0].data() as any : null;
        // Fetch driver profile if we have driverId
        const driverId = confirmedData?.driverId || reqData.confirmedDriver || reqData.driverId;
        let driverData: any = null;
        if (driverId) {
          const driverSnap = await gd(dc(db, 'drivers', driverId));
          if (driverSnap.exists()) driverData = driverSnap.data();
        }
        setConfirmedRequest({ req: reqData, confirmed: confirmedData, driver: driverData, driverId });
      } catch {}
      finally { setLoading(false); }
    })();
  }, [rideId]);

  if (loading) {
    return <PhoneScreen title="Ride Details" showBack onBack={goBackFromDetails}><ActivityIndicator color={ORANGE} size="large" /></PhoneScreen>;
  }

  // Confirmed request view
  if (confirmedRequest) {
    const { req, driver, driverId } = confirmedRequest;
    const driverName = driver?.fullName || driver?.name || driver?.displayName || 'Driver';
    const driverInitials = driverName.split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
    const driverRating = driver?.rating ? Number(driver.rating).toFixed(1) : null;
    const vehicle = [driver?.vehicleYear, driver?.vehicleMake, driver?.vehicleModel].filter(Boolean).join(' ') || driver?.vehicle || '';
    const pickup = req.pickupAddress || req.pickup || req.from || 'Pickup';
    const dropoff = req.dropoffAddress || req.dropoff || req.to || 'Destination';
    const fare = req.estimatedFare ? `$${Number(req.estimatedFare).toFixed(2)}` : req.maxPrice ? `$${Number(req.maxPrice).toFixed(0)}` : null;
    const BG2 = '#FBFAF7', BDR = '#E5E0D8', MUT = '#8B94A6';

    const openDriverChat = async () => {
      try {
        await openChatForConfirmedRide(rideId!, (chatId) => router.push(`/(rider)/messages/${chatId}` as any));
      } catch {
        Alert.alert('Error', 'Could not open chat. Please try again.');
      }
    };

    const cancelRide = () => {
      Alert.alert('Cancel ride?', 'Are you sure you want to cancel this confirmed ride?', [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel ride',
          style: 'destructive',
          onPress: async () => {
            try {
              const { doc: dc, updateDoc, serverTimestamp: st } = await import('firebase/firestore');
              const { firestore: db } = await import('@/constants/services');
              await updateDoc(dc(db, 'rideRequests', rideId!), { status: 'cancelled', updatedAt: st() });
              router.back();
            } catch {
              Alert.alert('Failed', 'Could not cancel the ride. Please try again.');
            }
          },
        },
      ]);
    };

    return (
      <View style={{ flex: 1, backgroundColor: BG2 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          >
            {/* Header */}
            <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingTop: 4, marginBottom: 16 }}>
              <TouchableOpacity
                onPress={goBackFromDetails}
                style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BDR, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.75}
              >
                <Ionicons name="chevron-back" size={22} color={NAVY} />
              </TouchableOpacity>
              <Text style={{ color: NAVY, fontSize: 24, fontWeight: '700', letterSpacing: -0.25, marginLeft: 12, flex: 1 }}>Ride Details</Text>
            </View>

            {/* Status badge */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#16A34A' }} />
              <Text style={{ color: '#16A34A', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>CONFIRMED</Text>
            </View>

            {/* Driver card */}
            <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#EEE8DF', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: NAVY, fontSize: 18, fontWeight: '700' }}>{driverInitials || '?'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: NAVY, fontSize: 16, fontWeight: '700' }}>{driverName}</Text>
                  <Text style={{ color: MUT, fontSize: 13, marginTop: 2 }}>{driverRating ? `★ ${driverRating}` : 'Driver confirmed'}</Text>
                </View>
                {driverId && (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/(rider)/driver/[driverId]', params: { driverId, returnTo: `/(rider)/ride/${rideId}` } } as any)}
                    style={{ backgroundColor: '#F3EFE8', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 }}
                  >
                    <Text style={{ color: NAVY, fontSize: 12, fontWeight: '700' }}>View profile</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ alignItems: 'center', paddingTop: 4, gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: NAVY }} />
                  <View style={{ width: 1, flex: 1, backgroundColor: BDR }} />
                  <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: ORANGE }} />
                </View>
                <View style={{ flex: 1, gap: 10 }}>
                  <Text style={{ color: NAVY, fontSize: 15, fontWeight: '600' }}>{pickup}</Text>
                  <Text style={{ color: MUT, fontSize: 12 }}>{req.date || ''}{req.time ? ` · ${req.time}` : ''}</Text>
                  <Text style={{ color: NAVY, fontSize: 15, fontWeight: '600' }}>{dropoff}</Text>
                </View>
              </View>
            </View>

            {/* Vehicle */}
            {vehicle ? (
              <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#FEF0E8', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="car-sport-outline" size={20} color={ORANGE} />
                </View>
                <View>
                  <Text style={{ color: NAVY, fontSize: 15, fontWeight: '600' }}>{vehicle}</Text>
                  <Text style={{ color: MUT, fontSize: 12, marginTop: 2 }}>Verified vehicle</Text>
                </View>
              </View>
            ) : null}

            {/* Fare */}
            {fare ? (
              <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ color: MUT, fontSize: 13 }}>Fare</Text>
                  <Text style={{ color: NAVY, fontSize: 13, fontWeight: '700' }}>{fare}</Text>
                </View>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: BDR, marginBottom: 10 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: MUT, fontSize: 13 }}>Status</Text>
                  <Text style={{ color: '#16A34A', fontSize: 13, fontWeight: '700' }}>Confirmed</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Bottom actions */}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: BG2, borderTopWidth: 1, borderTopColor: BDR, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32, gap: 10 }}>
            {driverId && (
              <TouchableOpacity
                style={{ backgroundColor: NAVY, borderRadius: 28, paddingVertical: 14, alignItems: 'center' }}
                onPress={openDriverChat}
                activeOpacity={0.85}
              >
                <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>Message Driver</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={{ backgroundColor: '#FEF2F2', borderRadius: 28, paddingVertical: 14, alignItems: 'center' }}
              onPress={cancelRide}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#B91C1C', fontSize: 15, fontWeight: '700' }}>Cancel Ride</Text>
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
  return (
    <>
      <PhoneScreen
        title="Ride Details"
        showBack
        onBack={goBackFromDetails}
        bottomAction={<TouchableOpacity style={styles.primaryBtnFull} onPress={() => setPaymentVisible(true)}><Text style={styles.primaryText}>Request seat - ${ride.price.toFixed(2)}</Text></TouchableOpacity>}
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
              <Text style={styles.detailMeta}>{ride.driverRating ? `★ ${ride.driverRating.toFixed(2)} · ` : ''}{ride.seats} seats available</Text>
            </View>
            {ride.driverId ? <Ionicons name="chevron-forward" size={18} color={MUTED} /> : null}
          </TouchableOpacity>
          <View style={styles.detailRoute}>
            <RouteDots compact connected />
            <View style={styles.detailRouteCopy}>
              <View>
                <View style={styles.detailLocationRow}>
                  <Text style={styles.detailLocation} numberOfLines={2}>{ride.from}</Text>
                  <Text style={styles.detailTime}>{ride.date ? ride.date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'TIME TBD'}</Text>
                </View>
                <Text style={styles.rideMeta}>{ride.seats} seats available</Text>
              </View>
              <Text style={styles.detailLocation} numberOfLines={2}>{ride.to}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.detailCard, styles.detailInfoRow]}>
          <View style={styles.detailInfoIcon}><Ionicons name="car-sport" size={23} color="#6B7280" /></View>
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
        rideId={rideId}
        driverId={ride.driverId || null}
        baseFare={ride.price}
        onPaymentSuccess={async (paymentIntentId: string) => {
          setPaymentVisible(false);
          const riderId = firebaseAuth.currentUser?.uid;
          const user = firebaseAuth.currentUser;

          try {
            if (riderId) {
              // ride.raw is the raw Firestore data already loaded when this screen opened.
              // Use it directly — avoids a redundant getDoc and works even if Firestore
              // security rules restrict direct reads in this context.
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

              // driverId is available from ride.raw (same Firestore doc, already loaded)
              const driverId = rawStr(raw.driverId) || ride.driverId || null;
              const driverSnap = driverId
                ? await getDoc(doc(firestore, 'drivers', driverId)).catch(() => null)
                : null;
              const dd = driverSnap?.exists() ? driverSnap.data() as any : {};
              const driverFullName = [dd.firstName, dd.lastName].filter(Boolean).join(' ').trim()
                || dd.displayName || rawStr(raw.driverName) || ride.driverName || 'Driver';
              const driverEmail = dd.email || rawStr(raw.driverEmail) || '';

              // Write directly to ridePostingRequests — rider home now subscribes to this collection
              const reqData: Record<string, any> = {
                ridePostingId: rideId,
                rideId,
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

              // Cancel any stale pending requests from this rider for the same posting.
              // Single where clause only — compound queries need a Firestore composite index
              // which may not exist; in-memory filter handles the posting ID check.
              const staleSnap = await getDocs(
                query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', riderId))
              ).catch(() => null);
              if (staleSnap) {
                const terminal = new Set(['cancelled', 'canceled', 'rejected', 'completed', 'accepted', 'confirmed']);
                await Promise.all(
                  staleSnap.docs
                    .filter((d) => {
                      const r = d.data() as any;
                      const pid = r.ridePostingId || r.rideId || '';
                      return pid === rideId && !terminal.has(String(r.status || '').toLowerCase());
                    })
                    .map((d) => updateDoc(doc(firestore, 'ridePostingRequests', d.id), {
                      status: 'cancelled',
                      updatedAt: serverTimestamp(),
                    }))
                ).catch(() => {});
              }

              await addDoc(collection(firestore, 'ridePostingRequests'), reqData);

              // Best-effort: trigger server-side driver notification
              try {
                const { getApiBaseUrl } = await import('@/constants/services');
                const base = getApiBaseUrl();
                await fetch(`${base}/api/rides/${rideId}/request`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ paymentIntentId, riderId, driverId }),
                });
              } catch {}
            }
          } catch (e) {
            console.warn('[booking] ride request creation failed', e);
          }

          router.replace({
            pathname: '/(rider)/booking-confirmed',
            params: { rideId, driverId: ride.driverId || '', driverName: ride.driverName || '' },
          } as any);
        }}
      />
    </>
  );
}

export function RiderConfirmedReference() {
  const { rideId, driverId: driverIdParam, driverName: driverNameParam } = useLocalSearchParams<{ rideId?: string; driverId?: string; driverName?: string }>();
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
      <LinearGradient colors={['#F2D9C5', '#FAF4EE', '#FBFAF7']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={ORANGE} size="large" />
      </LinearGradient>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <LinearGradient colors={['#F2D9C5', '#FAF4EE', '#FBFAF7']} locations={[0, 0.45, 1]} style={{ flex: 1 }}>
        <SafeAreaView edges={['top']} />
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={{ alignItems: 'center', paddingTop: 44, paddingBottom: 32 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center',
              marginBottom: 24,
              shadowColor: ORANGE, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
            }}>
              <Ionicons name="checkmark" size={36} color="#FFF" />
            </View>

            <RNText style={{ fontFamily: FONT_SANS, fontSize: 30, fontWeight: '600', color: NAVY, textAlign: 'center', lineHeight: 36 }}>
              {'Request '}
              <RNText style={{ fontFamily: FONT_SANS, color: ORANGE, fontStyle: 'italic', fontWeight: '600' }}>
                successful!
              </RNText>
            </RNText>
            <RNText style={{ fontSize: 15, color: MUTED, fontWeight: '500', marginTop: 10, textAlign: 'center', lineHeight: 22 }}>
              {firstName} has been notified and will{'\n'}respond soon.
            </RNText>
          </View>

          {/* Details card */}
          <View style={{
            backgroundColor: '#FFFFFFCC', borderRadius: 20,
            padding: 20, borderWidth: 1, borderColor: BORDER,
          }}>
            {from && to && (
              <>
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                  <View style={{ alignItems: 'center', paddingTop: 3, gap: 0 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: NAVY }} />
                    <View style={{ width: 1.5, height: 24, backgroundColor: BORDER, marginVertical: 2 }} />
                    <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: NAVY }} />
                  </View>
                  <View style={{ flex: 1, gap: 12 }}>
                    <RNText style={{ fontSize: 14, fontWeight: '600', color: NAVY }} numberOfLines={1}>{from}</RNText>
                    <RNText style={{ fontSize: 14, fontWeight: '600', color: NAVY }} numberOfLines={1}>{to}</RNText>
                  </View>
                </View>
                <View style={{ height: 1, backgroundColor: BORDER, marginBottom: 14 }} />
              </>
            )}

            {[
              dateLabel ? ['When', dateLabel] : null,
              ['Driver', [firstName, driverRating != null ? `★ ${driverRating.toFixed(2)}` : null].filter(Boolean).join('  ')],
              seats != null ? ['Seats available', `${seats}`] : null,
              price != null ? ['Charged', `$${price.toFixed(2)}`] : null,
            ].filter(Boolean).map(([label, value]) => (
              <View key={label as string} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <RNText style={{ fontSize: 13, color: MUTED, fontWeight: '500' }}>{label}</RNText>
                <RNText style={{ fontSize: 13, color: NAVY, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>{value}</RNText>
              </View>
            ))}
          </View>

          <RNText style={{ fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 14, lineHeight: 18 }}>
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
            style={{ backgroundColor: NAVY, borderRadius: 28, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            onPress={async () => {
              const riderId = firebaseAuth.currentUser?.uid;
              if (!riderId || !driverId) { router.replace('/(rider)/messages' as any); return; }
              // Find or create chat between rider and driver
              try {
                const chatsRef = collection(firestore, 'chats');
                const q1 = query(chatsRef, where('participants', 'array-contains', riderId));
                const snap = await getDocs(q1);
                const existing = snap.docs.find((d) => {
                  const p = d.data().participants || [];
                  return p.includes(driverId);
                });
                if (existing) {
                  router.replace({ pathname: '/(rider)/messages/[chatId]', params: { chatId: existing.id } } as any);
                } else {
                  const newChat = await addDoc(chatsRef, {
                    participants: [riderId, driverId],
                    rideId: rideId || null,
                    createdAt: serverTimestamp(),
                    lastMessage: null,
                    lastMessageTimestamp: null,
                  });
                  router.replace({ pathname: '/(rider)/messages/[chatId]', params: { chatId: newChat.id } } as any);
                }
              } catch {
                router.replace('/(rider)/messages' as any);
              }
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="chatbubble-outline" size={18} color="#FFF" />
            <RNText style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>Message {firstName}</RNText>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ paddingVertical: 12, alignItems: 'center' }}
            onPress={() => router.replace('/(rider)/' as any)}
            activeOpacity={0.75}
          >
            <RNText style={{ color: NAVY, fontSize: 15, fontWeight: '700' }}>Back to home</RNText>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  defaultText: { fontFamily: FONT_SANS },
  root: { flex: 1, backgroundColor: BG, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: BG },
  status: { height: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24 },
  statusTime: { fontFamily: FONT_SANS, fontSize: 14, fontWeight: '700', color: '#111827' },
  notch: { position: 'absolute', top: 9, left: '37%', right: '37%', height: 32, borderRadius: 16, backgroundColor: '#000' },
  statusIcons: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { ...appHeader.row, height: 64, paddingHorizontal: layout.screenPadding, marginHorizontal: -layout.screenPadding },
  mark: { color: ORANGE, fontSize: 14, fontWeight: '700', marginRight: 9 },
  headerTitle: { ...appHeader.title, fontFamily: FONT_SANS, color: NAVY },
  headerTitleAfterBack: { flexShrink: 1, marginLeft: 12 },
  circleBtn: { ...appHeader.iconButton, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER},
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingTop: 24 },
  contentWithScrollableHeader: { paddingTop: 0 },
  homeUtilityBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -6, marginBottom: 24 },
  homeBrandMark: { width: 36, height: 36, borderRadius: 12, overflow: 'hidden' },
  homeBrandLogo: { width: '100%', height: '100%' },
  campusChip: { flex: 1, minWidth: 0, height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 19, backgroundColor: '#F3EFE8' },
  campusText: { flex: 1, color: NAVY, fontSize: 13, fontWeight: '700' },
  utilityButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER },
  homeAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9E8DB', borderWidth: 1, borderColor: '#F3D7C6', overflow: 'hidden' },
  homeAvatarImage: { width: '100%', height: '100%', borderRadius: 20 },
  homeAvatarText: { color: ORANGE, fontSize: 15, fontWeight: '800' },
  pageIntro: { marginBottom: 12 },
  pageTitle: { ...appHeader.title, fontFamily: FONT_SANS, color: NAVY },
  heroCopy: { marginBottom: 22 },
  heroTitle: { fontFamily: FONT_SANS, color: NAVY, fontSize: 30, lineHeight: 36, fontWeight: '600' },
  heroAccent: { fontFamily: FONT_SANS, color: ORANGE, fontStyle: 'italic', fontWeight: '600' },
  heroSub: { color: MUTED, fontSize: 15, lineHeight: 21, marginTop: 5 },
  homePrimaryBlock: { marginBottom: 30 },
  homePrimarySearchBlock: { marginBottom: 4 },
  searchCard: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: BORDER, padding: 14, marginBottom: 28, shadowColor: NAVY, shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  routeRow: { flexDirection: 'row' },
  routeRail: { width: 28, alignItems: 'center', paddingTop: 16, paddingBottom: 16 },
  navyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NAVY },
  orangeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  dashedLine: { flex: 1, width: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 7 },
  connectedRouteLine: { width: 2, borderLeftWidth: 0, borderStyle: 'solid', backgroundColor: '#CBD5E1', marginVertical: 0 },
  connectedRouteRail: { height: 68, minHeight: 0, alignSelf: 'flex-start', paddingTop: 2, paddingBottom: 2 },
  routeInputs: { flex: 1, gap: 9 },
  inputPill: { fontFamily: FONT_SANS, height: 48, borderRadius: 13, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', paddingHorizontal: 14, justifyContent: 'center', color: NAVY, fontSize: 15, fontWeight: '500' },
  inputText: { color: NAVY, fontSize: 17, fontWeight: '600' },
  stopText: { fontFamily: FONT_MONO, color: MUTED, fontSize: 10, fontWeight: '500', marginLeft: 12 },
  metaRow: { flexDirection: 'row', gap: 9, paddingLeft: 28, marginTop: 9 },
  metaPill: { flex: 1, height: 44, borderRadius: 13, borderWidth: 1, borderColor: '#D7DCE3', justifyContent: 'center', paddingHorizontal: 13 },
  metaText: { color: NAVY, fontSize: 14, fontWeight: '600' },
  primaryBtn: { height: 54, borderRadius: 27, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginBottom: 34 },
  searchPrimaryBtn: { height: 48, borderRadius: 24, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryBtnFull: { height: 56, borderRadius: 28, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  requestSubmitButton: { marginTop: 22, marginBottom: 12 },
  primaryText: { fontFamily: FONT_SANS, color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontFamily: FONT_SANS, flex: 1, color: NAVY, fontSize: 17, fontWeight: '700' },
  sectionAction: { fontFamily: FONT_MONO, color: ORANGE, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  promotionList: { paddingBottom: 12, paddingRight: 8 },
  promotionDots: { height: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 18 },
  promotionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D6D0C7' },
  promotionDotActive: { width: 20, backgroundColor: SECONDARY },
  uberPromoCard: { height: 174, marginRight: 12, flexDirection: 'row', overflow: 'hidden', borderRadius: 20, borderWidth: 1, borderColor: '#E3DED6', backgroundColor: '#FFFFFF', shadowColor: NAVY, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 2 },
  uberPromoCopy: { width: '62%', paddingHorizontal: 18, paddingVertical: 17, justifyContent: 'space-between' },
  uberPromoTitle: { color: NAVY, fontSize: 21, lineHeight: 25, fontWeight: '800', letterSpacing: -0.35 },
  uberPromoDescription: { color: '#667085', fontSize: 12, lineHeight: 17, marginTop: 5 },
  uberPromoCta: { minHeight: 38, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 19, backgroundColor: '#F2F0EC', paddingHorizontal: 15, justifyContent: 'center' },
  uberPromoCtaClaimed: { backgroundColor: '#F9E8DB' },
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
  promotionLoading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  promotionEmptyCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18, marginBottom: 28 },
  promotionEmptyTitle: { color: NAVY, fontSize: 15, fontWeight: '700' },
  promotionEmptyText: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 3 },
  homeSection: { marginBottom: 28 },
  popularRouteList: { gap: 10 },
  popularRouteCard: { minHeight: 66, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, shadowColor: NAVY, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  popularRouteIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center' },
  popularRouteCopy: { flex: 1, minWidth: 0 },
  popularRouteTitle: { color: NAVY, fontSize: 15, fontWeight: '700' },
  popularRouteMeta: { color: MUTED, fontSize: 12, fontWeight: '600', marginTop: 3 },
  popularRoutePrice: { color: ORANGE, fontSize: 20, fontWeight: '500' },
  quickList: { gap: 12, paddingBottom: 16 },
  quickCard: { width: 132, height: 94, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 14 },
  quickKicker: { fontFamily: FONT_MONO, color: '#A1A8B3', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  quickCity: { fontFamily: FONT_SANS, color: NAVY, fontSize: 16, fontWeight: '600', marginTop: 8 },
  quickPrice: { color: ORANGE, fontSize: 23, fontWeight: '300', marginTop: 4 },
  rideCard: { borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18 },
  confirmedCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  confirmedFareBlock: { alignItems: 'flex-end', flexShrink: 0 },
  confirmedFareLabel: { color: MUTED, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 1 },
  confirmedSchedule: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 18, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#ECE8E1' },
  confirmedScheduleItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyCard: { borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  rideMain: { flexDirection: 'row' },
  rideLine: { flexDirection: 'row', alignItems: 'center', minHeight: 28 },
  ridePlace: { fontFamily: FONT_SANS, flex: 1, color: NAVY, fontSize: 17, fontWeight: '600' },
  rideTime: { fontFamily: FONT_SANS, color: MUTED, fontSize: 12, fontWeight: '700' },
  rideMeta: { color: MUTED, fontSize: 12, fontWeight: '600', marginVertical: 5 },
  driverFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: '#D7DCE3', paddingTop: 14, marginTop: 12 },
  activityCardActions: { flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#E5E0D8' },
  actionBtnPrimary: { flex: 1, backgroundColor: ORANGE, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  actionBtnPrimaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  actionBtnSecondary: { flex: 1, backgroundColor: '#F3EFE8', borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  actionBtnSecondaryText: { color: '#15233A', fontSize: 13, fontWeight: '700' },
  actionBtnCancel: { flex: 1, backgroundColor: '#FEF2F2', borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  actionBtnCancelText: { color: '#B91C1C', fontSize: 13, fontWeight: '700' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9E8DB' },
  availableAvatarImage: { width: '100%', height: '100%', borderRadius: 21 },
  avatarText: { fontFamily: FONT_SANS, color: ORANGE, fontSize: 14, fontWeight: '600' },
  driverSmall: { flex: 1, color: '#6B7280', fontSize: 12, fontWeight: '700', lineHeight: 18 },
  cardPrice: { color: ORANGE, fontSize: 24, fontWeight: '700' },
  eyebrow: { fontFamily: FONT_SANS, color: '#7A8FA8', fontSize: 11, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 8, marginTop: 16 },
  seatRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  seatPill: { flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#D7DCE3', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  seatActive: { backgroundColor: NAVY, borderColor: NAVY },
  seatText: { fontFamily: FONT_SANS, color: MUTED, fontSize: 12, fontWeight: '600' },
  seatTextActive: { color: '#FFFFFF' },
  priceBox: { borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center' },
  bigPrice: { color: ORANGE, fontSize: 34, fontWeight: '300' },
  priceInput: { flex: 1, color: NAVY, fontSize: 34, fontWeight: '300', paddingVertical: 0 },
  suggested: { fontFamily: FONT_MONO, position: 'absolute', right: 14, top: 34, color: '#A1A8B3', fontSize: 9, fontWeight: '500', letterSpacing: 1 },
  slider: { height: 3, borderRadius: 2, backgroundColor: '#D7DCE3', marginTop: 12 },
  sliderFill: { width: '62%', height: 3, backgroundColor: ORANGE },
  sliderThumb: { position: 'absolute', left: '62%', top: -5, width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: ORANGE, backgroundColor: '#FFFFFF' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: '#D7DCE3', paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#FFFFFF' },
  chipActive: { backgroundColor: NAVY, borderColor: NAVY },
  chipText: { fontFamily: FONT_MONO, color: '#5F6876', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#FFFFFF' },
  noteBox: { fontFamily: FONT_SANS, minHeight: 74, borderRadius: 12, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', padding: 12, color: NAVY, fontSize: 13, lineHeight: 18 },
  findSearch: { minHeight: 56, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 7, marginBottom: 16, shadowColor: NAVY, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 },
  availableSearchInput: { flex: 1, height: 54, paddingVertical: 0, color: NAVY, fontSize: 14, fontWeight: '500' },
  filterButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3EFE8' },
  filterButtonActive: { backgroundColor: NAVY },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  resultsCount: { flex: 1, color: NAVY, fontSize: 14, fontWeight: '700' },
  clearFiltersText: { color: ORANGE, fontSize: 13, fontWeight: '700' },
  findSearchLabel: { fontFamily: FONT_MONO, color: MUTED, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginBottom: 3 },
  findSearchText: { color: NAVY, fontSize: 15, fontWeight: '700' },
  filterRow: { gap: 8, paddingBottom: 20 },
  filterPill: { minWidth: 72, height: 42, borderRadius: 21, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 },
  filterActive: { backgroundColor: NAVY, borderColor: NAVY },
  filterText: { fontFamily: FONT_SANS, color: '#6B7280', fontSize: 14, fontWeight: '500', textAlign: 'center' },
  filterTextActive: { color: '#FFFFFF' },
  availableCard: { borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 14, shadowColor: NAVY, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 1 },
  availableCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  availableDeparture: { flex: 1, color: NAVY, fontSize: 13, fontWeight: '700' },
  seatBadge: { minWidth: 42, height: 28, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#F3EFE8', paddingHorizontal: 9 },
  seatBadgeText: { color: NAVY, fontSize: 12, fontWeight: '700' },
  availableRouteBlock: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#EEEAE3', paddingVertical: 12 },
  availableTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  availableRouteIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center' },
  availableRoute: { fontFamily: FONT_SANS, color: NAVY, fontSize: 16, fontWeight: '700' },
  availableRouteMeta: { color: MUTED, fontSize: 10, fontWeight: '600', marginTop: 1, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.7 },
  availableDestination: { color: MUTED, fontSize: 13, fontWeight: '600', marginTop: 2 },
  availableTimeBadge: { maxWidth: 92, borderRadius: 12, backgroundColor: '#F3EFE8', paddingHorizontal: 10, paddingVertical: 7 },
  availableTime: { fontFamily: FONT_MONO, color: NAVY, fontSize: 10, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
  availableDash: { borderTopWidth: 1, borderColor: '#ECE8E1', marginVertical: 15 },
  availableBottom: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14 },
  driverName: { fontFamily: FONT_SANS, color: NAVY, fontSize: 16, fontWeight: '600' },
  driverMeta: { color: MUTED, fontSize: 13, fontWeight: '600', marginTop: 3 },
  availablePriceBlock: { alignItems: 'flex-end' },
  availablePrice: { color: ORANGE, fontSize: 28, fontWeight: '500' },
  availablePerSeat: { color: MUTED, fontSize: 10, fontWeight: '600', marginTop: -2 },
  availableEmptyState: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 42, paddingBottom: 18 },
  availableEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  availableEmptyTitle: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  availableEmptyText: { maxWidth: 280, color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  availableEmptyPrimary: { minHeight: 46, borderRadius: 23, backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 22, marginTop: 18 },
  availableEmptyPrimaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  bottomNav: { position: 'absolute', left: 24, right: 24, bottom: 14, height: 58, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E3DA', borderRadius: 29, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 5, shadowColor: '#17233A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 10 },
  navItem: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, gap: 1 },
  navItemActive: { backgroundColor: '#F6F2EC' },
  navIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', top: -7, right: -11, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  iconBadgeText: { color: '#FFFFFF', fontSize: 9, lineHeight: 11, fontWeight: '800' },
  utilityBadge: { position: 'absolute', top: -4, right: -5, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  navText: { color: '#6B7280', fontSize: 11, fontWeight: '700' },
  bottomAction: { position: 'absolute', left: 18, right: 18, bottom: 20 },
  detailCard: { borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 14, marginBottom: 12 },
  detailDriver: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  detailDriverCopy: { flex: 1, minWidth: 0 },
  detailAvatarImage: { width: '100%', height: '100%', borderRadius: 24 },
  avatarLarge: { width: 48, height: 48, borderRadius: 24 },
  avatarTextLarge: { fontFamily: FONT_SANS, color: ORANGE, fontSize: 14, fontWeight: '600' },
  detailName: { fontFamily: FONT_SANS, color: NAVY, fontSize: 15, fontWeight: '600' },
  detailMeta: { color: MUTED, fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 3 },
  detailRoute: { flexDirection: 'row', gap: 10, marginTop: 14, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: '#D7DCE3', paddingTop: 12 },
  detailRouteCopy: { flex: 1, minWidth: 0, height: 68, justifyContent: 'space-between', paddingVertical: 2 },
  detailLocationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailLocation: { flex: 1, minWidth: 0, color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  detailTime: { maxWidth: 96, flexShrink: 0, fontFamily: FONT_MONO, color: MUTED, fontSize: 10, lineHeight: 15, fontWeight: '600', textAlign: 'right' },
  vehicleIcon: { width: 50, height: 50, borderRadius: 12, backgroundColor: '#F5F2EC', alignItems: 'center', justifyContent: 'center', position: 'absolute', left: 14, top: 14 },
  vehicleTitle: { fontFamily: FONT_SANS, color: NAVY, fontSize: 13, fontWeight: '600', marginLeft: 62 },
  detailInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  detailInfoIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#F5F2EC', alignItems: 'center', justifyContent: 'center' },
  detailInfoCopy: { flex: 1, minWidth: 0 },
  detailInfoTitle: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  detailInfoText: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 3 },
  chipRowSmall: { flexDirection: 'row', gap: 6, marginLeft: 62, marginTop: 8 },
  miniChip: { fontFamily: FONT_MONO, borderRadius: 14, borderWidth: 1, borderColor: '#D7DCE3', color: '#5F6876', fontSize: 11, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 7 },
  noteText: { color: '#4A5568', fontSize: 13, lineHeight: 19 },
  fareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  fareLabel: { flex: 1, color: MUTED, fontSize: 12, fontWeight: '600' },
  fareValue: { maxWidth: '68%', flexShrink: 1, fontFamily: FONT_SANS, color: NAVY, fontSize: 12, lineHeight: 17, fontWeight: '600', textAlign: 'right' },
  fareDash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#D7DCE3', marginVertical: 4 },
  fareTotal: { color: ORANGE, fontSize: 22, fontWeight: '300' },
  confirmHero: { alignItems: 'center', paddingTop: 34, paddingBottom: 34 },
  checkCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  confirmTitle: { color: NAVY, fontSize: 30, fontWeight: '300', marginBottom: 14 },
  confirmCard: { borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, shadowColor: NAVY, shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  confirmCode: { fontFamily: FONT_MONO, color: '#A1A8B3', fontSize: 9, fontWeight: '500', letterSpacing: 2, textAlign: 'center', marginBottom: 16 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 11 },
  confirmValue: { fontFamily: FONT_SANS, color: NAVY, fontSize: 12, fontWeight: '600' },
  confirmPrice: { color: ORANGE, fontSize: 22, fontWeight: '300' },
  confirmActions: { gap: 16 },
  secondaryBtn: { minHeight: 52, borderRadius: 26, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: NAVY, fontSize: 13, fontWeight: '700' },
});
