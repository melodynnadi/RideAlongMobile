import { firebaseAuth } from '@/constants/services';

/** fetch() that proves who is signed in. Signed-out requests go through unchanged. */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) {
    const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
