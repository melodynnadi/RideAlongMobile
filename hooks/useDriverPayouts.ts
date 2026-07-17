import { useState, useCallback } from 'react';
import { firebaseAuth } from '@/constants/services';
import EmailTriggerService from '@/services/EmailTriggerService';
import type { PayoutStatus, EarningsData, AddBankAccountPayload, BankAccount } from '@/types';
import {
  getPayoutStatusByUserId,
  addBankAccount as addBankAccountService,
  removeBankAccount as removeBankAccountService,
  setDefaultBankAccount as setDefaultBankAccountService,
  getDriverEarnings,
} from '@/src/services/payouts';

interface UseDriverPayoutsReturn {
  // State
  loading: boolean;
  error: string | null;
  payoutStatus: PayoutStatus | null;
  earnings: EarningsData | null;

  // Actions
  getPayoutStatus: () => Promise<PayoutStatus | null>;
  addBankAccount: (payload: AddBankAccountPayload) => Promise<{ success: boolean; bankAccount?: BankAccount; error?: string }>;
  removeBankAccount: (bankAccountId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultBankAccount: (bankAccountId: string) => Promise<{ success: boolean; error?: string }>;
  getEarningsSummary: () => Promise<EarningsData | null>;
  refreshAll: () => Promise<void>;
  clearError: () => void;
}

/**
 * Custom hook for managing driver payouts and earnings
 * 
 * Provides a reusable interface to:
 * - Fetch payout status and connected bank accounts
 * - Add/remove bank accounts
 * - Set default payout method
 * - Retrieve earnings summary
 * 
 * All functions use the existing RideAlong Web API endpoints.
 */
export function useDriverPayouts(): UseDriverPayoutsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payoutStatus, setPayoutStatus] = useState<PayoutStatus | null>(null);
  const [earnings, setEarnings] = useState<EarningsData | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Normalize server payout status (which returns externalAccounts) to app PayoutStatus shape
  function normalizePayoutStatus(raw: any, userId: string): PayoutStatus {
    if (!raw || raw.hasAccount === false) {
      return {
        userId,
        stripeAccountId: undefined,
        payoutsEnabled: false,
        chargesEnabled: false,
        detailsSubmitted: false,
        bankAccounts: [],
        requirements: {
          currently_due: [],
          eventually_due: [],
          past_due: [],
        },
        hasOnboardingIssues: false,
      };
    }

    const external = Array.isArray(raw.externalAccounts) ? raw.externalAccounts : [];
    const bankAccounts: BankAccount[] = external
      .filter((x: any) => x && x.object === 'bank_account')
      .map((x: any) => ({
        id: String(x.id),
        bankName: x.bank_name || x.brand || 'Bank',
        accountHolderName: '',
        accountType: 'checking',
        last4: x.last4 || '',
        routingNumber: undefined,
        isDefault: !!x.default_for_currency,
        status: undefined,
      }));

    const currently_due = raw.requirements?.currently_due || [];
    const eventually_due = raw.requirements?.eventually_due || [];
    const past_due = raw.requirements?.past_due || [];
    const disabled_reason = raw.requirements?.disabled_reason || null;

    return {
      userId,
      stripeAccountId: raw.accountId,
      payoutsEnabled: !!raw.payoutsEnabled,
      chargesEnabled: !!raw.chargesEnabled,
      detailsSubmitted: Array.isArray(currently_due) ? currently_due.length === 0 : false,
      bankAccounts,
      requirements: {
        currently_due,
        eventually_due,
        past_due,
      },
      hasOnboardingIssues: !!disabled_reason || (Array.isArray(currently_due) && currently_due.length > 0),
    };
  }

  /**
   * Fetches the current payout status including bank accounts
   */
  const getPayoutStatus = useCallback(async (): Promise<PayoutStatus | null> => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      console.log('[useDriverPayouts] getPayoutStatus: User not authenticated');
      setError('User not authenticated');
      return null;
    }

    console.log('[useDriverPayouts] getPayoutStatus: Fetching status for user', user.uid);
    setLoading(true);
    setError(null);

    try {
      const raw = await getPayoutStatusByUserId(user.uid);
      const status = normalizePayoutStatus(raw, user.uid);
      console.log('[useDriverPayouts] getPayoutStatus: Success (normalized):', status);
      setPayoutStatus(status);
      return status;
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to fetch payout status';
      
      // Handle common errors for new users gracefully
      if (errorMessage.includes('Network request timed out') || 
          errorMessage.includes('timeout') ||
          errorMessage.includes('Failed to fetch payout status: User not found') ||
          errorMessage.includes('No Stripe account found')) {
        console.log('[useDriverPayouts] getPayoutStatus: New user detected, providing default status');
        
        // Provide default status for new users who haven't set up payouts
        const defaultStatus: PayoutStatus = {
          userId: user.uid,
          payoutsEnabled: false,
          chargesEnabled: false,
          detailsSubmitted: false,
          bankAccounts: [],
          hasOnboardingIssues: false,
          requirements: {
            currently_due: [],
            eventually_due: [],
            past_due: []
          }
        };
        
        setPayoutStatus(defaultStatus);
        setError(null); // Clear error for new users
        return defaultStatus;
      }
      
      // For other errors, still log and set error
      console.error('[useDriverPayouts] getPayoutStatus: Error:', errorMessage, err);
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Adds a new bank account for payouts
   */
  const addBankAccount = useCallback(async (
    payload: AddBankAccountPayload
  ): Promise<{ success: boolean; bankAccount?: BankAccount; error?: string }> => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      const error = 'User not authenticated';
      setError(error);
      return { success: false, error };
    }

    setLoading(true);
    setError(null);

    try {
      const result = await addBankAccountService(user.uid, payload);
      
      if (result.success) {
        // Refresh payout status to get updated bank accounts list
        await getPayoutStatus();
        
        // Send bank account added email
        try {
          if (result.bankAccount && user.email) {
            await EmailTriggerService.sendBankAccountAddedEmail(
              user.email,
              user.displayName || 'Driver',
              result.bankAccount.last4 || 'XXXX'
            );
          }
        } catch (emailErr) {
          console.warn('[addBankAccount] Email send error:', emailErr);
        }
      } else {
        setError(result.error || 'Failed to add bank account');
      }
      
      return result;
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to add bank account';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [getPayoutStatus]);

  /**
   * Removes a bank account from payout methods
   */
  const removeBankAccount = useCallback(async (
    bankAccountId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      const error = 'User not authenticated';
      setError(error);
      return { success: false, error };
    }

    setLoading(true);
    setError(null);

    try {
      const result = await removeBankAccountService(user.uid, bankAccountId);
      
      if (result.success) {
        // Refresh payout status to get updated bank accounts list
        await getPayoutStatus();
      } else {
        setError(result.error || 'Failed to remove bank account');
      }
      
      return result;
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to remove bank account';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [getPayoutStatus]);

  /**
   * Sets a bank account as the default payout method
   */
  const setDefaultBankAccount = useCallback(async (
    bankAccountId: string
  ): Promise<{ success: boolean; error?: string }> => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      const error = 'User not authenticated';
      setError(error);
      return { success: false, error };
    }

    setLoading(true);
    setError(null);

    try {
      const result = await setDefaultBankAccountService(user.uid, bankAccountId);
      
      if (result.success) {
        // Refresh payout status to get updated bank accounts list
        await getPayoutStatus();
      } else {
        setError(result.error || 'Failed to set default bank account');
      }
      
      return result;
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to set default bank account';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setLoading(false);
    }
  }, [getPayoutStatus]);

  /**
   * Fetches earnings summary for the driver
   */
  const getEarningsSummary = useCallback(async (): Promise<EarningsData | null> => {
    const user = firebaseAuth.currentUser;
    if (!user) {
      console.log('[useDriverPayouts] getEarningsSummary: User not authenticated');
      setError('User not authenticated');
      return null;
    }

    console.log('[useDriverPayouts] getEarningsSummary: Fetching earnings for user', user.uid);
    setLoading(true);
    setError(null);

    try {
      const earningsData = await getDriverEarnings(user.uid);
      console.log('[useDriverPayouts] getEarningsSummary: Success:', earningsData);
      setEarnings(earningsData);
      return earningsData;
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to fetch earnings';
      
      // Handle common errors for new users gracefully
      if (errorMessage.includes('Network request timed out') || 
          errorMessage.includes('timeout') ||
          errorMessage.includes('User not found') ||
          errorMessage.includes('No earnings found')) {
        console.log('[useDriverPayouts] getEarningsSummary: New user detected, providing default earnings');
        
        // Provide default earnings for new users who haven't completed any rides
        const defaultEarnings: EarningsData = {
          available: 0,
          pending: 0,
          lifetime: 0,
          lastPayoutAt: null
        };
        
        setEarnings(defaultEarnings);
        setError(null); // Clear error for new users
        return defaultEarnings;
      }
      
      console.error('[useDriverPayouts] getEarningsSummary: Error:', errorMessage, err);
      setError(errorMessage);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Refreshes both payout status and earnings data
   */
  const refreshAll = useCallback(async (): Promise<void> => {
    console.log('[useDriverPayouts] refreshAll: Starting...');
    setLoading(true);
    setError(null);

    try {
      await Promise.all([
        getPayoutStatus(),
        getEarningsSummary(),
      ]);
      console.log('[useDriverPayouts] refreshAll: Success');
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to refresh data';
      console.error('[useDriverPayouts] refreshAll: Error:', errorMessage, err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [getPayoutStatus, getEarningsSummary]);

  return {
    loading,
    error,
    payoutStatus,
    earnings,
    getPayoutStatus,
    addBankAccount,
    removeBankAccount,
    setDefaultBankAccount,
    getEarningsSummary,
    refreshAll,
    clearError,
  };
}
