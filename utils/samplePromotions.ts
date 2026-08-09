/**
 * Utility functions for testing the promotions system
 * Use these to populate your Firestore with sample promotion data
 */

import { firestore } from '@/constants/services';
import { collection, addDoc, Timestamp, query, limit, getDocs } from 'firebase/firestore';

interface SamplePromotionData {
  title: string;
  description: string;
  category: string;
  categoryName: string;
  target: 'riders' | 'drivers' | 'both';
  platforms: ('mobile' | 'web')[];
  type: 'discount' | 'cashback' | 'referral' | 'reward';
  value: number;
  valueType: 'percentage' | 'fixed' | 'credit';
  maxDiscount?: number;
  minOrderAmount?: number;
  startDate: Date;
  endDate: Date;
  imageUrl?: string;
  backgroundColor: string;
  textColor: string;
  priority: number;
  featured: boolean;
  status: 'active' | 'inactive' | 'expired';
  usageLimit?: number;
  usageCount?: number;
  code?: string;
  terms?: string;
}

/**
 * Sample promotion data for testing
 */
export const samplePromotions: SamplePromotionData[] = [
  {
    title: 'Winter Holiday Special',
    description: 'Get 50% off your next 3 rides! Perfect for holiday shopping trips.',
    category: 'seasonal-offers',
    categoryName: 'Seasonal Offers',
    target: 'riders',
    platforms: ['mobile', 'web'],
    type: 'discount',
    value: 50,
    valueType: 'percentage',
    maxDiscount: 25.00,
    minOrderAmount: 15.00,
    startDate: new Date('2024-12-01'),
    endDate: new Date('2025-01-15'),
    backgroundColor: '#DC2626',
    textColor: '#FFFFFF',
    priority: 1,
    featured: true,
    status: 'active',
    usageLimit: 1000,
    usageCount: 0,
    code: 'WINTER50',
    terms: 'Valid for new rides only. Cannot be combined with other offers. Maximum 3 uses per user.',
  },
  {
    title: 'Eco-Friendly Rides',
    description: 'Choose electric or hybrid vehicles and get 10% off your ride.',
    category: 'eco-friendly',
    categoryName: 'Eco-Friendly',
    target: 'both',
    platforms: ['mobile'],
    type: 'discount',
    value: 10,
    valueType: 'percentage',
    maxDiscount: 15.00,
    startDate: new Date('2024-11-01'),
    endDate: new Date('2025-03-31'),
    backgroundColor: '#059669',
    textColor: '#FFFFFF',
    priority: 2,
    featured: false,
    status: 'active',
    usageLimit: 500,
    usageCount: 0,
    terms: 'Valid only for rides in electric or hybrid vehicles. Subject to vehicle availability.',
  },
  {
    title: 'Refer a Friend',
    description: 'You and your friend both get $5 credit when they take their first ride!',
    category: 'referral',
    categoryName: 'Referral Rewards',
    target: 'riders',
    platforms: ['mobile', 'web'],
    type: 'referral',
    value: 5,
    valueType: 'credit',
    startDate: new Date('2024-10-01'),
    endDate: new Date('2025-12-31'),
    backgroundColor: '#7C3AED',
    textColor: '#FFFFFF',
    priority: 3,
    featured: false,
    status: 'active',
    terms: 'Credit applied after referred friend completes their first ride. No limit on referrals.',
  },
  {
    title: 'First Ride Free',
    description: 'New to RideAlong? Get your first ride completely free (up to $20)!',
    category: 'new-user',
    categoryName: 'New User Offers',
    target: 'riders',
    platforms: ['mobile'],
    type: 'discount',
    value: 100,
    valueType: 'percentage',
    maxDiscount: 20.00,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2025-12-31'),
    backgroundColor: '#EA580C',
    textColor: '#FFFFFF',
    priority: 1,
    featured: true,
    status: 'active',
    code: 'WELCOME',
    terms: 'Valid for new users only. One-time use. Maximum discount $20.',
  },
  {
    title: 'Weekend Cashback',
    description: 'Get $3 cashback on all weekend rides! Perfect for your weekend adventures.',
    category: 'weekend-special',
    categoryName: 'Weekend Specials',
    target: 'riders',
    platforms: ['mobile', 'web'],
    type: 'cashback',
    value: 3,
    valueType: 'fixed',
    minOrderAmount: 10.00,
    startDate: new Date('2024-11-01'),
    endDate: new Date('2025-02-28'),
    backgroundColor: '#0891B2',
    textColor: '#FFFFFF',
    priority: 2,
    featured: false,
    status: 'active',
    terms: 'Valid on Saturday and Sunday only. Cashback credited within 24 hours. Minimum ride cost $10.',
  },
  {
    title: 'Student Discount',
    description: 'Show your student ID and get 15% off all rides during the semester.',
    category: 'student-offers',
    categoryName: 'Student Offers',
    target: 'riders',
    platforms: ['mobile'],
    type: 'discount',
    value: 15,
    valueType: 'percentage',
    maxDiscount: 12.00,
    startDate: new Date('2024-09-01'),
    endDate: new Date('2025-05-31'),
    backgroundColor: '#DB2777',
    textColor: '#FFFFFF',
    priority: 4,
    featured: false,
    status: 'active',
    code: 'STUDENT15',
    terms: 'Valid student ID required. Verification may be requested. Academic year only.',
  },
];

