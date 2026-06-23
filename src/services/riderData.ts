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

export type RiderProfile = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  university?: string;
  rating?: number;
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
      const candidate = (value as any).address || (value as any).description || (value as any).name;
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
  const statusAtFlag = normalizedStatus(ride.raw?.statusAtFlag);
  return inactiveRideStatuses.has(status) || statusAtFlag === 'completed';
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
  const driverName = textValue(data.driverName, data.driver?.displayName, `${firstName} ${lastName}`) || 'RideAlong driver';
  const make = textValue(data.vehicleMake, data.vehicle?.make);
  const model = textValue(data.vehicleModel, data.vehicle?.model);

  return {
    id: snapshot.id,
    from: textValue(data.pickup, data.pickupLocation, data.pickupAddress, data.from, data.origin) || 'Pickup pending',
    to: textValue(data.dropoff, data.dropoffLocation, data.dropoffAddress, data.to, data.destination) || 'Destination pending',
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
    driverAvatarUrl: textValue(data.driverAvatarUrl, data.avatarUrl, data.photoURL, data.driver?.avatarUrl, data.driver?.photoURL) || undefined,
    driverRating: Number(data.driverRating ?? data.rating) || undefined,
    vehicle: textValue(data.vehicleText, `${make} ${model}`) || 'Vehicle details pending',
    raw: data,
  };
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
      driverAvatarUrl: textValue(driver.avatarUrl, driver.photoURL, driver.profilePicture, personal.avatarUrl, personal.photoURL) || ride.driverAvatarUrl,
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
      const rides = snapshot.docs
        .map(rideFromDoc)
        .filter((ride) => ['available', 'open', 'posted', 'active'].includes(ride.status) && ride.seats > 0)
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
      displayName: textValue(data.displayName, data.name, data.fullName, sharedData?.displayName, sharedData?.name, sharedData?.fullName, `${firstName} ${lastName}`) || firebaseAuth.currentUser?.displayName || 'Rider',
      email: textValue(data.email, sharedData?.email, firebaseAuth.currentUser?.email),
      avatarUrl: textValue(data.avatarUrl, data.photoURL, data.profilePicture, sharedData?.avatarUrl, sharedData?.photoURL, sharedData?.profilePicture, firebaseAuth.currentUser?.photoURL) || undefined,
      university: textValue(data.university, data.school, data.college, sharedData?.university, sharedData?.school, sharedData?.college) || undefined,
      rating: Number(data.rating ?? sharedData?.rating) || undefined,
    });
  };
  const riderUnsubscribe = onSnapshot(doc(firestore, 'riders', uid), (snapshot) => {
    riderData = snapshot.exists() ? snapshot.data() : null;
    emit();
  });
  const sharedUnsubscribe = onSnapshot(doc(firestore, 'users', uid), (snapshot) => {
    sharedData = snapshot.exists() ? snapshot.data() : null;
    emit();
  });
  return () => {
    riderUnsubscribe();
    sharedUnsubscribe();
  };
}

export function subscribeRiderConfirmedRides(uid: string, onData: (rides: MobileRidePosting[]) => void): Unsubscribe {
  const confirmedQuery = query(collection(firestore, 'confirmedRides'), where('riderId', '==', uid));
  return onSnapshot(confirmedQuery, (snapshot) => {
    const now = Date.now();
    const rides = snapshot.docs
      .map((snapshot) => rideFromDoc(snapshot as QueryDocumentSnapshot<DocumentData>))
      .filter((ride) => !isInactiveRide(ride))
      .filter((ride) => {
        const s = String(ride.status || '').toUpperCase();
        if (s === 'IN_PROGRESS' || s === 'FLAGGED') return true;
        return !ride.date || ride.date.getTime() >= now;
      });
    rides.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
    onData(rides);
  });
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

  const unsubA = onSnapshot(byRiderId, (snap) => { snapshotA = snap.docs.map(toCard); merge(); });
  const unsubB = onSnapshot(byUserId,  (snap) => { snapshotB = snap.docs.map(toCard); merge(); });

  return () => { unsubA(); unsubB(); };
}

