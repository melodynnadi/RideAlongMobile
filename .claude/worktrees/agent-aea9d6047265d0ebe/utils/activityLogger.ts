import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { firebaseAuth, firestore, functions } from '../constants/services';

type ActivityPayload = {
  type: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, any> | null;
  actorId?: string | null;
  actorName?: string | null;
};

type PreparedActivity = {
  type: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, any> | null;
  actorId: string | null;
  actorName: string | null;
  actorType: 'rider';
};

type QueuedActivity = PreparedActivity & { queuedAt: number };

const STORAGE_KEY = '@ridealong_recent_activity_queue_v1';

let queue: QueuedActivity[] = [];
let queueLoaded = false;
let loadingPromise: Promise<void> | null = null;
let flushInFlight = false;
let scheduledFlush: ReturnType<typeof setTimeout> | null = null;

const callable = (() => {
  try {
    return httpsCallable(functions, 'logActivity');
  } catch {
    return null;
  }
})();

function sanitizeMetadata(meta: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!meta || typeof meta !== 'object') return null;
  const result: Record<string, any> = {};
  Object.entries(meta).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null) {
      result[key] = null;
      return;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
      return;
    }
    if (Array.isArray(value)) {
      const arr = value
        .map((item) => {
          if (item === undefined) return undefined;
          if (item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return item;
          if (Array.isArray(item)) {
            const nested = item
              .map((sub) => {
                if (sub === undefined) return undefined;
                if (sub === null || typeof sub === 'string' || typeof sub === 'number' || typeof sub === 'boolean') return sub;
                if (typeof sub === 'object') {
                  const clean = sanitizeMetadata(sub as Record<string, any>);
                  return clean && Object.keys(clean).length ? clean : null;
                }
                return undefined;
              })
              .filter((sub) => sub !== undefined);
            return nested.length ? nested : null;
          }
          if (typeof item === 'object') {
            const clean = sanitizeMetadata(item as Record<string, any>);
            return clean && Object.keys(clean).length ? clean : null;
          }
          return undefined;
        })
        .filter((item) => item !== undefined && item !== null);
      if (arr.length) result[key] = arr;
      return;
    }
    if (typeof value === 'object') {
      const nested = sanitizeMetadata(value as Record<string, any>);
      if (nested && Object.keys(nested).length) {
        result[key] = nested;
      }
    }
  });
  return Object.keys(result).length ? result : null;
}

function prepareActivity(payload: ActivityPayload): PreparedActivity {
  const user = firebaseAuth.currentUser;
  return {
    type: payload.type,
    entityType: payload.entityType ?? null,
    entityId: payload.entityId ?? null,
    metadata: sanitizeMetadata(payload.metadata ?? null),
    actorId: payload.actorId ?? user?.uid ?? null,
    actorName: payload.actorName ?? user?.displayName ?? null,
    actorType: 'rider',
  };
}

async function ensureQueueLoaded() {
  if (queueLoaded) return;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            queue = parsed.filter((item): item is QueuedActivity => typeof item?.type === 'string');
          }
        }
      } catch {
        queue = [];
      } finally {
        queueLoaded = true;
        loadingPromise = null;
      }
    })();
  }
  await loadingPromise;
}

async function persistQueue() {
  try {
    if (queue.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    }
  } catch {
    // Swallow persistence errors; queue will retry next session.
  }
}

function scheduleFlush(delay = 5000) {
  if (scheduledFlush) return;
  scheduledFlush = setTimeout(() => {
    scheduledFlush = null;
    void flushQueue();
  }, delay);
}

async function sendActivity(entry: PreparedActivity) {
  const base = {
    actorType: entry.actorType,
    actorId: entry.actorId,
    actorName: entry.actorName,
    type: entry.type,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
  };

  if (callable) {
    try {
      await callable(base);
      return;
    } catch {
      // fall through to Firestore write
    }
  }

  await addDoc(collection(firestore, 'recent_activity'), {
    ...base,
    ts: serverTimestamp(),
  });
}

async function flushQueue() {
  await ensureQueueLoaded();
  if (flushInFlight || queue.length === 0) return;
  flushInFlight = true;
  try {
    while (queue.length > 0) {
      const entry = queue[0];
      try {
        await sendActivity(entry);
        queue.shift();
        await persistQueue();
      } catch {
        scheduleFlush();
        break;
      }
    }
  } finally {
    flushInFlight = false;
  }
}

export async function logActivity(payload: ActivityPayload): Promise<void> {
  try {
    await ensureQueueLoaded();
    await flushQueue();

    const prepared = prepareActivity(payload);
    try {
      await sendActivity(prepared);
    } catch {
      queue.push({ ...prepared, queuedAt: Date.now() });
      await persistQueue();
      scheduleFlush();
    }
  } catch {
    // Swallow logging errors to avoid impacting primary user flows.
  }
}

void ensureQueueLoaded();
void flushQueue();

try {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      scheduleFlush(1000);
    }
  });
} catch {
  // ignore AppState errors in non-RN environments (e.g., tests)
}

