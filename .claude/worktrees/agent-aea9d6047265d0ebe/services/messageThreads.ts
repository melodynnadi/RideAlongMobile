import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

interface DeleteThreadErrorData {
  statusCode?: number;
  serverMessage?: string;
  code?: string;
}

export class DeleteMessageThreadError extends Error {
  statusCode?: number;
  serverMessage?: string;
  code?: string;

  constructor(message: string, data: DeleteThreadErrorData = {}) {
    super(message);
    this.name = 'DeleteMessageThreadError';
    this.statusCode = data.statusCode;
    this.serverMessage = data.serverMessage;
    this.code = data.code;
  }
}

function defaultErrorMessageByStatus(statusCode?: number): string {
  if (statusCode === 403) return 'You are not allowed to delete this conversation.';
  if (statusCode === 404) return 'Conversation no longer exists.';
  if (statusCode === 400) return 'Invalid conversation. Please try again.';
  if (statusCode === 500) return 'Failed to delete conversation. Please try again.';
  return 'Could not delete conversation. Please try again.';
}

export function getDeleteMessageThreadErrorMessage(error: unknown): string {
  if (!(error instanceof DeleteMessageThreadError)) {
    return 'Could not delete conversation. Please try again.';
  }

  if (error.statusCode === 403) return 'You are not allowed to delete this conversation.';
  if (error.statusCode === 404) return 'Conversation no longer exists.';
  if (error.code === 'network') return 'Could not reach server. Try again.';
  return error.serverMessage || error.message || 'Could not delete conversation. Please try again.';
}

export async function deleteMessageThread(threadId: string): Promise<void> {
  if (!threadId?.trim()) {
    throw new DeleteMessageThreadError('Invalid conversation. Please try again.', {
      statusCode: 400,
    });
  }

  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new DeleteMessageThreadError('Please sign in again.', {
      code: 'unauthenticated',
    });
  }

  const idToken = await user.getIdToken();
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}/api/messages/thread/${encodeURIComponent(threadId)}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (response.ok) {
      return;
    }

    const responseData = await response
      .json()
      .catch(() => null as { message?: string; error?: string } | null);

    const serverMessage = responseData?.message || responseData?.error;
    const fallbackMessage = defaultErrorMessageByStatus(response.status);

    throw new DeleteMessageThreadError(serverMessage || fallbackMessage, {
      statusCode: response.status,
      serverMessage,
    });
  } catch (error: any) {
    if (error instanceof DeleteMessageThreadError) {
      throw error;
    }

    const networkError = new DeleteMessageThreadError('Could not reach server. Try again.', {
      code: 'network',
    });

    if (error?.name === 'TypeError') {
      throw networkError;
    }

    throw new DeleteMessageThreadError(error?.message || 'Could not delete conversation. Please try again.');
  }
}
