import { applyFiltersToRide, cityFromAddress, filtersFromRouteSearch, getDefaultFilters, timeBucketFromSelection } from './rideFilters';

const ride = { from: '3900 University Blvd, Tyler, TX 75799, USA', to: 'Galleria, Houston, TX, USA', date: new Date(2026, 10, 27, 15, 0), price: 25, seats: 2 };

test.each([
  ['123 Main St, Tyler, TX 75701, USA', 'Tyler'],
  ['1600 Amphitheatre Parkway, Mountain View, California', 'Mountain View'],
  ['Dallas, TX, USA', 'Dallas'],
  ['New York, NY, USA', 'New York'],
  ['Houston', 'Houston'],
  ['', null],
])('city of %s', (address, city) => expect(cityFromAddress(address)).toBe(city));

test('a rider at a different street address finds a ride between the same cities', () => {
  const search = { from: '99 Broadway Ave, Tyler, Texas', to: 'Houston, TX, USA' };
  expect(applyFiltersToRide(ride, filtersFromRouteSearch(search), true)).toBe(true);
  expect(applyFiltersToRide(ride, filtersFromRouteSearch({ ...search, date: '2026-11-27' }), true)).toBe(true);
  expect(applyFiltersToRide(ride, filtersFromRouteSearch({ ...search, date: '2026-11-28' }), true)).toBe(false);
  expect(applyFiltersToRide(ride, filtersFromRouteSearch({ ...search, to: 'Amarillo, TX, USA' }), true)).toBe(false);
});

test('an empty search shows everything', () => {
  expect(applyFiltersToRide(ride, filtersFromRouteSearch({}), true)).toBe(true);
});

test('time of day works on rides that only have a date', () => {
  expect(applyFiltersToRide(ride, { ...getDefaultFilters(), timeBucket: 'afternoon' }, true)).toBe(true);
  expect(applyFiltersToRide(ride, { ...getDefaultFilters(), timeBucket: 'morning' }, true)).toBe(false);
});

test('picked times map to a part of the day', () => {
  expect(timeBucketFromSelection('9:00 AM')).toBe('morning');
  expect(timeBucketFromSelection('1:00 PM – 4:00 PM')).toBe('afternoon');
  expect(timeBucketFromSelection('9:00 AM – 4:00 PM')).toBeNull();
  expect(timeBucketFromSelection('')).toBeNull();
});
