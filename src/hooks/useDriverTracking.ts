import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

export function useDriverTracking(trackingKey: string | null, isEnRoute: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);

  const stop = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (activeRef.current && trackingKey) {
      updateDoc(doc(firestore, 'driverTracking', trackingKey), { isActive: false }).catch(() => {});
    }
    activeRef.current = false;
  };

  useEffect(() => {
    if (!isEnRoute || !trackingKey) {
      stop();
      return;
    }

    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;

    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) {
          console.warn('[useDriverTracking] Location permission not granted');
          return;
        }

        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;

        await setDoc(doc(firestore, 'driverTracking', trackingKey), {
          driverId: uid,
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          heading: loc.coords.heading ?? null,
          updatedAt: serverTimestamp(),
          isActive: true,
        });
        activeRef.current = true;
        console.log('[useDriverTracking] Started tracking, key:', trackingKey);

        intervalRef.current = setInterval(async () => {
          try {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            await updateDoc(doc(firestore, 'driverTracking', trackingKey), {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading ?? null,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn('[useDriverTracking] Interval update failed:', e);
          }
        }, 10000);
      } catch (e) {
        console.warn('[useDriverTracking] Failed to start tracking:', e);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [isEnRoute, trackingKey]);
}
