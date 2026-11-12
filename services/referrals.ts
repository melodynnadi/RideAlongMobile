/**
 * Referral invites: the signed-in user's invite codes and progress, and the
 * pending referral a new user brings with them.
 *
 * A referral arrives either from a link (https://ridealongapp.com/r/CODE,
 * opened before or after installing) or typed into the signup form. It's kept
 * on the device until it's attached to the new account, then cleared. If
 * attaching fails for a temporary reason (offline, server error) it's retried
 * later; if the server says it can never work (invalid code, account not new,
 * already referred, program paused) it's dropped. Attaching never blocks or
 * fails account creation.
 *
 * Everything that decides eligibility or rewards happens on the server.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';

export type ReferralProgram = 'rider' | 'driver';
export type PendingReferral = { code: string; source: 'link' | 'code'; savedAt: number; attempts: number };

export type ReferralTerms = {
  program: ReferralProgram;
  rewardCents: number;
  minQualifyingFareCents: number;
  qualifyDays: number;
  rewardExpiryDays: number;
  holdHours: number;
  monthlyReferrerCap?: number;
};
export type RewardView = {
  id: string; side: 'referred' | 'referrer'; program: ReferralProgram; kind: 'rider_discount' | 'driver_bonus';
  amountCents: number; status: string; label: string; detail: string; expiresAt: string | null; createdAt: string | null; paidAt: string | null;
};
export type FriendView = { name: string; program: ReferralProgram; joinedAt: string | null; status: string; label: string; detail: string };
export type FriendItem = { key: string; friend: FriendView; myReward: RewardView | null };
export type ReferralSummary = {
  open: boolean;
  invites: { program: ReferralProgram; code: string; url: string; terms: ReferralTerms }[];
  myReferral: { program: ReferralProgram; status: string; qualifyBy: string | null; reward: RewardView | null } | null;
  rewards: RewardView[];
  friends: { items: FriendItem[]; nextCursor: string | null };
};
export type CodeInfo = { valid: boolean; open: boolean; code?: string; program?: ReferralProgram; terms?: ReferralTerms };

const KEY = 'ridealong.pendingReferral.v1';
const MAX_AGE_MS = 14 * 24 * 3600 * 1000; // the server only accepts new accounts anyway
const MAX_ATTEMPTS = 25;

/** Same rules as the server: a typed code ("abc 7k9") or a pasted invite link. */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  const fromUrl = s.match(/\/r\/([A-Za-z0-9-]{4,16})(?:[/?#]|$)/);
  if (fromUrl) s = fromUrl[1];
  s = s.replace(/[\s-]+/g, '').toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(s) ? s : null;
}

type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function createPendingReferralStore(storage: KeyValueStore = AsyncStorage, now: () => number = Date.now) {
  return {
    async get(): Promise<PendingReferral | null> {
      try {
        const raw = await storage.getItem(KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as PendingReferral;
        if (!normalizeReferralCode(p?.code) || now() - (p.savedAt || 0) > MAX_AGE_MS || (p.attempts || 0) >= MAX_ATTEMPTS) {
          await storage.removeItem(KEY);
          return null;
        }
        return p;
      } catch {
        return null;
      }
    },
    /** Remember a code until it's attached. The latest one wins (a new link replaces an old one). */
    async save(code: string, source: 'link' | 'code'): Promise<PendingReferral | null> {
      const c = normalizeReferralCode(code);
      if (!c) return null;
      const p: PendingReferral = { code: c, source, savedAt: now(), attempts: 0 };
      await storage.setItem(KEY, JSON.stringify(p)).catch(() => undefined);
      return p;
    },
    async clear(): Promise<void> {
      await storage.removeItem(KEY).catch(() => undefined);
    },
    async bump(p: PendingReferral): Promise<void> {
      await storage.setItem(KEY, JSON.stringify({ ...p, attempts: (p.attempts || 0) + 1 })).catch(() => undefined);
    },
  };
}

export const pendingReferral = createPendingReferralStore();

export type AttachResult =
  | { status: 'none' }
  | { status: 'attached'; program: ReferralProgram }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'retry' };

type AttachDeps = {
  store?: ReturnType<typeof createPendingReferralStore>;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
  baseUrl?: () => string;
};

const currentToken = async () => (await firebaseAuth.currentUser?.getIdToken().catch(() => null)) ?? null;
let inflight: Promise<AttachResult> | null = null;

/**
 * Attach the pending referral (if any) to the signed-in account. Safe to call
 * any number of times (sign-up, app start, foreground); concurrent calls share
 * one request.
 */
export function attachPendingReferral(deps: AttachDeps = {}): Promise<AttachResult> {
  if (!inflight) {
    inflight = attachOnce(deps).finally(() => { inflight = null; });
  }
  return inflight;
}

async function attachOnce({ store = pendingReferral, fetchImpl = fetch, getToken = currentToken, baseUrl = getApiBaseUrl }: AttachDeps): Promise<AttachResult> {
  const pending = await store.get();
  if (!pending) return { status: 'none' };
  const token = await getToken();
  if (!token) return { status: 'retry' };
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl()}/api/referrals/attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: pending.code, source: pending.source }),
    });
  } catch {
    await store.bump(pending);
    return { status: 'retry' };
  }
  const body = (await res.json().catch(() => ({}))) as { program?: ReferralProgram; code?: string; error?: string; definitive?: boolean };
  if (res.ok) {
    await store.clear();
    return { status: 'attached', program: body.program === 'driver' ? 'driver' : 'rider' };
  }
  // The server says whether retrying can help; without that (an older
  // server, a proxy error) only plain 4xx answers are treated as final.
  const definitive = typeof body.definitive === 'boolean'
    ? body.definitive
    : res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status);
  if (definitive) {
    await store.clear();
    return { status: 'rejected', code: body.code || 'rejected', message: body.error || 'That referral code can’t be used.' };
  }
  await store.bump(pending);
  return { status: 'retry' };
}

// ------------------------------------------------------------------ API --
async function authHeaders(): Promise<Record<string, string>> {
  const token = await currentToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function getJson<T>(path: string, auth = true): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, { headers: auth ? await authHeaders() : {} });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || 'Couldn’t load your invites. Try again.');
  return body as T;
}

export const fetchReferralSummary = () => getJson<ReferralSummary>('/api/referrals/me');
export const fetchMoreFriends = (cursor: string) => getJson<ReferralSummary['friends']>(`/api/referrals/me/friends?cursor=${encodeURIComponent(cursor)}`);
export const fetchInviteQr = async (program: ReferralProgram) => (await getJson<{ svg: string }>(`/api/referrals/me/qr?program=${program}`)).svg;
/** Public: is this code valid, which program, and its terms. */
export const lookupReferralCode = (code: string) => getJson<CodeInfo>(`/api/referrals/codes/${encodeURIComponent(code)}`, false);

export const formatCents = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** The message shared with the invite link. Matches the real terms. */
export function inviteMessage(invite: { program: ReferralProgram; code: string; url: string; terms: ReferralTerms }): string {
  const amt = formatCents(invite.terms.rewardCents);
  const min = formatCents(invite.terms.minQualifyingFareCents);
  return invite.program === 'driver'
    ? `Drive with me on RideAlong. Sign up with my code ${invite.code} and earn a ${amt} bonus after your first trip with ${min}+ in passenger fares (once you’re approved and verified). ${invite.url}`
    : `Join me on RideAlong for rides with verified students. Sign up with my code ${invite.code} to get ${amt} off a ride of ${min} or more once your student status is approved. ${invite.url}`;
}
