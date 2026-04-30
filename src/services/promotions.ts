import { 
  collection, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  onSnapshot,
  Timestamp,
  DocumentData
} from 'firebase/firestore';
import { firestore } from '../../constants/services';
import { Promotion, PromotionTarget, PromotionPlatform } from '../../types';

/**
 * Fetch active promotions for drivers from Firestore
 * Filters by:
 * - target: "drivers" or "both"
 * - platforms: includes "mobile"
 * - status: "active"
 * - Current date is between startDate and endDate
 * 
 * Sorts by:
 * - priority (1 = highest)
 * - featured status (featured first)
 */
export const fetchActiveDriverPromotions = async (): Promise<Promotion[]> => {
  try {
    const promotionsRef = collection(firestore, 'promotions');
    const now = new Date();
    
    // Simplified query - sort in-memory to avoid index requirements
    // Once you create the composite index, you can use the original query
    const q = query(
      promotionsRef,
      where('status', '==', 'active')
    );
    
    const snapshot = await getDocs(q);
    const promotions: Promotion[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data() as DocumentData;
      
      // Filter by target (drivers or both)
      const target = data.target as PromotionTarget;
      if (target !== 'drivers' && target !== 'both') {
        return;
      }
      
      // Filter by platform (mobile)
      const platforms = data.platforms as PromotionPlatform[];
      if (!platforms || !platforms.includes('mobile')) {
        return;
      }
      
      // Filter by date range
      const startDate = data.startDate ? parseFirestoreDate(data.startDate) : null;
      const endDate = data.endDate ? parseFirestoreDate(data.endDate) : null;
      
      if (startDate && now < startDate) {
        return; // Not started yet
      }
      
      if (endDate && now > endDate) {
        return; // Already expired
      }
      
      // Check usage limits
      if (data.totalUsageLimit && data.currentUsageCount >= data.totalUsageLimit) {
        return; // Promotion fully used
      }
      
      promotions.push({
        id: doc.id,
        ...data,
        startDate: data.startDate,
        endDate: data.endDate,
      } as Promotion);
    });
    
    // Sort in-memory: by priority (asc) then featured (desc)
    promotions.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority number = higher priority
      }
      return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); // Featured first
    });
    
    return promotions;
  } catch (error) {
    console.error('Error fetching driver promotions:', error);
    return [];
  }
};

/**
 * Subscribe to real-time updates for active driver promotions
 * Returns an unsubscribe function
 */
export const subscribeToDriverPromotions = (
  callback: (promotions: Promotion[]) => void
): (() => void) => {
  try {
    const promotionsRef = collection(firestore, 'promotions');
    
    // Simplified query - sort in-memory to avoid index requirements
    const q = query(
      promotionsRef,
      where('status', '==', 'active')
    );
    
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const now = new Date();
        const promotions: Promotion[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data() as DocumentData;
          
          // Apply same filters as fetchActiveDriverPromotions
          const target = data.target as PromotionTarget;
          if (target !== 'drivers' && target !== 'both') {
            return;
          }
          
          const platforms = data.platforms as PromotionPlatform[];
          if (!platforms || !platforms.includes('mobile')) {
            return;
          }
          
          const startDate = data.startDate ? parseFirestoreDate(data.startDate) : null;
          const endDate = data.endDate ? parseFirestoreDate(data.endDate) : null;
          
          if (startDate && now < startDate) {
            return;
          }
          
          if (endDate && now > endDate) {
            return;
          }
          
          if (data.totalUsageLimit && data.currentUsageCount >= data.totalUsageLimit) {
            return;
          }
          
          promotions.push({
            id: doc.id,
            ...data,
            startDate: data.startDate,
            endDate: data.endDate,
          } as Promotion);
        });
        
        // Sort in-memory: by priority (asc) then featured (desc)
        promotions.sort((a, b) => {
          if (a.priority !== b.priority) {
            return a.priority - b.priority;
          }
          return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
        });
        
        callback(promotions);
      },
      (error) => {
        console.error('Error in promotions subscription:', error);
        callback([]);
      }
    );
    
    return unsubscribe;
  } catch (error) {
    console.error('Error setting up promotions subscription:', error);
    return () => {}; // Return no-op unsubscribe
  }
};

/**
 * Helper function to parse Firestore date fields
 * Handles both Timestamp objects and ISO string dates
 */
const parseFirestoreDate = (date: any): Date | null => {
  if (!date) return null;
  
  // Firestore Timestamp
  if (date instanceof Timestamp) {
    return date.toDate();
  }
  
  // ISO string
  if (typeof date === 'string') {
    return new Date(date);
  }
  
  // Already a Date object
  if (date instanceof Date) {
    return date;
  }
  
  return null;
};

/**
 * Format promotion value for display
 * e.g., "$50 BONUS", "20% OFF", "2x EARNINGS"
 */
export const formatPromotionValue = (promotion: Promotion): string => {
  const { value, valueType, type } = promotion;
  
  switch (valueType) {
    case 'fixed_amount':
      return `$${value}`;
    case 'percentage':
      return `${value}%`;
    case 'multiplier':
      return `${value}x`;
    default:
      return String(value);
  }
};

/**
 * Get promotion display badge text
 * e.g., "+$50 BONUS", "50% EXTRA EARNINGS"
 */
export const getPromotionBadgeText = (promotion: Promotion): string => {
  const formattedValue = formatPromotionValue(promotion);
  
  switch (promotion.type) {
    case 'bonus':
      return `+${formattedValue} BONUS`;
    case 'referral':
      return `${formattedValue} REFERRAL`;
    case 'discount':
      return `${formattedValue} OFF`;
    case 'reward':
      return `${formattedValue} REWARD`;
    default:
      return formattedValue;
  }
};

/**
 * Calculate days remaining until promotion expires
 */
export const getDaysRemaining = (endDate: string): number => {
  const end = parseFirestoreDate(endDate);
  if (!end) return 0;
  
  const now = new Date();
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
};

/**
 * Format expiry text for display
 * e.g., "Expires in 3 days", "Expires today", "Expires tomorrow"
 */
export const getExpiryText = (endDate: string): string => {
  const days = getDaysRemaining(endDate);
  
  if (days === 0) {
    return 'Expires today';
  } else if (days === 1) {
    return 'Expires tomorrow';
  } else if (days <= 7) {
    return `Expires in ${days} days`;
  } else {
    const end = parseFirestoreDate(endDate);
    if (end) {
      return `Expires ${end.toLocaleDateString()}`;
    }
    return '';
  }
};
