import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { computeTotals } from '@/utils/fees';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, Timestamp } from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { useStripe, isPlatformPaySupported, PlatformPay } from '@stripe/stripe-react-native';

export type PaymentModalProps = {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  driverId: string | null;
  baseFare: number;
  onPaymentSuccess?: (paymentIntentId: string) => Promise<void>;
};

export function PaymentModal({ visible, onClose, rideId, driverId, baseFare, onPaymentSuccess }: PaymentModalProps) {
  const theme = useTheme();

  const riderId = firebaseAuth.currentUser?.uid ?? null;
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Payment flow bypassed for now; keep minimal state
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cardComplete, setCardComplete] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'apple' | null>(null);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<Array<{ id: string; brand: string; last4: string; isDefault?: boolean }>>([]);
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
      // eslint-disable-next-line no-console
      console.log('[PaymentModal]', ...args);
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    async function loadPaymentUI() {
      if (!visible) return;
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
        const userRef = doc(firestore, 'users', riderId);
        const applyCards = (cards: Array<{ id: string; brand: string; last4: string; isDefault?: boolean }>) => {
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
      setCardComplete(false);
      setCreating(false);
      setConfirming(false);
      if (!visible) {
        // Allow refetch on next open
        loadKeyRef.current = null;
      }
    };
  }, [visible, riderId]);

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
        } catch (parseErr) {
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
        const userDoc = await getDoc(doc(firestore, 'users', riderId));
        const userData = userDoc.exists() ? userDoc.data() : {};
        const riderName = userData.firstName && userData.lastName ? 
          `${userData.firstName} ${userData.lastName}` :
          userData.name || firebaseAuth.currentUser?.displayName || 'RideAlong User';
        
        // Get driver information from ride posting
        const driverDoc = driverId ? await getDoc(doc(firestore, 'users', driverId)) : null;
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

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={handleCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Payment</Text>
            <TouchableOpacity onPress={handleCancel} style={styles.closeButton}>
              <X size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            {errorMsg ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{errorMsg}</Text>
              </View>
            ) : null}
            {/* Line items */}
            <Card style={styles.summaryCard}>
              <Text style={[styles.summaryTitle, { color: theme.colors.secondary }]}>Summary</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.lineLabel}>Ride fee</Text>
                <Text style={styles.lineValue}>${totals.rideFee.toFixed(2)}</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.lineLabel}>Platform fee (7.25%)</Text>
                <Text style={styles.lineValue}>${totals.platformFee.toFixed(2)}</Text>
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.lineLabel}>Stripe fee (2.9% + $0.30)</Text>
                <Text style={styles.lineValue}>${totals.stripeFee.toFixed(2)}</Text>
              </View>
              <View style={[styles.rowBetween, styles.totalRow]}>
                <Text style={[styles.totalLabel, { color: theme.colors.secondary }]}>Total</Text>
                <Text style={[styles.totalValue, { color: theme.colors.secondary }]}>${totals.total.toFixed(2)}</Text>
              </View>
              <Text style={styles.holdNote}>A temporary hold will be placed. You won’t be charged until the driver confirms.</Text>
            </Card>

            {/* Payment method selection */}
            <Card style={styles.methodCard}>
              <Text style={[styles.summaryTitle, { color: theme.colors.secondary }]}>Payment method</Text>
              {Platform.OS === 'ios' && appleSupported && (
                <TouchableOpacity style={styles.methodRow} onPress={() => setSelectedMethod('apple')}>
                  <View style={[styles.radio, selectedMethod === 'apple' && styles.radioSelected]} />
                  <Text style={styles.methodLabel}>Apple Pay {appleSupported ? '' : '(Unavailable)'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.methodRow} onPress={() => setSelectedMethod('card')}>
                <View style={[styles.radio, selectedMethod === 'card' && styles.radioSelected]} />
                <Text style={styles.methodLabel}>Credit or Debit Card</Text>
              </TouchableOpacity>

              {selectedMethod === 'card' && (
                <View style={{ marginTop: 8 }}>
                  {creating ? (
                    <ActivityIndicator />
                  ) : savedCards.length ? (
                    savedCards.map((c) => (
                      <TouchableOpacity key={c.id} style={styles.cardRow} onPress={() => setSelectedPaymentMethodId(c.id)}>
                        <View style={[styles.radioSm, selectedPaymentMethodId === c.id && styles.radioSelected]} />
                        <Text style={styles.cardText}>{(c.brand || 'Card').toUpperCase()} •••• {c.last4} {c.isDefault ? '(Default)' : ''}</Text>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={styles.addCardHint}>No saved cards. Add one in Payment Methods.</Text>
                  )}
                </View>
              )}

              {/* Temporarily suppress errors in UI */}
            </Card>
          </ScrollView>

          <View style={styles.formActions}>
            <Button variant="outline" style={styles.cancelBtn} onPress={handleCancel} disabled={confirming}>
              Cancel
            </Button>
            <Button
              variant="primary"
              style={styles.confirmBtn}
              onPress={handleConfirm}
              disabled={creating || confirming || !selectedMethod}
              loading={confirming}
            >
              Confirm
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'white', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  modalTitle: { fontSize: 22, fontWeight: 'bold' },
  closeButton: { padding: 8 },
  modalBody: { paddingHorizontal: 16 },
  summaryCard: { backgroundColor: 'white', padding: 16, marginTop: 16 },
  summaryTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  lineLabel: { fontSize: 14, color: '#374151' },
  lineValue: { fontSize: 14, color: '#111827' },
  totalRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB', marginTop: 8, paddingTop: 8 },
  totalLabel: { fontSize: 16, fontWeight: '700' },
  totalValue: { fontSize: 16, fontWeight: '700' },
  cardFieldCard: { backgroundColor: 'white', padding: 16, marginTop: 16 },
  holdNote: { marginTop: 8, color: '#64748B', fontSize: 12 },
  methodCard: { backgroundColor: 'white', padding: 16, marginTop: 16 },
  methodRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  methodLabel: { marginLeft: 10, fontSize: 14, color: '#0F172A' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#CBD5E1' },
  radioSm: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#CBD5E1', marginRight: 8 },
  radioSelected: { backgroundColor: '#111827', borderColor: '#111827' },
  cardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  cardText: { fontSize: 14, color: '#0F172A' },
  addCardHint: { marginTop: 8, fontSize: 12, color: '#64748B' },
  errorText: { marginTop: 8, color: '#DC2626' },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  errorBannerText: {
    color: '#B91C1C',
    fontSize: 13,
  },
  formActions: { flexDirection: 'row', gap: 12, padding: 16 },
  cancelBtn: { flex: 1 },
  confirmBtn: { flex: 1 },
});
