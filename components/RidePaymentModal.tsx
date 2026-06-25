/**
 * RidePaymentModal Component
 * Modal for authorizing payment when requesting a ride
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { X, DollarSign, CreditCard } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';
import { useRidePayments } from '@/hooks/useRidePayments';
import { useAuthStore } from '@/stores/authStore';
import { PaymentMethodSelector } from './PaymentMethodSelector';

interface RidePaymentModalProps {
  visible: boolean;
  onClose: () => void;
  rideId: string;
  amount: number; // in cents
  baseFare?: number;
  platformFee?: number;
  driverId?: string;
  onSuccess?: (paymentIntentId: string) => void;
  onError?: (error: string) => void;
}

export function RidePaymentModal({
  visible,
  onClose,
  rideId,
  amount,
  baseFare,
  platformFee,
  driverId,
  onSuccess,
  onError,
}: RidePaymentModalProps) {
  const theme = useTheme();
  const { user } = useAuthStore();
  const {
    paymentMethods,
    selectedPaymentMethodId,
    isAuthorizingPayment,
    authorizePayment,
    listPaymentMethods,
  } = useRidePayments();

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      loadPaymentMethods();
    }
  }, [visible]);

  const loadPaymentMethods = async () => {
    setIsLoading(true);
    try {
      await listPaymentMethods();
    } catch (error) {
      console.error('Failed to load payment methods:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthorizePayment = async () => {
    if (!selectedPaymentMethodId) {
      Alert.alert('No Payment Method', 'Please select a payment method.');
      return;
    }

    if (!user) {
      Alert.alert('Error', 'User not authenticated.');
      return;
    }

    const result = await authorizePayment({
      rideId,
      amount,
      paymentMethodId: selectedPaymentMethodId,
      driverId,
      baseFare,
      platformFee,
    });

    if (result.success && result.paymentIntentId) {
      Alert.alert(
        'Payment Authorized',
        'Your payment has been authorized. Funds will be captured when the driver confirms pickup.'
      );
      onSuccess?.(result.paymentIntentId);
      onClose();
    } else {
      Alert.alert('Payment Failed', result.error || 'Failed to authorize payment');
      onError?.(result.error || 'Failed to authorize payment');
    }
  };

  const formatAmount = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: theme.colors.card }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="wallet-outline" size={17} color="#DE5D20" />
            </View>
            <Text style={[styles.title, { color: theme.colors.text, flex: 1 }]}>Authorize Payment</Text>
            <TouchableOpacity onPress={onClose} disabled={isAuthorizingPayment}>
              <X size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          {/* Amount Display */}
          <View style={[styles.amountContainer, { backgroundColor: theme.colors.bg }]}>
            <DollarSign size={32} color={theme.colors.primary} />
            <View style={styles.amountDetails}>
              <Text style={[styles.amountLabel, { color: theme.colors.muted }]}>Total Amount</Text>
              <Text style={[styles.amountValue, { color: theme.colors.text }]}>
                {formatAmount(amount)}
              </Text>
            </View>
          </View>

          {/* Payment Method Info */}
          <View style={styles.infoBox}>
            <CreditCard size={20} color={theme.colors.accent} />
            <Text style={[styles.infoText, { color: theme.colors.muted }]}>
              Your card will be authorized but not charged until the driver confirms pickup.
            </Text>
          </View>

          {/* Payment Method Selector */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : paymentMethods.length === 0 ? (
            <View style={styles.noMethodsContainer}>
              <Text style={[styles.noMethodsText, { color: theme.colors.text }]}>
                No payment methods found. Please add a card first.
              </Text>
            </View>
          ) : (
            <View style={styles.selectorContainer}>
              <Text style={[styles.sectionLabel, { color: theme.colors.text }]}>
                Select Payment Method
              </Text>
              <PaymentMethodSelector showAddButton={true} />
            </View>
          )}

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { borderColor: theme.colors.secondary }]}
              onPress={onClose}
              disabled={isAuthorizingPayment}
            >
              <Text style={[styles.buttonText, { color: theme.colors.text }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.authorizeButton,
                { backgroundColor: theme.colors.primary },
                (isAuthorizingPayment || !selectedPaymentMethodId || isLoading) && styles.disabledButton,
              ]}
              onPress={handleAuthorizePayment}
              disabled={isAuthorizingPayment || !selectedPaymentMethodId || isLoading}
            >
              {isAuthorizingPayment ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.authorizeButtonText}>Authorize Payment</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modal: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  headerIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#FFF2E9', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  amountDetails: {
    marginLeft: 12,
  },
  amountLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  amountValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  infoBox: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: 'rgba(79, 70, 229, 0.1)',
    borderRadius: 8,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
  loadingContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noMethodsContainer: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  noMethodsText: {
    fontSize: 16,
    textAlign: 'center',
  },
  selectorContainer: {
    maxHeight: 300,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
  },
  authorizeButton: {
    backgroundColor: '#E05E1A',
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  authorizeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
