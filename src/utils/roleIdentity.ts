export type RideAlongRole = 'rider' | 'driver';

export const roleKey = (role: RideAlongRole, uid: string) => `${role}:${uid}`;

export const roleUnreadField = (role: RideAlongRole, uid: string) => `unreadCount_${role}_${uid}`;

export const legacyUnreadField = (uid: string) => `unreadCount_${uid}`;

const asStringArray = (value: unknown): string[] => (
  Array.isArray(value) ? value.map(String).filter(Boolean) : []
);

const explicitNotificationRoles = (data: Record<string, any>): string[] => [
  ...asStringArray(data.roles),
  ...asStringArray(data.recipientRoles),
  ...asStringArray(data.targetRoles),
  data.role,
  data.recipientRole,
  data.targetRole,
  data.userRole,
].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  .map((value) => value.toLowerCase());

const textBlob = (data: Record<string, any>) => [
  data.type,
  data.category,
  data.actionType,
  data.notificationType,
  data.title,
  data.heading,
  data.message,
  data.body,
  data.text,
].filter((value) => typeof value === 'string')
  .join(' ')
  .replace(/[_-]/g, ' ')
  .toLowerCase();

const driverOnlyNotificationPatterns = [
  /\bpayout\b/,
  /\bearnings?\b/,
  /\bstripe\b/,
  /\bbank account\b/,
  /\bvehicle\b/,
  /\bdriver verification\b/,
  /\bride posting request\b/,
  /\bposting request\b/,
  /\bbooking request\b/,
  /\bnew ride request\b/,
  /\bride request received\b/,
  /\brequest received\b/,
  /\brequested (a seat|your ride|to join)\b/,
  /\bpassengers?\b/,
  /a rider has cancelled\b/,
  /\bwaitlist(ed)? (rider|person|user)\b/,
  /\bjoined your waitlist\b/,
];

const riderOnlyNotificationPatterns = [
  /\boffer received\b/,
  /\bdriver accepted\b/,
  /\brequest accepted\b/,
  /\bseat confirmed\b/,
  /\bpayment authorized\b/,
  /\brate your driver\b/,
  /\bpreferred.?route\b/,
];

const looksDriverOnlyNotification = (data: Record<string, any>) => (
  driverOnlyNotificationPatterns.some((pattern) => pattern.test(textBlob(data)))
);

const looksRiderOnlyNotification = (data: Record<string, any>) => (
  riderOnlyNotificationPatterns.some((pattern) => pattern.test(textBlob(data)))
);

export const notificationLooksDriverOnly = looksDriverOnlyNotification;
export const notificationLooksRiderOnly = looksRiderOnlyNotification;

export function notificationIsAddressedToUid(data: Record<string, any>, uid: string): boolean {
  const recipients = asStringArray(data.recipients);
  return data.userId === uid || data.recipientId === uid || recipients.includes(uid);
}

export function notificationHasExplicitRoleScope(data: Record<string, any>): boolean {
  return Boolean(
    asStringArray(data.recipientKeys).length > 0
    || explicitNotificationRoles(data).length > 0
    || data.driverId
    || data.driverUID
    || data.driverUid
    || data.riderId
    || data.riderUID
    || data.riderUid
  );
}

export function chatBelongsToRole(data: Record<string, any>, uid: string, role: RideAlongRole): boolean {
  const participants = asStringArray(data.participants);
  const participantKeys = asStringArray(data.participantKeys);
  const rolesByUser = data.participantRoles && typeof data.participantRoles === 'object' ? data.participantRoles : {};

  if (participantKeys.includes(roleKey(role, uid))) return true;
  if (rolesByUser[uid] === role) return true;

  if (role === 'driver') {
    if (String(data.driverId || data.driverUID || data.driverUid || '') === uid) return true;
    return false;
  }

  if (String(data.riderId || data.riderUID || data.riderUid || data.userId || '') === uid) return true;

  const hasExplicitRoleShape = Boolean(
    data.driverId || data.riderId || data.driverUID || data.riderUID || participantKeys.length || Object.keys(rolesByUser).length,
  );
  return !hasExplicitRoleShape && participants.includes(uid);
}

