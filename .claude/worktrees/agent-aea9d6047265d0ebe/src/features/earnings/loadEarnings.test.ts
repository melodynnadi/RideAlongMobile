import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEarningsData } from './loadEarnings';

test('uses the stored Stripe account ID for the initial summary fetch', async () => {
  const docCalls: Array<{ path: string[] }> = [];
  const docFn = (_firestore: unknown, collection: string, userId: string) => {
    docCalls.push({ path: [collection, userId] });
    return { collection, userId };
  };

  const getDocFn = async () => ({
    exists: () => true,
    data: () => ({ stripeAccountId: 'acct_123' }),
  });

  const getEarningsSummaryFn = async (params: { userId?: string; accountId?: string }) => {
    assert.equal(params.userId, 'driver-1');
    assert.equal(params.accountId, 'acct_123');
    return {
      available: 42.5,
      pending: 12.75,
      lifetime: 1000,
      lastPayoutAt: '2024-01-01T00:00:00Z',
    };
  };

  const getAccountStatusFn = async (accountId: string) => {
    assert.equal(accountId, 'acct_123');
    return { status: 'active' };
  };

  const result = await loadEarningsData('driver-1', null, {
    firestoreInstance: {} as any,
    docFn: docFn as any,
    getDocFn: getDocFn as any,
    getEarningsSummaryFn: getEarningsSummaryFn as any,
    getAccountStatusFn: getAccountStatusFn as any,
  });

  assert.deepEqual(docCalls, [{ path: ['users', 'driver-1'] }]);
  assert.deepEqual(result.summary, {
    available: 42.5,
    pending: 12.75,
    lifetime: 1000,
    lastPayoutAt: '2024-01-01T00:00:00Z',
  });
  assert.equal(result.accountId, 'acct_123');
  assert.deepEqual(result.accountStatus, { status: 'active' });
});
