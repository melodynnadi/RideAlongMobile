import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

export type RiderTrackTarget = {
  // The rider's OWN confirmedRide doc id — used as the riderTracking doc key so
  // that on a group ride each rider writes their own separate location doc.
  rideKey: string;
  driverId: string | null;
};

// Mirror of useDriverTracking, but for the rider: while the driver is en route
// to pick them up, the rider's device publishes its live GPS to
// riderTracking/{confirmedRideId} every ~10s so the driver can navigate to
// where the rider actually is (door-to-door), not a static booking address.
export function useRiderLocationTracking(target: RiderTrackTarget | null) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  const stop = (rideKey: string | null) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (activeRef.current && rideKey) {
      updateDoc(doc(firestore, 'riderTracking', rideKey), { isActive: false }).catch(() => {});
    }
    activeRef.current = false;
  };

  useEffect(() => {
    const rideKey = target?.rideKey ?? null;
    if (!rideKey) { stop(null); return; }

    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      console.warn('[useRiderLocationTracking] target set but no currentUser — skipping');
      return;
    }

    console.log('[useRiderLocationTracking] effect running for rideKey:', rideKey);
    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) {
          console.warn('[useRiderLocationTracking] Location permission not granted');
          return;
        }

        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;

        await setDoc(doc(firestore, 'riderTracking', rideKey), {
          riderId: uid,
          driverId: target?.driverId ?? null,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          heading: loc.coords.heading ?? null,
          updatedAt: serverTimestamp(),
          isActive: true,
        });
        activeRef.current = true;
        console.log('[useRiderLocationTracking] Started sharing location, key:', rideKey);

        intervalRef.current = setInterval(async () => {
          try {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            await updateDoc(doc(firestore, 'riderTracking', rideKey), {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading ?? null,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn('[useRiderLocationTracking] Interval update failed:', e);
          }
        }, 10000);
      } catch (e) {
        console.warn('[useRiderLocationTracking] Failed to start sharing:', e);
      }
    })();

    return () => {
      cancelled = true;
      stop(rideKey);
    };
  }, [target?.rideKey, target?.driverId]);
}
