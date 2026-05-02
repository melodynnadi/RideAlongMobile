/**
 * AddCardModal — Glassmorphic redesign
 */

import React, { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, useColorScheme, Platform,
} from 'react-native';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/authStore';
import { createSetupIntent, savePaymentMethod } from '@/services/payments';
import { usePaymentStore } from '@/stores/paymentStore';

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  orange:       '#F4621F',
  orangeLight:  '#FF8C4A',
  green:        '#10B981',
  darkCard:     '#0F1923',
  darkBorder:   'rgba(255,255,255,0.11)',
  darkText:     '#F0F4FF',
  darkSub:      '#7A8FA8',
  darkInput:    'rgba(255,255,255,0.07)',
  darkInputBorder: 'rgba(255,255,255,0.13)',
  lightCard:    '#FFFFFF',
  lightBorder:  'rgba(0,0,0,0.08)',
  lightText:    '#0D1B2A',
  lightSub:     '#5A6A7E',
  lightInput:   '#F8FAFC',
  lightInputBorder: 'rgba(200,210,225,0.9)',
};

function useAppTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    card:        dark ? COLORS.darkCard        : COLORS.lightCard,
    border:      dark ? COLORS.darkBorder      : COLORS.lightBorder,
    text:        dark ? COLORS.darkText        : COLORS.lightText,
    sub:         dark ? COLORS.darkSub         : COLORS.lightSub,
    input:       dark ? COLORS.darkInput       : COLORS.lightInput,
    inputBorder: dark ? COLORS.darkInputBorder : COLORS.lightInputBorder,
  };
}

interface AddCardModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AddCardModal({ visible, onClose, onSuccess }: AddCardModalProps) {
  const theme = useAppTheme();
  const { confirmSetupIntent } = useStripe();
  const { uid, email, riderProfile } = useAuthStore();
  const { loadPaymentMethods } = usePaymentStore();

  const [cardDetails,  setCardDetails]  = useState<{ complete: boolean } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const dark     = theme.dark;
  const cardReady = cardDetails?.complete && !isProcessing;

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
    if (!cardDetails?.complete) {
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
      <View style={s.overlay}>
        <TouchableOpacity
          style={s.backdrop}
          activeOpacity={1}
          onPress={isProcessing ? undefined : onClose}
        />

        <View style={[s.sheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <BlurView intensity={dark ? 40 : 70} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />

          {/* Handle */}
          <View style={[s.handle, { backgroundColor: dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)' }]} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} style={s.headerIcon}>
                <Ionicons name="card" size={20} color="white" />
              </LinearGradient>
              <View>
                <Text style={[s.title, { color: theme.text }]}>Add Payment Card</Text>
                <Text style={[s.subtitle, { color: theme.sub }]}>Securely powered by Stripe</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              disabled={isProcessing}
              style={[s.closeBtn, { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
            >
              <Ionicons name="close" size={20} color={theme.text} />
            </TouchableOpacity>
          </View>

          {/* Card Field */}
          <View style={[s.cardFieldWrap, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
            <BlurView intensity={dark ? 15 : 30} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
            <CardField
              postalCodeEnabled
              placeholders={{ number: '4242 4242 4242 4242' }}
              cardStyle={{
                backgroundColor: 'transparent',
                textColor: theme.text,
                placeholderColor: dark ? '#3A5570' : '#A0B0C0',
                borderColor: 'transparent',
                borderWidth: 0,
              }}
              style={s.cardField}
              onCardChange={setCardDetails}
            />
          </View>

          {/* Test card info */}
          <View style={[s.infoBox, {
            backgroundColor: dark ? 'rgba(244,98,31,0.08)' : 'rgba(244,98,31,0.06)',
            borderColor: 'rgba(244,98,31,0.25)',
          }]}>
            <View style={s.infoRow}>
              <Ionicons name="information-circle" size={15} color={COLORS.orange} />
              <Text style={[s.infoTitle, { color: COLORS.orange }]}>Test Cards</Text>
            </View>
            <Text style={[s.infoText, { color: theme.sub }]}>4242 4242 4242 4242 — Success</Text>
            <Text style={[s.infoText, { color: theme.sub }]}>4000 0000 0000 9995 — Insufficient funds</Text>
            <Text style={[s.infoText, { color: theme.sub }]}>Any future expiry & any CVV</Text>
          </View>

          {/* Security badge */}
          <View style={[s.securityBox, {
            backgroundColor: dark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)',
            borderColor: 'rgba(16,185,129,0.25)',
          }]}>
            <Ionicons name="shield-checkmark" size={15} color={COLORS.green} />
            <Text style={[s.securityText, { color: dark ? '#6EE7B7' : '#065F46' }]}>
              Your card details are encrypted and never stored on our servers.
            </Text>
          </View>

          {/* Buttons */}
          <View style={[s.actions, { borderTopColor: theme.border }]}>
            <TouchableOpacity
              onPress={onClose}
              disabled={isProcessing}
              style={[s.cancelBtn, { borderColor: theme.inputBorder, backgroundColor: theme.input }]}
            >
              <Text style={[s.cancelBtnText, { color: theme.text }]}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleAddCard}
              disabled={!cardReady}
              activeOpacity={0.86}
              style={{ flex: 1 }}
            >
              <LinearGradient
                colors={cardReady ? [COLORS.orange, COLORS.orangeLight] : ['#9CA3AF', '#9CA3AF']}
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
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
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
  closeBtn:   { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  cardFieldWrap: {
    marginHorizontal: 24, marginBottom: 16,
    borderRadius: 16, borderWidth: 1.5, overflow: 'hidden', height: 56,
    justifyContent: 'center',
  },
  cardField: { height: 52, marginHorizontal: 4 },

  infoBox:   { marginHorizontal: 24, marginBottom: 12, borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  infoRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  infoTitle: { fontSize: 13, fontWeight: '700' },
  infoText:  { fontSize: 12, lineHeight: 18, fontWeight: '400' },

  securityBox:  { marginHorizontal: 24, marginBottom: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 14, padding: 12 },
  securityText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '400' },

  actions:       { flexDirection: 'row', gap: 12, paddingHorizontal: 24, paddingTop: 16, borderTopWidth: 1 },
  cancelBtn:     { flex: 1, borderRadius: 50, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingVertical: 15 },
  cancelBtnText: { fontSize: 15, fontWeight: '600' },
  submitBtn:     {
    borderRadius: 50, paddingVertical: 15, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.orange, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  submitBtnText: { fontSize: 15, fontWeight: '700', color: 'white', letterSpacing: 0.2 },
});

export default AddCardModal;