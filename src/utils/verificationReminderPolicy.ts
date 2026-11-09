const DAY = 86_400_000;
type Profile = { isVerified?: boolean; verificationSubmittedAt?: unknown; lastVerificationId?: unknown; verificationStatus?: string };
const SUBMITTED = new Set(['approved', 'auto-approved', 'submitted', 'pending-review', 'manual-review', 'under-review', 'rejected', 'denied']);
export function shouldShowVerificationReminder(creationTime: string | undefined, profiles: Profile[], hasSubmission: boolean, now = Date.now()): boolean {
  const createdAt = creationTime ? Date.parse(creationTime) : NaN;
  return Number.isFinite(createdAt) && now - createdAt >= 11 * DAY && profiles.length > 0 && !hasSubmission
    && !profiles.some(p => p.isVerified === true || p.verificationSubmittedAt || p.lastVerificationId
      || SUBMITTED.has(String(p.verificationStatus || '').toLowerCase().replace(/_/g, '-')));
}
