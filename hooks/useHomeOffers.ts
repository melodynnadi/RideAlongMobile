import { useEffect, useState } from 'react';
import { promotionService } from '@/services/promotions';
import type { ProfileCompletionItem } from '@/hooks/useProfileCompleteness';

/**
 * Checkout offers to feature on the rider home carousel: active, redeemable
 * promotions that admins chose to offer to all riders. Code-only promotions
 * are never listed (getActivePromotions excludes them), so codes stay private.
 * Offers are applied at checkout — nothing to claim here.
 */
export function useHomeOffers() {
  const [items, setItems] = useState<ProfileCompletionItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    promotionService.getActivePromotions()
      .then((promotions) => {
        if (cancelled) return;
        setItems(
          promotions
            .filter((p) => p.redeemable)
            .map((p) => ({
              id: `offer-${p.id}`,
              title: p.title,
              description: `${promotionService.getPromotionDisplayValue(p)} — pick it at checkout when you book.`,
              cta: 'Find a ride',
              icon: 'pricetag-outline',
              route: '/(rider)/available-rides',
            })),
        );
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  return items;
}
