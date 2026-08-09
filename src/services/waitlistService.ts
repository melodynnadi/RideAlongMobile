import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';

export type WaitlistEntry = {
  id: string;
  ridePostingId: string;
  riderId: string;
  riderName: string;
  position: number;
  status: 'waiting' | 'notified' | 'claimed' | 'expired' | 'cancelled';
  notifiedAt?: any;
  expiresAt?: any;
  createdAt?: any;
};

async function authHeaders(): Promise<Record<string, string>> {
  const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

export async function joinWaitlist(ridePostingId: string): Promise<{ waitlistId: string; position: number }> {
  const res = await fetch(`${getApiBaseUrl()}/api/ride-postings/${encodeURIComponent(ridePostingId)}/waitlist`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || 'Failed to join waitlist');
  return { waitlistId: json.waitlistId, position: json.position };
}

export async function leaveWaitlist(ridePostingId: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/api/ride-postings/${encodeURIComponent(ridePostingId)}/waitlist`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || 'Failed to leave waitlist');
  }
}

export async function getWaitlist(ridePostingId: string): Promise<WaitlistEntry[]> {
  const res = await fetch(`${getApiBaseUrl()}/api/ride-postings/${encodeURIComponent(ridePostingId)}/waitlist`, {
    headers: await authHeaders(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || 'Failed to fetch waitlist');
  return json.waitlist || [];
}

// Subscribe to the current rider's waitlist entries (for My Requests page)
// Single-field query only — no composite index needed
export function subscribeMyWaitlistEntries(
  uid: string,
  onData: (entries: WaitlistEntry[]) => void,
): () => void {
  const q = query(
    collection(firestore, 'rideWaitlist'),
    where('riderId', '==', uid),
  );
  return onSnapshot(q, (snap) => {
    const entries = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as WaitlistEntry))
      .filter(e => e.status === 'waiting' || e.status === 'notified')
      .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
    onData(entries);
  }, () => onData([]));
}

// Subscribe to a posting's waitlist count — single-field query, no composite index
export function subscribeWaitlistCount(
  ridePostingId: string,
  onCount: (count: number) => void,
): () => void {
  const q = query(
    collection(firestore, 'rideWaitlist'),
    where('ridePostingId', '==', ridePostingId),
  );
  return onSnapshot(q, (snap) => {
    const active = snap.docs.filter(d => {
      const s = d.data().status;
      return s === 'waiting' || s === 'notified';
    });
    onCount(active.length);
  }, () => onCount(0));
}

// Check if current rider is on waitlist for a given posting.
// Queries by riderId (passes Firestore rules) and filters client-side for the posting.
export function subscribeMyWaitlistEntry(
  ridePostingId: string,
  uid: string,
  onEntry: (entry: WaitlistEntry | null) => void,
): () => void {
  const q = query(
    collection(firestore, 'rideWaitlist'),
    where('riderId', '==', uid),
  );
  return onSnapshot(q, (snap) => {
    const mine = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as WaitlistEntry))
      .find(e => e.ridePostingId === ridePostingId && (e.status === 'waiting' || e.status === 'notified'));
    onEntry(mine ?? null);
  }, () => onEntry(null));
}
