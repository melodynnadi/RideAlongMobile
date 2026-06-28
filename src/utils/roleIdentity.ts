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
  /\bpassenger\b/,
];

const riderOnlyNotificationPatterns = [
  /\boffer received\b/,
  /\bdriver accepted\b/,
  /\brequest accepted\b/,
  /\bseat confirmed\b/,
  /\bpayment authorized\b/,
  /\brate your driver\b/,
];

const looksDriverOnlyNotification = (data: Record<string, any>) => (
  driverOnlyNotificationPatterns.some((pattern) => pattern.test(textBlob(data)))
);

const looksRiderOnlyNotification = (data: Record<string, any>) => (
  riderOnlyNotificationPatterns.some((pattern) => pattern.test(textBlob(data)))
);

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

  if (role === 'rider' && looksDriverOnlyNotification(data)) return false;
  if (role === 'driver' && looksRiderOnlyNotification(data)) return false;

  const recipients = asStringArray(data.recipients);
  const uidMatch = data.userId === uid || data.recipientId === uid || recipients.includes(uid);
  if (!uidMatch) return false;

  // When a notification has no role-scoping at all (just userId==uid), show it on the
  // role the user was in when the notification was created. If we still can't determine
  // that, default to showing it only on rider side to avoid double-showing on driver home.
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
