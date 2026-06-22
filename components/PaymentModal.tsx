import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { Check, CreditCard, ShieldCheck, Smartphone, X } from 'lucide-react-native';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { computeTotals } from '@/utils/fees';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore';
import { useStripe, isPlatformPaySupported } from '@/components/platform/stripe';

export type PaymentModalProps = {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  driverId: string | null;
  baseFare: number;
  onPaymentSuccess?: (paymentIntentId: string) => Promise<void>;
};

export function PaymentModal({ visible, onClose, rideId, driverId, baseFare, onPaymentSuccess }: PaymentModalProps) {
  const riderId = firebaseAuth.currentUser?.uid ?? null;
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Payment flow bypassed for now; keep minimal state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'apple' | null>(null);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<{ id: string; brand: string; last4: string; isDefault?: boolean }[]>([]);
  const [appleSupported, setAppleSupported] = useState(false);
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null);
  const { confirmPayment, confirmPlatformPayPayment } = useStripe();
  const loadKeyRef = useRef<string | null>(null);

  // Check if Apple Pay is supported
  useEffect(() => {
    if (Platform.OS === 'ios' && visible) {
      isPlatformPaySupported().then((supported) => {
        setAppleSupported(supported);
      }).catch(() => setAppleSupported(false));
    } else {
      setAppleSupported(false);
    }
  }, [visible]);

  const totals = useMemo(() => computeTotals(baseFare), [baseFare]);
  const baseUrl = getApiBaseUrl();
  const log = (...args: any[]) => {
    try {
      console.log('[PaymentModal]', ...args);
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    async function loadPaymentUI() {
      if (!visible) {
        loadKeyRef.current = null;
        return;
      }
      setErrorMsg(null);
      if (!riderId) {
        Alert.alert('Sign in required', 'You need to be signed in to request a ride.');
        onClose();
        return;
      }
      // Debounce repeated fetches while modal is open; only fetch when riderId or
      // visibility changes (fresh open), not on unrelated parent re-renders.
      const key = `open:${visible}|rider:${riderId}`;
      if (loadKeyRef.current === key) {
        return;
      }
      loadKeyRef.current = key;
      try {
        setCreating(true);
        const userRef = doc(firestore, 'riders', riderId);
        const applyCards = (cards: { id: string; brand: string; last4: string; isDefault?: boolean }[]) => {
          if (cancelled) return;
          setSavedCards(cards);
          const def = cards.find((x) => x.isDefault) || cards[0];
          if (def) {
            setSelectedMethod('card');
            setSelectedPaymentMethodId(def.id);
          } else {
            setSelectedMethod(null);
            setSelectedPaymentMethodId(null);
          }
        };

        const normalizeCards = (arr: any[]) =>
          arr.map((m) => ({
            id: String(m.id),
            brand: String(m.brand || m.type || 'card'),
            last4: String(m.last4 || m.lastFour || '0000'),
            isDefault: Boolean(m.isDefault || m.default || m.is_default),
          }));

        try {
          const url = `${baseUrl}/api/payment-methods?userId=${encodeURIComponent(riderId)}`;
          log('Fetching payment methods', { url, riderId });
          const resp = await fetch(url);
          if (!resp.ok) {
            let message = `Unable to refresh payment methods. [${resp.status}]`;
            try {
              const text = await resp.text();
              log('payment-methods error body', text);
              try {
                const data = JSON.parse(text);
                if (data?.error) message = `${message} ${data.error}`;
              } catch {
                if (text) message = `${message} ${text}`;
              }
            } catch {}
            throw new Error(message);
          }
          const data = await resp.json();
          const arr = (data?.paymentMethods ?? []) as any[];
          const normalized = normalizeCards(arr);
          applyCards(normalized);
          try {
            const stored = normalized.map((m) => ({
              id: m.id,
              brand: m.brand,
              last4: m.last4,
              isDefault: m.isDefault,
            }));
            await updateDoc(userRef, { paymentMethods: stored });
          } catch (persistErr) {
            console.error('Failed to persist payment methods', persistErr);
          }
        } catch (err: any) {
          console.error('Failed to fetch payment methods', err);
          if (!cancelled) {
            const message = err?.message ? `Couldn't refresh payment methods: ${err.message}` : 'Unable to refresh payment methods.';
            setErrorMsg(message);
          }
          try {
            const snap = await getDoc(userRef);
            const arr = (snap.data()?.paymentMethods ?? []) as any[];
            const normalized = normalizeCards(arr);
            applyCards(normalized);
          } catch (fallbackErr) {
            console.error('Failed to load fallback payment methods', fallbackErr);
            if (!cancelled) {
              setSavedCards([]);
              setSelectedPaymentMethodId(null);
              if (appleSupported) {
                setSelectedMethod('apple');
              } else {
                setSelectedMethod(null);
              }
            }
          }
        }
      } finally {
        if (!cancelled) setCreating(false);
      }
    }
    loadPaymentUI();

    return () => {
      cancelled = true;
      setErrorMsg(null);
      setCreating(false);
      setConfirming(false);
    };
  }, [visible, riderId, appleSupported, baseUrl, onClose]);

  const handleCancel = async () => {
    try {
      // Best-effort cancel any created but unconfirmed intent
      if (pendingIntentId) {
        const url = `${baseUrl}/api/payments/cancel-intent`;
        log('Cancel intent', { url, pendingIntentId });
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentIntentId: pendingIntentId }),
        }).catch(() => {});
      }
    } finally {
      setPendingIntentId(null);
      onClose();
    }
  };

  const handleConfirm = async () => {
    if (confirming) return;
    try {
      setErrorMsg(null);
      setConfirming(true);
      if (!selectedMethod) {
        Alert.alert('Select a method', 'Please select a payment method.');
        return;
      }
      if (!riderId) {
        Alert.alert('Sign in required', 'Please sign in to continue.');
        return;
      }

      // Check for duplicate requests before proceeding
      try {
        const rprCol = collection(firestore, 'ridePostingRequests');
        const dupQuery = query(
          rprCol,
          where('ridePostingId', '==', rideId),
          where('riderId', '==', riderId)
        );
        const dupSnap = await getDocs(dupQuery);
        const hasPendingOrAccepted = dupSnap.docs.some(d => {
          const status = d.data()?.status;
          return status === 'pending' || status === 'accepted';
        });
        
        if (hasPendingOrAccepted) {
          Alert.alert(
            'Already Requested',
            'You have already requested this ride. Please wait for the driver to respond.',
            [{ text: 'OK' }]
          );
          onClose();
          return;
        }
      } catch (dupErr) {
        log('Duplicate check failed (continuing):', dupErr);
      }

      // 0) Ensure/refresh Stripe customer to get customerId
      const email = firebaseAuth.currentUser?.email || undefined;
      const name = firebaseAuth.currentUser?.displayName || undefined;
      const custUrl = `${baseUrl}/api/payments/refresh-customer`;
      log('Refresh customer', { custUrl, riderId });
      const custResp = await fetch(custUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: riderId, email, name }),
      });
      if (!custResp.ok) {
        const t = await custResp.text().catch(() => '');
        log('refresh-customer error', { status: custResp.status, body: t });
        
        // Parse error response for user-friendly message
        let userMessage = `Failed to refresh customer [${custResp.status}]`;
        try {
          const errorData = JSON.parse(t);
          if (errorData.message) {
            userMessage = errorData.message;
          } else if (errorData.error) {
            userMessage = errorData.error;
          }
        } catch {
          if (t) userMessage = t;
        }
        
        throw new Error(userMessage);
      }
      const { customerId } = await custResp.json();

      // 1) Create PaymentIntent on server (manual capture) and attach customer
      const createUrl = `${baseUrl}/api/payments/create-intent`;
      log('Create intent', { createUrl, riderId, driverId, totals, baseFare, customerId, paymentMethodId: selectedPaymentMethodId });
      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totalInCents: totals.totalInCents,
          currency: 'usd',
          rideId,
          riderId,
          driverId,
          baseFare,
          platformFee: totals.platformFee,
          customerId,
          paymentMethodId: selectedPaymentMethodId, // Add the selected payment method ID
        }),
      });
      if (!createResp.ok) {
        const t = await createResp.text().catch(() => '');
        log('create-intent error', { status: createResp.status, body: t });
        
        // Parse error response from backend
        let errorData: any = {};
        let userMessage = `Failed to create PaymentIntent [${createResp.status}]`;
        
        try {
          errorData = JSON.parse(t);
          // Extract user-friendly message from backend response
          // Backend returns: { error: "Failed to create payment intent", message: "Your card has insufficient funds." }
          if (errorData.message) {
            userMessage = errorData.message;
          } else if (errorData.error) {
            userMessage = errorData.error;
          }
        } catch {
          // If parsing fails, use raw text if available
          if (t) userMessage = t;
        }
        
        // Check if the error is due to invalid payment method (test/live mode mismatch)
        if (errorData.requiresPaymentMethod || errorData.cleared) {
          Alert.alert(
            'Payment Method Required',
            'Your saved payment method is no longer valid. Please add a new payment method in the Payment Methods section.',
            [{ text: 'OK' }]
          );
          onClose();
          return;
        }
        
        throw new Error(userMessage);
      }
      const { clientSecret, id, stripeStatus } = (await createResp.json()) as { clientSecret: string; id: string; stripeStatus?: string };
      setPendingIntentId(id);

      // 2) Confirm payment with Apple Pay or saved card
      if (selectedMethod === 'apple') {
        // Apple Pay flow
        log('Confirming payment with Apple Pay');
        const { error } = await confirmPlatformPayPayment(clientSecret, {
          applePay: {
            cartItems: [
              {
                label: 'RideAlong Total',
                amount: (totals.rideFee + totals.platformFee + totals.stripeFee).toFixed(2),
                paymentType: 'Immediate',
              },
            ],
            merchantCountryCode: 'US',
            currencyCode: 'USD',
            merchantIdentifier: 'merchant.com.ridealong.rider',
          },
        });
        if (error) {
          log('Apple Pay confirmation error', error);
          throw new Error(error.message || 'Apple Pay payment failed');
        }
      } else if (selectedMethod === 'card') {
        if (!selectedPaymentMethodId) {
          Alert.alert('No card selected', 'Please select a saved card or add one in Payment Methods.');
          return;
        }
        
        // Skip confirmation if already confirmed by backend (stripeStatus: requires_capture)
        if (stripeStatus === 'requires_capture') {
          log('Payment already confirmed by backend', { stripeStatus });
        } else {
          log('Confirming payment with saved card', { paymentMethodId: selectedPaymentMethodId });
          const { error } = await confirmPayment(clientSecret, {
            paymentMethodType: 'Card',
            paymentMethodData: {
              paymentMethodId: selectedPaymentMethodId,
            },
          });
          if (error) throw new Error(error.message || 'Payment confirmation failed');
        }
      } else {
        Alert.alert('Payment method not supported', 'Please select a payment method.');
        return;
      }

      // 3) Create ridePostingRequest document in Firestore directly (like web app)
      if (onPaymentSuccess) {
        // Custom flow - let caller handle the ride creation
        await onPaymentSuccess(id);
      } else {
        // Direct Firestore creation (matching web app implementation)
        log('Creating ridePostingRequest document', { rideId, paymentIntentId: id });
        
        // Fetch the ride posting to get pickup, dropoff, and other details
        const ridePostingDoc = await getDoc(doc(firestore, 'ridePostings', rideId));
        const ridePostingData = ridePostingDoc.exists() ? ridePostingDoc.data() : {};
        
        // Get rider's profile information
        const userDoc = await getDoc(doc(firestore, 'riders', riderId));
        const userData = userDoc.exists() ? userDoc.data() : {};
        const riderName = userData.firstName && userData.lastName ? 
          `${userData.firstName} ${userData.lastName}` :
          userData.name || firebaseAuth.currentUser?.displayName || 'RideAlong User';
        
        // Get driver information from ride posting
        const driverDoc = driverId ? await getDoc(doc(firestore, 'drivers', driverId)) : null;
        const driverData = driverDoc?.exists() ? driverDoc.data() : {};
        const driverName = driverData.firstName && driverData.lastName ? 
          `${driverData.firstName} ${driverData.lastName}` :
          driverData.name || 'Driver';
        
        // Extract addresses from ride posting (same logic as available-rides page)
        const pickup = ridePostingData.pickupAddress || ridePostingData.pickup || 
                      ridePostingData.pickupLocation?.address || ridePostingData.origin || 
                      ridePostingData.from || 'Pickup Location';
        const dropoff = ridePostingData.dropoffAddress || ridePostingData.dropoff || 
                       ridePostingData.dropoffLocation?.address || ridePostingData.destination || 
                       ridePostingData.to || 'Dropoff Location';
        
        // Create the request document with all required fields
        const ridePostingRequestData = {
          ridePostingId: rideId,  // CRITICAL: Use ridePostingId, not rideId
          driverId: driverId || null,
          driverName: driverName,
          driverEmail: driverData.email || '',
          riderId: riderId,
          riderName: riderName,
          riderEmail: firebaseAuth.currentUser?.email || '',
          pickup: pickup,
          dropoff: dropoff,
          date: ridePostingData.date || '',
          time: ridePostingData.time || '',
          passengers: 1,
          contributionAmount: baseFare,
          platformFee: totals.platformFee,
          paymentAmount: totals.total,
          paymentMethodId: selectedPaymentMethodId,
          paymentIntentId: id,
          paymentStatus: 'authorized',
          distance: ridePostingData.distance || null,
          duration: ridePostingData.duration || null,
          vehicleInfo: ridePostingData.vehicleInfo || driverData.vehicleInfo || 'Vehicle',
          status: 'pending',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };
        
        console.log('🚀 Creating ridePostingRequest document with data:', JSON.stringify(ridePostingRequestData, null, 2));
        
        const rprCol = collection(firestore, 'ridePostingRequests');
        const docRef = await addDoc(rprCol, ridePostingRequestData);
        
        console.log('✅ RidePostingRequest created successfully!');
        console.log('   Document ID:', docRef.id);
        console.log('   ridePostingId:', rideId);
        console.log('   riderId:', riderId);
        console.log('   status:', 'pending');
        log('RidePostingRequest created:', docRef.id);
        
        // Show success message
        Alert.alert(
          'Request Sent!',
          'Your ride request has been sent to the driver. Payment has been authorized and will be captured when the driver confirms pickup.',
          [{ text: 'OK' }]
        );
      }
      setPendingIntentId(null);
      onClose();
      // Success alert removed - handled by the calling component (book.tsx) or shown above
    } catch (err: any) {
      console.error('Payment flow error', err);
      setErrorMsg(err?.message || 'Payment failed');
    } finally {
      setConfirming(false);
    }
  };

  const canConfirm = selectedMethod === 'apple' || (selectedMethod === 'card' && !!selectedPaymentMethodId);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={handleCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.sheetHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.headerCopy}>
              <Text style={styles.modalTitle}>Confirm payment</Text>
              <Text style={styles.modalSubtitle}>Review your fare and payment method</Text>
            </View>
            <TouchableOpacity onPress={handleCancel} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close payment">
              <X size={20} color="#15233A" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent} showsVerticalScrollIndicator={false}>
            {errorMsg ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{errorMsg}</Text>
              </View>
            ) : null}

            <View style={styles.totalHero}>
              <Text style={styles.totalEyebrow}>TOTAL DUE</Text>
              <Text style={styles.totalHeroValue}>${totals.total.toFixed(2)}</Text>
              <Text style={styles.totalHeroCaption}>Authorized now and captured after your ride.</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fare details</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.lineLabel}>Ride fee</Text>
                <Text style={styles.lineValue}>${totals.rideFee.toFixed(2)}</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.lineLabel}>Platform fee</Text>
                <Text style={styles.lineValue}>${totals.platformFee.toFixed(2)}</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.lineLabel}>Processing fee</Text>
                <Text style={styles.lineValue}>${totals.stripeFee.toFixed(2)}</Text>
              </View>
              <View style={[styles.rowBetween, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>${totals.total.toFixed(2)}</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Payment method</Text>
              {Platform.OS === 'ios' ? (
                <TouchableOpacity
                  style={[styles.methodRow, selectedMethod === 'apple' && styles.methodRowSelected, !appleSupported && styles.methodRowUnavailable]}
                  onPress={() => setSelectedMethod('apple')}
                  disabled={!appleSupported}
                >
                  <View style={styles.methodIcon}><Smartphone size={19} color="#15233A" /></View>
                  <View style={styles.methodCopy}>
                    <Text style={styles.methodLabel}>Apple Pay</Text>
                    <Text style={styles.methodMeta}>{appleSupported ? 'Pay with your Apple Wallet' : 'Unavailable on this device'}</Text>
                  </View>
                  <View style={[styles.selection, selectedMethod === 'apple' && styles.selectionActive]}>
                    {selectedMethod === 'apple' ? <Check size={13} color="#FFFFFF" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={[styles.methodRow, selectedMethod === 'card' && styles.methodRowSelected]} onPress={() => setSelectedMethod('card')}>
                <View style={styles.methodIcon}><CreditCard size={19} color="#15233A" /></View>
                <View style={styles.methodCopy}>
                  <Text style={styles.methodLabel}>Saved card</Text>
                  <Text style={styles.methodMeta}>{savedCards.length ? 'Choose a card below' : 'No saved cards available'}</Text>
                </View>
                <View style={[styles.selection, selectedMethod === 'card' && styles.selectionActive]}>
                  {selectedMethod === 'card' ? <Check size={13} color="#FFFFFF" strokeWidth={3} /> : null}
                </View>
              </TouchableOpacity>

              {selectedMethod === 'card' ? (
                <View style={styles.savedCardList}>
                  {creating ? (
                    <ActivityIndicator color="#DE5D20" />
                  ) : savedCards.length ? (
                    savedCards.map((card) => (
                      <TouchableOpacity
                        key={card.id}
                        style={[styles.cardRow, selectedPaymentMethodId === card.id && styles.cardRowSelected]}
                        onPress={() => { setSelectedMethod('card'); setSelectedPaymentMethodId(card.id); }}
                      >
                        <View style={styles.cardBrand}><CreditCard size={17} color="#DE5D20" /></View>
                        <View style={styles.cardCopy}>
                          <Text style={styles.cardText}>{card.brand || 'Card'} ending in {card.last4}</Text>
                          <Text style={styles.cardMeta}>{card.isDefault ? 'Default payment method' : 'Saved payment method'}</Text>
                        </View>
                        <View style={[styles.selection, selectedPaymentMethodId === card.id && styles.selectionActive]}>
                          {selectedPaymentMethodId === card.id ? <Check size={13} color="#FFFFFF" strokeWidth={3} /> : null}
                        </View>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={styles.addCardHint}>Add a card from Payment Methods before requesting this ride.</Text>
                  )}
                </View>
              ) : null}

              <View style={styles.securityNote}>
                <ShieldCheck size={17} color="#15803D" />
                <Text style={styles.securityText}>Secure payment powered by Stripe</Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.formActions}>
            <TouchableOpacity
              style={[styles.confirmBtn, (creating || confirming || !canConfirm) && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={creating || confirming || !canConfirm}
              activeOpacity={0.84}
            >
              {confirming ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmBtnText}>Confirm and request ride - ${totals.total.toFixed(2)}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.48)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#FBFAF7',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#D8D3CB', alignSelf: 'center', marginTop: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  headerCopy: { flex: 1, paddingRight: 12 },
  modalTitle: { color: '#15233A', fontSize: 24, lineHeight: 30, fontWeight: '700' },
  modalSubtitle: { color: '#8B94A6', fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 2 },
  closeButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#E5E0D8', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  modalBody: { flexGrow: 0 },
  modalBodyContent: { paddingHorizontal: 20, paddingBottom: 12, gap: 14 },
  totalHero: { backgroundColor: '#15233A', borderRadius: 18, paddingHorizontal: 18, paddingVertical: 18 },
  totalEyebrow: { color: '#BAC4D4', fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.1 },
  totalHeroValue: { color: '#FFFFFF', fontSize: 32, lineHeight: 39, fontWeight: '700', marginTop: 2 },
  totalHeroCaption: { color: '#D6DCE5', fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: 4 },
  section: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E0D8', borderRadius: 18, padding: 16 },
  sectionTitle: { color: '#15233A', fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: 9 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  lineLabel: { color: '#6F7888', fontSize: 13, fontWeight: '500' },
  lineValue: { color: '#15233A', fontSize: 13, fontWeight: '600' },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DDE1E7', marginTop: 7, paddingTop: 10 },
  totalLabel: { color: '#15233A', fontSize: 15, fontWeight: '700' },
  totalValue: { color: '#15233A', fontSize: 17, fontWeight: '700' },
  methodRow: { minHeight: 62, borderWidth: 1, borderColor: '#E5E0D8', borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  methodRowSelected: { borderColor: '#DE5D20', backgroundColor: '#FFF8F3' },
  methodRowUnavailable: { opacity: 0.55 },
  methodIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F4F1EC', alignItems: 'center', justifyContent: 'center' },
  methodCopy: { flex: 1, marginLeft: 11 },
  methodLabel: { color: '#15233A', fontSize: 14, fontWeight: '700', textTransform: 'capitalize' },
  methodMeta: { color: '#8B94A6', fontSize: 11, lineHeight: 16, fontWeight: '500', marginTop: 1 },
  selection: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#C8CED8', alignItems: 'center', justifyContent: 'center' },
  selectionActive: { backgroundColor: '#DE5D20', borderColor: '#DE5D20' },
  savedCardList: { marginTop: 8, gap: 7 },
  cardRow: { minHeight: 58, borderWidth: 1, borderColor: '#ECE8E1', borderRadius: 14, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF' },
  cardRowSelected: { borderColor: '#DE5D20', backgroundColor: '#FFF8F3' },
  cardBrand: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#FCE9DD', alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, marginLeft: 10 },
  cardText: { color: '#15233A', fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  cardMeta: { color: '#8B94A6', fontSize: 11, fontWeight: '500', marginTop: 2 },
  addCardHint: { color: '#6F7888', fontSize: 12, lineHeight: 18, fontWeight: '500', paddingVertical: 10 },
  securityNote: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  securityText: { color: '#47705A', fontSize: 12, fontWeight: '600' },
  errorBanner: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 14, padding: 12 },
  errorBannerText: { color: '#B91C1C', fontSize: 12, lineHeight: 18, fontWeight: '600' },
  formActions: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 30 : 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E0D8', backgroundColor: '#FBFAF7' },
  confirmBtn: { minHeight: 54, borderRadius: 27, backgroundColor: '#DE5D20', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', textAlign: 'center' },
});