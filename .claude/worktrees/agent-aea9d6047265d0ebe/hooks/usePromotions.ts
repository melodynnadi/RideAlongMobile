import { useState, useEffect, useCallback } from 'react';
import { Promotion, ClaimedPromotion } from '@/types';
import { promotionService } from '@/services/promotions';
import { firebaseAuth } from '@/constants/services';
import { onAuthStateChanged } from 'firebase/auth';

interface UsePromotionsReturn {
  promotions: Promotion[];
  claimedPromotions: ClaimedPromotion[];
  loading: boolean;
  error: string | null;
  refreshPromotions: () => Promise<void>;
  claimPromotion: (promotionId: string) => Promise<void>;
  isPromotionClaimed: (promotionId: string) => boolean;
}

/**
 * Hook for managing promotions state and operations
 */
export const usePromotions = (): UsePromotionsReturn => {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [claimedPromotions, setClaimedPromotions] = useState<ClaimedPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Track auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      setUserId(user?.uid || null);
    });

    return unsubscribe;
  }, []);

  /**
   * Fetch active promotions from Firestore
   */
  const fetchPromotions = useCallback(async () => {
    try {
      setError(null);
      console.log('usePromotions: Starting to fetch promotions...');
      
      // Test connection first
      const connectionTest = await promotionService.testConnection();
      if (!connectionTest) {
        throw new Error('Cannot connect to Firestore. Check your internet connection and Firebase configuration.');
      }
      
      const activePromotions = await promotionService.getActivePromotions();
      console.log('usePromotions: Successfully fetched', activePromotions.length, 'promotions');
      setPromotions(activePromotions);
    } catch (err) {
      let errorMessage = 'Failed to fetch promotions';
      
      if (err instanceof Error) {
        errorMessage = err.message;
        
        // Provide more specific error messages based on error type
        if (err.message.includes('network')) {
          errorMessage = 'Network error. Please check your internet connection.';
        } else if (err.message.includes('permission') || err.message.includes('unauthorized')) {
          errorMessage = 'Permission denied. Please check Firebase security rules.';
        } else if (err.message.includes('not-found')) {
          errorMessage = 'Promotions collection not found. Please set up the database.';
        }
      }
      
      setError(errorMessage);
      console.error('Error fetching promotions:', err);
      console.error('Error type:', typeof err);
      console.error('Error constructor:', err?.constructor?.name);
    }
  }, []);

  /**
   * Fetch user's claimed promotions
   */
  const fetchClaimedPromotions = useCallback(async () => {
    if (!userId) {
      setClaimedPromotions([]);
      return;
    }

    try {
      const claimed = await promotionService.getUserClaimedPromotions(userId);
      setClaimedPromotions(claimed);
    } catch (err) {
      console.error('Error fetching claimed promotions:', err);
      // Don't set error for claimed promotions, as it's not critical
    }
  }, [userId]);

  /**
   * Refresh all promotions data
   */
  const refreshPromotions = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchPromotions(),
        fetchClaimedPromotions(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [fetchPromotions, fetchClaimedPromotions]);

  /**
   * Claim a promotion for the current user
   */
  const claimPromotion = useCallback(async (promotionId: string) => {
    if (!userId) {
      throw new Error('User must be authenticated to claim promotions');
    }

    try {
      setError(null);
      const claimedPromotion = await promotionService.claimPromotion(userId, promotionId);
      
      // Update local state
      setClaimedPromotions(prev => [claimedPromotion, ...prev]);
      
      // Optionally refresh promotions to get updated usage count
      await fetchPromotions();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to claim promotion';
      setError(errorMessage);
      throw err;
    }
  }, [userId, fetchPromotions]);

  /**
   * Check if a promotion is already claimed by the user
   */
  const isPromotionClaimed = useCallback((promotionId: string): boolean => {
    return claimedPromotions.some(claimed => claimed.promotionId === promotionId);
  }, [claimedPromotions]);

  // Initial data fetch
  useEffect(() => {
    refreshPromotions();
  }, [refreshPromotions]);

  // Fetch claimed promotions when user changes
  useEffect(() => {
    if (userId) {
      fetchClaimedPromotions();
    } else {
      setClaimedPromotions([]);
    }
  }, [userId, fetchClaimedPromotions]);

  return {
    promotions,
    claimedPromotions,
    loading,
    error,
    refreshPromotions,
    claimPromotion,
    isPromotionClaimed,
  };
};

/**
 * Hook for managing a single promotion
 */
export const usePromotion = (promotionId: string) => {
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPromotion = async () => {
      try {
        setLoading(true);
        setError(null);
        const fetchedPromotion = await promotionService.getPromotionById(promotionId);
        setPromotion(fetchedPromotion);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch promotion';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    if (promotionId) {
      fetchPromotion();
    }
  }, [promotionId]);

  return { promotion, loading, error };
};