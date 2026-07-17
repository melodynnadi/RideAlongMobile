import {
  collection,
  addDoc,
  arrayUnion,
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/constants/services';
import {
  chatBelongsToRole,
  isReadForRole,
  notificationHasExplicitRoleScope,
  notificationIsAddressedToUid,
  notificationLooksDriverOnly,
  notificationBelongsToRole,
  roleKey,
  roleUnreadField,
  legacyUnreadField,
  type RideAlongRole,
} from '@/src/utils/roleIdentity';
import { resolveChatAvailability, type ChatAvailability } from '@/src/services/chatAvailability';

function handleSnapshotError(scope: string, error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'permission-denied') {
    console.warn(`[${scope}] Firestore permission denied; listener stopped.`);
    return;
  }
  console.warn(`[${scope}] Firestore listener error:`, error);
}

export type RiderProfile = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  university?: string;
  rating?: number;
  about?: string;
};

export type MobileRidePosting = {
  id: string;
  from: string;
  to: string;
  date: Date | null;
  price: number;
  seats: number;
  status: string;
  driverId?: string;
  driverName: string;
  driverAvatarUrl?: string;
  driverRating?: number;
  vehicle: string;
  raw: DocumentData;
  // Recurring schedule fields
  isRecurring?: boolean;
  scheduleId?: string;
  scheduleDate?: string;
  // Waitlist
  isFull?: boolean;
  availableSeats?: number;
};

export type MobileConversation = {
  id: string;
  otherUserId?: string;
  name: string;
  initials: string;
  photoURL?: string | null;
  preview: string;
  updatedAt: Date | null;
  unread: number;
  rideId?: string;
  chatAvailable?: boolean;
  unavailableMessage?: string;
};

export type MobileRideRequest = {
  id: string;
  from: string;
  to: string;
  date: Date | null;
  dateLabel: string;
  seats: number;
  price: number;
  status: string;
  raw: DocumentData;
};

export type MobileMessage = {
  id: string;
  senderId: string;
  senderRole?: RideAlongRole;
  text: string;
  createdAt: Date | null;
};

export type MobileNotification = {
  id: string;
  title: string;
  body: string;
  createdAt: Date | null;
  read: boolean;
  type: string;
};

const textValue = (...values: unknown[]) => {
  for (const value of values) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
      const candidate = (value as any).address || (value as any).description || (value as any).name || (value as any).formattedAddress || (value as any).fullAddress;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return '';
};

const numberValue = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
};

const inactiveRideStatuses = new Set([
  'cancelled',
  'canceled',
  'completed',
  'complete',
  'finished',
  'rejected',
  'declined',
  'expired',
]);

const normalizedStatus = (value: unknown) => String(value || '').replace(/[-\s]/g, '_').toLowerCase();

const isInactiveRide = (ride: MobileRidePosting) => {
  const status = normalizedStatus(ride.status || ride.raw?.status);
  const statusAtFlag = normalizedStatus(
    ride.raw?.statusAtFlag || ride.raw?.statusBeforeFlag || ride.raw?.flaggedFromStatus || ride.raw?.previousStatus,
  );
  // DRIVER_COMPLETED/RIDER_COMPLETED still require the other party's action.
  // Older backend versions wrote completedAt too early, so the explicit active
  // status must take precedence over that legacy timestamp.
  const activeCompletionStatuses = new Set(['in_progress', 'driver_completed', 'rider_completed']);
  const hasLegacyCompletionTimestamp = Boolean(ride.raw?.completedAt || ride.raw?.endedAt);
  return inactiveRideStatuses.has(status)
    || statusAtFlag === 'completed'
    || (hasLegacyCompletionTimestamp && !activeCompletionStatuses.has(status));
};

