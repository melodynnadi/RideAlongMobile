/**
 * PaymentMethodSelector Component
 * Displays saved payment methods and allows selection
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { CreditCard, Plus, Check } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { usePaymentStore } from '@/stores/paymentStore';
import { PaymentMethod } from '@/types/payment';
import { AddCardModal } from './AddCardModal';

interface PaymentMethodSelectorProps {
  onSelectMethod?: (method: PaymentMethod) => void;
  showAddButton?: boolean;
}

export function PaymentMethodSelector({
  onSelectMethod,
  showAddButton = true,
}: PaymentMethodSelectorProps) {
  const theme = useTheme();
  const { paymentMethods, selectedPaymentMethodId, isLoadingMethods, setSelectedPaymentMethod } =
    usePaymentStore();

  const [showAddModal, setShowAddModal] = useState(false);

  const handleSelectMethod = (method: PaymentMethod) => {
    setSelectedPaymentMethod(method.id);
    onSelectMethod?.(method);
  };

  const getBrandIcon = (brand: string) => {
    // In a production app, you'd use actual brand icons
    return <CreditCard size={24} color={theme.colors.primary} />;
  };

  const formatExpiryDate = (month: number, year: number) => {
    const monthStr = String(month).padStart(2, '0');
    const yearStr = String(year).slice(-2);
    return `${monthStr}/${yearStr}`;
  };

  if (isLoadingMethods) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.text }]}>
          Loading payment methods...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.methodsList} showsVerticalScrollIndicator={false}>
        {paymentMethods.map((method) => {
          const isSelected = method.id === selectedPaymentMethodId;
          return (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.methodCard,
                { backgroundColor: theme.colors.card },
                isSelected && { borderColor: theme.colors.primary, borderWidth: 2 },
              ]}
              onPress={() => handleSelectMethod(method)}
            >
              <View style={styles.methodInfo}>
                {getBrandIcon(method.brand)}
                <View style={styles.methodDetails}>
                  <Text style={[styles.methodBrand, { color: theme.colors.text }]}>
                    {method.brand.charAt(0).toUpperCase() + method.brand.slice(1)} •••• {method.last4}
                  </Text>
                  <Text style={[styles.methodExpiry, { color: theme.colors.muted }]}>
                    Expires {formatExpiryDate(method.exp_month, method.exp_year)}
                  </Text>
                </View>
              </View>

              {isSelected && (
                <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                  <Check size={16} color="#FFFFFF" />
                </View>
              )}

              {method.isDefault && (
                <View style={[styles.defaultBadge, { backgroundColor: theme.colors.accent }]}>
                  <Text style={styles.defaultText}>Default</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {showAddButton && (
          <TouchableOpacity
            style={[styles.addButton, { borderColor: theme.colors.secondary }]}
            onPress={() => setShowAddModal(true)}
          >
            <Plus size={24} color={theme.colors.primary} />
            <Text style={[styles.addButtonText, { color: theme.colors.primary }]}>
              Add New Card
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <AddCardModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={() => {
          setShowAddModal(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  methodsList: {
    flex: 1,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'transparent',
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
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  defaultBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  defaultText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    marginBottom: 12,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
