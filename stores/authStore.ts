import { create } from 'zustand';
import {
  onAuthStateChanged,
  sendEmailVerification,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { firebaseAuth, firestore } from '@/services/firebase';
import { registerRiderPushToken, registerDriverPushToken } from '@/utils/registerPushToken';

type ActiveRole = 'rider' | 'driver';
type UserRole = ActiveRole | 'both';

type RiderProfile = {
  uid: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  fullName?: string;
  phone?: string | null;
  university?: string | null;
  role?: 'rider';
  isVerified?: boolean;
  emailVerified?: boolean;
  status?: string;
  [key: string]: any;
};

type DriverProfile = {
  uid: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  fullName?: string;
  phone?: string | null;
  university?: string | null;
  role?: 'driver';
  verificationStatus?: string;
  driverStatus?: string;
  isVerified?: boolean;
  emailVerified?: boolean;
  status?: string;
  [key: string]: any;
};


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
  signUp: (params: SignUpParams) => Promise<string>;
  signOut: () => Promise<void>;
  switchRole: (role: ActiveRole) => Promise<void>;
  setActiveRole: (role: ActiveRole) => void;
  sendVerificationEmail: () => Promise<void>;
  checkEmailVerification: () => Promise<boolean>;
  refreshProfiles: () => Promise<void>;
  becomeRider: (params?: AddRoleParams) => Promise<void>;
  becomeDriver: (params?: AddRoleParams) => Promise<void>;
}

interface SignUpParams {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  university?: string;
  phone?: string;
}

