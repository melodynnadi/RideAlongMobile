import { sendEmailVerification, type User } from 'firebase/auth';

import { getApiBaseUrl } from '@/constants/services';

const verificationContinueUrl =
  process.env.EXPO_PUBLIC_EMAIL_VERIFICATION_CONTINUE_URL ||
  process.env.EXPO_PUBLIC_APP_URL ||
  'https://ridealongapp.com';

export async function sendVerificationEmailThroughBackend(user: User): Promise<boolean> {
  const idToken = await user.getIdToken();
  const response = await fetch(`${getApiBaseUrl()}/api/auth/send-verification-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idToken,
      continueUrl: verificationContinueUrl,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || payload?.message || `Email server error ${response.status}`);
  }

  return true;
}

export async function sendVerificationEmailWithFallback(user: User): Promise<void> {
  try {
    await sendVerificationEmailThroughBackend(user);
    return;
  } catch (backendError) {
    console.warn('[emailVerification] backend sender failed, falling back to Firebase Auth email:', backendError);
  }

  await sendEmailVerification(user, { url: verificationContinueUrl });
}
