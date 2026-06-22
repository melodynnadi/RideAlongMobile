import { create } from 'zustand';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { useAuthStore } from '@/stores/authStore';
import { UserPreferences } from '@/types';

interface PreferencesState {
  preferences: UserPreferences | null;
  isLoading: boolean;
  isDirty: boolean;
  
  // Actions
  setPreferences: (preferences: UserPreferences) => void;
  setLoading: (loading: boolean) => void;
  setDirty: (dirty: boolean) => void;
  loadPreferences: () => Promise<UserPreferences | null>;
  savePreferences: (preferences: UserPreferences) => Promise<void>;
  updatePreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  resetPreferences: () => void;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  preferences: null,
  isLoading: false,
  isDirty: false,
  
  setPreferences: (preferences) => set({ preferences, isDirty: false }),
  
  setLoading: (isLoading) => set({ isLoading }),
  
  setDirty: (isDirty) => set({ isDirty }),
  
  loadPreferences: async () => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      set({ isLoading: true });
      const userDoc = await getDoc(doc(firestore, useAuthStore.getState().activeRole === 'driver' ? 'drivers' : 'riders', uid));
      
      if (!userDoc.exists()) {
        throw new Error('User document not found');
      }
      
      const userData = userDoc.data();
      const musicPreference = Array.isArray(userData.musicPreference)
        ? userData.musicPreference.map(String).filter(Boolean)
        : typeof userData.musicPreference === 'string'
          ? userData.musicPreference.split(/[;,]/).map((item: string) => item.trim()).filter(Boolean)
          : [];
      
      // Map Firebase data to our UserPreferences interface
      const preferences: UserPreferences = {
        musicPreference,
        soundEnvironment: userData.soundEnvironment || '',
        conversationLevel: userData.conversationLevel || '',
        smokingPreference: userData.smokingPreference || '',
        driverGender: userData.driverGender || '',
        passengerType: userData.passengerType || '',
        preferencesUpdatedAt: userData.preferencesUpdatedAt,
      };
      
      set({ preferences, isDirty: false });
      return preferences;
    } catch (error) {
      console.error('Error loading preferences:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  
  savePreferences: async (preferences: UserPreferences) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      throw new Error('User not authenticated');
    }
    
    try {
      set({ isLoading: true });
      
      // Update the user document with new preferences
      await updateDoc(doc(firestore, useAuthStore.getState().activeRole === 'driver' ? 'drivers' : 'riders', uid), {
        musicPreference: preferences.musicPreference,
        soundEnvironment: preferences.soundEnvironment,
        conversationLevel: preferences.conversationLevel,
        smokingPreference: preferences.smokingPreference,
        driverGender: preferences.driverGender,
        passengerType: preferences.passengerType,
        preferencesUpdatedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
      
      set({ 
        preferences: {
          ...preferences,
          preferencesUpdatedAt: new Date().toISOString()
        }, 
        isDirty: false 
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },
  
  updatePreference: (key, value) => {
    const { preferences } = get();
    if (!preferences) return;
    
    const updatedPreferences = {
      ...preferences,
      [key]: value,
    };
    
    set({ 
      preferences: updatedPreferences, 
      isDirty: true 
    });
  },
  
  resetPreferences: () => set({ 
    preferences: null, 
    isLoading: false, 
    isDirty: false 
  }),
}));
