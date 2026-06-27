import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, RefreshControl,
  TouchableOpacity, Linking, Animated, AppState, ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useDriverPayouts } from '@/hooks/useDriverPayouts';
import { AddBankAccountModal } from '@/components/AddBankAccountModal';
import type { AddBankAccountPayload, BankAccount } from '@/types';
import { createDashboardLink, createOnboardingLink, instantDeposit, fetchPayouts, type Payout } from '@/src/services/payouts';
import { logActivity } from '@/src/services/activity';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { doc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';

type EarningsSummary = {
  available: number;
  pending: number;
  lifetime?: number | null;
  lastPayoutAt?: string | null;
};

export default function EarningsScreen() {
  const { colors } = useAppTheme();
  const s = useMemo(() => StyleSheet.create({
    root:        { flex: 1, backgroundColor: colors.bg },
    safe:        { flex: 1 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
    loadingText: { color: colors.textSecondary, fontSize: 15, fontWeight: '500' as const },

    hdr:      { minHeight: 64, position: 'relative' as const, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingTop: 8, paddingBottom: 16 },
    backBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.bgCard, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: colors.border },
    hdrTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    content: { paddingHorizontal: 20, paddingTop: 4 },

    heroBanner: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      padding: 24,
      marginBottom: 16,
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.07,
      shadowRadius: 14,
      elevation: 2,
    },
    heroLabel:  { color: colors.textSecondary, fontSize: 10, fontWeight: '800' as const, letterSpacing: 1.5, marginBottom: 8 },
    heroAmount: { color: colors.primary, fontSize: 44, fontWeight: '300' as const, letterSpacing: -1.5, marginBottom: 4 },
    heroSub:    { color: colors.textSecondary, fontSize: 13 },

    statsRow: { flexDirection: 'row' as const, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, marginBottom: 24, overflow: 'hidden' as const },
    statCard: { flex: 1, alignItems: 'center' as const, paddingVertical: 14 },
    statMid:  { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
    statNum:  { color: colors.textPrimary, fontSize: 18, fontWeight: '700' as const, marginBottom: 2 },
    statLabel:{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' as const },

    sectionLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' as const, letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
    sectionCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bgCard,
      marginBottom: 20,
      overflow: 'hidden' as const,
      shadowColor: colors.textPrimary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 8,
      elevation: 1,
    },

    statusRow:        { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 16 },
    statusIcon:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0 },
    statusIconEnabled:{ backgroundColor: colors.greenDim },
    statusIconOff:    { backgroundColor: colors.bgSecondary },
    statusInfo:       { flex: 1 },
    statusTitle:      { color: colors.textPrimary, fontSize: 15, fontWeight: '600' as const },
    statusSub:        { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    setupBtn:         { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, minWidth: 70, alignItems: 'center' as const },
    setupBtnText:     { color: colors.textInverse, fontSize: 13, fontWeight: '700' as const },
    manageBtn:        { borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
    manageBtnText:    { color: colors.textPrimary, fontSize: 13, fontWeight: '600' as const },

    bankHeader:      { minHeight: 64, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    bankHeaderTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' as const },
    addBankBtn:      { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.textPrimary, alignItems: 'center' as const, justifyContent: 'center' as const },
    bankItem:        { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    bankItemBorder:  { borderBottomWidth: 1, borderBottomColor: colors.border },
    bankIcon:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgSecondary, alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0 },
    bankInfo:        { flex: 1 },
    bankName:        { color: colors.textPrimary, fontSize: 15, fontWeight: '600' as const },
    bankSub:         { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    bankActions:     { flexDirection: 'row' as const, gap: 8 },
    bankActionBtn:   { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSecondary, alignItems: 'center' as const, justifyContent: 'center' as const },
    bankEmpty:       { paddingVertical: 20, alignItems: 'center' as const },
    bankEmptyText:   { color: colors.textSecondary, fontSize: 13 },

    recentHdr: { minHeight: 64, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 8, marginTop: 4 },
    viewAllText: { color: colors.primary, fontSize: 13, fontWeight: '600' as const },

    payoutRow:          { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    payoutRowBorder:    { borderBottomWidth: 1, borderBottomColor: colors.border },
    payoutIcon:         { width: 30, height: 30, borderRadius: 15, alignItems: 'center' as const, justifyContent: 'center' as const, flexShrink: 0 },
    payoutIconPending:  { backgroundColor: colors.primaryDim },
    payoutIconDone:     { backgroundColor: colors.greenDim },
    payoutInfo:         { flex: 1 },
    payoutType:         { color: colors.textPrimary, fontSize: 14, fontWeight: '600' as const },
    payoutDate:         { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    payoutAmount:       { color: colors.green, fontSize: 15, fontWeight: '700' as const },
    payoutAmountPending:{ color: colors.primary },

    actionBar:  { position: 'absolute' as const, bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 30, paddingTop: 12, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
    depositBtn: { height: 54, borderRadius: 27, backgroundColor: colors.primary, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const },
    depositBtnDisabled: { backgroundColor: colors.border },
    depositBtnText:     { color: colors.textInverse, fontSize: 15, fontWeight: '700' as const },
  }), [colors]);

  const { goBack } = useReturnNavigation('/(driver)/profile');
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [dataLoaded, setDataLoaded]       = useState(false);
  const spinValue                         = useRef(new Animated.Value(0)).current;
  const [summary, setSummary]             = useState<EarningsSummary>({ available: 0, pending: 0, lifetime: 0 });
  const [ridesCompleted, setRidesCompleted] = useState(0);
  const [averagePerRide, setAveragePerRide] = useState(0);
  const [depositing, setDepositing]       = useState(false);
  const [accountId, setAccountId]         = useState<string | null>(null);
  const [linking, setLinking]             = useState(false);
  const [showAddBankModal, setShowAddBankModal] = useState(false);
  const [recentPayouts, setRecentPayouts] = useState<Payout[]>([]);

  const {
    payoutStatus,
    earnings,
    addBankAccount: addBankAccountHook,
    removeBankAccount: removeBankAccountHook,
    setDefaultBankAccount: setDefaultBankAccountHook,
    refreshAll,
    loading: payoutsLoading,
  } = useDriverPayouts();

  async function load() {
    const user = firebaseAuth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in to view earnings.');
      setLoading(false);
      setDataLoaded(true);
      return;
    }

    const tStart = Date.now();
    setLoading(true);
    setDataLoaded(false);

    const firestorePromise = (async () => {
      try {
        const userRef = doc(firestore, 'drivers', user.uid);
        const [userDoc, ridesSnap] = await Promise.all([
          getDoc(userRef),
          getDocs(query(collection(firestore, 'confirmedRides'), where('driverId', '==', user.uid), where('status', '==', 'COMPLETED'))),
        ]);
        if (userDoc.exists()) { const data = userDoc.data(); if (data?.stripeAccountId) setAccountId(data.stripeAccountId); }
        setRidesCompleted(ridesSnap.size);
      } catch {}
    })();

    const refreshPromise = refreshAll();
    const payoutsPromise = (async () => {
      try { const r = await fetchPayouts(3); setRecentPayouts(r.payouts); } catch { setRecentPayouts([]); }
    })();

    try {
      await refreshPromise;
      setDataLoaded(true);
      await Promise.allSettled([firestorePromise, payoutsPromise]);
    } catch (e: any) {
      Alert.alert('Failed to load', e?.message || 'Could not load earnings');
      setDataLoaded(true);
    } finally {
      setLoading(false);
      if (__DEV__) console.log(`[Earnings] Load complete in ${Date.now() - tStart}ms`);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { return () => { spinValue.stopAnimation(); }; }, []);

  useEffect(() => {
    if (earnings) {
      setSummary({ available: earnings.available, pending: earnings.pending, lifetime: earnings.lifetime, lastPayoutAt: earnings.lastPayoutAt });
      const lifetimeAmount = earnings.lifetime ?? 0;
      if (ridesCompleted > 0 && lifetimeAmount > 0) setAveragePerRide(lifetimeAmount / ridesCompleted);
    }
  }, [earnings, ridesCompleted]);

  useEffect(() => {
    console.log('[Earnings] PayoutStatus updated:', payoutStatus);
    console.log('[Earnings] Bank accounts count:', bankAccounts.length);
  }, [payoutStatus]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') setTimeout(() => onRefresh(), 1000);
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub?.remove();
  }, []);

  const parseDate = (raw: any): Date | null => {
    if (raw == null) return null;
    let num: number | null = null;
    if (typeof raw === 'number') num = raw;
    else if (typeof raw === 'string' && /^\d+$/.test(raw)) num = Number(raw);
    if (num !== null) { if (num < 1e12) num *= 1000; return new Date(num); }
    try { const d = new Date(raw); return isNaN(d.getTime()) ? null : d; } catch { return null; }
  };

  const formatDate = (raw: any) => {
    const d = parseDate(raw);
    return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  };

  const getDisplayDate = (p: Payout) => formatDate(p.date) || formatDate(p.arrivalDate);

  const onRefresh = async () => {
    setRefreshing(true);
    Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 1000, useNativeDriver: true })).start();
    await load();
    spinValue.stopAnimation();
    spinValue.setValue(0);
    setRefreshing(false);
  };

  const handleInstantDeposit = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) { Alert.alert('Not signed in', 'Please sign in first.'); return; }
    if (!accountId) { Alert.alert('Set up payouts', 'Please set up your payout account first.'); return; }
    const grossDollars = summary.available;
    if (!grossDollars || grossDollars <= 0) { Alert.alert('No instant balance', 'You have no funds currently eligible for instant deposit.'); return; }
    const rideAlongFee  = grossDollars * 0.03;
    const estimatedNet  = grossDollars - rideAlongFee;
    Alert.alert(
      'Instant Deposit Fees',
      `Available Balance: $${grossDollars.toFixed(2)}\n\nFees:\n• RideAlong fee (3%): -$${rideAlongFee.toFixed(2)}\n\nEstimated amount to receive: $${estimatedNet.toFixed(2)}\n\nDo you want to proceed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: async () => {
          try {
            setDepositing(true);
            const res = await instantDeposit(accountId, grossDollars);
            if (res.ok) {
              try { await logActivity({ type: 'payout_initiated', entityType: 'payout', entityId: res.payoutId ?? null, metadata: { accountId, requestedGrossDollars: grossDollars, feePhase: 'deducted_server_side', payoutId: res.payoutId ?? null, message: res.message ?? null } }); } catch {}
              Alert.alert('Deposit requested', 'Your instant deposit is being processed.');
              await load();
            } else {
              try { await logActivity({ type: 'payout_failed', entityType: 'payout', entityId: res.payoutId ?? null, metadata: { accountId, attemptedGrossDollars: grossDollars, feePhase: 'deducted_server_side', payoutId: res.payoutId ?? null, message: res.message ?? null } }); } catch {}
              Alert.alert('Deposit failed', res.message || 'Unable to process instant deposit.');
            }
          } catch (e: any) {
            try { await logActivity({ type: 'payout_failed', entityType: 'payout', entityId: null, metadata: { accountId, requestedGrossDollars: grossDollars, error: e?.message ?? String(e) } }); } catch {}
            Alert.alert('Deposit error', e?.message || 'Could not process deposit');
          } finally { setDepositing(false); }
        } },
      ]
    );
  };

  const handleSetupPayouts = async () => {
    try {
      const user = firebaseAuth.currentUser;
      if (!user?.uid) { Alert.alert('Authentication Required', 'You must be logged in to set up payouts'); return; }
      const apiBase = getApiBaseUrl();
      if (/localhost|127\.0\.0\.1/.test(apiBase)) {
        Alert.alert('Development Mode Notice', 'API is set to localhost.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue Anyway', onPress: () => continueSetup() },
        ]);
        return;
      }
      await continueSetup();

      async function continueSetup() {
        try {
          setLinking(true);
          const baseUrl    = apiBase.replace('/api', '');
          const payload: any = { country: 'US', userId: user!.uid };
          if (user!.email) payload.email = user!.email;
          if (accountId)   payload.accountId = accountId;
          const { url, accountId: newAccountId } = await createOnboardingLink(payload);
          if (!accountId && newAccountId) {
            try { await setDoc(doc(firestore, 'drivers', user!.uid), { stripeAccountId: newAccountId }, { merge: true }); setAccountId(newAccountId); } catch {}
          }
          Alert.alert('Redirecting to Stripe', 'You will now be taken to Stripe\'s secure onboarding process.', [
            { text: 'Continue', onPress: async () => {
              try {
                await Linking.openURL(url);
                await logActivity({ type: 'payout_onboarding_started', entityType: 'driver_payout', entityId: user!.uid, metadata: { accountId: newAccountId || accountId, redirectUrl: url } });
              } catch (e: any) { Alert.alert('Unable to Open Browser', `Could not open the onboarding link.\n\nError: ${e?.message}`); }
            } },
            { text: 'Cancel', style: 'cancel' },
          ]);
        } catch (e: any) {
          let msg = 'Could not start payout setup. Please try again.';
          if (e?.message?.includes('Network request failed')) msg = 'Network connection failed. Please check your internet connection.';
          else if (e?.message?.includes('timeout')) msg = 'Request timed out. Please try again.';
          Alert.alert('Setup Failed', msg);
        } finally { setLinking(false); }
      }
    } catch { Alert.alert('Unexpected Error', 'An unexpected error occurred.'); setLinking(false); }
  };

  const handleManageAccount = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) { Alert.alert('Not signed in'); return; }
    if (!accountId) { Alert.alert('No account', 'Set up payouts first.'); return; }
    try { setLinking(true); const { url } = await createDashboardLink(user.uid); await Linking.openURL(url); }
    catch (e: any) { Alert.alert('Open dashboard failed', e?.message || 'Could not open dashboard'); }
    finally { setLinking(false); }
  };

  const handleAddBankAccount = async (payload: AddBankAccountPayload) => {
    const result = await addBankAccountHook(payload);
    if (result.success) { Alert.alert('Success', 'Bank account added successfully!'); setShowAddBankModal(false); await onRefresh(); }
    else Alert.alert('Error', result.error || 'Failed to add bank account');
  };

  const handleRemoveBankAccount = async (bankAccount: BankAccount) => {
    Alert.alert(
      'Manage Payout Methods',
      `To remove ${bankAccount.bankName} ending in ${bankAccount.last4}, we'll open your Stripe dashboard.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Dashboard', onPress: async () => {
          try {
            setLinking(true);
            const user = firebaseAuth.currentUser;
            if (!user) { Alert.alert('Error', 'Please sign in first'); return; }
            const apiUrl = getApiBaseUrl();
            const token  = await user.getIdToken();
            const response = await fetch(`${apiUrl}/connect/dashboard-link`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ userId: user.uid }),
            });
            if (!response.ok) { const e = await response.json(); throw new Error(e.error || 'Failed to create dashboard link'); }
            const { url } = await response.json();
            if (await Linking.canOpenURL(url)) {
              await Linking.openURL(url);
              Alert.alert('Dashboard Opened', 'After managing your payout methods, return here and refresh.');
            } else Alert.alert('Error', 'Cannot open dashboard link');
          } catch (e: any) { Alert.alert('Error', e.message || 'Failed to open dashboard'); }
          finally { setLinking(false); }
        } },
      ]
    );
  };

  const handleSetDefaultBankAccount = async (bankAccount: BankAccount) => {
    const result = await setDefaultBankAccountHook(bankAccount.id);
    if (result.success) { Alert.alert('Success', 'Default bank account updated'); await onRefresh(); }
    else Alert.alert('Error', result.error || 'Failed to set default bank account');
  };

  const bankAccounts = payoutStatus?.bankAccounts || [];
  const isPayoutsEnabled = !!payoutStatus?.payoutsEnabled;
  const availableBalance = Math.max(0, summary.available);

  return (
    <View style={s.root}>
      <StatusBar barStyle={colors.statusBar} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>{!dataLoaded ? (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
{/* Header */}
        <View style={s.hdr}>
          <TouchableOpacity style={s.backBtn} onPress={goBack}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.hdrTitle}>Earnings</Text>
          <TouchableOpacity style={s.backBtn} onPress={onRefresh} disabled={refreshing}>
            <Ionicons name="refresh-outline" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
            <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={s.loadingText}>Loading your earnings…</Text>
          </View>
          </ScrollView>
        ) : (
          <>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={s.content}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
            >
{/* Header */}
        <View style={s.hdr}>
          <TouchableOpacity style={s.backBtn} onPress={goBack}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.hdrTitle}>Earnings</Text>
          <TouchableOpacity style={s.backBtn} onPress={onRefresh} disabled={refreshing}>
            <Ionicons name="refresh-outline" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

              {/* Big earnings hero */}
              <View style={s.heroBanner}>
                <Text style={s.heroLabel}>LIFETIME EARNED</Text>
                <Text style={s.heroAmount}>${(summary.lifetime ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                {ridesCompleted > 0 && (
                  <Text style={s.heroSub}>{ridesCompleted} rides · avg ${averagePerRide.toFixed(2)}/ride</Text>
                )}
              </View>

              {/* Stats row */}
              <View style={s.statsRow}>
                <View style={s.statCard}>
                  <Text style={[s.statNum, { color: colors.primary }]}>${availableBalance.toFixed(2)}</Text>
                  <Text style={s.statLabel}>Available</Text>
                </View>
                <View style={[s.statCard, s.statMid]}>
                  <Text style={[s.statNum]}>${(summary.pending ?? 0).toFixed(2)}</Text>
                  <Text style={s.statLabel}>Pending</Text>
                </View>
                <View style={s.statCard}>
                  <Text style={s.statNum}>{ridesCompleted}</Text>
                  <Text style={s.statLabel}>Rides</Text>
                </View>
              </View>

              {/* Payout status */}
              <Text style={s.sectionLabel}>PAYOUT STATUS</Text>
              <View style={s.sectionCard}>
                <View style={s.statusRow}>
                  <View style={[s.statusIcon, isPayoutsEnabled ? s.statusIconEnabled : s.statusIconOff]}>
                    <Ionicons name={isPayoutsEnabled ? 'checkmark' : 'close'} size={16} color={isPayoutsEnabled ? colors.green : colors.textSecondary} />
                  </View>
                  <View style={s.statusInfo}>
                    <Text style={s.statusTitle}>{isPayoutsEnabled ? 'Payouts enabled' : 'Payouts not set up'}</Text>
                    <Text style={s.statusSub}>{isPayoutsEnabled ? 'Ready to receive transfers' : 'Complete Stripe onboarding to get paid'}</Text>
                  </View>
                  {!isPayoutsEnabled ? (
                    <TouchableOpacity style={s.setupBtn} onPress={handleSetupPayouts} disabled={linking}>
                      {linking ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.setupBtnText}>Set up</Text>}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={s.manageBtn} onPress={handleManageAccount} disabled={linking}>
                      <Text style={s.manageBtnText}>Manage</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Bank accounts */}
              <Text style={s.sectionLabel}>BANK ACCOUNTS</Text>
              <View style={s.sectionCard}>
                <View style={s.bankHeader}>
                  <Text style={s.bankHeaderTitle}>Connected accounts</Text>
                  <TouchableOpacity
                    style={s.addBankBtn}
                    onPress={() => setShowAddBankModal(true)}
                  >
                    <Ionicons name="add" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
                {bankAccounts.length > 0 ? (
                  bankAccounts.map((account, idx) => (
                    <View key={account.id} style={[s.bankItem, idx < bankAccounts.length - 1 && s.bankItemBorder]}>
                      <View style={s.bankIcon}>
                        <Ionicons name="business-outline" size={18} color={colors.textSecondary} />
                      </View>
                      <View style={s.bankInfo}>
                        <Text style={s.bankName}>{account.bankName}</Text>
                        <Text style={s.bankSub}>
                          {account.accountType.charAt(0).toUpperCase() + account.accountType.slice(1)} ••••{account.last4}
                          {account.isDefault ? ' · Default' : ''}
                        </Text>
                      </View>
                      <View style={s.bankActions}>
                        {!account.isDefault && (
                          <TouchableOpacity style={s.bankActionBtn} onPress={() => handleSetDefaultBankAccount(account)}>
                            <Ionicons name="star-outline" size={16} color={colors.primary} />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={s.bankActionBtn} onPress={() => handleRemoveBankAccount(account)}>
                          <Ionicons name="trash-outline" size={16} color={colors.red} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                ) : (
                  <View style={s.bankEmpty}>
                    <Text style={s.bankEmptyText}>No bank accounts connected</Text>
                  </View>
                )}
              </View>

              {/* Recent payouts */}
              <View style={s.recentHdr}>
                <Text style={s.sectionLabel}>RECENT PAYOUTS</Text>
                <TouchableOpacity onPress={() => router.push('/settings/payout-history' as any)}>
                  <Text style={s.viewAllText}>View all</Text>
                </TouchableOpacity>
              </View>
              <View style={s.sectionCard}>
                {recentPayouts.length > 0 ? (
                  recentPayouts.map((payout, idx) => {
                    const isPending = payout.status === 'pending' || payout.status === 'in_transit';
                    return (
                      <View key={payout.id} style={[s.payoutRow, idx < recentPayouts.length - 1 && s.payoutRowBorder]}>
                        <View style={[s.payoutIcon, isPending ? s.payoutIconPending : s.payoutIconDone]}>
                          <Ionicons name={isPending ? 'time-outline' : 'checkmark'} size={14} color={isPending ? colors.primary : colors.green} />
                        </View>
                        <View style={s.payoutInfo}>
                          <Text style={s.payoutType}>{payout.method === 'instant' ? 'Instant Deposit' : 'Standard Payout'}</Text>
                          {getDisplayDate(payout) && <Text style={s.payoutDate}>{getDisplayDate(payout)}</Text>}
                        </View>
                        <Text style={[s.payoutAmount, isPending && s.payoutAmountPending]}>+${payout.amount.toFixed(2)}</Text>
                      </View>
                    );
                  })
                ) : (
                  <View style={s.bankEmpty}>
                    <Text style={s.bankEmptyText}>No recent payouts</Text>
                  </View>
                )}
              </View>

              <View style={{ height: 120 }} />
            </ScrollView>

            {/* Action bar */}
            <View style={s.actionBar}>
              <TouchableOpacity
                style={[s.depositBtn, (!availableBalance || depositing || !isPayoutsEnabled) && s.depositBtnDisabled]}
                onPress={handleInstantDeposit}
                disabled={!availableBalance || depositing || !isPayoutsEnabled}
                activeOpacity={0.85}
              >
                {depositing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="flash" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={s.depositBtnText}>
                      {availableBalance > 0 ? `Instant Deposit · $${availableBalance.toFixed(2)}` : 'No available balance'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        <AddBankAccountModal
          visible={showAddBankModal}
          onClose={() => setShowAddBankModal(false)}
          onSubmit={handleAddBankAccount}
          loading={payoutsLoading}
        />
      </SafeAreaView>
    </View>
  );
}
