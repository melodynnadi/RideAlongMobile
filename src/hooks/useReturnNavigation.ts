import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export function useReturnNavigation(fallbackRoute: string) {
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  const goBack = useCallback(() => {
    const destination = returnTo || fallbackRoute;
    // Always replace to the explicit destination — never use router.back() which
    // follows the history stack and ignores where the user came from.
    router.replace(destination as any);
  }, [fallbackRoute, returnTo]);

  return { goBack, returnTo };
}
