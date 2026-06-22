import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export function useReturnNavigation(fallbackRoute: string) {
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  const goBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace((returnTo || fallbackRoute) as any);
  }, [fallbackRoute, returnTo]);

  return { goBack, returnTo };
}
