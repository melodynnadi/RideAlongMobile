import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';

export type NearbyInfo = {
  rideId: string;
  pickupLat: number | null;
  pickupLng: number | null;
  alreadySent: boolean;
};

const NEARBY_THRESHOLD_MILES = 0.3;

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function useDriverTracking(trackingKey: string | null, isEnRoute: boolean, nearbyInfo: NearbyInfo | null = null) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(false);
  const nearbyInfoRef = useRef<NearbyInfo | null>(nearbyInfo);
  const nearbySentRef = useRef(false);

  useEffect(() => {
    nearbyInfoRef.current = nearbyInfo;
    nearbySentRef.current = !!nearbyInfo?.alreadySent;
  }, [nearbyInfo]);

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

  const checkNearby = async (lat: number, lng: number) => {
    const info = nearbyInfoRef.current;
    if (!info) {
      console.log('[useDriverTracking] checkNearby: no nearbyInfo yet — skipping');
      return;
    }
    if (nearbySentRef.current) {
      console.log('[useDriverTracking] checkNearby: already sent for this ride — skipping');
      return;
    }
    if (info.pickupLat == null || info.pickupLng == null) {
      console.log('[useDriverTracking] checkNearby: no pickup coords on ride', info.rideId, '— skipping proximity check');
      return;
    }

    const dist = distanceMiles(lat, lng, info.pickupLat, info.pickupLng);
    console.log(`[useDriverTracking] checkNearby: ${dist.toFixed(2)} mi from pickup (threshold ${NEARBY_THRESHOLD_MILES} mi)`);
    if (dist > NEARBY_THRESHOLD_MILES) return;

    console.log('[useDriverTracking] within threshold — calling driver-nearby endpoint for ride:', info.rideId);
    nearbySentRef.current = true; // optimistic — avoid duplicate calls while this request is in flight
    try {
      const token = await firebaseAuth.currentUser?.getIdToken();
      const res = await fetch(`${getApiBaseUrl()}/api/rides/${info.rideId}/driver-nearby`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        nearbySentRef.current = false;
        console.warn('[useDriverTracking] driver-nearby request failed:', res.status);
      } else {
        console.log('[useDriverTracking] driver-nearby notification sent for ride:', info.rideId);
      }
    } catch (e) {
      nearbySentRef.current = false;
      console.warn('[useDriverTracking] driver-nearby call failed:', e);
    }
  };

  useEffect(() => {
    if (!isEnRoute || !trackingKey) {
      stop();
      return;
    }

    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      console.warn('[useDriverTracking] isEnRoute+trackingKey set but no currentUser — skipping');
      return;
    }

    console.log('[useDriverTracking] effect running for trackingKey:', trackingKey);
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
        checkNearby(loc.coords.latitude, loc.coords.longitude);

        intervalRef.current = setInterval(async () => {
          try {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            await updateDoc(doc(firestore, 'driverTracking', trackingKey), {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading ?? null,
              updatedAt: serverTimestamp(),
            });
            checkNearby(pos.coords.latitude, pos.coords.longitude);
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
