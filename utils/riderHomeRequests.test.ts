import { withoutConfirmedRequests } from './riderHomeRequests';

const booking = { id: 'rider_p1', _isPostingRequest: true, ridePostingId: 'p1', status: 'accepted' };
const ride = (raw: any, status = 'CONFIRMED') => ({ status, raw });
const ids = (list: { id: string }[]) => list.map((r) => r.id);

test('an accepted booking is hidden once its ride is confirmed', () => {
  expect(withoutConfirmedRequests([booking], [ride({ ridePostingRequestId: 'rider_p1', ridePostingId: 'p1' })])).toEqual([]);
  expect(withoutConfirmedRequests([booking], [ride({ ridePostingId: 'p1' }, 'PENDING')])).toEqual([]);
  expect(withoutConfirmedRequests([booking], [ride({ ridePostingRequestId: 'rider_p1' }, 'DRIVER_COMPLETED')])).toEqual([]);
});

test('an accepted ride request is hidden once its ride is confirmed', () => {
  expect(withoutConfirmedRequests([{ id: 'q1', status: 'CONFIRMED' }], [ride({ rideRequestId: 'q1' })])).toEqual([]);
});

test('everything else stays', () => {
  expect(ids(withoutConfirmedRequests([booking], []))).toEqual(['rider_p1']);
  expect(ids(withoutConfirmedRequests([{ ...booking, status: 'pending' }], [ride({ ridePostingId: 'p1' }, 'cancelled')]))).toEqual(['rider_p1']);
  expect(ids(withoutConfirmedRequests([booking], [ride({ ridePostingRequestId: 'someone-else', ridePostingId: 'p1' })]))).toEqual(['rider_p1']);
  expect(ids(withoutConfirmedRequests([booking], [ride({ ridePostingRequestId: 'rider_p1' }, 'cancelled')]))).toEqual(['rider_p1']);
});
