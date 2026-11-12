jest.mock('@/constants/services', () => ({ firebaseAuth: { currentUser: null }, getApiBaseUrl: () => 'https://api.test' }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import { attachPendingReferral, createPendingReferralStore, inviteMessage, normalizeReferralCode } from './referrals';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => { m.set(k, v); },
    removeItem: async (k: string) => { m.delete(k); },
  };
}

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('normalizeReferralCode', () => {
  it('accepts typed codes and pasted invite links, and rejects anything else', () => {
    expect(normalizeReferralCode(' abc 7k9 ')).toBe('ABC7K9');
    expect(normalizeReferralCode('ABC-7K9')).toBe('ABC7K9');
    expect(normalizeReferralCode('https://ridealongapp.com/r/abc7k9?utm=x')).toBe('ABC7K9');
    expect(normalizeReferralCode('ridealong://r/ABC7K9')).toBe('ABC7K9');
    expect(normalizeReferralCode('<b>')).toBeNull();
    expect(normalizeReferralCode('')).toBeNull();
    expect(normalizeReferralCode(42)).toBeNull();
  });
});

describe('pending referral store', () => {
  it('keeps a code through onboarding and drops stale or invalid ones', async () => {
    let now = 1_000_000;
    const store = createPendingReferralStore(memoryStorage(), () => now);
    expect(await store.save('nope!', 'link')).toBeNull();
    await store.save('abc7k9', 'link');
    now += 3 * 24 * 3600 * 1000; // a few days of onboarding
    expect(await store.get()).toMatchObject({ code: 'ABC7K9', source: 'link', attempts: 0 });
    now += 12 * 24 * 3600 * 1000; // over two weeks: dropped
    expect(await store.get()).toBeNull();
  });
});

describe('attachPendingReferral', () => {
  const setup = () => {
    const store = createPendingReferralStore(memoryStorage());
    const calls: { url: string; init: any }[] = [];
    let next: () => Response = () => reply(200, { ok: true, status: 'attached', program: 'rider' });
    const fetchImpl = (async (url: string, init: any) => { calls.push({ url, init }); return next(); }) as unknown as typeof fetch;
    const deps = { store, fetchImpl, getToken: async () => 'id-token', baseUrl: () => 'https://api.test' };
    return { store, calls, deps, respond: (fn: () => Response) => { next = fn; } };
  };

  it('does nothing without a pending code', async () => {
    const { deps, calls } = setup();
    expect(await attachPendingReferral(deps)).toEqual({ status: 'none' });
    expect(calls).toHaveLength(0);
  });

  it('attaches with the signed-in token and the link source, then clears', async () => {
    const { deps, store, calls } = setup();
    await store.save('ABC7K9', 'link');
    expect(await attachPendingReferral(deps)).toEqual({ status: 'attached', program: 'rider' });
    expect(calls[0].url).toBe('https://api.test/api/referrals/attach');
    expect(calls[0].init.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(calls[0].init.body)).toEqual({ code: 'ABC7K9', source: 'link' });
    expect(await store.get()).toBeNull();
  });

  it('keeps the code for later when signed out, offline or the server fails', async () => {
    const { deps, store, respond } = setup();
    await store.save('ABC7K9', 'code');
    expect(await attachPendingReferral({ ...deps, getToken: async () => null })).toEqual({ status: 'retry' });
    expect(await attachPendingReferral({ ...deps, fetchImpl: (async () => { throw new Error('offline'); }) as any })).toEqual({ status: 'retry' });
    respond(() => reply(500, { error: 'Something went wrong.', code: 'server_error', definitive: false }));
    expect(await attachPendingReferral(deps)).toEqual({ status: 'retry' });
    respond(() => reply(409, { error: 'Finish creating your account first.', code: 'no_profile', definitive: false }));
    expect(await attachPendingReferral(deps)).toEqual({ status: 'retry' });
    expect(await store.get()).toMatchObject({ code: 'ABC7K9', attempts: 3 });
  });

  it('drops the code when the server says it can never work', async () => {
    const { deps, store, respond } = setup();
    await store.save('ABC7K9', 'link');
    respond(() => reply(409, { error: 'Referral codes are for new accounts only.', code: 'not_new_account', definitive: true }));
    expect(await attachPendingReferral(deps)).toEqual({ status: 'rejected', code: 'not_new_account', message: 'Referral codes are for new accounts only.' });
    expect(await store.get()).toBeNull();
  });

  it('shares one request between concurrent calls', async () => {
    const { deps, store, calls } = setup();
    await store.save('ABC7K9', 'code');
    const [a, b] = await Promise.all([attachPendingReferral(deps), attachPendingReferral(deps)]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
  });
});

describe('inviteMessage', () => {
  it('states the real terms for each program', () => {
    const terms = { rewardCents: 500, minQualifyingFareCents: 6000, qualifyDays: 60, rewardExpiryDays: 60, holdHours: 72 };
    expect(inviteMessage({ program: 'rider', code: 'ABC7K9', url: 'https://ridealongapp.com/r/ABC7K9', terms: { program: 'rider', ...terms } }))
      .toBe('Join me on RideAlong for rides with verified students. Sign up with my code ABC7K9 to get $5 off a ride of $60 or more once your student status is approved. https://ridealongapp.com/r/ABC7K9');
    expect(inviteMessage({ program: 'driver', code: 'DRV222', url: 'https://ridealongapp.com/r/DRV222', terms: { program: 'driver', ...terms } }))
      .toContain('earn a $5 bonus after your first trip with $60+ in passenger fares');
  });
});
