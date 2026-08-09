export const PLATFORM_FEE_RATE = 0.0725; // 7.25% platform maintenance fee
export const STRIPE_FEE_RATE = 0.029; // 2.9% Stripe processing fee
export const STRIPE_FIXED_FEE = 0.30; // $0.30 Stripe fixed fee per transaction

/** Intracity / intercity distance threshold (miles) */
export const INTRACITY_THRESHOLD = 25;

/** Intracity pricing constants */
export const INTRACITY_BASE_FARE = 2.50;
export const INTRACITY_PER_MILE  = 0.95;

/** Intercity pricing constants (per 25-mile segment) */
export const INTERCITY_RATE_1_SEAT  = 9.0;
export const INTERCITY_RATE_2_SEATS = 7.5;

/** Minimum fare for any ride */
export const MIN_FARE = 5;

/**
 * Determine ride type based on distance.
 */
export function getRideType(distanceInMiles: number): 'intracity' | 'intercity' {
  return distanceInMiles < INTRACITY_THRESHOLD ? 'intracity' : 'intercity';
}

/**
 * Compute the suggested/max base fare for a ride.
 *
 * Intracity  (<25 mi): $2.50 + $0.95/mile, $5 min
 * Intercity (≥25 mi): ceil(miles/25) × segment rate, $5 min
 */
export function computeBaseFare(
  distanceInMiles: number,
  seats: 1 | 2 = 1,
): number {
  if (!distanceInMiles || distanceInMiles <= 0) return 0;

  const rideType = getRideType(distanceInMiles);

  if (rideType === 'intracity') {
    const price = INTRACITY_BASE_FARE + distanceInMiles * INTRACITY_PER_MILE;
    return Math.max(MIN_FARE, round2(price));
  }

  // Intercity
  const segments = Math.ceil(distanceInMiles / 25);
  const rate = seats === 1 ? INTERCITY_RATE_1_SEAT : INTERCITY_RATE_2_SEATS;
  return Math.max(MIN_FARE, segments * rate);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcPlatformFee(baseFare: number): number {
  return round2(baseFare * PLATFORM_FEE_RATE);
}

/**
 * Calculate Stripe processing fee (2.9% + $0.30)
 * Note: Stripe charges on the total amount we process, not just the base fare
 */
export function calcStripeFee(totalAmount: number): number {
  return round2(totalAmount * STRIPE_FEE_RATE + STRIPE_FIXED_FEE);
}

export function toCents(amountUsd: number): number {
  return Math.round(amountUsd * 100);
}

/**
 * Compute all fees and totals for a ride
 * 
 * Fee structure:
 * 1. Base fare (what the rider contributes to the ride cost)
 * 2. Platform fee (7.25% of base fare for maintenance/operations)
 * 3. Stripe fee (2.9% + $0.30 of the total transaction)
 * 
 * The rider pays: base fare + platform fee + stripe fee
 * The driver receives: base fare
 * The platform receives: platform fee + stripe fee
 */
export function computeTotals(baseFare: number) {
  const rideFee = round2(baseFare);
  const platformFee = calcPlatformFee(baseFare);
  
  // Subtotal before Stripe fees
  const subtotal = round2(rideFee + platformFee);
  
  // Calculate Stripe fee on the subtotal
  const stripeFee = calcStripeFee(subtotal);
  
  // Total amount the rider pays
  const total = round2(subtotal + stripeFee);
  const totalInCents = toCents(total);
  
  return { 
    rideFee,        // Amount driver receives
    platformFee,    // Platform maintenance fee (7.25%)
    stripeFee,      // Stripe processing fee (2.9% + $0.30)
    subtotal,       // rideFee + platformFee
    total,          // Total rider pays (includes all fees)
    totalInCents    // Total in cents for Stripe
  };
}
