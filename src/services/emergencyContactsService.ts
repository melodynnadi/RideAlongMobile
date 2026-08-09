import { 
  doc, 
  getDoc, 
  updateDoc, 
  setDoc,
  serverTimestamp,
  arrayUnion
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
// Emergency contacts are stored on users/{uid} so they're shared across rider and driver roles.
function getUserRef(uid: string) {
  return doc(firestore, 'users', uid);
}

export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  try {
    const snap = await getDoc(getUserRef(user.uid));
    if (!snap.exists()) return [];
    const data = snap.data();
    const contacts = Array.isArray(data.emergencyContacts) ? data.emergencyContacts : [];
    return contacts.map((contact: Partial<EmergencyContact>, index: number) => ({
      id: contact.id || `legacy-${index}`,
      name: String(contact.name || ''),
      phone: String(contact.phone || ''),
      relationship: String(contact.relationship || ''),
      addedAt: contact.addedAt,
    }));
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

    const userRef = getUserRef(user.uid);
    await setDoc(userRef, { updatedAt: serverTimestamp() }, { merge: true });
    await updateDoc(userRef, {
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
    const userRef = getUserRef(user.uid);
    const snap = await getDoc(userRef);
    const emergencyContacts = (snap.exists() ? snap.data()?.emergencyContacts : null) || [];

    const updatedContacts = emergencyContacts.map((contact: EmergencyContact, index: number) =>
      (contact.id || `legacy-${index}`) === contactId ? { ...contact, ...updates } : contact
    );

    await updateDoc(userRef, {
      emergencyContacts: updatedContacts,
      updatedAt: serverTimestamp(),
    });

    try {
      await logActivity({
        type: 'profile_updated',
        entityType: 'driver_profile',
        entityId: user.uid,
        metadata: { action: 'emergency_contact_updated', contactId, updates },
      });
    } catch (activityError) {
      console.warn('Failed to log emergency contact update:', activityError);
    }
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
    const userRef = getUserRef(user.uid);
    const snap = await getDoc(userRef);
    const emergencyContacts = (snap.exists() ? snap.data()?.emergencyContacts : null) || [];

    const contactToRemove = emergencyContacts.find((c: EmergencyContact, i: number) => (c.id || `legacy-${i}`) === contactId);
    if (!contactToRemove) throw new Error('Contact not found');

    const updatedContacts = emergencyContacts.filter((c: EmergencyContact, i: number) => (c.id || `legacy-${i}`) !== contactId);

    await updateDoc(userRef, {
      emergencyContacts: updatedContacts,
      updatedAt: serverTimestamp(),
    });

    try {
      await logActivity({
        type: 'profile_updated',
        entityType: 'driver_profile',
        entityId: user.uid,
        metadata: { action: 'emergency_contact_removed', contactName: contactToRemove.name, contactId },
      });
    } catch (activityError) {
      console.warn('Failed to log emergency contact removal:', activityError);
    }
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