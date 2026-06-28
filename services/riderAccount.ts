import { updateProfile } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/constants/services';

export type RiderAccountProfile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  university: string;
  major: string;
  about: string;
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
    major: value(rider.major, rider.personalInfo?.major, shared.major, shared.personalInfo?.major),
    about: value(rider.about, rider.bio, rider.description, shared.about, shared.bio, shared.description),
    // Do NOT fall back to user.photoURL — auth.currentUser.photoURL is shared across roles
    // and could return the driver's photo. Each role's photo lives only in its own collection.
    avatarUrl: value(rider.avatarUrl, rider.photoURL, rider.profilePicture, shared.avatarUrl) || undefined,
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
  const major = profile.major.trim();
  const about = profile.about.trim();
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
    major,
    about,
    bio: about,
    description: about,
    updatedAt: serverTimestamp(),
  };

  await updateProfile(user, { displayName: fullName });

  const writes: Promise<unknown>[] = [
    setDoc(doc(firestore, 'riders', user.uid), common, { merge: true }),
    setDoc(doc(firestore, 'users', user.uid), common, { merge: true }),
  ];

  // Sync shared academic fields to driver doc if it exists (dual-role user)
  const driverSnap = await getDoc(doc(firestore, 'drivers', user.uid));
  if (driverSnap.exists()) {
    writes.push(updateDoc(doc(firestore, 'drivers', user.uid), {
      university, major, updatedAt: serverTimestamp(),
    }));
  }

  await Promise.all(writes);
}
