// Two-tier pricing: intracity (<25mi) and intercity (≥25mi)
// Treat any selection >=2 as the 2-seat tier
// Driver max uses a higher per-mile rate ($1.25) than the rider minimum ($0.95)

/** Distance threshold separating intracity from intercity rides (miles) */
export const INTRACITY_THRESHOLD = 25;

/** Intracity constants (driver maximum cap) */
export const INTRACITY_BASE_FARE = 2.50; // flat base fare
export const INTRACITY_PER_MILE  = 1.25; // per-mile rate (driver max cap)

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

/**
 * Compute the maximum price a driver can set per seat.
 *
 * Intracity  (<25 mi): $2.50 base + $1.25/mile, $5 minimum
 * Intercity (>=25 mi): ceil(miles / 25) x rate, $5 minimum
 *   - 1 seat:  $9.00 per 25-mile segment
 *   - 2+ seats: $7.50 per 25-mile segment
 */
export function computeMaxPrice(distanceInMiles: number, seats: 1 | 2): number {
  if (!distanceInMiles || distanceInMiles <= 0) return 0;

  const rideType = getRideType(distanceInMiles);

  if (rideType === 'intracity') {
    // Intracity: flat base + per-mile driver max rate ($1.25/mi)
    const price = INTRACITY_BASE_FARE + distanceInMiles * INTRACITY_PER_MILE;
    return Math.max(MIN_FARE, Math.round(price * 100) / 100);
  }

  // Intercity: segment-based pricing
  const segments = Math.ceil(distanceInMiles / 25);
  const rate = seats === 1 ? INTERCITY_RATE_1_SEAT : INTERCITY_RATE_2_SEATS;
  return Math.max(MIN_FARE, segments * rate);
}
