import { firestore, firebaseAuth } from '@/constants/services';
import { doc, setDoc, updateDoc, getDoc, serverTimestamp, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { roleKey } from '@/src/utils/roleIdentity';

export type FlagPayload = {
  reason: string;
  details?: string | null;
  flaggedByRole: 'driver' | 'rider' | string;
  flaggedById?: string | null;
  createdAt?: any;
  updatedAt?: any;
  reviewStatus?: 'open' | 'closed';
};

export async function submitDriverFlag(rideId: string, payload: FlagPayload) {
  if (!rideId) throw new Error('rideId_required');
  const confirmedRef = doc(firestore, 'confirmedRides', rideId);

  // Fetch ride data to get riderId and driverId for security rules
  const rideDoc = await getDoc(confirmedRef);
  if (!rideDoc.exists()) {
    throw new Error('Ride not found');
  }
  const rideData = rideDoc.data();

  // Check if this is a group ride (has ridePostingId)
  const postingId = rideData?.ridePostingId;
  let allRideIds = [rideId];
  let allRiderIds = [rideData?.riderId ?? rideData?.userId ?? null];
  let allRiderNames = [rideData?.riderName ?? 'Passenger'];
  
  // If this is a group ride, flag ALL confirmed rides for this posting
  if (postingId) {
    try {
      const groupQuery = query(
        collection(firestore, 'confirmedRides'),
        where('ridePostingId', '==', postingId),
        where('driverId', '==', rideData?.driverId)
      );
      const groupSnap = await getDocs(groupQuery);
      allRideIds = [];
      allRiderIds = [];
      allRiderNames = [];
      groupSnap.forEach((d) => {
        allRideIds.push(d.id);
        const data = d.data();
        allRiderIds.push(data?.riderId ?? data?.userId ?? null);
        allRiderNames.push(data?.riderName ?? 'Passenger');
      });
    } catch (e) {
      console.warn('Could not fetch group rides for flagging', e);
    }
  }

  // Create flags for all rides in the group
  for (let i = 0; i < allRideIds.length; i++) {
    const rid = allRideIds[i];
    const flagDocId = `${rid}_${payload.flaggedByRole}`;
    const flagRef = doc(firestore, 'rideFlags', flagDocId);
    
    // Check for existing flag
    try {
      const existing = await getDoc(flagRef);
      if (existing.exists()) {
        const data = existing.data() as any;
        if (data?.reviewStatus === 'open') {
          await updateDoc(flagRef, { ...payload, updatedAt: serverTimestamp() });
          continue;
        }
      }
    } catch (e) {
      // ignore and try to set
    }

    // Get this specific ride's data
    const thisRideDoc = await getDoc(doc(firestore, 'confirmedRides', rid));
    const thisRideData = thisRideDoc.exists() ? thisRideDoc.data() : rideData;

    // Include riderId and driverId from the ride for Firestore security rules
    const fullPayload = {
      ...payload,
      rideId: rid,
      ridePostingId: postingId ?? null,
      isGroupRide: !!postingId,
      totalPassengers: allRideIds.length,
      riderId: thisRideData?.riderId ?? thisRideData?.userId ?? null,
      riderName: thisRideData?.riderName ?? 'Passenger',
      driverId: thisRideData?.driverId ?? null,
      driverName: thisRideData?.driverName ?? 'Driver',
      statusAtFlag: thisRideData?.status ?? null,
      pickup: thisRideData?.pickup ?? null,
      dropoff: thisRideData?.dropoff ?? null,
      date: thisRideData?.date ?? null,
      time: thisRideData?.time ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reviewStatus: 'open'
    };

    await setDoc(flagRef, fullPayload);

    // Update confirmed ride status to FLAGGED
    await updateDoc(doc(firestore, 'confirmedRides', rid), { 
      status: 'FLAGGED', 
      statusAtFlag: thisRideData?.status ?? 'IN_PROGRESS',
      updatedAt: serverTimestamp() 
    }).catch(() => {});
  }

  // Send notification to driver
  try {
    const driverId = rideData?.driverId;
    if (driverId) {
      await addDoc(collection(firestore, 'notifications'), {
        userId: driverId,
        recipientId: driverId,
        recipientRole: 'driver',
        recipientKeys: [roleKey('driver', driverId)],
        driverId,
        type: 'ride_flagged',
        title: postingId ? 'Group Ride Flagged' : 'Ride Flagged',
        message: postingId 
          ? `Your group ride with ${allRiderNames.join(', ')} has been flagged and requires admin review.`
          : `Your ride with ${allRiderNames[0]} has been flagged and requires admin review.`,
        rideId: allRideIds[0],
        ridePostingId: postingId ?? null,
        severity: 'high',
        read: false,
        createdAt: serverTimestamp(),
      });
    }
  } catch (e) {
    console.warn('Failed to send driver notification', e);
  }

  // Send notification to admin
  try {
    await addDoc(collection(firestore, 'adminNotifications'), {
      type: 'ride_flag',
      title: postingId ? 'Group Ride Flagged' : 'Ride Flagged',
      message: `A ${postingId ? 'group ride' : 'ride'} has been flagged by ${payload.flaggedByRole}. Reason: ${payload.reason}`,
      rideIds: allRideIds,
      ridePostingId: postingId ?? null,
      flaggedByRole: payload.flaggedByRole,
      flaggedById: payload.flaggedById ?? firebaseAuth.currentUser?.uid ?? null,
      reason: payload.reason,
      details: payload.details,
      driverId: rideData?.driverId ?? null,
      driverName: rideData?.driverName ?? 'Driver',
      riderIds: allRiderIds.filter(Boolean),
      riderNames: allRiderNames,
      severity: 'high',
      status: 'pending',
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Failed to send admin notification', e);
  }

  // If other passenger exists in group ride, optionally notify them
  if (postingId && allRiderIds.length > 1) {
    for (let i = 0; i < allRiderIds.length; i++) {
      const riderId = allRiderIds[i];
      if (!riderId) continue;
      try {
        await addDoc(collection(firestore, 'notifications'), {
          userId: riderId,
          recipientId: riderId,
          recipientRole: 'rider',
          recipientKeys: [roleKey('rider', riderId)],
          riderId,
          type: 'ride_flagged',
          title: 'Group Ride Flagged',
          message: 'Your group ride has been flagged and requires admin review. No further actions can be taken until resolved.',
          rideId: allRideIds[i],
          ridePostingId: postingId,
          severity: 'high',
          read: false,
          createdAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn(`Failed to send notification to rider ${riderId}`, e);
      }
    }
  }

  return { 
    created: true, 
    flaggedRides: allRideIds.length,
    isGroupRide: !!postingId 
  };
}
