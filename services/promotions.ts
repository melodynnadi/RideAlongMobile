import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  Timestamp,
} from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { Promotion, ClaimedPromotion } from '@/types';

/**
 * Service for managing promotions from Firestore
 */
export class PromotionService {
  private static instance: PromotionService;
  private readonly COLLECTION_NAME = 'promotions';
  private readonly CLAIMED_COLLECTION_NAME = 'claimedPromotions';

  static getInstance(): PromotionService {
    if (!PromotionService.instance) {
      PromotionService.instance = new PromotionService();
    }
    return PromotionService.instance;
  }

  /**
   * Helper function to safely convert various date formats to Date objects
   */
  private convertToDate(dateField: any): Date {
    if (!dateField) {
      return new Date();
    }

    // If it's already a Date object
    if (dateField instanceof Date) {
      return dateField;
    }

    // If it's a Firestore Timestamp
    if (dateField && typeof dateField.toDate === 'function') {
      return dateField.toDate();
    }

    // If it's a string, try to parse it
    if (typeof dateField === 'string') {
      const parsed = new Date(dateField);
      return isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    // If it's a number (milliseconds)
    if (typeof dateField === 'number') {
      return new Date(dateField);
    }

    // Fallback to current date
    console.warn('Unable to parse date field:', dateField, 'using current date');
    return new Date();
  }

  /**
   * Fetch active promotions for mobile riders
   */
  async getActivePromotions(): Promise<Promotion[]> {
    if (!firestore) throw new Error('Firestore is not initialized');

    const now = new Date();
    const q = query(
      collection(firestore, this.COLLECTION_NAME),
      where('status', '==', 'active'),
    );

    const snapshot = await getDocs(q);
    const promotions: Promotion[] = [];

    snapshot.forEach((doc) => {
      try {
        const data = doc.data();
        const promotion: Promotion = {
          id: doc.id,
          ...data,
          startDate: this.convertToDate(data.startDate).toISOString(),
          endDate: this.convertToDate(data.endDate).toISOString(),
          createdAt: this.convertToDate(data.createdAt).toISOString(),
          updatedAt: this.convertToDate(data.updatedAt).toISOString(),
        } as Promotion;

        const isTargetMatch = promotion.target === 'riders' || promotion.target === 'both';
        const isPlatformMatch = promotion.platforms?.includes('mobile');
        const isTimeValid =
          promotion.type === 'informational'
            ? true
            : promotion.startDate && promotion.endDate && now >= new Date(promotion.startDate) && now <= new Date(promotion.endDate);

        if (isTargetMatch && isPlatformMatch && isTimeValid) {
          promotions.push(promotion);
        }
      } catch {
        // skip malformed document
      }
    });

    return promotions.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.featured !== b.featured) return b.featured ? 1 : -1;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });
  }

  /**
   * Get a specific promotion by ID
   */
  async getPromotionById(promotionId: string): Promise<Promotion | null> {
    try {
      const docRef = doc(firestore, this.COLLECTION_NAME, promotionId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          startDate: this.convertToDate(data.startDate).toISOString(),
          endDate: this.convertToDate(data.endDate).toISOString(),
          createdAt: this.convertToDate(data.createdAt).toISOString(),
          updatedAt: this.convertToDate(data.updatedAt).toISOString(),
        } as Promotion;
      }

      return null;
    } catch (error) {
      console.error('Error fetching promotion:', error);
      throw new Error('Failed to fetch promotion');
    }
  }

  /**
   * Claim a promotion for a user
   */
  async claimPromotion(userId: string, promotionId: string): Promise<ClaimedPromotion> {
    try {
      // Check if already claimed
      const existingClaim = await this.getUserClaimedPromotion(userId, promotionId);
      if (existingClaim) {
        throw new Error('Promotion already claimed');
      }

      // Get promotion to validate
      const promotion = await this.getPromotionById(promotionId);
      if (!promotion) {
        throw new Error('Promotion not found');
      }

      if (promotion.status !== 'active') {
        throw new Error('Promotion is not active');
      }

      const now = new Date();
      if (now < new Date(promotion.startDate) || now > new Date(promotion.endDate)) {
        throw new Error('Promotion is not available');
      }

      // Check usage limit
      if (promotion.usageLimit && promotion.currentUsageCount && promotion.currentUsageCount >= promotion.usageLimit) {
        throw new Error('Promotion usage limit reached');
      }

      // Create claimed promotion record
      const claimedPromotion: Omit<ClaimedPromotion, 'id'> = {
        userId,
        promotionId,
        claimedAt: now,
        status: 'claimed',
      };

      const docRef = await addDoc(collection(firestore, this.CLAIMED_COLLECTION_NAME), {
        ...claimedPromotion,
        claimedAt: Timestamp.fromDate(claimedPromotion.claimedAt),
      });

      // Update promotion usage count
      if (promotion.currentUsageCount !== undefined) {
        const promotionRef = doc(firestore, this.COLLECTION_NAME, promotionId);
        await updateDoc(promotionRef, {
          currentUsageCount: (promotion.currentUsageCount || 0) + 1,
          updatedAt: Timestamp.fromDate(now),
        });
      }

      return {
        id: docRef.id,
        ...claimedPromotion,
      };
    } catch (error) {
      console.error('Error claiming promotion:', error);
      throw error;
    }
  }

  /**
   * Get user's claimed promotions
   */
  async getUserClaimedPromotions(userId: string): Promise<ClaimedPromotion[]> {
    try {
      const claimedRef = collection(firestore, this.CLAIMED_COLLECTION_NAME);
      // Remove orderBy to avoid composite index requirement - we'll sort in memory
      const q = query(
        claimedRef,
        where('userId', '==', userId)
      );

      const snapshot = await getDocs(q);
      const claimedPromotions: ClaimedPromotion[] = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        claimedPromotions.push({
          id: doc.id,
          ...data,
          claimedAt: this.convertToDate(data.claimedAt),
          usedAt: data.usedAt ? this.convertToDate(data.usedAt) : undefined,
        } as ClaimedPromotion);
      });

      // Sort in memory by claimedAt desc to avoid composite index requirement
      return claimedPromotions.sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime());
    } catch (error) {
      console.error('Error fetching claimed promotions:', error);
      throw new Error('Failed to fetch claimed promotions');
    }
  }

  /**
   * Check if user has claimed a specific promotion
   */
  async getUserClaimedPromotion(userId: string, promotionId: string): Promise<ClaimedPromotion | null> {
    try {
      const claimedRef = collection(firestore, this.CLAIMED_COLLECTION_NAME);
      const q = query(
        claimedRef,
        where('userId', '==', userId),
        where('promotionId', '==', promotionId)
      );

      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          claimedAt: this.convertToDate(data.claimedAt),
          usedAt: data.usedAt ? this.convertToDate(data.usedAt) : undefined,
        } as ClaimedPromotion;
      }

      return null;
    } catch (error) {
      console.error('Error checking claimed promotion:', error);
      return null;
    }
  }

  /**
   * Mark a promotion as used
   */
  async usePromotion(claimedPromotionId: string): Promise<void> {
    try {
      const claimedRef = doc(firestore, this.CLAIMED_COLLECTION_NAME, claimedPromotionId);
      await updateDoc(claimedRef, {
        usedAt: Timestamp.fromDate(new Date()),
        status: 'used',
      });
    } catch (error) {
      console.error('Error using promotion:', error);
      throw new Error('Failed to use promotion');
    }
  }

  /**
   * Get promotion display value (e.g., "50% OFF", "$10 CASHBACK")
   */
  getPromotionDisplayValue(promotion: Promotion): string {
    switch (promotion.valueType) {
      case 'percentage':
        return `${promotion.value}% OFF`;
      case 'fixed_amount':
        return `$${promotion.value} OFF`;
      case 'multiplier':
        return `${promotion.value}x REWARDS`;
      default:
        return `${promotion.value}`;
    }
  }

  /**
   * Check if promotion is expiring soon (within 24 hours)
   */
  isExpiringSoon(promotion: Promotion): boolean {
    const now = new Date();
    const timeDiff = new Date(promotion.endDate).getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 3600);
    return hoursDiff <= 24 && hoursDiff > 0;
  }

  /**
   * Get days until expiry
   */
  getDaysUntilExpiry(promotion: Promotion): number {
    const now = new Date();
    const timeDiff = new Date(promotion.endDate).getTime() - now.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

}

// Export singleton instance
export const promotionService = PromotionService.getInstance();