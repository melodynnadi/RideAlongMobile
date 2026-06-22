import { updateProfile } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/constants/services';

export type RiderAccountProfile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  university: string;
  avatarUrl?: string;
};

function value(...candidates: unknown[]) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || '', lastName: parts.join(' ') };
}

export async function loadRiderAccount(): Promise<RiderAccountProfile> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Please sign in again to view your account.');

  const [riderSnapshot, userSnapshot] = await Promise.all([
    getDoc(doc(firestore, 'riders', user.uid)),
    getDoc(doc(firestore, 'users', user.uid)),
  ]);
  const rider = riderSnapshot.data() || {};
  const shared = userSnapshot.data() || {};
  const names = splitName(value(rider.name, rider.fullName, shared.name, shared.fullName, user.displayName));

  return {
    firstName: value(rider.firstName, shared.firstName, names.firstName),
    lastName: value(rider.lastName, shared.lastName, names.lastName),
    email: value(user.email, rider.email, shared.email),
    phone: value(rider.phoneNumber, rider.phone, shared.phoneNumber, shared.phone, user.phoneNumber),
    university: value(rider.university, rider.universityData?.name, shared.university, shared.universityData?.name),
    avatarUrl: value(rider.avatarUrl, rider.photoURL, rider.profilePicture, shared.avatarUrl, user.photoURL) || undefined,
  };
}

export async function saveRiderAccount(profile: Omit<RiderAccountProfile, 'email' | 'avatarUrl'>) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Please sign in again to save your account.');

  const firstName = profile.firstName.trim();
  const lastName = profile.lastName.trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const phone = profile.phone.trim();
  const university = profile.university.trim();
  const email = user.email || '';
  const common = {
    firstName,
    lastName,
    name: fullName,
    fullName,
    email,
    phone,
    phoneNumber: phone,
    university,
    updatedAt: serverTimestamp(),
  };

  await updateProfile(user, { displayName: fullName });
  await Promise.all([
    setDoc(doc(firestore, 'riders', user.uid), common, { merge: true }),
    setDoc(doc(firestore, 'users', user.uid), common, { merge: true }),
  ]);
}
