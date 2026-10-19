/**
 * Nearby ride alerts — the app's side.
 *
 * The server (RideAlongWebApp/server/services/rideAlerts.js) pushes
 * "Ride available near you" to riders and "Ride request near you" to drivers.
 * To know who is near, it reads `rideAlertSettings/{uid}`, which only the
 * owner (and the server) can read:
 *
 *   { lat, lng, locationUpdatedAt,
 *     rider:  { nearbyEnabled, radiusMiles },
 *     driver: { nearbyEnabled, radiusMiles } }
 *
 * Only an approximate position is stored (rounded to ~1 km), and only when the
 * user has already granted location permission — syncing never prompts.
 */
import * as Location from 'expo-location';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

export type AlertRole = 'rider' | 'driver';

export type RoleAlertPrefs = {
  nearbyEnabled: boolean;
  radiusMiles: number;
};

export const RADIUS_OPTIONS = [5, 10, 25] as const;
export const DEFAULT_RADIUS_MILES = 10;
const DEFAULT_PREFS: RoleAlertPrefs = { nearbyEnabled: true, radiusMiles: DEFAULT_RADIUS_MILES };

const MIN_SYNC_INTERVAL_MS = 30 * 60 * 1000; // at most every 30 min…
const MIN_MOVE_MILES = 0.6;                  // …unless the user moved ~1 km

let lastSync: { lat: number; lng: number; at: number; role: AlertRole } | null = null;
let syncing = false;

/** ~1.1 km precision — enough for "near you", not a precise location. */
const coarse = (n: number) => Math.round(n * 100) / 100;

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function settingsRef(uid: string) {
  return doc(firestore, 'rideAlertSettings', uid);
}

function normalizePrefs(raw: any): RoleAlertPrefs {
  return {
    nearbyEnabled: typeof raw?.nearbyEnabled === 'boolean' ? raw.nearbyEnabled : DEFAULT_PREFS.nearbyEnabled,
    radiusMiles: typeof raw?.radiusMiles === 'number' && raw.radiusMiles > 0 ? raw.radiusMiles : DEFAULT_PREFS.radiusMiles,
  };
}

/** Current alert preferences for a role (defaults if never set). */
export async function getRideAlertPrefs(role: AlertRole): Promise<RoleAlertPrefs & { hasLocation: boolean }> {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) return { ...DEFAULT_PREFS, hasLocation: false };
  try {
    const snap = await getDoc(settingsRef(uid));
    const data = snap.exists() ? snap.data() : {};
    return { ...normalizePrefs(data?.[role]), hasLocation: typeof data?.lat === 'number' };
  } catch {
    return { ...DEFAULT_PREFS, hasLocation: false };
  }
}

async function readPosition(): Promise<{ lat: number; lng: number } | null> {
  const pos = (await Location.getLastKnownPositionAsync({ maxAge: 15 * 60 * 1000 }))
    || (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  if (!pos?.coords) return null;
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/**
 * Save the user's approximate location for nearby alerts. Silent: does nothing
 * unless location permission was already granted. Cheap to call often — it
 * skips the write unless enough time has passed or the user has moved.
 */
export async function syncRideAlertLocation(role: AlertRole, { force = false } = {}): Promise<void> {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid || syncing) return;
  syncing = true;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return;
    const here = await readPosition();
    if (!here) return;

    const now = Date.now();
    if (!force && lastSync && lastSync.role === role && now - lastSync.at < MIN_SYNC_INTERVAL_MS
      && milesBetween(lastSync, here) < MIN_MOVE_MILES) {
      return;
    }
    if (firebaseAuth.currentUser?.uid !== uid) return; // signed out meanwhile

    // Fill in default prefs for this role the first time, without overwriting
    // a choice the user already made.
    const snap = await getDoc(settingsRef(uid));
    const existing = snap.exists() ? snap.data() : {};
    const payload: Record<string, any> = {
      lat: coarse(here.lat),
      lng: coarse(here.lng),
      locationUpdatedAt: serverTimestamp(),
    };
    if (!existing?.[role]) payload[role] = { ...DEFAULT_PREFS };
    await setDoc(settingsRef(uid), payload, { merge: true });
    lastSync = { ...here, at: now, role };
  } catch (e) {
    console.warn('[rideAlerts] location sync failed:', e);
  } finally {
    syncing = false;
  }
}

/**
 * Turn nearby alerts on/off or change the radius for a role. Turning alerts on
 * asks for location permission if needed (returns false if it was refused).
 */
export async function updateRideAlertPrefs(role: AlertRole, changes: Partial<RoleAlertPrefs>): Promise<boolean> {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) return false;

  if (changes.nearbyEnabled === true) {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted' && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return false;
  }

  const current = await getRideAlertPrefs(role);
  const next: RoleAlertPrefs = {
    nearbyEnabled: changes.nearbyEnabled ?? current.nearbyEnabled,
    radiusMiles: changes.radiusMiles ?? current.radiusMiles,
  };
  await setDoc(settingsRef(uid), { [role]: next, updatedAt: serverTimestamp() }, { merge: true });
  if (next.nearbyEnabled) await syncRideAlertLocation(role, { force: true });
  return true;
}

/** Forget the cached sync (e.g. on sign-out). */
export function resetRideAlertSync() {
  lastSync = null;
}
