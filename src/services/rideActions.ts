import { Alert } from 'react-native';
import { firestore, getApiBaseUrl, firebaseAuth } from '@/constants/services';
import { collection, doc, getDoc, getDocs, query, updateDoc, where, serverTimestamp } from 'firebase/firestore';
import { updateRideStatus } from '@/src/services/functions';
import { resolveConfirmedDocId } from '@/src/services/ridesData';
import { logActivity } from '@/src/services/activity';
import EmailTriggerService from '../../services/EmailTriggerService';
import { captureRidePayment } from '@/services/payments';

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

export async function confirmPickup(card: RideCardRef & { verificationCode?: string }): Promise<boolean> {
  try {
    const rideId = await resolveConfirmedDocId(card);
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
      const result = await callUpdateRideStatus(rideId, 'driver_pickup', card.verificationCode ? { verificationCode: card.verificationCode } : undefined);
      if (!result.ok) {
        if (result.code === 'code_invalid' || result.code === 'code_required') {
          Alert.alert('Incorrect code', result.error || 'The code you entered does not match. Ask your rider for the code shown in their app.');
          return false;
        }
        throw new Error('pickup_failed');
      }
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
          const r2 = await callUpdateRideStatus(rideId, 'driver_pickup');
          if (!r2.ok) throw new Error('pickup_failed_retry');
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
    const rideId = await resolveConfirmedDocId(card);
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
    const { ok } = await callUpdateRideStatus(rideId, 'driver_complete');
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

export async function riderCompleteRide(confirmedRideId: string): Promise<boolean> {
  try {
    await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), {
      riderCompleteConfirmed: true,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    const { ok } = await callUpdateRideStatus(confirmedRideId, 'rider_complete');
    if (!ok) throw new Error('rider_complete_failed');
    await logActivity({
      type: 'ride_completed',
      entityType: 'ride',
      entityId: confirmedRideId,
      metadata: { role: 'rider' },
    });

    // Capture the authorized payment — rider confirming is the final step.
    // Guard: only capture if the ride actually progressed through pickup (driverPickupConfirmed)
    // to prevent capturing payment for rides that were never actually driven.
    try {
      const rideSnap = await getDoc(doc(firestore, 'confirmedRides', confirmedRideId));
      if (rideSnap.exists()) {
        const rideData = rideSnap.data() as any;
        const paymentIntentId: string | null =
          rideData.paymentIntentId || rideData.stripePaymentIntentId || null;
        const driverId: string | null = rideData.driverId || null;
        const wasPickedUp = rideData.driverPickupConfirmed === true || rideData.riderPickupConfirmed === true;
        const alreadyCaptured = rideData.paymentStatus === 'CAPTURED';
        if (paymentIntentId && driverId && wasPickedUp && !alreadyCaptured) {
          await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), {
            paymentStatus: 'PENDING',
          }).catch(() => {});
          await captureRidePayment(paymentIntentId, confirmedRideId, driverId);
          await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), {
            paymentStatus: 'CAPTURED',
          }).catch(() => {});
        } else if (paymentIntentId && !wasPickedUp) {
          console.warn('[riderComplete] skipping capture — driver never confirmed pickup');
        }
      }
    } catch (captureErr) {
      await updateDoc(doc(firestore, 'confirmedRides', confirmedRideId), {
        paymentStatus: 'FAILED',
      }).catch(() => {});
      console.warn('[riderComplete] payment capture failed', captureErr);
    }

    return true;
  } catch (e) {
    showRideError(e);
    return false;
  }
}

