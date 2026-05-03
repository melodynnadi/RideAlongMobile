import { firebaseAuth, getApiBaseUrl, firestore } from '@/constants/services';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import type { PayoutStatus, EarningsData, AddBankAccountPayload, BankAccount } from '@/types';

export type EarningsSummary = {
  available: number; // cents -> server returns dollars, but we standardize as dollars here
  pending: number;
  lifetime?: number | null; // may be null when sourced from Stripe only
  lastPayoutAt?: string | null;
};

// Deprecated signature removed; use getEarningsSummary({ userId?, accountId? }) below

export async function instantDeposit(accountId: string, amountDollars?: number): Promise<{ ok: boolean; message?: string; payoutId?: string; payout?: any }>{
  // NOTE: Server endpoint expects `amount` in DOLLARS, matching Stripe balance retrieval logic.
  // We previously passed cents which caused insufficient funds errors by inflating requested amount.
  const base = getApiBaseUrl();
  const user = firebaseAuth.currentUser;
  const res = await authorizedFetch(`${base}/api/connect/instant-deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: user?.uid, amount: amountDollars, accountId }),
  });
  if (!res.ok) {
    let msg = 'Request failed';
    try { const j = await res.json(); msg = j?.error || msg; } catch {}
    return { ok: false, message: msg };
  }
  const data = await res.json().catch(() => ({}));
  // Normalize payoutId for existing callers
  const payoutId = data?.payout?.id || data?.payoutId;
  return { ok: true, payoutId, ...data } as any;
}

// Connect onboarding: create/reuse a connected account and return onboarding URL
export async function createOnboardingLink(payload: { accountId?: string; email?: string; country?: string; userId?: string }): Promise<{ url: string; accountId: string }>{
  // Use server's onboarding endpoint
  const base = getApiBaseUrl();
  const res = await authorizedFetch(`${base}/api/connect/start-onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to start onboarding');
  return res.json();
}

// Backward-compatible API: keep name `getAccountStatus` but fetch by userId via account-status route
export async function getAccountStatus(userId: string) {
  const base = getApiBaseUrl();
  const res = await authorizedFetch(`${base}/api/connect/account-status?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error('Failed to fetch account status');
  return res.json();
}

export async function createDashboardLink(userId: string): Promise<{ url: string }>{
  const base = getApiBaseUrl();
  const res = await authorizedFetch(`${base}/api/connect/login-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error('Failed to create dashboard link');
  return res.json();
}

export async function getEarningsSummary(params: { userId?: string; accountId?: string }): Promise<EarningsSummary> {
  // Delegate to getDriverEarnings for a stable summary response
  if (!params.userId) throw new Error('userId is required');
  const data = await getDriverEarnings(params.userId);
  return {
    available: data.available,
    pending: data.pending,
    lifetime: data.lifetime ?? null,
    lastPayoutAt: data.lastPayoutAt ?? null,
  };
}

// ============================================
// NEW API ENDPOINTS FOR PAYOUT MANAGEMENT
// ============================================

/**
 * GET /api/connect/account-status?userId=...
 * Fetches payout status including connected bank accounts
 */
export async function getPayoutStatusByUserId(userId: string): Promise<PayoutStatus> {
  const base = getApiBaseUrl();
  const res = await authorizedFetch(`${base}/api/connect/account-status?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch payout status: ${errorText}`);
  }
  return res.json();
}

/**
 * POST /api/connect/add-bank-account
 * Adds a new bank account for payouts
 */
export async function addBankAccount(userId: string, payload: AddBankAccountPayload): Promise<{ success: boolean; bankAccount?: BankAccount; error?: string }> {
  const base = getApiBaseUrl();
  const res = await authorizedFetch(`${base}/api/connect/add-bank-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...payload }),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    return { success: false, error: data.error || 'Failed to add bank account' };
  }
  
  return { success: true, bankAccount: data.bankAccount };
}

/**
 * POST /api/connect/remove-payout-method
 * Removes a bank account from payout methods
 */
export async function removeBankAccount(userId: string, bankAccountId: string): Promise<{ success: boolean; error?: string }> {
  const base = getApiBaseUrl();
  const res = await authorizedFetch(`${base}/api/connect/remove-payout-method`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, payoutMethodId: bankAccountId }),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    return { success: false, error: data.error || 'Failed to remove bank account' };
  }
  
  return { success: true };
}

/**
 * POST /api/connect/set-default-payout
 * Sets a bank account as the default payout method
 */
export async function setDefaultBankAccount(userId: string, bankAccountId: string): Promise<{ success: boolean; error?: string }> {
  const base = getApiBaseUrl();
  const res = await authorizedFetch(`${base}/api/connect/set-default-payout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, payoutMethodId: bankAccountId }),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    return { success: false, error: data.error || 'Failed to set default bank account' };
  }
  
  return { success: true };
}

