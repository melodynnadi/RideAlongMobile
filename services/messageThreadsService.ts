import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

const HIDDEN_THREADS_STORAGE_PREFIX = 'hiddenDeletedMessageThreadIds';

export class DeleteMessageThreadError extends Error {
  statusCode?: number;
  serverMessage?: string;
  networkCode?: string;

  constructor(
    message: string,
    options?: { statusCode?: number; serverMessage?: string; networkCode?: string }
  ) {
    super(message);
    this.name = 'DeleteMessageThreadError';
    this.statusCode = options?.statusCode;
    this.serverMessage = options?.serverMessage;
    this.networkCode = options?.networkCode;
  }
}

function getCurrentUserUid(): string {
  const user = firebaseAuth.currentUser;
  if (!user?.uid) {
    throw new DeleteMessageThreadError('You must be signed in to delete conversations.');
  }

  return user.uid;
}

function getHiddenThreadsStorageKey(uid: string): string {
  return `${HIDDEN_THREADS_STORAGE_PREFIX}:${uid}`;
}

export async function getHiddenDeletedThreadIdsForCurrentUser(): Promise<string[]> {
  const uid = getCurrentUserUid();
  const key = getHiddenThreadsStorageKey(uid);

  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

export async function addHiddenDeletedThreadIdForCurrentUser(threadId: string): Promise<string[]> {
  const normalizedThreadId = threadId?.trim();
  if (!normalizedThreadId) {
    return getHiddenDeletedThreadIdsForCurrentUser();
  }

  const existingIds = await getHiddenDeletedThreadIdsForCurrentUser();
  if (existingIds.includes(normalizedThreadId)) {
    return existingIds;
  }

  const nextIds = [...existingIds, normalizedThreadId];
  const uid = getCurrentUserUid();
  const key = getHiddenThreadsStorageKey(uid);
  await AsyncStorage.setItem(key, JSON.stringify(nextIds));

  return nextIds;
}

export async function deleteMessageThread(threadId: string): Promise<void> {
  const normalizedThreadId = threadId?.trim();
  if (!normalizedThreadId) {
    throw new DeleteMessageThreadError('Missing thread ID.', { statusCode: 400 });
  }

  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new DeleteMessageThreadError('You must be signed in to delete conversations.');
  }

  const idToken = await user.getIdToken();
  const apiBase = getApiBaseUrl();

  const endpoint = `${apiBase}/api/messages/thread/${encodeURIComponent(normalizedThreadId)}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
  } catch (error: any) {
    throw new DeleteMessageThreadError('Could not reach server. Try again.', {
      networkCode: error?.code || 'NETWORK_ERROR',
    });
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const serverMessage =
      (typeof payload?.message === 'string' && payload.message) ||
      (typeof payload?.error === 'string' && payload.error) ||
      undefined;

    throw new DeleteMessageThreadError(
      serverMessage || 'Failed to delete conversation.',
      {
        statusCode: response.status,
        serverMessage,
      }
    );
  }
}

export function getDeleteMessageThreadErrorMessage(error: unknown): string {
  const typed = error as DeleteMessageThreadError | undefined;

  if (typed?.statusCode === 403) {
    return 'You are not allowed to delete this conversation.';
  }

  if (typed?.statusCode === 404) {
    return 'Conversation no longer exists.';
  }

  if (typed?.networkCode) {
    return 'Could not reach server. Try again.';
  }

  if (typed?.serverMessage) {
    return typed.serverMessage;
  }

  if (typed?.message) {
    return typed.message;
  }

  return 'Failed to delete conversation.';
}
