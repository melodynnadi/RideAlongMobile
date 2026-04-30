import { Alert } from 'react-native';
import { firestore, getApiBaseUrl, firebaseAuth } from '@/constants/services';
import { collection, doc, getDoc, getDocs, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { updateRideStatus } from '@/src/services/functions';
import { resolveConfirmedDocId } from '@/src/services/ridesData';
import { submitDriverFlag, FlagPayload } from '@/src/services/flagService';
import { logActivity } from '@/src/services/activity';
import EmailTriggerService from '../../services/EmailTriggerService';

function showRideError(e: any) {
  try { console.warn('updateRideStatus error', e); } catch {}
  const code = String(e?.code || '').replace(/^functions\//, '');
  const msgText = String(e?.message || '').toLowerCase();
  const msg =
    {
      'not-found': 'Ride not found',
  'failed-precondition': 'Action not allowed for current status. Please wait a moment and try again.',
      'permission-denied': 'You don’t have access to this ride',
      'out-of-range': 'Pickup can only be confirmed on ride day',
    }[code]
    || (msgText.includes('only pick up on ride day') || msgText.includes('only pickup on ride day')
        ? 'Pickup can only be confirmed on ride day'
        : 'Something went wrong. Please try again.');
  Alert.alert('Error', `${msg}${code ? ` (code: ${code})` : ''}`);
}

export type RideCardRef = {
  confirmedId?: string;
  rideRequestId?: string;
  ridePostingId?: string;
  riderId?: string;
};

export async function confirmPickup(card: RideCardRef): Promise<boolean> {
  try {
  try { console.log('[pickup] incoming card', card); } catch {}
    const rideId = await resolveConfirmedDocId(card);
  try { console.log('[pickup] resolved rideId', rideId); } catch {}
    if (!rideId) {
      Alert.alert('Error', 'Ride not found');
      return false;
    }
    // Preflight: ensure status casing and allow only when currently CONFIRMED
    try {
      const snap = await getDoc(doc(firestore, 'confirmedRides', rideId));
      const data = snap.exists() ? (snap.data() as any) : undefined;
      const raw = String(data?.status || '').trim();
  const normalized = raw.replace(/[-\s]/g, '_').toUpperCase();
  try { console.log('[pickup] current status', raw, '->', normalized); } catch {}
      if (normalized === 'PENDING') {
        Alert.alert('Waiting for passengers', 'Pickup will be available once all seats are filled.');
        return false;
      }
      if (normalized === 'IN_PROGRESS') {
        Alert.alert('Info', 'Ride is already in progress');
        return false;
      }
      // Normalize common pre-confirm synonyms to CONFIRMED to satisfy backend
      const preConfirm = new Set(['CONFIRMED', 'ACCEPTED', 'MATCHED', 'DRIVER_ARRIVING']);
      if (normalized && preConfirm.has(normalized) && normalized !== 'CONFIRMED') {
        await updateDoc(doc(firestore, 'confirmedRides', rideId), { status: 'CONFIRMED' }).catch(() => {});
      }
    } catch {}
    try {
      // Mark driver pickup locally (mirrors web flow) to satisfy any preconditions
      await updateDoc(doc(firestore, 'confirmedRides', rideId), {
        driverPickupConfirmed: true,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      const ok = await callUpdateRideStatus(rideId, 'driver_pickup');
      if (!ok) throw new Error('pickup_failed');
      await logActivity({
        type: 'ride_picked_up',
        entityType: 'ride',
        entityId: rideId,
        metadata: { card },
      });
      
      // Trip in progress email DISABLED - users get real-time status updates
      // This was causing duplicate notifications
      
      return true;
    } catch (e: any) {
      // One-shot retry if status precondition blocked us; attempt to set CONFIRMED then retry
      const code = String(e?.code || '').replace(/^functions\//, '');
      if (code === 'failed-precondition') {
        try {
          await updateDoc(doc(firestore, 'confirmedRides', rideId), { status: 'CONFIRMED' });
          const ok2 = await callUpdateRideStatus(rideId, 'driver_pickup');
          if (!ok2) throw new Error('pickup_failed_retry');
          return true;
        } catch (e2) {
          throw e2;
        }
      }
      throw e;
    }
  } catch (e) {
    showRideError(e);
    return false;
  }
}

// (date helpers removed; ride-day restriction lifted per new backend policy)

export async function completeRide(card: RideCardRef): Promise<boolean> {
  try {
  try { console.log('[complete] incoming card', card); } catch {}
    const rideId = await resolveConfirmedDocId(card);
  try { console.log('[complete] resolved rideId', rideId); } catch {}
    if (!rideId) {
      Alert.alert('Error', 'Ride not found');
      return false;
    }
    // Mark driver complete locally before calling backend
    // Don't set completedAt yet - backend will set it when both parties confirm
    await updateDoc(doc(firestore, 'confirmedRides', rideId), {
      driverCompleteConfirmed: true,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    const ok = await callUpdateRideStatus(rideId, 'driver_complete');
    if (!ok) throw new Error('complete_failed');
    await logActivity({
      type: 'ride_completed',
      entityType: 'ride',
      entityId: rideId,
      metadata: { card },
    });
    
    // Notification will be sent by backend listener when status becomes 'COMPLETED'
    // (after both driver AND rider confirm completion)
    
    return true;
  } catch (e) {
    showRideError(e);
    return false;
  }
}

export async function cancelRide(card: RideCardRef): Promise<boolean> {
  const fallbackId = card.confirmedId || card.rideRequestId || card.ridePostingId || card.riderId || null;
  try {
    const rideId = await resolveConfirmedDocId(card).catch(() => fallbackId || null);
    await logActivity({
      type: 'ride_canceled',
      entityType: 'ride',
      entityId: rideId ?? fallbackId ?? null,
      metadata: { card, outcome: 'unsupported' },
    });
  } catch {}
  Alert.alert('Unsupported', 'Cancelling a confirmed ride is not supported.');
  return false;
}

export async function flagRide(card: RideCardRef, payload: FlagPayload): Promise<boolean> {
  try {
    const rideId = await resolveConfirmedDocId(card);
    if (!rideId) {
      Alert.alert('Error', 'Ride not found');
      return false;
    }
    const result = await submitDriverFlag(rideId, payload);
    await logActivity({
      type: 'ride_flagged',
      entityType: 'ride',
      entityId: rideId,
      metadata: { 
        reason: payload.reason, 
        payload,
        flaggedRides: result.flaggedRides,
        isGroupRide: result.isGroupRide 
      },
    });
    
    // Show appropriate success message
    if (result.isGroupRide) {
      Alert.alert(
        'Group Ride Flagged',
        `All ${result.flaggedRides} passengers in this group ride have been flagged. Admin will review this case. No further actions can be taken until resolved.`,
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert(
        'Ride Flagged',
        'This ride has been flagged for admin review. No further actions can be taken until resolved.',
        [{ text: 'OK' }]
      );
    }
    
    return true;
  } catch (e: any) {
    try { console.warn('flagRide error', e); } catch {}
    Alert.alert('Error', 'Could not submit flag. Please try again.');
    return false;
  }
}

// Flag all rides in a group posting (driver-initiated)
export async function groupFlag(ridePostingId: string, payload: FlagPayload): Promise<boolean> {
  try {
    if (!ridePostingId) throw new Error('missing_posting_id');
    
    // Find any confirmed ride from this posting to use as the base
    const qy = query(
      collection(firestore, 'confirmedRides'),
      where('ridePostingId', '==', ridePostingId)
    );
    const snap = await getDocs(qy);
    
    if (snap.empty) {
      Alert.alert('Error', 'No confirmed rides found for this posting');
      return false;
    }
    
    // Use the first ride's ID to trigger the group flag
    const firstRideId = snap.docs[0].id;
    const result = await submitDriverFlag(firstRideId, payload);
    
    await logActivity({
      type: 'group_ride_flagged',
      entityType: 'posting',
      entityId: ridePostingId,
      metadata: { 
        reason: payload.reason, 
        payload,
        flaggedRides: result.flaggedRides 
      },
    });
    
    Alert.alert(
      'Group Ride Flagged',
      `All ${result.flaggedRides} passengers in this group ride have been flagged. Admin will review this case.`,
      [{ text: 'OK' }]
    );
    
    return true;
  } catch (e: any) {
    try { console.warn('groupFlag error', e); } catch {}
    Alert.alert('Error', 'Could not submit flag. Please try again.');
    return false;
  }
}

// --- Group ride actions (posting-level) ---
// Pick up all child confirmed rides for a posting (Dual Passenger Group Ride)
export async function groupPickup(ridePostingId: string): Promise<{ ok: boolean; updated: number; riderIds: string[] }> {
  try {
    if (!ridePostingId) throw new Error('missing_posting_id');
    const qy = query(
      collection(firestore, 'confirmedRides'),
      where('ridePostingId', '==', ridePostingId),
      where('status', 'in', ['CONFIRMED', 'IN_PROGRESS'])
    );
    const snap = await getDocs(qy);
    const targets: string[] = [];
    const riderIds: string[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      const st = String(data?.status || '').toUpperCase();
      if (st === 'CONFIRMED') {
        targets.push(d.id);
        if (data?.riderId) riderIds.push(String(data.riderId));
      }
    });
    let updated = 0;
    for (const id of targets) {
      try {
        // Local mark then backend callable (mirrors single-ride flow)
        await updateDoc(doc(firestore, 'confirmedRides', id), {
          driverPickupConfirmed: true,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        const ok = await callUpdateRideStatus(id, 'driver_pickup');
        if (!ok) throw new Error('pickup_failed');
        updated++;
      } catch (e) {
        // continue other children
      }
    }
    try { console.log('analytics', 'group_ride_pickup', { ridePostingId, riderIds }); } catch {}
    return { ok: true, updated, riderIds };
  } catch (e) {
    showRideError(e);
    return { ok: false, updated: 0, riderIds: [] };
  }
}

// Request completion for all IN_PROGRESS child rides of a posting
export async function groupComplete(ridePostingId: string): Promise<{ ok: boolean; updated: number; riderIds: string[] }> {
  try {
    if (!ridePostingId) throw new Error('missing_posting_id');
    const qy = query(
      collection(firestore, 'confirmedRides'),
      where('ridePostingId', '==', ridePostingId),
      where('status', 'in', ['IN_PROGRESS', 'DRIVER_COMPLETED'])
    );
    const snap = await getDocs(qy);
    const targets: string[] = [];
    const riderIds: string[] = [];
    snap.forEach((d) => {
      const data = d.data() as any;
      const st = String(data?.status || '').toUpperCase();
      if (st === 'IN_PROGRESS') {
        targets.push(d.id);
        if (data?.riderId) riderIds.push(String(data.riderId));
      }
    });
    let updated = 0;
    for (const id of targets) {
      try {
        // Only mark driver confirmed - don't set completedAt until rider also confirms
        await updateDoc(doc(firestore, 'confirmedRides', id), {
          driverCompleteConfirmed: true,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        const ok = await callUpdateRideStatus(id, 'driver_complete');
        if (!ok) throw new Error('complete_failed');
        updated++;
      } catch (e) {
        // continue
      }
    }
    try { console.log('analytics', 'group_ride_complete_request', { ridePostingId, riderIds }); } catch {}
    return { ok: true, updated, riderIds };
  } catch (e) {
    showRideError(e);
    return { ok: false, updated: 0, riderIds: [] };
  }
}

// --- Backend update helper: Firebase Callable first, REST fallback to Express ---
async function callUpdateRideStatus(rideId: string, action: 'driver_pickup' | 'driver_complete' | 'rider_pickup' | 'rider_complete'): Promise<boolean> {
  try {
    const res: any = await updateRideStatus({ rideId, action });
    try { console.log('[updateRideStatus] callable response', res?.data ?? res); } catch {}
    if (res && (res as any).data && (res as any).data.ok === false) {
      // fall through to REST
      throw new Error('callable_failed');
    }
    return true;
  } catch (e) {
    try {
      const base = getApiBaseUrl();
      const token = await firebaseAuth.currentUser?.getIdToken();
      const resp = await fetch(`${base}/rides/${encodeURIComponent(rideId)}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action, userId: firebaseAuth.currentUser?.uid }),
      });
      if (!resp.ok) return false;
      const j = await resp.json().catch(() => ({ ok: true }));
      return !!(j && j.ok !== false);
    } catch {
      return false;
    }
  }
}
