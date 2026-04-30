/**
 * Simple event-based toast de-duplication.
 * Suppresses repeated toasts with the same key within a small time window.
 */

const SEEN: Map<string, number> = new Map();

/**
 * Returns true if a toast with this key should be shown now (i.e., not a recent duplicate).
 * Records the key timestamp when allowed.
 */
export function shouldShowToastEvent(key: string, windowMs: number = 2500): boolean {
  try {
    const now = Date.now();
    const last = SEEN.get(key) || 0;
    if (now - last < windowMs) return false;
    SEEN.set(key, now);
    // Periodically prune old entries
    if (SEEN.size > 200) {
      const cutoff = now - windowMs * 4;
      for (const [k, t] of SEEN.entries()) {
        if (t < cutoff) SEEN.delete(k);
      }
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Builds a reasonable dedupe key from notification-like data.
 */
export function buildToastKey(type?: string, rideId?: string | null, extras?: Array<string | undefined | null>): string {
  const parts = [type || 'generic', rideId || ''];
  if (extras && Array.isArray(extras)) {
    for (const e of extras) parts.push(String(e || ''));
  }
  return parts.join('|');
}
