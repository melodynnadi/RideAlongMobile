/**
 * Checkout pricing + promotions.
 *
 * The server is the source of truth for what a booking costs: it reads the
 * fare from the booking itself (ride posting, driver offer, or the rider's own
 * new request), applies at most one promotion to the RideAlong platform fee,
 * and returns the breakdown. The app only displays what it gets back.
 */

import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

/** What is being booked. The server looks up the price from this. */
export type CheckoutBooking =
  | { type: 'ride_posting'; ridePostingId: string }
  | { type: 'ride_offer'; offerId: string }
  | { type: 'new_request'; fare: number };

/** Promo applied to a checkout: a typed code, or a saved (claimed) offer. */
export type PromoSelection = { promoCode: string } | { promotionId: string };

export type CheckoutPricing = {
  baseFareCents: number;
  platformFeeCents: number;
  discountCents: number;
  /** What the discount was applied to (null when there's no discount). */
  discountAppliesTo?: 'platform_fee' | 'ride' | null;
  platformFeeAfterDiscountCents: number;
  processingFeeCents: number;
  totalCents: number;
  driverPayoutCents: number;
  // Dollar conveniences from the server
  baseFare: number;
  platformFee: number;
  discount: number;
  platformFeeAfterDiscount: number;
  processingFee: number;
  total: number;
};

export type CheckoutQuote = {
  pricing: CheckoutPricing;
  /** appliesTo: 'platform_fee' = RideAlong fee only; 'ride' = fare + RideAlong fee (driver still paid in full). */
  promotion: { id: string; title: string; description?: string; appliesTo: 'platform_fee' | 'ride' } | null;
  promotionError: { reason: string; message: string } | null;
};

export class PromoCheckoutUnavailableError extends Error {}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

/** Price a booking (optionally with a promotion). Never reserves the promotion. */
export async function quoteCheckout(booking: CheckoutBooking, selection?: PromoSelection | null): Promise<CheckoutQuote> {
  const res = await fetch(`${getApiBaseUrl()}/api/promotions/quote`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ booking, ...(selection || {}) }),
  });
  // 404 = server without this endpoint yet; caller falls back to local pricing.
  if (res.status === 404) throw new PromoCheckoutUnavailableError('Checkout pricing unavailable');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || 'Could not price this ride');
  return body as CheckoutQuote;
}

/** One id per payment attempt; the server uses it to make retries idempotent. */
export function newCheckoutId(): string {
  return `co_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
