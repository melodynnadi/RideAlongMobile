/**
 * useRidePayments Hook
 * Main hook for handling payment workflow in the RideAlong Rider App
 * Uses the same logic as the RideAlong web app payment system (Stripe manual capture model)
 */

import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import {
  createSetupIntent,
  savePaymentMethod,
  createRidePayment,
  cancelRidePayment,
  refreshCustomer,
} from '@/services/payments';
import { PaymentMethod } from '@/types/payment';
import { logActivity } from '@/utils/activityLogger';

interface AddCardResult {
  success: boolean;
  error?: string;
  paymentMethod?: PaymentMethod;
}

interface AuthorizePaymentParams {
  rideId: string;
  amount: number; // in cents
  paymentMethodId?: string; // if not provided, uses selected payment method
  driverId?: string;
  baseFare?: number;
  platformFee?: number;
}

interface AuthorizePaymentResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
}

interface CancelPaymentParams {
  rideId: string;
  paymentIntentId: string;
}

export function useRidePayments() {
  const { confirmSetupIntent, confirmPayment } = useStripe();
  const { uid, email, riderProfile, driverProfile } = useAuthStore();
  const profile = riderProfile ?? driverProfile;
  const user = uid
    ? {
        id: uid,
        email: email ?? '',
        firstName: (profile as any)?.firstName ?? '',
        lastName: (profile as any)?.lastName ?? '',
      }
    : null;
  const {
    paymentMethods,
    selectedPaymentMethodId,
    isLoadingMethods,
    loadPaymentMethods,
    setCurrentRidePayment,
    clearCurrentRidePayment,
  } = usePaymentStore();

  const [isAddingCard, setIsAddingCard] = useState(false);
  const [isAuthorizingPayment, setIsAuthorizingPayment] = useState(false);
  const [isCancelingPayment, setIsCancelingPayment] = useState(false);

  /**
   * Add a new payment method (card)
   * Flow:
   * 1. Get SetupIntent client secret from server
   * 2. Confirm SetupIntent with Stripe using card details
   * 3. Save payment method to server
   */
  const addPaymentMethod = useCallback(async (): Promise<AddCardResult> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }

    setIsAddingCard(true);
    try {
      // Step 1: Create SetupIntent
      const { clientSecret } = await createSetupIntent({
        userId: user.id,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
      });

      // Step 2: Confirm SetupIntent with Stripe
      // Note: The card details should be collected using CardField component
      // This method should be called after the user has entered card details
      const { setupIntent, error: confirmError } = await confirmSetupIntent(clientSecret, {
        paymentMethodType: 'Card',
      });

      if (confirmError) {
        logActivity({ type: 'payment_method_add_failed', metadata: { error: confirmError.message } });
        return { success: false, error: confirmError.message };
      }

      if (!setupIntent?.paymentMethodId) {
        return { success: false, error: 'Failed to confirm card setup' };
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

      logActivity({ type: 'payment_method_added', metadata: { paymentMethodId: setupIntent.paymentMethodId } });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to add payment method';
      logActivity({ type: 'payment_method_add_error', metadata: { error: errorMessage } });
      return { success: false, error: errorMessage };
    } finally {
      setIsAddingCard(false);
    }
  }, [user, confirmSetupIntent, loadPaymentMethods]);

  /**
   * List all payment methods for the current user
   */
  const listPaymentMethods = useCallback(async () => {
    if (!user) {
      return [];
    }

    try {
      await loadPaymentMethods(user.id);
      return paymentMethods;
    } catch (error) {
      console.error('Failed to list payment methods:', error);
      return [];
    }
  }, [user, loadPaymentMethods, paymentMethods]);

  /**
   * Authorize payment for a ride request (manual capture - holds funds)
   * This creates a PaymentIntent with capture_method: 'manual'
   * Funds are held but not captured until the ride is completed
   */
  const authorizePayment = useCallback(
    async (params: AuthorizePaymentParams): Promise<AuthorizePaymentResult> => {
      if (!user) {
        return { success: false, error: 'User not authenticated' };
      }

      const paymentMethodId = params.paymentMethodId || selectedPaymentMethodId;
      if (!paymentMethodId) {
        return { success: false, error: 'No payment method selected' };
      }

      setIsAuthorizingPayment(true);
      setCurrentRidePayment({
        status: 'pending',
        amount: params.amount,
      });

      try {
        // Ensure customer exists
        await refreshCustomer(user.id, user.email, `${user.firstName} ${user.lastName}`);

        // Create PaymentIntent with manual capture
        const { clientSecret, id: paymentIntentId } = await createRidePayment({
          userId: user.id,
          rideId: params.rideId,
          amount: params.amount,
          rideType: 'ride_request',
          paymentMethodId,
          riderId: user.id,
          driverId: params.driverId,
          baseFare: params.baseFare,
          platformFee: params.platformFee,
        });

        // Confirm payment with Stripe
        const { paymentIntent, error: confirmError } = await confirmPayment(clientSecret, {
          paymentMethodType: 'Card',
        });

        if (confirmError) {
          setCurrentRidePayment({
            status: 'failed',
            error: confirmError.message,
            amount: params.amount,
          });
          logActivity({
            type: 'ride_payment_authorization_failed',
            metadata: { rideId: params.rideId, error: confirmError.message },
          });
          return { success: false, error: confirmError.message };
        }

        if (!paymentIntent) {
          return { success: false, error: 'Failed to authorize payment' };
        }

        setCurrentRidePayment({
          paymentIntentId,
          clientSecret,
          status: 'authorized',
          amount: params.amount,
        });

        logActivity({
          type: 'ride_payment_authorized',
          metadata: { rideId: params.rideId, paymentIntentId, amount: params.amount },
        });

        return { success: true, paymentIntentId };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to authorize payment';
        setCurrentRidePayment({
          status: 'failed',
          error: errorMessage,
          amount: params.amount,
        });
        logActivity({
          type: 'ride_payment_authorization_error',
          metadata: { rideId: params.rideId, error: errorMessage },
        });
        return { success: false, error: errorMessage };
      } finally {
        setIsAuthorizingPayment(false);
      }
    },
    [user, selectedPaymentMethodId, confirmPayment, setCurrentRidePayment]
  );

  /**
   * Cancel a ride payment (if ride is rejected or cancelled before driver confirms)
   */
  const cancelPayment = useCallback(
    async (params: CancelPaymentParams): Promise<{ success: boolean; error?: string }> => {
      if (!user) {
        return { success: false, error: 'User not authenticated' };
      }

      setIsCancelingPayment(true);
      try {
        await cancelRidePayment({
          paymentIntentId: params.paymentIntentId,
          rideId: params.rideId,
        });

        setCurrentRidePayment({
          paymentIntentId: params.paymentIntentId,
          status: 'canceled',
        });

        logActivity({
          type: 'ride_payment_canceled',
          metadata: { rideId: params.rideId, paymentIntentId: params.paymentIntentId },
        });

        // Clear payment state after a short delay
        setTimeout(() => {
          clearCurrentRidePayment();
        }, 2000);

        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to cancel payment';
        logActivity({
          type: 'ride_payment_cancel_error',
          metadata: { rideId: params.rideId, error: errorMessage },
        });
        return { success: false, error: errorMessage };
      } finally {
        setIsCancelingPayment(false);
      }
    },
    [user, clearCurrentRidePayment, setCurrentRidePayment]
  );

  /**
   * Get the default payment method
   */
  const getDefaultPaymentMethod = useCallback((): PaymentMethod | null => {
    return paymentMethods.find((m) => m.isDefault) || paymentMethods[0] || null;
  }, [paymentMethods]);

  return {
    // State
    paymentMethods,
    selectedPaymentMethodId,
    isLoadingMethods,
    isAddingCard,
    isAuthorizingPayment,
    isCancelingPayment,

    // Methods
    addPaymentMethod,
    listPaymentMethods,
    authorizePayment,
    cancelPayment,
    getDefaultPaymentMethod,
  };
}