export const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp || typeof value?.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const rideDateFromData = (data: DocumentData): Date | null => {
  const direct = toDate(
    data.scheduledAt || data.dateTime || data.requestedTime || data.pickupTime
      || data.originalRideRequest?.requestedTime || data.originalRidePosting?.departureTime,
  );
  if (direct) return direct;

  const dateValue = data.date || data.departureDate || data.scheduledDate
    || data.originalRideRequest?.date || data.originalRidePosting?.date;
  const timeValue = data.time || data.departureTime || data.scheduledTime
    || data.originalRideRequest?.time || data.originalRidePosting?.time;

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
};

function rideFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): MobileRidePosting {
  const data = snapshot.data();
  const firstName = textValue(data.driverFirstName, data.driver?.firstName);
  const lastName = textValue(data.driverLastName, data.driver?.lastName);
  const driverName = textValue(data.driverName, data.driver?.fullName, data.driver?.displayName, data.driver?.name, `${firstName} ${lastName}`) || 'RideAlong driver';
  const make = textValue(data.vehicleMake, data.vehicle?.make);
  const model = textValue(data.vehicleModel, data.vehicle?.model);

  return {
    id: snapshot.id,
    from: textValue(data.pickup, data.pickupAddress, data.pickupLocation, data.pickupGeo, data.from, data.origin) || 'Pickup pending',
    to: textValue(data.dropoff, data.dropoffAddress, data.dropoffLocation, data.dropoffGeo, data.destination, data.to) || 'Destination pending',
    date: rideDateFromData(data),
    price: numberValue(
      data.contributionAmount,
      data.paymentAmount,
      data.offerAmount,
      data.pricePerSeat,
      data.price,
      data.fare,
      data.estimatedFare,
      data.originalRideRequest?.contributionAmount,
      data.originalRideRequest?.estimatedFare,
      data.originalRidePosting?.pricePerSeat,
    ),
    seats: Number(data.availableSeats ?? data.seatsAvailable ?? data.seats ?? 1),
    status: String(data.status || 'available').toLowerCase(),
    driverId: textValue(data.driverId, data.driverUid, data.driverUID, data.userId, data.ownerId, data.createdBy, data.driver?.id, data.driver?.uid) || undefined,
    driverName,
    driverAvatarUrl: textValue(data.driverAvatarUrl, data.avatarUrl, data.photoURL, data.photoUrl, data.profilePicture, data.driver?.avatarUrl, data.driver?.photoURL, data.driver?.photoUrl, data.driver?.profilePicture, data.avatarUrl1, data.driver?.avatarUrl1) || undefined,
    driverRating: Number(data.driverRating ?? data.rating) || undefined,
    vehicle: textValue(data.vehicleText, `${make} ${model}`) || 'Vehicle details pending',
    isRecurring: data.isRecurring === true,
    scheduleId: textValue(data.scheduleId) || undefined,
    scheduleDate: textValue(data.scheduleDate) || undefined,
    availableSeats: typeof data.availableSeats === 'number' ? data.availableSeats : undefined,
    isFull: (typeof data.availableSeats === 'number' && data.availableSeats <= 0)
         || String(data.status || '').toLowerCase() === 'confirmed',
    raw: data,
  };
}

const idValue = (...values: unknown[]) => textValue(...values);

