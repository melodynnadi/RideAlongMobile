import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { EmergencyContact } from '@/types';

/**
 * privateProfiles/{uid} holds data only the owner (and admins) may read. Emergency contacts
 * used to live on users/{uid}, which any signed-in user can read, so they're moved here the
 * first time they're loaded. Shared by the rider and driver roles.
 */
function privateProfileDoc(uid: string) {
  return doc(firestore, 'privateProfiles', uid);
}

export async function readEmergencyContacts(uid: string): Promise<EmergencyContact[]> {
  const snap = await getDoc(privateProfileDoc(uid));
  const stored = snap.data()?.emergencyContacts;
  if (Array.isArray(stored)) return stored as EmergencyContact[];

  // Not moved yet: copy from the old place, then remove it there.
  const legacySnap = await getDoc(doc(firestore, 'users', uid)).catch(() => null);
  const legacy = legacySnap?.data()?.emergencyContacts;
  const contacts = Array.isArray(legacy) ? (legacy as EmergencyContact[]) : [];
  await writeEmergencyContacts(uid, contacts);
  if (legacySnap?.exists() && legacy !== undefined) {
    await updateDoc(doc(firestore, 'users', uid), { emergencyContacts: deleteField() }).catch(() => {});
  }
  return contacts;
}

export async function writeEmergencyContacts(uid: string, contacts: EmergencyContact[]): Promise<void> {
  await setDoc(privateProfileDoc(uid), { emergencyContacts: contacts, updatedAt: serverTimestamp() }, { merge: true });
}
