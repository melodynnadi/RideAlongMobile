import * as Sentry from '@sentry/react-native';
import { getApiBaseUrl } from '@/constants/services';

export type SignupUniversity = {
  id?: string | null;
  name: string;
  city?: string | null;
  state?: string | null;
  custom?: boolean;
};

export async function validateSignupUniversity(universityData: SignupUniversity): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/validate-signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ universityData }),
  });

  if (response.ok) return;

  const payload = await response.json().catch(() => null);
  throw new Error(payload?.message || 'We could not validate that university. Please try again.');
}

export function getAuthErrorMessage(error: unknown, action: 'sign-in' | 'sign-up' | 'reset' = 'sign-in'): string {
  const code = (error as any)?.code;
  const fallback = error instanceof Error ? error.message : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'The email or password is incorrect.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'An account already exists for this email. Sign in instead to add another role.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return 'Connection interrupted. Check your signal and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact RideAlong support.';
    case 'auth/internal-error':
    case 'auth/quota-exceeded':
    case 'auth/app-not-authorized':
    case 'auth/operation-not-allowed':
      // These usually surface when the request to Firebase got interrupted or
      // malformed mid-flight (e.g. a weak/flaky connection) rather than
      // anything about the account itself - point at connectivity, since
      // that's the actionable thing on the user's end.
      Sentry.captureException(error, { tags: { authAction: action, authErrorCode: code } });
      return 'Connection interrupted. Check your signal and try again.';
    default:
      // Unrecognized Firebase error code - capture it so we can see exactly
      // which code this was next time, instead of it being invisible (this
      // handler never rethrows, so the global Sentry handler never sees it).
      if (code) Sentry.captureException(error, { tags: { authAction: action, authErrorCode: code } });
      if (fallback && !fallback.startsWith('Firebase:')) return fallback;
      if (action === 'sign-up') return 'Something interrupted account creation. Check your connection and try again.';
      if (action === 'reset') return 'Something interrupted sending the reset email. Check your connection and try again.';
      return 'Something interrupted sign-in. Check your connection and try again.';
  }
}