async function notificationTargetsRider(data: DocumentData, uid: string): Promise<boolean> {
  if (!notificationBelongsToRole(data, uid, 'rider')) return false;

  const driverId = idValue(data.driverId, data.driverUID, data.driverUid, data.driver?.id, data.driver?.uid);
  const riderId = idValue(data.riderId, data.riderUID, data.riderUid, data.rider?.id, data.rider?.uid);
  if (driverId === uid && riderId !== uid) return false;
  if (riderId === uid) return true;

  const confirmedRideId = idValue(data.confirmedRideId, data.rideId);
  if (confirmedRideId) {
    const rideSnap = await getDoc(doc(firestore, 'confirmedRides', confirmedRideId)).catch(() => null);
    if (rideSnap?.exists()) {
      const ride = rideSnap.data();
      const rideDriverId = idValue(ride.driverId, ride.driverUID, ride.driverUid);
      const rideRiderId = idValue(ride.riderId, ride.riderUID, ride.riderUid, ride.userId);
      if (rideDriverId === uid && rideRiderId !== uid) return false;
      if (rideRiderId === uid) return true;
    }
  }

  const rideRequestId = idValue(data.rideRequestId, data.requestId);
  if (rideRequestId) {
    const requestSnap = await getDoc(doc(firestore, 'rideRequests', rideRequestId)).catch(() => null);
    if (requestSnap?.exists()) {
      const request = requestSnap.data();
      const requestDriverId = idValue(request.driverId, request.driverUID, request.driverUid, request.assignedDriverId, request.providerId);
      const requestRiderId = idValue(request.riderId, request.riderUID, request.riderUid, request.userId, request.requesterId, request.ownerId);
      if (requestDriverId === uid && requestRiderId !== uid) return false;
      if (requestRiderId === uid) return true;
    }
  }

  const ridePostingRequestId = idValue(data.ridePostingRequestId, data.postingRequestId);
  if (ridePostingRequestId) {
    const requestSnap = await getDoc(doc(firestore, 'ridePostingRequests', ridePostingRequestId)).catch(() => null);
    if (requestSnap?.exists()) {
      const request = requestSnap.data();
      const requestDriverId = idValue(request.driverId, request.driverUID, request.driverUid, request.ownerId);
      const requestRiderId = idValue(request.riderId, request.riderUID, request.riderUid, request.userId, request.requesterId);
      if (requestDriverId === uid && requestRiderId !== uid) return false;
      if (requestRiderId === uid) return true;
    }
  }

  const ridePostingId = idValue(data.ridePostingId, data.postingId);
  if (ridePostingId) {
    const postingSnap = await getDoc(doc(firestore, 'ridePostings', ridePostingId)).catch(() => null);
    if (postingSnap?.exists()) {
      const posting = postingSnap.data();
      const postingDriverId = idValue(posting.driverId, posting.driverUID, posting.driverUid, posting.userId, posting.ownerId);
      if (postingDriverId === uid) return false;
    }
  }

  return notificationIsAddressedToUid(data, uid)
    && !notificationHasExplicitRoleScope(data)
    && !notificationLooksDriverOnly(data);
}

async function enrichRideWithDriver(ride: MobileRidePosting): Promise<MobileRidePosting> {
  if (!ride.driverId) return ride;
  try {
    const snapshot = await getDoc(doc(firestore, 'drivers', ride.driverId));
    if (!snapshot.exists()) return ride;
    const driver = snapshot.data() as any;
    const personal = driver.personalInfo || driver.profile || {};
    const firstName = textValue(driver.firstName, personal.firstName);
    const lastName = textValue(driver.lastName, personal.lastName);
    const driverName = textValue(driver.fullName, driver.displayName, driver.name, `${firstName} ${lastName}`) || ride.driverName;
    const vehicleInfo = driver.vehicleInfo || driver.vehicle || {};
    const vehicle = [
      vehicleInfo.year ?? driver.vehicleYear,
      vehicleInfo.color ?? driver.vehicleColor,
      vehicleInfo.make ?? driver.vehicleMake,
      vehicleInfo.model ?? driver.vehicleModel,
    ].filter(Boolean).join(' ').trim();

    return {
      ...ride,
      driverName,
      driverAvatarUrl: textValue(driver.avatarUrl, driver.photoURL, driver.photoUrl, driver.profilePicture, personal.avatarUrl, personal.photoURL, personal.photoUrl, personal.profilePicture, driver.avatarUrl1) || ride.driverAvatarUrl,
      driverRating: Number(driver.rating ?? driver.averageRating ?? ride.driverRating) || undefined,
      vehicle: vehicle || textValue(driver.vehicleText, driver.vehicleDescription) || ride.vehicle,
    };
  } catch {
    return ride;
  }
}

