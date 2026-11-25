import { prioritizeDriverHomeCards } from './driverHomeOrder';

const posting = (id: string, extra = {}) => ({ id, type: 'ridePosting', status: 'posted', ...extra });
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);
const pending = { status: 'pending' };

test('a ride with a waiting request comes before an earlier one without', () => {
  expect(ids(prioritizeDriverHomeCards([posting('fri'), posting('satAm'), posting('satPm')], { satPm: pending }))).toEqual(['satPm', 'fri', 'satAm']);
});

test('several requests keep date order', () => {
  expect(ids(prioritizeDriverHomeCards([posting('a'), posting('b'), posting('c')], { c: pending, b: pending }))).toEqual(['b', 'c', 'a']);
});

test('a ride underway stays on top', () => {
  const trip = { id: 'trip', type: 'ridePosting', status: 'CONFIRMED', confirmedStatus: 'IN_PROGRESS' };
  const enRoute = { id: 'enRoute', type: 'ridePosting', status: 'CONFIRMED', confirmedStatus: 'CONFIRMED', raw: { driverEnRoute: true } };
  expect(ids(prioritizeDriverHomeCards([posting('a'), trip], { a: pending }))).toEqual(['trip', 'a']);
  expect(ids(prioritizeDriverHomeCards([posting('a'), enRoute], { a: pending }))).toEqual(['enRoute', 'a']);
});

test('a request beats a later confirmed ride that has not started', () => {
  const confirmed = { id: 'confirmed', type: 'ridePosting', status: 'CONFIRMED', confirmedStatus: 'CONFIRMED' };
  expect(ids(prioritizeDriverHomeCards([confirmed, posting('a')], { a: pending }))).toEqual(['a', 'confirmed']);
});

test('expired requests and no requests leave the order alone', () => {
  expect(ids(prioritizeDriverHomeCards([posting('a'), posting('b')], { b: { status: 'expired' } }))).toEqual(['a', 'b']);
  expect(ids(prioritizeDriverHomeCards([posting('a'), posting('b')], {}))).toEqual(['a', 'b']);
});
