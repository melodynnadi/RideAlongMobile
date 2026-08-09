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
      const activePromotions = await promotionService.getActivePromotions();
      setPromotions(activePromotions);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch promotions';
      setError(errorMessage);
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

  // Initial data fetch — run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshPromotions(); }, []);

  // Re-fetch claimed promotions when auth state changes
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