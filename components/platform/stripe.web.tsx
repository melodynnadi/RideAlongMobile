import React from 'react';
import { Text, View } from 'react-native';

export function CardField({ onCardChange, style }: any) {
  React.useEffect(() => {
    onCardChange?.({ complete: false });
  }, [onCardChange]);

  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
      <Text>Card entry is available in the mobile app.</Text>
    </View>
  );
}

export function useStripe() {
  return {
    confirmSetupIntent: async () => ({
      setupIntent: null,
      error: { message: 'Card entry is available in the mobile app.' },
    }),
    confirmPayment: async () => ({
      error: { message: 'Payments are available in the mobile app.' },
    }),
    confirmPlatformPayPayment: async () => ({
      error: { message: 'Apple Pay is available in the mobile app.' },
    }),
  };
}

export async function isPlatformPaySupported() {
  return false;
}

// Web stub mirroring the native @stripe/stripe-react-native PlatformPay namespace
// (only the PaymentType enum values are referenced in shared code).
export const PlatformPay = {
  PaymentType: {
    Immediate: 'Immediate',
    Deferred: 'Deferred',
    Recurring: 'Recurring',
  },
} as any;