interface AddRoleParams {
  firstName?: string;
  lastName?: string;
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

function deriveRole(
  riderProfile: RiderProfile | null,
  driverProfile: DriverProfile | null,
): UserRole | null {
  if (riderProfile && driverProfile) return 'both';
  if (riderProfile) return 'rider';
  if (driverProfile) return 'driver';
  return null;
}

async function resolveActiveRole(role: UserRole): Promise<ActiveRole> {
  if (role === 'rider') return 'rider';
  if (role === 'driver') return 'driver';

  try {
    const stored = await AsyncStorage.getItem(LAST_ROLE_KEY);
    if (stored === 'rider' || stored === 'driver') return stored;
  } catch {}

  return 'rider';
}

function getProfileName(profile?: RiderProfile | DriverProfile | null) {
  return {
    firstName: (profile as any)?.firstName ?? null,
    lastName: (profile as any)?.lastName ?? null,
    phone: (profile as any)?.phone ?? null,
    university: (profile as any)?.university ?? null,
  };
}

async function persistActiveRole(role: ActiveRole) {
  try {
    await AsyncStorage.setItem(LAST_ROLE_KEY, role);
  } catch {}
}

async function registerPushForRole(uid: string, role: ActiveRole) {
  if (role === 'driver') {
    await registerDriverPushToken(uid);
  } else {
    await registerRiderPushToken(uid);
  }
}

async function upsertUserDoc(params: {
  uid: string;
  email: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  university?: string | null;
  role: UserRole;
  activeRole: ActiveRole;
  emailVerified?: boolean;
}) {
  await setDoc(
    doc(firestore, 'users', params.uid),
    {
      uid: params.uid,
      email: params.email,
      firstName: params.firstName ?? null,
      lastName: params.lastName ?? null,
      phone: params.phone ?? null,
      university: params.university ?? null,
      role: params.role,
      roles:
        params.role === 'both'
          ? ['rider', 'driver']
          : [params.role],
      activeRole: params.activeRole,
      emailVerified: params.emailVerified ?? false,
      status: 'active',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
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
          Alert.alert(
            'No profile found',
            'This account does not have a rider or driver profile. Please sign up first.',
          );

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

        const suspended =
          (riderProfile as any)?.status === 'suspended' ||
          (driverProfile as any)?.status === 'suspended';

        if (suspended) {
          await firebaseSignOut(firebaseAuth);
          Alert.alert(
            'Account Suspended',
            'Your account has been suspended. Please contact support.',
            [{ text: 'OK' }],
          );

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

        const activeRole = await resolveActiveRole(role);
        await persistActiveRole(activeRole);

        const fallbackProfile = riderProfile || driverProfile;
        const nameInfo = getProfileName(fallbackProfile);

        await upsertUserDoc({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          firstName: nameInfo.firstName,
          lastName: nameInfo.lastName,
          phone: nameInfo.phone,
          university: nameInfo.university,
          role,
          activeRole,
          emailVerified: firebaseUser.emailVerified,
        });

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

        if (firebaseUser.emailVerified) {
          registerPushForRole(firebaseUser.uid, activeRole).catch(console.error);
        }
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
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  signUp: async ({ email, password, firstName, lastName, role, university, phone }) => {
    set({ isLoading: true });

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const { user } = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, password);
      const displayName = `${firstName} ${lastName}`.trim();

      await updateProfile(user, { displayName });
      await sendEmailVerification(user);

      const initialActiveRole: ActiveRole = role === 'driver' ? 'driver' : 'rider';
      await persistActiveRole(initialActiveRole);

      const baseProfile = {
        email: normalizedEmail,
        firstName,
        lastName,
        name: displayName,
        fullName: displayName,
        phone: phone || null,
        university: university || null,
        isVerified: false,
        emailVerified: false,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (role === 'rider' || role === 'both') {
        await setDoc(doc(firestore, 'riders', user.uid), {
          ...baseProfile,
          role: 'rider',
        });
      }

      if (role === 'driver' || role === 'both') {
        await setDoc(doc(firestore, 'drivers', user.uid), {
          ...baseProfile,
          role: 'driver',
          verificationStatus: 'pending',
          driverStatus: 'pending',
        });
      }

      await upsertUserDoc({
        uid: user.uid,
        email: normalizedEmail,
        firstName,
        lastName,
        phone: phone || null,
        university: university || null,
        role,
        activeRole: initialActiveRole,
        emailVerified: false,
      });

      set({
        uid: user.uid,
        email: normalizedEmail,
        isAuthenticated: true,
        isEmailVerified: false,
        role,
        activeRole: initialActiveRole,
        isLoading: false,
      });

      return user.uid;
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
  },

  switchRole: async (activeRole) => {
    const { uid, role, riderProfile, driverProfile } = get();

    if (!uid || role !== 'both') return;
    if (activeRole === 'rider' && !riderProfile) return;
    if (activeRole === 'driver' && !driverProfile) return;

    await persistActiveRole(activeRole);

    try {
      await updateDoc(doc(firestore, 'users', uid), {
        activeRole,
        updatedAt: serverTimestamp(),
      });
    } catch {}

    set({ activeRole });

    if (firebaseAuth.currentUser?.emailVerified) {
      registerPushForRole(uid, activeRole).catch(console.error);
    }
  },

  setActiveRole: (activeRole) => {
    const { uid } = get();

    persistActiveRole(activeRole).catch(() => {});

    if (uid) {
      updateDoc(doc(firestore, 'users', uid), {
        activeRole,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }

    set({ activeRole });
  },

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

      if (!currentUser.emailVerified) return false;

      const { uid, role, activeRole, riderProfile, driverProfile } = get();
      if (!uid) return false;

      const updates = {
        emailVerified: true,
        updatedAt: serverTimestamp(),
      };

      if (riderProfile) {
        await updateDoc(doc(firestore, 'riders', uid), updates).catch(() => {});
      }

      if (driverProfile) {
        await updateDoc(doc(firestore, 'drivers', uid), updates).catch(() => {});
      }

      if (role && activeRole) {
        await updateDoc(doc(firestore, 'users', uid), {
          emailVerified: true,
          activeRole,
          role,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      set({
        isEmailVerified: true,
        riderProfile: riderProfile ? { ...riderProfile, emailVerified: true } : null,
        driverProfile: driverProfile ? { ...driverProfile, emailVerified: true } : null,
      });

      return true;
    } catch {
      return false;
    }
  },

  refreshProfiles: async () => {
    const { uid, activeRole } = get();
    if (!uid) return;

    try {
      const { riderProfile, driverProfile } = await fetchProfiles(uid);
      const role = deriveRole(riderProfile, driverProfile);

      if (!role) {
        set({ riderProfile: null, driverProfile: null, role: null, activeRole: null });
        return;
      }

      const nextActiveRole =
        activeRole &&
        ((activeRole === 'rider' && riderProfile) || (activeRole === 'driver' && driverProfile))
          ? activeRole
          : await resolveActiveRole(role);

      await persistActiveRole(nextActiveRole);

      set({
        riderProfile,
        driverProfile,
        role,
        activeRole: nextActiveRole,
      });
    } catch (err) {
      console.error('[authStore] refreshProfiles error:', err);
    }
  },

  becomeRider: async (params = {}) => {
    const { uid, email, role, driverProfile } = get();
    if (!uid || !email) return;

    const inherited = getProfileName(driverProfile);
    const firstName = params.firstName ?? inherited.firstName ?? '';
    const lastName = params.lastName ?? inherited.lastName ?? '';
    const displayName = `${firstName} ${lastName}`.trim();

    await setDoc(
      doc(firestore, 'riders', uid),
      {
        email,
        firstName,
        lastName,
        name: displayName || null,
        fullName: displayName || null,
        phone: params.phone ?? inherited.phone ?? null,
        university: params.university ?? inherited.university ?? null,
        role: 'rider',
        isVerified: false,
        emailVerified: firebaseAuth.currentUser?.emailVerified ?? false,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const nextRole: UserRole = role === 'driver' || role === 'both' ? 'both' : 'rider';

    await upsertUserDoc({
      uid,
      email,
      firstName,
      lastName,
      phone: params.phone ?? inherited.phone ?? null,
      university: params.university ?? inherited.university ?? null,
      role: nextRole,
      activeRole: 'rider',
      emailVerified: firebaseAuth.currentUser?.emailVerified ?? false,
    });

    await get().refreshProfiles();
    await get().switchRole('rider');
  },

  becomeDriver: async (params = {}) => {
    const { uid, email, role, riderProfile } = get();
    if (!uid || !email) return;

    const inherited = getProfileName(riderProfile);
    const firstName = params.firstName ?? inherited.firstName ?? '';
    const lastName = params.lastName ?? inherited.lastName ?? '';
    const displayName = `${firstName} ${lastName}`.trim();

    await setDoc(
      doc(firestore, 'drivers', uid),
      {
        email,
        firstName,
        lastName,
        name: displayName || null,
        fullName: displayName || null,
        phone: params.phone ?? inherited.phone ?? null,
        university: params.university ?? inherited.university ?? null,
        role: 'driver',
        isVerified: false,
        verificationStatus: 'pending',
        driverStatus: 'pending',
        emailVerified: firebaseAuth.currentUser?.emailVerified ?? false,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const nextRole: UserRole = role === 'rider' || role === 'both' ? 'both' : 'driver';

    await upsertUserDoc({
      uid,
      email,
      firstName,
      lastName,
      phone: params.phone ?? inherited.phone ?? null,
      university: params.university ?? inherited.university ?? null,
      role: nextRole,
      activeRole: 'driver',
      emailVerified: firebaseAuth.currentUser?.emailVerified ?? false,
    });

    await get().refreshProfiles();
    await get().switchRole('driver');
  },
}));