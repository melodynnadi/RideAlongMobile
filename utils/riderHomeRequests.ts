const text = (value: unknown) => (value == null ? '' : String(value));
const upper = (value: unknown) => text(value).replace(/[-\s]/g, '_').toUpperCase();

type ConfirmedRide = { status?: string; raw?: any };

/**
 * Once a request is accepted the rider has a confirmed ride for it, so the request
 * itself must not be listed too. A request sent again after that ride was cancelled
 * is kept.
 */
export function withoutConfirmedRequests<T extends { id: string }>(requests: T[], confirmed: ConfirmedRide[]): T[] {
  const live = confirmed.filter((ride) => !['CANCELLED', 'CANCELED', 'EXPIRED'].includes(upper(ride.status)));
  return requests.filter((request) => {
    const r = request as any;
    if (!['ACCEPTED', 'CONFIRMED'].includes(upper(r.status || r.state))) return true;
    const postingId = text(r.ridePostingId || r.rideId || r.postingId);
    return !live.some(({ raw = {} }) =>
      r._isPostingRequest
        ? text(raw.ridePostingRequestId) === r.id || (!raw.ridePostingRequestId && !!postingId && text(raw.ridePostingId) === postingId)
        : text(raw.rideRequestId) === r.id);
  });
}
