import React, { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Switch, Text as RNText, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { StatusBar } from 'expo-status-bar';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import DriverPreferredRoutesManager from '@/components/DriverPreferredRoutesManager';

import { useAuthStore } from '@/stores/authStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useEmergencyContactsStore } from '@/stores/emergencyContactsStore';
import { firebaseAuth, firestore } from '@/constants/services';
import { AddCardModal } from '@/components/AddCardModal';
import { deleteMessageThread, getDeleteMessageThreadErrorMessage } from '@/services/messageThreadsService';
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
import { submitRating } from '@/src/services/functions';
import { notificationService } from '@/src/services/notificationService';
import { settingsService } from '@/src/services/settingsService';
import { hasUserRatedRide } from '@/src/services/ratings';
import { FlagRideModal } from '@/components/FlagRideModal';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const BG = '#FBFAF7';
const PAPER = '#F6F3ED';
const BORDER = '#E5E0D8';
const MUTED = '#8B94A6';
const FONT_SANS = Platform.OS === 'web' ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' : undefined;
const FONT_MONO = Platform.OS === 'web' ? '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace' : undefined;

type TextProps = React.ComponentProps<typeof RNText>;
type TabKey = 'home' | 'find' | 'rides' | 'inbox' | 'you';

function Text({ style, ...props }: TextProps) {
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
  const insets = useSafeAreaInsets();
  const bottomNavHeight = 78;
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <SafeAreaView style={[s.safe, cream && s.safeCream]} edges={['top', 'left', 'right']}>
        {Platform.OS === 'web' ? (
          <View style={s.status}>
            <Text style={s.statusTime}>9:41</Text>
            <View style={s.notch} />
            <View style={s.statusIcons}>
              <Ionicons name="cellular" size={15} color="#0F172A" />
              <Ionicons name="wifi" size={13} color="#0F172A" />
              <Ionicons name="battery-full" size={17} color="#0F172A" />
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
                    if (dest) { router.replace(dest as any); return; }
                    if (router.canGoBack()) router.back();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  hitSlop={hitSlop}
                >
                  <Ionicons name="arrow-back" size={18} color={NAVY} />
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
  return (
    <View style={s.brand}>
      <Ionicons name="location-outline" size={28} color={ORANGE} />
      <Text style={s.brandText}>RideAlong</Text>
    </View>
  );
}

function Hero({ first, accent, tail, sub }: { first: string; accent: string; tail?: string; sub?: string }) {
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
  return (
    <View style={s.field}>
      <Label>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8B94A6"
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        style={s.input}
      />
    </View>
  );
}

function PrimaryButton({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  return (
    <TouchableOpacity style={s.primary} onPress={onPress} accessibilityRole="button" hitSlop={hitSlop}>
      <Text style={s.primaryText}>{children}</Text>
    </TouchableOpacity>
  );
}

function GhostButton({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  return (
    <TouchableOpacity style={s.ghost} onPress={onPress} accessibilityRole="button" hitSlop={hitSlop}>
      <Text style={s.ghostText}>{children}</Text>
    </TouchableOpacity>
  );
}

function BottomNav({ active }: { active: TabKey }) {
  const { messageCount } = useRiderUnreadCounts();
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] = [
    { key: 'home', label: 'Home', icon: 'home', href: '/(rider)' },
    { key: 'find', label: 'Request', icon: 'add-circle-outline', href: '/(rider)/book' },
    { key: 'rides', label: 'Rides', icon: 'ticket-outline', href: '/(rider)/available-rides' },
    { key: 'inbox', label: 'Inbox', icon: 'chatbubble', href: '/(rider)/messages' },
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
              <Ionicons name={tab.icon} size={23} color={selected ? ORANGE : '#6B7280'} />
              {tab.key === 'inbox' && messageCount > 0 ? <View style={s.iconBadge}><Text style={s.iconBadgeText}>{badgeLabel(messageCount)}</Text></View> : null}
            </View>
            <Text style={[s.tabText, selected && { color: ORANGE }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function AuthSignInReference() {
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
        <Text style={s.remember}>☑ Remember me</Text>
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
      <View style={s.notice}><Ionicons name="shield-half" size={13} color={ORANGE} /><Text style={s.noticeText}>Both modes require .edu verification. Takes &lt;24 hours.</Text></View>
    </Phone>
  );
}

export function AuthVerifyDocsReference() {
  return (
    <Phone bottom={<><PrimaryButton>{'Submit for review ->'}</PrimaryButton><GhostButton onPress={() => router.replace('/(auth)/select-role')}>{"I'll do this later"}</GhostButton></>}>
      <Brand />
      <Step current={3} />
      <Hero first="Prove you're a " accent="student." sub={'Upload your school ID, class schedule, or enrollment letter. Approved in <24 hours.'} />
      <TouchableOpacity style={s.upload}>
        <View style={s.uploadIcon}><Ionicons name="cloud-upload" size={22} color={ORANGE} /></View>
        <Text style={s.uploadTitle}>Drop your proof here</Text>
        <Text style={s.uploadSub}>PDF, PNG, or JPG · 10MB max</Text>
      </TouchableOpacity>
      <View style={s.infoBox}><Text style={s.infoText}><Text style={s.infoBold}>What counts?</Text> Student ID with current term · class schedule (this semester) · official enrollment letter · acceptance + tuition receipt</Text></View>
    </Phone>
  );
}

export function AuthForgotReference() {
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
      <View style={s.notice}><Ionicons name="mail-unread" size={13} color={ORANGE} /><Text style={s.noticeText}>{"Check spam if it doesn't arrive in 60 seconds."}</Text></View>
    </Phone>
  );
}

function Step({ current }: { current: number }) {
  return (
    <View style={s.stepRow}>
      <Text style={s.stepText}>STEP {current} OF 3</Text>
      <View style={s.stepTrack}><View style={[s.stepFill, { width: `${current * 33.3}%` }]} /></View>
    </View>
  );
}

function ModeCard({ icon, title, sub, selected, dashed, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; selected?: boolean; dashed?: boolean; onPress?: () => void }) {
  return (
    <TouchableOpacity style={[s.modeCard, selected && s.modeSelected, dashed && s.modeDashed]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      <View style={[s.modeIcon, selected && { backgroundColor: '#F9E8DB' }]}><Ionicons name={icon} size={24} color={selected ? ORANGE : '#6B7280'} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.modeTitle}>{title}</Text>
        <Text style={s.modeSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={selected ? ORANGE : MUTED} />
      {selected ? <Text style={s.recommended}>RECOMMENDED</Text> : null}
    </TouchableOpacity>
  );
}

function Pill({ label, active }: { label: string; active?: boolean }) {
  return <Text style={[s.pill, active && s.pillActive]} accessibilityRole="text">{label}</Text>;
}

function RideDot() {
  return <View style={s.dot} />;
}

function RequestCard({ route, sub, price, live, offers }: { route: string; sub: string; price: string; live?: boolean; offers?: string }) {
  return (
    <View style={s.requestCard}>
      <View style={s.row}><RideDot /><Text style={s.routeTitle}>{route}</Text><Text style={s.mono}>{live ? '• LIVE' : 'WAITING'}</Text></View>
      <Text style={s.mutedLine}>{sub} · up to <Text style={s.bold}>{price}</Text></Text>
      <View style={s.dash} />
      <View style={s.row}><Text style={s.offerText}>{offers || 'NO OFFERS YET'}</Text><TouchableOpacity style={s.navyBtn}><Text style={s.navyBtnText}>View offers</Text></TouchableOpacity></View>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderRequestsReferencePlaceholder() {
  return (
    <Phone title="My requests" back activeTab="rides">
      <View style={s.pillRow}><Pill label="Open · 2" active /><Pill label="Matched" /><Pill label="Past" /></View>
      <RequestCard route="Austin -> Houston" sub="Fri Nov 20 · 3:00 PM · 1 seat" price="$32" live offers="3 OFFERS" />
      <RequestCard route="Houston -> Austin" sub="Sun Nov 22 · 6:00 PM · 1 seat" price="$28" />
      <Label>PAST</Label>
      {['Austin -> DFW · Oct 28                         matched · $26', 'San Marcos -> Austin · Oct 19              matched · $14'].map((item) => <Text key={item} style={s.pastRow}>{item}</Text>)}
    </Phone>
  );
}

export function RiderRequestsReference() {
  const uid = firebaseAuth.currentUser?.uid;
  const [requests, setRequests] = useState<MobileRideRequest[]>([]);
  const [postingRequests, setPostingRequests] = useState<MobileRideRequest[]>([]);
  const [filter, setFilter] = useState<'open' | 'matched' | 'past'>('open');

  useEffect(() => uid ? subscribeRiderRequests(uid, setRequests) : undefined, [uid]);

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
      setPostingRequests(items);
    });
  }, [uid]);

  const allRequests = [...requests, ...postingRequests];

  const OPEN = new Set(['pending', 'open', 'posted', 'offer', 'offer_received']);
  const MATCHED = new Set(['accepted', 'confirmed', 'matched', 'in_progress', 'in-progress', 'driver_completed', 'rider_completed']);
  const PAST = new Set(['completed', 'cancelled', 'canceled', 'rejected', 'expired']);

  const isDateExpired = (request: MobileRideRequest): boolean => {
    // Prefer request.date; fall back to parsing dateLabel
    let rideDate = request.date;
    if (!rideDate && request.dateLabel && request.dateLabel !== 'Date pending') {
      const iso = request.dateLabel.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) {
        rideDate = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      } else {
        const d = new Date(request.dateLabel);
        if (!isNaN(d.getTime())) rideDate = d;
      }
    }
    if (!rideDate) return false;
    const endOfDay = new Date(rideDate);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay < new Date();
  };

  const filtered = allRequests.filter((request) => {
    const status = request.status;
    const expired = isDateExpired(request);
    if (filter === 'open') return OPEN.has(status) && !expired;
    if (filter === 'matched') return MATCHED.has(status) && !expired;
    return PAST.has(status) || expired;
  });

  return (
    <Phone title="My requests" back activeTab="rides">
      <View style={s.pillRow}>
        <TouchableOpacity onPress={() => setFilter('open')}><Pill label={`Open · ${allRequests.filter((r) => OPEN.has(r.status) && !isDateExpired(r)).length}`} active={filter === 'open'} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('matched')}><Pill label={`Matched · ${allRequests.filter((r) => MATCHED.has(r.status) && !isDateExpired(r)).length}`} active={filter === 'matched'} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setFilter('past')}><Pill label={`Past · ${allRequests.filter((r) => PAST.has(r.status) || isDateExpired(r)).length}`} active={filter === 'past'} /></TouchableOpacity>
      </View>
      {filtered.map((request) => (
        <TouchableOpacity key={request.id} style={s.requestCard} onPress={() => router.push(`/(rider)/ride/${request.id}` as any)}>
          <View style={s.row}><RideDot /><Text style={s.routeTitle}>{request.from} -&gt; {request.to}</Text><Text style={s.mono}>{request.status.toUpperCase()}</Text></View>
          <Text style={s.mutedLine}>{request.dateLabel} · {request.seats} {request.seats === 1 ? 'seat' : 'seats'} · up to <Text style={s.bold}>${request.price}</Text></Text>
          <View style={s.dash} />
          <View style={s.row}><Text style={s.offerText}>{request.status.includes('offer') ? 'OFFER RECEIVED' : request.status.toUpperCase()}</Text><View style={s.navyBtn}><Text style={s.navyBtnText}>View details</Text></View></View>
        </TouchableOpacity>
      ))}
      {!filtered.length ? <View style={s.panel}><Text style={s.routeTitle}>Nothing here yet</Text><Text style={s.messagePreview}>Post a request or choose another status tab.</Text></View> : null}
    </Phone>
  );
}

export function RiderHistoryReference() {
  type HistoryTab = 'upcoming' | 'past' | 'cancelled';
  type HistoryRide = {
    id: string; confirmedRideId?: string; rideRequestId?: string; ridePostingId?: string; driverId?: string;
    driverName: string; driverAvatarUrl?: string; from: string; to: string;
    date: Date | null; price: number; status: string; statusAtFlag?: string; seats: number;
  };
  const uid = useAuthStore((state) => state.uid);
  const [rides, setRides] = useState<HistoryRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [flagRideId, setFlagRideId] = useState<string | null>(null);

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
        let driverName = textValue(ride.driverName, ride.driver?.name, ride.driver?.displayName) || (driverId ? 'Driver' : 'No driver assigned');
        let driverAvatarUrl = textValue(ride.driverAvatarUrl, ride.driver?.avatarUrl, ride.driver?.photoURL) || undefined;
        if (driverId) {
          try {
            const driverSnap = await getDoc(doc(firestore, 'drivers', driverId));
            if (driverSnap.exists()) {
              const driver = driverSnap.data() as any;
              driverName = textValue(driver.fullName, driver.name, driver.displayName,
                [driver.firstName, driver.lastName].filter(Boolean).join(' ')) || driverName;
              driverAvatarUrl = textValue(driver.avatarUrl1, driver.avatarUrl, driver.photoURL, driver.profilePicture) || driverAvatarUrl;
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
            <Text style={s.riderHistoryStatLabel}>Completed</Text>
          </View>
          <View style={s.riderHistoryStatDivider} />
          <View style={s.riderHistoryStatCard}>
            <Text style={[s.riderHistoryStatValue, { color: ORANGE }]}>${totalSpent.toFixed(0)}</Text>
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
                {t === 'all' ? `All (${allHistoryRides.length})` : t === 'past' ? `Done (${completedCount})` : `Cancelled (${cancelledCount})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? <View style={s.riderHistoryLoading}><ActivityIndicator color={ORANGE} size="large" /></View> : null}

        {!loading && historyRides.map((ride) => {
          const category = categoryFor(ride);
          const isFlagged = ride.status === 'FLAGGED';
          const isCancelled = category === 'cancelled';
          const statusLabel = isFlagged ? 'Flagged' : isCancelled ? 'Cancelled' : 'Completed';
          const statusColor = isFlagged ? '#B91C1C' : isCancelled ? MUTED : '#16A34A';
          const statusBg = isFlagged ? '#FEF2F2' : isCancelled ? '#F1F3F6' : '#EDFAF3';
          const initials = ride.driverName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
          const shortFrom = ride.from.split(',')[0]?.trim() || ride.from;
          const shortTo = ride.to.split(',')[0]?.trim() || ride.to;
          return (
            <View key={`${ride.confirmedRideId || ride.id}-${ride.status}`} style={s.riderHistoryCard}>
              <View style={[s.riderHistoryCardAccent, { backgroundColor: statusColor }]} />
              <View style={s.riderHistoryCardInner}>
                {/* Top row */}
                <View style={s.riderHistoryCardTop}>
                  <View style={[s.riderHistoryStatusBadge, { backgroundColor: statusBg }]}>
                    <View style={[s.riderHistoryStatusDot, { backgroundColor: statusColor }]} />
                    <Text style={[s.riderHistoryStatusText, { color: statusColor }]}>{statusLabel.toUpperCase()}</Text>
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
                      <Text style={s.riderHistoryRouteLabel}>FROM</Text>
                      <Text style={s.riderHistoryRouteText} numberOfLines={1}>{shortFrom}</Text>
                    </View>
                    <View>
                      <Text style={s.riderHistoryRouteLabel}>TO</Text>
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
                      <Ionicons name="person-outline" size={18} color={MUTED} />
                    )}
                  </TouchableOpacity>
                  <View style={s.riderHistoryDriverInfo}>
                    <Text style={s.riderHistoryDriverName} numberOfLines={1}>{ride.driverName}</Text>
                    <Text style={s.riderHistoryDriverMeta}>{ride.seats} {ride.seats === 1 ? 'seat' : 'seats'}</Text>
                  </View>
                  {ride.confirmedRideId && !isFlagged ? (
                    <TouchableOpacity
                      style={s.riderHistoryFlagButton}
                      onPress={() => setFlagRideId(ride.confirmedRideId || null)}
                      accessibilityRole="button"
                      accessibilityLabel="Report ride"
                    >
                      <Ionicons name="flag-outline" size={16} color="#B54A4A" />
                    </TouchableOpacity>
                  ) : isFlagged ? (
                    <View style={[s.riderHistoryFlagButton, { backgroundColor: '#FDECEC' }]}>
                      <Ionicons name="flag" size={16} color="#B54A4A" />
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}

        {!loading && !historyRides.length ? (
          <View style={s.riderHistoryEmpty}>
            <View style={s.riderHistoryEmptyIcon}><Ionicons name="car-outline" size={26} color={ORANGE} /></View>
            <Text style={s.riderHistoryEmptyTitle}>{historyTab === 'all' ? 'No ride history yet' : historyTab === 'past' ? 'No completed rides' : 'No cancelled rides'}</Text>
            <Text style={s.riderHistoryEmptyText}>{historyTab === 'all' ? 'Completed and cancelled rides will appear here.' : 'Switch to another tab to see your rides.'}</Text>
            {historyTab === 'all' && (
              <TouchableOpacity style={s.riderHistoryBrowseButton} onPress={() => router.push('/(rider)/available-rides' as any)}>
                <Ionicons name="search-outline" size={17} color="#FFFFFF" />
                <Text style={s.riderHistoryBrowseText}>Browse available rides</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
      </Phone>

      <FlagRideModal
        visible={!!flagRideId}
        rideId={flagRideId}
        role="rider"
        onClose={() => setFlagRideId(null)}
        onFlagged={() => setFlagRideId(null)}
      />
    </>
  );
}
export function DriverPublicProfileReference() {
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
        const snap = await getDoc(doc(firestore, 'drivers', id));
        const data = snap.exists() ? snap.data() as any : null;
        setDriver(data);

        const [ratingsSnap, ridesSnap] = await Promise.all([
          getDocs(query(collection(firestore, 'rideRatings'), where('rateeId', '==', id))),
          getDocs(query(collection(firestore, 'confirmedRides'), where('driverId', '==', id), where('status', '==', 'COMPLETED'))),
        ]);
        setTotalRides(ridesSnap.size);
        const ratingDocs = ratingsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        setAllRatings(ratingDocs);
        const rideRiderIds = new Map<string, string>();
        ridesSnap.docs.forEach((rideDoc) => {
          const rideData = rideDoc.data() as any;
          const riderId = rideData.riderId || rideData.userId || rideData.requesterId;
          if (!riderId) return;
          [rideDoc.id, rideData.rideRequestId, rideData.ridePostingId]
            .filter(Boolean)
            .forEach((rideKey) => rideRiderIds.set(String(rideKey), String(riderId)));
        });
        const commentedRatings = ratingDocs
          .filter(r => r.comment && String(r.comment).trim())
          .slice(0, 5);
        const enrichedReviews = await Promise.all(commentedRatings.map(async (rating) => {
          const reviewerId = rating.raterId || rating.rater || rating.reviewerId || rating.reviewer ||
            rating.riderId || rating.userId || rating.authorId || rating.uid ||
            rideRiderIds.get(String(rating.rideId || ''));
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
      finally { setLoading(false); }
    })();
  }, [id]);

  const DNVY = '#15233A', ORG = '#DE5D20', BG2 = '#FBFAF7', BDR = '#E5E0D8', MUT = '#8B94A6';

  const name = driver?.fullName || driver?.name || driver?.displayName || 'Driver';
  const initials = name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const avatarUrl = driver?.avatarUrl1 || driver?.avatarUrl || driver?.photoURL || null;
  const avgRating = allRatings.length
    ? allRatings.reduce((s, r) => s + (typeof r.stars === 'number' ? r.stars : r.rating || 0), 0) / allRatings.length
    : (driver?.rating ?? 0);
  const ratingCounts = [5, 4, 3, 2, 1].map(n => ({
    n,
    count: allRatings.filter(r => Math.round(typeof r.stars === 'number' ? r.stars : r.rating || 0) === n).length,
  }));
  const vehicle = [driver?.vehicleYear, driver?.vehicleMake, driver?.vehicleModel].filter(Boolean).join(' ') ||
    driver?.vehicle || driver?.car || '';
  const vehicleColor = driver?.vehicleColor || driver?.color || '';
  const seats = driver?.seats || driver?.vehicleSeats || driver?.numSeats || '';
  const bio = driver?.bio || driver?.about || driver?.description || '';
  const university = driver?.university || driver?.school || '';

  const prefRows: { icon: string; label: string; value: string }[] = [
    driver?.talkativeness && { icon: 'chatbubble-outline', label: 'Conversation', value: driver.talkativeness },
    driver?.personality && { icon: 'musical-notes-outline', label: 'Vibe', value: driver.personality },
    driver?.smokingPreference && { icon: 'ban-outline', label: 'Smoking', value: driver.smokingPreference },
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
          <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, marginBottom: 6 }}>
            <TouchableOpacity
              onPress={goBack}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BDR, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}
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
                <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#EEE8DF', borderWidth: 3, borderColor: BDR, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: DNVY, fontSize: 32, fontWeight: '700' }}>{initials || '?'}</Text>
                </View>
              )}
              {avgRating > 0 && (
                <View style={{ position: 'absolute', bottom: -4, right: -4, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: DNVY, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 2, borderColor: BG2 }}>
                  <Ionicons name="star" size={11} color="#F59E0B" />
                  <Text style={{ color: '#FFF', fontSize: 11, fontWeight: '700' }}>{avgRating.toFixed(1)}</Text>
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
                <Text style={{ color: DNVY, fontSize: 20, fontWeight: '800', lineHeight: 24 }}>{reviews.length}</Text>
                <Text style={{ color: MUT, fontSize: 11, fontWeight: '600', marginTop: 2 }}>reviews</Text>
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
          {(vehicle || seats) ? (
            <>
              <Text style={{ color: MUT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }}>VEHICLE</Text>
              <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#FEF0E8', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="car-sport-outline" size={22} color={ORG} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: DNVY, fontSize: 15, fontWeight: '700' }}>{vehicle || 'Vehicle info unavailable'}</Text>
                    <Text style={{ color: MUT, fontSize: 13, marginTop: 2 }}>
                      {[vehicleColor, seats ? `${seats} seats` : ''].filter(Boolean).join(' · ')}
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
              <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                <Text style={{ color: DNVY, fontSize: 14, lineHeight: 21 }}>{bio}</Text>
              </View>
            </>
          ) : null}

          {/* Reviews */}
          {/* Ratings histogram */}
          {allRatings.length > 0 && (
            <>
              <Text style={{ color: MUT, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 }}>RATINGS</Text>
              <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
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
                          <View style={{ flex: 1, height: 6, backgroundColor: '#F1EDE7', borderRadius: 3, overflow: 'hidden' }}>
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
              <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                {prefRows.map((row, idx) => (
                  <View key={idx} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BDR }]}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#FEF0E8', alignItems: 'center', justifyContent: 'center' }}>
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
              <View style={{ backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: BDR, padding: 16, marginBottom: 20 }}>
                {reviews.map((r, idx) => {
                  const stars = typeof r.stars === 'number' ? r.stars : (r.rating || 5);
                  const reviewerName = r.reviewerName || r.raterName || r.userName || 'Rider';
                  const reviewerAvatarUrl = r.reviewerAvatarUrl || r.raterAvatarUrl || r.riderAvatarUrl || null;
                  const reviewerInitials = reviewerName.split(/\s+/).map((part: string) => part[0]).join('').slice(0, 2).toUpperCase();
                  const comment = String(r.comment || '').trim();
                  return (
                    <View key={idx} style={[{ paddingVertical: 12 }, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BDR }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#EEE8DF', alignItems: 'center', justifyContent: 'center' }}>
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
  return (
    <Phone cream bottom={<GhostButton>Share trip with a friend</GhostButton>}>
      <View style={s.mapArea}>
        <View style={s.routeCurve} />
        <View style={[s.mapPin, { left: 44, top: 236, backgroundColor: NAVY }]} />
        <View style={[s.mapPin, { right: 52, top: 80, backgroundColor: ORANGE }]} />
        <View style={s.carPin}><Ionicons name="car-sport" size={20} color={ORANGE} /></View>
      </View>
      <View style={s.tripSheet}>
        <View style={s.row}><View style={s.bigAvatarSmall}><Text style={s.bigAvatarText}>JT</Text></View><Text style={s.routeTitle}>Jordan T.{'\n'}<Text style={s.mutedSmall}>{"'21 Civic · TX 8RZP-129"}</Text></Text><View style={s.rowIcons}><Ionicons name="chatbubble" size={17} color={NAVY} /><Ionicons name="call" size={17} color={NAVY} /></View></View>
        <View style={s.etaCard}><Text style={s.label}>ETA</Text><Text style={s.eta}>2h14m</Text><Text style={s.label}>MILES TO GO</Text><Text style={s.etaMiles}>84.2 mi</Text></View>
      </View>
    </Phone>
  );
}

const RATE_FONT = Platform.OS === 'web'
  ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
  : undefined;

export function RateTripReference() {
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
          const name = [od.firstName, od.lastName].filter(Boolean).join(' ').trim() || od.displayName || od.name || (isRider ? 'Driver' : 'Rider');
          setOtherName(name);
          setOtherPhoto(od.photoURL || od.avatarUrl || null);
          setOtherInitials(name.split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase());
        }
      }
      setLoadingData(false);
    }).catch(() => setLoadingData(false));
  }, [confirmedRideId, uid]);

  const handleSubmit = async () => {
    if (submitting || stars === 0) {
      if (stars === 0) Alert.alert('Select a rating', 'Please tap a star before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      if (confirmedRideId) {
        await submitRating({ rideId: confirmedRideId, stars, comment: note.trim() || undefined });
        const ratedField = role === 'rider' ? 'riderRated' : 'driverRated';
        await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), { [ratedField]: true }).catch(() => undefined);
      }
      router.replace(role === 'driver' ? '/(driver)/' as any : '/(rider)/' as any);
    } catch (error: any) {
      const code = String(error?.code || error?.message || '');
      if (code.includes('already-exists')) {
        if (confirmedRideId) {
          const ratedField = role === 'rider' ? 'riderRated' : 'driverRated';
          await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), { [ratedField]: true }).catch(() => undefined);
        }
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
      <LinearGradient colors={['#F2D9C5', '#FAF4EE', '#FBFAF7']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#DE5D20" size="large" />
      </LinearGradient>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <LinearGradient
        colors={['#F2D9C5', '#FAF4EE', '#FBFAF7']}
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
            <RNText style={{ fontFamily: RATE_FONT, fontSize: 32, fontWeight: '600', color: '#15233A', fontStyle: 'normal' }}>
              {"You've "}<RNText style={{ fontFamily: RATE_FONT, color: '#DE5D20', fontStyle: 'italic' }}>arrived.</RNText>
            </RNText>
            <RNText style={{ fontSize: 15, color: '#8B94A6', fontWeight: '500', marginTop: 6 }}>
              Rate {firstName} to wrap up.
            </RNText>

            {/* Avatar */}
            <View style={{
              marginTop: 28, width: 80, height: 80, borderRadius: 40,
              backgroundColor: '#E8D5C4', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              {otherPhoto
                ? <Image source={{ uri: otherPhoto }} style={{ width: 80, height: 80, borderRadius: 40 }} />
                : <RNText style={{ fontSize: 28, fontWeight: '800', color: '#15233A' }}>{otherInitials || '?'}</RNText>}
            </View>
            <RNText style={{ fontSize: 17, fontWeight: '800', color: '#15233A', marginTop: 10 }}>{otherName || firstName}</RNText>
            {routeLabel ? <RNText style={{ fontSize: 13, color: '#8B94A6', marginTop: 3 }}>{routeLabel}</RNText> : null}

            {/* Stars */}
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 22 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setStars(n)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}>
                  <RNText style={{ fontSize: 44, color: n <= stars ? '#DE5D20' : '#D9CCBf' }}>★</RNText>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Note */}
          <TextInput
            style={{
              marginHorizontal: 16, backgroundColor: '#FFFFFFCC', borderRadius: 18,
              padding: 16, minHeight: 110, borderWidth: 1, borderColor: '#E5E0D8',
              fontSize: 14, color: '#15233A', textAlignVertical: 'top',
            }}
            placeholder="Leave a note (optional)..."
            placeholderTextColor="#8B94A6"
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
            style={{ backgroundColor: '#DE5D20', borderRadius: 28, paddingVertical: 16, alignItems: 'center', opacity: submitting ? 0.7 : 1 }}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color="#FFF" />
              : <RNText style={{ color: '#FFF', fontSize: 16, fontWeight: '800' }}>Submit</RNText>}
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderMessagesReferencePlaceholder() {
  const chats = [
    ['JT', 'Jordan T.', 'Cool - see you at Jester at 2:50', '2:14 PM', true],
    ['SA', 'Sara A.', 'Yes still have a seat for Sunday!', 'Yest.', false],
    ['DK', 'Devin K.', 'Ride was great, thanks for the convo', 'Mon', false],
    ['RD', 'Riya D.', '3 seats open if your friends want in', 'Oct 28', false],
  ] as const;
  return (
    <Phone activeTab="inbox">
      <View style={[s.mainPageHeader, s.messagesPageHeader]}><Text style={s.mainPageTitle}>Messages</Text></View>
      {chats.map(([initials, name, preview, time, unread]) => (
        <TouchableOpacity key={name} style={s.messageRow}>
          <View style={s.bigAvatarSmall}><Text style={s.bigAvatarTextSmall}>{initials}</Text></View>
          <View style={{ flex: 1 }}>
            <View style={s.row}>
              <Text style={s.messageName}>{name}</Text>
              {unread ? <Text style={s.newBadge}>NEW</Text> : null}
            </View>
            <Text style={s.messagePreview}>{preview}</Text>
          </View>
          <Text style={s.mono}>{time}</Text>
        </TouchableOpacity>
      ))}
    </Phone>
  );
}

export function RiderMessagesReference() {
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
          {deletingChatId === chat.id ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="trash-outline" size={20} color="#FFFFFF" />}
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
          {chat.unread > 0 ? <Text style={s.newBadge}>{chat.unread} NEW</Text> : null}
        </View>
      </TouchableOpacity>
    </Swipeable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#FBFAF7' }}>
      <StatusBar style="dark" />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <FlatList
          data={chats}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 102, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={{ marginBottom: 4 }}>
              <Text style={{ color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25 }}>Messages</Text>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
                <View style={s.messageEmptyIcon}><Ionicons name="chatbubbles-outline" size={25} color={ORANGE} /></View>
                <Text style={s.messageEmptyTitle}>No conversations yet</Text>
                <Text style={s.messageEmptyText}>Messages with drivers will appear after you request or book a ride.</Text>
              </View>
            ) : loading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
                <ActivityIndicator size="large" color={ORANGE} />
              </View>
            ) : null
          }
        />
      </SafeAreaView>
      <BottomNav active="inbox" />
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderChatReferencePlaceholder() {
  return (
    <Phone
      back
      title="Jordan T."
      bottom={
        <View style={s.chatInputRow}>
          <TextInput placeholder="Message Jordan..." placeholderTextColor="#6B7280" style={s.chatInput} />
          <TouchableOpacity style={s.sendBtn}><Ionicons name="send" size={18} color="#FFFFFF" /></TouchableOpacity>
        </View>
      }
    >
      <Text style={[s.label, { textAlign: 'center', marginBottom: 18 }]}>TODAY · 2:08 PM</Text>
      <Bubble side="them" text="Hey! Just confirming pickup at Jester West around 2:50. Lmk if you need a different spot." />
      <Bubble side="me" text="Jester works great - I'll be at the south entrance ✌" />
      <Bubble side="me" text="One small backpack & a duffel ok?" />
      <Bubble side="them" text="Totally fine, plenty of room." />
      <Bubble side="pin" text="📍 Shared pickup pin: Jester West, Austin" />
      <Bubble side="them" text="Cool - see you at Jester at 2:50 ✌" />
    </Phone>
  );
}


export function RiderChatReference() {
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
            setRideInfo(`${from} → ${to}${rd.date ? ` · ${rd.date}` : ''}`);
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

  const send = async () => {
    if (!id || !uid || !draft.trim() || sending) return;
    setSending(true);
    try {
      await sendChatMessage(id, uid, draft, 'rider');
      setDraft('');
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

  const NAVY = '#15233A', ORANGE = '#DE5D20', BG2 = '#FBFAF7', BDR = '#E5E0D8', MUT = '#8B94A6';

  return (
    <View style={{ flex: 1, backgroundColor: BG2 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BDR, backgroundColor: BG2, gap: 10 }}>
            <TouchableOpacity
              onPress={() => router.replace('/(rider)/messages' as any)}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BDR, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.75}
            >
              <Ionicons name="chevron-back" size={22} color={NAVY} />
            </TouchableOpacity>

            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {recipientPhotoURL
                ? <Image source={{ uri: recipientPhotoURL }} style={{ width: 38, height: 38, borderRadius: 19 }} />
                : <RNText style={{ fontSize: 16, fontWeight: '800', color: '#FFF' }}>{recipientInitial}</RNText>}
            </View>

            <View style={{ flex: 1 }}>
              <RNText style={{ color: NAVY, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 }} numberOfLines={1}>{recipientName}</RNText>
              {rideInfo ? <RNText style={{ color: MUT, fontSize: 11, marginTop: 1 }} numberOfLines={1}>{rideInfo}</RNText> : null}
            </View>

            <TouchableOpacity
              onPress={confirmDelete}
              disabled={deleting}
              style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center', opacity: deleting ? 0.5 : 1 }}
              activeOpacity={0.75}
            >
              {deleting ? <ActivityIndicator size="small" color="#DC2626" /> : <Ionicons name="trash-outline" size={19} color="#DC2626" />}
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
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <RNText style={{ color: MUT, textAlign: 'center', fontSize: 14 }}>No messages yet. Say hello.</RNText>
              </View>
            ) : null}
            {messages.map((msg) => {
    const isMine = msg.senderId === uid && (!msg.senderRole || msg.senderRole === 'rider');
              return (
                <View key={msg.id} style={[{ marginBottom: 14 }, isMine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                  <View style={isMine
                    ? { maxWidth: '72%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, borderBottomRightRadius: 4, backgroundColor: ORANGE }
                    : { maxWidth: '72%', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, borderBottomLeftRadius: 4, backgroundColor: '#FFF', borderWidth: 1, borderColor: BDR }
                  }>
                    <RNText style={{ fontSize: 15, lineHeight: 21, color: isMine ? '#FFF' : NAVY }}>{msg.text}</RNText>
                  </View>
                  <RNText style={{ fontSize: 11, color: MUT, marginTop: 4, marginHorizontal: 4, fontWeight: '500', textAlign: isMine ? 'right' : 'left' }}>{formatTime(msg)}</RNText>
                </View>
              );
            })}
          </ScrollView>


          {/* Input bar */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 12, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: BDR, gap: 10, backgroundColor: '#FFF' }}>
            <TextInput
              style={{ flex: 1, borderWidth: 1, borderColor: BDR, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100, backgroundColor: '#F3EFE8', color: NAVY }}
              placeholder="Message..."
              placeholderTextColor={MUT}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={1000}
              onSubmitEditing={send}
            />
            <TouchableOpacity
              style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', opacity: (!draft.trim() || sending) ? 0.45 : 1 }}
              onPress={send}
              disabled={!draft.trim() || sending}
            >
              {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={18} color="#FFF" />}
            </TouchableOpacity>
          </View>

        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Bubble({ side, text }: { side: 'me' | 'them' | 'pin'; text: string }) {
  return <Text style={[s.bubble, side === 'me' && s.bubbleMe, side === 'pin' && s.bubblePin]}>{text}</Text>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderNotificationsReferencePlaceholder() {
  const items = [
    ['checkmark-circle', 'Booking confirmed. Austin -> Houston Fri 3:00 PM. You are in seat 1.', '2:14 PM', true],
    ['chatbubble-outline', 'Jordan T. sent you a message - pickup details for Friday.', '2:12 PM', false],
    ['flash', 'Price drop on Austin -> DFW. 4 seats now $24 each.', '11:08 AM', true],
    ['star', 'Riya D. rated your last ride 5 stars. Rate her back?', 'Mon', false],
    ['school', "You're verified. Welcome to RideAlong.", 'Oct 14', true],
  ] as const;
  return (
    <Phone title="Notifications" activeTab="home">
      <Label>TODAY</Label>
      {items.slice(0, 3).map(([icon, text, time, orange]) => <NoticeRow key={text} icon={icon as any} text={text} time={time} orange={orange} />)}
      <Label>EARLIER</Label>
      {items.slice(3).map(([icon, text, time, orange]) => <NoticeRow key={text} icon={icon as any} text={text} time={time} orange={orange} />)}
    </Phone>
  );
}

export function RiderNotificationsReference() {
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
              {deletingId === item.id ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="trash-outline" size={20} color="#FFFFFF" />}
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
            <Ionicons name="notifications-outline" size={24} color={ORANGE} />
          </View>
          <Text style={s.notificationEmptyTitle}>You are all caught up</Text>
          <Text style={s.notificationEmptyText}>Ride updates, messages, and account alerts will appear here.</Text>
        </View>
      ) : null}
    </Phone>
  );
}

function NoticeRow({ icon, text, time, orange, first }: { icon: keyof typeof Ionicons.glyphMap; text: string; time: string; orange?: boolean; first?: boolean }) {
  const isBell = icon === 'notifications-outline' || icon === 'notifications';
  return (
    <View style={[s.noticeRow, first && s.noticeRowFirst]}>
      <View style={[s.noticeIcon, orange && { backgroundColor: '#F9E8DB' }, isBell && { backgroundColor: ORANGE }]}><Ionicons name={icon} size={16} color={isBell ? '#FFFFFF' : orange ? ORANGE : NAVY} /></View>
      <Text style={s.noticeBody}>{text}</Text>
      <Text style={s.mono}>{time}</Text>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RiderProfileReferencePlaceholder() {
  const { signOut } = useAuthStore();
  return (
    <Phone title="Profile" back backTarget="/(rider)" compactContent>
      <TouchableOpacity style={s.profileSettingsBtn} onPress={() => router.push({ pathname: '/(rider)/settings', params: { returnTo: '/(rider)/profile' } } as any)}>
        <Ionicons name="settings" size={20} color={NAVY} />
      </TouchableOpacity>
      <View style={s.profileTopRow}>
        <View style={s.bigAvatar}><Text style={s.bigAvatarText}>MA</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.profileName}>Melody Adeyemi</Text>
          <Text style={s.mutedSmall}>{"UT Austin '27 · Joined Oct 2025"}</Text>
          <View style={[s.pillRow, s.profileBadgeRow]}><Pill label="Shield Verified" active /><Pill label="★ 4.96" /></View>
        </View>
      </View>
      <View style={s.statsRow}>
        <Stat value="28" label="Rides taken" orange />
        <Stat value="$1.4k" label="Saved vs Uber" />
        <Stat value="12" label="Friends made" />
      </View>
      <View style={s.menuCard}>
        <MenuRow icon="card" title="Verification" sub="UT Austin · approved" />
        <MenuRow icon="wallet" title="Payment methods" sub="Visa •• 4242 default" href="/(rider)/settings/payment-methods" returnTo="/(rider)/profile" />

        <MenuRow icon="notifications" title="Notifications" sub="Email + push" href="/(rider)/notifications" returnTo="/(rider)/profile" />

        <MenuRow icon="help-circle" title="Help & support" href="https://ridealongapp.com/pages/help" />
      </View>
      <GhostButton onPress={signOut}>Log out</GhostButton>
    </Phone>
  );
}

export function RiderProfileReference() {
  const { signOut, role, switchRole } = useAuthStore();
  const uid = firebaseAuth.currentUser?.uid;
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [requests, setRequests] = useState<MobileRideRequest[]>([]);
  const [roleActionLoading, setRoleActionLoading] = useState(false);
  useEffect(() => uid ? subscribeRiderProfile(uid, setProfile) : undefined, [uid]);
  useEffect(() => uid ? subscribeRiderRequests(uid, setRequests) : undefined, [uid]);
  const initials = (profile?.displayName || firebaseAuth.currentUser?.email || 'RA').split(/\s+|@/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  const completedRides = requests.filter((request) => ['completed', 'complete', 'finished'].includes(request.status)).length;
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
      router.push('/(auth)/driver-signup' as any);
    }
  };

  return (
    <Phone title="Profile" back backTarget="/(rider)" compactContent bottom={<PrimaryButton onPress={signOut}>Log out</PrimaryButton>} bottomOffset={4}>
      <TouchableOpacity style={s.profileSettingsBtn} onPress={() => router.push({ pathname: '/(rider)/settings', params: { returnTo: '/(rider)/profile' } } as any)}><Ionicons name="settings" size={20} color={NAVY} /></TouchableOpacity>
      <View style={s.profileTopRow}>
        <View style={s.bigAvatar}>{profile?.avatarUrl ? <Image source={{ uri: profile.avatarUrl }} style={s.bigAvatarImage} contentFit="cover" /> : <Text style={s.bigAvatarText}>{initials}</Text>}</View>
        <View style={{ flex: 1 }}>
          <View style={s.profileIdentityHeader}>
            <Text style={s.profileName}>{profile?.displayName || 'RideAlong rider'}</Text>
            <TouchableOpacity style={s.editProfileButton} onPress={() => router.push({ pathname: '/(rider)/settings/account-settings', params: { returnTo: '/(rider)/profile' } } as any)} accessibilityRole="button" accessibilityLabel="Edit profile" hitSlop={hitSlop}>
              <Ionicons name="pencil" size={16} color={ORANGE} />
            </TouchableOpacity>
          </View>
          <Text style={s.mutedSmall}>{profile?.university || profile?.email || firebaseAuth.currentUser?.email}</Text>
          <View style={[s.pillRow, s.profileBadgeRow]}><Pill label="Verified account" active />{profile?.rating ? <Pill label={`★ ${profile.rating.toFixed(2)}`} /> : null}</View>
        </View>
      </View>
      <View style={s.profileActivity}>
        <View style={s.profileActivityItem}><Text style={s.profileActivityValue}>{completedRides}</Text><Text style={s.profileActivityLabel}>Completed</Text></View>
        <View style={s.profileActivityDivider} />
        <View style={s.profileActivityItem}><Text style={s.profileActivityValue}>{requests.length}</Text><Text style={s.profileActivityLabel}>Posted</Text></View>
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
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <View style={s.driverSwitchIconWrap}>
                <Ionicons name="car-outline" size={17} color="#FFFFFF" />
              </View>
              <Text style={s.driverSwitchBtnText}>
                {hasDriverAccount ? 'Switch to driver mode' : 'Become a driver'}
              </Text>
              <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.6)" />
            </>
          )}
        </TouchableOpacity>
      ) : null}
      <View style={s.menuCard}><MenuRow icon="wallet" title="Payment methods" href="/(rider)/settings/payment-methods" returnTo="/(rider)/profile" /><MenuRow icon="time" title="Ride history" href="/(rider)/settings/ride-history" returnTo="/(rider)/profile" /><MenuRow icon="notifications" title="Notifications" href="/(rider)/notifications" returnTo="/(rider)/profile" /></View>
    </Phone>
  );
}

function Stat({ value, label, orange }: { value: string; label: string; orange?: boolean }) {
  return <View style={s.statBox}><Text style={[s.statValue, orange && { color: ORANGE }]}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>;
}

function MenuRow({ icon, title, sub, href, returnTo }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string; href?: string; returnTo?: string }) {
  const pathname = usePathname();
  const handlePress = async () => {
    if (!href) return;

    if (href.startsWith('http')) {
      try {
        await Linking.openURL(href);
      } catch {
        Alert.alert('Unable to open Help', 'Please visit ridealongapp.com/pages/help in your browser.');
      }
      return;
    }

    router.push({ pathname: href, params: { returnTo: returnTo || pathname } } as any);
  };

  return (
    <TouchableOpacity style={s.menuRow} onPress={handlePress} disabled={!href} accessibilityRole={href ? "link" : undefined}>
      <View style={s.menuIcon}><Ionicons name={icon} size={18} color={ORANGE} /></View>
      <View style={{ flex: 1 }}><Text style={s.menuTitle}>{title}</Text>{sub ? <Text style={s.menuSub}>{sub}</Text> : null}</View>
      <Ionicons name="chevron-forward" size={17} color={MUTED} />
    </TouchableOpacity>
  );
}

function SettingsToggleRow({ icon, title, sub, value, onChange, isLast = false }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; value: boolean; onChange: (value: boolean) => void; isLast?: boolean }) {
  return (
    <View style={[s.menuRow, isLast && s.menuRowLast]}>
      <View style={s.menuIcon}><Ionicons name={icon} size={18} color={ORANGE} /></View>
      <View style={{ flex: 1 }}><Text style={s.menuTitle}>{title}</Text><Text style={s.menuSub}>{sub}</Text></View>
      <View style={s.settingsSwitchWrap}>
        <Switch value={value} onValueChange={onChange} trackColor={{ false: '#D1D5DB', true: ORANGE }} thumbColor="#FFFFFF" ios_backgroundColor="#D1D5DB" style={s.settingsSwitch} />
      </View>
    </View>
  );
}

export function RiderSettingsReference() {
  const { isDark, setDark } = useAppTheme();
  const [pushEnabled, setPushEnabled] = useState(true);

  useEffect(() => {
    settingsService.getSettings().then((settings) => setPushEnabled(settings.pushNotificationsEnabled)).catch(() => {});
    const loadRiderSettings = async () => {
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) return;
      try {
        const snapshot = await getDoc(doc(firestore, 'riders', currentUser.uid));
        const data = snapshot.data() as any;
        const savedPush = data?.settings?.pushNotificationsEnabled ?? data?.pushNotificationsEnabled;
        const savedDarkMode = data?.settings?.darkModeEnabled ?? data?.darkModeEnabled;
        if (typeof savedPush === 'boolean') setPushEnabled(savedPush);
        if (typeof savedDarkMode === 'boolean') setDark(savedDarkMode);
      } catch {}
    };
    void loadRiderSettings();
  }, [setDark]);

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
        <MenuRow icon="school" title="Student verification" sub="Upload proof and view status" href="/(rider)/settings/student-verification" returnTo="/(rider)/settings" />

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
        <MenuRow icon="shield-checkmark" title="Privacy policy" href="/(rider)/legal/privacy" returnTo="/(rider)/settings" />
        <MenuRow icon="document-text" title="Terms of service" href="/(rider)/legal/terms" returnTo="/(rider)/settings" />
      </View>
    </Phone>
  );
}

export function RiderAccountReference() {
  return (
    <Phone title="Account" back backHref="/(rider)/settings" bottom={<PrimaryButton>Save changes</PrimaryButton>}>
      <View style={s.accountAvatar}><View style={s.bigAvatar}><Text style={s.bigAvatarText}>MA</Text></View><Text style={s.messagePreview}>Tap to change photo</Text></View>
      <View style={s.split}><Field label="NAME" value="Melody" onChangeText={() => {}} /><Field label=" " value="Adeyemi" onChangeText={() => {}} /></View>
      <Field label="EMAIL · .EDU" value="melody@utexas.edu\n✓ Verified UT Austin" onChangeText={() => {}} />
      <Field label="PHONE" value="+1 (512) 555-8243" onChangeText={() => {}} />
      <Label>PASSWORD</Label>
      <GhostButton>Change password</GhostButton>
      <Label>DANGER ZONE</Label>
      <View style={s.menuCard}><MenuRow icon="pause" title="Pause account" /><MenuRow icon="trash" title="Delete account" /></View>
    </Phone>
  );
}

export function RiderEmergencyReference() {
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
          <View style={s.emergencyIntroIcon}><Ionicons name="shield-checkmark" size={22} color={ORANGE} /></View>
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
            <Ionicons name="add" size={18} color={ORANGE} />
            <Text style={s.emergencyHeaderAddText}>Add</Text>
          </TouchableOpacity>
        </View>

        {isLoading && !contacts.length ? <View style={s.preferenceLoading}><ActivityIndicator color={ORANGE} /><Text style={s.paymentStateText}>Loading contacts...</Text></View> : null}

        {!isLoading && !contacts.length ? (
          <View style={s.emergencyEmpty}>
            <View style={s.emergencyEmptyIcon}><Ionicons name="people-outline" size={28} color={ORANGE} /></View>
            <Text style={s.paymentStateTitle}>No emergency contacts yet</Text>
            <Text style={s.paymentStateText}>Add someone you trust so they can receive trip and safety updates.</Text>
          </View>
        ) : null}

        {contacts.map((contact, index) => (
          <Contact key={contact.id || `${contact.phone}-${index}`} contact={contact} onDelete={() => confirmDeleteContact(index, contact.name)} />
        ))}

        <TouchableOpacity style={s.addContactButton} onPress={() => setModalOpen(true)} accessibilityRole="button">
          <Ionicons name="person-add-outline" size={20} color="#FFFFFF" />
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
                <Ionicons name="close" size={20} color={NAVY} />
              </TouchableOpacity>
            </View>
            <Text style={s.contactFieldLabel}>FULL NAME</Text>
            <TextInput style={s.contactInput} value={name} onChangeText={setName} placeholder="Adaora Adeyemi" placeholderTextColor={MUTED} autoCapitalize="words" />
            <Text style={s.contactFieldLabel}>RELATIONSHIP</Text>
            <TextInput style={s.contactInput} value={relationship} onChangeText={setRelationship} placeholder="Parent, sibling, friend..." placeholderTextColor={MUTED} autoCapitalize="words" />
            <Text style={s.contactFieldLabel}>PHONE NUMBER</Text>
            <TextInput style={s.contactInput} value={phone} onChangeText={setPhone} placeholder="(512) 555-0123" placeholderTextColor={MUTED} keyboardType="phone-pad" textContentType="telephoneNumber" />
            <TouchableOpacity style={[s.addContactButton, s.contactModalSubmit]} onPress={() => void saveContact()} disabled={isLoading} accessibilityRole="button">
              {isLoading ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="shield-checkmark-outline" size={20} color="#FFFFFF" />}
              <Text style={s.addContactButtonText}>{isLoading ? 'Adding contact...' : 'Add contact'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAwareModalView>
      </Modal>
    </>
  );
}

function Contact({ contact, onDelete }: { contact: EmergencyContact; onDelete: () => void }) {
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
        <Ionicons name="trash-outline" size={18} color="#9A4A4A" />
      </TouchableOpacity>
    </View>
  );
}

export function RiderPaymentMethodsReference() {
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
          } catch {
            Alert.alert('Unable to remove card', 'Please try removing this card again.');
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
            <Ionicons name="add" size={18} color={ORANGE} />
            <Text style={s.addPaymentLinkText}>Add new</Text>
          </TouchableOpacity>
        </View>

        {isLoadingMethods && paymentMethods.length === 0 ? (
          <View style={s.paymentState}>
            <ActivityIndicator color={ORANGE} />
            <Text style={s.paymentStateText}>Loading your payment methods...</Text>
          </View>
        ) : null}

        {!isLoadingMethods && methodsError ? (
          <View style={s.paymentState}>
            <Ionicons name="alert-circle-outline" size={24} color={ORANGE} />
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
              <Ionicons name="card-outline" size={28} color={ORANGE} />
            </View>
            <Text style={s.paymentStateTitle}>No payment methods yet</Text>
            <Text style={s.paymentStateText}>Add a card to request rides and complete payments securely.</Text>
          </View>
        ) : null}

        {paymentMethods.map((method) => (
          <View key={method.id} style={[s.paymentMethodCard, method.isDefault && s.paymentMethodCardDefault]}>
            <View style={[s.paymentBrandIcon, method.isDefault && s.paymentBrandIconDefault]}>
              <Ionicons name="card" size={21} color={method.isDefault ? '#FFFFFF' : NAVY} />
            </View>
            <View style={s.paymentMethodDetails}>
              <View style={s.paymentMethodTitleRow}>
                <Text style={s.paymentMethodTitle}>{method.brand || 'Card'} •••• {method.last4}</Text>
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
          <Ionicons name="add-circle-outline" size={21} color="#FFFFFF" />
          <Text style={s.addPaymentButtonText}>Add new payment method</Text>
        </TouchableOpacity>

        <View style={s.paymentSecurityNote}>
          <Ionicons name="shield-checkmark-outline" size={17} color="#667085" />
          <Text style={s.paymentSecurityText}>Card details are encrypted and securely processed by Stripe.</Text>
        </View>
      </Phone>
      <AddCardModal visible={showAddCard} onClose={() => setShowAddCard(false)} />
    </>
  );
}

export function RiderPreferencesReference() {
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
      {isLoading && preferences ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
      <Text style={s.preferenceSaveText}>{isLoading && preferences ? 'Saving...' : isDirty ? 'Save preferences' : 'Preferences saved'}</Text>
    </TouchableOpacity>
  );

  return (
    <Phone title="Ride preferences" back backHref="/(rider)/profile" compactContent bottom={preferences ? saveButton : undefined} bottomOffset={4}>
      <Text style={s.preferenceIntro}>Set the ride environment you are most comfortable with. Drivers can review these details before accepting your request.</Text>
      <View style={s.riderPreferredRoutes}><DriverPreferredRoutesManager role="rider" /></View>

      {isLoading && !preferences ? (
        <View style={s.preferenceLoading}>
          <ActivityIndicator color={ORANGE} />
          <Text style={s.paymentStateText}>Loading your preferences...</Text>
        </View>
      ) : null}

      {loadError && !preferences ? (
        <View style={s.preferenceLoading}>
          <Ionicons name="alert-circle-outline" size={26} color={ORANGE} />
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
  return (
    <View style={s.preferenceSection}>
      <View style={s.preferenceSectionHeader}>
        <View style={s.preferenceSectionIcon}><Ionicons name={icon} size={19} color={ORANGE} /></View>
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
  return (
    <TouchableOpacity
      style={[s.preferenceChip, selected && s.preferenceChipSelected]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
      <Text style={[s.preferenceChipText, selected && s.preferenceChipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PreferenceOptions({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (value: string) => void }) {
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
  return (
    <Phone title="Terms of service" back bottom={<View style={s.split}><GhostButton>Decline</GhostButton><PrimaryButton>Accept</PrimaryButton></View>}>
      <Text style={s.label}>V 4.2 · UPDATED OCT 14, 2025</Text>
      <Text style={s.termsTitle}>The short version</Text>
      <Text style={s.bodyText}>RideAlong is a marketplace for verified students to share rides. We do not drive the cars - your fellow students do. We verify everyone with a .edu and a background check, take payments, and split costs.</Text>
      <View style={s.englishBox}><Text style={s.offerText}>The deal in plain English</Text><Text style={s.bodyText}>{"• You are responsible for your own behavior in someone's car."}{'\n'}{"• We are not liable for personal stuff your fellow students bring."}{'\n'}{"• Cancel free up to 24h before. After that, partial refund."}{'\n'}{"• Violate the community guidelines, you are out."}</Text></View>
      <Text style={s.sectionBig}>1. Eligibility</Text>
      <Text style={s.bodyText}>You must hold a valid .edu email address from an accredited US college or university. Account is non-transferable.</Text>
      <Text style={s.sectionBig}>2. Payments</Text>
    </Phone>
  );
}

const s = StyleSheet.create({
  text: { fontFamily: FONT_SANS, color: NAVY },
  root: { flex: 1, alignItems: 'center', backgroundColor: BG },
  safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: BG },
  safeCream: { backgroundColor: '#FFF6EB' },
  status: { height: 38, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24 },
  statusTime: { fontSize: 14, fontWeight: '700', color: '#111827' },
  notch: { position: 'absolute', top: 9, left: '36%', right: '36%', height: 30, borderRadius: 16, backgroundColor: '#000' },
  statusIcons: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  header: { ...appHeader.row, height: 64, paddingHorizontal: 20 },
  scrollableHeader: { marginHorizontal: -layout.screenPadding },
  headerNoDivider: { borderBottomWidth: 0 },
  headerTitle: { ...appHeader.title, fontFamily: FONT_SANS, color: NAVY },
  headerTitleAfterBack: { flexShrink: 1, marginLeft: 12 },
  headerTitleLarge: { ...appHeader.title },
  circle: { ...appHeader.iconButton, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF'},
  body: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingTop: 24, flexGrow: 1 },
  bodyCompact: { paddingTop: 8 },
  bodyWithScrollableHeader: { paddingTop: 0 },
  scrollHeaderGap: { height: 24 },
  scrollHeaderGapCompact: { height: 8 },
  mainPageHeader: { marginBottom: 12 },
  messagesPageHeader: { marginBottom: 4 },
  mainPageTitle: { fontFamily: FONT_SANS, color: NAVY, fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.25 },
  brand: { flexDirection: 'row', alignItems: 'center', marginBottom: 54, gap: 8 },
  brandText: { fontSize: 19, fontWeight: '700' },
  hero: { marginBottom: 36 },
  heroText: { fontSize: 36, lineHeight: 42, fontWeight: '400', letterSpacing: -0.3 },
  heroAccent: { color: ORANGE, fontStyle: 'italic', fontWeight: '500' },
  sub: { color: MUTED, fontSize: 15, lineHeight: 23, marginTop: 16 },
  label: { fontFamily: FONT_MONO, color: '#9AA3B2', fontSize: 11, letterSpacing: 2, fontWeight: '500' },
  field: { flex: 1, marginBottom: 20 },
  input: { fontFamily: FONT_SANS, height: 54, borderRadius: 14, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', paddingHorizontal: 16, color: NAVY, fontSize: 16, marginTop: 8 },
  split: { flexDirection: 'row', gap: 12 },
  formRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 },
  remember: { flex: 1, color: MUTED, fontSize: 14 },
  orangeLink: { color: ORANGE, fontSize: 14, fontWeight: '700' },
  primary: { height: 54, borderRadius: 27, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  ghost: { height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  ghostText: { fontSize: 15, fontWeight: '500' },
  authFooter: { marginTop: 'auto', minHeight: 34, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap' },
  footerText: { color: MUTED, fontSize: 11 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 22 },
  stepText: { fontFamily: FONT_MONO, color: '#6B7280', fontSize: 11, letterSpacing: 1.5 },
  stepTrack: { flex: 1, height: 3, backgroundColor: '#D1D5DB' },
  stepFill: { height: 3, backgroundColor: ORANGE },
  codeRow: { flexDirection: 'row', gap: 8, marginBottom: 28 },
  codeBox: { width: 40, height: 50, borderRadius: 12, borderWidth: 1.5, borderColor: ORANGE, textAlign: 'center', lineHeight: 48, fontSize: 28, fontWeight: '400' },
  codeMuted: { color: MUTED, borderColor: '#D7DCE3' },
  modeCard: { minHeight: 96, borderRadius: 18, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', padding: 18, gap: 16, marginBottom: 16 },
  modeSelected: { borderColor: ORANGE },
  modeDashed: { borderStyle: 'dashed' },
  modeIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: PAPER, alignItems: 'center', justifyContent: 'center' },
  modeTitle: { fontSize: 18, fontWeight: '700' },
  modeSub: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 4 },
  recommended: { position: 'absolute', right: 12, top: -10, backgroundColor: ORANGE, color: '#FFFFFF', fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  notice: { marginTop: 'auto', minHeight: 48, borderRadius: 12, backgroundColor: '#F9E8DB', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  noticeText: { color: '#8C3D13', fontSize: 13, lineHeight: 18 },
  upload: { height: 180, borderRadius: 18, borderWidth: 1, borderColor: '#D7DCE3', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  uploadIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  uploadTitle: { fontWeight: '700', fontSize: 13 },
  uploadSub: { color: MUTED, fontSize: 13, marginTop: 5 },
  infoBox: { borderRadius: 10, backgroundColor: PAPER, padding: 14 },
  infoText: { fontSize: 14, lineHeight: 21 },
  infoBold: { fontWeight: '700' },
  tabs: { position: 'absolute', left: 24, right: 24, bottom: 14, height: 58, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E8E3DA', borderRadius: 29, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 5, shadowColor: '#17233A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 10 },
  tab: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, gap: 1 },
  tabActive: { backgroundColor: '#F6F2EC' },
  tabText: { color: '#6B7280', fontSize: 11, fontWeight: '600' },
  tabIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', top: -7, right: -11, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  iconBadgeText: { color: '#FFFFFF', fontSize: 9, lineHeight: 11, fontWeight: '800' },
  bottomAction: { position: 'absolute', left: 18, right: 18, bottom: 20 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 22 },
  pill: { fontFamily: FONT_MONO, borderRadius: 18, borderWidth: 1, borderColor: '#D7DCE3', color: '#6B7280', fontSize: 12, paddingHorizontal: 14, paddingVertical: 9, overflow: 'hidden' },
  pillActive: { backgroundColor: NAVY, borderColor: NAVY, color: '#FFFFFF' },
  requestCard: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18, marginBottom: 16, minHeight: 150 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NAVY },
  routeTitle: { flex: 1, fontSize: 17, fontWeight: '600', lineHeight: 24 },
  mono: { fontFamily: FONT_MONO, color: MUTED, fontSize: 11 },
  mutedLine: { color: MUTED, fontSize: 14, marginTop: 20 },
  bold: { fontWeight: '700', color: NAVY },
  dash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#D7DCE3', marginVertical: 16 },
  offerText: { flex: 1, color: ORANGE, fontFamily: FONT_MONO, fontSize: 12, fontWeight: '700' },
  navyBtn: { backgroundColor: NAVY, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 11 },
  navyBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  pastRow: { borderRadius: 15, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, fontSize: 13, marginTop: 12, color: NAVY },
  historyCard: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18, marginBottom: 16 },
  riderHistoryStatsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', paddingVertical: 18 },
  riderHistoryStatCard: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  riderHistoryStatDivider: { width: 1, height: 36, backgroundColor: BORDER },
  riderHistoryStatValue: { color: NAVY, fontSize: 24, fontWeight: '800', marginBottom: 3 },
  riderHistoryStatLabel: { color: MUTED, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  riderHistoryTabRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  riderHistoryTab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, backgroundColor: '#FFFFFF' },
  riderHistoryTabActive: { borderColor: ORANGE, backgroundColor: `${ORANGE}10` },
  riderHistoryTabText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  riderHistoryTabTextActive: { color: ORANGE, fontWeight: '700' },
  riderHistoryLoading: { alignItems: 'center', paddingTop: 60 },
  riderHistoryCard: { borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', marginBottom: 14, overflow: 'hidden', flexDirection: 'row', shadowColor: NAVY, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 1 },
  riderHistoryCardAccent: { width: 4, flexShrink: 0 },
  riderHistoryCardInner: { flex: 1, padding: 15 },
  riderHistoryCardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  riderHistoryStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  riderHistoryStatusDot: { width: 6, height: 6, borderRadius: 3 },
  riderHistoryStatusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  riderHistoryTripMeta: { color: MUTED, fontSize: 11, fontWeight: '500' },
  riderHistoryPrice: { color: ORANGE, fontSize: 18, fontWeight: '800' },
  riderHistoryRouteBlock: { minHeight: 78, flexDirection: 'row', marginBottom: 2 },
  riderHistoryRouteRail: { width: 18, alignItems: 'center', paddingVertical: 3 },
  riderHistoryNavyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: NAVY, flexShrink: 0 },
  riderHistoryRouteLine: { flex: 1, width: 1.5, marginVertical: 4, backgroundColor: '#D8DDE5' },
  riderHistoryOrangeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE, flexShrink: 0 },
  riderHistoryRouteDetails: { flex: 1, justifyContent: 'space-between', paddingLeft: 10 },
  riderHistoryRouteLabel: { color: MUTED, fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 1 },
  riderHistoryRouteText: { color: NAVY, fontSize: 14, lineHeight: 19, fontWeight: '600', marginTop: 2 },
  riderHistoryFooter: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: BORDER, marginTop: 13, paddingTop: 12, gap: 10 },
  riderHistoryAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  riderHistoryAvatarImage: { width: 36, height: 36, borderRadius: 18 },
  riderHistoryAvatarText: { color: ORANGE, fontSize: 12, fontWeight: '700' },
  riderHistoryDriverInfo: { flex: 1, minWidth: 0 },
  riderHistoryDriverName: { color: NAVY, fontSize: 13, fontWeight: '700' },
  riderHistoryDriverMeta: { color: MUTED, fontSize: 11, marginTop: 1 },
  riderHistoryFlagButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2' },
  riderHistoryEmpty: { borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 32, alignItems: 'center', marginTop: 4 },
  riderHistoryEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#FEF0E8', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  riderHistoryEmptyTitle: { color: NAVY, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  riderHistoryEmptyText: { color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  riderHistoryBrowseButton: { minHeight: 46, borderRadius: 23, backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20, marginTop: 18 },
  riderHistoryBrowseText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: ORANGE, fontSize: 13, fontWeight: '600' },
  driverMeta: { flex: 1, color: MUTED, fontSize: 13, lineHeight: 19 },
  price: { color: ORANGE, fontSize: 30, fontWeight: '300' },
  profileHero: { alignItems: 'center', paddingVertical: 22 },
  bigAvatar: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' },
  bigAvatarImage: { width: '100%', height: '100%', borderRadius: 41 },
  bigAvatarSmall: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center' },
  bigAvatarText: { color: ORANGE, fontSize: 26, fontWeight: '600' },
  profileName: { fontSize: 25, fontWeight: '700', marginTop: 3 },
  panel: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 18, marginBottom: 16 },
  bodyText: { color: '#4A5568', fontSize: 15, lineHeight: 23, marginTop: 12 },
  vehicle: { width: 58, height: 50, borderRadius: 10, backgroundColor: PAPER, alignItems: 'center', justifyContent: 'center' },
  mutedSmall: { color: MUTED, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  review: { borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 13, marginBottom: 12 },
  quote: { color: '#4A5568', fontSize: 12, lineHeight: 18, marginTop: 10, fontStyle: 'italic' },
  mapArea: { height: 496, marginHorizontal: -20, marginTop: -12, backgroundColor: '#FFFDFC' },
  routeCurve: { position: 'absolute', left: 62, right: 78, top: 154, height: 130, borderBottomWidth: 4, borderRightWidth: 4, borderColor: ORANGE, borderBottomRightRadius: 160, transform: [{ rotate: '-22deg' }] },
  mapPin: { position: 'absolute', width: 18, height: 18, borderRadius: 9 },
  carPin: { position: 'absolute', left: 145, top: 204, width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  tripSheet: { marginHorizontal: -20, padding: 18, borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG },
  rowIcons: { flexDirection: 'row', gap: 14 },
  etaCard: { marginTop: 16, borderRadius: 14, backgroundColor: PAPER, padding: 14 },
  eta: { position: 'absolute', right: 14, top: 12, color: ORANGE, fontSize: 24, fontWeight: '300' },
  etaMiles: { position: 'absolute', right: 14, bottom: 14, color: NAVY, fontSize: 12, fontWeight: '700' },
  rateHero: { alignItems: 'center', paddingTop: 14, paddingBottom: 20 },
  stars: { color: ORANGE, fontSize: 34, letterSpacing: 6, marginTop: 18 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  noteInput: { fontFamily: FONT_SANS, minHeight: 56, borderRadius: 10, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', padding: 12, textAlignVertical: 'top' },
  listTopLine: { height: 0, marginBottom: 0 },
  messageLoading: { color: MUTED, fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 14 },
  messageCard: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: BG },
  messageAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  messageAvatarText: { color: ORANGE, fontSize: 18, fontWeight: '600' },
  messageContent: { flex: 1, minWidth: 0 },
  messageTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  messageMeta: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  messageTime: { color: MUTED, fontSize: 11, fontWeight: '600' },
  messageEmptyCard: { marginTop: 40, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 180 },
  messageEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  messageEmptyTitle: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  messageEmptyText: { maxWidth: 280, color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  notificationEmptyCard: { flex: 1, minHeight: 420, paddingHorizontal: 24, paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
  notificationEmptyIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#FEF0E8', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  notificationEmptyTitle: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '700', textAlign: 'center', letterSpacing: -0.2 },
  notificationEmptyText: { maxWidth: 278, color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, fontWeight: '500' },
  swipeDelete: { width: 80, alignSelf: 'stretch', backgroundColor: '#C94747', alignItems: 'center', justifyContent: 'center', gap: 5 },
  swipeDeleteText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  bigAvatarTextSmall: { color: ORANGE, fontSize: 18, fontWeight: '600' },
  messageName: { flex: 1, color: NAVY, fontSize: 16, fontWeight: '600' },
  messagePreview: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 2, fontWeight: '600' },
  newBadge: { color: ORANGE, backgroundColor: '#F9E8DB', overflow: 'hidden', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3, fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatInput: { fontFamily: FONT_SANS, flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: PAPER, paddingHorizontal: 16, color: NAVY, fontSize: 15 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '82%', alignSelf: 'flex-start', backgroundColor: PAPER, borderRadius: 18, padding: 16, marginBottom: 14, color: NAVY, fontSize: 15, lineHeight: 22 },
  bubbleMe: { alignSelf: 'flex-end', backgroundColor: NAVY, color: '#FFFFFF' },
  bubblePin: { alignSelf: 'flex-end', backgroundColor: ORANGE, color: '#FFFFFF' },
  noticeRow: { flexDirection: 'row', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  noticeRowFirst: { paddingTop: 6 },
  noticeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: PAPER, alignItems: 'center', justifyContent: 'center' },
  noticeBody: { flex: 1, fontSize: 14, lineHeight: 21 },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  profileIdentityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  editProfileButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF2E9', alignItems: 'center', justifyContent: 'center' },
  profileBadgeRow: { marginTop: 6 },
  profileSettingsBtn: { position: 'absolute', top: 10, right: 20, zIndex: 5, width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  profileActivity: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingHorizontal: 8 },
  profileActivityItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  profileActivityValue: { color: NAVY, fontSize: 20, lineHeight: 25, fontWeight: '700' },
  profileActivityCancelled: { color: '#C94747' },
  profileActivityLabel: { color: MUTED, fontSize: 11, lineHeight: 16, marginTop: 2 },
  profileActivityDivider: { width: 1, height: 32, backgroundColor: BORDER },
  profileAboutCard: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 18 },
  profileAboutTitle: { color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 6 },
  profileAboutText: { color: '#5F6878', fontSize: 13, lineHeight: 20, fontWeight: '500' },
  driverSwitchBtn: { height: 50, borderRadius: 25, backgroundColor: NAVY, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10, marginBottom: 18 },
  driverSwitchIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  driverSwitchBtnText: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  statBox: { flex: 1, minHeight: 88, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 15, justifyContent: 'center' },
  statValue: { fontSize: 30, fontWeight: '300' },
  statLabel: { color: MUTED, fontSize: 12, marginTop: 4 },
  menuCard: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', overflow: 'hidden', marginBottom: 18 },
  menuRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  menuRowLast: { borderBottomWidth: 0 },
  menuIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#FFF2E9', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  menuTitle: { fontSize: 15, fontWeight: '600' },
  menuSub: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 3 },
  settingsSectionLabel: { fontFamily: FONT_MONO, color: '#8B94A6', fontSize: 10, lineHeight: 15, letterSpacing: 1.5, fontWeight: '600', marginBottom: 8, paddingHorizontal: 2 },
  settingsMenuCard: { marginBottom: 20 },
  settingsMenuCardLast: { marginBottom: 4 },
  settingsSwitchWrap: { width: 46, height: 32, marginRight: 4, alignItems: 'center', justifyContent: 'center' },
  settingsSwitch: { transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] },
  findSearch: { height: 54, borderRadius: 14, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 20 },
  accountAvatar: { alignItems: 'center', marginBottom: 24 },
  warningBox: { borderRadius: 12, backgroundColor: '#F9E8DB', flexDirection: 'row', gap: 10, padding: 14, marginBottom: 14 },
  warningText: { flex: 1, color: '#9A4A19', fontSize: 11, lineHeight: 16 },
  contactCard: { minHeight: 104, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 13, padding: 16, marginBottom: 12 },
  addContact: { height: 86, borderRadius: 16, borderWidth: 1, borderColor: '#D7DCE3', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8 },
  emergencyIntro: { borderRadius: 18, backgroundColor: '#FFF2E9', flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, marginBottom: 24 },
  emergencyIntroIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  emergencyIntroTitle: { color: NAVY, fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 3 },
  emergencyIntroText: { color: '#687386', fontSize: 12, lineHeight: 18 },
  emergencySectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  emergencySectionTitle: { color: NAVY, fontSize: 19, lineHeight: 25, fontWeight: '700' },
  emergencyCount: { color: MUTED, fontSize: 12, marginTop: 2 },
  emergencyHeaderAdd: { minHeight: 42, borderRadius: 21, backgroundColor: '#FCEBDD', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14 },
  emergencyHeaderAddText: { color: ORANGE, fontSize: 14, fontWeight: '700' },
  emergencyEmpty: { minHeight: 205, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 24, marginBottom: 14 },
  emergencyEmptyIcon: { width: 58, height: 58, borderRadius: 19, backgroundColor: '#FCEBDD', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  contactAvatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#FCEBDD', alignItems: 'center', justifyContent: 'center' },
  contactAvatarText: { color: ORANGE, fontSize: 16, fontWeight: '700' },
  contactName: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  contactRelationship: { color: ORANGE, fontSize: 11, lineHeight: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 },
  contactPhone: { color: MUTED, fontSize: 13, lineHeight: 18, marginTop: 2 },
  contactDelete: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center' },
  addContactButton: { minHeight: 52, borderRadius: 26, backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  addContactButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  contactModalOverlay: { flex: 1, backgroundColor: 'rgba(21,35,58,0.35)', justifyContent: 'flex-end' },
  contactModalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: BG, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 },
  contactModalHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: '#D1D5DB', alignSelf: 'center', marginBottom: 18 },
  contactModalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 },
  contactModalTitle: { color: NAVY, fontSize: 22, lineHeight: 28, fontWeight: '700' },
  contactModalSubtitle: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 3 },
  contactModalClose: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  contactFieldLabel: { fontFamily: FONT_MONO, color: '#8B94A6', fontSize: 10, lineHeight: 15, letterSpacing: 1.4, fontWeight: '600', marginBottom: 7 },
  contactInput: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', color: NAVY, fontSize: 15, paddingHorizontal: 15, marginBottom: 16 },
  contactModalSubmit: { marginTop: 4 },
  creditCard: { height: 174, borderRadius: 16, backgroundColor: NAVY, marginVertical: 18, padding: 20 },
  cardLabel: { color: '#D6DCE8', fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 2, fontWeight: '700' },
  visa: { position: 'absolute', right: 16, top: 16, color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  cardNumber: { color: '#FFFFFF', fontFamily: FONT_MONO, fontSize: 18, letterSpacing: 3, marginTop: 36 },
  cardName: { position: 'absolute', left: 16, bottom: 14, color: '#FFFFFF', fontFamily: FONT_MONO, fontSize: 9 },
  cardDate: { position: 'absolute', right: 16, bottom: 14, color: '#FFFFFF', fontFamily: FONT_MONO, fontSize: 10 },
  payRow: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginBottom: 16 },
  payIcon: { width: 38, height: 28, borderRadius: 7, backgroundColor: PAPER, textAlign: 'center', lineHeight: 28, fontWeight: '700' },
  paymentSectionHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addPaymentLink: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12 },
  addPaymentLinkText: { color: ORANGE, fontSize: 14, fontWeight: '700' },
  paymentState: { minHeight: 190, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, marginBottom: 16 },
  paymentEmpty: { minHeight: 210, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 24, marginBottom: 16 },
  paymentEmptyIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#FCEBDD', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  paymentStateTitle: { color: NAVY, fontSize: 17, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  paymentStateText: { color: MUTED, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 280 },
  paymentRetry: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 18, marginTop: 6 },
  paymentRetryText: { color: ORANGE, fontSize: 14, fontWeight: '700' },
  paymentMethodCard: { minHeight: 112, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16, marginBottom: 12 },
  paymentMethodCardDefault: { borderColor: '#F2B18E', backgroundColor: '#FFFCFA' },
  paymentBrandIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: PAPER, alignItems: 'center', justifyContent: 'center' },
  paymentBrandIconDefault: { backgroundColor: ORANGE },
  paymentMethodDetails: { flex: 1 },
  paymentMethodTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 3 },
  paymentMethodTitle: { color: NAVY, fontSize: 16, lineHeight: 22, fontWeight: '700', textTransform: 'capitalize' },
  defaultBadge: { borderRadius: 10, backgroundColor: '#FCEBDD', color: ORANGE, fontFamily: FONT_MONO, fontSize: 9, lineHeight: 18, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 7 },
  paymentMethodActions: { minHeight: 35, flexDirection: 'row', alignItems: 'flex-end', gap: 20, marginTop: 4 },
  paymentActionText: { color: ORANGE, fontSize: 13, fontWeight: '700' },
  paymentRemoveText: { color: '#667085', fontSize: 13, fontWeight: '600' },
  addPaymentButton: { minHeight: 52, borderRadius: 26, backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 6 },
  addPaymentButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  paymentSecurityNote: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 8, paddingHorizontal: 12, marginTop: 16 },
  paymentSecurityText: { flex: 1, color: '#667085', fontSize: 11, lineHeight: 16 },
  riderPreferredRoutes: { marginBottom: 18 },
  preferenceIntro: { color: '#667085', fontSize: 14, lineHeight: 20, marginBottom: 18 },
  preferenceLoading: { minHeight: 220, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  preferenceSection: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 16, marginBottom: 14 },
  preferenceSectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginBottom: 14 },
  preferenceSectionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#FCEBDD', alignItems: 'center', justifyContent: 'center' },
  preferenceSectionHeading: { flex: 1, minHeight: 36, justifyContent: 'center' },
  preferenceSectionTitle: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  preferenceSectionDescription: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 2 },
  preferenceChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preferenceChip: { minHeight: 38, borderRadius: 19, borderWidth: 1, borderColor: '#D7DCE3', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 13 },
  preferenceChipSelected: { borderColor: NAVY, backgroundColor: NAVY },
  preferenceChipText: { color: '#667085', fontSize: 13, fontWeight: '600' },
  preferenceChipTextSelected: { color: '#FFFFFF' },
  preferenceOptions: { gap: 8 },
  preferenceOption: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: '#E3E6EA', backgroundColor: '#FCFCFB', flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14 },
  preferenceOptionSelected: { borderColor: '#F0A47C', backgroundColor: '#FFF7F2' },
  preferenceRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#B7BEC9', alignItems: 'center', justifyContent: 'center' },
  preferenceRadioSelected: { borderColor: ORANGE },
  preferenceRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  preferenceOptionText: { color: '#526071', fontSize: 14, lineHeight: 19, fontWeight: '600' },
  preferenceOptionTextSelected: { color: NAVY },
  preferenceSaveButton: { minHeight: 54, borderRadius: 27, backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  preferenceSaveButtonDisabled: { backgroundColor: '#C8CDD5' },
  preferenceSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  toggleRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: BORDER },
  toggle: { marginLeft: 'auto', width: 34, height: 22, borderRadius: 11, backgroundColor: '#D1D5DB' },
  toggleOn: { marginLeft: 'auto', width: 34, height: 22, borderRadius: 11, backgroundColor: ORANGE },
  englishBox: { borderLeftWidth: 2, borderLeftColor: ORANGE, paddingLeft: 12, marginVertical: 24 },
  termsTitle: { fontSize: 24, fontWeight: '700', marginTop: 20, marginBottom: 24 },
  sectionBig: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
});
