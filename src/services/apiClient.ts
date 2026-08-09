import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

type ApiOptions = RequestInit & {
  auth?: boolean;
};

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { auth = true, headers, ...init } = options;
  const requestHeaders = new Headers(headers);

  if (!requestHeaders.has('Accept')) requestHeaders.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData) && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  if (auth) {
    const user = firebaseAuth.currentUser;
    if (!user) throw new ApiError('Please sign in again.', 401);
    requestHeaders.set('Authorization', `Bearer ${await user.getIdToken()}`);
  }

  const response = await fetch(`${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers: requestHeaders,
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && ('message' in data || 'error' in data)
        ? String((data as any).message || (data as any).error)
        : '') || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    await apiFetch('/health', { auth: false });
    return true;
  } catch {
    return false;
  }
}
