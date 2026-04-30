import { create } from 'zustand';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { EmergencyContact, UserProfile } from '@/types';

interface EmergencyContactsState {
  contacts: EmergencyContact[];
  isLoading: boolean;
  
  // Actions
  setContacts: (contacts: EmergencyContact[]) => void;
  setLoading: (loading: boolean) => void;
  loadContacts: () => Promise<EmergencyContact[]>;
  addContact: (contact: Omit<EmergencyContact, 'id'>) => Promise<void>;
  updateContact: (index: number, contact: Omit<EmergencyContact, 'id'>) => Promise<void>;
  deleteContact: (index: number) => Promise<void>;
  resetContacts: () => void;
}

export const useEmergencyContactsStore = create<EmergencyContactsState>((set, get) => ({
  contacts: [],
  isLoading: false,
  
  setContacts: (contacts) => set({ contacts }),
  
  setLoading: (isLoading) => set({ isLoading }),
  
  loadContacts: async () => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      set({ isLoading: true });
      const userDoc = await getDoc(doc(firestore, 'users', uid));
      
      if (!userDoc.exists()) {
        throw new Error('User document not found');
      }
      
      const userData = userDoc.data() as UserProfile;
      const contacts = userData.emergencyContacts || [];
      
      set({ contacts });
      return contacts;
    } catch (error) {
      console.error('Error loading emergency contacts:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  
  addContact: async (newContact: Omit<EmergencyContact, 'id'>) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      set({ isLoading: true });
      const { contacts } = get();
      
      // Create new contact (Firebase stores as array without explicit IDs)
      const updatedContacts = [...contacts, newContact];
      
      // Update Firebase
      await updateDoc(doc(firestore, 'users', uid), {
        emergencyContacts: updatedContacts,
        updatedAt: serverTimestamp(),
      });
      
      set({ contacts: updatedContacts });
    } catch (error) {
      console.error('Error adding emergency contact:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  
  updateContact: async (index: number, updatedContact: Omit<EmergencyContact, 'id'>) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      set({ isLoading: true });
      const { contacts } = get();
      
      if (index < 0 || index >= contacts.length) {
        throw new Error('Invalid contact index');
      }
      
      const updatedContacts = [...contacts];
      updatedContacts[index] = updatedContact;
      
      // Update Firebase
      await updateDoc(doc(firestore, 'users', uid), {
        emergencyContacts: updatedContacts,
        updatedAt: serverTimestamp(),
      });
      
      set({ contacts: updatedContacts });
    } catch (error) {
      console.error('Error updating emergency contact:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  
  deleteContact: async (index: number) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      set({ isLoading: true });
      const { contacts } = get();
      
      if (index < 0 || index >= contacts.length) {
        throw new Error('Invalid contact index');
      }
      
      const updatedContacts = contacts.filter((_, i) => i !== index);
      
      // Update Firebase
      await updateDoc(doc(firestore, 'users', uid), {
        emergencyContacts: updatedContacts,
        updatedAt: serverTimestamp(),
      });
      
      set({ contacts: updatedContacts });
    } catch (error) {
      console.error('Error deleting emergency contact:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  
  resetContacts: () => set({ 
    contacts: [], 
    isLoading: false 
  }),
}));