/**
 * Payment Utilities
 * Helper functions for payment calculations and formatting
 */

/**
 * Calculate ride total with platform fee
 */
export function calculateRideTotal(params: {
  baseFare: number; // in cents
  platformFeePercentage?: number; // default 20%
  minimumPlatformFee?: number; // in cents, default $3
}): {
  baseFare: number;
  platformFee: number;
  total: number;
} {
  const { baseFare, platformFeePercentage = 20, minimumPlatformFee = 300 } = params;

  // Calculate platform fee as percentage
  const calculatedFee = Math.round(baseFare * (platformFeePercentage / 100));
  
  // Use minimum fee if calculated is lower
  const platformFee = Math.max(calculatedFee, minimumPlatformFee);

  return {
    baseFare,
    platformFee,
    total: baseFare + platformFee,
  };
}

/**
 * Format currency from cents to display string
 */
export function formatCurrency(cents: number, includeCents: boolean = true): string {
  const dollars = cents / 100;
  return includeCents ? `$${dollars.toFixed(2)}` : `$${Math.floor(dollars)}`;
}

/**
 * Parse currency string to cents
 */
export function parseCurrencyToCents(currencyString: string): number {
  const cleaned = currencyString.replace(/[$,\s]/g, '');
  const dollars = parseFloat(cleaned);
  return Math.round(dollars * 100);
}

/**
 * Calculate estimated fare based on distance and duration
 */
export function estimateFare(params: {
  distanceMiles: number;
  durationMinutes: number;
  baseFarePerMile?: number; // in cents, default $2.50/mile
  baseFarePerMinute?: number; // in cents, default $0.30/minute
  minimumFare?: number; // in cents, default $5
}): number {
  const {
    distanceMiles,
    durationMinutes,
    baseFarePerMile = 250, // $2.50/mile
    baseFarePerMinute = 30, // $0.30/minute
    minimumFare = 500, // $5 minimum
  } = params;

  const distanceFare = Math.round(distanceMiles * baseFarePerMile);
  const durationFare = Math.round(durationMinutes * baseFarePerMinute);
  const calculatedFare = distanceFare + durationFare;

  return Math.max(calculatedFare, minimumFare);
}

/**
 * Validate payment amount is within acceptable range
 */
export function validatePaymentAmount(
  cents: number,
  options?: {
    minimum?: number; // default $1
    maximum?: number; // default $500
  }
): { valid: boolean; error?: string } {
  const minimum = options?.minimum ?? 100; // $1
  const maximum = options?.maximum ?? 50000; // $500

  if (cents < minimum) {
    return {
      valid: false,
      error: `Amount must be at least ${formatCurrency(minimum)}`,
    };
  }

  if (cents > maximum) {
    return {
      valid: false,
      error: `Amount cannot exceed ${formatCurrency(maximum)}`,
    };
  }

  return { valid: true };
}

/**
 * Calculate refund amount (if partial refund needed)
 */
export function calculateRefund(params: {
  originalAmount: number; // in cents
  refundPercentage?: number; // default 100%
  minimumRefund?: number; // in cents, default $0
}): number {
  const { originalAmount, refundPercentage = 100, minimumRefund = 0 } = params;

  const calculatedRefund = Math.round(originalAmount * (refundPercentage / 100));
  return Math.max(calculatedRefund, minimumRefund);
}

/**
 * Format payment method display string
 */
export function formatPaymentMethodDisplay(paymentMethod: {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
}): string {
  const brandName = paymentMethod.brand.charAt(0).toUpperCase() + paymentMethod.brand.slice(1);
  return `${brandName} ****${paymentMethod.last4}`;
}

/**
 * Get payment method icon name based on brand
 */
export function getPaymentMethodIconName(brand: string): string {
  switch (brand.toLowerCase()) {
    case 'visa':
      return 'visa';
    case 'mastercard':
      return 'mastercard';
    case 'amex':
    case 'american express':
      return 'amex';
    case 'discover':
      return 'discover';
    case 'diners':
    case 'diners club':
      return 'diners';
    case 'jcb':
      return 'jcb';
    case 'unionpay':
      return 'unionpay';
    default:
      return 'credit-card';
  }
}

/**
 * Validate card expiry date
 */
export function isCardExpired(expMonth: number, expYear: number): boolean {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 0-indexed

  // Convert 2-digit year to 4-digit if needed
  const fullYear = expYear < 100 ? 2000 + expYear : expYear;

  if (fullYear < currentYear) return true;
  if (fullYear === currentYear && expMonth < currentMonth) return true;

  return false;
}

/**
 * Calculate authorization hold release time
 * Stripe automatically releases holds after 7 days if not captured
 */
export function getAuthorizationReleaseDate(authorizedAt: Date = new Date()): Date {
  const releaseDate = new Date(authorizedAt);
  releaseDate.setDate(releaseDate.getDate() + 7);
  return releaseDate;
}

/**
 * Format authorization hold message
 */
export function getAuthorizationMessage(amount: number): string {
  return `We will authorize ${formatCurrency(amount)} on your card. This amount will be held but not charged until the driver confirms pickup. If the ride is cancelled, the hold will be released.`;
}

/**
 * Get Stripe test card recommendations
 */
export function getStripeTestCards(): Array<{
  number: string;
  description: string;
  behavior: 'success' | 'decline' | 'error';
}> {
  return [
    {
      number: '4242 4242 4242 4242',
      description: 'Successful payment',
      behavior: 'success',
    },
    {
      number: '4000 0000 0000 9995',
      description: 'Declined - insufficient funds',
      behavior: 'decline',
    },
    {
      number: '4000 0000 0000 0002',
      description: 'Declined - generic decline',
      behavior: 'decline',
    },
    {
      number: '4000 0000 0000 0069',
      description: 'Expired card',
      behavior: 'decline',
    },
    {
      number: '4000 0000 0000 0127',
      description: 'Declined - incorrect CVC',
      behavior: 'decline',
    },
  ];
}

/**
 * Round to nearest cent (avoid floating point issues)
 */
export function roundToCents(cents: number): number {
  return Math.round(cents);
}

/**
 * Calculate split payment (if implementing driver payout)
 */
export function calculateDriverPayout(params: {
  total: number; // in cents
  platformFee: number; // in cents
  stripeFeePercentage?: number; // default 2.9%
  stripeFixedFee?: number; // in cents, default $0.30
}): {
  gross: number; // total amount
  platformFee: number; // RideAlong fee
  stripeFee: number; // Stripe processing fee
  driverPayout: number; // amount driver receives
} {
  const { total, platformFee, stripeFeePercentage = 2.9, stripeFixedFee = 30 } = params;

  // Stripe fee calculation
  const stripeFee = Math.round((total * stripeFeePercentage) / 100) + stripeFixedFee;

  // Driver gets: total - platform fee - stripe fee
  const driverPayout = total - platformFee - stripeFee;

  return {
    gross: total,
    platformFee,
    stripeFee,
    driverPayout: Math.max(0, driverPayout), // Ensure non-negative
  };
}
