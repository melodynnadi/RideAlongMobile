/**
 * Entry point for links in RideAlong emails: https://ridealongapp.com/open/...
 * (or ridealong://open/... from the website's "Open in RideAlong" button).
 *
 * Sends the user to the matching screen for their role. Signed-out users go
 * to sign-in; links for the other role switch roles when the account has
 * both, otherwise they land on the user's own home screen.
 *
 * Supported paths (keep in sync with server/emails/template.js openInApp):
 *   driver, driver/requests, driver/messages, driver/earnings, driver/settings
 *   rider, rider/requests, rider/messages, rider/settings, rider/payment-methods
 *   rider/ride/<postingId>, driver/request/<requestId>   (daily ride summary email)
 *   student-verification, rider/student-verification, driver/student-verification
 *   messages, driver-signup, sign-in
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { useAppTheme } from '@/hooks/ThemeContext';

type Role = 'rider' | 'driver';

const ROLE_SCREENS: Record<Role, Record<string, string>> = {
  driver: {
    '': '/(driver)',
    requests: '/(driver)/requests',
    messages: '/(driver)/messages',
    earnings: '/(driver)/earnings',
    settings: '/(driver)/settings',
    'student-verification': '/(driver)/settings/driver-student-verification',
  },
  rider: {
    '': '/(rider)',
    requests: '/(rider)/requests',
    messages: '/(rider)/messages',
    settings: '/(rider)/settings',
    'payment-methods': '/(rider)/settings/payment-methods',
    'student-verification': '/(rider)/settings/student-verification',
  },
};

export default function OpenLink() {
  const { colors } = useAppTheme();
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const { isLoading, isAuthenticated, isEmailVerified, activeRole, role, switchRole } = useAuthStore();
  const rawParts = (Array.isArray(slug) ? slug : slug ? [slug] : []).map((s) => String(s));
  const parts = rawParts.map((s) => s.toLowerCase());

  const handled = useRef(false);

  useEffect(() => {
    if (isLoading || handled.current) return;
    handled.current = true; // a role switch below re-renders; route only once
    const [first = '', second = ''] = parts;

    if (first === 'sign-in' || !isAuthenticated) {
      router.replace('/(auth)/sign-in');
      return;
    }
    if (!isEmailVerified) {
      router.replace('/(auth)/verify-email');
      return;
    }
    if (!activeRole) {
      router.replace('/(auth)/select-role');
      return;
    }

    if (first === 'driver-signup') {
      router.replace(activeRole === 'driver' || role === 'both' ? '/(driver)' : '/(rider)/become-driver');
      return;
    }

    // "messages" etc. without a role use the role the user is in now.
    const linkRole: Role = first === 'driver' || first === 'rider' ? first : activeRole;
    const screenKey = first === 'driver' || first === 'rider' ? second : first;

    const go = async () => {
      let targetRole: Role = activeRole;
      if (linkRole !== activeRole) {
        if (role === 'both') {
          await switchRole(linkRole);
          targetRole = linkRole;
        }
      }
      // A specific ride (riders) or request (drivers). The id keeps its case —
      // Firestore ids are case-sensitive.
      const itemId = (first === 'driver' || first === 'rider') ? rawParts[2] : undefined;
      if (itemId && targetRole === 'rider' && screenKey === 'ride') {
        router.replace({ pathname: '/(rider)/ride/[id]', params: { id: itemId, returnTo: '/(rider)' } } as any);
        return;
      }
      if (itemId && targetRole === 'driver' && screenKey === 'request') {
        router.replace({ pathname: '/(driver)/request/[id]', params: { id: itemId, returnTo: '/(driver)' } } as any);
        return;
      }
      const screens = ROLE_SCREENS[targetRole];
      router.replace((screens[screenKey] ?? screens['']) as any);
    };
    void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, isEmailVerified, activeRole]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