export function subscribeAvailableRides(
  onData: (rides: MobileRidePosting[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  let active = true;
  const unsubscribe = onSnapshot(
    collection(firestore, 'ridePostings'),
    async (snapshot) => {
      const currentUid = firebaseAuth.currentUser?.uid;
      const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
      const allRides = snapshot.docs
        .map(rideFromDoc)
        .filter((ride) => {
          // Never show the rider their own driver postings
          if (currentUid && ride.driverId === currentUid) return false;
          // Hide paused recurring rides
          if ((ride.raw as any)?.schedulePaused) return false;
          // Completed/cancelled/expired postings should only live in history.
          if (isInactiveRide(ride)) return false;
          // Never show rides whose scheduled time is more than 2 hours in the past
          if (ride.date && ride.date.getTime() < cutoff) return false;
          const status = ride.status;
          // Full/confirmed rides: keep visible so riders can join the waitlist
          if (status === 'confirmed') return true;
          // Open rides: must still have seats available
          return ['available', 'open', 'posted', 'active'].includes(status) && ride.seats > 0;
        });

      // For recurring instances, only show the nearest future one per schedule
      const now = Date.now();
      const recurringBySchedule: Record<string, MobileRidePosting[]> = {};
      const nonRecurring: MobileRidePosting[] = [];
      for (const ride of allRides) {
        if (ride.isRecurring && ride.scheduleId) {
          if (!recurringBySchedule[ride.scheduleId]) recurringBySchedule[ride.scheduleId] = [];
          recurringBySchedule[ride.scheduleId].push(ride);
        } else {
          nonRecurring.push(ride);
        }
      }
      const nextRecurring = Object.values(recurringBySchedule).map((instances) => {
        const future = instances.filter((r) => (r.date?.getTime() ?? 0) > now - 2 * 60 * 60 * 1000);
        future.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
        return future[0];
      }).filter(Boolean) as MobileRidePosting[];

      const rides = [...nonRecurring, ...nextRecurring]
        .sort((a, b) => (a.date?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.date?.getTime() ?? Number.MAX_SAFE_INTEGER));
      const enriched = await Promise.all(rides.map(enrichRideWithDriver));
      if (active) onData(enriched);
    },
    (error) => onError?.(error),
  );
  return () => {
    active = false;
    unsubscribe();
  };
}

export async function getRidePosting(rideId: string): Promise<MobileRidePosting | null> {
  const snapshot = await getDoc(doc(firestore, 'ridePostings', rideId));
  if (!snapshot.exists()) return null;
  return enrichRideWithDriver(rideFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>));
}

export function subscribeRiderProfile(uid: string, onData: (profile: RiderProfile | null) => void): Unsubscribe {
  let riderData: DocumentData | null = null;
  let sharedData: DocumentData | null = null;
  const emit = () => {
    const data = riderData || sharedData;
    if (!data) return onData(null);
    const firstName = textValue(data.firstName, data.firstname, sharedData?.firstName, sharedData?.firstname);
    const lastName = textValue(data.lastName, data.lastname, sharedData?.lastName, sharedData?.lastname);
    onData({
      id: uid,
      firstName,
      lastName,
      displayName: textValue(data.fullName, data.displayName, data.name, sharedData?.fullName, sharedData?.displayName, sharedData?.name, `${firstName} ${lastName}`) || firebaseAuth.currentUser?.displayName || 'Rider',
      email: textValue(data.email, sharedData?.email, firebaseAuth.currentUser?.email),
      // Do NOT fall back to firebaseAuth.currentUser?.photoURL — it could hold the driver's photo
      avatarUrl: textValue(data.avatarUrl, data.photoURL, data.profilePicture, sharedData?.avatarUrl, sharedData?.photoURL, sharedData?.profilePicture) || undefined,
      university: textValue(data.university, data.school, data.college, sharedData?.university, sharedData?.school, sharedData?.college) || undefined,
      rating: Number(data.rating ?? sharedData?.rating) || undefined,
      about: textValue(data.about, data.bio, data.description, sharedData?.about, sharedData?.bio, sharedData?.description) || undefined,
    });
  };
  const riderUnsubscribe = onSnapshot(
    doc(firestore, 'riders', uid),
    (snapshot) => {
      riderData = snapshot.exists() ? snapshot.data() : null;
      emit();
    },
    (error) => {
      riderData = null;
      emit();
      handleSnapshotError('subscribeRiderProfile:riders', error);
    },
  );
  const sharedUnsubscribe = onSnapshot(
    doc(firestore, 'users', uid),
    (snapshot) => {
      sharedData = snapshot.exists() ? snapshot.data() : null;
      emit();
    },
    (error) => {
      sharedData = null;
      emit();
      handleSnapshotError('subscribeRiderProfile:users', error);
    },
  );
  return () => {
    riderUnsubscribe();
    sharedUnsubscribe();
  };
}

export function subscribeRiderConfirmedRides(uid: string, onData: (rides: MobileRidePosting[]) => void): Unsubscribe {
  const confirmedQuery = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid));
  return onSnapshot(
    confirmedQuery,
    (snapshot) => {
      const now = Date.now();
      const rides = snapshot.docs
        .map((snapshot) => rideFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>))
        .filter((ride) => !isInactiveRide(ride))
        .filter((ride) => {
          const s = String(ride.status || '').toUpperCase();
          if (s === 'IN_PROGRESS' || s === 'DRIVER_COMPLETED' || s === 'RIDER_COMPLETED') return true;
          return !ride.date || ride.date.getTime() >= now;
        });
      rides.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
      onData(rides);
    },
    (error) => {
      onData([]);
      handleSnapshotError('subscribeRiderConfirmedRides', error);
    },
  );
}

