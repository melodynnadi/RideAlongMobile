import { 
  collection, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  doc, 
  getDoc, 
  addDoc, 
  updateDoc,
  limit,
  Timestamp 
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
    try {
      console.log('Fetching promotions from Firestore...');
      
      // Validate Firestore connection
      if (!firestore) {
        throw new Error('Firestore is not initialized');
      }
      
      const now = new Date();
      const promotionsRef = collection(firestore, this.COLLECTION_NAME);
      
      console.log('Collection reference created:', this.COLLECTION_NAME);
      
      // Simplified query to avoid composite index requirements
      // We'll do the filtering and sorting in memory
      const q = query(
        promotionsRef,
        where('status', '==', 'active')
      );

      console.log('Executing Firestore query...');
      const snapshot = await getDocs(q);
      console.log('Query executed successfully. Document count:', snapshot.size);
      
      const promotions: Promotion[] = [];

      snapshot.forEach((doc) => {
        try {
          const data = doc.data();
          console.log('Processing document:', doc.id, 'data keys:', Object.keys(data));
          
          const promotion: Promotion = {
            id: doc.id,
            ...data,
            startDate: this.convertToDate(data.startDate),
            endDate: this.convertToDate(data.endDate),
            createdAt: this.convertToDate(data.createdAt),
            updatedAt: this.convertToDate(data.updatedAt),
          } as Promotion;
          
          // Filter in memory to avoid complex composite indexes
          const isTargetMatch = promotion.target === 'riders' || promotion.target === 'both';
          const isPlatformMatch = promotion.platforms?.includes('mobile');
          
          // For informational promotions, allow null dates (always valid)
          // For other promotions, check date validity
          const isTimeValid = promotion.type === 'informational' 
            ? true 
            : (promotion.startDate && promotion.endDate && now >= promotion.startDate && now <= promotion.endDate);
          
          console.log('Promotion filters:', {
            id: doc.id,
            type: promotion.type,
            target: promotion.target,
            isTargetMatch,
            platforms: promotion.platforms,
            isPlatformMatch,
            isTimeValid,
            startDate: promotion.startDate,
            endDate: promotion.endDate
          });
          
          if (isTargetMatch && isPlatformMatch && isTimeValid) {
            promotions.push(promotion);
          }
        } catch (docError) {
          console.error('Error processing document:', doc.id, docError);
        }
      });

      console.log('Filtered promotions count:', promotions.length);

      // Sort in memory: priority (1 = highest), featured first, then by creation date
      const sortedPromotions = promotions.sort((a, b) => {
        // First by priority (lower number = higher priority)
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        // Then by featured status
        if (a.featured !== b.featured) {
          return b.featured ? 1 : -1; // featured items first
        }
        // Finally by creation date (newest first)
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      
      console.log('Returning', sortedPromotions.length, 'sorted promotions');
      return sortedPromotions;
    } catch (error) {
      console.error('Error fetching promotions:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: (error as any)?.code,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Throw the original error to preserve debugging information
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(`Failed to fetch promotions: ${String(error)}`);
      }
    }
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
          startDate: this.convertToDate(data.startDate),
          endDate: this.convertToDate(data.endDate),
          createdAt: this.convertToDate(data.createdAt),
          updatedAt: this.convertToDate(data.updatedAt),
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
      if (now < promotion.startDate || now > promotion.endDate) {
        throw new Error('Promotion is not available');
      }

      // Check usage limit
      if (promotion.usageLimit && promotion.usageCount && promotion.usageCount >= promotion.usageLimit) {
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
      if (promotion.usageCount !== undefined) {
        const promotionRef = doc(firestore, this.COLLECTION_NAME, promotionId);
        await updateDoc(promotionRef, {
          usageCount: (promotion.usageCount || 0) + 1,
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
      case 'fixed':
        return `$${promotion.value} OFF`;
      case 'credit':
        return `$${promotion.value} CREDIT`;
      default:
        return `${promotion.value}`;
    }
  }

  /**
   * Check if promotion is expiring soon (within 24 hours)
   */
  isExpiringSoon(promotion: Promotion): boolean {
    const now = new Date();
    const timeDiff = promotion.endDate.getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 3600);
    return hoursDiff <= 24 && hoursDiff > 0;
  }

  /**
   * Get days until expiry
   */
  getDaysUntilExpiry(promotion: Promotion): number {
    const now = new Date();
    const timeDiff = promotion.endDate.getTime() - now.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
  }

  /**
   * Test Firestore connection
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing Firestore connection...');
      const promotionsRef = collection(firestore, this.COLLECTION_NAME);
      
      // Try to get just 1 document to test connection
      const testQuery = query(promotionsRef, limit(1));
      const snapshot = await getDocs(testQuery);
      
      console.log('Firestore connection test successful. Found', snapshot.size, 'documents');
      return true;
    } catch (error) {
      console.error('Firestore connection test failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const promotionService = PromotionService.getInstance();