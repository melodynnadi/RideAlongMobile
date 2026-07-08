import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export function useReturnNavigation(fallbackRoute: string) {
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  const goBack = useCallback(() => {
    const dest = returnTo || fallbackRoute;
    // When an explicit returnTo is provided, always use it.
    // router.back() goes to the wrong screen when the navigation was a tab
    // switch rather than a stack push (e.g. Tabs.Screen destinations).
    if (dest) {
      router.navigate(dest as any);
    } else if (router.canGoBack()) {
      router.back();
    }
  }, [fallbackRoute, returnTo]);

  return { goBack, returnTo };
}
