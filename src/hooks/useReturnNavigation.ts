import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

export function useReturnNavigation(fallbackRoute: string) {
  const { returnTo: returnToParam } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(returnToParam) ? returnToParam[0] : returnToParam;

  const goBack = useCallback(() => {
    if (returnTo) {
      // An explicit returnTo was passed by whoever navigated here — trust it
      // over router.back(). Sibling screens under the same tab's nested Stack
      // (e.g. Vehicle Info and Ride History both living in the driver
      // settings tab's Stack) don't get their history cleared when the tab
      // loses focus, so router.canGoBack()/router.back() can silently pop to
      // a stale, unrelated screen left over from an earlier visit instead of
      // the screen the caller actually asked to return to.
      //
      // Use navigate, not replace or dismissTo: returnTo targets a route in
      // a DIFFERENT navigator (e.g. the profile tab, while this screen lives
      // inside the settings tab's nested Stack). replace() only swaps the
      // current entry within its own navigator, so it can't leave the
      // nested Stack — it pushes a new instance while the old Stack lingers
      // underneath, looking like a duplicate screen opening. dismissTo maps
      // to a Stack-only POP_TO action, which a tab navigator doesn't know
      // how to handle, so it silently no-ops when the destination is a
      // different tab. navigate() is what Expo Router itself maps to the
      // tab-navigator JUMP_TO action, which is the actual "switch tabs"
      // primitive.
      router.navigate(returnTo as any);
      return;
    }
    // No explicit returnTo: pop the current screen whenever it was pushed
    // onto the stack. Navigating to fallbackRoute here makes a back action
    // animate like a new screen is opening and leaves the detail screen in
    // the history.
    if (router.canGoBack()) {
      router.back();
    } else if (fallbackRoute) {
      // Deep links and restored sessions may not have a previous stack entry.
      router.replace(fallbackRoute as any);
    }
  }, [fallbackRoute, returnTo]);

  return { goBack, returnTo };
}
