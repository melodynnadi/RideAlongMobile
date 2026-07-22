/**
 * AddCardModal — Glassmorphic redesign
 */

import React, { useState, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { CardForm, useStripe } from '@/components/platform/stripe';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/authStore';
import { createSetupIntent, savePaymentMethod } from '@/services/payments';
import { usePaymentStore } from '@/stores/paymentStore';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import { useAppTheme } from '@/hooks/ThemeContext';

interface AddCardModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AddCardModal({ visible, onClose, onSuccess }: AddCardModalProps) {
  const { colors, isDark } = useAppTheme();
  const { confirmSetupIntent } = useStripe();
  const { uid, email, riderProfile } = useAuthStore();
  const { loadPaymentMethods } = usePaymentStore();

  const [formComplete, setFormComplete] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const cardReady = formComplete && !isProcessing;

  // Reset completion state whenever the modal closes.
  React.useEffect(() => {
    if (!visible) setFormComplete(false);
  }, [visible]);

  const s = useMemo(() => StyleSheet.create({
    overlay:  { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },

    sheet: {
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      borderWidth: 1.5, borderBottomWidth: 0,
      overflow: 'hidden',
      paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    },

    handle:     { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    title:      { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
    subtitle:   { fontSize: 13, fontWeight: '400', marginTop: 1 },
    closeBtn:   { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

    cardFormWrap: {
      marginHorizontal: 24, marginBottom: 16,
      borderRadius: 16, borderWidth: 1.5, overflow: 'hidden',
    },
    cardForm: { height: 220 },

    securityBox:  { marginHorizontal: 24, marginBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 14, padding: 12 },
    securityText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '400' },

    actions:       { flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingTop: 16, borderTopWidth: 1 },
    cancelBtn:     { flex: 1, borderRadius: 50, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingVertical: 15 },
    cancelBtnText: { fontSize: 15, fontWeight: '600' },
    submitBtn:     {
      borderRadius: 50, paddingVertical: 15, alignItems: 'center', justifyContent: 'center',
      shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    submitBtnText: { fontSize: 15, fontWeight: '700', color: colors.textInverse, letterSpacing: 0.2 },
  }), [colors]);

  const getDisplayName = () => {
    if (riderProfile) {
      const r = riderProfile as any;
      const first = r.firstName || r.first_name || '';
      const last  = r.lastName  || r.last_name  || '';
      return `${first} ${last}`.trim();
    }
    return '';
  };

  const handleAddCard = async () => {
    if (!formComplete) {
      Alert.alert('Incomplete Card', 'Please enter valid card details.');
      return;
    }
    if (!uid) {
      Alert.alert('Error', 'User not authenticated.');
      return;
    }

    setIsProcessing(true);
    try {
      const { clientSecret } = await createSetupIntent({
        userId: uid,
        email: email ?? '',
        name: getDisplayName(),
      });

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

      await savePaymentMethod({
        userId: uid,
        paymentMethodId: setupIntent.paymentMethodId,
        email: email ?? '',
        name: getDisplayName(),
      });

      await loadPaymentMethods(uid);
      Alert.alert('Success', 'Card added successfully!');
      onSuccess?.();
      onClose();
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add card');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAwareModalView style={s.overlay}>
        <TouchableOpacity
          style={s.backdrop}
          activeOpacity={1}
          onPress={isProcessing ? undefined : onClose}
        />

        <View style={[s.sheet, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <BlurView intensity={isDark ? 40 : 70} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />

          {/* Handle */}
          <View style={[s.handle, { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }]} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <LinearGradient colors={[colors.primary, colors.primaryLight]} style={s.headerIcon}>
                <Ionicons name="card" size={20} color="white" />
              </LinearGradient>
              <View>
                <Text style={[s.title, { color: colors.textPrimary }]}>Add Payment Card</Text>
                <Text style={[s.subtitle, { color: colors.textSecondary }]}>Securely powered by Stripe</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              disabled={isProcessing}
              style={[s.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
              accessibilityRole="button"
              accessibilityLabel="Close add card"
            >
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Card Form — separate rows for number, expiry, CVC, and postal code */}
          <View style={[s.cardFormWrap, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {isDark ? <BlurView intensity={15} tint="dark" style={StyleSheet.absoluteFillObject} /> : null}
            <CardForm
              cardStyle={{
                backgroundColor: colors.bgCard,
                cursorColor: colors.primary,
              }}
              style={s.cardForm}
              onFormComplete={() => setFormComplete(true)}
            />
          </View>

          {/* Security badge */}
          <View style={[s.securityBox, {
            backgroundColor: colors.greenDim,
            borderColor: colors.greenBorder,
          }]}>
            <Ionicons name="shield-checkmark" size={15} color={colors.green} />
            <Text style={[s.securityText, { color: isDark ? colors.greenLight : colors.green }]}>
              Your card details are encrypted and never stored on our servers.
            </Text>
          </View>

          {/* Buttons */}
          <View style={[s.actions, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              disabled={isProcessing}
              style={[s.cancelBtn, { borderColor: colors.border, backgroundColor: colors.bgInput }]}
            >
              <Text style={[s.cancelBtnText, { color: colors.textPrimary }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleAddCard}
              disabled={!cardReady}
              activeOpacity={0.86}
              style={{ flex: 1 }}
            >
              <LinearGradient
                colors={cardReady ? [colors.primary, colors.primaryLight] : ['#9CA3AF', '#9CA3AF']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.submitBtn}
              >
                {isProcessing
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text style={s.submitBtnText}>Add Card</Text>
                }
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareModalView>
    </Modal>
  );
}

export default AddCardModal;