/**
 * GET /api/connect/driver-earnings?userId=...
 * Fetches comprehensive earnings summary for a driver
 */
export async function getDriverEarnings(userId: string): Promise<EarningsData> {
  const base = getApiBaseUrl();
  // Replicate web app summary-only logic locally:
  // 1. totalEarnings from Firestore user profile
  // 2. ridesCompleted count from confirmedRides (optional for future UI)
  // 3. availableBalance from Stripe instant_available via driver-stats endpoint

  // Firestore: get user profile totalEarnings
  let totalEarnings = 0;
  try {
    const userRef = doc(firestore as any, 'drivers', userId);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data: any = snap.data();
      const te = Number(data?.totalEarnings);
      if (Number.isFinite(te)) totalEarnings = te;
    }
  } catch (e) {
    console.warn('[getDriverEarnings] Firestore totalEarnings read failed:', (e as any)?.message || e);
  }

  // Firestore: compute ridesCompleted (not returned but kept for extensibility)
  let ridesCompleted = 0;
  try {
    const ridesQ = query(
      collection(firestore as any, 'confirmedRides'),
      where('driverId', '==', userId),
      where('status', 'in', ['COMPLETED', 'completed'])
    );
    const ridesSnap = await getDocs(ridesQ);
    ridesCompleted = ridesSnap.size || 0;
  } catch (e) {
    console.warn('[getDriverEarnings] ridesCompleted query failed:', (e as any)?.message || e);
  }

  // Stripe balance via server helper - using driver-balance endpoint for accurate calculation
  // This endpoint properly accounts for negative pending (payouts in progress)
  let availableInstant = 0;
  try {
    const balanceUrl = `${base}/api/connect/driver-balance?userId=${encodeURIComponent(userId)}`;
    const rs = await authorizedFetch(balanceUrl);
    if (rs.ok) {
      const s = await rs.json();
      // The driver-balance endpoint returns availableBalance with proper negative pending handling
      if (typeof s?.availableBalance === 'number') {
        availableInstant = Number(s.availableBalance) || 0;
      }
    }
  } catch (e) {
    console.warn('[getDriverEarnings] driver-balance call failed:', (e as any)?.message || e);
  }

  // Pending not part of summary-only; set to 0 (could extend with regular vs pending balances later)
  return {
    available: Math.max(0, availableInstant),
    pending: 0,
    lifetime: Math.max(0, totalEarnings),
    lastPayoutAt: null,
  };
}

async function authorizedFetch(input: string, init: RequestInit = {}) {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User is not authenticated');
  }
  const token = await user.getIdToken();
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export type Payout = {
  id: string;
  type: string;
  method?: string;
  amount: number;
  date: string;
  status: string;
  arrivalDate?: string | null;
  currency?: string;
  description?: string;
  failure_code?: string;
  failure_message?: string;
  destination?: string;
};

export async function fetchPayouts(limit: number = 10): Promise<{ payouts: Payout[] }> {
  const base = getApiBaseUrl();
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new Error('User is not authenticated');
  }
  // Migrated to driver backend payout-history route
  const url = `${base}/api/connect/payout-history?userId=${encodeURIComponent(user.uid)}&limit=${limit}`;
  console.log('[fetchPayouts] Fetching from:', url);
  console.log('[fetchPayouts] User ID:', user.uid);
  
  try {
    const res = await authorizedFetch(url);
    console.log('[fetchPayouts] Response status:', res.status);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('[fetchPayouts] Error response:', errorText);
      throw new Error(`Failed to fetch payouts: ${res.status} ${errorText}`);
    }
    
    const result = await res.json();
    console.log('[fetchPayouts] Success:', result);
    return result;
  } catch (error) {
    console.error('[fetchPayouts] Request failed:', error);
    throw error;
  }
}

