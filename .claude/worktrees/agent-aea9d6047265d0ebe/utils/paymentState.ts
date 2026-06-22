export function isConfirmDisabled(params: { clientSecret: string | null; cardComplete: boolean; confirming: boolean; creating: boolean }) {
  const { clientSecret, cardComplete, confirming, creating } = params;
  return !clientSecret || !cardComplete || confirming || creating;
}
