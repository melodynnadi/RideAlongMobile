import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export function useReturnNavigation(fallbackRoute: string) {
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  const goBack = useCallback(() => {
    // Prefer router.back() for the correct pop animation.
    // Only use replace() when there is no back history (e.g. deep-linked directly).
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace((returnTo || fallbackRoute) as any);
    }
  }, [fallbackRoute, returnTo]);

  return { goBack, returnTo };
}
