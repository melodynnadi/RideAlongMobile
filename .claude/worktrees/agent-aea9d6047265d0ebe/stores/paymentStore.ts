/**
 * Payment Store
 * Zustand store for managing payment state across the app
 */

import { create } from 'zustand';
import { PaymentMethod, RidePaymentState } from '@/types/payment';
import {
  listPaymentMethods as apiListPaymentMethods,
  setDefaultPaymentMethod as apiSetDefaultPaymentMethod,
  deletePaymentMethod as apiDeletePaymentMethod,
} from '@/services/payments';

interface PaymentState {
  // Payment methods
  paymentMethods: PaymentMethod[];
  selectedPaymentMethodId: string | null;
  isLoadingMethods: boolean;
  methodsError: string | null;

  // Current ride payment state
  currentRidePayment: RidePaymentState | null;

  // Actions
  setPaymentMethods: (methods: PaymentMethod[]) => void;
  setSelectedPaymentMethod: (methodId: string | null) => void;
  setLoadingMethods: (loading: boolean) => void;
  setMethodsError: (error: string | null) => void;
  
  loadPaymentMethods: (userId: string) => Promise<void>;
  setDefaultMethod: (userId: string, paymentMethodId: string) => Promise<void>;
  removePaymentMethod: (userId: string, paymentMethodId: string) => Promise<void>;
  
  setCurrentRidePayment: (payment: RidePaymentState | null) => void;
  clearCurrentRidePayment: () => void;
  
  reset: () => void;
}

export const usePaymentStore = create<PaymentState>((set, get) => ({
  // Initial state
  paymentMethods: [],
  selectedPaymentMethodId: null,
  isLoadingMethods: false,
  methodsError: null,
  currentRidePayment: null,

  // Setters
  setPaymentMethods: (methods) => {
    const defaultMethod = methods.find((m) => m.isDefault);
    set({
      paymentMethods: methods,
      selectedPaymentMethodId: defaultMethod?.id || methods[0]?.id || null,
    });
  },

  setSelectedPaymentMethod: (methodId) => set({ selectedPaymentMethodId: methodId }),
  
  setLoadingMethods: (loading) => set({ isLoadingMethods: loading }),
  
  setMethodsError: (error) => set({ methodsError: error }),

  // Load payment methods from API
  loadPaymentMethods: async (userId: string) => {
    set({ isLoadingMethods: true, methodsError: null });
    try {
      const methods = await apiListPaymentMethods(userId);
      get().setPaymentMethods(methods);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load payment methods';
      set({ methodsError: errorMessage });
      console.error('Failed to load payment methods:', error);
    } finally {
      set({ isLoadingMethods: false });
    }
  },

  // Set a payment method as default
  setDefaultMethod: async (userId: string, paymentMethodId: string) => {
    set({ isLoadingMethods: true, methodsError: null });
    try {
      const methods = await apiSetDefaultPaymentMethod(paymentMethodId, { userId, paymentMethodId });
      get().setPaymentMethods(methods);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set default payment method';
      set({ methodsError: errorMessage });
      console.error('Failed to set default payment method:', error);
      throw error;
    } finally {
      set({ isLoadingMethods: false });
    }
  },

  // Remove a payment method
  removePaymentMethod: async (userId: string, paymentMethodId: string) => {
    set({ isLoadingMethods: true, methodsError: null });
    try {
      await apiDeletePaymentMethod(paymentMethodId, { userId, paymentMethodId });
      // Reload methods after deletion
      await get().loadPaymentMethods(userId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to remove payment method';
      set({ methodsError: errorMessage });
      console.error('Failed to remove payment method:', error);
      throw error;
    } finally {
      set({ isLoadingMethods: false });
    }
  },

  // Ride payment state management
  setCurrentRidePayment: (payment) => set({ currentRidePayment: payment }),
  
  clearCurrentRidePayment: () => set({ currentRidePayment: null }),

  // Reset store
  reset: () =>
    set({
      paymentMethods: [],
      selectedPaymentMethodId: null,
      isLoadingMethods: false,
      methodsError: null,
      currentRidePayment: null,
    }),
}));
