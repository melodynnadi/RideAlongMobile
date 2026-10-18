// Ride price offers — one-time negotiation (server: RideAlongWebApp server/offers/negotiation.js).
// Whoever posts sets the price; the other side accepts it or proposes their own price once;
// the poster accepts or declines. No counter to a counter.
//   - Driver's posting: a rider books at the listed price or offers their own.
//   - Rider's request:  a driver offers at the rider's price or proposes their own.
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { computeContributionRange } from '@/src/utils/pricing';

/** The rider declines a driver's offer; the driver is notified and can send a new one. */
export async function declineRideOffer(offerId: string): Promise<void> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  const res = await fetch(`${getApiBaseUrl()}/api/offers/ride-offers/${encodeURIComponent(offerId)}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || 'Something went wrong. Try again.');
}

/**
 * Allowed per-seat price for someone proposing a price on a route:
 * riders can't go below the route minimum; nobody can go above the route maximum.
 */
export function proposalLimits(distanceMiles: number | null | undefined, seats: number | null | undefined, proposer: 'rider' | 'driver') {
  const { min, max } = distanceMiles && distanceMiles > 0 ? computeContributionRange(distanceMiles, seats) : { min: 0, max: 0 };
  return {
    min: proposer === 'rider' ? (min || 5) : 1,
    max: max || null,
  };
}

export const formatMoney = (n: number | null | undefined) => `$${Number(n || 0).toFixed(2)}`;
