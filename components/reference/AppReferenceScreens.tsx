import React, { useContext, useEffect, useMemo, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Switch, Text as RNText, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { StatusBar } from 'expo-status-bar';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import DriverPreferredRoutesManager from '@/components/DriverPreferredRoutesManager';

import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import { firebaseAuth, firestore } from '@/constants/services';
import { AddCardModal } from '@/components/AddCardModal';
import { deleteMessageThread, getDeleteMessageThreadErrorMessage } from '@/services/messageThreadsService';
import { canSendMessages, isTerminalStatus, MESSAGING_DISABLED_MESSAGE } from '@/constants/rideStatusConstants';
import { resolveChatAvailability, getOrCreateRideChat } from '@/src/services/chatAvailability';
import { PaymentModal } from '@/components/PaymentModal';
import type { EmergencyContact } from '@/types';
import {
  MobileConversation,
  MobileMessage,
  MobileNotification,
  MobileRideRequest,
  RiderProfile,
  markChatAsRead,
  markRiderNotificationAsRead,
  sendChatMessage,
  subscribeChatMessages,
  subscribeRiderConversations,
  subscribeRiderNotifications,
  subscribeRiderProfile,
  subscribeRiderRequests,
} from '@/src/services/riderData';
import { appHeader, hitSlop, layout } from '@/theme/designSystem';
import { badgeLabel, useRiderUnreadCounts } from '@/hooks/useRiderUnreadCounts';
import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { submitRating } from '@/src/services/functions';
import { notificationService } from '@/src/services/notificationService';
import { settingsService } from '@/src/services/settingsService';
import { hasUserRatedRide } from '@/src/services/ratings';
const FONT_SANS = Platform.OS === 'web' ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' : undefined;
const FONT_MONO = Platform.OS === 'web' ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : undefined;

// â"€â"€â"€ Internal color/style context â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
type ScreenStyles = ReturnType<typeof makeStyles>;
const ColorsCtx = React.createContext<{ colors: AppColors; s: ScreenStyles } | null>(null);
function useScreenCtx() {
  const ctx = useContext(ColorsCtx);
  if (!ctx) throw new Error('useScreenCtx must be used inside a ColorsProvider');
  return ctx;
}
function ColorsProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return <ColorsCtx.Provider value={{ colors, s }}>{children}</ColorsCtx.Provider>;
}

type TextProps = React.ComponentProps<typeof RNText>;
type TabKey = 'home' | 'find' | 'rides' | 'inbox' | 'profile' | 'you';

function Text({ style, ...props }: TextProps) {
  const { s } = useScreenCtx();
  return <RNText {...props} style={[s.text, style]} />;
}

