import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { useDriverTracking, type NearbyInfo } from './useDriverTracking';

// Rides in these states are done needing pre-pickup location tracking —
// either the rider is already in the car or the ride never happened.
const DONE_STATUSES = new Set([
  'in_progress', 'driver_completed', 'rider_completed', 'completed',
  'cancelled', 'canceled', 'rejected', 'declined',
]);

function extractPickupCoords(data: any): { lat: number; lng: number } | null {
  const geo = data?.originalRidePosting?.pickupGeo || data?.pickupGeo || null;
  const lat = geo?.lat ?? geo?.latitude ?? data?.pickupLat ?? null;
  const lng = geo?.lng ?? geo?.longitude ?? data?.pickupLng ?? null;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

// Drives the driver's live-location writes for the whole (driver) tab session,
// independent of which screen/card happens to be mounted. Tapping "I'm on my
// way" only flips confirmedRides.driverEnRoute — this hook is what actually
// keeps the driverTracking doc (which the rider's map screen reads) alive
// for as long as a ride is genuinely still pre-pickup, surviving navigation
// away from the home tab. It also watches for the driver's proximity to the
// pickup point so useDriverTracking can fire the "almost there" notification.
export function useGlobalDriverEnRouteTracking(enabled: boolean) {
  const [trackingKey, setTrackingKey] = useState<string | null>(null);
  const [nearbyInfo, setNearbyInfo] = useState<NearbyInfo | null>(null);

  useEffect(() => {
    if (!enabled) { setTrackingKey(null); setNearbyInfo(null); return; }
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) {
      console.warn('[useGlobalDriverEnRouteTracking] enabled but no firebaseAuth.currentUser — skipping');
      setTrackingKey(null);
      setNearbyInfo(null);
      return;
    }

    console.log('[useGlobalDriverEnRouteTracking] subscribing for driverId:', uid);

    const q = query(
      collection(firestore, 'confirmedRides'),
      where('driverId', '==', uid),
      where('driverEnRoute', '==', true),
    );

    const unsub = onSnapshot(q, (snap) => {
      console.log('[useGlobalDriverEnRouteTracking] snapshot size:', snap.size, 'docs:', snap.docs.map((d) => ({ id: d.id, status: d.data().status, ridePostingId: d.data().ridePostingId })));
      const active = snap.docs.find((d) => !DONE_STATUSES.has(String(d.data().status || '').toLowerCase()));
      if (!active) {
        console.log('[useGlobalDriverEnRouteTracking] no active (non-done) ride found — clearing trackingKey');
        setTrackingKey(null);
        setNearbyInfo(null);
        return;
      }
      const data = active.data() as any;
      const key = data.ridePostingId ? String(data.ridePostingId) : active.id;
      console.log('[useGlobalDriverEnRouteTracking] setting trackingKey:', key);
      setTrackingKey(key);

      const pickupCoords = extractPickupCoords(data);
      console.log('[useGlobalDriverEnRouteTracking] pickup coords for ride', active.id, ':', pickupCoords, '| driverNearbySent:', !!data.driverNearbySent);
      setNearbyInfo({
        rideId: active.id,
        pickupLat: pickupCoords?.lat ?? null,
        pickupLng: pickupCoords?.lng ?? null,
        alreadySent: !!data.driverNearbySent,
      });
    }, (error) => {
      console.warn('[useGlobalDriverEnRouteTracking] onSnapshot error:', error?.code, error?.message);
      setTrackingKey(null);
      setNearbyInfo(null);
    });

    return unsub;
  }, [enabled]);

  useDriverTracking(trackingKey, !!trackingKey, nearbyInfo);
}
