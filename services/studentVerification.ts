import { collection, doc, getDoc, getDocs, query, Timestamp, where } from 'firebase/firestore';

import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';

export type StudentDocumentType =
  | 'enrollment_letter'
  | 'class_schedule'
  | 'transcript'
  | 'portal_screenshot'
  | 'student_id';

export type VerificationStatus = 'none' | 'submitted' | 'pending' | 'approved' | 'auto-approved' | 'manual-review' | 'rejected';

export interface VerificationScores {
  name?: number;
  school?: number;
  term?: number;
  status?: number;
  aggregate?: number;
}

export interface VerificationSubmission {
  id: string;
  status: VerificationStatus;
  docType: StudentDocumentType;
  createdAt: Date | null;
  decisionReason: string | null;
  requiresManualReview: boolean;
  matchScores: VerificationScores | null;
  extractedFields?: {
    fullName?: string | null;
    schoolName?: string | null;
    currentTerm?: string | null;
    statusKeywords?: string[];
  } | null;
  fileName?: string | null;
  fileUrl?: string | null;
}

export interface StudentVerificationStatusResponse {
  user: {
    isVerified: boolean;
    verificationStatus: VerificationStatus;
    verificationFailureReason: string | null;
    deadline: string | null;
    daysLeft: number | null;
    pastDue: boolean;
    daysPastDue: number | null;
    blocked: boolean;
  };
  latestSubmission: VerificationSubmission | null;
}

export interface VerificationUploadFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
}

function normalizeStatus(value: unknown, isVerified = false): VerificationStatus {
  if (isVerified) return 'approved';
  const status = String(value || '').toLowerCase();
  if (status === 'verified') return 'approved';
  return ['none', 'submitted', 'pending', 'approved', 'auto-approved', 'manual-review', 'rejected'].includes(status)
    ? status as VerificationStatus
    : 'none';
}

async function getFirestoreVerificationUser() {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Please sign in before verifying your student status.');

  const [riderSnap, driverSnap] = await Promise.all([
    getDoc(doc(firestore, 'riders', user.uid)),
    getDoc(doc(firestore, 'drivers', user.uid)),
  ]);
  const profiles = [riderSnap, driverSnap]
    .filter((snapshot) => snapshot.exists())
    .map((snapshot) => snapshot.data());
  if (!profiles.length) throw new Error('Your RideAlong profile could not be found.');

  const verifiedProfile = profiles.find((profile) =>
    profile.isVerified === true
    || ['approved', 'auto-approved', 'verified'].includes(String(profile.verificationStatus || '').toLowerCase()),
  );
  const profile = verifiedProfile || profiles.find((item) => item.verificationStatus) || profiles[0];
  const isVerified = Boolean(verifiedProfile);
  const deadlineDate = toDate(profile.verificationDeadline);
  const daysLeft = deadlineDate ? Math.ceil((deadlineDate.getTime() - Date.now()) / 86_400_000) : null;

  return {
    isVerified,
    verificationStatus: normalizeStatus(profile.verificationStatus, isVerified),
    verificationFailureReason: profile.verificationFailureReason || null,
    deadline: deadlineDate?.toISOString() || null,
    daysLeft,
    pastDue: daysLeft !== null && daysLeft < 0,
    daysPastDue: daysLeft !== null && daysLeft < 0 ? Math.abs(daysLeft) : null,
    blocked: daysLeft !== null && daysLeft < 0 && !isVerified,
  };
}

function apiUrl(path: string) {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const root = /\/api$/.test(base) ? base : `${base}/api`;
  return `${root}/${path.replace(/^\//, '')}`;
}

async function authToken(forceRefresh = false) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Please sign in before verifying your student status.');
  return user.getIdToken(forceRefresh);
}

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Student verification request failed.');
  return payload;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function mapVerificationSubmission(id: string, data: any): VerificationSubmission {
  return {
    id,
    status: normalizeStatus(data.status || data.verificationStatus || data.resolution || 'submitted'),
    docType: (data.docType || data.documentType || data.type || 'student_id') as StudentDocumentType,
    createdAt: toDate(data.createdAt || data.submittedAt || data.reviewedAt || data.updatedAt || data.verificationSubmittedAt || data.verificationApprovedAt),
    decisionReason: data.decisionReason || data.rejectionReason || data.reason || data.verificationFailureReason || null,
    requiresManualReview: Boolean(data.requiresManualReview || data.resolution === 'pending'),
    matchScores: data.matchScores || data.ocrScores || null,
    extractedFields: data.extractedFields || null,
    fileName: data.fileName || data.documentName || null,
    fileUrl: data.fileUrl || data.documentUrl || null,
  };
}

