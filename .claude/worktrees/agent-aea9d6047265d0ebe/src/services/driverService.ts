import { 
  doc, 
  getDoc, 
  updateDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { logActivity } from '@/src/services/activity';

export interface DriverPreferences {
  genderPreference: string;
  smokingPreference: string;
  talkativeness: string;
  musicPreferences: string[];
  maxPassengers: number;
  personality: string;
}

export interface DriverData {
  // Core identification
  userUid: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  
  // Status
  status: string;
  applicationStatus: string;
  
  // Preferences
  genderPreference: string;
  smokingPreference: string;
  talkativeness: string;
  musicPreferences: string[];
  maxPassengers: number;
  personality: string;
  
  // Profile
  profilePicture?: string;
  avatarUrl?: string;
  rating: number;
  ratingSum: number;
  ratingCount: number;
  reviewCount: number;
  ridesCompleted: number;
  
  // Personal info
  personalInfo: {
    dateOfBirth: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    university: string;
  };
  
  // License info
  licenseInfo: {
    licenseNumber: string;
    licenseState: string;
    licenseExpiry: string;
  };
  
  // Insurance info
  insuranceInfo: {
    company: string;
    policyNumber: string;
    coverageAmount: string;
    expiryDate: string;
  };
  
  // Vehicle info
  vehicleInfo?: {
    color: string;
    imageList?: string;
  };
  
  // Agreements
  agreements: {
    backgroundCheckAgreed: boolean;
    driverAgreed: boolean;
    studentConfirmed: boolean;
    termsAgreed: boolean;
  };
  
  // Metadata
  meta: {
    milesTravelled: number;
  };
  
  // Timestamps
  createdAt: any;
  submissionDate: any;
  approvalDate?: any;
  updatedAt: any;
}

/**
 * Get driver data from the drivers collection
 */
export async function getDriverData(): Promise<DriverData | null> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const driverRef = doc(firestore, 'drivers', user.uid);
    const driverSnap = await getDoc(driverRef);
    
    if (!driverSnap.exists()) {
      return null;
    }
    
    return driverSnap.data() as DriverData;
  } catch (error) {
    console.error('Error fetching driver data:', error);
    throw new Error('Failed to fetch driver data');
  }
}

/**
 * Get driver preferences only
 */
export async function getDriverPreferences(): Promise<DriverPreferences | null> {
  const driverData = await getDriverData();
  
  if (!driverData) {
    return null;
  }
  
  return {
    genderPreference: driverData.genderPreference || 'No preference',
    smokingPreference: driverData.smokingPreference || 'No Smoking',
    talkativeness: driverData.talkativeness || 'Moderate',
    musicPreferences: driverData.musicPreferences || [],
    maxPassengers: driverData.maxPassengers || 1,
    personality: driverData.personality || 'Podcast/Radio',
  };
}

/**
 * Update driver preferences in the drivers collection
 */
export async function updateDriverPreferences(preferences: Partial<DriverPreferences>): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const driverRef = doc(firestore, 'drivers', user.uid);
    
    // Check if driver exists
    const driverSnap = await getDoc(driverRef);
    if (!driverSnap.exists()) {
      throw new Error('Driver profile not found');
    }
    
    // Update the preferences
    await updateDoc(driverRef, {
      ...preferences,
      updatedAt: serverTimestamp(),
    });
    
    // Log the activity
    await logActivity({
      type: 'profile_updated',
      entityType: 'driver_profile',
      entityId: user.uid,
      metadata: { 
        fields: Object.keys(preferences),
        preferences 
      },
    });
    
  } catch (error) {
    console.error('Error updating driver preferences:', error);
    throw new Error('Failed to update driver preferences');
  }
}

/**
 * Map form data to driver preferences format
 */
export function mapFormToDriverPreferences(formData: {
  musicTaste: string[];
  soundEnvironment: string;
  conversationLevel: string;
  smokingPreference: string;
  driverGenderPreference: string;
  passengerTypePreference: string;
}): Partial<DriverPreferences> {
  // Map conversation level to talkativeness
  const talkativenessMap: Record<string, string> = {
    'Quiet/No conversation': 'Quiet',
    'Light conversation': 'Light',
    'Moderate conversation': 'Moderate',
    'Chatty/Social': 'Talkative'
  };
  
  // Map sound environment to personality
  const personalityMap: Record<string, string> = {
    'Quiet environment': 'Quiet',
    'Background music': 'Music',
    'Moderate volume': 'Podcast/Radio',
    'Lively atmosphere': 'Social'
  };
  
  // Map smoking preference
  const smokingMap: Record<string, string> = {
    'Non-smoking only': 'No Smoking',
    'Smoking allowed': 'Smoking',
    'No preference': 'No preference'
  };
  
  // Map gender preference
  const genderMap: Record<string, string> = {
    'No preference': 'No preference',
    'Male driver': 'Male',
    'Female driver': 'Female'
  };
  
  // Map passenger type to max passengers
  const maxPassengersMap: Record<string, number> = {
    'Students only': 1,
    'Professionals only': 1,
    'Mixed groups': 2,
    'No preference': 1
  };
  
  return {
    musicPreferences: formData.musicTaste,
    talkativeness: talkativenessMap[formData.conversationLevel] || 'Moderate',
    personality: personalityMap[formData.soundEnvironment] || 'Podcast/Radio',
    smokingPreference: smokingMap[formData.smokingPreference] || 'No Smoking',
    genderPreference: genderMap[formData.driverGenderPreference] || 'No preference',
    maxPassengers: maxPassengersMap[formData.passengerTypePreference] || 1,
  };
}

/**
 * Map driver preferences to form data format
 */
export function mapDriverPreferencesToForm(driverPrefs: DriverPreferences) {
  // Reverse mapping for conversation level
  const conversationLevelMap: Record<string, string> = {
    'Quiet': 'Quiet/No conversation',
    'Light': 'Light conversation',
    'Moderate': 'Moderate conversation',
    'Talkative': 'Chatty/Social'
  };
  
  // Reverse mapping for sound environment
  const soundEnvironmentMap: Record<string, string> = {
    'Quiet': 'Quiet environment',
    'Music': 'Background music',
    'Podcast/Radio': 'Moderate volume',
    'Social': 'Lively atmosphere'
  };
  
  // Reverse mapping for smoking preference
  const smokingReverseMap: Record<string, string> = {
    'No Smoking': 'Non-smoking only',
    'Smoking': 'Smoking allowed',
    'No preference': 'No preference'
  };
  
  // Reverse mapping for gender preference
  const genderReverseMap: Record<string, string> = {
    'No preference': 'No preference',
    'Male': 'Male driver',
    'Female': 'Female driver'
  };
  
  // Reverse mapping for max passengers to passenger type
  const passengerTypeMap: Record<number, string> = {
    1: 'Students only',
    2: 'Mixed groups'
  };
  
  return {
    musicTaste: driverPrefs.musicPreferences || [],
    soundEnvironment: soundEnvironmentMap[driverPrefs.personality] || '',
    conversationLevel: conversationLevelMap[driverPrefs.talkativeness] || '',
    smokingPreference: smokingReverseMap[driverPrefs.smokingPreference] || '',
    driverGenderPreference: genderReverseMap[driverPrefs.genderPreference] || 'No preference',
    passengerTypePreference: passengerTypeMap[driverPrefs.maxPassengers] || 'Students only',
  };
}