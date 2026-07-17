export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  isVerified: boolean;
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
  placeId?: string;
}

export interface Driver {
  id: string;
  user: User;
  vehicleInfo: VehicleInfo;
  rating: number;
  totalRides: number;
  isActive: boolean;
  currentLocation?: Location;
}

export interface VehicleInfo {
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  seats: number;
}

export interface RideRequest {
  id: string;
  driverId: string;
  pickupLocation: Location;
  dropoffLocation: Location;
  requestedTime: Date;
  seats: number;
  notes?: string;
  status: 'pending' | 'matched' | 'in-progress' | 'completed' | 'cancelled';
  estimatedFare?: number;
  distance?: number;
  duration?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Ride {
  id: string;
  rideRequest: RideRequest;
  driver: Driver;
  pickupTime?: Date;
  startTime?: Date;
  endTime?: Date;
  actualFare?: number;
  route?: RoutePoint[];
  status: 'matched' | 'driver-arriving' | 'in-progress' | 'completed' | 'cancelled';
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: Date;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'paypal' | 'apple-pay' | 'google-pay';
  isDefault: boolean;
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  addedAt?: any; // Can be Date or Firestore timestamp
}

export interface RidePreferences {
  allowSmoking: boolean;
  allowPets: boolean;
  musicPreference: 'none' | 'quiet' | 'normal' | 'loud';
  temperaturePreference: 'cold' | 'normal' | 'warm';
  conversationLevel: 'quiet' | 'normal' | 'chatty';
}

export interface UserPreferences {
  musicPreference: string[];
  soundEnvironment: string;
  conversationLevel: string;
  smokingPreference: string;
  driverGender: string;
  passengerType: string;
  preferencesUpdatedAt?: string;
}

export interface LegalDocument {
  id: string;
  title: string;
  content: string;
  lastUpdated: string;
  version?: string;
}

export interface LegalDocumentCache {
  document: LegalDocument;
  timestamp: number;
  expiresAt: number;
}

export interface LegalDocumentServiceResponse {
  success: boolean;
  document?: LegalDocument;
  error?: string;
  fromCache?: boolean;
}

// Promotion Types
export interface PromotionConditions {
  minRides?: number;
  maxRides?: number;
  timeRange?: {
    start: string; // HH:MM format
    end: string;   // HH:MM format
  };
  dayOfWeek?: string[]; // ["monday", "tuesday", etc.]
  specificCities?: string[];
  minDistance?: number; // in miles
  maxDistance?: number;
  vehicleTypes?: string[]; // ["sedan", "suv", "eco", etc.]
}

export type PromotionTarget = 'riders' | 'drivers' | 'both';
export type PromotionPlatform = 'web' | 'mobile' | 'both';
export type PromotionType = 'bonus' | 'referral' | 'discount' | 'reward' | 'informational';
export type PromotionValueType = 'fixed_amount' | 'percentage' | 'multiplier';
export type PromotionStatus = 'active' | 'inactive' | 'expired' | 'scheduled';

export interface Promotion {
  id: string;
  title: string;
  description: string;
  category: string;
  categoryName: string;
  target: PromotionTarget;
  platforms: PromotionPlatform[];
  type: PromotionType;
  value: number;
  valueType: PromotionValueType;
  
  // Conditions for eligibility
  conditions?: PromotionConditions;
  
  // Usage limits
  usageLimit?: number; // Per user
  totalUsageLimit?: number; // Global
  currentUsageCount?: number;
  
  // Dates
  startDate: string; // ISO 8601 format
  endDate: string;   // ISO 8601 format
  
  // Visual styling
  backgroundColor?: string;
  textColor?: string;
  imageUrl?: string;
  iconName?: string;
  icon?: string;
  
  // For informational promotions
  linkText?: string;
  linkUrl?: string;
  
  // Priority and features
  priority: number; // 1 = highest
  featured: boolean;
  
  // Terms and conditions
  termsAndConditions?: string;
  requiresActivation?: boolean;
  
  // Status
  status: PromotionStatus;
  
  // Metadata
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

// A promotion a user has claimed (mobile-side record in `claimedPromotions`)
export interface ClaimedPromotion {
  id: string;
  userId: string;
  promotionId: string;
  claimedAt: Date;
  usedAt?: Date;
  status: 'claimed' | 'used' | 'expired';
}

// For tracking user's active promotions and progress
export interface UserPromotionProgress {
  id: string;
  userId: string;
  promotionId: string;
  status: 'activated' | 'in_progress' | 'completed' | 'expired';
  progress?: {
    currentRides?: number;
    currentEarnings?: number;
    completedTasks?: string[];
  };
  activatedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  rewardEarned?: number;
}

// Payout and Earnings Types
export interface BankAccount {
  id: string;
  bankName: string;
  accountHolderName: string;
  accountType: 'checking' | 'savings';
  last4: string;
  routingNumber?: string;
  isDefault: boolean;
  status?: 'new' | 'verified' | 'verification_failed' | 'errored';
}

export interface PayoutStatus {
  userId: string;
  stripeAccountId?: string;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  bankAccounts: BankAccount[];
  requirements?: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
  };
  hasOnboardingIssues?: boolean;
}

export interface EarningsData {
  available: number;
  pending: number;
  lifetime: number;
  lastPayoutAt?: string | null;
}

export interface AddBankAccountPayload {
  accountHolderName: string;
  accountNumber: string;
  routingNumber: string;
  accountType: 'individual' | 'company';
}
