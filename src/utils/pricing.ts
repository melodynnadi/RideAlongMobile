// Two-tier pricing: intracity (<25mi) and intercity (>=25mi)
// Treat any selection >=2 as the 2-seat tier.
// Rider suggestions use the rider-facing minimum. Driver posts use the driver max cap.

/** Distance threshold separating intracity from intercity rides (miles) */
export const INTRACITY_THRESHOLD = 25;

/** Intracity constants */
export const INTRACITY_BASE_FARE = 2.50; // flat base fare
export const RIDER_INTRACITY_PER_MILE = 0.95;
export const DRIVER_INTRACITY_PER_MILE = 1.25;

/** Intercity constants (per 25-mile segment) */
export const INTERCITY_RATE_1_SEAT  = 9.0;  // 1 seat
export const INTERCITY_RATE_2_SEATS = 7.5;  // 2+ seats

/** Minimum fare for any ride */
export const MIN_FARE = 5;

/**
 * Determine ride type based on distance
 */
export function getRideType(distanceInMiles: number): 'intracity' | 'intercity' {
  return distanceInMiles < INTRACITY_THRESHOLD ? 'intracity' : 'intercity';
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeSeatTier(seats: number | null | undefined): 1 | 2 {
  return Number(seats) >= 2 ? 2 : 1;
}

function computeSegmentPrice(distanceInMiles: number, seats: number | null | undefined): number {
  const segments = Math.ceil(distanceInMiles / 25);
  const rate = normalizeSeatTier(seats) === 1 ? INTERCITY_RATE_1_SEAT : INTERCITY_RATE_2_SEATS;
  return Math.max(MIN_FARE, round2(segments * rate));
}

export function computeRiderSuggestedPrice(distanceInMiles: number, seats: number | null | undefined = 1): number {
  if (!distanceInMiles || distanceInMiles <= 0) return 0;
  if (getRideType(distanceInMiles) === 'intracity') {
    return Math.max(MIN_FARE, round2(INTRACITY_BASE_FARE + distanceInMiles * RIDER_INTRACITY_PER_MILE));
  }
  return computeSegmentPrice(distanceInMiles, seats);
}

export function computeDriverMaxPrice(distanceInMiles: number, seats: number | null | undefined = 1): number {
  if (!distanceInMiles || distanceInMiles <= 0) return 0;
  if (getRideType(distanceInMiles) === 'intracity') {
    return Math.max(MIN_FARE, round2(INTRACITY_BASE_FARE + distanceInMiles * DRIVER_INTRACITY_PER_MILE));
  }
  return computeSegmentPrice(distanceInMiles, seats);
}

export function computeContributionRange(distanceInMiles: number, seats: number | null | undefined = 1): { min: number; max: number } {
  if (!distanceInMiles || distanceInMiles <= 0) return { min: 0, max: 0 };
  return {
    min: computeRiderSuggestedPrice(distanceInMiles, seats),
    max: computeDriverMaxPrice(distanceInMiles, seats),
  };
}

export function formatContributionRange(distanceInMiles: number, seats: number | null | undefined = 1): string {
  const { min, max } = computeContributionRange(distanceInMiles, seats);
  if (!min || !max) return 'Select route to calculate';
  if (Math.abs(min - max) < 0.01) return `$${min.toFixed(2)} min/max`;
  return `$${min.toFixed(2)} - $${max.toFixed(2)} per seat`;
}

export function formatPricingBreakdown(distanceInMiles: number, seats: number | null | undefined = 1, mode: 'rider' | 'driver' = 'rider'): string {
  if (!distanceInMiles || distanceInMiles <= 0) return 'Select a route to calculate price';
  const tier = normalizeSeatTier(seats);
  if (getRideType(distanceInMiles) === 'intracity') {
    const rate = mode === 'driver' ? DRIVER_INTRACITY_PER_MILE : RIDER_INTRACITY_PER_MILE;
    const label = mode === 'driver' ? 'max' : 'suggested';
    const total = mode === 'driver' ? computeDriverMaxPrice(distanceInMiles, tier) : computeRiderSuggestedPrice(distanceInMiles, tier);
    return `$${total.toFixed(2)} ${label} - $${INTRACITY_BASE_FARE.toFixed(2)} + ${distanceInMiles.toFixed(1)} mi x $${rate.toFixed(2)}`;
  }
  const segments = Math.ceil(distanceInMiles / 25);
  const rate = tier === 1 ? INTERCITY_RATE_1_SEAT : INTERCITY_RATE_2_SEATS;
  const total = computeSegmentPrice(distanceInMiles, tier);
  return `$${total.toFixed(2)} ${mode === 'driver' ? 'max' : 'suggested'} - ${segments} x $${rate.toFixed(2)} per 25 mi`;
}

/**
 * Compute the maximum price a driver can set per seat.
 *
 * Intracity  (<25 mi): $2.50 base + $1.25/mile, $5 minimum
 * Intercity (>=25 mi): ceil(miles / 25) x rate, $5 minimum
 *   - 1 seat:  $9.00 per 25-mile segment
 *   - 2+ seats: $7.50 per 25-mile segment
 */
export function computeMaxPrice(distanceInMiles: number, seats: 1 | 2): number {
  return computeDriverMaxPrice(distanceInMiles, seats);
}
