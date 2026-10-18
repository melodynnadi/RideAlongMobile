import { getApiBaseUrl } from '@/constants/services';

export type SignupUniversity = {
  id?: string | null;
  name: string;
  city?: string | null;
  state?: string | null;
  custom?: boolean;
  /** School website from the search results, used to sanity-check the email domain. */
  url?: string | null;
};

/** Registrable part of a hostname, e.g. "www.uc.edu" → "uc.edu". */
function baseDomain(host: string) {
  return host.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
}

/**
 * Returns the school's domain when the email clearly doesn't belong to it
 * (e.g. "name@uc.mail.edu" for uc.edu), otherwise null. Subdomains like
 * "mail.uc.edu" count as a match. Unknown/custom schools are never flagged.
 */
export function emailDomainMismatch(email: string, university?: SignupUniversity | null): string | null {
  const emailDomain = email.trim().toLowerCase().split('@')[1];
  if (!emailDomain || !university?.url) return null;
  let schoolDomain: string;
  try {
    schoolDomain = baseDomain(new URL(university.url).hostname);
  } catch {
    return null;
  }
  if (!schoolDomain.endsWith('.edu')) return null;
  return emailDomain === schoolDomain || emailDomain.endsWith(`.${schoolDomain}`) ? null : schoolDomain;
}

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
      return 'Could not connect. Check your internet connection and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact RideAlong support.';
    default:
      if (fallback && !fallback.startsWith('Firebase:')) return fallback;
      if (action === 'sign-up') return 'We could not create your account. Please try again.';
      if (action === 'reset') return 'We could not send the reset email. Please try again.';
      return 'We could not sign you in. Please try again.';
  }
}
