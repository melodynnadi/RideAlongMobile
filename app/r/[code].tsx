/**
 * Personal invite links: https://ridealongapp.com/r/CODE (Universal Links /
 * App Links) or ridealong://r/CODE (the landing page's "Open in RideAlong").
 *
 * The code is saved on the device first, so it survives sign-up and email
 * verification; it's attached to the account once one exists (see
 * services/referrals.ts — retried until it works or is definitively
 * rejected). Someone already signed in gets an answer right away: a new
 * account gets the referral, an existing one is told codes are for new
 * accounts. Nothing here can block signing up.
 */
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '@/stores/authStore';
import { useAppTheme } from '@/hooks/ThemeContext';
import { attachPendingReferral, lookupReferralCode, normalizeReferralCode, pendingReferral } from '@/services/referrals';

export default function ReferralLink() {
  const { colors } = useAppTheme();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { isLoading, isAuthenticated, isEmailVerified, activeRole } = useAuthStore();
  const handled = useRef(false);

  useEffect(() => {
    if (isLoading || handled.current) return;
    handled.current = true;
    const normalized = normalizeReferralCode(Array.isArray(code) ? code[0] : code);

    const run = async () => {
      if (normalized) await pendingReferral.save(normalized, 'link');

      if (!isAuthenticated) {
        // New here: driver invites go straight to the driver application;
        // everyone else to the usual welcome → sign-up. The code is pre-filled.
        const info = normalized ? await lookupReferralCode(normalized).catch(() => null) : null;
        router.replace(info?.program === 'driver' ? '/(auth)/driver-signup' : '/(auth)/welcome');
        return;
      }

      const result = normalized ? await attachPendingReferral() : { status: 'none' as const };
      if (result.status === 'attached') {
        Toast.show({ type: 'success', text1: 'Invite code added', text2: 'Your reward progress is in Settings → Invite friends.' });
      } else if (result.status === 'rejected') {
        Alert.alert(
          'Invite code not added',
          result.code === 'not_new_account' || result.code === 'already_referred'
            ? 'Invite codes are for new RideAlong accounts. You can invite your own friends from Settings → Invite friends.'
            : result.message,
        );
      }
      // 'retry': kept on the device and tried again later.
      if (!isEmailVerified) router.replace('/(auth)/verify-email');
      else router.replace((activeRole === 'driver' ? '/(driver)' : activeRole === 'rider' ? '/(rider)' : '/(auth)/select-role') as any);
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