function Phone({
  children,
  title,
  back,
  backHref,
  backTarget,
  activeTab,
  bottom,
  cream = false,
  largeTitle = false,
  hideHeaderDivider = false,
  compactContent = false,
  headerGap,
  bottomOffset = 12,
  onBack,
}: {
  children: React.ReactNode;
  title?: string;
  back?: boolean;
  backHref?: string;
  backTarget?: string;
  activeTab?: TabKey;
  bottom?: React.ReactNode;
  cream?: boolean;
  largeTitle?: boolean;
  hideHeaderDivider?: boolean;
  compactContent?: boolean;
  headerGap?: number;
  bottomOffset?: number;
  headerAction?: React.ReactNode;
  onBack?: () => void;
}) {
  const { colors, s } = useScreenCtx();
  const insets = useSafeAreaInsets();
  const bottomNavHeight = 78;
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  return (
    <View style={s.root}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <SafeAreaView style={[s.safe, cream && s.safeCream]} edges={['top', 'left', 'right']}>
        {Platform.OS === 'web' ? (
          <View style={s.status}>
            <Text style={s.statusTime}>9:41</Text>
            <View style={s.notch} />
            <View style={s.statusIcons}>
              <Ionicons name="cellular" size={15} color={colors.textPrimary} />
              <Ionicons name="wifi" size={13} color={colors.textPrimary} />
              <Ionicons name="battery-full" size={17} color={colors.textPrimary} />
            </View>
          </View>
        ) : null}
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          contentContainerStyle={[
            s.body,
            compactContent ? s.bodyCompact : null,
            title || back ? s.bodyWithScrollableHeader : null,
            { paddingBottom: 20 + insets.bottom },
            activeTab ? { paddingBottom: bottomNavHeight + 8 } : null,
            bottom ? { paddingBottom: 84 + insets.bottom } : null,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {title || back ? (
            <View style={[s.header, s.scrollableHeader, hideHeaderDivider && s.headerNoDivider]}>
              {back ? (
                <TouchableOpacity
                  style={s.circle}
                  onPress={() => {
                    if (onBack) { onBack(); return; }
                    const dest = returnTo || backTarget || backHref;
                    if (router.canGoBack()) { router.back(); return; }
                    if (dest) router.replace(dest as any);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  hitSlop={hitSlop}
                >
                  <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              ) : null}
              {title ? <Text style={[s.headerTitle, back && s.headerTitleAfterBack, largeTitle && s.headerTitleLarge]}>{title}</Text> : null}
              <View style={{ flex: 1 }} />
            </View>
          ) : null}
          {title || back ? <View style={[compactContent ? s.scrollHeaderGapCompact : s.scrollHeaderGap, headerGap !== undefined && { height: headerGap }]} /> : null}
          {children}
        </ScrollView>
        {bottom ? <View style={[s.bottomAction, { bottom: insets.bottom + bottomOffset }]}>{bottom}</View> : null}
        {activeTab ? <BottomNav active={activeTab} /> : null}
      </SafeAreaView>
    </View>
  );
}

function Brand() {
  const { colors, s } = useScreenCtx();
  return (
    <View style={s.brand}>
      <Ionicons name="location-outline" size={28} color={colors.primary} />
      <Text style={s.brandText}>RideAlong</Text>
    </View>
  );
}

function Hero({ first, accent, tail, sub }: { first: string; accent: string; tail?: string; sub?: string }) {
  const { s } = useScreenCtx();
  return (
    <View style={s.hero}>
      <Text style={s.heroText}>
        {first}
        <Text style={s.heroAccent}>{accent}</Text>
        {tail}
      </Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  const { s } = useScreenCtx();
  return <Text style={s.label}>{children}</Text>;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
}) {
  const { colors, s } = useScreenCtx();
  return (
    <View style={s.field}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        style={s.input}
      />
    </View>
  );
}

function PrimaryButton({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  const { s } = useScreenCtx();
  return (
    <TouchableOpacity style={s.primary} onPress={onPress} accessibilityRole="button" hitSlop={hitSlop}>
      <Text style={s.primaryText}>{children}</Text>
    </TouchableOpacity>
  );
}

function GhostButton({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  const { s } = useScreenCtx();
  return (
    <TouchableOpacity style={s.ghost} onPress={onPress} accessibilityRole="button" hitSlop={hitSlop}>
      <Text style={s.ghostText}>{children}</Text>
    </TouchableOpacity>
  );
}

function BottomNav({ active }: { active: TabKey }) {
  const { colors, s } = useScreenCtx();
  const { messageCount } = useRiderUnreadCounts();
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] = [
    { key: 'home', label: 'Home', icon: 'home', href: '/(rider)' },
    { key: 'find', label: 'Request', icon: 'add-circle-outline', href: '/(rider)/book' },
    { key: 'rides', label: 'Rides', icon: 'ticket-outline', href: '/(rider)/available-rides' },
    { key: 'inbox', label: 'Inbox', icon: 'chatbubble', href: '/(rider)/messages' },
    { key: 'profile', label: 'Profile', icon: 'person', href: '/(rider)/profile' },
  ];
  return (
    <View style={s.tabs}>
      {tabs.map((tab) => {
        const selected = active === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, selected ? s.tabActive : null]}
            onPress={() => router.push(tab.href as any)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            hitSlop={hitSlop}
          >
            <View style={s.tabIconWrap}>
              <Ionicons name={tab.icon} size={23} color={selected ? colors.primary : colors.textSecondary} />
              {tab.key === 'inbox' && messageCount > 0 ? <View style={s.iconBadge}><Text style={s.iconBadgeText}>{badgeLabel(messageCount)}</Text></View> : null}
            </View>
            <Text style={[s.tabText, selected && { color: colors.primary }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function AuthSignInReference() {
  return <ColorsProvider><AuthSignInReferenceInner /></ColorsProvider>;
}
function AuthSignInReferenceInner() {
  const { s } = useScreenCtx();
  const { signIn } = useAuthStore();
  const [email, setEmail] = useState('melody@utexas.edu');
  const [password, setPassword] = useState('password');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    try {
      setBusy(true);
      await signIn(email.trim(), password);
    } catch (error: any) {
      Alert.alert('Sign in failed', error?.message || 'Please check your email and password.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Phone>
      <Brand />
      <Hero first="Welcome " accent="back." sub="Sign in with your verified .edu email." />
      <Field label="SCHOOL EMAIL" value={email} onChangeText={setEmail} />
      <Field label="PASSWORD" value={password} onChangeText={setPassword} secureTextEntry />
      <View style={s.formRow}>
        <Text style={s.remember}>Remember me</Text>
        <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
          <Text style={s.orangeLink}>Forgot?</Text>
        </TouchableOpacity>
      </View>
      <PrimaryButton onPress={submit}>{busy ? 'Logging in...' : 'Log in ->'}</PrimaryButton>
      <GhostButton>G  Continue with Google</GhostButton>
      <View style={s.authFooter}>
        <Text style={s.footerText}>New here? </Text>
        <Text style={s.orangeLink} onPress={() => router.push('/(auth)/sign-up')}>Sign up</Text>
        <Text style={s.footerText}>{' · I\'m a '}</Text>
        <Text style={s.orangeLink} onPress={() => router.push('/(auth)/driver-signup' as any)}>driver</Text>
      </View>
    </Phone>
  );
}

export function AuthSignUpReference() {
  return <ColorsProvider><AuthSignUpReferenceInner /></ColorsProvider>;
}
function AuthSignUpReferenceInner() {
  const { s } = useScreenCtx();
  const { signUp } = useAuthStore();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('Melody');
  const [lastName, setLastName] = useState('Adeyemi');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    try {
      setBusy(true);
      await signUp({ email, password, firstName, lastName, role: 'rider', university: 'UT Austin' });
      router.replace('/(auth)/verify-email');
    } catch (error: any) {
      Alert.alert('Sign up failed', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Phone>
      <Brand />
      <Step current={1} />
      <Hero first="Pull " accent="up." sub=".edu email required. We verify everyone — keeps the rides safe." />
      <Field label="SCHOOL EMAIL" value={email} onChangeText={setEmail} placeholder="yourname@school.edu" />
      <View style={s.split}>
        <Field label="FIRST NAME" value={firstName} onChangeText={setFirstName} />
        <Field label="LAST NAME" value={lastName} onChangeText={setLastName} />
      </View>
      <Field label="CREATE A PASSWORD" value={password} onChangeText={setPassword} placeholder="8+ characters" secureTextEntry />
      <PrimaryButton onPress={submit}>{busy ? 'Creating...' : 'Continue ->'}</PrimaryButton>
      <View style={s.authFooter}><Text style={s.footerText}>By continuing, you agree to our </Text><Text style={s.orangeLink}>Terms & Privacy.</Text></View>
    </Phone>
  );
}

export function AuthVerifyCodeReference() {
  return <ColorsProvider><AuthVerifyCodeReferenceInner /></ColorsProvider>;
}
function AuthVerifyCodeReferenceInner() {
  const { s } = useScreenCtx();
  const { checkEmailVerification, email } = useAuthStore();
  const submit = async () => {
    const ok = await checkEmailVerification().catch(() => false);
    if (ok) router.replace('/(auth)/select-role');
    else Alert.alert('Still waiting', 'Open your email verification link, then try again.');
  };
  return (
    <Phone>
      <Brand />
      <Hero first="Check your " accent="inbox." sub={`We sent a 6-digit code to ${email || 'melody@utexas.edu'}. Drop it in below.`} />
      <View style={s.codeRow}>{['8', '3', '2', '9', '-', '-'].map((n, i) => <Text key={`${n}${i}`} style={[s.codeBox, n === '-' && s.codeMuted]}>{n}</Text>)}</View>
      <PrimaryButton onPress={submit}>{'Confirm ->'}</PrimaryButton>
      <GhostButton>Resend code (45s)</GhostButton>
      <View style={s.authFooter}><Text style={s.footerText}>Wrong email? </Text><Text style={s.orangeLink}>Edit</Text><Text style={s.footerText}> or </Text><Text style={s.orangeLink}>start over.</Text></View>
    </Phone>
  );
}

export function AuthSelectRoleReference() {
  return <ColorsProvider><AuthSelectRoleReferenceInner /></ColorsProvider>;
}
function AuthSelectRoleReferenceInner() {
  const { colors, s } = useScreenCtx();
  const { switchRole, setActiveRole } = useAuthStore();
  const choose = async (role: 'rider' | 'driver') => {
    try {
      await switchRole(role);
    } catch {
      setActiveRole(role);
    }
    router.replace(role === 'driver' ? '/(driver)' : '/(rider)');
  };
  return (
    <Phone>
      <Brand />
      <Hero first="How are you " accent="riding along?" sub="You can switch later — same account, two modes." />
      <ModeCard icon="people" title="I need a ride" sub="Find verified students heading your way." selected onPress={() => choose('rider')} />
      <ModeCard icon="car-sport" title="I'm driving" sub="Fill empty seats, split gas." onPress={() => choose('driver')} />
      <ModeCard icon="repeat" title="Both — I do both" sub="Toggle from your profile anytime." dashed onPress={() => choose('rider')} />
      <View style={s.notice}><Ionicons name="shield-half" size={13} color={colors.primary} /><Text style={s.noticeText}>Both modes require .edu verification. Takes &lt;24 hours.</Text></View>
    </Phone>
  );
}

export function AuthVerifyDocsReference() {
  return <ColorsProvider><AuthVerifyDocsReferenceInner /></ColorsProvider>;
}
function AuthVerifyDocsReferenceInner() {
  const { colors, s } = useScreenCtx();
  return (
    <Phone bottom={<><PrimaryButton>{'Submit for review ->'}</PrimaryButton><GhostButton onPress={() => router.replace('/(auth)/select-role')}>{"I'll do this later"}</GhostButton></>}>
      <Brand />
      <Step current={3} />
      <Hero first="Prove you're a " accent="student." sub={'Upload your school ID, class schedule, or enrollment letter. Approved in <24 hours.'} />
      <TouchableOpacity style={s.upload}>
        <View style={s.uploadIcon}><Ionicons name="cloud-upload" size={22} color={colors.primary} /></View>
        <Text style={s.uploadTitle}>Drop your proof here</Text>
        <Text style={s.uploadSub}>PDF, PNG, or JPG · 10MB max</Text>
      </TouchableOpacity>
      <View style={s.infoBox}><Text style={s.infoText}><Text style={s.infoBold}>What counts?</Text> Student ID with current term · class schedule (this semester) · official enrollment letter · acceptance + tuition receipt</Text></View>
    </Phone>
  );
}

export function AuthForgotReference() {
  return <ColorsProvider><AuthForgotReferenceInner /></ColorsProvider>;
}
function AuthForgotReferenceInner() {
  const { colors, s } = useScreenCtx();
  const [email, setEmail] = useState('melody@utexas.edu');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    try {
      setBusy(true);
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      Alert.alert('Reset sent', 'Check your email for the reset link.');
    } catch (error: any) {
      Alert.alert('Reset failed', error?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Phone>
      <Brand />
      <Hero first="Forgot " accent="it?" sub="Happens. Drop your school email and we'll send a reset link." />
      <Field label="SCHOOL EMAIL" value={email} onChangeText={setEmail} />
      <PrimaryButton onPress={submit}>{busy ? 'Sending...' : 'Send reset link ->'}</PrimaryButton>
      <GhostButton onPress={() => router.back()}>Back to login</GhostButton>
      <View style={s.notice}><Ionicons name="mail-unread" size={13} color={colors.primary} /><Text style={s.noticeText}>{"Check spam if it doesn't arrive in 60 seconds."}</Text></View>
    </Phone>
  );
}

function Step({ current }: { current: number }) {
  const { s } = useScreenCtx();
  return (
    <View style={s.stepRow}>
      <Text style={s.stepText}>STEP {current} OF 3</Text>
      <View style={s.stepTrack}><View style={[s.stepFill, { width: `${current * 33.3}%` }]} /></View>
    </View>
  );
}

function ModeCard({ icon, title, sub, selected, dashed, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; selected?: boolean; dashed?: boolean; onPress?: () => void }) {
  const { colors, s } = useScreenCtx();
  return (
    <TouchableOpacity style={[s.modeCard, selected && s.modeSelected, dashed && s.modeDashed]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <View style={[s.modeIcon, selected && { backgroundColor: colors.primaryDim }]}><Ionicons name={icon} size={24} color={selected ? colors.primary : colors.textSecondary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.modeTitle}>{title}</Text>
        <Text style={s.modeSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={selected ? colors.primary : colors.textSecondary} />
      {selected ? <Text style={s.recommended}>RECOMMENDED</Text> : null}
    </TouchableOpacity>
  );
}

function Pill({ label, active }: { label: string; active?: boolean }) {
  const { s } = useScreenCtx();
  return <Text style={[s.pill, active && s.pillActive]} accessibilityRole="text">{label}</Text>;
}

function RideDot() {
  const { s } = useScreenCtx();
  return <View style={s.dot} />;
}

function RequestCard({ route, sub, price, live, offers }: { route: string; sub: string; price: string; live?: boolean; offers?: string }) {
  const { s } = useScreenCtx();
  return (
    <View style={s.requestCard}>
      <View style={s.row}><RideDot /><Text style={s.routeTitle}>{route}</Text><Text style={s.mono}>{live ? 'â€¢ LIVE' : 'WAITING'}</Text></View>
      <Text style={s.mutedLine}>{sub} · up to <Text style={s.bold}>{price}</Text></Text>
      <View style={s.dash} />
      <View style={s.row}><Text style={s.offerText}>{offers || 'NO OFFERS YET'}</Text><TouchableOpacity style={s.navyBtn}><Text style={s.navyBtnText}>View offers</Text></TouchableOpacity></View>
    </View>
  );
}


export function RiderRequestsReference() {
  return <ColorsProvider><RiderRequestsReferenceInner /></ColorsProvider>;
}
type OfferWithDriver = {
  offerId: string;
  driverId: string;
  driverName: string | null;
  driverAvatar: string | null;
  driverRating: number | null;
  offerPrice: number | null;
  status: string;
};

function RiderRequestsReferenceInner() {
  const { colors, s } = useScreenCtx();
  const uid = firebaseAuth.currentUser?.uid;
  const [requests, setRequests] = useState<MobileRideRequest[]>([]);
  const [postingRequests, setPostingRequests] = useState<MobileRideRequest[]>([]);
  const [filter, setFilter] = useState<'open' | 'past'>('open');
  const [offersMap, setOffersMap] = useState<Record<string, OfferWithDriver[]>>({});
  const [acceptingOffer, setAcceptingOffer] = useState<{ offer: OfferWithDriver; request: MobileRideRequest } | null>(null);
  const [decliningOfferId, setDecliningOfferId] = useState<string | null>(null);
  const [waitlistEntries, setWaitlistEntries] = useState<import('@/src/services/waitlistService').WaitlistEntry[]>([]);
  const [leavingWaitlistId, setLeavingWaitlistId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedRef = React.useRef(false);
  const markLoaded = React.useCallback(() => { if (!loadedRef.current) { loadedRef.current = true; setLoading(false); } }, []);

  useEffect(() => {
    if (!uid) return;
    import('@/src/services/waitlistService').then(({ subscribeMyWaitlistEntries }) => {
      return subscribeMyWaitlistEntries(uid, setWaitlistEntries);
    }).catch(() => {});
  }, [uid]);

  const handleDeclineOffer = async (offerId: string) => {
    setDecliningOfferId(offerId);
    try {
      await updateDoc(doc(firestore, 'rideOffers', offerId), {
        status: 'rejected',
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch {
      Alert.alert('Error', 'Could not decline the offer. Please try again.');
    } finally {
      setDecliningOfferId(null);
    }
  };

  const acceptOffer = async (offer: OfferWithDriver, request: MobileRideRequest, paymentIntentId: string) => {
    if (!uid) return;
    try {
      await updateDoc(doc(firestore, 'rideRequests', request.id), {
        paymentIntentId, paymentStatus: 'authorized',
      });
    } catch {}
    try {
      const { getApiBaseUrl } = await import('@/constants/services');
      const res = await fetch(`${getApiBaseUrl()}/api/accept-ride-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: offer.offerId, riderId: uid, driverId: offer.driverId, paymentIntentId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `Server error ${res.status}`);
      }
      Alert.alert('Offer accepted!', 'Your ride is confirmed.');
    } catch (e: any) {
      try {
        const { cancelRidePayment } = await import('@/services/payments');
        await cancelRidePayment({ paymentIntentId, rideId: offer.offerId });
      } catch {}
      Alert.alert('Failed', e?.message || 'Could not accept the offer. Your payment was not charged.');
    }
  };

  // Called by PaymentModal when a new payment is authorized
  const handleOfferPaymentSuccess = async (paymentIntentId: string) => {
    if (!acceptingOffer) return;
    const { offer, request } = acceptingOffer;
    setAcceptingOffer(null);
    await acceptOffer(offer, request, paymentIntentId);
  };

  useEffect(() => uid ? subscribeRiderRequests(uid, (data) => { setRequests(data); markLoaded(); }) : undefined, [uid, markLoaded]);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(firestore, 'ridePostingRequests'), where('riderId', '==', uid));
    return onSnapshot(q, (snap) => {
      const items: MobileRideRequest[] = snap.docs.map((d) => {
        const r = d.data() as any;
        const rawDate = r.date || '';
        let parsedDate: Date | null = null;
        if (rawDate) {
          const iso = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
          parsedDate = iso
            ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
            : (isNaN(new Date(rawDate).getTime()) ? null : new Date(rawDate));
        }
        return {
          id: d.id,
          from: r.pickup || r.from || 'Pickup pending',
          to: r.dropoff || r.to || 'Destination pending',
          date: parsedDate,
          dateLabel: rawDate,
          seats: Number(r.passengers || 1),
          price: Number(r.contributionAmount ?? r.price ?? 0),
          status: String(r.status || 'pending').toLowerCase(),
          raw: r,
        };
      });
      const now = Date.now();
      const activeStatuses = new Set(['pending','open','posted','offer','offer_received','accepted','confirmed','matched','in_progress','in-progress']);
      setPostingRequests(items.filter((item) => {
        if (!activeStatuses.has(item.status)) return false;
        // Drop past-dated items regardless of cache state
        if (item.date) {
          const endOfDay = new Date(item.date); endOfDay.setHours(23, 59, 59, 999);
          if (endOfDay.getTime() < now) return false;
        }
        return true;
      }));
      markLoaded();
    }, (error) => {
      setPostingRequests([]);
      markLoaded();
      console.warn('[RiderRequestsReference] ridePostingRequests listener error:', error);
    });
  }, [uid]);

  // Subscribe to pending offers for this rider so we can show driver info inline
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(firestore, 'rideOffers'), where('riderId', '==', uid), where('status', '==', 'pending'));
    return onSnapshot(q, async (snap) => {
      const grouped: Record<string, OfferWithDriver[]> = {};
      const driverIds = [...new Set(snap.docs.map((d) => d.data().driverId).filter(Boolean))];
      // Fetch all driver profiles in one batch
      const driverProfiles: Record<string, any> = {};
      await Promise.all(driverIds.map(async (dId) => {
        try {
          const dSnap = await getDoc(doc(firestore, 'drivers', dId));
          if (dSnap.exists()) driverProfiles[dId] = dSnap.data();
        } catch {}
      }));
      snap.docs.forEach((d) => {
        const o = d.data() as any;
        const reqId = o.rideRequestId;
        if (!reqId) return;
        const dr = driverProfiles[o.driverId] || {};
        const offer: OfferWithDriver = {
          offerId: d.id,
          driverId: o.driverId,
          driverName: dr.fullName || dr.name || dr.displayName || dr.personalInfo?.fullName || [dr.firstName, dr.lastName].filter(Boolean).join(' ') || o.driverName || null,
          driverAvatar: dr.avatarUrl || dr.photoURL || null,
          driverRating: typeof dr.rating === 'number' ? dr.rating : null,
          offerPrice: typeof o.offerPrice === 'number' ? o.offerPrice : typeof o.offerAmount === 'number' ? o.offerAmount : null,
          status: String(o.status || 'pending'),
        };
        (grouped[reqId] = grouped[reqId] || []).push(offer);
      });
      setOffersMap(grouped);
    }, () => {});
  }, [uid]);

  const allRequests = [...requests, ...postingRequests];

  const OPEN = new Set(['pending', 'open', 'posted', 'offer', 'offer_received']);
  const MATCHED = new Set(['accepted', 'confirmed', 'matched', 'in_progress', 'in-progress', 'driver_completed', 'rider_completed']);
  const PAST = new Set(['completed', 'cancelled', 'canceled', 'rejected', 'expired']);

  const hasRequestActivity = (request: MobileRideRequest): boolean => {
    const raw = request.raw || {};
    return MATCHED.has(request.status)
      || request.status.includes('offer')
      || Boolean(raw.confirmedRideId || raw.rideOfferId || raw.offerId || raw.acceptedBy || raw.assignedDriverId)
      || raw.hasOffers === true
      || Number(raw.offerCount || raw.offersCount || 0) > 0;
  };

  const isDateExpired = (request: MobileRideRequest): boolean => {
    // Both pending (OPEN) and confirmed (MATCHED) requests expire if their ride date has passed
    if (!OPEN.has(request.status) && !MATCHED.has(request.status)) return false;
    // Prefer dateLabel (user-entered trip date)
    let rideDate: Date | null = null;
    if (request.dateLabel && request.dateLabel !== 'Date pending') {
      const iso = request.dateLabel.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) {
        rideDate = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      } else {
        const d = new Date(request.dateLabel);
        if (!isNaN(d.getTime())) rideDate = d;
      }
    }
    // For confirmed/accepted requests also check request.date
    if (!rideDate && request.date instanceof Date && !isNaN(request.date.getTime())) {
      rideDate = request.date;
    }
    if (!rideDate) return false;
    const endOfDay = new Date(rideDate);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay < new Date();
  };

  const filtered = allRequests.filter((request) => {
    const status = request.status;
    const expired = isDateExpired(request);
    if (filter === 'open') return (OPEN.has(status) || MATCHED.has(status)) && !expired;
    return PAST.has(status) || expired;
  });

  return (
    <Phone title="My requests" back activeTab="rides" headerGap={4}>
      <View style={s.pillRow}>
        <TouchableOpacity onPress={() => setFilter('open')}><Pill label={`Open · ${allRequests.filter((r) => (OPEN.has(r.status) || MATCHED.has(r.status)) && !isDateExpired(r)).length}`} active={filter === 'open'} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('past')}><Pill label={`Past · ${allRequests.filter((r) => PAST.has(r.status) || isDateExpired(r)).length}`} active={filter === 'past'} /></TouchableOpacity>
      </View>
      {loading ? (
        <View style={{ minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Loading requests…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={(s as any).emptyState ?? { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
          <Ionicons name="car-outline" size={32} color={colors.primary} />
          <Text style={{ color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginTop: 14, textAlign: 'center' }}>
            {filter === 'open' ? 'No open requests' : 'No past requests'}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 6, textAlign: 'center', maxWidth: 260 }}>
            {filter === 'open' ? 'Request a ride and nearby drivers will send you offers.' : 'Completed and cancelled rides will appear here.'}
          </Text>
        </View>
      ) : null}
      {!loading && filtered.map((request) => {
        const expired = isDateExpired(request);
        const offers = offersMap[request.id] || [];
        const hasOffers = offers.length > 0;
        const statusLabel = expired && OPEN.has(request.status)
          ? 'Expired'
          : hasOffers
          ? `${offers.length} offer${offers.length === 1 ? '' : 's'} received`
          : request.status.includes('offer')
          ? 'Offer received'
          : request.status === 'completed' ? 'Completed'
          : request.status === 'cancelled' || request.status === 'canceled' ? 'Cancelled'
          : request.status === 'rejected' ? 'Rejected'
          : request.status.replace(/[_-]/g, ' ');
        return (
        <View key={request.id} style={s.requestCard}>
          <TouchableOpacity onPress={() => router.push(`/(rider)/ride/${request.id}` as any)} activeOpacity={0.86}>
          <View style={s.requestCardTop}>
            <View style={[s.requestStatusBadge, hasOffers && { backgroundColor: colors.primaryDim }]}>
              <Text style={[s.requestStatusText, hasOffers && { color: colors.primary }]}>{statusLabel}</Text>
            </View>
            <Text style={s.requestPrice}>${request.price}</Text>
          </View>
          <View style={s.requestRouteBlock}>
            <View style={s.requestRouteRail}>
              <View style={s.requestPickupDot} />
              <View style={s.requestRouteLine} />
              <View style={s.requestDropoffDot} />
            </View>
            <View style={s.requestRouteCopy}>
              <View>
                <Text style={s.requestRouteLabel}>PICKUP</Text>
                <Text style={s.requestRouteText} numberOfLines={1}>{request.from}</Text>
              </View>
              <View>
                <Text style={s.requestRouteLabel}>DROPOFF</Text>
                <Text style={s.requestRouteText} numberOfLines={1}>{request.to}</Text>
              </View>
            </View>
          </View>
          <View style={s.dash} />
          <View style={s.requestMetaRow}>
            <View style={s.requestMetaPill}><Ionicons name="calendar-outline" size={14} color={colors.textSecondary} /><Text style={s.requestMetaText}>{request.dateLabel || 'Date pending'}</Text></View>
            <View style={s.requestMetaPill}><Ionicons name="person-outline" size={14} color={colors.textSecondary} /><Text style={s.requestMetaText}>{request.seats} {request.seats === 1 ? 'seat' : 'seats'}</Text></View>
          </View>
          </TouchableOpacity>
          {/* Driver offers expanded inline */}
          {hasOffers && (
            <View style={{ marginTop: 12, gap: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 }}>Drivers who offered</Text>
              {offers.map((offer) => {
                const initials = (offer.driverName || 'D').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <View key={offer.offerId} style={{ gap: 6 }}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: colors.bgSecondary, borderRadius: 12 }}
                    onPress={() => router.push({ pathname: '/(rider)/driver/[driverId]', params: { driverId: offer.driverId, returnTo: '/(rider)/requests' } } as any)}
                    activeOpacity={0.75}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      {offer.driverAvatar
                        ? <Image source={{ uri: offer.driverAvatar }} style={{ width: 40, height: 40 }} contentFit="cover" />
                        : <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>{initials}</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: colors.textPrimary, fontSize: 14 }}>{offer.driverName || 'Driver'}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {offer.driverRating != null && (
                          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>★ {offer.driverRating.toFixed(2)}</Text>
                        )}
                        {offer.offerPrice != null && (
                          <Text style={{ color: colors.green, fontSize: 12, fontWeight: '600' }}>${offer.offerPrice.toFixed(0)}</Text>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      onPress={async (e) => {
                        e.stopPropagation();
                        try {
                          const chatId = await getOrCreateRideChat({
                            context: 'ride-offer',
                            rideId: request.id,
                            rideRequestId: request.id,
                            rideOfferId: offer.offerId,
                            driverId: offer.driverId,
                            riderId: uid!,
                          });
                          router.push(`/(rider)/messages/${chatId}` as any);
                        } catch { Alert.alert('Error', 'Could not open chat.'); }
                      }}
                    >
                      <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />
                    </TouchableOpacity>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                  {/* Accept / Decline row */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: colors.bgCard, borderRadius: 20, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, opacity: decliningOfferId === offer.offerId ? 0.5 : 1 }}
                      onPress={() => {
                        Alert.alert('Decline offer?', `Decline the offer from ${offer.driverName || 'this driver'}?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Decline', style: 'destructive', onPress: () => handleDeclineOffer(offer.offerId) },
                        ]);
                      }}
                      disabled={!!decliningOfferId}
                    >
                      <Text style={{ color: colors.red, fontSize: 13, fontWeight: '700' }}>Decline</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 2, backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 8, alignItems: 'center' }}
                      onPress={() => {
                        {
                          const existingPaymentId = request.raw?.paymentIntentId;
                          if (existingPaymentId) {
                            // Payment was already authorized when the request was posted — use it directly.
                            Alert.alert('Accept offer?', `Confirm the ride from ${offer.driverName || 'this driver'}?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Confirm', onPress: () => acceptOffer(offer, request, existingPaymentId) },
                            ]);
                          } else {
                            Alert.alert('Accept offer?', `Accept the ride from ${offer.driverName || 'this driver'}? You'll need to authorize payment.`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Continue to payment', onPress: () => setAcceptingOffer({ offer, request }) },
                            ]);
                          }
                        }
                      }}
                    >
                      <Text style={{ color: colors.textInverse, fontSize: 13, fontWeight: '700' }}>Accept</Text>
                    </TouchableOpacity>
                  </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
        );
      })}
      {acceptingOffer && (
        <PaymentModal
          visible
          onClose={() => setAcceptingOffer(null)}
          rideId={acceptingOffer.request.id}
          driverId={acceptingOffer.offer.driverId}
          baseFare={acceptingOffer.offer.offerPrice ?? acceptingOffer.request.price}
          onPaymentSuccess={handleOfferPaymentSuccess}
        />
      )}
      {!filtered.length ? <View style={s.panel}><Text style={s.routeTitle}>Nothing here yet</Text><Text style={s.messagePreview}>Post a request or choose another status tab.</Text></View> : null}

      {/* Waitlist section */}
      {waitlistEntries.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 10, textTransform: 'uppercase' }}>
            Waitlisted
          </Text>
          {waitlistEntries.map((entry) => {
            const isNotified = entry.status === 'notified';
            const expiresMs = entry.expiresAt?.toMillis?.() ?? 0;
            const minutesLeft = expiresMs ? Math.max(0, Math.ceil((expiresMs - Date.now()) / 60000)) : 0;
            return (
              <View key={entry.id} style={[s.requestCard, { borderColor: isNotified ? colors.primary : colors.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: isNotified ? colors.primaryDim : colors.bgSecondary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: isNotified ? colors.primary : colors.textSecondary, fontSize: 11, fontWeight: '800' }}>
                      {isNotified ? `⚡ Seat available! ${minutesLeft}m left` : `#${entry.position} in line`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={async () => {
                      if (leavingWaitlistId) return;
                      Alert.alert('Leave waitlist?', 'You\'ll lose your spot.', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Leave', style: 'destructive', onPress: async () => {
                          setLeavingWaitlistId(entry.id);
                          try {
                            const { leaveWaitlist } = await import('@/src/services/waitlistService');
                            await leaveWaitlist(entry.ridePostingId);
                          } catch { Alert.alert('Error', 'Could not leave waitlist.'); }
                          finally { setLeavingWaitlistId(null); }
                        }},
                      ]);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>✕ Leave</Text>
                  </TouchableOpacity>
                </View>
                {isNotified && (
                  <TouchableOpacity
                    style={{ backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 12, alignItems: 'center', marginBottom: 10 }}
                    onPress={() => router.push({ pathname: '/(rider)/ride/[id]', params: { id: entry.ridePostingId, returnTo: '/(rider)/requests' } } as any)}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>Claim Your Seat</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Phone>
  );
}

export function RiderHistoryReference() {
  return <ColorsProvider><RiderHistoryReferenceInner /></ColorsProvider>;
}
function RiderHistoryReferenceInner() {
  const { colors, s } = useScreenCtx();
  type HistoryTab = 'upcoming' | 'past' | 'cancelled';
  type HistoryRide = {
    id: string; confirmedRideId?: string; rideRequestId?: string; ridePostingId?: string; driverId?: string;
    driverName: string; driverAvatarUrl?: string; from: string; to: string;
    date: Date | null; price: number; status: string; statusAtFlag?: string; seats: number;
  };
  const uid = useAuthStore((state) => state.uid);
  const [rides, setRides] = useState<HistoryRide[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setRides([]); setLoading(false); return; }
    setLoading(true);
    let active = true;
    let version = 0;
    let byRider: any[] = [];
    let byUser: any[] = [];
    let requestsByRider: any[] = [];
    let requestsByUser: any[] = [];
    let loadedRider = false;
    let loadedUser = false;
    let loadedRequestsByRider = false;
    let loadedRequestsByUser = false;

    const textValue = (...values: any[]) => {
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (value?.address && typeof value.address === 'string') return value.address.trim();
      }
      return '';
    };
    const toDate = (value: any): Date | null => {
      if (!value) return null;
      const parsed = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const emit = async () => {
      const currentVersion = ++version;
      const merged = new Map<string, any>();
      [...byRider, ...byUser].forEach((ride) => {
        const key = ride.rideRequestId ? `request:${ride.rideRequestId}` : `confirmed:${ride.id}`;
        merged.set(key, { ...ride, confirmedRideId: ride.id });
      });
      [...requestsByRider, ...requestsByUser].forEach((request) => {
        const status = String(request.status || '').toUpperCase();
        if (!status.includes('CANCEL') && !['DECLINED', 'REJECTED'].includes(status)) return;
        const key = `request:${request.id}`;
        merged.set(key, { ...(merged.get(key) || {}), ...request, id: request.id, rideRequestId: request.id });
      });
      const mapped = await Promise.all(Array.from(merged.values()).map(async (ride): Promise<HistoryRide> => {
        const driverId = textValue(ride.driverId, ride.driverUid, ride.driverUID);
        let driverName = textValue(ride.driverName, ride.driver?.fullName, ride.driver?.name, ride.driver?.displayName, ride.driver?.personalInfo?.fullName) || (driverId ? 'Driver' : 'No driver assigned');
        let driverAvatarUrl = textValue(ride.driverAvatarUrl, ride.driver?.avatarUrl, ride.driver?.photoURL) || undefined;
        if (driverId) {
          try {
            const driverSnap = await getDoc(doc(firestore, 'drivers', driverId));
            if (driverSnap.exists()) {
              const driver = driverSnap.data() as any;
              driverName = textValue(driver.fullName, driver.name, driver.displayName,
                [driver.firstName, driver.lastName].filter(Boolean).join(' ')) || driverName;
              driverAvatarUrl = textValue(driver.avatarUrl, driver.photoURL, driver.profilePicture, driver.avatarUrl1) || driverAvatarUrl;
            }
          } catch {}
        }
        const rawPrice = ride.paymentAmount ?? ride.contributionAmount ?? ride.price ?? ride.fare ?? ride.estimatedFare ?? 0;
        const price = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice).replace(/[^0-9.-]/g, '')) || 0;
        return {
          id: ride.id,
          confirmedRideId: textValue(ride.confirmedRideId) || undefined,
          rideRequestId: textValue(ride.rideRequestId, ride.requestId) || undefined,
          ridePostingId: textValue(ride.ridePostingId, ride.postingId) || undefined,
          driverId: driverId || undefined,
          driverName,
          driverAvatarUrl,
          from: textValue(ride.pickup, ride.pickupLocation, ride.pickupAddress, ride.from, ride.origin) || 'Pickup',
          to: textValue(ride.dropoff, ride.dropoffLocation, ride.dropoffAddress, ride.to, ride.destination) || 'Destination',
          date: toDate(ride.completedAt || ride.departureTime || ride.pickupTime || ride.scheduledTime ||
            (ride.date && ride.time ? `${ride.date} ${ride.time}` : ride.date) || ride.createdAt),
          price,
          status: String(ride.status || 'CONFIRMED').toUpperCase(),
          statusAtFlag: String(ride.statusAtFlag || '').toUpperCase(),
          seats: Number(ride.seats || ride.passengers || ride.seatCount || 1),
        };
      }));
      if (!active || currentVersion !== version) return;
      mapped.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
      setRides(mapped);
      if (loadedRider && loadedUser && loadedRequestsByRider && loadedRequestsByUser) setLoading(false);
    };
    const mapSnapshot = (snapshot: any) => snapshot.docs.map((item: any) => ({ id: item.id, ...item.data() }));
    const unsubRider = onSnapshot(query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid)), (snapshot) => {
      byRider = mapSnapshot(snapshot); loadedRider = true; void emit();
    }, () => { loadedRider = true; void emit(); });
    const unsubUser = onSnapshot(query(collection(firestore, 'confirmedRides'), where('userId', '==', uid)), (snapshot) => {
      byUser = mapSnapshot(snapshot); loadedUser = true; void emit();
    }, () => { loadedUser = true; void emit(); });
    const unsubRequestsByRider = onSnapshot(query(collection(firestore, 'rideRequests'), where('riderId', '==', uid)), (snapshot) => {
      requestsByRider = mapSnapshot(snapshot); loadedRequestsByRider = true; void emit();
    }, () => { loadedRequestsByRider = true; void emit(); });
    const unsubRequestsByUser = onSnapshot(query(collection(firestore, 'rideRequests'), where('userId', '==', uid)), (snapshot) => {
      requestsByUser = mapSnapshot(snapshot); loadedRequestsByUser = true; void emit();
    }, () => { loadedRequestsByUser = true; void emit(); });
    return () => { active = false; unsubRider(); unsubUser(); unsubRequestsByRider(); unsubRequestsByUser(); };
  }, [uid]);

  const categoryFor = (ride: HistoryRide): HistoryTab => {
    if (ride.status.includes('CANCEL') || ['DECLINED', 'REJECTED'].includes(ride.status)) return 'cancelled';
    if (['COMPLETED', 'COMPLETE', 'FINISHED'].includes(ride.status) || (ride.status === 'FLAGGED' && ride.statusAtFlag === 'COMPLETED')) return 'past';
    return 'upcoming';
  };
  const allHistoryRides = rides.filter((ride) => categoryFor(ride) !== 'upcoming');
  const [historyTab, setHistoryTab] = useState<'all' | 'past' | 'cancelled'>('all');
  const historyRides = historyTab === 'all' ? allHistoryRides
    : historyTab === 'past' ? allHistoryRides.filter((r) => categoryFor(r) === 'past')
    : allHistoryRides.filter((r) => categoryFor(r) === 'cancelled');
  const completedCount = allHistoryRides.filter((ride) => categoryFor(ride) === 'past').length;
  const cancelledCount = allHistoryRides.filter((ride) => categoryFor(ride) === 'cancelled').length;
  const totalSpent = allHistoryRides
    .filter((ride) => categoryFor(ride) === 'past')
    .reduce((sum, ride) => sum + ride.price, 0);
  const formatWhen = (date: Date | null) => date
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Date unavailable';

  return (
    <>
      <Phone title="Ride history" back backTarget="/(rider)/profile" compactContent>
        {/* Stats banner */}
        <View style={s.riderHistoryStatsRow}>
          <View style={s.riderHistoryStatCard}>
            <Text style={s.riderHistoryStatValue}>{completedCount}</Text>
            <Text style={s.riderHistoryStatLabel}>Completed rides</Text>
          </View>
          <View style={s.riderHistoryStatDivider} />
          <View style={s.riderHistoryStatCard}>
            <Text style={[s.riderHistoryStatValue, { color: colors.primary }]}>${totalSpent.toFixed(0)}</Text>
            <Text style={s.riderHistoryStatLabel}>Total spent</Text>
          </View>
        </View>

        {/* Filter tabs */}
        <View style={s.riderHistoryTabRow}>
          {(['all', 'past', 'cancelled'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[s.riderHistoryTab, historyTab === t && s.riderHistoryTabActive]}
              onPress={() => setHistoryTab(t)}
              activeOpacity={0.75}
            >
              <Text style={[s.riderHistoryTabText, historyTab === t && s.riderHistoryTabTextActive]}>
                {t === 'all' ? `All (${allHistoryRides.length})` : t === 'past' ? `Completed (${completedCount})` : `Cancelled (${cancelledCount})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? <View style={s.riderHistoryLoading}><ActivityIndicator color={colors.primary} size="large" /></View> : null}

        {!loading && historyRides.map((ride) => {
          const category = categoryFor(ride);
          const isFlagged = ride.status === 'FLAGGED';
          const isCancelled = category === 'cancelled';
          const statusLabel = isFlagged ? 'Flagged' : isCancelled ? 'Cancelled' : 'Completed';
          const statusColor = isFlagged ? colors.redDeep : isCancelled ? colors.textSecondary : colors.green;
          const statusBg = isFlagged ? colors.redDim : isCancelled ? colors.bgSecondary : colors.greenDim;
          const initials = ride.driverName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
          const shortFrom = ride.from.split(',')[0]?.trim() || ride.from;
          const shortTo = ride.to.split(',')[0]?.trim() || ride.to;
          return (
            <View key={`${ride.confirmedRideId || ride.id}-${ride.status}`} style={s.riderHistoryCard}>
              <View style={s.riderHistoryCardInner}>
                {/* Top row */}
                <View style={s.riderHistoryCardTop}>
                  <View style={[s.riderHistoryStatusBadge, { backgroundColor: statusBg }]}>
                    <Text style={[s.riderHistoryStatusText, { color: statusColor }]}>{statusLabel}</Text>
                  </View>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <Text style={s.riderHistoryTripMeta}>{formatWhen(ride.date)}</Text>
                    {ride.price > 0 ? <Text style={s.riderHistoryPrice}>${ride.price.toFixed(0)}</Text> : null}
                  </View>
                </View>

                {/* Route */}
                <View style={s.riderHistoryRouteBlock}>
                  <View style={s.riderHistoryRouteRail}>
                    <View style={s.riderHistoryNavyDot} />
                    <View style={s.riderHistoryRouteLine} />
                    <View style={s.riderHistoryOrangeDot} />
                  </View>
                  <View style={s.riderHistoryRouteDetails}>
                    <View>
                      <Text style={s.riderHistoryRouteLabel}>PICKUP</Text>
                      <Text style={s.riderHistoryRouteText} numberOfLines={1}>{shortFrom}</Text>
                    </View>
                    <View>
                      <Text style={s.riderHistoryRouteLabel}>DROPOFF</Text>
                      <Text style={s.riderHistoryRouteText} numberOfLines={1}>{shortTo}</Text>
                    </View>
                  </View>
                </View>

                {/* Footer */}
                <View style={s.riderHistoryFooter}>
                  <TouchableOpacity
                    style={s.riderHistoryAvatar}
                    disabled={!ride.driverId}
                    onPress={() => ride.driverId && router.push({ pathname: '/(rider)/driver/[driverId]', params: { driverId: ride.driverId, returnTo: '/(rider)/settings/ride-history' } } as any)}
                  >
                    {ride.driverAvatarUrl ? (
                      <Image source={{ uri: ride.driverAvatarUrl }} style={s.riderHistoryAvatarImage} contentFit="cover" />
                    ) : ride.driverId ? (
                      <Text style={s.riderHistoryAvatarText}>{initials || 'D'}</Text>
                    ) : (
                      <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                  <View style={s.riderHistoryDriverInfo}>
                    <Text style={s.riderHistoryDriverName} numberOfLines={1}>{ride.driverName}</Text>
                    <Text style={s.riderHistoryDriverMeta}>{ride.seats} {ride.seats === 1 ? 'seat' : 'seats'}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}

        {!loading && !historyRides.length ? (
          <View style={s.riderHistoryEmpty}>
            <View style={s.riderHistoryEmptyIcon}><Ionicons name="car-outline" size={26} color={colors.primary} /></View>
            <Text style={s.riderHistoryEmptyTitle}>{historyTab === 'all' ? 'No ride history yet' : historyTab === 'past' ? 'No completed rides' : 'No cancelled rides'}</Text>
            <Text style={s.riderHistoryEmptyText}>{historyTab === 'all' ? 'Completed and cancelled rides will appear here.' : 'Switch to another tab to see your rides.'}</Text>
            {historyTab === 'all' && (
              <TouchableOpacity style={s.riderHistoryBrowseButton} onPress={() => router.push('/(rider)/available-rides' as any)}>
                <Ionicons name="search-outline" size={17} color={colors.textInverse} />
                <Text style={s.riderHistoryBrowseText}>Browse available rides</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </Phone>

    </>
  );
}
export function DriverPublicProfileReference() {
  return <ColorsProvider><DriverPublicProfileReferenceInner /></ColorsProvider>;
}
function DriverPublicProfileReferenceInner() {
  const { colors, s } = useScreenCtx();
  const { driverId, returnTo } = useLocalSearchParams<{ driverId?: string; returnTo?: string | string[] }>();
  const id = Array.isArray(driverId) ? driverId[0] : driverId;
  const returnTarget = Array.isArray(returnTo) ? returnTo[0] : returnTo;
  const goBack = () => router.replace((returnTarget || '/(rider)/available-rides') as any);
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [driver, setDriver] = useState<any>(null);
  const [allRatings, setAllRatings] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [totalRides, setTotalRides] = useState(0);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    (async () => {
      try {
        // Load driver doc first — it has cached ride count and rating
        const snap = await getDoc(doc(firestore, 'drivers', id));
        const data = snap.exists() ? snap.data() as any : null;
        setDriver(data);

        // Use server-maintained cached count (avoids needing a composite Firestore index)
        const cachedRideCount = data?.ridesCompleted ?? data?.totalRides ?? data?.rideCount ?? data?.ridesCount;
        setTotalRides(typeof cachedRideCount === 'number' ? cachedRideCount : 0);
      } catch {}

      // Ratings — server filters to driver-role only (admin SDK bypasses Firestore rules
      // that would block a viewing rider from querying this driver's confirmedRides).
      try {
        const { getApiBaseUrl } = await import('@/constants/services');
        const resp = await fetch(`${getApiBaseUrl()}/api/drivers/${encodeURIComponent(id)}/public-ratings`);
        if (!resp.ok) throw new Error(`ratings fetch failed: ${resp.status}`);
        const { ratings: ratingDocs } = await resp.json() as { ratings: any[] };
        setAllRatings(ratingDocs);

        const commentedRatings = ratingDocs
          .filter(r => r.comment && String(r.comment).trim())
          .slice(0, 5);
        const enrichedReviews = await Promise.all(commentedRatings.map(async (rating) => {
          const reviewerId = rating.raterId || rating.rater || rating.reviewerId || rating.reviewer ||
            rating.riderId || rating.userId || rating.authorId || rating.uid;
          const embeddedName = rating.reviewerName || rating.raterName || rating.riderName || rating.userName;
          const embeddedAvatar = rating.reviewerAvatarUrl || rating.raterAvatarUrl || rating.riderAvatarUrl ||
            rating.avatarUrl || rating.photoURL;
          if (!reviewerId) return { ...rating, reviewerName: embeddedName || 'Rider', reviewerAvatarUrl: embeddedAvatar || null };
          try {
            const riderSnap = await getDoc(doc(firestore, 'riders', String(reviewerId)));
            if (!riderSnap.exists()) return { ...rating, reviewerId, reviewerName: embeddedName || 'Rider', reviewerAvatarUrl: embeddedAvatar || null };
            const rider = riderSnap.data() as any;
            const riderName = rider.fullName || rider.name || rider.displayName ||
              [rider.firstName, rider.lastName].filter(Boolean).join(' ').trim();
            const riderAvatar = rider.avatarUrl || rider.avatarURL || rider.photoURL || rider.photoUrl || rider.profilePicture;
            return { ...rating, reviewerId, reviewerName: riderName || embeddedName || 'Rider', reviewerAvatarUrl: riderAvatar || embeddedAvatar || null };
          } catch {
            return { ...rating, reviewerId, reviewerName: embeddedName || 'Rider', reviewerAvatarUrl: embeddedAvatar || null };
          }
        }));
        setReviews(enrichedReviews);
      } catch {}

      setLoading(false);
    })();
  }, [id]);

  const DNVY = colors.textPrimary, ORG = colors.primary, BG2 = colors.bg, BDR = colors.border, MUT = colors.textSecondary;

  const pi = driver?.personalInfo && typeof driver.personalInfo === 'object' ? driver.personalInfo : null;
  const name = driver?.fullName
    || (pi?.firstName && pi?.lastName ? `${pi.firstName} ${pi.lastName}`.trim() : null)
    || (pi?.firstName || pi?.lastName || null)
    || (driver?.firstName && driver?.lastName ? `${driver.firstName} ${driver.lastName}`.trim() : null)
    || driver?.firstName || driver?.name || driver?.displayName || 'Driver';
  const initials = name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const avatarUrl = driver?.avatarUrl || driver?.photoURL || driver?.photoUrl || driver?.avatarUrl1 || pi?.avatarUrl || null;
  const avgRating = allRatings.length
    ? allRatings.reduce((s, r) => s + (typeof r.stars === 'number' ? r.stars : r.rating || 0), 0) / allRatings.length
    : (driver?.rating ?? 0);
  const ratingCounts = [5, 4, 3, 2, 1].map(n => ({
    n,
    count: allRatings.filter(r => Math.round(typeof r.stars === 'number' ? r.stars : r.rating || 0) === n).length,
  }));
  // vehicleInfo is nested — also handle legacy 'vehicle' object path
  const vi = (driver?.vehicleInfo && typeof driver.vehicleInfo === 'object' ? driver.vehicleInfo : null)
           || (driver?.vehicle && typeof driver.vehicle === 'object' ? driver.vehicle : null);
  const vehicle = [vi?.year, vi?.make, vi?.model]
    .filter((v) => v && typeof v === 'string' && v.trim())
    .join(' ')
    || vi?.makeModel
    || (typeof driver?.vehicle === 'string' ? driver.vehicle : null)
    || '';
  const vehicleColor = vi?.color || (typeof driver?.vehicleColor === 'string' ? driver.vehicleColor : '') || '';
  const licensePlate = vi?.licensePlate || vi?.plate || '';
  const seats = vi?.seats || driver?.vehicleSeats || driver?.numSeats || '';
  const bio = driver?.bio || driver?.about || driver?.description || pi?.bio || pi?.about || '';
  const university = driver?.university || pi?.university || driver?.school || pi?.school || '';

  const prefRows: { icon: string; label: string; value: string }[] = [
    driver?.talkativeness && { icon: 'chatbubble-outline', label: 'Conversation', value: driver.talkativeness },
    driver?.personality && { icon: 'musical-notes-outline', label: 'Vibe', value: driver.personality },
    driver?.smokingPreference && driver.smokingPreference !== 'No preference' && { icon: 'ban-outline', label: 'Smoking', value: driver.smokingPreference },
    driver?.musicPreferences?.length && { icon: 'headset-outline', label: 'Music', value: (driver.musicPreferences as string[]).slice(0, 3).join(', ') },
    driver?.maxPassengers && { icon: 'people-outline', label: 'Max passengers', value: String(driver.maxPassengers) },
  ].filter(Boolean) as { icon: string; label: string; value: string }[];

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG2, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={ORG} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG2 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 + insets.bottom }}>

          {/* Header */}
          <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2, marginBottom: 6 }}>
            <TouchableOpacity
              onPress={goBack}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BDR, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.75}
            >
              <Ionicons name="chevron-back" size={22} color={DNVY} />
            </TouchableOpacity>
            <Text style={{ color: DNVY, fontSize: 24, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 }}>Driver Profile</Text>
          </View>

          {/* Hero */}
          <View style={{ alignItems: 'center', paddingVertical: 8, marginBottom: 16 }}>
            <View style={{ position: 'relative', marginBottom: 14 }}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: BDR }} contentFit="cover" />
              ) : (
                <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.bgSecondary, borderWidth: 3, borderColor: BDR, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: DNVY, fontSize: 32, fontWeight: '700' }}>{initials || '?'}</Text>
                </View>
              )}
              {avgRating > 0 && (
                <View style={{ position: 'absolute', bottom: -4, right: -4, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: DNVY, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 2, borderColor: BG2 }}>
                  <Ionicons name="star" size={11} color="#F59E0B" />
                  <Text style={{ color: colors.textInverse, fontSize: 11, fontWeight: '700' }}>{avgRating.toFixed(1)}</Text>
                </View>
              )}
            </View>

            <Text style={{ color: DNVY, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 }}>{name}</Text>
            {university ? <Text style={{ color: MUT, fontSize: 13, marginBottom: 18 }}>{university}</Text> : <View style={{ marginBottom: 18 }} />}

            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
                <Text style={{ color: DNVY, fontSize: 20, fontWeight: '800', lineHeight: 24 }}>{totalRides}</Text>
                <Text style={{ color: MUT, fontSize: 11, fontWeight: '600', marginTop: 2 }}>rides</Text>
              </View>
              <View style={{ width: 1, height: 32, backgroundColor: BDR }} />
              <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
                <Text style={{ color: DNVY, fontSize: 20, fontWeight: '800', lineHeight: 24 }}>{allRatings.length}</Text>
                <Text style={{ color: MUT, fontSize: 11, fontWeight: '600', marginTop: 2 }}>ratings</Text>
              </View>
              {avgRating > 0 && (
                <>
                  <View style={{ width: 1, height: 32, backgroundColor: BDR }} />
                  <View style={{ alignItems: 'center', paddingHorizontal: 20 }}>
                    <Text style={{ color: DNVY, fontSize: 20, fontWeight: '800', lineHeight: 24 }}>{avgRating.toFixed(1)}</Text>
                    <Text style={{ color: MUT, fontSize: 11, fontWeight: '600', marginTop: 2 }}>avg rating</Text>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* Vehicle */}
          {(vehicle || seats || vehicleColor || licensePlate) ? (
            <>
              <Text style={{ color: MUT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }}>VEHICLE</Text>
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {vi?.imageUrl ? (
                      <Image source={{ uri: vi.imageUrl }} style={{ width: 56, height: 56 }} contentFit="cover" />
                    ) : (
                      <Ionicons name="car-sport-outline" size={24} color={ORG} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: DNVY, fontSize: 15, fontWeight: '700' }}>{vehicle || 'Vehicle info unavailable'}</Text>
                    <Text style={{ color: MUT, fontSize: 13, marginTop: 2 }}>
                      {[vehicleColor, seats ? `${seats} seats` : '', licensePlate].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              </View>
            </>
          ) : null}

          {/* Bio */}
          {bio ? (
            <>
              <Text style={{ color: MUT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }}>ABOUT</Text>
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                <Text style={{ color: DNVY, fontSize: 14, lineHeight: 21 }}>{bio}</Text>
              </View>
            </>
          ) : null}

          {/* Reviews */}
          {/* Ratings histogram */}
          {allRatings.length > 0 && (
            <>
              <Text style={{ color: MUT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }}>RATINGS</Text>
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <View style={{ alignItems: 'center', minWidth: 56 }}>
                    <Text style={{ color: DNVY, fontSize: 36, fontWeight: '900', lineHeight: 40 }}>{avgRating.toFixed(1)}</Text>
                    <View style={{ flexDirection: 'row', gap: 2, marginTop: 4 }}>
                      {[1,2,3,4,5].map(n => (
                        <Ionicons key={n} name={avgRating >= n ? 'star' : avgRating >= n - 0.5 ? 'star-half' : 'star-outline'} size={12} color="#F59E0B" />
                      ))}
                    </View>
                    <Text style={{ color: MUT, fontSize: 11, marginTop: 3 }}>{allRatings.length} {allRatings.length === 1 ? 'rating' : 'ratings'}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 5 }}>
                    {ratingCounts.map(({ n, count }) => {
                      const pct = allRatings.length ? count / allRatings.length : 0;
                      return (
                        <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ color: MUT, fontSize: 11, width: 8 }}>{n}</Text>
                          <Ionicons name="star" size={10} color="#F59E0B" />
                          <View style={{ flex: 1, height: 6, backgroundColor: colors.bgSecondary, borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: '#F59E0B', borderRadius: 3 }} />
                          </View>
                          <Text style={{ color: MUT, fontSize: 11, width: 16, textAlign: 'right' }}>{count}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Ride Preferences */}
          {prefRows.length > 0 && (
            <>
              <Text style={{ color: MUT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }}>RIDE PREFERENCES</Text>
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                {prefRows.map((row, idx) => (
                  <View key={idx} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BDR }]}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' }}>
                      <Ionicons name={row.icon as any} size={18} color={ORG} />
                    </View>
                    <Text style={{ color: MUT, fontSize: 13, flex: 1 }}>{row.label}</Text>
                    <Text style={{ color: DNVY, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right', maxWidth: '55%' }}>{row.value}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {reviews.length > 0 && (
            <>
              <Text style={{ color: MUT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }}>RIDER REVIEWS</Text>
              <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                {reviews.map((r, idx) => {
                  const stars = typeof r.stars === 'number' ? r.stars : (r.rating || 5);
                  const reviewerName = r.reviewerName || r.raterName || r.userName || 'Rider';
                  const reviewerAvatarUrl = r.reviewerAvatarUrl || r.raterAvatarUrl || r.riderAvatarUrl || null;
                  const reviewerInitials = reviewerName.split(/\s+/).map((part: string) => part[0]).join('').slice(0, 2).toUpperCase();
                  const comment = String(r.comment || '').trim();
                  return (
                    <View key={idx} style={[{ paddingVertical: 12 }, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BDR }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' }}>
                          {reviewerAvatarUrl ? (
                            <Image source={{ uri: reviewerAvatarUrl }} style={{ width: 32, height: 32, borderRadius: 16 }} contentFit="cover" />
                          ) : (
                            <Text style={{ color: DNVY, fontSize: 11, fontWeight: '700' }}>{reviewerInitials || 'R'}</Text>
                          )}
                        </View>
                        <Text style={{ color: DNVY, fontSize: 14, fontWeight: '700', flex: 1 }}>{reviewerName}</Text>
                        <View style={{ flexDirection: 'row', gap: 1 }}>
                          {[1,2,3,4,5].map(n => (
                            <Ionicons key={n} name={stars >= n ? 'star' : 'star-outline'} size={12} color="#F59E0B" />
                          ))}
                        </View>
                      </View>
                      {comment ? <Text style={{ color: MUT, fontSize: 13, lineHeight: 19, fontStyle: 'italic' }}>{`"${comment}"`}</Text> : null}
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {driver && !loading && allRatings.length === 0 && reviews.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 36, gap: 8 }}>
              <Ionicons name="ribbon-outline" size={40} color={BDR} />
              <Text style={{ color: DNVY, fontSize: 15, fontWeight: '700' }}>New to RideAlong</Text>
              <Text style={{ color: MUT, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
                This driver is just getting started — no ratings or reviews yet.
              </Text>
            </View>
          )}

          {!driver && (
            <View style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
              <Ionicons name="person-circle-outline" size={48} color={BDR} />
              <Text style={{ color: DNVY, fontSize: 16, fontWeight: '700' }}>Driver not found</Text>
              <Text style={{ color: MUT, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>This driver profile may no longer be available.</Text>
            </View>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export function TripInProgressReference() {
  return <ColorsProvider><TripInProgressReferenceInner /></ColorsProvider>;
}
function TripInProgressReferenceInner() {
  const { colors, s } = useScreenCtx();
  return (
    <Phone cream bottom={<GhostButton>Share trip with a friend</GhostButton>}>
      <View style={s.mapArea}>
        <View style={s.routeCurve} />
        <View style={[s.mapPin, { left: 44, top: 236, backgroundColor: colors.textPrimary }]} />
        <View style={[s.mapPin, { right: 52, top: 80, backgroundColor: colors.primary }]} />
        <View style={s.carPin}><Ionicons name="car-sport" size={20} color={colors.primary} /></View>
      </View>
      <View style={s.tripSheet}>
        <View style={s.row}><View style={s.bigAvatarSmall}><Text style={s.bigAvatarText}>JT</Text></View><Text style={s.routeTitle}>Jordan T.{'\n'}<Text style={s.mutedSmall}>{"'21 Civic · TX 8RZP-129"}</Text></Text><View style={s.rowIcons}><Ionicons name="chatbubble" size={17} color={colors.textPrimary} /><Ionicons name="call" size={17} color={colors.textPrimary} /></View></View>
        <View style={s.etaCard}><Text style={s.label}>ETA</Text><Text style={s.eta}>2h14m</Text><Text style={s.label}>MILES TO GO</Text><Text style={s.etaMiles}>84.2 mi</Text></View>
      </View>
    </Phone>
  );
}

const RATE_FONT = Platform.OS === 'web'
  ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
  : undefined;

export function RateTripReference() {
  return <ColorsProvider><RateTripReferenceInner /></ColorsProvider>;
}
function RateTripReferenceInner() {
  const { colors, s } = useScreenCtx();
  const { confirmedRideId } = useLocalSearchParams<{ confirmedRideId?: string }>();
  const uid = firebaseAuth.currentUser?.uid;
  const insets = useSafeAreaInsets();

  const [loadingData, setLoadingData] = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [stars, setStars]             = useState(0);
  const [note, setNote]               = useState('');
  const [role, setRole]               = useState<'rider' | 'driver'>('rider');
  const [otherName, setOtherName]     = useState('');
  const [otherPhoto, setOtherPhoto]   = useState<string | null>(null);
  const [otherInitials, setOtherInitials] = useState('');
  const [routeLabel, setRouteLabel]   = useState('');

  useEffect(() => {
    if (!confirmedRideId || !uid) { setLoadingData(false); return; }
    getDoc(doc(firestore, 'confirmedRides', confirmedRideId)).then(async (snap) => {
      if (!snap.exists()) { setLoadingData(false); return; }
      const d = snap.data() as any;
      const isRider = d.riderId === uid;
      const currentRole = isRider ? 'rider' : 'driver';
      const ratedField = isRider ? 'riderRated' : 'driverRated';
      setRole(currentRole);

      if (d[ratedField] || await hasUserRatedRide(confirmedRideId, uid)) {
        router.replace(currentRole === 'rider' ? '/(rider)/' as any : '/(driver)/' as any);
        return;
      }

      const extractText = (v: any): string => {
        if (!v) return '';
        if (typeof v === 'string') return v;
        return v.address || v.description || v.name || '';
      };
      const pu = extractText(d.pickup ?? d.pickupLocation);
      const dr = extractText(d.dropoff ?? d.dropoffLocation);
      if (pu && dr) setRouteLabel(`${pu} → ${dr}`);

      const otherId   = isRider ? d.driverId : d.riderId;
      const otherColl = isRider ? 'drivers' : 'riders';
      if (otherId) {
        const oSnap = await getDoc(doc(firestore, otherColl, otherId)).catch(() => null);
        if (oSnap?.exists()) {
          const od = oSnap.data() as any;
          const name = [od.firstName, od.lastName].filter(Boolean).join(' ').trim()
            || od.fullName
            || od.displayName
            || od.name
            || od.personalInfo?.fullName
            || (isRider ? 'Driver' : 'Rider');
          setOtherName(name);
          setOtherPhoto(od.photoURL || od.avatarUrl || null);
          setOtherInitials(name.split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase());
        }
      }
      setLoadingData(false);
    }).catch(() => setLoadingData(false));
  }, [confirmedRideId, uid]);

  const handleSubmit = async () => {
    const safeStars = Math.round(stars);
    if (submitting) return;
    if (safeStars < 1 || safeStars > 5) {
      Alert.alert('Select a rating', 'Please tap a star before submitting.');
      return;
    }
    if (!confirmedRideId || !uid) return;
    setSubmitting(true);
    try {
      // Re-check to prevent duplicate submissions from race conditions
      const [alreadyRated, rideSnap] = await Promise.all([
        hasUserRatedRide(confirmedRideId, uid),
        getDoc(doc(firestore, 'confirmedRides', confirmedRideId)),
      ]);
      if (alreadyRated) {
        router.replace(role === 'driver' ? '/(driver)/' as any : '/(rider)/' as any);
        return;
      }
      if (!rideSnap.exists()) {
        Alert.alert('Ride not found', 'This ride could not be found. It may have been removed.');
        return;
      }
      const rideStatus = String(rideSnap.data()?.status || '').toUpperCase();
      if (!['COMPLETED', 'RIDER_COMPLETED', 'DRIVER_COMPLETED'].includes(rideStatus)) {
        Alert.alert('Ride not completed', 'You can only rate a ride after it has been completed.');
        return;
      }
      await submitRating({ rideId: confirmedRideId, stars: safeStars, comment: note.trim() || undefined });
      const ratedField = role === 'rider' ? 'riderRated' : 'driverRated';
      await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), { [ratedField]: true }).catch(() => undefined);
      router.replace(role === 'driver' ? '/(driver)/' as any : '/(rider)/' as any);
    } catch (error: any) {
      const code = String(error?.code || error?.message || '');
      if (code.includes('already-exists')) {
        const ratedField = role === 'rider' ? 'riderRated' : 'driverRated';
        await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), { [ratedField]: true }).catch(() => undefined);
        router.replace(role === 'driver' ? '/(driver)/' as any : '/(rider)/' as any);
      } else {
        Alert.alert('Rating not submitted', error?.message || 'Please check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const firstName = otherName.split(' ')[0] || (role === 'rider' ? 'Driver' : 'Rider');

  if (loadingData) {
    return (
      <LinearGradient colors={[colors.primaryDim, colors.bgSecondary, colors.bg]} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </LinearGradient>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <LinearGradient
        colors={[colors.primaryDim, colors.bgSecondary, colors.bg]}
        locations={[0, 0.45, 1]}
        style={{ flex: 1 }}
      >
        <SafeAreaView edges={['top']} />
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={{ alignItems: 'center', paddingTop: 36, paddingBottom: 32, paddingHorizontal: 24 }}>
            <RNText style={{ fontFamily: RATE_FONT, fontSize: 32, fontWeight: '600', color: colors.textPrimary, fontStyle: 'normal' }}>
              {"You've "}<RNText style={{ fontFamily: RATE_FONT, color: colors.primary, fontStyle: 'italic' }}>arrived.</RNText>
            </RNText>
            <RNText style={{ fontSize: 15, color: colors.textSecondary, fontWeight: '500', marginTop: 6 }}>
              Rate {firstName} to wrap up.
            </RNText>

            {/* Avatar */}
            <View style={{
              marginTop: 28, width: 80, height: 80, borderRadius: 40,
              backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              {otherPhoto
                ? <Image source={{ uri: otherPhoto }} style={{ width: 80, height: 80, borderRadius: 40 }} />
                : <RNText style={{ fontSize: 28, fontWeight: '800', color: colors.textPrimary }}>{otherInitials || '?'}</RNText>}
            </View>
            <RNText style={{ fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginTop: 10 }}>{otherName || firstName}</RNText>
            {routeLabel ? <RNText style={{ fontSize: 13, color: colors.textSecondary, marginTop: 3 }}>{routeLabel}</RNText> : null}

            {/* Stars */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setStars(n)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
                  <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={44} color={n <= stars ? colors.primary : colors.border} />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Note */}
          <TextInput
            style={{
              marginHorizontal: 16, backgroundColor: colors.bgCard, borderRadius: 18,
              padding: 16, minHeight: 110, borderWidth: 1, borderColor: colors.border,
              fontSize: 14, color: colors.textPrimary, textAlignVertical: 'top',
            }}
            placeholder="Leave a note (optional)..."
            placeholderTextColor={colors.textSecondary}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </ScrollView>

        {/* Submit */}
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          paddingHorizontal: 16, paddingBottom: insets.bottom + 16, paddingTop: 14,
        }}>
          <TouchableOpacity
            style={{ backgroundColor: colors.primary, borderRadius: 28, paddingVertical: 16, alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color={colors.textInverse} />
              : <RNText style={{ color: colors.textInverse, fontSize: 16, fontWeight: '800' }}>Submit</RNText>}
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}


export function RiderMessagesReference() {
  return <ColorsProvider><RiderMessagesReferenceInner /></ColorsProvider>;
}
function RiderMessagesReferenceInner() {
  const { colors, s } = useScreenCtx();
  const uid = firebaseAuth.currentUser?.uid;
  const [chats, setChats] = useState<MobileConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    return subscribeRiderConversations(uid, (items) => {
      setChats(items);
      setLoading(false);
    });
  }, [uid]);

  const formatChatTime = (date: Date | null) => {
    if (!date) return '';
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const removeConversation = (chatId: string) => {
    Alert.alert('Delete conversation?', 'This conversation will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setDeletingChatId(chatId);
            await deleteMessageThread(chatId);
            setChats((current) => current.filter((chat) => chat.id !== chatId));
          } catch (error: any) {
            if (error?.statusCode === 404) {
              setChats((current) => current.filter((chat) => chat.id !== chatId));
              return;
            }
            Alert.alert('Could not delete conversation', getDeleteMessageThreadErrorMessage(error));
          } finally {
            setDeletingChatId(null);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item: chat }: { item: MobileConversation }) => (
    <Swipeable
      overshootRight={false}
      renderRightActions={() => (
        <TouchableOpacity style={s.swipeDelete} onPress={() => removeConversation(chat.id)} disabled={deletingChatId === chat.id} accessibilityRole="button" accessibilityLabel={`Delete conversation with ${chat.name}`}>
          {deletingChatId === chat.id ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="trash-outline" size={20} color={colors.textInverse} />}
          <Text style={s.swipeDeleteText}>Delete</Text>
        </TouchableOpacity>
      )}
    >
      <TouchableOpacity style={s.messageCard} onPress={() => router.push(`/(rider)/messages/${chat.id}` as any)} disabled={deletingChatId === chat.id} accessibilityRole="button">
        <View style={s.messageAvatar}>
          {chat.photoURL
            ? <Image source={{ uri: chat.photoURL }} style={{ width: 48, height: 48, borderRadius: 24 }} contentFit="cover" />
            : <Text style={s.messageAvatarText}>{chat.initials}</Text>}
        </View>
        <View style={s.messageContent}>
          <View style={s.messageTopLine}>
            <Text style={s.messageName} numberOfLines={1}>{chat.name}</Text>
          </View>
          <Text style={s.messagePreview} numberOfLines={1}>{chat.preview}</Text>
        </View>
        <View style={s.messageMeta}>
          <Text style={s.messageTime}>{formatChatTime(chat.updatedAt)}</Text>
          {chat.chatAvailable === false ? <Text style={s.closedBadge}>CLOSED</Text> : null}
          {chat.unread > 0 ? <Text style={s.newBadge}>{chat.unread} NEW</Text> : null}
        </View>
      </TouchableOpacity>
    </Swipeable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <FlatList
          data={chats}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 102, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ marginBottom: 4 }}>
              <Text style={{ color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25 }}>Messages</Text>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
                <View style={s.messageEmptyIcon}><Ionicons name="chatbubbles-outline" size={25} color={colors.primary} /></View>
                <Text style={s.messageEmptyTitle}>No conversations yet</Text>
                <Text style={s.messageEmptyText}>Messages with drivers will appear after you request or book a ride.</Text>
              </View>
            ) : loading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : null
          }
        />
      </SafeAreaView>
      <BottomNav active="inbox" />
    </View>
  );
}



export function RiderChatReference() {
  return <ColorsProvider><RiderChatReferenceInner /></ColorsProvider>;
}
function RiderChatReferenceInner() {
  const { colors, s } = useScreenCtx();
  const { chatId } = useLocalSearchParams<{ chatId?: string }>();
  const id = Array.isArray(chatId) ? chatId[0] : chatId;
  const uid = firebaseAuth.currentUser?.uid || '';
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<MobileMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [recipientName, setRecipientName] = useState('Loading...');
  const [recipientInitial, setRecipientInitial] = useState('?');
  const [recipientPhotoURL, setRecipientPhotoURL] = useState<string | null>(null);
  const [rideInfo, setRideInfo] = useState('');
  const [rideStatus, setRideStatus] = useState<string | null>(null);
  const [chatAvailable, setChatAvailable] = useState(true);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const flatListRef = React.useRef<any>(null);

  useEffect(() => {
    if (!id || !uid) return;
    void markChatAsRead(id, uid, 'rider').catch(() => undefined);

    // Load chat metadata
    (async () => {
      try {
        const chatSnap = await getDoc(doc(firestore, 'chats', id));
        if (!chatSnap.exists()) return;
        const chatData = chatSnap.data() as any;
        const availability = await resolveChatAvailability(chatData).catch(() => ({ available: true, status: null, rideInfo: '' }));
        setChatAvailable(availability.available !== false);
        setRideStatus(availability.status || null);
        if (availability.rideInfo) setRideInfo(availability.rideInfo);
        const participants: string[] = Array.isArray(chatData.participants) ? chatData.participants : [];
        const otherId = participants.find((p) => p !== uid) || null;
        setRecipientId(otherId);
        if (otherId) {
          // Try drivers first, then riders
          let displayName = 'Driver';
          let photoURL: string | null = null;
          const driverSnap = await getDoc(doc(firestore, 'drivers', otherId));
          if (driverSnap.exists()) {
            const d = driverSnap.data() as any;
            displayName = d.fullName || d.name || d.displayName || 'Driver';
            photoURL = d.photoURL || d.avatarUrl || null;
          } else {
            const riderSnap = await getDoc(doc(firestore, 'riders', otherId));
            if (riderSnap.exists()) {
              const d = riderSnap.data() as any;
              displayName = d.fullName || d.name || d.displayName || 'User';
              photoURL = d.photoURL || d.avatarUrl || null;
            }
          }
          setRecipientName(displayName);
          setRecipientInitial(displayName.charAt(0).toUpperCase());
          setRecipientPhotoURL(photoURL);
        }
        if (chatData.rideId) {
          const rideSnap = await getDoc(doc(firestore, 'confirmedRides', chatData.rideId));
          if (rideSnap.exists()) {
            const rd = rideSnap.data() as any;
            const from = (rd.pickup || rd.pickupAddress || '').substring(0, 22);
            const to = (rd.dropoff || rd.dropoffAddress || '').substring(0, 22);
            if (!availability.rideInfo) setRideInfo(`${from} → ${to}${rd.date ? ` · ${rd.date}` : ''}`);
          }
        }
      } catch {}
    })();

    const unsub = subscribeChatMessages(id, (msgs) => {
      setMessages(msgs);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    });
    return unsub;
  }, [id, uid]);

  const messagingBlocked = chatAvailable === false || isTerminalStatus(rideStatus) || (rideStatus ? !canSendMessages(rideStatus) : false);

  const send = async () => {
    if (!id || !uid || !draft.trim() || sending) return;
    if (messagingBlocked) {
      Alert.alert('Chat unavailable', MESSAGING_DISABLED_MESSAGE);
      return;
    }
    const text = draft.trim();
    setSending(true);
    try {
      await sendChatMessage(id, uid, text, 'rider');
      setDraft('');

      // Push notification to the driver
      if (recipientId) {
        try {
          const driverSnap = await getDoc(doc(firestore, 'drivers', recipientId));
          const pushToken = driverSnap.exists() ? ((driverSnap.data() as any)?.pushToken || (driverSnap.data() as any)?.expoPushToken) : null;
          if (pushToken && String(pushToken).startsWith('ExponentPushToken')) {
            const senderName = firebaseAuth.currentUser?.displayName || 'A rider';
            const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                to: pushToken,
                title: `Message from ${senderName}`,
                body: text.length > 100 ? `${text.slice(0, 97)}...` : text,
                data: { type: 'chat_message', chatId: id },
                sound: 'default',
              }),
            });
            if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.status}`);
          }
        } catch {}
      }
    } catch (error: any) {
      console.warn('[RiderChatReference] send failed:', error);
      Alert.alert('Message not sent', error?.message || 'Please check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  const formatTime = (msg: MobileMessage) => {
    if (!msg.createdAt) return '';
    return msg.createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const confirmDelete = () => {
    if (!id || deleting) return;
    Alert.alert('Delete conversation', 'Delete this conversation? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeleting(true);
        try {
          await deleteMessageThread(id);
          router.replace('/(rider)/messages' as any);
        } catch (error: any) {
          if (error?.statusCode === 404) { router.replace('/(rider)/messages' as any); return; }
          Alert.alert('Could not delete', getDeleteMessageThreadErrorMessage(error));
        } finally { setDeleting(false); }
      }},
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg, gap: 10 }}>
            <TouchableOpacity
              onPress={() => router.replace('/(rider)/messages' as any)}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.75}
            >
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>

            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {recipientPhotoURL
                ? <Image source={{ uri: recipientPhotoURL }} style={{ width: 38, height: 38, borderRadius: 19 }} />
                : <RNText style={{ fontSize: 16, fontWeight: '800', color: colors.textInverse }}>{recipientInitial}</RNText>}
            </View>

            <View style={{ flex: 1 }}>
              <RNText style={{ color: colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 }} numberOfLines={1}>{recipientName}</RNText>
              {rideInfo ? <RNText style={{ color: colors.textSecondary, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{rideInfo}</RNText> : null}
            </View>

            <TouchableOpacity
              onPress={confirmDelete}
              disabled={deleting}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.redBorder, backgroundColor: colors.redDim, alignItems: 'center', justifyContent: 'center', opacity: deleting ? 0.5 : 1 }}
              activeOpacity={0.75}
            >
              {deleting ? <ActivityIndicator size="small" color={colors.red} /> : <Ionicons name="trash-outline" size={19} color={colors.red} />}
            </TouchableOpacity>

          </View>


          {/* Messages */}
          <ScrollView
            ref={flatListRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ padding: 16, paddingTop: 28, paddingBottom: 8, flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            {!messages.length ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primary} />
                </View>
                <RNText style={{ color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>Coordinate your ride</RNText>
                <RNText style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                  Use this chat to discuss pickup location, timing, any last-minute changes, or if you&apos;re running late.
                </RNText>
              </View>
            ) : null}
            {messages.map((msg) => {
    const isMine = msg.senderId === uid && (!msg.senderRole || msg.senderRole === 'rider');
              return (
                <View key={msg.id} style={[{ marginBottom: 14 }, isMine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                  <View style={isMine
                    ? { maxWidth: '72%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, borderBottomRightRadius: 4, backgroundColor: colors.primary }
                    : { maxWidth: '72%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, borderBottomLeftRadius: 4, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border }
                  }>
                    <RNText style={{ fontSize: 15, lineHeight: 21, color: isMine ? colors.textInverse : colors.textPrimary }}>{msg.text}</RNText>
                  </View>
                  <RNText style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4, marginHorizontal: 4, fontWeight: '500', textAlign: isMine ? 'right' : 'left' }}>{formatTime(msg)}</RNText>
                </View>
              );
            })}
          </ScrollView>


          {/* Input bar */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: colors.border, gap: 10, backgroundColor: colors.bgCard }}>
            {messagingBlocked ? (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.bgSecondary, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
                <RNText style={{ flex: 1, color: colors.textSecondary, fontSize: 13, textAlign: 'center', fontWeight: '500' }}>{MESSAGING_DISABLED_MESSAGE}</RNText>
              </View>
            ) : (
              <>
                <TextInput
                  style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100, backgroundColor: colors.bgSecondary, color: colors.textPrimary }}
                  placeholder="Pickup spot, timing, updates…"
                  placeholderTextColor={colors.textSecondary}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={1000}
                  onSubmitEditing={send}
                />
                <TouchableOpacity
                  style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: (!draft.trim() || sending) ? 0.45 : 1 }}
                  onPress={send}
                  disabled={!draft.trim() || sending}
                >
                  {sending ? <ActivityIndicator size="small" color={colors.textInverse} /> : <Ionicons name="send" size={18} color={colors.textInverse} />}
                </TouchableOpacity>
              </>
            )}
          </View>

        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Bubble({ side, text }: { side: 'me' | 'them' | 'pin'; text: string }) {
  const { s } = useScreenCtx();
  return <Text style={[s.bubble, side === 'me' && s.bubbleMe, side === 'pin' && s.bubblePin]}>{text}</Text>;
}


export function RiderNotificationsReference() {
  return <ColorsProvider><RiderNotificationsReferenceInner /></ColorsProvider>;
}
function RiderNotificationsReferenceInner() {
  const { colors, s } = useScreenCtx();
  const uid = firebaseAuth.currentUser?.uid;
  const [items, setItems] = useState<MobileNotification[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  useEffect(() => uid ? subscribeRiderNotifications(uid, setItems) : undefined, [uid]);

  const removeNotification = async (id: string) => {
    if (!uid || deletingId) return;
    const previous = items;
    setDeletingId(id);
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      await deleteDoc(doc(firestore, 'notifications', id));
    } catch {
      setItems(previous);
      Alert.alert('Could not delete notification', 'Please check your connection and try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const openNotification = async (item: MobileNotification) => {
    if (!uid || item.read) return;
    setItems((current) => current.map((notification) => notification.id === item.id ? { ...notification, read: true } : notification));
    try {
      await markRiderNotificationAsRead(item.id, uid);
    } catch {
      setItems((current) => current.map((notification) => notification.id === item.id ? { ...notification, read: false } : notification));
    }
  };

  return (
    <Phone title="Notifications" back backHref="/(rider)/profile" compactContent headerGap={0}>
      {items.map((item, index) => (
        <Swipeable
          key={item.id}
          overshootRight={false}
          renderRightActions={() => (
            <TouchableOpacity style={s.swipeDelete} onPress={() => void removeNotification(item.id)} disabled={deletingId === item.id} accessibilityRole="button" accessibilityLabel="Delete notification">
              {deletingId === item.id ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="trash-outline" size={20} color={colors.textInverse} />}
              <Text style={s.swipeDeleteText}>Delete</Text>
            </TouchableOpacity>
          )}
        >
          <TouchableOpacity onPress={() => void openNotification(item)} disabled={item.read} accessibilityRole="button" accessibilityLabel={item.read ? 'Read notification' : 'Mark notification as read'}>
            <NoticeRow icon={item.type.includes('message') ? 'chatbubble-outline' : item.type.includes('payment') ? 'card-outline' : 'notifications-outline'} text={item.body || item.title} time={item.createdAt ? item.createdAt.toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''} orange={!item.read} first={index === 0} />
          </TouchableOpacity>
        </Swipeable>
      ))}
      {!items.length ? (
        <View style={s.notificationEmptyCard}>
          <View style={s.notificationEmptyIcon}>
            <Ionicons name="notifications-outline" size={24} color={colors.primary} />
          </View>
          <Text style={s.notificationEmptyTitle}>You are all caught up</Text>
          <Text style={s.notificationEmptyText}>Ride updates, messages, and account alerts will appear here.</Text>
        </View>
      ) : null}
    </Phone>
  );
}

function NoticeRow({ icon, text, time, orange, first }: { icon: keyof typeof Ionicons.glyphMap; text: string; time: string; orange?: boolean; first?: boolean }) {
  const { colors, s } = useScreenCtx();
  const isBell = icon === 'notifications-outline' || icon === 'notifications';
  return (
    <View style={[s.noticeRow, first && s.noticeRowFirst]}>
      {/* Unread indicator dot */}
      {orange ? (
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, alignSelf: 'center', flexShrink: 0, marginRight: -6 }} />
      ) : (
        <View style={{ width: 7, flexShrink: 0, marginRight: -6 }} />
      )}
      <View style={[s.noticeIcon, orange && { backgroundColor: colors.primaryDim }, isBell && { backgroundColor: colors.primary }]}>
        <Ionicons name={icon} size={16} color={isBell ? colors.textInverse : orange ? colors.primary : colors.textPrimary} />
      </View>
      <Text style={[s.noticeBody, orange && { fontWeight: '600', color: colors.textPrimary }]}>{text}</Text>
      <Text style={[s.mono, orange && { color: colors.primary, fontWeight: '600' }]}>{time}</Text>
    </View>
  );
}


export function RiderProfileReference() {
  return <ColorsProvider><RiderProfileReferenceInner /></ColorsProvider>;
}
function RiderProfileReferenceInner() {
  const { colors, s } = useScreenCtx();
  const { signOut, role, switchRole } = useAuthStore();
  const uid = firebaseAuth.currentUser?.uid;
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [requests, setRequests] = useState<MobileRideRequest[]>([]);
  const [completedRides, setCompletedRides] = useState(0);
  const [roleActionLoading, setRoleActionLoading] = useState(false);
  useEffect(() => uid ? subscribeRiderProfile(uid, setProfile) : undefined, [uid]);
  useEffect(() => uid ? subscribeRiderRequests(uid, setRequests) : undefined, [uid]);
  // Count completed rides from confirmedRides — must query both riderId and userId fields
  useEffect(() => {
    if (!uid) return;
    const isCompleted = (d: any) => ['COMPLETED', 'COMPLETE', 'FINISHED'].includes(String(d.data()?.status || '').toUpperCase());
    const seen = new Set<string>();
    let byRider: string[] = [];
    let byUser: string[] = [];
    const merge = () => {
      seen.clear();
      [...byRider, ...byUser].forEach((id) => seen.add(id));
      setCompletedRides(seen.size);
    };
    const unsubA = onSnapshot(query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid)), (snap) => {
      byRider = snap.docs.filter(isCompleted).map((d) => d.id); merge();
    }, () => {});
    const unsubB = onSnapshot(query(collection(firestore, 'confirmedRides'), where('userId', '==', uid)), (snap) => {
      byUser = snap.docs.filter(isCompleted).map((d) => d.id); merge();
    }, () => {});
    return () => { unsubA(); unsubB(); };
  }, [uid]);
  const initials = (profile?.displayName || firebaseAuth.currentUser?.email || 'RA').split(/\s+|@/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const cancelledRides = requests.filter((request) => ['cancelled', 'canceled', 'declined', 'rejected'].includes(request.status)).length;

  const hasDriverAccount = role === 'both';
  const showSwitchBtn = role !== 'driver';

  const handleDriverMode = async () => {
    if (roleActionLoading) return;
    if (hasDriverAccount) {
      setRoleActionLoading(true);
      try {
        await switchRole('driver');
        router.replace('/(driver)' as any);
      } catch {
        Alert.alert('Could not switch', 'Please try again.');
      } finally {
        setRoleActionLoading(false);
      }
    } else {
      router.push({ pathname: '/(auth)/driver-signup', params: { upgrade: '1' } } as any);
    }
  };

  return (
    <Phone activeTab="profile" compactContent>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1 }}>Profile</Text>
        <TouchableOpacity style={s.profileSettingsBtn} onPress={() => router.push({ pathname: '/(rider)/settings', params: { returnTo: '/(rider)/profile' } } as any)}><Ionicons name="settings" size={20} color={colors.textPrimary} /></TouchableOpacity>
      </View>
      <View style={s.profileTopRow}>
        <View style={s.bigAvatar}>{profile?.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={s.bigAvatarImage} contentFit="cover" /> : <Text style={s.bigAvatarText}>{initials}</Text>}</View>
        <View style={{ flex: 1 }}>
          <View style={s.profileIdentityHeader}>
            <Text style={s.profileName}>{profile?.displayName || 'RideAlong rider'}</Text>
            <TouchableOpacity style={s.editProfileButton} onPress={() => router.push({ pathname: '/(rider)/settings/account-settings', params: { returnTo: '/(rider)/profile' } } as any)} accessibilityRole="button" accessibilityLabel="Edit profile" hitSlop={hitSlop}>
              <Ionicons name="pencil" size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <Text style={s.mutedSmall}>{profile?.university || profile?.email || firebaseAuth.currentUser?.email}</Text>
          <View style={[s.pillRow, s.profileBadgeRow]}><Pill label="Verified account" active />{profile?.rating ? <Pill label={`★ ${profile.rating.toFixed(2)}`} /> : null}</View>
        </View>
      </View>
      <View style={s.profileActivity}>
        <View style={s.profileActivityItem}><Text style={s.profileActivityValue}>{completedRides}</Text><Text style={s.profileActivityLabel}>Completed</Text></View>
        <View style={s.profileActivityDivider} />
        <View style={s.profileActivityItem}><Text style={s.profileActivityValue}>{completedRides + cancelledRides}</Text><Text style={s.profileActivityLabel}>Total</Text></View>
        <View style={s.profileActivityDivider} />
        <View style={s.profileActivityItem}><Text style={[s.profileActivityValue, cancelledRides > 0 && s.profileActivityCancelled]}>{cancelledRides}</Text><Text style={s.profileActivityLabel}>Cancelled</Text></View>
      </View>
      {profile?.about ? (
        <View style={s.profileAboutCard}>
          <Text style={s.profileAboutTitle}>About</Text>
          <Text style={s.profileAboutText}>{profile.about}</Text>
        </View>
      ) : null}
      {showSwitchBtn ? (
        <TouchableOpacity style={s.driverSwitchBtn} onPress={handleDriverMode} disabled={roleActionLoading} activeOpacity={0.82}>
          {roleActionLoading ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <>
              <View style={s.driverSwitchIconWrap}>
                <Ionicons name="car-outline" size={17} color={colors.textInverse} />
              </View>
              <Text style={s.driverSwitchBtnText}>
                {hasDriverAccount ? 'Switch to driver mode' : 'Become a driver'}
              </Text>
              <Ionicons name="chevron-forward" size={15} color={colors.textInverse} />
            </>
          )}
        </TouchableOpacity>
      ) : null}
      <View style={s.menuCard}><MenuRow icon="wallet" title="Payment methods" href="/(rider)/settings/payment-methods" returnTo="/(rider)/profile" /><MenuRow icon="time" title="Ride history" href="/(rider)/settings/ride-history" returnTo="/(rider)/profile" /><MenuRow icon="notifications" title="Notifications" href="/(rider)/notifications" returnTo="/(rider)/profile" /></View>
      <TouchableOpacity style={s.logoutBtn} onPress={signOut} activeOpacity={0.85}>
        <Text style={s.logoutBtnText}>Log out</Text>
      </TouchableOpacity>
    </Phone>
  );
}

function Stat({ value, label, orange }: { value: string; label: string; orange?: boolean }) {
  const { colors, s } = useScreenCtx();
  return <View style={s.statBox}><Text style={[s.statValue, orange && { color: colors.primary }]}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>;
}

function MenuRow({ icon, title, sub, href, returnTo }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; href?: string; returnTo?: string }) {
  const { colors, s } = useScreenCtx();
  const pathname = usePathname();
  const handlePress = async () => {
    if (!href) return;

    if (href.startsWith('http')) {
      try {
        await WebBrowser.openBrowserAsync(href);
      } catch {
        // Fall back to system browser
        await Linking.openURL(href).catch(() => Alert.alert('Unable to open link', 'Please try again.'));
      }
      return;
    }

    router.push({ pathname: href, params: { returnTo: returnTo || pathname } } as any);
  };

  return (
    <TouchableOpacity style={s.menuRow} onPress={handlePress} disabled={!href} accessibilityRole={href ? "link" : undefined}>
      <View style={s.menuIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
      <View style={{ flex: 1 }}><Text style={s.menuTitle}>{title}</Text>{sub ? <Text style={s.menuSub}>{sub}</Text> : null}</View>
      <Ionicons name="chevron-forward" size={17} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function SettingsToggleRow({ icon, title, sub, value, onChange, isLast = false }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; value: boolean; onChange: (value: boolean) => void; isLast?: boolean }) {
  const { colors, s } = useScreenCtx();
  return (
    <View style={[s.menuRow, isLast && s.menuRowLast]}>
      <View style={s.menuIcon}><Ionicons name={icon} size={18} color={colors.primary} /></View>
      <View style={{ flex: 1 }}><Text style={s.menuTitle}>{title}</Text><Text style={s.menuSub}>{sub}</Text></View>
      <View style={s.settingsSwitchWrap}>
        <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.bgCard} ios_backgroundColor={colors.border} style={s.settingsSwitch} />
      </View>
    </View>
  );
}

export function RiderSettingsReference() {
  return <ColorsProvider><RiderSettingsReferenceInner /></ColorsProvider>;
}
function RiderSettingsReferenceInner() {
  const { s } = useScreenCtx();
  const { isDark, setDark } = useAppTheme();
  const { riderProfile } = useAuthStore();
  const { isVerified, verificationStatus } = useVerificationStore();
  const [pushEnabled, setPushEnabled] = useState(true);

  const riderUniversity = riderProfile?.university || null;
  const isVerifiedFinal = isVerified || verificationStatus === 'approved' || verificationStatus === 'auto-approved';
  const isPending = verificationStatus === 'pending' || verificationStatus === 'manual-review';
  const verStatusLabel = isVerifiedFinal ? 'Approved' : isPending ? 'Pending review' : 'Not verified';
  const riderVerLabel = riderUniversity ? `${riderUniversity} · ${verStatusLabel}` : verStatusLabel;

  useEffect(() => {
    settingsService.getSettings().then((settings) => setPushEnabled(settings.pushNotificationsEnabled)).catch(() => {});
    const loadRiderSettings = async () => {
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return;
      try {
        const snapshot = await getDoc(doc(firestore, 'riders', currentUser.uid));
        const data = snapshot.data() as any;
        const savedPush = data?.settings?.pushNotificationsEnabled ?? data?.pushNotificationsEnabled;
        if (typeof savedPush === 'boolean') setPushEnabled(savedPush);
      } catch {}
    };
    void loadRiderSettings();
  }, []);

  const togglePush = async (value: boolean) => {
    const previous = pushEnabled;
    setPushEnabled(value);
    try {
      await settingsService.updateSettings({ pushNotificationsEnabled: value });
      const currentUser = firebaseAuth.currentUser;
      if (currentUser) await setDoc(doc(firestore, 'riders', currentUser.uid), { pushNotificationsEnabled: value, settings: { pushNotificationsEnabled: value }, updatedAt: serverTimestamp() }, { merge: true });
      await notificationService.updateNotificationHandler();
    } catch {
      setPushEnabled(previous);
      Alert.alert('Settings not saved', 'We could not update your notification setting. Please try again.');
    }
  };

  const toggleDarkMode = async (value: boolean) => {
    const previous = isDark;
    setDark(value);
    try {
      const currentUser = firebaseAuth.currentUser;
      if (currentUser) await setDoc(doc(firestore, 'riders', currentUser.uid), { darkModeEnabled: value, settings: { darkModeEnabled: value }, updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      setDark(previous);
      Alert.alert('Settings not saved', 'We could not update your dark mode setting. Please try again.');
    }
  };
  return (
    <Phone title="Settings" back backTarget="/(rider)/profile" compactContent headerGap={0}>
      <Text style={s.settingsSectionLabel}>ACCOUNT</Text>
      <View style={[s.menuCard, s.settingsMenuCard]}>
        <MenuRow icon="person" title="Account" sub="Email, phone, password" href="/(rider)/settings/account-settings" returnTo="/(rider)/settings" />
        <MenuRow icon="school" title="Student verification" sub={riderVerLabel} href="/(rider)/settings/student-verification" returnTo="/(rider)/settings" />

      </View>
      <Text style={s.settingsSectionLabel}>RIDE</Text>
      <View style={[s.menuCard, s.settingsMenuCard]}>
        <MenuRow icon="options" title="Ride preferences" sub="Music, quiet rides, pets" href="/(rider)/settings/ride-preferences" returnTo="/(rider)/settings" />
      </View>
      <Text style={s.settingsSectionLabel}>SAFETY</Text>
        <View style={[s.menuCard, s.settingsMenuCard]}>
          <MenuRow icon="shield" title="Emergency contacts" sub="2 trusted contacts" href="/(rider)/settings/emergency-contacts" returnTo="/(rider)/settings" />
        </View>
      <Text style={s.settingsSectionLabel}>APP PREFERENCES</Text>
      <View style={[s.menuCard, s.settingsMenuCard]}>
        <SettingsToggleRow icon="notifications" title="Push notifications" sub="Ride offers and account alerts" value={pushEnabled} onChange={(value) => void togglePush(value)} />
        <SettingsToggleRow icon="moon" title="Dark mode" sub={isDark ? 'On' : 'Off'} value={isDark} onChange={(value) => void toggleDarkMode(value)} isLast />
      </View>
      <Text style={s.settingsSectionLabel}>HELP & LEGAL</Text>
      <View style={[s.menuCard, s.settingsMenuCard, s.settingsMenuCardLast]}>
        <MenuRow icon="help-circle" title="Help & support" href="https://ridealongapp.com/pages/help" />
        <MenuRow icon="chatbubble-ellipses" title="Report a bug / Feedback" href="https://ridealongapp.com/pages/feedback" />
        <MenuRow icon="shield-checkmark" title="Privacy policy" href="https://ridealongapp.com/pages/privacy" />
        <MenuRow icon="document-text" title="Terms of service" href="https://ridealongapp.com/pages/terms" />
      </View>
    </Phone>
  );
}

export function RiderAccountReference() {
  return <ColorsProvider><RiderAccountReferenceInner /></ColorsProvider>;
}
function RiderAccountReferenceInner() {
  const { s } = useScreenCtx();
  return (
    <Phone title="Account" back backHref="/(rider)/settings" bottom={<PrimaryButton>Save changes</PrimaryButton>}>
      <View style={s.accountAvatar}><View style={s.bigAvatar}><Text style={s.bigAvatarText}>MA</Text></View><Text style={s.messagePreview}>Tap to change photo</Text></View>
      <View style={s.split}><Field label="NAME" value="Melody" onChangeText={() => {}} /><Field label=" " value="Adeyemi" onChangeText={() => {}} /></View>
      <Field label="EMAIL · .EDU" value="melody@utexas.edu" onChangeText={() => {}} />
      <Field label="PHONE" value="+1 (512) 555-8243" onChangeText={() => {}} />
      <Label>PASSWORD</Label>
      <GhostButton>Change password</GhostButton>
      <Label>DANGER ZONE</Label>
      <View style={s.menuCard}><MenuRow icon="pause" title="Pause account" /><MenuRow icon="trash" title="Delete account" /></View>
    </Phone>
  );
}

export function RiderEmergencyReference() {
  return <ColorsProvider><RiderEmergencyReferenceInner /></ColorsProvider>;
}
function RiderEmergencyReferenceInner() {
  const { colors, s } = useScreenCtx();
  const { contacts, isLoading, loadContacts, addContact, deleteContact } = useEmergencyContactsStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');

  useEffect(() => {
    void loadContacts().catch(() => Alert.alert('Could not load contacts', 'Please check your connection and try again.'));
  }, [loadContacts]);

  const closeModal = () => {
    if (isLoading) return;
    setModalOpen(false);
    setName('');
    setPhone('');
    setRelationship('');
  };

  const saveContact = async () => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedRelationship = relationship.trim();
    if (!trimmedName || !trimmedPhone || !trimmedRelationship) {
      Alert.alert('Missing information', 'Enter a name, relationship, and phone number.');
      return;
    }
    if (trimmedPhone.replace(/\D/g, '').length < 10) {
      Alert.alert('Invalid phone number', 'Enter a valid phone number with at least 10 digits.');
      return;
    }
    try {
      await addContact({ name: trimmedName, phone: trimmedPhone, relationship: trimmedRelationship });
      closeModal();
    } catch {
      Alert.alert('Could not add contact', 'Please check your connection and try again.');
    }
  };

  const confirmDeleteContact = (index: number, contactName: string) => {
    Alert.alert('Remove emergency contact?', `${contactName} will no longer receive emergency ride updates.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void deleteContact(index).catch(() => Alert.alert('Could not remove contact', 'Please try again.')),
      },
    ]);
  };

  return (
    <>
      <Phone title="Emergency contacts" back backHref="/(rider)/profile" compactContent>
        <View style={s.emergencyIntro}>
          <View style={s.emergencyIntroIcon}><Ionicons name="shield-checkmark" size={22} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.emergencyIntroTitle}>Keep trusted people informed</Text>
            <Text style={s.emergencyIntroText}>Contacts can receive your live trip details and emergency alerts. We never share ride information otherwise.</Text>
          </View>
        </View>

        <View style={s.emergencySectionHeader}>
          <View>
            <Text style={s.emergencySectionTitle}>Your contacts</Text>
            <Text style={s.emergencyCount}>{contacts.length} saved</Text>
          </View>
          <TouchableOpacity style={s.emergencyHeaderAdd} onPress={() => setModalOpen(true)} accessibilityRole="button" accessibilityLabel="Add emergency contact">
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={s.emergencyHeaderAddText}>Add</Text>
          </TouchableOpacity>
        </View>

        {isLoading && !contacts.length ? <View style={s.preferenceLoading}><ActivityIndicator color={colors.primary} /><Text style={s.paymentStateText}>Loading contacts...</Text></View> : null}

        {!isLoading && !contacts.length ? (
          <View style={s.emergencyEmpty}>
            <View style={s.emergencyEmptyIcon}><Ionicons name="people-outline" size={28} color={colors.primary} /></View>
            <Text style={s.paymentStateTitle}>No emergency contacts yet</Text>
            <Text style={s.paymentStateText}>Add someone you trust so they can receive trip and safety updates.</Text>
          </View>
        ) : null}

        {contacts.map((contact, index) => (
          <Contact key={contact.id || `${contact.phone}-${index}`} contact={contact} onDelete={() => confirmDeleteContact(index, contact.name)} />
        ))}

        <TouchableOpacity style={s.addContactButton} onPress={() => setModalOpen(true)} accessibilityRole="button">
          <Ionicons name="person-add-outline" size={20} color={colors.textInverse} />
          <Text style={s.addContactButtonText}>Add emergency contact</Text>
        </TouchableOpacity>
      </Phone>

      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAwareModalView style={s.contactModalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={closeModal} />
          <View style={s.contactModalSheet}>
            <View style={s.contactModalHandle} />
            <View style={s.contactModalHeader}>
              <View>
                <Text style={s.contactModalTitle}>Add emergency contact</Text>
                <Text style={s.contactModalSubtitle}>Choose someone you trust during a ride.</Text>
              </View>
              <TouchableOpacity style={s.contactModalClose} onPress={closeModal} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={s.contactFieldLabel}>FULL NAME</Text>
            <TextInput style={s.contactInput} value={name} onChangeText={setName} placeholder="Adaora Adeyemi" placeholderTextColor={colors.textSecondary} autoCapitalize="words" />
            <Text style={s.contactFieldLabel}>RELATIONSHIP</Text>
            <TextInput style={s.contactInput} value={relationship} onChangeText={setRelationship} placeholder="Parent, sibling, friend..." placeholderTextColor={colors.textSecondary} autoCapitalize="words" />
            <Text style={s.contactFieldLabel}>PHONE NUMBER</Text>
            <TextInput style={s.contactInput} value={phone} onChangeText={setPhone} placeholder="(512) 555-0123" placeholderTextColor={colors.textSecondary} keyboardType="phone-pad" textContentType="telephoneNumber" />
            <TouchableOpacity style={[s.addContactButton, s.contactModalSubmit]} onPress={() => void saveContact()} disabled={isLoading} accessibilityRole="button">
              {isLoading ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="shield-checkmark-outline" size={20} color={colors.textInverse} />}
              <Text style={s.addContactButtonText}>{isLoading ? 'Adding contact...' : 'Add contact'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAwareModalView>
      </Modal>
    </>
  );
}

function Contact({ contact, onDelete }: { contact: EmergencyContact; onDelete: () => void }) {
  const { colors, s } = useScreenCtx();
  const initials = contact.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={s.contactCard}>
      <View style={s.contactAvatar}><Text style={s.contactAvatarText}>{initials}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.contactName}>{contact.name}</Text>
        <Text style={s.contactRelationship}>{contact.relationship}</Text>
        <Text style={s.contactPhone}>{contact.phone}</Text>
      </View>
      <TouchableOpacity style={s.contactDelete} onPress={onDelete} accessibilityRole="button" accessibilityLabel={`Remove ${contact.name}`}>
        <Ionicons name="trash-outline" size={18} color={colors.red} />
      </TouchableOpacity>
    </View>
  );
}

export function RiderPaymentMethodsReference() {
  return <ColorsProvider><RiderPaymentMethodsReferenceInner /></ColorsProvider>;
}
function RiderPaymentMethodsReferenceInner() {
  const { colors, s } = useScreenCtx();
  const { uid } = useAuthStore();
  const {
    paymentMethods,
    isLoadingMethods,
    methodsError,
    loadPaymentMethods,
    setDefaultMethod,
    removePaymentMethod,
  } = usePaymentStore();
  const [showAddCard, setShowAddCard] = useState(false);

  useEffect(() => {
    if (uid) {
      void loadPaymentMethods(uid);
    }
  }, [loadPaymentMethods, uid]);

  const makeDefault = async (paymentMethodId: string) => {
    if (!uid) return;

    try {
      await setDefaultMethod(uid, paymentMethodId);
    } catch {
      Alert.alert('Unable to update card', 'Please try setting this card as your default again.');
    }
  };

  const confirmRemove = (paymentMethodId: string) => {
    if (!uid) return;

    Alert.alert('Remove payment method?', 'This card will no longer be available for future rides.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removePaymentMethod(uid, paymentMethodId);
          } catch (error: any) {
            Alert.alert('Unable to remove card', error?.message || 'Please try removing this card again.');
          }
        },
      },
    ]);
  };

  return (
    <>
      <Phone title="Payment" back backHref="/(rider)/profile" compactContent>
        <View style={s.paymentSectionHeader}>
          <Label>PAYMENT METHODS</Label>
          <TouchableOpacity
            style={s.addPaymentLink}
            onPress={() => setShowAddCard(true)}
            accessibilityRole="button"
            accessibilityLabel="Add new payment method"
            hitSlop={hitSlop}
          >
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={s.addPaymentLinkText}>Add new</Text>
          </TouchableOpacity>
        </View>

        {isLoadingMethods && paymentMethods.length === 0 ? (
          <View style={s.paymentState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={s.paymentStateText}>Loading your payment methods...</Text>
          </View>
        ) : null}

        {!isLoadingMethods && methodsError ? (
          <View style={s.paymentState}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.primary} />
            <Text style={s.paymentStateTitle}>We could not load your cards</Text>
            <Text style={s.paymentStateText}>Check your connection, then try again.</Text>
            <TouchableOpacity style={s.paymentRetry} onPress={() => uid && void loadPaymentMethods(uid)} accessibilityRole="button">
              <Text style={s.paymentRetryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {!isLoadingMethods && !methodsError && paymentMethods.length === 0 ? (
          <View style={s.paymentEmpty}>
            <View style={s.paymentEmptyIcon}>
              <Ionicons name="card-outline" size={28} color={colors.primary} />
            </View>
            <Text style={s.paymentStateTitle}>No payment methods yet</Text>
            <Text style={s.paymentStateText}>Add a card to request rides and complete payments securely.</Text>
          </View>
        ) : null}

        {paymentMethods.map((method) => (
          <View key={method.id} style={[s.paymentMethodCard, method.isDefault && s.paymentMethodCardDefault]}>
            <View style={[s.paymentBrandIcon, method.isDefault && s.paymentBrandIconDefault]}>
              <Ionicons name="card" size={21} color={method.isDefault ? colors.textInverse : colors.textPrimary} />
            </View>
            <View style={s.paymentMethodDetails}>
              <View style={s.paymentMethodTitleRow}>
                <Text style={s.paymentMethodTitle}>{method.brand || 'Card'} **** {method.last4}</Text>
                {method.isDefault ? <Text style={s.defaultBadge}>DEFAULT</Text> : null}
              </View>
              <Text style={s.mutedSmall}>Expires {String(method.exp_month).padStart(2, '0')}/{String(method.exp_year).slice(-2)}</Text>
              <View style={s.paymentMethodActions}>
                {!method.isDefault ? (
                  <TouchableOpacity onPress={() => void makeDefault(method.id)} disabled={isLoadingMethods} accessibilityRole="button">
                    <Text style={s.paymentActionText}>Make default</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => confirmRemove(method.id)} disabled={isLoadingMethods} accessibilityRole="button">
                  <Text style={s.paymentRemoveText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={s.addPaymentButton}
          onPress={() => setShowAddCard(true)}
          accessibilityRole="button"
          accessibilityLabel="Add new payment method"
        >
          <Ionicons name="add-circle-outline" size={21} color={colors.textInverse} />
          <Text style={s.addPaymentButtonText}>Add new payment method</Text>
        </TouchableOpacity>

        <View style={s.paymentSecurityNote}>
          <Ionicons name="shield-checkmark-outline" size={17} color={colors.textSecondary} />
          <Text style={s.paymentSecurityText}>Card details are encrypted and securely processed by Stripe.</Text>
        </View>
      </Phone>
      <AddCardModal visible={showAddCard} onClose={() => setShowAddCard(false)} />
    </>
  );
}

export function RiderPreferencesReference() {
  return <ColorsProvider><RiderPreferencesReferenceInner /></ColorsProvider>;
}
function RiderPreferencesReferenceInner() {
  const { colors, s } = useScreenCtx();
  const {
    preferences,
    isLoading,
    isDirty,
    loadPreferences,
    savePreferences,
    updatePreference,
  } = usePreferencesStore();
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    loadPreferences()
      .then(() => active && setLoadError(false))
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [loadPreferences]);

  const toggleMusic = (genre: string) => {
    if (!preferences) return;
    const selected = preferences.musicPreference.includes(genre);
    updatePreference(
      'musicPreference',
      selected
        ? preferences.musicPreference.filter((item) => item !== genre)
        : [...preferences.musicPreference, genre],
    );
  };

  const save = async () => {
    if (!preferences || !isDirty) return;
    try {
      await savePreferences(preferences);
      Alert.alert('Preferences saved', 'Drivers will see these preferences when reviewing your ride request.');
    } catch {
      Alert.alert('Could not save preferences', 'Please check your connection and try again.');
    }
  };

  const saveButton = (
    <TouchableOpacity
      style={[s.preferenceSaveButton, (!isDirty || isLoading) && s.preferenceSaveButtonDisabled]}
      onPress={() => void save()}
      disabled={!isDirty || isLoading}
      accessibilityRole="button"
      accessibilityLabel="Save ride preferences"
      accessibilityState={{ disabled: !isDirty || isLoading }}
    >
      {isLoading && preferences ? <ActivityIndicator size="small" color={colors.textInverse} /> : null}
      <Text style={s.preferenceSaveText}>{isLoading && preferences ? 'Saving...' : isDirty ? 'Save preferences' : 'Preferences saved'}</Text>
    </TouchableOpacity>
  );

  return (
    <Phone title="Ride preferences" back backHref="/(rider)/profile" compactContent headerGap={0} bottom={preferences ? saveButton : undefined} bottomOffset={4}>
      <Text style={s.preferenceIntro}>Set your preferred ride environment for drivers to review.</Text>
      <View style={s.riderPreferredRoutes}><DriverPreferredRoutesManager role="rider" /></View>

      {isLoading && !preferences ? (
        <View style={s.preferenceLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={s.paymentStateText}>Loading your preferences...</Text>
        </View>
      ) : null}

      {loadError && !preferences ? (
        <View style={s.preferenceLoading}>
          <Ionicons name="alert-circle-outline" size={26} color={colors.primary} />
          <Text style={s.paymentStateTitle}>We could not load your preferences</Text>
          <TouchableOpacity onPress={() => void loadPreferences().then(() => setLoadError(false)).catch(() => setLoadError(true))} style={s.paymentRetry}>
            <Text style={s.paymentRetryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {preferences ? (
        <>
          <PreferenceSection icon="musical-notes-outline" title="Music taste" description="Choose as many as you like.">
            <View style={s.preferenceChipWrap}>
              {['Pop', 'Hip-Hop', 'R&B', 'Rock', 'Alternative', 'Country', 'Jazz', 'Classical', 'Electronic', 'Reggae', 'Folk', 'Blues'].map((genre) => (
                <PreferenceChip key={genre} label={genre} selected={preferences.musicPreference.includes(genre)} onPress={() => toggleMusic(genre)} />
              ))}
            </View>
          </PreferenceSection>

          <PreferenceSection icon="volume-medium-outline" title="Sound environment">
            <PreferenceOptions
              value={preferences.soundEnvironment}
              options={[['Music', 'Music preferred'], ['Silent', 'Silent / quiet'], ['Conversation', 'Conversation']]}
              onChange={(value) => updatePreference('soundEnvironment', value)}
            />
          </PreferenceSection>

          <PreferenceSection icon="chatbubbles-outline" title="Conversation level">
            <PreferenceOptions
              value={preferences.conversationLevel}
              options={[['Chatty', 'Chatty'], ['Moderate', 'Moderate'], ['Quiet', 'Quiet']]}
              onChange={(value) => updatePreference('conversationLevel', value)}
            />
          </PreferenceSection>

          <PreferenceSection icon="ban-outline" title="Smoking preference">
            <PreferenceOptions
              value={preferences.smokingPreference}
              options={[['No Smoking', 'No smoking'], ['Smoking OK', 'Smoking is okay']]}
              onChange={(value) => updatePreference('smokingPreference', value)}
            />
          </PreferenceSection>

          <PreferenceSection icon="person-outline" title="Driver gender preference" description="Optional. Choose what makes you most comfortable.">
            <PreferenceOptions
              value={preferences.driverGender}
              options={[['Any', 'No preference'], ['Female', 'Female'], ['Male', 'Male']]}
              onChange={(value) => updatePreference('driverGender', value)}
            />
          </PreferenceSection>

          <PreferenceSection icon="people-outline" title="Passenger type">
            <PreferenceOptions
              value={preferences.passengerType}
              options={[['Single', 'Single passenger'], ['Multiple', 'Multiple passengers okay']]}
              onChange={(value) => updatePreference('passengerType', value)}
            />
          </PreferenceSection>
        </>
      ) : null}
    </Phone>
  );
}

function PreferenceSection({ icon, title, description, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; description?: string; children: React.ReactNode }) {
  const { colors, s } = useScreenCtx();
  return (
    <View style={s.preferenceSection}>
      <View style={s.preferenceSectionHeader}>
        <View style={s.preferenceSectionIcon}><Ionicons name={icon} size={19} color={colors.primary} /></View>
        <View style={s.preferenceSectionHeading}>
          <Text style={s.preferenceSectionTitle}>{title}</Text>
          {description ? <Text style={s.preferenceSectionDescription}>{description}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

function PreferenceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors, s } = useScreenCtx();
  return (
    <TouchableOpacity
      style={[s.preferenceChip, selected && s.preferenceChipSelected]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      {selected ? <Ionicons name="checkmark" size={14} color={colors.textInverse} /> : null}
      <Text style={[s.preferenceChipText, selected && s.preferenceChipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PreferenceOptions({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const { s } = useScreenCtx();
  return (
    <View style={s.preferenceOptions}>
      {options.map(([optionValue, label]) => {
        const selected = value === optionValue;
        return (
          <TouchableOpacity
            key={optionValue}
            style={[s.preferenceOption, selected && s.preferenceOptionSelected]}
            onPress={() => onChange(optionValue)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={[s.preferenceRadio, selected && s.preferenceRadioSelected]}>{selected ? <View style={s.preferenceRadioDot} /> : null}</View>
            <Text style={[s.preferenceOptionText, selected && s.preferenceOptionTextSelected]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function RiderTermsReference() {
  return <ColorsProvider><RiderTermsReferenceInner /></ColorsProvider>;
}
function RiderTermsReferenceInner() {
  const { s } = useScreenCtx();
  return (
    <Phone title="Terms of service" back bottom={<View style={s.split}><GhostButton>Decline</GhostButton><PrimaryButton>Accept</PrimaryButton></View>}>
      <Text style={s.label}>V 4.2 · UPDATED OCT 14, 2025</Text>
      <Text style={s.termsTitle}>The short version</Text>
      <Text style={s.bodyText}>RideAlong is a marketplace for verified students to share rides. We do not drive the cars - your fellow students do. We verify everyone with a .edu and a background check, take payments, and split costs.</Text>
      <View style={s.englishBox}><Text style={s.offerText}>The deal in plain English</Text><Text style={s.bodyText}>{"â€¢ You are responsible for your own behavior in someone's car."}{'\n'}{"â€¢ We are not liable for personal stuff your fellow students bring."}{'\n'}{"â€¢ Cancel free up to 24h before. After that, partial refund."}{'\n'}{"â€¢ Violate the community guidelines, you are out."}</Text></View>
      <Text style={s.sectionBig}>1. Eligibility</Text>
      <Text style={s.bodyText}>You must hold a valid .edu email address from an accredited US college or university. Account is non-transferable.</Text>
      <Text style={s.sectionBig}>2. Payments</Text>
    </Phone>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
  text: { fontFamily: FONT_SANS, color: colors.textPrimary },
  root: { flex: 1, alignItems: 'center', backgroundColor: colors.bg },
  safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: colors.bg },
  safeCream: { backgroundColor: colors.primaryDim },
  status: { height: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24 },
  statusTime: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  notch: { position: 'absolute', top: 9, left: '36%', right: '36%', height: 30, borderRadius: 16, backgroundColor: '#000' },
  statusIcons: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { ...appHeader.row, height: 64, paddingHorizontal: 20 },
  scrollableHeader: { marginHorizontal: -layout.screenPadding },
  headerNoDivider: { borderBottomWidth: 0 },
  headerTitle: { ...appHeader.title, fontFamily: FONT_SANS, color: colors.textPrimary },
  headerTitleAfterBack: { flexShrink: 1, marginLeft: 12 },
  headerTitleLarge: { ...appHeader.title },
  circle: { ...appHeader.iconButton, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard},
  body: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingTop: 24, flexGrow: 1 },
  bodyCompact: { paddingTop: 8 },
  bodyWithScrollableHeader: { paddingTop: 0 },
  scrollHeaderGap: { height: 24 },
  scrollHeaderGapCompact: { height: 8 },
  mainPageHeader: { marginBottom: 12 },
  messagesPageHeader: { marginBottom: 4 },
  mainPageTitle: { fontFamily: FONT_SANS, color: colors.textPrimary, fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.25 },
  brand: { flexDirection: 'row', alignItems: 'center', marginBottom: 54, gap: 8 },
  brandText: { fontSize: 19, fontWeight: '700' },
  hero: { marginBottom: 36 },
  heroText: { fontSize: 36, lineHeight: 42, fontWeight: '400', letterSpacing: -0.3 },
  heroAccent: { color: colors.primary, fontStyle: 'italic', fontWeight: '500' },
  sub: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: 16 },
  label: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 11, letterSpacing: 2, fontWeight: '500' },
  field: { flex: 1, marginBottom: 20 },
  input: { fontFamily: FONT_SANS, height: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, paddingHorizontal: 16, color: colors.textPrimary, fontSize: 16, marginTop: 8 },
  split: { flexDirection: 'row', gap: 12 },
  formRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  remember: { flex: 1, color: colors.textSecondary, fontSize: 14 },
  orangeLink: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  primary: { height: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 14 },
  primaryText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
  ghost: { height: 52, borderRadius: 26, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  ghostText: { fontSize: 15, fontWeight: '500' },
  authFooter: { marginTop: 'auto', minHeight: 34, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap' },
  footerText: { color: colors.textSecondary, fontSize: 11 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 22 },
  stepText: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 11, letterSpacing: 1.5 },
  stepTrack: { flex: 1, height: 3, backgroundColor: colors.border },
  stepFill: { height: 3, backgroundColor: colors.primary },
  codeRow: { flexDirection: 'row', gap: 8, marginBottom: 28 },
  codeBox: { width: 40, height: 50, borderRadius: 12, borderWidth: 1.5, borderColor: colors.primary, textAlign: 'center', lineHeight: 48, fontSize: 28, fontWeight: '400' },
  codeMuted: { color: colors.textSecondary, borderColor: colors.border },
  modeCard: { minHeight: 96, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', padding: 18, gap: 16, marginBottom: 16 },
  modeSelected: { borderColor: colors.primary },
  modeDashed: { borderStyle: 'dashed' },
  modeIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  modeTitle: { fontSize: 18, fontWeight: '700' },
  modeSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
  recommended: { position: 'absolute', right: 12, top: -10, backgroundColor: colors.primary, color: colors.textInverse, fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  notice: { marginTop: 'auto', minHeight: 48, borderRadius: 12, backgroundColor: colors.primaryDim, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  noticeText: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  upload: { height: 180, borderRadius: 18, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  uploadIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  uploadTitle: { fontWeight: '700', fontSize: 13 },
  uploadSub: { color: colors.textSecondary, fontSize: 13, marginTop: 5 },
  infoBox: { borderRadius: 10, backgroundColor: colors.bgSecondary, padding: 14 },
  infoText: { fontSize: 14, lineHeight: 21 },
  infoBold: { fontWeight: '700' },
  tabs: { position: 'absolute', left: 24, right: 24, bottom: 14, height: 58, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: 29, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 5, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 10 },
  tab: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, gap: 1 },
  tabActive: { backgroundColor: colors.bgSecondary },
  tabText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  tabIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', top: -7, right: -11, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  iconBadgeText: { color: colors.textInverse, fontSize: 9, lineHeight: 11, fontWeight: '800' },
  bottomAction: { position: 'absolute', left: 18, right: 18, bottom: 20 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },
  pill: { fontFamily: FONT_MONO, borderRadius: 18, borderWidth: 1, borderColor: colors.border, color: colors.textSecondary, fontSize: 12, paddingHorizontal: 14, paddingVertical: 9, overflow: 'hidden' },
  pillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary, color: colors.textInverse },
  requestCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, marginBottom: 14, minHeight: 0, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 },
  requestCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15 },
  requestStatusBadge: { borderRadius: 10, backgroundColor: colors.primaryDim, paddingHorizontal: 9, paddingVertical: 4 },
  requestStatusText: { color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '800', textTransform: 'capitalize' },
  requestPrice: { marginLeft: 'auto', color: colors.primary, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  requestRouteBlock: { minHeight: 82, flexDirection: 'row', paddingHorizontal: 2 },
  requestRouteRail: { width: 18, alignItems: 'center', paddingVertical: 5 },
  requestPickupDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary, flexShrink: 0 },
  requestRouteLine: { flex: 1, width: 1, marginVertical: 4, backgroundColor: colors.border },
  requestDropoffDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0 },
  requestRouteCopy: { flex: 1, justifyContent: 'space-between', paddingLeft: 8, minWidth: 0 },
  requestRouteLabel: { color: colors.textSecondary, fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 1 },
  requestRouteText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '600', marginTop: 1 },
  requestMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  requestMetaPill: { minHeight: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11 },
  requestMetaText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.textPrimary },
  routeTitle: { flex: 1, fontSize: 17, fontWeight: '600', lineHeight: 24 },
  mono: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 11 },
  mutedLine: { color: colors.textSecondary, fontSize: 14, marginTop: 20 },
  bold: { fontWeight: '700', color: colors.textPrimary },
  dash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.border, marginVertical: 16 },
  offerText: { flex: 1, color: colors.primary, fontFamily: FONT_MONO, fontSize: 12, fontWeight: '700' },
  navyBtn: { backgroundColor: colors.textPrimary, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 11 },
  navyBtnText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
  pastRow: { borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, fontSize: 13, marginTop: 12, color: colors.textPrimary },
  historyCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 18, marginBottom: 16 },
  riderHistoryStatsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, paddingVertical: 15 },
  riderHistoryStatCard: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  riderHistoryStatDivider: { width: 1, height: 36, backgroundColor: colors.border },
  riderHistoryStatValue: { color: colors.textPrimary, fontSize: 21, fontWeight: '700', marginBottom: 2 },
  riderHistoryStatLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  riderHistoryTabRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  riderHistoryTab: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard },
  riderHistoryTabActive: { borderColor: colors.primaryBorder, backgroundColor: colors.primaryDim },
  riderHistoryTabText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  riderHistoryTabTextActive: { color: colors.primary, fontWeight: '700' },
  riderHistoryLoading: { alignItems: 'center', paddingTop: 60 },
  riderHistoryCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, marginBottom: 14, shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 },
  riderHistoryCardAccent: { width: 0, flexShrink: 0 },
  riderHistoryCardInner: { flex: 1 },
  riderHistoryCardTop: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 16 },
  riderHistoryStatusBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  riderHistoryStatusDot: { display: 'none' },
  riderHistoryStatusText: { fontSize: 10, fontWeight: '700' },
  riderHistoryTripMeta: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  riderHistoryPrice: { color: colors.primary, fontSize: 20, fontWeight: '700' },
  riderHistoryRouteBlock: { minHeight: 82, flexDirection: 'row', paddingHorizontal: 2 },
  riderHistoryRouteRail: { width: 18, alignItems: 'center', paddingVertical: 5 },
  riderHistoryNavyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textPrimary, flexShrink: 0 },
  riderHistoryRouteLine: { flex: 1, width: 1, marginVertical: 4, backgroundColor: colors.border },
  riderHistoryOrangeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, flexShrink: 0 },
  riderHistoryRouteDetails: { flex: 1, justifyContent: 'space-between', paddingLeft: 8 },
  riderHistoryRouteLabel: { color: colors.textSecondary, fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 1 },
  riderHistoryRouteText: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '600', marginTop: 1 },
  riderHistoryFooter: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 13, gap: 10 },
  riderHistoryAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  riderHistoryAvatarImage: { width: 36, height: 36, borderRadius: 18 },
  riderHistoryAvatarText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  riderHistoryDriverInfo: { flex: 1, minWidth: 0 },
  riderHistoryDriverName: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  riderHistoryDriverMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  riderHistoryFlagButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redDim },
  riderHistoryEmpty: { borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.bgCard, padding: 32, alignItems: 'center', marginTop: 4 },
  riderHistoryEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  riderHistoryEmptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  riderHistoryEmptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  riderHistoryBrowseButton: { minHeight: 46, borderRadius: 23, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, marginTop: 18 },
  riderHistoryBrowseText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  driverMeta: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  price: { color: colors.primary, fontSize: 30, fontWeight: '300' },
  profileHero: { alignItems: 'center', paddingVertical: 22 },
  bigAvatar: { width: 82, height: 82, borderRadius: 41, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' },
  bigAvatarImage: { width: '100%', height: '100%', borderRadius: 41 },
  bigAvatarSmall: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  bigAvatarText: { color: colors.primary, fontSize: 26, fontWeight: '600' },
  profileName: { fontSize: 25, fontWeight: '700', marginTop: 3 },
  panel: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 18, marginBottom: 16 },
  bodyText: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: 12 },
  vehicle: { width: 58, height: 50, borderRadius: 10, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  mutedSmall: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  review: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 13, marginBottom: 12 },
  quote: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 10, fontStyle: 'italic' },
  mapArea: { height: 496, marginHorizontal: -20, marginTop: -12, backgroundColor: colors.bg },
  routeCurve: { position: 'absolute', left: 62, right: 78, top: 154, height: 130, borderBottomWidth: 4, borderRightWidth: 4, borderColor: colors.primary, borderBottomRightRadius: 160, transform: [{ rotate: '-22deg' }] },
  mapPin: { position: 'absolute', width: 18, height: 18, borderRadius: 9 },
  carPin: { position: 'absolute', left: 145, top: 204, width: 38, height: 38, borderRadius: 19, backgroundColor: colors.bgCard, borderWidth: 3, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  tripSheet: { marginHorizontal: -20, padding: 18, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  rowIcons: { flexDirection: 'row', gap: 14 },
  etaCard: { marginTop: 16, borderRadius: 14, backgroundColor: colors.bgSecondary, padding: 14 },
  eta: { position: 'absolute', right: 14, top: 12, color: colors.primary, fontSize: 24, fontWeight: '300' },
  etaMiles: { position: 'absolute', right: 14, bottom: 14, color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  rateHero: { alignItems: 'center', paddingTop: 14, paddingBottom: 20 },
  stars: { color: colors.primary, fontSize: 34, letterSpacing: 6, marginTop: 18 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  noteInput: { fontFamily: FONT_SANS, minHeight: 56, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 12, textAlignVertical: 'top' },
  listTopLine: { height: 0, marginBottom: 0 },
  messageLoading: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 14 },
  messageCard: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
  messageAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  messageAvatarText: { color: colors.primary, fontSize: 18, fontWeight: '600' },
  messageContent: { flex: 1, minWidth: 0 },
  messageTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  messageMeta: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  messageTime: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  messageEmptyCard: { marginTop: 40, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.bgCard, padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 180 },
  messageEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  messageEmptyTitle: { color: colors.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  messageEmptyText: { maxWidth: 280, color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  notificationEmptyCard: { flex: 1, minHeight: 420, paddingHorizontal: 24, paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  notificationEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  notificationEmptyTitle: { color: colors.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  notificationEmptyText: { maxWidth: 278, color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, fontWeight: '500' },
  swipeDelete: { width: 80, alignSelf: 'stretch', backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', gap: 5 },
  swipeDeleteText: { color: colors.textInverse, fontSize: 12, fontWeight: '700' },
  bigAvatarTextSmall: { color: colors.primary, fontSize: 18, fontWeight: '600' },
  messageName: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  messagePreview: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2, fontWeight: '600' },
  newBadge: { color: colors.primary, backgroundColor: colors.primaryDim, overflow: 'hidden', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700' },
  closedBadge: { color: colors.textSecondary, backgroundColor: colors.bgSecondary, overflow: 'hidden', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatInput: { fontFamily: FONT_SANS, flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: colors.bgSecondary, paddingHorizontal: 16, color: colors.textPrimary, fontSize: 15 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '82%', alignSelf: 'flex-start', backgroundColor: colors.bgSecondary, borderRadius: 18, padding: 16, marginBottom: 14, color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  bubbleMe: { alignSelf: 'flex-end', backgroundColor: colors.textPrimary, color: colors.textInverse },
  bubblePin: { alignSelf: 'flex-end', backgroundColor: colors.primary, color: colors.textInverse },
  noticeRow: { flexDirection: 'row', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  noticeRowFirst: { paddingTop: 6 },
  noticeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  noticeBody: { flex: 1, fontSize: 14, lineHeight: 21 },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  profileIdentityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  editProfileButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  profileBadgeRow: { marginTop: 6 },
  profileSettingsBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  profileActivity: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingHorizontal: 8 },
  profileActivityItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  profileActivityValue: { color: colors.textPrimary, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  profileActivityCancelled: { color: colors.red },
  profileActivityLabel: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
  profileActivityDivider: { width: 1, height: 32, backgroundColor: colors.border },
  profileAboutCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, marginBottom: 18 },
  profileAboutTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 6 },
  profileAboutText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, fontWeight: '500' },
  driverSwitchBtn: { height: 50, borderRadius: 25, backgroundColor: colors.textPrimary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10, marginBottom: 18 },
  driverSwitchIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  driverSwitchBtnText: { flex: 1, color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  statBox: { flex: 1, minHeight: 88, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 15, justifyContent: 'center' },
  statValue: { fontSize: 30, fontWeight: '300' },
  statLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  menuCard: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, overflow: 'hidden', marginBottom: 18 },
  logoutBtn: { height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  logoutBtnText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  menuRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuRowLast: { borderBottomWidth: 0 },
  menuIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  menuTitle: { fontSize: 15, fontWeight: '600' },
  menuSub: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  settingsSectionLabel: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 10, lineHeight: 15, letterSpacing: 1.5, fontWeight: '600', marginBottom: 8, paddingHorizontal: 2 },
  settingsMenuCard: { marginBottom: 20 },
  settingsMenuCardLast: { marginBottom: 4 },
  settingsSwitchWrap: { width: 46, height: 32, marginRight: 4, alignItems: 'center', justifyContent: 'center' },
  settingsSwitch: { transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] },
  findSearch: { height: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 20 },
  accountAvatar: { alignItems: 'center', marginBottom: 24 },
  warningBox: { borderRadius: 12, backgroundColor: colors.primaryDim, flexDirection: 'row', gap: 10, padding: 14, marginBottom: 14 },
  warningText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  contactCard: { minHeight: 104, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, marginBottom: 12 },
  addContact: { height: 86, borderRadius: 16, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  emergencyIntro: { borderRadius: 18, backgroundColor: colors.primaryDim, flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, marginBottom: 24 },
  emergencyIntroIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  emergencyIntroTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 3 },
  emergencyIntroText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  emergencySectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  emergencySectionTitle: { color: colors.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '700' },
  emergencyCount: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  emergencyHeaderAdd: { minHeight: 42, borderRadius: 21, backgroundColor: colors.primaryDim, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14 },
  emergencyHeaderAddText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  emergencyEmpty: { minHeight: 205, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', padding: 24, marginBottom: 14 },
  emergencyEmptyIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  contactAvatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  contactAvatarText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  contactName: { color: colors.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  contactRelationship: { color: colors.primary, fontSize: 11, lineHeight: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 },
  contactPhone: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  contactDelete: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.redDim, alignItems: 'center', justifyContent: 'center' },
  addContactButton: { minHeight: 52, borderRadius: 26, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  addContactButtonText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  contactModalOverlay: { flex: 1, backgroundColor: 'rgba(21,35,58,0.35)', justifyContent: 'flex-end' },
  contactModalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 },
  contactModalHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 18 },
  contactModalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 },
  contactModalTitle: { color: colors.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  contactModalSubtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  contactModalClose: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  contactFieldLabel: { fontFamily: FONT_MONO, color: colors.textSecondary, fontSize: 10, lineHeight: 15, letterSpacing: 1.4, fontWeight: '600', marginBottom: 7 },
  contactInput: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, color: colors.textPrimary, fontSize: 15, paddingHorizontal: 15, marginBottom: 16 },
  contactModalSubmit: { marginTop: 4 },
  creditCard: { height: 174, borderRadius: 16, backgroundColor: colors.textPrimary, marginVertical: 18, padding: 20 },
  cardLabel: { color: colors.textSecondary, fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 2, fontWeight: '700' },
  visa: { position: 'absolute', right: 16, top: 16, color: colors.textInverse, fontSize: 18, fontWeight: '800' },
  cardNumber: { color: colors.textInverse, fontFamily: FONT_MONO, fontSize: 18, letterSpacing: 3, marginTop: 36 },
  cardName: { position: 'absolute', left: 16, bottom: 14, color: colors.textInverse, fontFamily: FONT_MONO, fontSize: 9 },
  cardDate: { position: 'absolute', right: 16, bottom: 14, color: colors.textInverse, fontFamily: FONT_MONO, fontSize: 10 },
  payRow: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginBottom: 16 },
  payIcon: { width: 38, height: 28, borderRadius: 7, backgroundColor: colors.bgSecondary, textAlign: 'center', lineHeight: 28, fontWeight: '700' },
  paymentSectionHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addPaymentLink: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12 },
  addPaymentLinkText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  paymentState: { minHeight: 190, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, marginBottom: 16 },
  paymentEmpty: { minHeight: 210, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', padding: 24, marginBottom: 16 },
  paymentEmptyIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  paymentStateTitle: { color: colors.textPrimary, fontSize: 17, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  paymentStateText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 280 },
  paymentRetry: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 18, marginTop: 6 },
  paymentRetryText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  paymentMethodCard: { minHeight: 112, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16, marginBottom: 12 },
  paymentMethodCardDefault: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  paymentBrandIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
  paymentBrandIconDefault: { backgroundColor: colors.primary },
  paymentMethodDetails: { flex: 1 },
  paymentMethodTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 3 },
  paymentMethodTitle: { color: colors.textPrimary, fontSize: 16, lineHeight: 22, fontWeight: '700', textTransform: 'capitalize' },
  defaultBadge: { borderRadius: 10, backgroundColor: colors.primaryDim, color: colors.primary, fontFamily: FONT_MONO, fontSize: 9, lineHeight: 18, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 7 },
  paymentMethodActions: { minHeight: 35, flexDirection: 'row', alignItems: 'flex-end', gap: 20, marginTop: 4 },
  paymentActionText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  paymentRemoveText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  addPaymentButton: { minHeight: 52, borderRadius: 26, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 6 },
  addPaymentButtonText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  paymentSecurityNote: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 8, paddingHorizontal: 12, marginTop: 16 },
  paymentSecurityText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  riderPreferredRoutes: { marginBottom: 18 },
  preferenceIntro: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 18 },
  preferenceLoading: { minHeight: 220, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  preferenceSection: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 16, marginBottom: 14 },
  preferenceSectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginBottom: 14 },
  preferenceSectionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  preferenceSectionHeading: { flex: 1, minHeight: 36, justifyContent: 'center' },
  preferenceSectionTitle: { color: colors.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  preferenceSectionDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  preferenceChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preferenceChip: { minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 13 },
  preferenceChipSelected: { borderColor: colors.textPrimary, backgroundColor: colors.textPrimary },
  preferenceChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  preferenceChipTextSelected: { color: colors.textInverse },
  preferenceOptions: { gap: 8 },
  preferenceOption: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14 },
  preferenceOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  preferenceRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  preferenceRadioSelected: { borderColor: colors.primary },
  preferenceRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  preferenceOptionText: { color: colors.textSecondary, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  preferenceOptionTextSelected: { color: colors.textPrimary },
  preferenceSaveButton: { minHeight: 54, borderRadius: 27, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  preferenceSaveButtonDisabled: { backgroundColor: colors.border },
  preferenceSaveText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  toggleRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  toggle: { marginLeft: 'auto', width: 34, height: 22, borderRadius: 11, backgroundColor: colors.border },
  toggleOn: { marginLeft: 'auto', width: 34, height: 22, borderRadius: 11, backgroundColor: colors.primary },
  englishBox: { borderLeftWidth: 2, borderLeftColor: colors.primary, paddingLeft: 12, marginVertical: 24 },
  termsTitle: { fontSize: 24, fontWeight: '700', marginTop: 20, marginBottom: 24 },
  sectionBig: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  });
}