export function subscribeRiderConversations(uid: string, onData: (items: MobileConversation[]) => void): Unsubscribe {
  const chatsQuery = query(collection(firestore, 'chats'), where('participants', 'array-contains', uid));
  return onSnapshot(chatsQuery, async (snapshot) => {
    const items = await Promise.all(snapshot.docs.map(async (chat) => {
      const data = chat.data();
      const participants = Array.isArray(data.participants) ? data.participants.map(String) : [];
      const otherUserId = participants.find((id) => id !== uid);
      let profile: DocumentData | undefined;
      if (otherUserId) {
        const [driver, rider] = await Promise.all([
          getDoc(doc(firestore, 'drivers', otherUserId)).catch(() => null),
          getDoc(doc(firestore, 'riders', otherUserId)).catch(() => null),
        ]);
        profile = driver?.exists() ? driver.data() : rider?.exists() ? rider.data() : undefined;
      }
      const name = textValue(
        profile?.displayName,
        profile?.name,
        `${textValue(profile?.firstName)} ${textValue(profile?.lastName)}`,
        data.otherUserName,
      ) || 'RideAlong member';
      const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
      const photoURL = profile?.photoURL || profile?.avatarUrl || null;
      const unreadCounts = data.unreadCounts || {};
      return {
        id: chat.id,
        otherUserId,
        name,
        initials,
        photoURL,
        preview: textValue(data.lastMessage?.text, data.lastMessage, data.lastMessageText) || 'Start the conversation',
        updatedAt: toDate(data.lastMessageTimestamp || data.lastMessageAt || data.updatedAt || data.createdAt),
        unread: Number(data[`unreadCount_${uid}`] ?? unreadCounts[uid] ?? data.unreadCount ?? 0),
        rideId: textValue(data.rideId, data.confirmedRideId) || undefined,
      } satisfies MobileConversation;
    }));
    items.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
    onData(items);
  });
}

export function subscribeChatMessages(chatId: string, onData: (messages: MobileMessage[]) => void): Unsubscribe {
  const messagesQuery = query(collection(firestore, 'chats', chatId, 'messages'), orderBy('timestamp', 'asc'));
  return onSnapshot(messagesQuery, (snapshot) => {
    onData(snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        senderId: textValue(data.senderId, data.userId, data.authorId),
        text: textValue(data.text, data.message, data.body),
        createdAt: toDate(data.timestamp || data.createdAt || data.sentAt),
      };
    }));
  });
}

export async function sendChatMessage(chatId: string, senderId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  await addDoc(collection(firestore, 'chats', chatId, 'messages'), {
    senderId,
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
  };
  const participants = Array.isArray(chatData?.participants) ? chatData.participants : [];
  participants.forEach((participantId: string) => {
    if (participantId !== senderId) updates[`unreadCount_${participantId}`] = Number(chatData?.[`unreadCount_${participantId}`] || 0) + 1;
  });
  await updateDoc(chatRef, updates);
}

export async function markChatAsRead(chatId: string, uid: string): Promise<void> {
  await updateDoc(doc(firestore, 'chats', chatId), { [`unreadCount_${uid}`]: 0 });
}

export async function markRiderNotificationAsRead(notificationId: string, uid: string): Promise<void> {
  await updateDoc(doc(firestore, 'notifications', notificationId), {
    read: true,
    unread: false,
    readAt: serverTimestamp(),
    readBy: arrayUnion(uid),
  });
}

export function subscribeRiderNotifications(uid: string, onData: (items: MobileNotification[]) => void): Unsubscribe {
  const base = collection(firestore, 'notifications');
  const queries = [
    query(base, where('userId', '==', uid)),
    query(base, where('recipientId', '==', uid)),
  ];
  const buckets = new Map<number, MobileNotification[]>();
  const flush = () => {
    const byId = new Map<string, MobileNotification>();
    buckets.forEach((items) => items.forEach((item) => byId.set(item.id, item)));
    const merged = Array.from(byId.values()).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    onData(merged);
  };
  const unsubs = queries.map((notificationsQuery, index) => onSnapshot(notificationsQuery, (snapshot) => {
    buckets.set(index, snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        title: textValue(data.title, data.type) || 'RideAlong update',
        body: textValue(data.body, data.message, data.text, data.description),
        createdAt: toDate(data.createdAt || data.timestamp || data.sentAt),
        read: data.read === true || data.isRead === true || data.unread === false || (Array.isArray(data.readBy) && data.readBy.includes(uid)),
        type: textValue(data.type, data.category) || 'notification',
      };
    }));
    flush();
  }));
  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}