// Notification types that exclusively target drivers
const knownDriverNotificationTypes = new Set([
  'payout_sent', 'payout_pending', 'payout_failed',
  'bank_account_added', 'bank_account_verification_needed', 'bank_account_verification_failed',
  'driver_application_approved', 'driver_application_rejected', 'driver_approved', 'driver_rejected',
  'ride_request_received', 'ride_request_canceled', 'two_passenger_mode_reminder',
  'ride_fully_booked', 'ride_seats_filled_driver', 'ride_posting_expired',
  'waitlist_joined',
]);

// Notification types that exclusively target riders
const knownRiderNotificationTypes = new Set([
  'ride_request_submitted', 'ride_request_declined', 'ride_request_expired',
  'payment_success', 'charge_succeeded', 'charge_failed', 'refund_issued',
  'payment_method_added', 'payment_method_failed', 'payment_method_expiring',
  'student_verified', 'document_uploaded', 'verification_rejected',
  'student_document_uploaded', 'student_verification_approved', 'student_verification_rejected',
  'email_verification_reminder', 'email_verified', 'password_changed',
  'preferred_route_match', 'ride_offer', 'driver_on_the_way', 'driver_arrived',
  'ride_updated',
  'waitlist_seat_available', 'waitlist_ride_unavailable',
]);

export function notificationTypeIsRiderOnly(data: Record<string, any>): boolean {
  const type = String(data.type || '').toLowerCase().replace(/-/g, '_');
  return knownRiderNotificationTypes.has(type);
}

export function notificationBelongsToRole(data: Record<string, any>, uid: string, role: RideAlongRole): boolean {
  const recipientKeys = asStringArray(data.recipientKeys);
  if (recipientKeys.includes(roleKey(role, uid))) return true;
  if (recipientKeys.length > 0) return false;

  const roles = explicitNotificationRoles(data);
  if (roles.length > 0 && !roles.includes(role)) return false;
  if (roles.length > 0 && roles.includes(role)) return true;

  const driverId = String(data.driverId || data.driverUID || data.driverUid || '');
  const riderId = String(data.riderId || data.riderUID || data.riderUid || '');

  if (role === 'driver') {
    if (driverId === uid) return true;
    if (riderId === uid && driverId !== uid) return false;
  } else {
    if (riderId === uid) return true;
    if (driverId === uid && riderId !== uid) return false;
  }

  // Type-based detection catches known notification types even without role fields.
  // This fixes existing Firestore data that lacks recipientKeys.
  const notifType = String(data.type || '').toLowerCase().replace(/-/g, '_');
  if (knownDriverNotificationTypes.has(notifType)) return role === 'driver';
  if (knownRiderNotificationTypes.has(notifType)) return role === 'rider';

  if (role === 'rider' && looksDriverOnlyNotification(data)) return false;
  if (role === 'driver' && looksRiderOnlyNotification(data)) return false;

  const uidMatch = notificationIsAddressedToUid(data, uid);
  if (!uidMatch) return false;

  const createdForRole = data.userRole || data.senderRole || data.createdForRole;
  if (createdForRole) return String(createdForRole).toLowerCase() === role;

  // Truly ambiguous: show only on rider side so dual-role users don't see duplicates.
  return role === 'rider';
}

export function isReadForRole(data: Record<string, any>, uid: string, role: RideAlongRole): boolean {
  const readByRole = asStringArray(data.readByRole);
  if (readByRole.includes(roleKey(role, uid))) return true;
  if (data[`read_${role}_${uid}`] === true) return true;

  const roles = explicitNotificationRoles(data);
  if (roles.length > 0) return data.read === true || data.isRead === true || data.unread === false;

  const readBy = asStringArray(data.readBy);
  return data.read === true || data.isRead === true || data.unread === false || readBy.includes(uid);
}
