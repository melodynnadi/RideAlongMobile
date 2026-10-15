import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getApiBaseUrl } from '@/constants/services';
import { authHeaders } from '@/services/promoCheckout';

export type DriverBonus = {
  id: string;
  title: string;
  description: string;
  rideTarget: number;
  rewardAmount: number;
  enrollment: 'auto' | 'opt_in';
  window: 'campaign' | 'weekly' | 'rolling';
  repeat: boolean;
  minFare: number;
  count: number;
  timesEarned: number;
  status: 'not_joined' | 'in_progress' | 'earned' | 'budget_reached';
  periodEndsAt: string | null;
  rollingNotStarted: boolean;
};

/**
 * Driver bonus campaigns with this driver's progress (server-computed).
 * Reloads whenever the screen regains focus, so progress updates after a ride.
 */
export function useDriverBonuses() {
  const [bonuses, setBonuses] = useState<DriverBonus[]>([]);
  const [joining, setJoining] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/driver-bonuses`, { headers: await authHeaders() });
      if (!res.ok) return; // older server or signed out — show nothing new
      const body = await res.json();
      if (request === requestRef.current) setBonuses(Array.isArray(body.bonuses) ? body.bonuses : []);
    } catch {
      // keep the last list when offline
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const join = useCallback(async (id: string) => {
    setJoining(id);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/driver-bonuses/${encodeURIComponent(id)}/join`, {
        method: 'POST',
        headers: await authHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any).error || 'Could not join this bonus.');
      await load();
    } finally {
      setJoining(null);
    }
  }, [load]);

  return { bonuses, join, joining, reload: load };
}
