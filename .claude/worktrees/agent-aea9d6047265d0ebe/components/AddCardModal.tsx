/**
 * AddCardModal Component
 * Modal for adding a new payment card using Stripe CardField
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/stores/authStore';
import { createSetupIntent, savePaymentMethod } from '@/services/payments';
import { usePaymentStore } from '@/stores/paymentStore';

interface AddCardModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AddCardModal({ visible, onClose, onSuccess }: AddCardModalProps) {
  const theme = useTheme();
  const { confirmSetupIntent } = useStripe();
  const { user } = useAuthStore();
  const { loadPaymentMethods } = usePaymentStore();

  const [cardDetails, setCardDetails] = useState<{ complete: boolean } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAddCard = async () => {
    if (!cardDetails?.complete) {
      Alert.alert('Incomplete Card', 'Please enter valid card details.');
      return;
    }

    if (!user) {
      Alert.alert('Error', 'User not authenticated.');
      return;
    }

    setIsProcessing(true);

    try {
      // Step 1: Create SetupIntent
      const { clientSecret } = await createSetupIntent({
        userId: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
      });

      // Step 2: Confirm SetupIntent with Stripe
      const { setupIntent, error: confirmError } = await confirmSetupIntent(clientSecret, {
        paymentMethodType: 'Card',
      });

      if (confirmError) {
        Alert.alert('Card Error', confirmError.message);
        return;
      }

      if (!setupIntent?.paymentMethodId) {
        Alert.alert('Error', 'Failed to confirm card setup.');
        return;
      }

      // Step 3: Save payment method to server
      await savePaymentMethod({
        userId: user.id,
        paymentMethodId: setupIntent.paymentMethodId,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
      });

      // Reload payment methods
      await loadPaymentMethods(user.id);

      Alert.alert('Success', 'Card added successfully!');
      onSuccess?.();
      onClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add card';
      Alert.alert('Error', errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: theme.colors.card }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.colors.text }]}>Add Payment Card</Text>
            <TouchableOpacity onPress={onClose} disabled={isProcessing}>
              <X size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          {/* Card Field */}
          <View style={styles.cardFieldContainer}>
            <CardField
              postalCodeEnabled={true}
              placeholders={{
                number: '4242 4242 4242 4242',
              }}
              cardStyle={{
                backgroundColor: theme.colors.bg,
                textColor: theme.colors.text,
                placeholderColor: theme.colors.muted,
              }}
              style={styles.cardField}
              onCardChange={(details) => {
                setCardDetails(details);
              }}
            />
          </View>

          {/* Test Card Info */}
          <View style={styles.testCardInfo}>
            <Text style={[styles.testCardTitle, { color: theme.colors.text }]}>Test Cards:</Text>
            <Text style={[styles.testCardText, { color: theme.colors.text + 'CC' }]}>
              • 4242 4242 4242 4242 - Success
            </Text>
            <Text style={[styles.testCardText, { color: theme.colors.text + 'CC' }]}>
              • 4000 0000 0000 9995 - Insufficient funds
            </Text>
            <Text style={[styles.testCardText, { color: theme.colors.text + 'CC' }]}>
              Use any future expiry date and any CVV
            </Text>
          </View>

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton, { borderColor: theme.colors.secondary }]}
              onPress={onClose}
              disabled={isProcessing}
            >
              <Text style={[styles.buttonText, { color: theme.colors.text }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.addButton,
                { backgroundColor: theme.colors.primary },
                (!cardDetails?.complete || isProcessing) && styles.disabledButton,
              ]}
              onPress={handleAddCard}
              disabled={!cardDetails?.complete || isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.addButtonText}>Add Card</Text>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  cardFieldContainer: {
    marginBottom: 24,
  },
  cardField: {
    height: 50,
    marginVertical: 10,
  },
  testCardInfo: {
    marginBottom: 24,
    padding: 12,
    backgroundColor: 'rgba(224, 94, 26, 0.1)',
    borderRadius: 8,
  },
  testCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  testCardText: {
    fontSize: 12,
    marginBottom: 4,
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
  addButton: {
    backgroundColor: '#E05E1A',
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
