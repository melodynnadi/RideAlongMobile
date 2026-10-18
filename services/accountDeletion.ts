import { signOut } from 'firebase/auth';
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

/**
 * Deletes the signed-in user's account on the server (Auth user + riders/drivers/users docs).
 * Call right after reauthenticateWithCredential — the server requires a recent sign-in.
 *
 * Deletion has to happen server-side: Firestore rules don't let clients delete riders/drivers
 * docs, so deleting from the app used to leave orphaned profiles behind.
 */
export async function deleteMyAccount(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('You need to be signed in to delete your account.');

  // Force-refresh so the token carries the auth_time from the re-authentication just done.
  const idToken = await user.getIdToken(true);
  const res = await fetch(`${getApiBaseUrl()}/api/account/delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(data.message || 'Could not delete your account. Please try again.');

  // The Auth user is already gone server-side; clear the local session too.
  await signOut(firebaseAuth).catch(() => undefined);
}
