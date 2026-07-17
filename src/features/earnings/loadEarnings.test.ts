import { loadEarningsData } from './loadEarnings';

describe('loadEarningsData', () => {
  it('reads the user doc, resolves the stored Stripe account ID, and maps the earnings summary', async () => {
    const docCalls: { path: string[] }[] = [];
    const summaryArgs: unknown[] = [];
    const statusArgs: unknown[] = [];

    const docFn = (_firestore: unknown, collection: string, userId: string) => {
      docCalls.push({ path: [collection, userId] });
      return { collection, userId };
    };

    const getDocFn = async () => ({
      exists: () => true,
      data: () => ({ stripeAccountId: 'acct_123' }),
    });

    const getEarningsSummaryFn = async (userId: string) => {
      summaryArgs.push(userId);
      return {
        available: 42.5,
        pending: 12.75,
        lifetime: 1000,
        lastPayoutAt: '2024-01-01T00:00:00Z',
      };
    };

    const getAccountStatusFn = async (userId: string) => {
      statusArgs.push(userId);
      return { status: 'active' };
    };

    const result = await loadEarningsData('driver-1', null, {
      firestoreInstance: {} as any,
      docFn: docFn as any,
      getDocFn: getDocFn as any,
      getEarningsSummaryFn: getEarningsSummaryFn as any,
      getAccountStatusFn: getAccountStatusFn as any,
    });

    // The user doc is read by uid to discover the stored Stripe account.
    expect(docCalls).toEqual([{ path: ['users', 'driver-1'] }]);
    // Summary + status are fetched by uid.
    expect(summaryArgs).toEqual(['driver-1']);
    expect(statusArgs).toEqual(['driver-1']);
    // The stored account ID is surfaced on the result.
    expect(result.accountId).toBe('acct_123');
    expect(result.summary).toEqual({
      available: 42.5,
      pending: 12.75,
      lifetime: 1000,
      lastPayoutAt: '2024-01-01T00:00:00Z',
    });
    expect(result.accountStatus).toEqual({ status: 'active' });
  });
});
