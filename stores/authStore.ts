import { create } from 'zustand';
import {
  onAuthStateChanged,
  sendEmailVerification,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { firebaseAuth, firestore } from '@/services/firebase';
import type { ActiveRole, UserRole, RiderProfile, DriverProfile } from '@/types';

const LAST_ROLE_KEY = '@ridealong_last_active_role';

interface AuthState {
  uid: string | null;
  email: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  role: UserRole | null;
  activeRole: ActiveRole | null;
  riderProfile: RiderProfile | null;
  driverProfile: DriverProfile | null;

  initializeAuth: () => () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: SignUpParams) => Promise<void>;
  signOut: () => Promise<void>;
  switchRole: (role: ActiveRole) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  checkEmailVerification: () => Promise<boolean>;
  refreshProfiles: () => Promise<void>;
  setActiveRole: (role: ActiveRole) => void;
}

interface SignUpParams {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: ActiveRole;
  university?: string;
  phone?: string;
}

async function fetchProfiles(uid: string) {
  const [riderSnap, driverSnap] = await Promise.all([
    getDoc(doc(firestore, 'riders', uid)),
    getDoc(doc(firestore, 'drivers', uid)),
  ]);

  const riderProfile = riderSnap.exists()
    ? ({ uid, ...riderSnap.data() } as RiderProfile)
    : null;

  const driverProfile = driverSnap.exists()
    ? ({ uid, ...driverSnap.data() } as DriverProfile)
    : null;

  return { riderProfile, driverProfile };
}

function deriveRole(riderProfile: RiderProfile | null, driverProfile: DriverProfile | null): UserRole | null {
  if (riderProfile && driverProfile) return 'both';
  if (riderProfile) return 'rider';
  if (driverProfile) return 'driver';
  return null;
}

async function resolveActiveRole(
  role: UserRole,
  preferredRole?: ActiveRole | null,
): Promise<ActiveRole> {
  if (role === 'rider') return 'rider';
  if (role === 'driver') return 'driver';

  if (preferredRole) return preferredRole;

  try {
    const stored = await AsyncStorage.getItem(LAST_ROLE_KEY);
    if (stored === 'rider' || stored === 'driver') return stored;
  } catch {}

  return 'rider';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  uid: null,
  email: null,
  isLoading: true,
  isAuthenticated: false,
  isEmailVerified: false,
  role: null,
  activeRole: null,
  riderProfile: null,
  driverProfile: null,

  initializeAuth: () => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        set({
          uid: null,
          email: null,
          isLoading: false,
          isAuthenticated: false,
          isEmailVerified: false,
          role: null,
          activeRole: null,
          riderProfile: null,
          driverProfile: null,
        });
        return;
      }

      try {
        const { riderProfile, driverProfile } = await fetchProfiles(firebaseUser.uid);
        const role = deriveRole(riderProfile, driverProfile);

        if (!role) {
          await firebaseSignOut(firebaseAuth);
          set({
            uid: null, email: null, isLoading: false,
            isAuthenticated: false, isEmailVerified: false,
            role: null, activeRole: null, riderProfile: null, driverProfile: null,
          });
          return;
        }

        const activeProfile = riderProfile || driverProfile!;
        if (activeProfile.status === 'suspended') {
          await firebaseSignOut(firebaseAuth);
          Alert.alert(
            'Account Suspended',
            'Your account has been suspended. Please contact support.',
            [{ text: 'OK' }],
          );
          set({
            uid: null, email: null, isLoading: false,
            isAuthenticated: false, isEmailVerified: false,
            role: null, activeRole: null, riderProfile: null, driverProfile: null,
          });
          return;
        }

        const activeRole = await resolveActiveRole(role);

        set({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          isLoading: false,
          isAuthenticated: true,
          isEmailVerified: firebaseUser.emailVerified,
          role,
          activeRole,
          riderProfile,
          driverProfile,
        });
      } catch (err) {
        console.error('[authStore] initializeAuth error:', err);
        set({ isLoading: false });
      }
    });

    return unsubscribe;
  },

  signIn: async (email, password) => {
    set({ isLoading: true });
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      // onAuthStateChanged handles the rest
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  signUp: async ({ email, password, firstName, lastName, role, university, phone }) => {
    set({ isLoading: true });
    try {
      const { user } = await createUserWithEmailAndPassword(firebaseAuth, email, password);

      await updateProfile(user, { displayName: `${firstName} ${lastName}` });
      await sendEmailVerification(user);

      const baseProfile = {
        email,
        firstName,
        lastName,
        phone: phone || null,
        university: university || null,
        isVerified: false,
        emailVerified: false,
        status: 'active',
        createdAt: serverTimestamp(),
      };

      const collection = role === 'rider' ? 'riders' : 'drivers';
      await setDoc(doc(firestore, collection, user.uid), baseProfile);

      // onAuthStateChanged will pick up the new profile and update state
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  signOut: async () => {
    try {
      await firebaseSignOut(firebaseAuth);
    } catch {}
    await AsyncStorage.removeItem(LAST_ROLE_KEY);
    set({
      uid: null, email: null, isLoading: false,
      isAuthenticated: false, isEmailVerified: false,
      role: null, activeRole: null, riderProfile: null, driverProfile: null,
    });
  },

  switchRole: async (role) => {
    const { role: userRole } = get();
    if (userRole !== 'both') return;
    await AsyncStorage.setItem(LAST_ROLE_KEY, role);
    set({ activeRole: role });
  },

  setActiveRole: (role) => set({ activeRole: role }),

  sendVerificationEmail: async () => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) throw new Error('No user logged in');
    await sendEmailVerification(currentUser);
  },

  checkEmailVerification: async () => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) return false;
    try {
      await currentUser.reload();
      if (currentUser.emailVerified) {
        const { riderProfile, driverProfile, activeRole } = get();
        const collection = activeRole === 'driver' ? 'drivers' : 'riders';
        const uid = currentUser.uid;
        try {
          await updateDoc(doc(firestore, collection, uid), { emailVerified: true });
        } catch {}
        set({
          isEmailVerified: true,
          riderProfile: riderProfile ? { ...riderProfile, emailVerified: true } : null,
          driverProfile: driverProfile ? { ...driverProfile, emailVerified: true } : null,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  refreshProfiles: async () => {
    const { uid } = get();
    if (!uid) return;
    try {
      const { riderProfile, driverProfile } = await fetchProfiles(uid);
      const role = deriveRole(riderProfile, driverProfile);
      set({ riderProfile, driverProfile, role: role ?? get().role });
    } catch (err) {
      console.error('[authStore] refreshProfiles error:', err);
    }
  },
}));
