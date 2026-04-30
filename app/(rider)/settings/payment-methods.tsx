import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, CreditCard as CreditIcon, Trash2, Check } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { CardField, useStripe } from '@stripe/stripe-react-native';

 type PaymentMethod = {
  id: string;
  type: string; // card brand
  lastFour: string;
  expiryMonth: string | number;
  expiryYear: string | number;
  isDefault: boolean;
};

export default function PaymentMethodsScreen() {
  const theme = useTheme();
  const { confirmSetupIntent } = useStripe();

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-card modal state
  const [adding, setAdding] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardPreview, setCardPreview] = useState<{ brand?: string; last4?: string; expMonth?: number; expYear?: number }>({});

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(firebaseAuth, async (user) => {
      if (!user) {
        setPaymentMethods([]);
        setSelectedMethod(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const userRef = doc(firestore, 'riders', user.uid);

      try {
        // Prefer server as source of truth for Stripe PaymentMethods
        const resp = await fetch(`${getApiBaseUrl()}/api/payment-methods?userId=${encodeURIComponent(user.uid)}`);
        if (resp.ok) {
          const data = await resp.json();
          const arr = (data?.paymentMethods ?? []) as any[];
          const normalized = arr.map((m) => ({
            id: m.id,
            type: String(m.brand || m.type || 'card').toLowerCase(),
            lastFour: String(m.last4 || m.lastFour || '0000'),
            expiryMonth: m.exp_month || m.expiryMonth || '--',
            expiryYear: m.exp_year || m.expiryYear || '----',
            isDefault: Boolean(m.isDefault || m.default || m.is_default),
          } as PaymentMethod));
          setPaymentMethods(normalized);
          const def = normalized.find((m) => m.isDefault) || normalized[0];
          if (def) setSelectedMethod(def.id);
          try {
            const stored = normalized.map(pm => ({ id: pm.id, brand: pm.type, last4: pm.lastFour, exp_month: pm.expiryMonth, exp_year: pm.expiryYear, isDefault: pm.isDefault }));
            await updateDoc(userRef, { paymentMethods: stored });
          } catch (err) {
            console.error('Failed to store payment methods', err);
          }
        } else {
          // Fallback: read any legacy local data from Firestore (if present)
          const snap = await getDoc(userRef);
          const arr = (snap.data()?.paymentMethods ?? []) as any[];
          const normalized = arr.map((m) => ({
            id: m.id,
            type: String(m.brand || m.type || 'card').toLowerCase(),
            lastFour: String(m.last4 || m.lastFour || '0000'),
            expiryMonth: m.exp_month || m.expiryMonth || '--',
            expiryYear: m.exp_year || m.expiryYear || '----',
            isDefault: Boolean(m.isDefault || m.default || m.is_default),
          } as PaymentMethod));
          setPaymentMethods(normalized);
          const def = normalized.find((m) => m.isDefault) || normalized[0];
          if (def) setSelectedMethod(def.id);
        }
      } catch (err) {
        console.error('Failed to load payment methods', err);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
    };
  }, []);

  const handleDeleteCard = (cardId: string) => {
    Alert.alert(
      'Remove Payment Method',
      'Are you sure you want to remove this payment method?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: async () => {
          try {
            const uid = firebaseAuth.currentUser?.uid;
            if (!uid) { Alert.alert('Not signed in', 'Please sign in to remove a payment method.'); return; }
            setLoading(true);

            // Call server to detach the payment method from Stripe
            const resp = await fetch(`${getApiBaseUrl()}/api/payment-methods/${encodeURIComponent(cardId)}?userId=${encodeURIComponent(uid)}`, {
              method: 'DELETE',
            });
            if (!resp.ok) {
              const t = await resp.text().catch(() => '');
              throw new Error(t || 'Failed to remove payment method');
            }

            // Refresh list from server
            const listResp = await fetch(`${getApiBaseUrl()}/api/payment-methods?userId=${encodeURIComponent(uid)}`);
            if (listResp.ok) {
              const data = await listResp.json();
              const arr = (data?.paymentMethods ?? []) as any[];
              const normalized = arr.map((m) => ({
                id: m.id,
                type: String(m.brand || m.type || 'card').toLowerCase(),
                lastFour: String(m.last4 || m.lastFour || '0000'),
                expiryMonth: m.exp_month || m.expiryMonth || '--',
                expiryYear: m.exp_year || m.expiryYear || '----',
                isDefault: Boolean(m.isDefault || m.default || m.is_default),
              } as PaymentMethod));
              setPaymentMethods(normalized);
              const def = normalized.find((m) => m.isDefault) || normalized[0] || null;
              setSelectedMethod(def ? def.id : null);
              try {
                const stored = normalized.map(pm => ({ id: pm.id, brand: pm.type, last4: pm.lastFour, exp_month: pm.expiryMonth, exp_year: pm.expiryYear, isDefault: pm.isDefault }));
                await updateDoc(doc(firestore, 'riders', uid), { paymentMethods: stored });
              } catch (err) {
                console.error('Failed to store payment methods', err);
              }
            } else {
              // If refresh failed, optimistically remove from current state
              const remaining = paymentMethods.filter(pm => pm.id !== cardId);
              setPaymentMethods(remaining);
              if (selectedMethod === cardId) setSelectedMethod(remaining[0]?.id ?? null);
              try {
                const stored = remaining.map(pm => ({ id: pm.id, brand: pm.type, last4: pm.lastFour, exp_month: pm.expiryMonth, exp_year: pm.expiryYear, isDefault: pm.isDefault }));
                await updateDoc(doc(firestore, 'riders', uid), { paymentMethods: stored });
              } catch (err) {
                console.error('Failed to store payment methods', err);
              }
            }

            Alert.alert('Removed', 'Payment method removed.');
          } catch (err) {
            console.error('Failed to delete card', err);
            Alert.alert('Error', 'Could not remove the payment method.');
          } finally {
            setLoading(false);
          }
        } }
      ]
    );
  };

  const getCardBrandName = (type: string) => {
    switch (type) {
      case 'visa': return 'Visa';
      case 'mastercard': return 'Mastercard';
      case 'amex': return 'American Express';
      default: return 'Card';
    }
  };

  const getCardColor = (type: string) => {
    switch (type) {
      case 'visa': return '#1A1F71';
      case 'mastercard': return '#EB001B';
      case 'amex': return '#006FCF';
      default: return '#6B7280';
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>Payment Methods</Text>
          <Text style={styles.headerSubtitle}>Manage your payment options</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {!adding ? (
          <Button variant="primary" style={styles.addButton} onPress={() => setAdding(true)}>
            <View style={styles.buttonContent}>
              <Plus size={20} color="white" />
              <Text style={[styles.addButtonText, { color: 'white' }]}>Add New Payment Method</Text>
            </View>
          </Button>
        ) : (
          <Card style={styles.addPaymentCard}>
            <Text style={[styles.addPaymentTitle, { color: theme.colors.secondary }]}>Add Payment Method</Text>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Card Details *</Text>
              <CardField
                postalCodeEnabled={false}
                autofocus
                cardStyle={{ backgroundColor: '#FFFFFF', textColor: '#0F172A', placeholderColor: '#94A3B8' }}
                style={{ width: '100%', height: 50, marginTop: 6 }}
                onCardChange={(details: any) => {
                  setCardComplete(!!details?.complete);
                  if (details) {
                    const brand = details.brand ? String(details.brand).toLowerCase() : undefined;
                    const last4 = details.last4 ? String(details.last4) : undefined;
                    const expMonth = details.expiryMonth || details.expMonth;
                    const expYear = details.expiryYear || details.expYear;
                    setCardPreview({
                      brand,
                      last4,
                      expMonth: typeof expMonth === 'number' ? expMonth : undefined,
                      expYear: typeof expYear === 'number' ? expYear : undefined,
                    });
                  }
                }}
              />
            </View>
            <View style={styles.formActions}>
              <Button variant="outline" style={styles.cancelButton} onPress={() => { setAdding(false); setCardComplete(false); setCardPreview({}); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                style={styles.saveButton}
                disabled={!cardComplete || saving}
                loading={saving}
                onPress={async () => {
                  try {
                    setSaving(true);
                    const uid = firebaseAuth.currentUser?.uid;
                    if (!uid) { Alert.alert('Not signed in', 'Please sign in to add a payment method.'); return; }

                    // 1) Ask server to create SetupIntent (and ensure Stripe Customer)
                    const email = firebaseAuth.currentUser?.email || undefined;
                    const name = firebaseAuth.currentUser?.displayName || undefined;
                    const siResp = await fetch(`${getApiBaseUrl()}/api/create-setup-intent`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ userId: uid, email, name })
                    });
                    if (!siResp.ok) {
                      const t = await siResp.text().catch(() => '');
                      throw new Error(`Failed to create setup intent: ${t}`);
                    }
                    const { clientSecret } = await siResp.json();

                    // 2) Confirm setup on device using CardField details
                    const { setupIntent, error } = await confirmSetupIntent(clientSecret, {
                      paymentMethodType: 'Card',
                      paymentMethodData: { billingDetails: { email, name } },
                    } as any);
                    if (error || !setupIntent) {
                      console.error('confirmSetupIntent error', error);
                      Alert.alert('Error', error?.message || 'Could not confirm card.');
                      return;
                    }

                    // 3) Save PM on server and set as default
                    const paymentMethodId = (setupIntent as any).paymentMethodId || (setupIntent as any).payment_method_id;
                    if (!paymentMethodId) throw new Error('Missing paymentMethodId from SetupIntent');
                    const saveResp = await fetch(`${getApiBaseUrl()}/api/save-payment-method`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ userId: uid, paymentMethodId, email, name })
                    });
                    if (!saveResp.ok) {
                      const t = await saveResp.text().catch(() => '');
                      throw new Error(`Failed to save payment method: ${t}`);
                    }

                    // 4) Refresh list from server
                    const listResp = await fetch(`${getApiBaseUrl()}/api/payment-methods?userId=${encodeURIComponent(uid)}`);
                    if (listResp.ok) {
                      const data = await listResp.json();
                      const arr = (data?.paymentMethods ?? []) as any[];
                      const normalized = arr.map((m) => ({
                        id: m.id,
                        type: String(m.brand || m.type || 'card').toLowerCase(),
                        lastFour: String(m.last4 || m.lastFour || '0000'),
                        expiryMonth: m.exp_month || m.expiryMonth || '--',
                        expiryYear: m.exp_year || m.expiryYear || '----',
                        isDefault: Boolean(m.isDefault || m.default || m.is_default),
                      } as PaymentMethod));
                      setPaymentMethods(normalized);
                      const def = normalized.find((m) => m.isDefault) || normalized[0];
                      if (def) setSelectedMethod(def.id);
                      const added = normalized.find((m) => m.id === paymentMethodId) || null;
                      try {
                        const stored = normalized.map(pm => ({ id: pm.id, brand: pm.type, last4: pm.lastFour, exp_month: pm.expiryMonth, exp_year: pm.expiryYear, isDefault: pm.isDefault }));
                        await updateDoc(doc(firestore, 'riders', uid), { paymentMethods: stored });
                      } catch (err) {
                        console.error('Failed to store payment methods', err);
                      }
                      void logActivity({
                        type: 'payment_method_added',
                        entityType: 'paymentMethod',
                        entityId: paymentMethodId,
                        metadata: {
                          brand: (cardPreview.brand || added?.type || null) ?? null,
                          isDefault: added?.isDefault ?? false,
                        },
                      });
                    }

                    setAdding(false); setCardComplete(false); setCardPreview({});
                    Alert.alert('Success', 'Payment method added and saved to your account.');
                  } catch (err: any) {
                    console.error('Failed to add payment method', err);
                    Alert.alert('Error', err?.message || 'Failed to add payment method.');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Save Card
              </Button>
            </View>
          </Card>
        )}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>Your Payment Methods</Text>
          {loading ? (
            <ActivityIndicator style={{ marginTop: 16 }} />
          ) : paymentMethods.length === 0 ? (
            <Text style={{ color: '#64748B' }}>No payment methods found.</Text>
          ) : (
            paymentMethods.map((method) => (
              <Card key={method.id} style={styles.paymentCard}>
                <TouchableOpacity
                  style={styles.cardContent}
                  onPress={async () => {
                    const prevSelected = selectedMethod;
                    try {
                      const uid = firebaseAuth.currentUser?.uid;
                      if (!uid) {
                        Alert.alert('Not signed in', 'Please sign in to update your default payment method.');
                        return;
                      }
                      setLoading(true);
                      const resp = await fetch(`${getApiBaseUrl()}/api/payment-methods/${encodeURIComponent(method.id)}/default`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: uid }),
                      });
                      if (!resp.ok) {
                        const text = await resp.text().catch(() => '');
                        throw new Error(text || 'Failed to update default payment method');
                      }

                      const data = await resp.json();
                      const arr = (data?.paymentMethods ?? []) as any[];
                      const normalized = arr.map((m) => ({
                        id: m.id,
                        type: String(m.brand || m.type || 'card').toLowerCase(),
                        lastFour: String(m.last4 || m.lastFour || '0000'),
                        expiryMonth: m.exp_month || m.expiryMonth || '--',
                        expiryYear: m.exp_year || m.expiryYear || '----',
                        isDefault: Boolean(m.isDefault || m.id === data?.defaultPaymentMethodId),
                      } as PaymentMethod));

                      setPaymentMethods(normalized);
                      const def = normalized.find((m) => m.isDefault) || normalized.find((m) => m.id === data?.defaultPaymentMethodId) || normalized[0] || null;
                      setSelectedMethod(def ? def.id : null);

                      try {
                        const stored = normalized.map(pm => ({ id: pm.id, brand: pm.type, last4: pm.lastFour, exp_month: pm.expiryMonth, exp_year: pm.expiryYear, isDefault: pm.isDefault }));
                        await updateDoc(doc(firestore, 'riders', uid), { paymentMethods: stored });
                      } catch (err) {
                        console.error('Failed to store payment methods', err);
                      }
                    } catch (err) {
                      console.error('Failed to set default payment method', err);
                      setSelectedMethod(prevSelected ?? null);
                      Alert.alert('Error', err instanceof Error ? err.message : 'Could not update default payment method.');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <View style={styles.cardLeft}>
                    <View style={[styles.cardIcon, { backgroundColor: getCardColor(method.type) }]}>
                      <CreditIcon size={20} color="white" />
                    </View>
                    <View style={styles.cardInfo}>
                      <Text style={[styles.cardBrand, { color: theme.colors.secondary }]}>{getCardBrandName(method.type)} •••• {method.lastFour}</Text>
                      <Text style={styles.cardExpiry}>Expires {method.expiryMonth}/{method.expiryYear}</Text>
                      {method.isDefault && (
                        <View style={styles.defaultBadge}><Text style={styles.defaultText}>Default</Text></View>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardRight}>
                    {selectedMethod === method.id && (
                      <View style={[styles.selectedIndicator, { backgroundColor: theme.colors.primary }]}>
                        <Check size={16} color="white" />
                      </View>
                    )}
                    <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteCard(method.id)}>
                      <Trash2 size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </Card>
            ))
          )}
        </View>

        <Card style={styles.infoCard}>
          <Text style={[styles.infoTitle, { color: theme.colors.secondary }]}>Payment Security</Text>
          <Text style={styles.infoText}>Your payment information is encrypted and secure. We use industry-standard security measures to protect your financial data.</Text>
          <View style={styles.infoFeatures}>
            <Text style={styles.infoFeature}>• 256-bit SSL encryption</Text>
            <Text style={styles.infoFeature}>• PCI DSS compliant</Text>
            <Text style={styles.infoFeature}>• No card details stored locally</Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 16 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 2 },
  headerSubtitle: { fontSize: 14, color: '#64748B' },
  content: { flex: 1, paddingHorizontal: 16 },
  addButton: { marginBottom: 32 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  addButtonText: { fontSize: 16, fontWeight: '600', marginLeft: 8 },
  addPaymentCard: { backgroundColor: 'white', padding: 20, marginBottom: 24 },
  addPaymentTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  formActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1 },
  saveButton: { flex: 1 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  paymentCard: { backgroundColor: 'white', padding: 16, marginBottom: 12 },
  cardContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cardIcon: { width: 48, height: 32, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  cardInfo: { flex: 1 },
  cardBrand: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardExpiry: { fontSize: 14, color: '#64748B', marginBottom: 4 },
  defaultBadge: { backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start' },
  defaultText: { fontSize: 12, color: '#166534', fontWeight: '500' },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedIndicator: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  deleteButton: { padding: 8 },
  infoCard: { backgroundColor: 'white', padding: 16, marginBottom: 32 },
  infoTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  infoText: { fontSize: 14, color: '#64748B', lineHeight: 20, marginBottom: 12 },
  infoFeatures: { gap: 4 },
  infoFeature: { fontSize: 14, color: '#64748B' },
});
