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
  'EXPIRED'
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
  'ACTIVE'
] as const;

/**
 * Check if a ride status is terminal (no more messaging allowed)
 * @param status - The ride status to check
 * @returns True if status is terminal
 */
export function isTerminalStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  const normalizedStatus = String(status).toLowerCase().trim();
  return TERMINAL_RIDE_STATUSES.some(s => s.toLowerCase() === normalizedStatus);
}

/**
 * Check if a ride status allows messaging
 * @param status - The ride status to check
 * @returns True if messaging is allowed
 */
export function canSendMessages(status: string | undefined | null): boolean {
  if (!status) return false;
  const normalizedStatus = String(status).toLowerCase().trim();
  return ACTIVE_RIDE_STATUSES.some(s => s.toLowerCase() === normalizedStatus);
}

/**
 * Message to display when messaging is disabled
 */
export const MESSAGING_DISABLED_MESSAGE = 'This conversation is closed. Messaging is no longer available for this ride.';