export function subscribeRiderRequests(uid: string, onData: (requests: MobileRideRequest[]) => void): Unsubscribe {
  const toCard = (item: QueryDocumentSnapshot<DocumentData>): MobileRideRequest => {
    const data = item.data();
    const parsedDate = toDate(data.requestedTime || data.pickupTime || data.scheduledTime || data.createdAt);
    return {
      id: item.id,
      from: textValue(data.pickup, data.pickupLocation, data.pickupAddress, data.from) || 'Pickup pending',
      to: textValue(data.dropoff, data.dropoffLocation, data.dropoffAddress, data.to, data.destination) || 'Destination pending',
      date: parsedDate,
      dateLabel: textValue(data.date, data.departureDate) || (parsedDate ? parsedDate.toLocaleDateString() : 'Date pending'),
      seats: Number(data.seats || data.seatCount || 1),
      price: Number(data.maxPrice ?? data.estimatedFare ?? data.price ?? 0),
      status: String(data.status || data.state || 'pending').toLowerCase(),
      raw: data,
    };
  };

  // Query by both riderId and userId (different field names used across the app)
  const byRiderId = query(collection(firestore, 'rideRequests'), where('riderId', '==', uid));
  const byUserId  = query(collection(firestore, 'rideRequests'), where('userId',  '==', uid));

  const seen = new Map<string, MobileRideRequest>();
  let snapshotA: MobileRideRequest[] = [];
  let snapshotB: MobileRideRequest[] = [];

  const merge = () => {
    seen.clear();
    [...snapshotA, ...snapshotB].forEach((r) => seen.set(r.id, r));
    const merged = Array.from(seen.values());
    merged.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
    onData(merged);
  };

  const unsubA = onSnapshot(
    byRiderId,
    (snap) => { snapshotA = snap.docs.map(toCard); merge(); },
    (error) => {
      snapshotA = [];
      merge();
      handleSnapshotError('subscribeRiderRequests:riderId', error);
    },
  );
  const unsubB = onSnapshot(
    byUserId,
    (snap) => { snapshotB = snap.docs.map(toCard); merge(); },
    (error) => {
      snapshotB = [];
      merge();
      handleSnapshotError('subscribeRiderRequests:userId', error);
    },
  );

  return () => { unsubA(); unsubB(); };
}

