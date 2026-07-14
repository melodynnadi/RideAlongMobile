import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { useRiderLocationTracking, type RiderTrackTarget } from './useRiderLocationTracking';

// Once the rider is in the car (or the ride is otherwise done) they no longer
// need to share their pre-pickup location.
const DONE_STATUSES = new Set([
  'in_progress', 'driver_completed', 'rider_completed', 'completed',
  'cancelled', 'canceled', 'rejected', 'declined',
]);

// Rider-side counterpart to useGlobalDriverEnRouteTracking. Runs for the whole
// (rider) tab session and, whenever this rider has a confirmed ride whose driver
// has tapped "I'm on my way" (driverEnRoute) and hasn't picked them up yet,
// publishes the rider's live GPS to riderTracking/{confirmedRideId}.
export function useGlobalRiderTracking(enabled: boolean) {
  const [target, setTarget] = useState<RiderTrackTarget | null>(null);

  useEffect(() => {
    if (!enabled) { setTarget(null); return; }
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      console.warn('[useGlobalRiderTracking] enabled but no firebaseAuth.currentUser — skipping');
      setTarget(null);
      return;
    }

    console.log('[useGlobalRiderTracking] subscribing for riderId:', uid);

    // Query only by riderId (matches the security rule and avoids needing a
    // composite index); filter driverEnRoute client-side.
    const q = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid));

    const unsub = onSnapshot(q, (snap) => {
      const active = snap.docs.find((d) => {
        const data = d.data();
        return data.driverEnRoute === true && !DONE_STATUSES.has(String(data.status || '').toLowerCase());
      });
      if (!active) {
        setTarget(null);
        return;
      }
      const data = active.data() as any;
      console.log('[useGlobalRiderTracking] sharing location for ride:', active.id, '| driverId:', data.driverId);
      setTarget({ rideKey: active.id, driverId: data.driverId ?? null });
    }, (error) => {
      console.warn('[useGlobalRiderTracking] onSnapshot error:', error?.code, error?.message);
      setTarget(null);
    });

    return unsub;
  }, [enabled]);

  useRiderLocationTracking(target);
}
