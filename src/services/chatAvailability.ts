import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import { firestore } from '@/constants/services';
import { canSendMessages, isTerminalStatus, MESSAGING_DISABLED_MESSAGE } from '@/constants/rideStatusConstants';
import { roleKey } from '@/src/utils/roleIdentity';

const textValue = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const firstString = (...values: unknown[]) => textValue(...values) || null;

export type ChatAvailability = {
  status: string | null;
  available: boolean;
  unavailableMessage?: string;
  rideInfo?: string;
};

function addressText(data: Record<string, any>, kind: 'pickup' | 'dropoff') {
  if (kind === 'pickup') {
    return textValue(data.pickup, data.pickupAddress, data.from, data.origin, data.pickupLocation?.address, data.pickupGeo?.address);
  }
  return textValue(data.dropoff, data.dropoffAddress, data.destination, data.to, data.dropoffLocation?.address, data.dropoffGeo?.address);
}

function routeInfo(data: Record<string, any>) {
  const from = addressText(data, 'pickup');
  const to = addressText(data, 'dropoff');
  const date = textValue(data.date, data.departureDate, data.scheduledDate);
  const route = [from, to].filter(Boolean).join(' -> ');
  return [route, date].filter(Boolean).join(' - ');
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rideDateFromData(data: Record<string, any>): Date | null {
  const direct = toDate(data.scheduledAt || data.dateTime || data.requestedTime || data.pickupTime || data.departureTime);
  if (direct) return direct;
  const dateValue = data.date || data.departureDate || data.scheduledDate;
  const timeValue = data.time || data.departureTime || data.scheduledTime;
  if (typeof dateValue === 'string') {
    const dateMatch = dateValue.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (dateMatch) {
      let hours = 0;
      let minutes = 0;
      if (typeof timeValue === 'string') {
        const timeMatch = timeValue.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
          hours = Number(timeMatch[1]);
          minutes = Number(timeMatch[2] || 0);
          const meridiem = timeMatch[3]?.toLowerCase();
          if (meridiem === 'pm' && hours < 12) hours += 12;
          if (meridiem === 'am' && hours === 12) hours = 0;
        }
      }
      return new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hours, minutes);
    }
  }
  return toDate(dateValue);
}

function hasRideActivity(data: Record<string, any>): boolean {
  return Boolean(
    firstString(
      data.confirmedRideId,
      data.rideOfferId,
      data.offerId,
      data.acceptedBy,
      data.assignedDriverId,
    )
    || data.hasOffers === true
    || data.hasRequests === true
    || Number(data.offerCount || data.offersCount || data.requestCount || data.requestsCount || 0) > 0
  );
}

async function loadStatus(collectionName: string, id: string | null) {
  if (!id) return null;
  const snap = await getDoc(doc(firestore, collectionName, id)).catch(() => null);
  if (!snap?.exists()) return null;
  const data = snap.data() as Record<string, any>;
  const rideDate = rideDateFromData(data);
  const status = textValue(data.status, data.state) || null;
  const normalizedStatus = String(status || '').replace(/[-\s]+/g, '_').toLowerCase();
  const pastMs = rideDate ? Date.now() - rideDate.getTime() : 0;
  const shouldExpireByDate = rideDate && !isTerminalStatus(status) && (
    (['pending', 'open', 'requested', 'available', 'posted'].includes(normalizedStatus || 'pending') && pastMs > 5 * 60 * 1000 && !hasRideActivity(data))
    || (!normalizedStatus && pastMs > 5 * 60 * 1000 && !hasRideActivity(data))
  );
  return {
    status: shouldExpireByDate ? 'expired' : status,
    rideInfo: routeInfo(data),
  };
}

export async function resolveChatAvailability(chatData: Record<string, any>): Promise<ChatAvailability> {
  const candidates = [
    ['confirmedRides', firstString(chatData.rideId, chatData.confirmedRideId)],
    ['rideRequests', firstString(chatData.rideRequestId, chatData.requestId)],
    ['ridePostingRequests', firstString(chatData.ridePostingRequestId, chatData.bookingRequestId)],
    ['ridePostings', firstString(chatData.ridePostingId, chatData.postingId)],
    ['rideOffers', firstString(chatData.rideOfferId, chatData.offerId)],
  ] as const;

  for (const [collectionName, id] of candidates) {
    const result = await loadStatus(collectionName, id);
    if (!result) continue;
    let status = result.status;

    // If the request/offer appears still active, cross-check the associated
    // confirmedRides doc — the ride may have since completed.
    if (status && !isTerminalStatus(status) && collectionName !== 'confirmedRides') {
      try {
        const field = collectionName === 'rideRequests' ? 'rideRequestId'
          : collectionName === 'rideOffers' ? 'rideOfferId'
          : collectionName === 'ridePostingRequests' ? 'ridePostingRequestId'
          : collectionName === 'ridePostings' ? 'ridePostingId'
          : null;
        if (field && id) {
          const confSnap = await getDocs(query(collection(firestore, 'confirmedRides'), where(field, '==', id), limit(1)));
          if (!confSnap.empty) {
            const confStatus = textValue(confSnap.docs[0].data()?.status) || null;
            if (confStatus && (isTerminalStatus(confStatus) || !canSendMessages(confStatus))) {
              status = confStatus;
            }
          }
        }
      } catch {}
    }

    const available = canSendMessages(status) && !isTerminalStatus(status);
    return {
      status,
      available,
      unavailableMessage: available ? undefined : MESSAGING_DISABLED_MESSAGE,
      rideInfo: result.rideInfo,
    };
  }

  const status = textValue(chatData.rideStatus, chatData.status) || null;
  return {
    status,
    available: status ? canSendMessages(status) && !isTerminalStatus(status) : true,
    unavailableMessage: status && (!canSendMessages(status) || isTerminalStatus(status)) ? MESSAGING_DISABLED_MESSAGE : undefined,
    rideInfo: routeInfo(chatData),
  };
}

const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');

type RideChatInput = {
  context: 'booking-request' | 'ride-offer' | 'confirmed-ride';
  rideId: string;
  riderId: string;
  driverId: string;
  ridePostingId?: string | null;
  rideRequestId?: string | null;
  ridePostingRequestId?: string | null;
  rideOfferId?: string | null;
};

export async function getOrCreateRideChat(input: RideChatInput): Promise<string> {
  const scopeId = input.ridePostingRequestId || input.rideOfferId || input.rideRequestId || input.rideId;
  const chatId = safeId(`${input.context}_${scopeId}_${input.driverId}_${input.riderId}`);
  const chatRef = doc(firestore, 'chats', chatId);
  const existing = await getDoc(chatRef).catch(() => null);
  await setDoc(
    chatRef,
    {
      participants: [input.driverId, input.riderId],
      participantKeys: [roleKey('driver', input.driverId), roleKey('rider', input.riderId)],
      participantRoles: { [input.driverId]: 'driver', [input.riderId]: 'rider' },
      driverId: input.driverId,
      riderId: input.riderId,
      rideId: input.context === 'confirmed-ride' ? input.rideId : null,
      ridePostingId: input.ridePostingId || null,
      rideRequestId: input.rideRequestId || null,
      ridePostingRequestId: input.ridePostingRequestId || null,
      rideOfferId: input.rideOfferId || null,
      context: input.context,
      updatedAt: serverTimestamp(),
      ...(existing?.exists() ? {} : {
        createdAt: serverTimestamp(),
        lastMessage: null,
        lastMessageTimestamp: null,
      }),
    },
    { merge: true },
  );
  return chatId;
}
