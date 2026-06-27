import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';

import { firebaseAuth } from '@/constants/services';
import { findPendingRatingRide } from '@/src/services/ratings';

export function usePendingRatingGate(role: 'rider' | 'driver', enabled: boolean) {
  const pathname = usePathname();
  const checkingRef = useRef(false);
  const lastRedirectRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (pathname.includes('/rate-trip')) return;
    if (checkingRef.current) return;

    const userId = firebaseAuth.currentUser?.uid;
    if (!userId) return;

    let cancelled = false;
    checkingRef.current = true;

    (async () => {
      try {
        const confirmedRideId = await findPendingRatingRide(userId, role);
        if (cancelled || !confirmedRideId) return;

        const redirectKey = `${role}:${confirmedRideId}`;
        if (lastRedirectRef.current === redirectKey) return;
        lastRedirectRef.current = redirectKey;

        router.replace({
          pathname: role === 'rider' ? '/(rider)/rate-trip' : '/(driver)/rate-trip',
          params: { confirmedRideId },
        } as any);
      } finally {
        if (!cancelled) checkingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      checkingRef.current = false;
    };
  }, [enabled, pathname, role]);
}
