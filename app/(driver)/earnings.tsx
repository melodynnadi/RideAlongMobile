import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, RefreshControl, TouchableOpacity, Linking, Animated, AppState, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, DollarSign, CreditCard, Clock, Plus, Trash2, Star, Building2, RefreshCw } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTheme } from '@/hooks/useTheme';
import { useDriverPayouts } from '@/hooks/useDriverPayouts';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AddBankAccountModal } from '@/components/AddBankAccountModal';
import type { AddBankAccountPayload, BankAccount } from '@/types';
import { createDashboardLink, createOnboardingLink, instantDeposit, fetchPayouts, type Payout } from '../src/services/payouts';
import { logActivity } from '@/src/services/activity';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { doc, setDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

type EarningsSummary = {
  available: number;
  pending: number;
  lifetime?: number | null;
  lastPayoutAt?: string | null;
};

export default function EarningsScreen() {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const spinValue = useRef(new Animated.Value(0)).current;
  const [summary, setSummary] = useState<EarningsSummary>({ available: 0, pending: 0, lifetime: 0 });
  const [ridesCompleted, setRidesCompleted] = useState(0);
  const [averagePerRide, setAveragePerRide] = useState(0);
  const [depositing, setDepositing] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [showAddBankModal, setShowAddBankModal] = useState(false);
  const [recentPayouts, setRecentPayouts] = useState<Payout[]>([]);

  // Use the new driver payouts hook
  const {
    payoutStatus,
    earnings,
    getPayoutStatus,
    addBankAccount: addBankAccountHook,
    removeBankAccount: removeBankAccountHook,
    setDefaultBankAccount: setDefaultBankAccountHook,
    getEarningsSummary,
    refreshAll,
    loading: payoutsLoading,
    error: payoutsError,
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

    // Firestore user + rides query in parallel
    const firestorePromise = (async () => {
      try {
        const userRef = doc(firestore, 'users', user.uid);
        const [userDoc, ridesSnap] = await Promise.all([
          getDoc(userRef),
          getDocs(query(
            collection(firestore, 'confirmedRides'),
            where('driverId', '==', user.uid),
            where('status', '==', 'COMPLETED')
          ))
        ]);
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data?.stripeAccountId) setAccountId(data.stripeAccountId);
        }
        setRidesCompleted(ridesSnap.size);
      } catch {}
    })();

    // Earnings + payout status (hook) and recent payouts in parallel
    const refreshPromise = refreshAll();
    const payoutsPromise = (async () => {
      try {
        const payoutsResult = await fetchPayouts(3);
        setRecentPayouts(payoutsResult.payouts);
      } catch { setRecentPayouts([]); }
    })();

    // Await earnings first for faster partial render; others can settle
    try {
      await refreshPromise; // summary + payoutStatus populated via hook
      setDataLoaded(true); // allow UI to render core sections early
      await Promise.allSettled([firestorePromise, payoutsPromise]);
    } catch (e: any) {
      Alert.alert('Failed to load', e?.message || 'Could not load earnings');
      setDataLoaded(true);
    } finally {
      setLoading(false);
      const elapsed = Date.now() - tStart;
      if (__DEV__) console.log(`[Earnings] Load complete in ${elapsed}ms`);
    }
  }

  useEffect(() => { load(); }, []);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      spinValue.stopAnimation();
    };
  }, []);

  // Update summary when earnings change from hook
  useEffect(() => {
    if (earnings) {
      setSummary({
        available: earnings.available,
        pending: earnings.pending,
        lifetime: earnings.lifetime,
        lastPayoutAt: earnings.lastPayoutAt,
      });
      
      // Calculate average per ride
      const lifetimeAmount = earnings.lifetime ?? 0;
      if (ridesCompleted > 0 && lifetimeAmount > 0) {
        setAveragePerRide(lifetimeAmount / ridesCompleted);
      }
    }
  }, [earnings, ridesCompleted]);

  // Shared date parsing similar to payout-history screen
  const parseDate = (raw: any): Date | null => {
    if (raw === null || raw === undefined) return null;
    let num: number | null = null;
    if (typeof raw === 'number') num = raw;
    else if (typeof raw === 'string' && /^\d+$/.test(raw)) num = Number(raw);
    if (num !== null) {
      if (num < 1e12) num = num * 1000; // treat as seconds
      return new Date(num);
    }
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return null;
      return d;
    } catch {
      return null;
    }
  };

  const formatDate = (raw: any) => {
    const d = parseDate(raw);
    if (!d) return null;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getDisplayDate = (payout: Payout) => {
    // Prefer original payout date; if invalid use arrivalDate as fallback
    return formatDate(payout.date) || formatDate(payout.arrivalDate);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    
    // Start spinning animation
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      })
    ).start();
    
    await load();
    
    // Stop spinning animation
    spinValue.stopAnimation();
    spinValue.setValue(0);
    setRefreshing(false);
  };

  const handleInstantDeposit = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Please sign in first.');
      return;
    }
    console.log('[Instant Deposit] User ID:', user.uid);
    console.log('[Instant Deposit] Account ID:', accountId);
    if (!accountId) {
      Alert.alert('Set up payouts', 'Please set up your payout account first.');
      return;
    }
    
    // Available balance from Stripe is GROSS instant-eligible amount (before RideAlong 3% + Stripe 1% instant fees).
    const grossDollars = summary.available;
    if (!grossDollars || grossDollars <= 0) {
      Alert.alert('No instant balance', 'You have no funds currently eligible for instant deposit.');
      return;
    }
    
    // Calculate fees for display
    const rideAlongFee = grossDollars * 0.03;
    const estimatedNet = grossDollars - rideAlongFee;
    
    // Show fee disclosure alert
    Alert.alert(
      'Instant Deposit Fees',
      `Available Balance: $${grossDollars.toFixed(2)}\n\nFees:\n• RideAlong fee (3%): -$${rideAlongFee.toFixed(2)}\n\nEstimated amount to receive: $${estimatedNet.toFixed(2)}\n\nDo you want to proceed?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => console.log('[Instant Deposit] User cancelled')
        },
        {
          text: 'Continue',
          onPress: async () => {
            try {
              setDepositing(true);
              console.log('[Instant Deposit] Requesting instant deposit for account:', accountId, 'grossDollars:', grossDollars);
              const res = await instantDeposit(accountId, grossDollars);
              if (res.ok) {
                try {
                  await logActivity({
                    type: 'payout_initiated',
                    entityType: 'payout',
                    entityId: res.payoutId ?? null,
                    metadata: {
                      accountId,
                      requestedGrossDollars: grossDollars,
                      feePhase: 'deducted_server_side',
                      payoutId: res.payoutId ?? null,
                      message: res.message ?? null,
                    },
                  });
                } catch {}
                Alert.alert('Deposit requested', 'Your instant deposit is being processed.');
                await load();
              } else {
                try {
                  await logActivity({
                    type: 'payout_failed',
                    entityType: 'payout',
                    entityId: res.payoutId ?? null,
                    metadata: {
                      accountId,
                      attemptedGrossDollars: grossDollars,
                      feePhase: 'deducted_server_side',
                      payoutId: res.payoutId ?? null,
                      message: res.message ?? null,
                    },
                  });
                } catch {}
                Alert.alert('Deposit failed', res.message || 'Unable to process instant deposit.');
              }
            } catch (e: any) {
              try {
                await logActivity({
                  type: 'payout_failed',
                  entityType: 'payout',
                  entityId: null,
                  metadata: {
                    accountId,
                    requestedGrossDollars: grossDollars,
                    error: e?.message ?? String(e),
                  },
                });
              } catch {}
              Alert.alert('Deposit error', e?.message || 'Could not process deposit');
            } finally {
              setDepositing(false);
            }
          }
        }
      ]
    );
  };

  const handleSetupPayouts = async () => {
    try {
      // Step 1: Authentication Check
      const user = firebaseAuth.currentUser;
      if (!user || !user.uid) {
        Alert.alert('Authentication Required', 'You must be logged in to set up payouts');
        return;
      }

      console.log('[Payouts] Starting setup for user:', user.uid);

      // Step 2: API Call Preparation
      const apiBase = getApiBaseUrl();
      
      // Check if API is reachable (localhost check for mobile development)
      if (/localhost|127\.0\.0\.1/.test(apiBase)) {
        Alert.alert(
          'Development Mode Notice',
          'API is set to localhost. On a physical device, ensure EXPO_PUBLIC_API_URL points to your computer\'s IP address (e.g., http://192.168.1.100:3001) or use an ngrok tunnel.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue Anyway', onPress: () => continueSetup() }
          ]
        );
        return;
      }

      await continueSetup();

      async function continueSetup() {
        try {
          setLinking(true);

          // Collect user data for onboarding (user is already verified as non-null above)
          const userEmail = user!.email;
          const userName = user!.displayName || 'Driver';

          console.log('[Payouts] User data prepared:', {
            userId: user!.uid,
            email: userEmail,
            name: userName
          });

          // Prepare return URLs (where user comes back after Stripe onboarding)
          // In a mobile app, we'll use deep links or the current screen
          const baseUrl = apiBase.replace('/api', ''); // Remove /api if present
          const returnUrl = `${baseUrl}/connect/return`; // Server will handle redirect
          const refreshUrl = `${baseUrl}/connect/refresh`;

          // Step 3: Server API Call
          // Prepare payload matching the server's expected format
          const onboardingPayload: {
            accountId?: string;
            email?: string;
            country?: string;
            userId?: string;
          } = {
            country: 'US', // Default country
            userId: user!.uid // Include userId for dev mode authentication
          };

          // Add optional fields
          if (userEmail) {
            onboardingPayload.email = userEmail;
          }
          
          if (accountId) {
            onboardingPayload.accountId = accountId;
          }

          console.log('[Payouts] Making onboarding request:', onboardingPayload);

          const { url, accountId: newAccountId } = await createOnboardingLink(onboardingPayload);

          // Store account ID if it's new
          if (!accountId && newAccountId) {
            console.log('[Payouts] Storing new account ID:', newAccountId);
            const userRef = doc(firestore, 'users', user!.uid);
            try {
              await setDoc(userRef, { stripeAccountId: newAccountId }, { merge: true });
              setAccountId(newAccountId);
            } catch (firestoreError) {
              console.warn('[Payouts] Failed to store account ID in Firestore:', firestoreError);
              // Continue anyway - account ID is stored on server side
            }
          }

          console.log('[Payouts] Onboarding URL received:', url);

          // Step 4: Redirect to Stripe
          // Show a brief message before redirecting
          Alert.alert(
            'Redirecting to Stripe',
            'You will now be taken to Stripe\'s secure onboarding process to set up your payout account. This includes:\n\n• Personal information verification\n• Bank account details\n• Identity verification\n• Tax information\n\nAfter completion, you\'ll return to this app.',
            [
              {
                text: 'Continue',
                onPress: async () => {
                  try {
                    await Linking.openURL(url);
                    
                    // Log successful redirect
                    await logActivity({
                      type: 'payout_onboarding_started',
                      entityType: 'driver_payout',
                      entityId: user!.uid,
                      metadata: {
                        accountId: newAccountId || accountId,
                        redirectUrl: url
                      }
                    });
                  } catch (linkingError: any) {
                    console.error('[Payouts] Failed to open onboarding URL:', linkingError);
                    Alert.alert(
                      'Unable to Open Browser',
                      `Could not open the onboarding link. Please try again or contact support.\n\nError: ${linkingError?.message}`
                    );
                  }
                }
              },
              { text: 'Cancel', style: 'cancel' }
            ]
          );

        } catch (apiError: any) {
          console.error('[Payouts] API call failed:', apiError);
          
          // Handle specific error types
          let errorMessage = 'Could not start payout setup. Please try again.';
          
          if (apiError?.message?.includes('Network request failed')) {
            errorMessage = 'Network connection failed. Please check your internet connection and try again.';
          } else if (apiError?.message?.includes('timeout')) {
            errorMessage = 'Request timed out. Please check your connection and try again.';
          } else if (apiError?.message?.includes('Failed to start onboarding')) {
            errorMessage = 'Server error occurred while starting onboarding. Please try again or contact support.';
          }

          Alert.alert('Setup Failed', errorMessage);
        } finally {
          setLinking(false);
        }
      }

    } catch (error: any) {
      console.error('[Payouts] Unexpected error in handleSetupPayouts:', error);
      Alert.alert('Unexpected Error', 'An unexpected error occurred. Please try again.');
      setLinking(false);
    }
  };

  const handleManageAccount = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) { Alert.alert('Not signed in', 'Please sign in first.'); return; }
    if (!accountId) { Alert.alert('No account', 'Set up payouts first.'); return; }
    try {
      setLinking(true);
      // API expects userId; accountId is derived server-side
      const { url } = await createDashboardLink(user.uid);
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Open dashboard failed', e?.message || 'Could not open dashboard');
    } finally { setLinking(false); }
  };

  const handleAddBankAccount = async (payload: AddBankAccountPayload) => {
    const result = await addBankAccountHook(payload);
    if (result.success) {
      Alert.alert('Success', 'Bank account added successfully!');
      setShowAddBankModal(false);
      await onRefresh();
    } else {
      Alert.alert('Error', result.error || 'Failed to add bank account');
    }
  };

  const handleRemoveBankAccount = async (bankAccount: BankAccount) => {
    Alert.alert(
      'Manage Payout Methods',
      `To remove ${bankAccount.bankName} ending in ${bankAccount.last4}, we'll open your secure Stripe dashboard where you can safely manage your payout methods.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Dashboard',
          onPress: async () => {
            try {
              setLinking(true);
              const user = firebaseAuth.currentUser;
              if (!user) {
                Alert.alert('Error', 'Please sign in first');
                return;
              }

              // Get dashboard link from API
              const apiUrl = getApiBaseUrl();
              const token = await user.getIdToken();
              const response = await fetch(`${apiUrl}/connect/dashboard-link`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ userId: user.uid }),
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create dashboard link');
              }

              const { url } = await response.json();
              
              // Open the Stripe dashboard in browser
              const supported = await Linking.canOpenURL(url);
              if (supported) {
                await Linking.openURL(url);
                Alert.alert(
                  'Dashboard Opened',
                  'After managing your payout methods in Stripe, return here and refresh to see the updates.',
                  [{ text: 'OK' }]
                );
              } else {
                Alert.alert('Error', 'Cannot open dashboard link');
              }
            } catch (error: any) {
              console.error('Dashboard link error:', error);
              Alert.alert('Error', error.message || 'Failed to open dashboard');
            } finally {
              setLinking(false);
            }
          },
        },
      ]
    );
  };

  const handleSetDefaultBankAccount = async (bankAccount: BankAccount) => {
    const result = await setDefaultBankAccountHook(bankAccount.id);
    if (result.success) {
      Alert.alert('Success', 'Default bank account updated');
      await onRefresh();
    } else {
      Alert.alert('Error', result.error || 'Failed to set default bank account');
    }
  };

  const bankAccounts = payoutStatus?.bankAccounts || [];
  
  // Debug log when payoutStatus or bankAccounts change
  useEffect(() => {
    console.log('[Earnings] PayoutStatus updated:', payoutStatus);
    console.log('[Earnings] Bank accounts count:', bankAccounts.length);
    console.log('[Earnings] Bank accounts:', bankAccounts);
  }, [payoutStatus, bankAccounts]);

  // Listen for app state changes to refresh when returning from Stripe onboarding
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        // User returned to the app - they might be coming back from Stripe onboarding
        // Refresh the payout status to check if onboarding was completed
        console.log('[Earnings] App became active - refreshing payout status');
        setTimeout(() => {
          // Use a small delay to ensure any background processes finish
          onRefresh();
        }, 1000);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription?.remove();
    };
  }, [onRefresh]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}> 
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>Earnings</Text>
          <Text style={styles.headerSubtitle}>Manage your earnings and cash out</Text>
        </View>
      </View>

      {!dataLoaded ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.secondary }]}>Loading your earnings...</Text>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
          >
        {/* Earnings Overview Title */}
        <Text style={[styles.sectionHeading, { color: theme.colors.secondary }]}>Earnings Overview</Text>
        
        {/* First Row: Total Earnings and Available Balance */}
        <View style={styles.row}>
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <DollarSign size={20} color="#10B981" />
              <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>Total Earnings</Text>
            </View>
            <Text style={[styles.amount, { color: theme.colors.secondary }]}>${(summary.lifetime ?? 0).toFixed(2)}</Text>
            <Text style={styles.subtleText}>All time</Text>
          </Card>
          
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <CreditCard size={20} color="#F97316" />
              <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>Available Balance</Text>
            </View>
            <Text style={[styles.amount, { color: theme.colors.secondary }]}>${Math.max(0, summary.available).toFixed(2)}</Text>
            <Text style={styles.subtleText}>Ready for instant deposit</Text>
            {summary.available > 0 && (
              <TouchableOpacity 
                style={[styles.instantDepositBtn, { backgroundColor: '#F97316' }]}
                onPress={handleInstantDeposit}
              >
                <Text style={styles.instantDepositText}>⚡ Instant Deposit</Text>
              </TouchableOpacity>
            )}
          </Card>
        </View>

        {/* Second Row: Rides Completed and Average Per Ride */}
        <View style={styles.row}>
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Clock size={20} color="#0EA5E9" />
              <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>Rides Completed</Text>
            </View>
            <Text style={[styles.amount, { color: theme.colors.secondary }]}>{ridesCompleted}</Text>
            <Text style={styles.subtleText}>All time</Text>
          </Card>
          
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <DollarSign size={20} color="#EAB308" />
              <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>Average Per Ride</Text>
            </View>
            <Text style={[styles.amount, { color: theme.colors.secondary }]}>${averagePerRide.toFixed(2)}</Text>
            <Text style={styles.subtleText}>All time</Text>
          </Card>
        </View>

        {/* Payout Methods Section */}
        <Text style={[styles.sectionHeading, { color: theme.colors.secondary, marginTop: 10 }]}>Payout Methods</Text>
        <Text style={[styles.sectionSubtitle, { color: '#6B7280', marginTop: -10 }]}>Manage your bank accounts and payment methods</Text>

        {/* Payouts Status Card */}
        <Card style={[styles.sectionCard, { width: '100%', marginTop: 10 }]}>
          <View style={styles.payoutsStatusContainer}>
            <View style={styles.payoutsStatusContent}>
              <View style={[styles.statusIcon, { backgroundColor: payoutStatus?.payoutsEnabled ? '#10B981' : '#6B7280' }]}>
                <Text style={styles.statusCheckmark}>✓</Text>
              </View>
              <View style={styles.payoutsStatusInfo}>
                <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>Payouts Status</Text>
                <Text style={[styles.payoutsStatusText, { color: payoutStatus?.payoutsEnabled ? '#10B981' : '#6B7280' }]}>
                  {payoutStatus?.payoutsEnabled ? 'Payouts enabled ✓' : 'Payouts not enabled'}
                </Text>
              </View>
              <View style={styles.payoutsStatusActions}>
                {!payoutStatus?.payoutsEnabled && (
                  <TouchableOpacity
                    style={[styles.setupButton, { backgroundColor: theme.colors.primary }]}
                    onPress={handleSetupPayouts}
                    disabled={linking}
                  >
                    <Text style={styles.setupButtonText}>Set up</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.refreshButton, refreshing && styles.refreshButtonLoading]}
                  onPress={onRefresh}
                  disabled={refreshing}
                >
                  <Animated.View
                    style={{
                      transform: [{
                        rotate: spinValue.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg']
                        })
                      }]
                    }}
                  >
                    <RefreshCw 
                      size={18} 
                      color={refreshing ? "#3B82F6" : "#64748B"}
                    />
                  </Animated.View>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Card>

        {/* Bank Accounts Section */}
        <Card style={[styles.sectionCard, { width: '100%', marginTop: 16 }]}>
          <View style={styles.bankAccountsHeader}>
            <View style={styles.sectionHeader}>
              <Building2 size={20} color={theme.colors.primary} />
              <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>Bank Accounts</Text>
            </View>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: theme.colors.primary }]}
              onPress={() => setShowAddBankModal(true)}
            >
              <Plus size={20} color="white" />
            </TouchableOpacity>
          </View>
          
          {bankAccounts.length > 0 ? (
            <View style={styles.bankAccountsList}>
              {bankAccounts.map((account) => (
                <View key={account.id} style={styles.bankAccountItem}>
                  <View style={styles.bankAccountInfo}>
                    <Text style={[styles.bankName, { color: theme.colors.secondary }]}>
                      {account.bankName}
                    </Text>
                    <Text style={styles.accountDetails}>
                      {account.accountType.charAt(0).toUpperCase() + account.accountType.slice(1)} ••••{account.last4}
                    </Text>
                    {account.isDefault && (
                      <View style={styles.defaultBadge}>
                        <Star size={12} color="#EAB308" fill="#EAB308" />
                        <Text style={styles.defaultText}>Default</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.bankAccountActions}>
                    {!account.isDefault && (
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleSetDefaultBankAccount(account)}
                      >
                        <Star size={18} color={theme.colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => handleRemoveBankAccount(account)}
                    >
                      <Trash2 size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.noBankAccounts}>No bank accounts connected</Text>
          )}
        </Card>

        {/* Recent Payouts */}
        <Card style={[styles.sectionCard, { width: '100%', marginTop: 16, marginBottom: 20 }]}> 
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[styles.infoTitle, { color: theme.colors.secondary }]}>Recent Payouts</Text>
            <TouchableOpacity onPress={() => router.push('/payout-history')}>
              <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>View All</Text>
            </TouchableOpacity>
          </View>
          
          <View style={{ gap: 12 }}>
            {recentPayouts.length > 0 ? (
              recentPayouts.map((payout) => (
                <View key={payout.id} style={{ padding: 12, backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.secondary }}>
                        {payout.method === 'instant' ? 'Instant Deposit' : 'Standard Payout'}
                      </Text>
                      {getDisplayDate(payout) && (
                        <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                          {getDisplayDate(payout)!}
                        </Text>
                      )}
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#10B981' }}>
                      +${payout.amount.toFixed(2)}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={{ padding: 24, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center' }}>
                  No recent payouts
                </Text>
              </View>
            )}
          </View>
        </Card>
      </ScrollView>

      {/* Action bar */}
      <View style={styles.actionBar}>
        <Button
          variant="primary"
          fullWidth
          loading={loading || depositing}
          disabled={summary.available <= 0 || depositing || !payoutStatus?.payoutsEnabled}
          onPress={handleInstantDeposit}
          style={[styles.depositBtn, { backgroundColor: summary.available > 0 ? theme.colors.primary : '#F3F4F6' }]}
        >
          <Text style={[styles.depositBtnText, { color: summary.available > 0 ? theme.colors.text : '#111827' }]}>
            {summary.available > 0 ? `Instant deposit (gross $${Math.max(0, summary.available).toFixed(2)})` : 'No available balance'}
          </Text>
        </Button>
      </View>
        </>
      )}

      {/* Add Bank Account Modal */}
      <AddBankAccountModal
        visible={showAddBankModal}
        onClose={() => setShowAddBankModal(false)}
        onSubmit={handleAddBankAccount}
        loading={payoutsLoading}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 2 },
  headerSubtitle: { fontSize: 14, color: '#64748B' },
  content: { flex: 1, paddingHorizontal: 16 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  sectionHeading: { fontSize: 20, fontWeight: '700', marginBottom: 15, marginTop: 8 },
  sectionSubtitle: { fontSize: 14, color: '#6B7280', marginBottom: 12 },
  sectionCard: { 
    backgroundColor: 'white', 
    padding: 16, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#E2E8F0', 
    flex: 1,
    marginBottom: 0,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  subtleText: { fontSize: 12, color: '#64748B', marginTop: 4 },
  amount: { fontSize: 28, fontWeight: '800' },
  note: { marginTop: 8, fontSize: 12, color: '#64748B' },
  infoTitle: { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  infoText: { fontSize: 14, color: '#64748B', marginBottom: 4 },
  actionBar: { 
    flexDirection: 'row', 
    padding: 16, 
    gap: 12, 
    backgroundColor: 'white', 
    borderTopWidth: 1, 
    borderTopColor: '#E2E8F0' 
  },
  depositBtn: { flex: 1 },
  depositBtnText: { fontSize: 16, fontWeight: '700' },
  instantDepositBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  instantDepositText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  
  // Bank Accounts Styles
  bankAccountsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bankAccountsList: {
    gap: 12,
  },
  bankAccountItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  bankAccountInfo: {
    flex: 1,
  },
  bankName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  accountDetails: {
    fontSize: 14,
    color: '#64748B',
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  defaultText: {
    fontSize: 12,
    color: '#EAB308',
    fontWeight: '600',
  },
  bankAccountActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noBankAccounts: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    paddingVertical: 16,
  },
  
  // Payouts Status Styles
  payoutsStatusContainer: {
    // No additional styling needed
  },
  payoutsStatusContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  payoutsStatusInfo: {
    flex: 1,
  },
  payoutsStatusActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusCheckmark: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  payoutsStatusText: {
    fontSize: 14,
    marginTop: 2,
  },
  setupButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  setupButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshButtonLoading: {
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
  },
  refreshButtonText: {
    fontSize: 14,
    color: '#64748B',
  },
});
