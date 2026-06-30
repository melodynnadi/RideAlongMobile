import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { firestore } from '@/constants/services';
import { roleKey, type RideAlongRole } from '@/src/utils/roleIdentity';

type NotificationRecordInput = {
  recipientId: string | null | undefined;
  recipientRole: RideAlongRole;
  type: string;
  title: string;
  message: string;
  driverId?: string | null;
  riderId?: string | null;
  rideId?: string | null;
  confirmedRideId?: string | null;
  rideRequestId?: string | null;
  ridePostingId?: string | null;
  ridePostingRequestId?: string | null;
  severity?: 'low' | 'normal' | 'high';
  dedupeId?: string | null;
  extra?: Record<string, unknown>;
};

export async function createRoleNotification(input: NotificationRecordInput): Promise<void> {
  if (!input.recipientId) return;
  const recipientId = String(input.recipientId);
  const payload = {
    userId: recipientId,
    recipientId,
    recipients: [recipientId],
    recipientRole: input.recipientRole,
    recipientKeys: [roleKey(input.recipientRole, recipientId)],
    type: input.type,
    title: input.title,
    message: input.message,
    body: input.message,
    driverId: input.driverId ?? null,
    riderId: input.riderId ?? null,
    rideId: input.rideId ?? input.confirmedRideId ?? null,
    confirmedRideId: input.confirmedRideId ?? input.rideId ?? null,
    rideRequestId: input.rideRequestId ?? null,
    ridePostingId: input.ridePostingId ?? null,
    ridePostingRequestId: input.ridePostingRequestId ?? null,
    severity: input.severity ?? 'normal',
    read: false,
    unread: true,
    createdAt: serverTimestamp(),
    timestamp: serverTimestamp(),
    ...(input.extra || {}),
  };

  if (input.dedupeId) {
    await setDoc(doc(firestore, 'notifications', input.dedupeId), payload, { merge: true });
    return;
  }

  await addDoc(collection(firestore, 'notifications'), payload);
}
