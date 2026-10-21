import { create } from 'zustand';
import { firebaseAuth } from '@/constants/services';
import { EmergencyContact } from '@/types';
import { readEmergencyContacts, writeEmergencyContacts } from '@/src/services/privateProfile';

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
      const contacts = await readEmergencyContacts(uid);
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
      await writeEmergencyContacts(uid, updatedContacts);
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
      await writeEmergencyContacts(uid, updatedContacts);
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
      await writeEmergencyContacts(uid, updatedContacts);
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