export async function getStudentVerificationStatus(): Promise<StudentVerificationStatusResponse> {
  const [firestoreUser, apiPayload] = await Promise.all([
    getFirestoreVerificationUser(),
    authToken()
      .then((token) => fetch(apiUrl('student-verifications/status'), {
        headers: { Authorization: `Bearer ${token}` },
      }))
      .then(parseResponse)
      .catch(() => null),
  ]);
  const apiUser = apiPayload?.user || {};
  const isVerified = firestoreUser.isVerified
    || apiUser.isVerified === true
    || ['approved', 'auto-approved'].includes(apiUser.verificationStatus);
  const latestSubmission = apiPayload?.latestSubmission;

  return {
    user: {
      ...firestoreUser,
      ...apiUser,
      isVerified,
      verificationStatus: normalizeStatus(
        isVerified ? 'approved' : apiUser.verificationStatus || firestoreUser.verificationStatus,
        isVerified,
      ),
    },
    latestSubmission: latestSubmission
      ? { ...latestSubmission, createdAt: toDate(latestSubmission.createdAt) }
      : null,
  };
}

export async function submitStudentVerification(docType: StudentDocumentType, file: VerificationUploadFile) {
  const token = await authToken(true);
  const form = new FormData();
  form.append('docType', docType);
  form.append('document', { uri: file.uri, name: file.name, type: file.mimeType } as any);

  const response = await fetch(apiUrl('student-verifications'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return parseResponse(response) as Promise<{
    ok: true;
    status: VerificationStatus;
    verificationId: string;
    decisionReason: string;
    deadline: string | null;
  }>;
}

export async function getStudentVerificationHistory(): Promise<VerificationSubmission[]> {
  const user = firebaseAuth.currentUser;
  if (!user) return [];

  const [riderSnap, driverSnap, userSnap] = await Promise.all([
    getDoc(doc(firestore, 'riders', user.uid)).catch(() => null),
    getDoc(doc(firestore, 'drivers', user.uid)).catch(() => null),
    getDoc(doc(firestore, 'users', user.uid)).catch(() => null),
  ]);
  const profiles = [riderSnap, driverSnap, userSnap]
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot?.exists()))
    .map((snapshot) => snapshot.data() || {});

  const byId = new Map<string, VerificationSubmission>();
  const addSubmission = (id: string, data: any) => {
    if (!id || byId.has(id)) return;
    byId.set(id, mapVerificationSubmission(id, data || {}));
  };

  const directIds = Array.from(new Set(profiles
    .flatMap((profile) => [
      profile.lastVerificationId,
      profile.studentVerificationId,
      profile.verificationId,
      profile.latestVerificationId,
    ])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));

  await Promise.all(directIds.map(async (id) => {
    const snap = await getDoc(doc(firestore, 'studentVerifications', id)).catch(() => null);
    if (snap?.exists()) addSubmission(snap.id, snap.data());
  }));

  const emails = Array.from(new Set([
    user.email,
    ...profiles.flatMap((profile) => [profile.email, profile.schoolEmail]),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
  const queryPairs: [string, string][] = [
    ['userId', user.uid],
    ['uid', user.uid],
    ['userUid', user.uid],
    ['riderId', user.uid],
    ['driverId', user.uid],
    ...emails.flatMap((email) => [
      ['email', email] as [string, string],
      ['userEmail', email] as [string, string],
    ]),
  ];

  const snapshots = await Promise.all(queryPairs.map(([field, value]) =>
    getDocs(query(collection(firestore, 'studentVerifications'), where(field, '==', value))).catch(() => null),
  ));
  snapshots.forEach((snapshot) => {
    snapshot?.docs.forEach((item) => addSubmission(item.id, item.data()));
  });

  return Array.from(byId.values())
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0))
    .slice(0, 5);
}
