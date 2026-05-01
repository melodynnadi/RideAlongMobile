import { create } from 'zustand';

export interface VerificationState {
  isVerified: boolean;
  verificationStatus: 'pending' | 'approved' | 'rejected' | 'manual-review' | 'auto-approved' | null;
  verificationDeadline: Date | null;
  blocked: boolean;
  daysRemaining: number | null;
  bannerDismissed: boolean;
  lastChecked: Date | null;
  loading: boolean;

  setVerificationData: (data: {
    isVerified: boolean;
    verificationStatus?: 'pending' | 'approved' | 'rejected' | 'manual-review' | 'auto-approved' | null;
    verificationDeadline?: Date | null;
    blocked?: boolean;
    daysRemaining?: number | null;
  }) => void;
  setIsVerified: (isVerified: boolean) => void;
  setVerificationStatus: (status: 'pending' | 'approved' | 'rejected' | 'manual-review' | 'auto-approved' | null) => void;
  setVerificationDeadline: (deadline: Date | null) => void;
  dismissBanner: () => void;
  resetBannerDismissal: () => void;
  setLoading: (loading: boolean) => void;
  checkVerificationStatus: () => Promise<void>;
}

export const useVerificationStore = create<VerificationState>((set, get) => ({
  isVerified: false,
  verificationStatus: null,
  verificationDeadline: null,
  blocked: false,
  daysRemaining: null,
  bannerDismissed: false,
  lastChecked: null,
  loading: false,

  setVerificationData: (data) =>
    set({
      isVerified: data.isVerified,
      verificationStatus: data.verificationStatus ?? null,
      verificationDeadline: data.verificationDeadline ?? null,
      blocked: data.blocked ?? false,
      daysRemaining: data.daysRemaining ?? null,
      lastChecked: new Date(),
    }),

  setIsVerified: (isVerified) => set({ isVerified, lastChecked: new Date() }),
  setVerificationStatus: (verificationStatus) => set({ verificationStatus, lastChecked: new Date() }),
  setVerificationDeadline: (verificationDeadline) => set({ verificationDeadline, lastChecked: new Date() }),

  dismissBanner: () => set({ bannerDismissed: true }),
  resetBannerDismissal: () => set({ bannerDismissed: false }),
  setLoading: (loading) => set({ loading }),

  checkVerificationStatus: async () => {
    const state = get();
    if (state.verificationDeadline) {
      const now = new Date();
      const deadline = new Date(state.verificationDeadline);
      const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      set({
        daysRemaining: diffDays > 0 ? diffDays : 0,
        blocked: diffDays <= 0 && !state.isVerified,
      });
    }
  },
}));
