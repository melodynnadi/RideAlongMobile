/**
 * Shared Ride Filter Types and Logic
 * Consistent across Web, Rider Mobile, and Driver Mobile
 */

// Time of Day Buckets
export const TimeBucket = {
  MORNING: 'morning',     // 5 AM – 12 PM
  AFTERNOON: 'afternoon', // 12 PM – 5 PM
  EVENING: 'evening'      // 5 PM – 12 AM
} as const;

export type TimeBucketType = typeof TimeBucket[keyof typeof TimeBucket];

// Time bucket hour ranges (24-hour format)
export const TIME_BUCKET_RANGES: Record<string, { start: number; end: number }> = {
  [TimeBucket.MORNING]: { start: 5, end: 12 },
  [TimeBucket.AFTERNOON]: { start: 12, end: 17 },
  [TimeBucket.EVENING]: { start: 17, end: 24 }
};

/**
 * Filter options structure
 */
export interface RideFilterOptions {
  date: string | null;              // Date string in 'YYYY-MM-DD' format
  timeBucket: TimeBucketType | null; // One of TimeBucket values
  pickupLocation: string | null;    // Pickup location text
  dropoffLocation: string | null;   // Dropoff location text
  minPrice: number | null;          // Minimum price
  maxPrice: number | null;          // Maximum price
  seats: number | null;             // Number of seats needed (only for riders)
}

/**
 * Default filter values
 */
export function getDefaultFilters(): RideFilterOptions {
  return {
    date: null,
    timeBucket: null,
    pickupLocation: null,
    dropoffLocation: null,
    minPrice: null,
    maxPrice: null,
    seats: null
  };
}

/**
 * Parse time string to hour (24-hour format)
 * Handles formats like: "14:30", "2:30 PM", "14:30:00"
 */
function parseTimeToHour(timeStr: any): number | null {
  if (!timeStr) return null;
  
  try {
    // Remove any seconds
    const time = String(timeStr).trim();
    
    // Handle "HH:MM:SS" or "HH:MM"
    const parts = time.split(':');
    if (parts.length >= 2) {
      let hour = parseInt(parts[0], 10);
      
      // Check for AM/PM
      const isPM = /pm/i.test(time);
      const isAM = /am/i.test(time);
      
      if (isPM && hour < 12) {
        hour += 12;
      } else if (isAM && hour === 12) {
        hour = 0;
      }
      
      return hour;
    }
    
    // Try parsing as Date object
    const date = new Date(`2000-01-01 ${time}`);
    if (!isNaN(date.getTime())) {
      return date.getHours();
    }
  } catch (e) {
    console.warn('Failed to parse time:', timeStr, e);
  }
  
  return null;
}

/**
 * Parse date string to Date object
 * Handles formats like: "2024-01-15", "2024-01-15 14:30:00", Date objects, Timestamps
 */
