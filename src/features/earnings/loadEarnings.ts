import type { getPayoutStatusByUserId as GetStatusByUser, getDriverEarnings as GetDriverEarnings } from '../../services/payouts';
import { doc, getDoc, type Firestore } from 'firebase/firestore';

export type LoadEarningsSummary = {
  available: number;
  pending: number;
  lifetime?: number | null;
  lastPayoutAt?: string | null;
};

export type LoadEarningsResult = {
  accountId: string | null;
  accountStatus: any;
  summary: LoadEarningsSummary;
};

type LoadEarningsDependencies = {
  firestoreInstance: Firestore;
  docFn: typeof doc;
  getDocFn: typeof getDoc;
  getEarningsSummaryFn: typeof GetDriverEarnings;
  getAccountStatusFn: typeof GetStatusByUser;
};

let cachedPayouts: typeof import('../../services/payouts') | null = null;

function getPayoutsModule() {
  if (!cachedPayouts) {
    cachedPayouts = require('../../services/payouts') as typeof import('../../services/payouts');
  }
  return cachedPayouts;
}

const defaultDeps: Omit<LoadEarningsDependencies, 'firestoreInstance'> = {
  docFn: doc,
  getDocFn: getDoc,
  getEarningsSummaryFn: (...args) => getPayoutsModule().getDriverEarnings(...(args as any)),
  getAccountStatusFn: (...args) => getPayoutsModule().getPayoutStatusByUserId(...(args as any)),
};

function getDefaultFirestore(): Firestore {
  const services = require('../../../constants/services') as typeof import('../../../constants/services');
  return services.firestore as Firestore;
}

export async function loadEarningsData(
  userId: string,
  existingAccountId?: string | null,
  overrides?: Partial<LoadEarningsDependencies>
): Promise<LoadEarningsResult> {
  const deps: LoadEarningsDependencies = {
    firestoreInstance: overrides?.firestoreInstance ?? getDefaultFirestore(),
    docFn: overrides?.docFn ?? defaultDeps.docFn,
    getDocFn: overrides?.getDocFn ?? defaultDeps.getDocFn,
    getEarningsSummaryFn: overrides?.getEarningsSummaryFn ?? defaultDeps.getEarningsSummaryFn,
    getAccountStatusFn: overrides?.getAccountStatusFn ?? defaultDeps.getAccountStatusFn,
  };

  let snapshot: Awaited<ReturnType<typeof getDoc>> | null = null;
  try {
    const userRef = deps.docFn(deps.firestoreInstance, 'drivers', userId);
    snapshot = await deps.getDocFn(userRef);
  } catch {
    snapshot = null;
  }

  const storedAccountId = snapshot?.exists()
    ? ((snapshot.data() as any)?.stripeAccountId as string | null) ?? null
    : null;

  const resolvedAccountId = storedAccountId ?? existingAccountId ?? null;

  const data = await deps.getEarningsSummaryFn(userId);

  let status: any = null;
  if (userId) {
    try {
      status = await deps.getAccountStatusFn(userId);
    } catch {
      status = null;
    }
  }

  return {
    accountId: resolvedAccountId,
    accountStatus: status,
    summary: {
      available: data?.available ?? 0,
      pending: data?.pending ?? 0,
      lifetime: data?.lifetime ?? 0,
      lastPayoutAt: data?.lastPayoutAt ?? null,
    },
  };
}
