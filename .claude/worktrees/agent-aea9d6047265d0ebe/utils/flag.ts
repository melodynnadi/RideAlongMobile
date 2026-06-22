import { serverTimestamp } from 'firebase/firestore';

export type FlagForm = {
  rideId: string;
  reason: string;
  details: string;
  severity: 'high' | 'normal';
};

export function isFlagValid(f: FlagForm): boolean {
  const allowed = ['safety', 'vehicle_accident', 'behavior', 'other'];
  if (!f || !f.rideId) return false;
  if (!allowed.includes(f.reason)) return false;
  if (!f.details || f.details.trim().length < 20) return false;
  return true;
}

export function buildFlagPayload(f: FlagForm, rideData: any, flaggedByRole = 'rider') {
  return {
    rideId: f.rideId,
    riderId: rideData?.riderId ?? null,
    driverId: rideData?.driverId ?? null,
    statusAtFlag: rideData?.status ?? null,
    reason: f.reason,
    details: f.details.trim(),
    severity: f.severity,
    attachments: [],
    flaggedByRole,
    reviewStatus: 'open',
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  } as any;
}
