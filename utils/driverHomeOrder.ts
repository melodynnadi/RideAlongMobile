type HomeCard = {
  id: string;
  type?: string;
  status?: string | null;
  confirmedStatus?: string | null;
  raw?: any;
};

/** Underway: the driver is on the way, or the ride has started and isn't finished. */
function isUnderway(card: HomeCard): boolean {
  const status = String(card.confirmedStatus || card.status || '').replace(/[-\s]/g, '_').toLowerCase();
  if (['in_progress', 'driver_completed', 'rider_completed'].includes(status)) return true;
  return status === 'confirmed' && !!card.raw?.driverEnRoute;
}

/**
 * Order for the driver home: rides underway, then rides with a booking request
 * waiting for an answer, then everything else. Cards keep their existing (date)
 * order within each group.
 */
export function prioritizeDriverHomeCards<T extends HomeCard>(
  cards: T[],
  requestByPostingId: Record<string, { status: string } | undefined>,
): T[] {
  const rank = (card: T) => {
    if (isUnderway(card)) return 0;
    const request = card.type === 'ridePosting' ? requestByPostingId[card.id] : undefined;
    return request && request.status.toLowerCase() !== 'expired' ? 1 : 2;
  };
  return cards
    .map((card, index) => ({ card, index, rank: rank(card) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ card }) => card);
}
