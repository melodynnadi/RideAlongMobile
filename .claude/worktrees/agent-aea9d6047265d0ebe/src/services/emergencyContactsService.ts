import { 
  doc, 
  getDoc, 
  updateDoc, 
  setDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { logActivity } from '@/src/services/activity';
import { EmergencyContact } from '@/types';

// Re-export the type for convenience
export type { EmergencyContact };

/**
 * Debug function to test Firebase connection and authentication
 */
export async function debugFirebaseConnection(): Promise<{ user: any; canAccessFirestore: boolean; error?: string }> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) {
      return { user: null, canAccessFirestore: false, error: 'User not authenticated' };
    }

    // Test Firestore access by trying to read the drivers document
    const driverRef = doc(firestore, 'drivers', user.uid);
    const driverSnap = await getDoc(driverRef);
    
    return {
      user: { uid: user.uid, email: user.email },
      canAccessFirestore: true,
      error: driverSnap.exists() ? undefined : 'Driver document does not exist'
    };
  } catch (error) {
    return {
      user: firebaseAuth.currentUser ? { uid: firebaseAuth.currentUser.uid, email: firebaseAuth.currentUser.email } : null,
      canAccessFirestore: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get emergency contacts for the current driver
 */
export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const driverRef = doc(firestore, 'drivers', user.uid);
    const driverSnap = await getDoc(driverRef);
    
    if (!driverSnap.exists()) {
      return [];
    }
    
    const driverData = driverSnap.data();
    return driverData.emergencyContacts || [];
  } catch (error) {
    console.error('Error fetching emergency contacts:', error);
    throw new Error('Failed to fetch emergency contacts');
  }
}

/**
 * Add a new emergency contact
 */
export async function addEmergencyContact(contact: Omit<EmergencyContact, 'id' | 'addedAt'>): Promise<EmergencyContact> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const newContact: EmergencyContact = {
      id: Date.now().toString(), // Simple ID generation
      ...contact,
      addedAt: new Date(), // Use regular Date instead of serverTimestamp() for arrayUnion
    };

    const driverRef = doc(firestore, 'drivers', user.uid);
    
    // Check if driver exists
    const driverSnap = await getDoc(driverRef);
    if (!driverSnap.exists()) {
      console.error('Driver document not found for user:', user.uid);
      console.log('Attempting to create driver document...');
      
      // Try to create a basic driver document if it doesn't exist
      try {
        await setDoc(driverRef, {
          userUid: user.uid,
          email: user.email || '',
          emergencyContacts: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        console.log('Created basic driver document');
      } catch (createError) {
        console.error('Failed to create driver document:', createError);
        throw new Error('Driver profile not found and could not be created');
      }
    }

    console.log('Adding emergency contact:', newContact);
    
    // Add the new contact to the array
    await updateDoc(driverRef, {
      emergencyContacts: arrayUnion(newContact),
      updatedAt: serverTimestamp(),
    });

    console.log('Emergency contact added successfully');

    // Log the activity
    try {
      await logActivity({
        type: 'profile_updated',
        entityType: 'driver_profile',
        entityId: user.uid,
        metadata: { 
          action: 'emergency_contact_added',
          contactName: contact.name,
          contactId: newContact.id
        },
      });
    } catch (activityError) {
      // Don't fail the main operation if activity logging fails
      console.warn('Failed to log activity:', activityError);
    }

    return newContact;
  } catch (error) {
    console.error('Error adding emergency contact:', error);
    if (error instanceof Error) {
      throw new Error(`Failed to add emergency contact: ${error.message}`);
    } else {
      throw new Error('Failed to add emergency contact');
    }
  }
}

/**
 * Update an existing emergency contact
 */
export async function updateEmergencyContact(contactId: string, updates: Partial<Omit<EmergencyContact, 'id' | 'addedAt'>>): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const driverRef = doc(firestore, 'drivers', user.uid);
    const driverSnap = await getDoc(driverRef);
    
    if (!driverSnap.exists()) {
      throw new Error('Driver profile not found');
    }

    const driverData = driverSnap.data();
    const emergencyContacts = driverData.emergencyContacts || [];
    
    // Find and update the contact
    const updatedContacts = emergencyContacts.map((contact: EmergencyContact) => 
      contact.id === contactId 
        ? { ...contact, ...updates }
        : contact
    );

    await updateDoc(driverRef, {
      emergencyContacts: updatedContacts,
      updatedAt: serverTimestamp(),
    });

    // Log the activity
    await logActivity({
      type: 'profile_updated',
      entityType: 'driver_profile',
      entityId: user.uid,
      metadata: { 
        action: 'emergency_contact_updated',
        contactId,
        updates
      },
    });
  } catch (error) {
    console.error('Error updating emergency contact:', error);
    throw new Error('Failed to update emergency contact');
  }
}

/**
 * Remove an emergency contact
 */
export async function removeEmergencyContact(contactId: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const driverRef = doc(firestore, 'drivers', user.uid);
    const driverSnap = await getDoc(driverRef);
    
    if (!driverSnap.exists()) {
      throw new Error('Driver profile not found');
    }

    const driverData = driverSnap.data();
    const emergencyContacts = driverData.emergencyContacts || [];
    
    // Find the contact to remove
    const contactToRemove = emergencyContacts.find((contact: EmergencyContact) => contact.id === contactId);
    if (!contactToRemove) {
      throw new Error('Contact not found');
    }

    // Remove the contact from the array
    const updatedContacts = emergencyContacts.filter((contact: EmergencyContact) => contact.id !== contactId);

    await updateDoc(driverRef, {
      emergencyContacts: updatedContacts,
      updatedAt: serverTimestamp(),
    });

    // Log the activity
    await logActivity({
      type: 'profile_updated',
      entityType: 'driver_profile',
      entityId: user.uid,
      metadata: { 
        action: 'emergency_contact_removed',
        contactName: contactToRemove.name,
        contactId
      },
    });
  } catch (error) {
    console.error('Error removing emergency contact:', error);
    throw new Error('Failed to remove emergency contact');
  }
}

/**
 * Validate phone number format
 */
export function validatePhoneNumber(phone: string): boolean {
  // Basic phone validation - adjust regex as needed
  const phoneRegex = /^[\+]?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone.trim());
}

/**
 * Format phone number for display
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, '');
  
  // Basic US phone number formatting
  if (cleaned.length === 10) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return cleaned.replace(/(\d{1})(\d{3})(\d{3})(\d{4})/, '+$1 ($2) $3-$4');
  }
  
  return phone; // Return original if no formatting applied
}