export async function cancelRide(card: RideCardRef): Promise<boolean> {
  const fallbackId = card.confirmedId || card.rideRequestId || card.ridePostingId || card.riderId || null;
  try {
    const rideId = await resolveConfirmedDocId(card).catch(() => fallbackId);
    if (!rideId) {
      Alert.alert('Error', 'Ride not found. Please refresh and try again.');
      return false;
    }

    const rideSnap = await getDoc(doc(firestore, 'confirmedRides', rideId));
    if (!rideSnap.exists()) {
      Alert.alert('Error', 'Ride not found. It may have already been cancelled.');
      return false;
    }
    const rideData = rideSnap.data() as any;
    const currentStatus = String(rideData.status || '').replace(/[-\s]/g, '_').toUpperCase();

    if (['IN_PROGRESS', 'DRIVER_COMPLETED', 'RIDER_COMPLETED', 'COMPLETED'].includes(currentStatus)) {
      Alert.alert('Cannot cancel', 'This ride cannot be cancelled once it has started.');
      return false;
    }

    // Cancel via the backend so the payment hold is voided, the cancellation is
    // propagated to the originating request docs, and — for group rides — the
    // seat is released back to the parent posting (reopening it if it was full).
    const base = getApiBaseUrl();
    const resp = await fetch(`${base}/api/rides/${encodeURIComponent(rideId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: 'confirmedRides', cancelledBy: 'driver' }),
    });
    if (!resp.ok) {
      throw new Error(`Server error ${resp.status}`);
    }

    await logActivity({
      type: 'ride_canceled',
      entityType: 'ride',
      entityId: rideId,
      metadata: { card },
    });

    return true;
  } catch (e: any) {
    try { console.warn('[cancelRide] error', e); } catch {}
    Alert.alert('Error', 'Could not cancel the ride. Please try again.');
    return false;
  }
}

// --- Group ride actions (posting-level) ---
// Pick up all child confirmed rides for a posting (Dual Passenger Group Ride)
export async function groupPickup(ridePostingId: string): Promise<{ ok: boolean; updated: number; total: number; failedCount: number; riderIds: string[]; confirmedRideIds: string[] }> {
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
    const confirmedRideIds: string[] = [];
    for (const id of targets) {
      try {
        // Local mark then backend callable (mirrors single-ride flow)
        await updateDoc(doc(firestore, 'confirmedRides', id), {
          driverPickupConfirmed: true,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        const { ok: pickupOk } = await callUpdateRideStatus(id, 'driver_pickup');
        if (!pickupOk) throw new Error('pickup_failed');
        updated++;
        confirmedRideIds.push(id);
      } catch (e) {
        // Don't silently drop this rider — surface it so the driver knows to retry.
        console.warn('[groupPickup] failed for confirmedRide', id, e);
      }
    }
    const failedCount = targets.length - updated;
    if (failedCount > 0) {
      Alert.alert(
        'Pickup incomplete',
        `Picked up ${updated} of ${targets.length} passenger(s). Tap Pick Up again to retry the rest.`,
      );
    }
    return { ok: failedCount === 0, updated, total: targets.length, failedCount, riderIds, confirmedRideIds };
  } catch (e) {
    showRideError(e);
    return { ok: false, updated: 0, total: 0, failedCount: 0, riderIds: [], confirmedRideIds: [] };
  }
}

// Request completion for all IN_PROGRESS child rides of a posting
export async function groupComplete(ridePostingId: string): Promise<{ ok: boolean; updated: number; total: number; failedCount: number; riderIds: string[] }> {
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
        const { ok: completeOk } = await callUpdateRideStatus(id, 'driver_complete');
        if (!completeOk) throw new Error('complete_failed');
        updated++;
      } catch (e) {
        // Don't silently drop this rider — surface it so the driver knows to retry.
        console.warn('[groupComplete] failed for confirmedRide', id, e);
      }
    }
    const failedCount = targets.length - updated;
    if (failedCount > 0) {
      Alert.alert(
        'Completion incomplete',
        `Completed ${updated} of ${targets.length} passenger(s). Tap Complete Ride again to retry the rest.`,
      );
    }
    return { ok: failedCount === 0, updated, total: targets.length, failedCount, riderIds };
  } catch (e) {
    showRideError(e);
    return { ok: false, updated: 0, total: 0, failedCount: 0, riderIds: [] };
  }
}

// --- Backend update helper: Firebase Callable first, REST fallback to Express ---
async function callUpdateRideStatus(rideId: string, action: 'driver_pickup' | 'driver_complete' | 'rider_pickup' | 'rider_complete', extra?: Record<string, any>): Promise<{ ok: boolean; error?: string; code?: string }> {
  // If extra params are present (e.g. verificationCode), skip the Cloud Function —
  // it doesn't support these params and would bypass validation. Go straight to REST.
  if (!extra || Object.keys(extra).length === 0) {
    try {
      const res: any = await updateRideStatus({ rideId, action });
      if (res && (res as any).data && (res as any).data.ok === false) {
        throw new Error('callable_failed');
      }
      return { ok: true };
    } catch {
      // fall through to REST
    }
  }
  try {
    const base = getApiBaseUrl();
    const token = await firebaseAuth.currentUser?.getIdToken();
    const resp = await fetch(`${base}/rides/${encodeURIComponent(rideId)}/update-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action, userId: firebaseAuth.currentUser?.uid, ...(extra || {}) }),
    });
    const j = await resp.json().catch(() => ({ ok: resp.ok }));
    if (!resp.ok) return { ok: false, error: j?.message || j?.error, code: j?.error };
    return { ok: !!(j && j.ok !== false) };
  } catch {
    return { ok: false };
  }
}
