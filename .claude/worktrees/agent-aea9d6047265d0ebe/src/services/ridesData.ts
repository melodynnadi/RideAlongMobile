import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';

export type ConfirmedRide = {
  id: string; // doc id
  rideRequestId?: string;
  ridePostingId?: string;
  riderId?: string;
  driverId: string;
  status: 'PENDING' | 'CONFIRMED' | 'IN_PROGRESS' | 'DRIVER_COMPLETED' | 'RIDER_COMPLETED' | 'COMPLETED' | string;
  driverPickupConfirmed?: boolean;
  riderPickupConfirmed?: boolean;
  driverCompleteConfirmed?: boolean;
  riderCompleteConfirmed?: boolean;
  pickup?: any;
  dropoff?: any;
  contributionAmount?: number | string;
  price?: number | string;
  distance?: any;
  date?: string;
  time?: string;
  createdAt?: any;
  confirmedAt?: any;
  completedAt?: any;
  riderName?: string;
};

export function listenDriverActiveRides(
  uid: string,
  cb: (rides: ConfirmedRide[]) => void
): Unsubscribe {
  const qy = query(
    collection(firestore, 'confirmedRides'),
    where('driverId', '==', uid),
    // Firestore supports 'in' with up to 10 values
  // Include 'FLAGGED' so driver-side lists keep flagged rides visible after flagging
  where('status', 'in', ['CONFIRMED', 'IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED', 'FLAGGED'])
  );
  return onSnapshot(qy, (snap) => {
    const out: ConfirmedRide[] = [];
    snap.forEach((d) => {
      const data = d.data();
      console.log(`[listenDriverActiveRides] Document ${d.id}:`, {
        status: data.status,
        statusAtFlag: data.statusAtFlag,
        rawData: JSON.stringify(data, null, 2)
      });
      out.push({ id: d.id, ...(data as any) });
    });
    cb(out);
  });
}

export function listenDriverCompletedRides(
  uid: string,
  cb: (rides: ConfirmedRide[]) => void
): Unsubscribe {
  let currentUnsub: Unsubscribe | null = null;

  const subscribe = (useOrder: boolean) => {
    const base = [
      collection(firestore, 'confirmedRides'),
      where('driverId', '==', uid),
      where('status', '==', 'COMPLETED'),
    ] as any[];
    if (useOrder) base.push(orderBy('completedAt', 'desc'));
    base.push(limit(25));
    const qy = query.apply(null, base as any);
    currentUnsub = onSnapshot(
      qy,
      (snap) => {
        const out: ConfirmedRide[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          // Exclude rides that were resolved from flagged status (they already have ratings)
          if (data?.resolvedFromFlagged === true) return;
          out.push({ id: d.id, ...data });
        });
        if (!useOrder) {
          out.sort((a, b) => {
            const at = (a as any)?.completedAt?.toMillis?.() ?? 0;
            const bt = (b as any)?.completedAt?.toMillis?.() ?? 0;
            return bt - at;
          });
        }
        cb(out);
      },
      (err) => {
        // Missing index -> fallback without orderBy
        if (String(err?.code) === 'failed-precondition' && useOrder) {
          if (currentUnsub) currentUnsub();
          subscribe(false);
        } else {
          // For other errors, still attempt fallback once
          if (useOrder) {
            if (currentUnsub) currentUnsub();
            subscribe(false);
          }
        }
      }
    );
  };

  subscribe(true);
  return () => {
    if (currentUnsub) currentUnsub();
  };
}

export async function resolveConfirmedDocId(args: {
  confirmedId?: string;
  rideRequestId?: string;
  ridePostingId?: string;
  riderId?: string;
}): Promise<string | null> {
  const { confirmedId, rideRequestId, ridePostingId, riderId } = args;
  if (confirmedId) return confirmedId;

  if (rideRequestId) {
    const q1 = query(
      collection(firestore, 'confirmedRides'),
      where('rideRequestId', '==', rideRequestId),
      limit(1)
    );
    const s1 = await getDocs(q1);
    if (!s1.empty) return s1.docs[0].id;
  }

  if (ridePostingId && riderId) {
    const q2 = query(
      collection(firestore, 'confirmedRides'),
      where('ridePostingId', '==', ridePostingId),
      where('riderId', '==', riderId),
      limit(1)
    );
    const s2 = await getDocs(q2);
    if (!s2.empty) return s2.docs[0].id;
  }
  // Fallback: ridePostingId only, prefer active (non-completed) and most recent
  if (ridePostingId) {
    try {
      const q3 = query(
        collection(firestore, 'confirmedRides'),
        where('ridePostingId', '==', ridePostingId),
        limit(5)
      );
      const s3 = await getDocs(q3);
      if (!s3.empty) {
        const docs = s3.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        // Prefer same driver when possible
        const uid = firebaseAuth.currentUser?.uid;
        const mine = uid ? docs.filter((d) => String(d.driverId) === String(uid)) : docs;
        const pool = mine.length > 0 ? mine : docs;
        // Prefer non-completed first, then latest updated/completed
        const active = pool.filter((d) => String(d.status || '').toUpperCase() !== 'COMPLETED');
        const pickFrom = active.length > 0 ? active : pool;
        const best = pickFrom.sort((a, b) => {
          const at = (a.updatedAt?.toMillis?.() ?? a.confirmedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0);
          const bt = (b.updatedAt?.toMillis?.() ?? b.confirmedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0);
          return bt - at;
        })[0];
        if (best?.id) return String(best.id);
      }
    } catch {}
  }
  // Fallback: by riderId + current driver if available
  if (riderId) {
    try {
      const uid = firebaseAuth.currentUser?.uid;
      const base = [
        collection(firestore, 'confirmedRides'),
        where('riderId', '==', riderId),
      ] as any[];
      if (uid) base.push(where('driverId', '==', uid));
      base.push(limit(1));
      const q4 = query.apply(null, base as any);
      const s4 = await getDocs(q4);
      if (!s4.empty) return s4.docs[0].id;
    } catch {}
  }
  return null;
}