export function subscribeRiderConversations(uid: string, onData: (items: MobileConversation[]) => void): Unsubscribe {
  const chatsQuery = query(collection(firestore, 'chats'), where('participants', 'array-contains', uid));
  return onSnapshot(
    chatsQuery,
    async (snapshot) => {
      const riderChats = snapshot.docs.filter((chat) => chatBelongsToRole(chat.data(), uid, 'rider'));
      const items = await Promise.all(riderChats.map(async (chat) => {
        const data = chat.data();
        const availability = await resolveChatAvailability(data).catch((): ChatAvailability => ({ status: null, available: true }));
        const participants = Array.isArray(data.participants) ? data.participants.map(String) : [];
        const otherUserId = textValue(data.driverId, data.driverUID, data.driverUid)
          || participants.find((id) => id !== uid);
        let profile: DocumentData | undefined;
        if (otherUserId) {
          const driver = await getDoc(doc(firestore, 'drivers', otherUserId)).catch(() => null);
          profile = driver?.exists() ? driver.data() : undefined;
        }
        const name = textValue(
          profile?.displayName,
          profile?.fullName,
          profile?.name,
          profile?.personalInfo?.fullName,
          `${textValue(profile?.firstName)} ${textValue(profile?.lastName)}`.trim(),
          data.driverName,
          data.otherUserName,
        ) || 'RideAlong member';
        const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
        const photoURL = profile?.photoURL || profile?.avatarUrl || null;
        const unreadCounts = data.unreadCounts || {};
        const roleField = roleUnreadField('rider', uid);
        const legacyField = legacyUnreadField(uid);
        return {
          id: chat.id,
          otherUserId,
          name,
          initials,
          photoURL,
          preview: availability.available === false
            ? (availability.unavailableMessage || 'Chat no longer available')
            : textValue(data.lastMessage?.text, data.lastMessage, data.lastMessageText) || 'Start the conversation',
          updatedAt: toDate(data.lastMessageTimestamp || data.lastMessageAt || data.updatedAt || data.createdAt),
          unread: Number(data[roleField] ?? data[legacyField] ?? unreadCounts[roleKey('rider', uid)] ?? unreadCounts[uid] ?? data.unreadCount ?? 0),
          rideId: textValue(data.rideId, data.confirmedRideId) || undefined,
          chatAvailable: availability.available,
          unavailableMessage: availability.unavailableMessage,
        } satisfies MobileConversation;
      }));
      items.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
      onData(items);
    },
    (error) => {
      onData([]);
      handleSnapshotError('subscribeRiderConversations', error);
    },
  );
}

export function subscribeChatMessages(chatId: string, onData: (messages: MobileMessage[]) => void): Unsubscribe {
  const messagesQuery = query(collection(firestore, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      onData(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          senderId: textValue(data.senderId, data.userId, data.authorId),
          senderRole: data.senderRole === 'driver' ? 'driver' : data.senderRole === 'rider' ? 'rider' : undefined,
          text: textValue(data.text, data.message, data.body),
          createdAt: toDate(data.timestamp || data.createdAt || data.sentAt),
        };
      }));
    },
    (error) => {
      onData([]);
      handleSnapshotError('subscribeChatMessages', error);
    },
  );
}

