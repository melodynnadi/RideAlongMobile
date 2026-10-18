// Price offers & negotiation (server: RideAlongWebApp server/offers/negotiation.js).
// A price is proposed (driver offer on a request / rider booking on a posting); the
// recipient accepts, rejects, or counters once; a counter can only be accepted or rejected.
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { computeContributionRange } from '@/src/utils/pricing';

export type NegotiationStatus = 'countered' | 'agreed' | 'rejected' | 'closed' | 'unavailable';

export type Negotiation = {
  status: NegotiationStatus;
  counteredBy: 'rider' | 'driver';
  counterAmount: number;
  originalAmount: number;
  counterPaymentIntentId?: string;
};

async function post<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || 'Something went wrong. Try again.');
  return data as T;
}

/** Rider counters a driver's offer. `paymentIntentId` must be a hold for the counter price. */
export const counterRideOffer = (offerId: string, amount: number, paymentIntentId: string) =>
  post(`/api/offers/ride-offers/${encodeURIComponent(offerId)}/counter`, { amount, paymentIntentId });

/** Rider declines a driver's open offer, or the driver answers the rider's counter. */
export const respondToRideOffer = (offerId: string, action: 'accept' | 'reject') =>
  post<{ status: string; confirmedRideId?: string }>(`/api/offers/ride-offers/${encodeURIComponent(offerId)}/respond`, { action });

/** Driver counters a rider's booking request on their posting. */
export const counterBookingRequest = (requestId: string, amount: number) =>
  post(`/api/offers/booking-requests/${encodeURIComponent(requestId)}/counter`, { amount });

/** Rider answers the driver's counter. Accepting needs a hold for the counter price. */
export const respondToBookingCounter = (requestId: string, action: 'accept' | 'reject', paymentIntentId?: string) =>
  post<{ status: string; confirmedRideId?: string }>(`/api/offers/booking-requests/${encodeURIComponent(requestId)}/respond`, { action, paymentIntentId });

/**
 * Allowed per-seat price for someone proposing a price on a route (same rules the server applies):
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
