import { create } from 'zustand';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { EmergencyContact } from '@/types';

// Emergency contacts are stored on users/{uid} so they're shared across rider and driver roles.
function usersDoc(uid: string) {
  return doc(firestore, 'users', uid);
}

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
    if (!uid) throw new Error('User not authenticated');

    try {
      set({ isLoading: true });
      const snap = await getDoc(usersDoc(uid));
      const contacts = Array.isArray(snap.data()?.emergencyContacts) ? snap.data()!.emergencyContacts as EmergencyContact[] : [];
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
    if (!uid) throw new Error('User not authenticated');

    try {
      set({ isLoading: true });
      const contactWithId: EmergencyContact = { id: Date.now().toString(), ...newContact };
      const updatedContacts = [...get().contacts, contactWithId];
      await updateDoc(usersDoc(uid), { emergencyContacts: updatedContacts, updatedAt: serverTimestamp() });
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
    if (!uid) throw new Error('User not authenticated');

    try {
      set({ isLoading: true });
      const { contacts } = get();
      if (index < 0 || index >= contacts.length) throw new Error('Invalid contact index');
      const updatedContacts = [...contacts];
      updatedContacts[index] = { ...updatedContact, id: contacts[index].id };
      await updateDoc(usersDoc(uid), { emergencyContacts: updatedContacts, updatedAt: serverTimestamp() });
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
    if (!uid) throw new Error('User not authenticated');

    try {
      set({ isLoading: true });
      const { contacts } = get();
      if (index < 0 || index >= contacts.length) throw new Error('Invalid contact index');
      const updatedContacts = contacts.filter((_, i) => i !== index);
      await updateDoc(usersDoc(uid), { emergencyContacts: updatedContacts, updatedAt: serverTimestamp() });
      set({ contacts: updatedContacts });
    } catch (error) {
      console.error('Error deleting emergency contact:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  resetContacts: () => set({ contacts: [], isLoading: false }),
}));
