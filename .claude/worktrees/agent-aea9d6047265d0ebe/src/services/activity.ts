import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

export type LogActivityPayload = {
  type: string;
  entityType: string;
  entityId?: string | number | null;
  actorId?: string | null;
  actorName?: string | null;
  metadata?: Record<string, any> | null;
};

function isPlainObject(value: any): value is Record<string, any> {
  if (Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitize(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    Object.entries(value).forEach(([key, val]) => {
      const sanitized = sanitize(val);
      if (sanitized !== undefined) out[key] = sanitized;
    });
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
  }
  return value;
}

function deriveActorName(actorName: string | null | undefined, fallbackEmail?: string | null): string | null {
  if (actorName && actorName.trim()) return actorName;
  if (fallbackEmail && fallbackEmail.includes('@')) return fallbackEmail.split('@')[0];
  return actorName ?? fallbackEmail ?? null;
}

export async function logActivity(payload: LogActivityPayload): Promise<void> {
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    if (!payload?.type || !payload?.entityType) return;

    const batch = writeBatch(firestore);
    const ref = doc(collection(firestore, 'recent_activity'));

    const actorId = payload.actorId ?? user.uid;
    const actorName = deriveActorName(payload.actorName, user.displayName ?? user.email ?? null);

    const data = {
      ts: serverTimestamp(),
      actorType: 'driver' as const,
      actorId,
      actorName,
      type: payload.type,
      entityType: payload.entityType,
      entityId: payload.entityId ?? null,
      metadata: payload.metadata ? sanitize(payload.metadata) : null,
    };

    batch.set(ref, data);
    await batch.commit();
  } catch (error) {
    try {
      console.warn('logActivity error', error);
    } catch {}
  }
}
