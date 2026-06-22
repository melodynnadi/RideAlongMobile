/**
 * Enhanced Payment Methods Screen
 * Uses the new payment workflow components and store
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Plus, CreditCard, Trash2, Check } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { AddCardModal } from '@/components/AddCardModal';
import { setDefaultPaymentMethod } from '@/services/payments';

export default function EnhancedPaymentMethodsScreen() {
  const theme = useTheme();
  const { user } = useAuthStore();
  const {
    paymentMethods,
    selectedPaymentMethodId,
    isLoadingMethods,
    loadPaymentMethods,
    setDefaultMethod,
    removePaymentMethod,
  } = usePaymentStore();

  const [showAddModal, setShowAddModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      loadPaymentMethods(user.id);
    }
  }, [user]);

  const handleSetDefault = async (methodId: string) => {
    if (!user) return;

    try {
      await setDefaultMethod(user.id, methodId);
      Alert.alert('Success', 'Default payment method updated');
    } catch (error) {
      Alert.alert('Error', 'Failed to set default payment method');
    }
  };

  const handleDeleteCard = (methodId: string) => {
    Alert.alert(
      'Remove Payment Method',
      'Are you sure you want to remove this payment method?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            setDeletingId(methodId);
            try {
              await removePaymentMethod(user.id, methodId);
              Alert.alert('Success', 'Payment method removed');
            } catch (error) {
              Alert.alert('Error', 'Failed to remove payment method');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const getBrandIcon = (brand: string) => {
    return <CreditCard size={24} color={theme.colors.primary} />;
  };

  const formatExpiryDate = (month: number, year: number) => {
    const monthStr = String(month).padStart(2, '0');
    const yearStr = String(year).slice(-2);
    return `${monthStr}/${yearStr}`;
  };

  const getBrandColor = (brand: string) => {
    switch (brand.toLowerCase()) {
      case 'visa':
        return '#1A1F71';
      case 'mastercard':
        return '#EB001B';
      case 'amex':
        return '#006FCF';
      default:
        return theme.colors.primary;
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.canGoBack() ? router.back() : router.push('/settings')}>
          <ArrowLeft size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Payment Methods</Text>
          <Text style={[styles.headerSubtitle, { color: theme.colors.muted }]}>
            Manage your payment options
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Add New Card Button */}
        <TouchableOpacity
          style={[styles.addButton, { borderColor: theme.colors.secondary }]}
          onPress={() => setShowAddModal(true)}
        >
          <Plus size={20} color={theme.colors.primary} />
          <Text style={[styles.addButtonText, { color: theme.colors.primary }]}>
            Add New Payment Method
          </Text>
        </TouchableOpacity>

        {/* Loading State */}
        {isLoadingMethods && paymentMethods.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.loadingText, { color: theme.colors.text }]}>
              Loading payment methods...
            </Text>
          </View>
        ) : paymentMethods.length === 0 ? (
          <View style={styles.emptyContainer}>
            <CreditCard size={64} color={theme.colors.muted} />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
              No Payment Methods
            </Text>
            <Text style={[styles.emptyText, { color: theme.colors.muted }]}>
              Add a payment method to start requesting rides
            </Text>
          </View>
        ) : (
          <View style={styles.methodsList}>
            {paymentMethods.map((method) => {
              const isDeleting = deletingId === method.id;
              return (
                <View
                  key={method.id}
                  style={[
                    styles.methodCard,
                    { backgroundColor: theme.colors.card },
                    method.isDefault && { borderColor: theme.colors.primary, borderWidth: 2 },
                  ]}
                >
                  {/* Card Info */}
                  <View style={styles.methodHeader}>
                    <View style={styles.methodInfo}>
                      {getBrandIcon(method.brand)}
                      <View style={styles.methodDetails}>
                        <Text style={[styles.methodBrand, { color: theme.colors.text }]}>
                          {method.brand.charAt(0).toUpperCase() + method.brand.slice(1)} ••••{' '}
                          {method.last4}
                        </Text>
                        <Text style={[styles.methodExpiry, { color: theme.colors.muted }]}>
                          Expires {formatExpiryDate(method.exp_month, method.exp_year)}
                        </Text>
                      </View>
                    </View>

                    {/* Default Badge */}
                    {method.isDefault && (
                      <View style={[styles.defaultBadge, { backgroundColor: theme.colors.accent }]}>
                        <Check size={12} color="#FFFFFF" />
                        <Text style={styles.defaultText}>Default</Text>
                      </View>
                    )}
                  </View>

                  {/* Actions */}
                  <View style={styles.methodActions}>
                    {!method.isDefault && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: theme.colors.bg }]}
                        onPress={() => handleSetDefault(method.id)}
                        disabled={isDeleting}
                      >
                        <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>
                          Set as Default
                        </Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[styles.actionButton, styles.deleteButton, { backgroundColor: theme.colors.error + '20' }]}
                      onPress={() => handleDeleteCard(method.id)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? (
                        <ActivityIndicator size="small" color={theme.colors.error} />
                      ) : (
                        <>
                          <Trash2 size={16} color={theme.colors.error} />
                          <Text style={[styles.actionButtonText, { color: theme.colors.error }]}>
                            Remove
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Info Section */}
        <View style={styles.infoSection}>
          <Text style={[styles.infoTitle, { color: theme.colors.text }]}>
            Payment Information
          </Text>
          <Text style={[styles.infoText, { color: theme.colors.muted }]}>
            • Your payment methods are securely stored with Stripe{'\n'}
            • When you request a ride, your card will be authorized but not charged{'\n'}
            • Funds are captured only when the driver confirms pickup{'\n'}
            • You can remove a payment method at any time
          </Text>
        </View>
      </ScrollView>

      <AddCardModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => setShowAddModal(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 8,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    marginBottom: 24,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  methodsList: {
    gap: 16,
  },
  methodCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  methodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  methodInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  methodDetails: {
    marginLeft: 12,
    flex: 1,
  },
  methodBrand: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  methodExpiry: {
    fontSize: 14,
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  defaultText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  methodActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  deleteButton: {
    marginLeft: 'auto',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  infoSection: {
    marginTop: 24,
    padding: 16,
    backgroundColor: 'rgba(79, 70, 229, 0.1)',
    borderRadius: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 22,
  },
});
