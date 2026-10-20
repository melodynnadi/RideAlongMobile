import { router } from 'expo-router';

/**
 * Open the in-app student verification screen for the given role.
 * (These prompts used to open the website with the sign-in token in the URL.)
 */
export function openStudentVerification(role: 'rider' | 'driver', returnTo?: string) {
  const pathname = role === 'driver'
    ? '/(driver)/settings/driver-student-verification'
    : '/(rider)/settings/student-verification';
  router.push({
    pathname,
    params: { returnTo: returnTo || (role === 'driver' ? '/(driver)' : '/(rider)') },
  } as any);
}
