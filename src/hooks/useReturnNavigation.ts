import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export function useReturnNavigation(fallbackRoute: string) {
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  const goBack = useCallback(() => {
    const dest = returnTo || fallbackRoute;
    // Pop the current screen whenever it was pushed onto the stack. Navigating
    // to `dest` here makes a back action animate like a new screen is opening
    // and leaves the detail screen in the history.
    if (router.canGoBack()) {
      router.back();
    } else if (dest) {
      // Deep links and restored sessions may not have a previous stack entry.
      router.replace(dest as any);
    }
  }, [fallbackRoute, returnTo]);

  return { goBack, returnTo };
}
