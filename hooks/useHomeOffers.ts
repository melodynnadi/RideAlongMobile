import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { promotionService } from '@/services/promotions';
import { loadOffersForRider } from '@/services/promoCheckout';
import type { ProfileCompletionItem } from '@/hooks/useProfileCompleteness';

/**
 * Checkout offers to feature on the rider home carousel: offers this rider
 * can still use (the server leaves out code-only and used-up ones).
 * Reloaded whenever the home screen regains focus, so an offer disappears
 * after it's used and comes back if that use is released.
 * Offers are applied at checkout — nothing to claim here.
 */
export function useHomeOffers() {
  const [items, setItems] = useState<ProfileCompletionItem[]>([]);
  const requestRef = useRef(0);

  useFocusEffect(useCallback(() => {
    const request = ++requestRef.current;
    loadOffersForRider()
      .then((offers) => {
        if (request !== requestRef.current) return;
        setItems(offers.map((p) => ({
          id: `offer-${p.id}`,
          title: p.title,
          description: `${promotionService.getPromotionDisplayValue(p)} — pick it at checkout when you book.`,
          cta: 'Find a ride',
          icon: 'pricetag-outline',
          route: '/(rider)/available-rides',
        })));
      })
      // Keep showing the last list if a refresh fails (e.g. briefly offline).
      .catch(() => {});
  }, []));

  return items;
}