/**
 * Populate Firestore with sample promotion data
 * Call this function to add test promotions to your database
 */
export async function createSamplePromotions(): Promise<void> {
  try {
    const promotionsRef = collection(firestore, 'promotions');
    
    for (const promotion of samplePromotions) {
      const promotionData = {
        ...promotion,
        startDate: Timestamp.fromDate(promotion.startDate),
        endDate: Timestamp.fromDate(promotion.endDate),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      
      const docRef = await addDoc(promotionsRef, promotionData);
      console.log('Created promotion:', docRef.id, promotion.title);
    }
    
    console.log('✅ Sample promotions created successfully!');
  } catch (error) {
    console.error('❌ Error creating sample promotions:', error);
    throw error;
  }
}

/**
 * Helper function to create a single custom promotion
 */
export async function createCustomPromotion(promotionData: Partial<SamplePromotionData>): Promise<string> {
  try {
    const promotionsRef = collection(firestore, 'promotions');
    
    const defaultData: SamplePromotionData = {
      title: 'Custom Promotion',
      description: 'Custom promotion description',
      category: 'custom',
      categoryName: 'Custom Offers',
      target: 'riders',
      platforms: ['mobile'],
      type: 'discount',
      value: 10,
      valueType: 'percentage',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      backgroundColor: '#6366F1',
      textColor: '#FFFFFF',
      priority: 5,
      featured: false,
      status: 'active',
    };
    
    const finalData = {
      ...defaultData,
      ...promotionData,
      startDate: Timestamp.fromDate(promotionData.startDate || defaultData.startDate),
      endDate: Timestamp.fromDate(promotionData.endDate || defaultData.endDate),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    
    const docRef = await addDoc(promotionsRef, finalData);
    console.log('Created custom promotion:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Error creating custom promotion:', error);
    throw error;
  }
}

/**
 * Test Firestore connection and basic functionality
 */
export async function testFirestoreConnection(): Promise<void> {
  try {
    console.log('🔍 Testing Firestore connection...');
    
    // Test 1: Basic Firestore instance
    if (!firestore) {
      throw new Error('❌ Firestore instance not found');
    }
    console.log('✅ Firestore instance exists');
    
    // Test 2: Try to access promotions collection
    const promotionsRef = collection(firestore, 'promotions');
    if (!promotionsRef) {
      throw new Error('❌ Cannot create collection reference');
    }
    console.log('✅ Collection reference created');
    
    // Test 3: Try a simple query
    const q = query(promotionsRef, limit(1));
    const snapshot = await getDocs(q);
    console.log('✅ Query executed successfully');
    console.log('📊 Documents in collection:', snapshot.size);
    
    if (snapshot.size === 0) {
      console.log('⚠️  No promotions found in collection. You may need to create sample data.');
      console.log('💡 Run createSamplePromotions() to add test data.');
    } else {
      snapshot.forEach((doc) => {
        console.log('📄 Sample document:', doc.id, Object.keys(doc.data()));
      });
    }
    
    console.log('🎉 Firestore connection test completed successfully!');
    
  } catch (error) {
    console.error('❌ Firestore connection test failed:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('network')) {
        console.log('💡 Solution: Check your internet connection');
      } else if (error.message.includes('permission') || error.message.includes('PERMISSION_DENIED')) {
        console.log('💡 Solution: Check Firestore security rules');
        console.log('💡 Rules should allow: allow read: if true; for promotions collection');
      } else if (error.message.includes('project')) {
        console.log('💡 Solution: Check Firebase project configuration in constants/services.ts');
      } else {
        console.log('💡 Check Firebase console and ensure the project is properly configured');
      }
    }
    
    throw error;
  }
}

/**
 * Quick debug function to check current promotions
 */
export async function debugPromotions(): Promise<void> {
  try {
    const { promotionService } = await import('@/services/promotions');
    console.log('🔍 Debugging promotions...');
    
    const promotions = await promotionService.getActivePromotions();
    console.log('📊 Active promotions found:', promotions.length);
    
    promotions.forEach((promo, index) => {
      console.log(`📄 Promotion ${index + 1}:`, {
        id: promo.id,
        title: promo.title,
        target: promo.target,
        platforms: promo.platforms,
        status: promo.status,
        startDate: new Date(promo.startDate).toISOString(),
        endDate: new Date(promo.endDate).toISOString()
      });
    });
  } catch (error) {
    console.error('❌ Debug promotions failed:', error);
  }
}

// Export for easy use in development
export { firestore };