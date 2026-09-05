// Centralized ride status constants for RideAlong platform
// Use these constants throughout the application for consistency

/**
 * Terminal ride statuses - rides in these states should not allow new messages
 */
export const TERMINAL_RIDE_STATUSES = [
  'completed',
  'COMPLETED',
  'canceled',
  'cancelled',
  'CANCELED',
  'CANCELLED',
  'expired',
  'EXPIRED',
  'rejected',
  'REJECTED',
  'declined',
  'DECLINED',
  'complete',
  'COMPLETE',
  'finished',
  'FINISHED',
] as const;

/**
 * Active ride statuses - rides in these states allow messaging
 */
export const ACTIVE_RIDE_STATUSES = [
  'confirmed',
  'CONFIRMED',
  'in_progress',
  'IN_PROGRESS',
  'in-progress',
  'IN-PROGRESS',
  'active',
  'ACTIVE',
  'pending',
  'PENDING',
  'open',
  'OPEN',
  'requested',
  'REQUESTED',
  'offered',
  'OFFERED',
  'offer_sent',
  'OFFER_SENT',
  'accepted',
  'ACCEPTED',
] as const;

export const normalizeRideStatus = (status: string | undefined | null): string =>
  String(status || '').replace(/[-\s]+/g, '_').toLowerCase().trim();

/**
 * Check if a ride status is terminal (no more messaging allowed)
 * @param status - The ride status to check
 * @returns True if status is terminal
 */
export function isTerminalStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  const normalizedStatus = normalizeRideStatus(status);
  return TERMINAL_RIDE_STATUSES.some(s => normalizeRideStatus(s) === normalizedStatus);
}

/**
 * Check if a ride status allows messaging
 * @param status - The ride status to check
 * @returns True if messaging is allowed
 */
export function canSendMessages(status: string | undefined | null): boolean {
  if (!status) return false;
  const normalizedStatus = normalizeRideStatus(status);
  return ACTIVE_RIDE_STATUSES.some(s => normalizeRideStatus(s) === normalizedStatus);
}

/**
 * Message to display when messaging is disabled
 */
export const MESSAGING_DISABLED_MESSAGE = 'This chat is no longer available for this ride.';