export async function sendChatMessage(chatId: string, senderId: string, text: string, senderRole: RideAlongRole = 'rider'): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(collection(firestore, 'chats', chatId, 'messages'), {
    senderId,
    senderRole,
    text: trimmed,
    timestamp: serverTimestamp(),
    read: false,
  });
  const chatRef = doc(firestore, 'chats', chatId);
  const chatSnapshot = await getDoc(chatRef);
  const chatData = chatSnapshot.data();
  const updates: Record<string, unknown> = {
    lastMessage: trimmed,
    lastMessageTimestamp: serverTimestamp(),
    lastMessageSenderId: senderId,
    lastMessageSenderRole: senderRole,
  };
  const recipientRole: RideAlongRole = senderRole === 'rider' ? 'driver' : 'rider';
  const recipientId = recipientRole === 'driver'
    ? textValue(chatData?.driverId, chatData?.driverUID, chatData?.driverUid)
    : textValue(chatData?.riderId, chatData?.riderUID, chatData?.riderUid, chatData?.userId);
  if (recipientId) {
    const field = roleUnreadField(recipientRole, recipientId);
    updates[field] = Number(chatData?.[field] || 0) + 1;
    updates[`unreadCounts.${roleKey(recipientRole, recipientId)}`] = Number(chatData?.unreadCounts?.[roleKey(recipientRole, recipientId)] || 0) + 1;
  } else {
    const participants = Array.isArray(chatData?.participants) ? chatData.participants : [];
    participants.forEach((participantId: string) => {
      if (participantId !== senderId) updates[legacyUnreadField(participantId)] = Number(chatData?.[legacyUnreadField(participantId)] || 0) + 1;
    });
  }
  await updateDoc(chatRef, updates);
}

export async function markChatAsRead(chatId: string, uid: string, role: RideAlongRole = 'rider'): Promise<void> {
  await updateDoc(doc(firestore, 'chats', chatId), {
    [roleUnreadField(role, uid)]: 0,
    [`unreadCounts.${roleKey(role, uid)}`]: 0,
  });
}

export async function markRiderNotificationAsRead(notificationId: string, uid: string): Promise<void> {
  await updateDoc(doc(firestore, 'notifications', notificationId), {
    [`read_rider_${uid}`]: true,
    readAt: serverTimestamp(),
    readByRole: arrayUnion(roleKey('rider', uid)),
  });
}

export function subscribeRiderNotifications(uid: string, onData: (items: MobileNotification[]) => void): Unsubscribe {
  const base = collection(firestore, 'notifications');
  const email = firebaseAuth.currentUser?.email;
  const queries = [
    query(base, where('userId', '==', uid)),
    query(base, where('recipientId', '==', uid)),
    query(base, where('recipients', 'array-contains', uid)),
    query(base, where('recipientKeys', 'array-contains', roleKey('rider', uid))),
    ...(email ? [query(base, where('userEmail', '==', email))] : []),
  ];
  const buckets = new Map<number, MobileNotification[]>();
  const flush = () => {
    const byId = new Map<string, MobileNotification>();
    buckets.forEach((items) => items.forEach((item) => byId.set(item.id, item)));
    const merged = Array.from(byId.values()).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    onData(merged);
  };
  const unsubs = queries.map((notificationsQuery, index) => onSnapshot(
    notificationsQuery,
    async (snapshot) => {
      const mapped = await Promise.all(snapshot.docs.map(async (item) => {
        const data = item.data();
        if (!(await notificationTargetsRider(data, uid))) return null;
        return {
          id: item.id,
          title: textValue(data.title, data.type) || 'RideAlong update',
          body: textValue(data.body, data.message, data.text, data.description),
          createdAt: toDate(data.createdAt || data.timestamp || data.sentAt),
          read: isReadForRole(data, uid, 'rider'),
          type: textValue(data.type, data.category) || 'notification',
        } satisfies MobileNotification;
      }));
      buckets.set(index, mapped.filter((item): item is MobileNotification => Boolean(item)));
      flush();
    },
    (error) => {
      buckets.set(index, []);
      flush();
      handleSnapshotError(`subscribeRiderNotifications:${index}`, error);
    },
  ));
  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}