function parseDate(dateValue: any): Date | null {
  if (!dateValue) return null;
  
  try {
    // Already a Date object
    if (dateValue instanceof Date) {
      return dateValue;
    }
    
    // Firestore Timestamp
    if (dateValue.toDate && typeof dateValue.toDate === 'function') {
      return dateValue.toDate();
    }
    
    // Unix timestamp (number)
    if (typeof dateValue === 'number') {
      return new Date(dateValue);
    }
    
    // String date
    if (typeof dateValue === 'string') {
      // Parse as local date to avoid timezone issues
      const match = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const [, year, month, day] = match;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
      
      // Fallback to standard parsing
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  } catch (e) {
    console.warn('Failed to parse date:', dateValue, e);
  }
  
  return null;
}

/**
 * Format date to YYYY-MM-DD string
 */
export function formatDateString(date: any): string | null {
  if (!date) return null;
  
  const d = parseDate(date);
  if (!d) return null;
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Check if two dates are the same day (ignoring time)
 */
function isSameDay(date1: any, date2: any): boolean {
  if (!date1 || !date2) return false;
  
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);
  
  if (!d1 || !d2) return false;
  
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth() &&
         d1.getDate() === d2.getDate();
}

/**
 * Compute Levenshtein edit-distance between two strings.
 * Used for typo-tolerant location matching.
 */
function editDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

/**
 * Check whether a single search token fuzzy-matches any word in locationWords.
 * A match means either:
 *   - a location word starts with the token (prefix match), OR
 *   - the edit distance is within the allowed tolerance.
 * Tolerance = floor(max(tokenLen, wordLen) * 0.35), minimum 1 for tokens >= 3 chars.
 */
function fuzzyWordMatch(token: string, locationWords: string[]): boolean {
  for (const word of locationWords) {
    if (word.startsWith(token) || token.startsWith(word)) return true;
    const maxLen = Math.max(token.length, word.length);
    const tolerance = token.length < 3 ? 0 : Math.max(1, Math.floor(maxLen * 0.35));
    if (editDistance(token, word) <= tolerance) return true;
  }
  return false;
}

/**
 * Check if location matches search text.
 * Fuzzy, word-by-word matching: every search word must fuzzy-match at least
 * one word in the ride location. This handles typos, partial input, and
 * words in any order (e.g. "tyler broadway" matches "Broadway Square, Tyler TX").
 */
function locationMatches(rideLocation: any, searchLocation: string): boolean {
  if (!searchLocation || !searchLocation.trim()) return true;
  if (!rideLocation) return false;

  const normalise = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  const searchTokens = normalise(searchLocation).split(' ').filter(Boolean);
  const locationWords = normalise(rideLocation).split(' ').filter(Boolean);

  if (searchTokens.length === 0) return true;
  if (locationWords.length === 0) return false;

  return searchTokens.every((token) => fuzzyWordMatch(token, locationWords));
}

/**
 * Extract location string from various ride object formats
 */
function extractLocation(ride: any, type: 'pickup' | 'dropoff'): string | null {
  const field = type === 'pickup' ? 'pickup' : 'dropoff';
  
  // Try common field names
  const variations = [
    ride[field],
    ride[`${field}Location`],
    ride[`${field}Address`],
    type === 'pickup' ? ride.from : ride.to,
    type === 'pickup' ? ride.fromAddress : ride.toAddress,
    type === 'pickup' ? ride.origin : ride.destination
  ];
  
  for (const val of variations) {
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
    // Handle object with address property
    if (val && typeof val === 'object' && typeof val.address === 'string') {
      return val.address.trim();
    }
  }
  
  return null;
}

/**
 * Extract time string from ride object
 */
function extractTime(ride: any): string | null {
  // Try various time fields
  const timeFields = [
    ride.time,
    ride.departureTime,
    ride.pickupTime,
    ride.requestedTime,
    ride.timeString
  ];
  
  for (const field of timeFields) {
    if (field) return field;
  }
  
  // If date field contains time information
  const dateField = ride.date || ride.pickupDate || ride.departureDate;
  if (typeof dateField === 'string' && dateField.includes(':')) {
    const parts = dateField.split(' ');
    if (parts.length > 1 && parts[1].includes(':')) {
      return parts[1];
    }
  }
  
  return null;
}

/**
 * Extract date from ride object
 */
function extractDate(ride: any): any {
  const dateFields = [
    ride.date,
    ride.pickupDate,
    ride.departureDate,
    ride.rideDate,
    ride.requestedTime,
    ride.pickupTime
  ];
  
  for (const field of dateFields) {
    if (field) return field;
  }
  
  return null;
}

/**
 * Extract price from ride object
 */
function extractPrice(ride: any): number | null {
  const priceFields = [
    ride.price,
    ride.pricePerSeat,
    ride.contributionAmount,
    ride.estimatedFare,
    ride.fare,
    ride.baseFare,
    ride.totalPrice,
    ride.cost
  ];
  
  for (const field of priceFields) {
    if (typeof field === 'number') return field;
    if (typeof field === 'string') {
      const num = parseFloat(field.replace(/[^0-9.]/g, ''));
      if (!isNaN(num)) return num;
    }
  }
  
  return null;
}

/**
 * Extract available seats from ride object
 */
function extractSeats(ride: any): number | null {
  const seatFields = [
    ride.seats,
    ride.availableSeats,
    ride.seatsAvailable,
    ride.numberOfSeats,
    ride.capacity
  ];
  
  for (const field of seatFields) {
    if (typeof field === 'number') return field;
    if (typeof field === 'string') {
      const num = parseInt(field, 10);
      if (!isNaN(num)) return num;
    }
  }
  
  return null;
}

/**
 * Apply filters to a single ride
 * @param ride - Ride object
 * @param filters - Filter options
 * @param isRider - Whether filtering for a rider (applies seat filter)
 * @returns Whether ride passes all filters
 */
export function applyFiltersToRide(ride: any, filters: RideFilterOptions, isRider: boolean = false): boolean {
  if (!ride) return false;
  
  // 1. Date filter
  if (filters.date) {
    const rideDate = extractDate(ride);
    if (!isSameDay(rideDate, filters.date)) {
      return false;
    }
  }
  
  // 2. Time bucket filter
  if (filters.timeBucket) {
    const timeStr = extractTime(ride);
    const hour = parseTimeToHour(timeStr);
    
    if (hour !== null) {
      const range = TIME_BUCKET_RANGES[filters.timeBucket];
      if (range) {
        if (hour < range.start || hour >= range.end) {
          return false;
        }
      }
    } else if (filters.timeBucket) {
      // If we can't parse time but filter is set, exclude the ride
      return false;
    }
  }
  
  // 3. Pickup location filter
  if (filters.pickupLocation) {
    const pickup = extractLocation(ride, 'pickup');
    if (!locationMatches(pickup, filters.pickupLocation)) {
      return false;
    }
  }
  
  // 4. Dropoff location filter
  if (filters.dropoffLocation) {
    const dropoff = extractLocation(ride, 'dropoff');
    if (!locationMatches(dropoff, filters.dropoffLocation)) {
      return false;
    }
  }
  
  // 5. Price range filter
  const price = extractPrice(ride);
  if (price !== null) {
    if (filters.minPrice !== null && price < filters.minPrice) {
      return false;
    }
    if (filters.maxPrice !== null && price > filters.maxPrice) {
      return false;
    }
  } else if (filters.minPrice !== null || filters.maxPrice !== null) {
    // If price is required but not available, exclude
    return false;
  }
  
  // 6. Seats filter (only for riders)
  if (isRider && filters.seats !== null && filters.seats > 0) {
    const availableSeats = extractSeats(ride);
    if (availableSeats === null || availableSeats < filters.seats) {
      return false;
    }
  }
  
  return true;
}

/**
 * Apply filters to array of rides
 * @param rides - Array of ride objects
 * @param filters - Filter options
 * @param isRider - Whether filtering for a rider (applies seat filter)
 * @returns Filtered rides
 */
export function filterRides(rides: any[], filters: RideFilterOptions, isRider: boolean = false): any[] {
  if (!rides || !Array.isArray(rides)) return [];
  if (!filters) return rides;
  
  return rides.filter(ride => applyFiltersToRide(ride, filters, isRider));
}

/**
 * Check if any filters are active
 */
export function hasActiveFilters(filters: RideFilterOptions): boolean {
  if (!filters) return false;
  
  return filters.date !== null ||
         filters.timeBucket !== null ||
         (filters.pickupLocation !== null && filters.pickupLocation.trim() !== '') ||
         (filters.dropoffLocation !== null && filters.dropoffLocation.trim() !== '') ||
         filters.minPrice !== null ||
         filters.maxPrice !== null ||
         (filters.seats !== null && filters.seats > 0);
}
