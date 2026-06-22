/**
 * Student Verification Service
 * Handles verification status checks, Firestore listeners, and API calls
 */

import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { useVerificationStore } from '@/stores/verificationStore';
import { useAuthStore } from '@/stores/authStore';
import { Alert, ToastAndroid, Platform } from 'react-native';
import { router } from 'expo-router';

// Keep track of the unsubscribe function for the Firestore listener
let unsubscribeVerificationListener: (() => void) | null = null;

// Dynamic base URL for backend. Prefer EXPO_PUBLIC_API_URL (set via .env), fallback to Cloud Function.
// Convention: EXPO_PUBLIC_API_URL should NOT include trailing /api; we'll append it when needed.
const RAW_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://us-central1-ridealong-33528.cloudfunctions.net';

function normalizeBase(base: string) {
  return base.replace(/\/$/, '');
}

function buildApiUrl(path: string) {
  const base = normalizeBase(RAW_BASE);
  // Ensure single /api in constructed path
  const hasApi = /\/api$/.test(base);
  const root = hasApi ? base : base + '/api';
  const cleanedPath = path.startsWith('/') ? path : '/' + path;
  return root + cleanedPath;
}

/**
 * Show a toast notification (Android) or log (iOS)
 */
function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.LONG);
  } else {
    console.log('Toast:', message);
  }
}

/**
 * Fetch verification status from the API
 */
export async function fetchVerificationStatus(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    console.log('No user logged in, skipping verification check');
    return;
  }

  try {
    const token = await user.getIdToken();
    // Build endpoint off dynamic base; handles /api insertion if missing
    const endpoint = buildApiUrl('student-verifications/status');
    console.log('[Verification] Fetching status from', endpoint);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 404) {
      // API couldn't find the user (e.g. deployed backend not yet reading from 'riders').
      // Do NOT overwrite the store — the Firestore real-time listener (setupVerificationListener)
      // may have already set isVerified:true from the live document. Just reset banner dismissal.
      console.log('[Verification] 404 from API — deferring to Firestore listener for state');
      useVerificationStore.getState().resetBannerDismissal();
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API returned ${response.status} for ${endpoint} ${text ? '- ' + text.slice(0,120) : ''}`);
    }

    const data = await response.json();

    // Backend returns data in a nested 'user' object
    const userData = data.user || {};
    console.log('[fetchVerificationStatus] API response:', {
      isVerified: userData.isVerified,
      verificationStatus: userData.verificationStatus
    });

    // Treat auto-approved/approved as verified even if isVerified flag isn't set
    const status = userData.verificationStatus || null;
    const isVerified = userData.isVerified === true || status === 'auto-approved' || status === 'approved';

    // Never downgrade a verified state that the Firestore listener already established.
    // The Firestore listener fires faster than the network API call; if it already set
    // isVerified:true, don't overwrite that with a stale API result.
    const currentIsVerified = useVerificationStore.getState().isVerified;
    if (!isVerified && currentIsVerified) {
      console.log('[Verification] API says unverified but Firestore already confirmed verified — keeping verified state');
      useVerificationStore.getState().resetBannerDismissal();
      return;
    }

    useVerificationStore.getState().setVerificationData({
      isVerified,
      verificationStatus: status,
      blocked: userData.blocked || false,
      daysRemaining: userData.daysLeft ?? null,
      verificationDeadline: userData.deadline ? new Date(userData.deadline) : null,
    });

    // Reset banner dismissal when launching app
    useVerificationStore.getState().resetBannerDismissal();

  } catch (error) {
    console.error('Error fetching verification status:', error);
    // Don't throw - allow app to function with last known state
  }
}

/**
 * Set up real-time Firestore listener for verification status changes
 */
export function setupVerificationListener(): void {
  const user = firebaseAuth.currentUser;
  if (!user) {
    console.log('No user logged in, skipping verification listener setup');
    return;
  }

  // Clean up existing listener if any
  if (unsubscribeVerificationListener) {
    unsubscribeVerificationListener();
  }

  const activeRole = useAuthStore.getState().activeRole;
  const collection = activeRole === 'driver' ? 'drivers' : 'riders';
  const userDocRef = doc(firestore, collection, user.uid);
  
  let previousIsVerified: boolean | null = null;

  unsubscribeVerificationListener = onSnapshot(
    userDocRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        console.log('User document does not exist yet');
        return;
      }

      const data = snapshot.data();
      // For Firestore, we need to compute isVerified ourselves since we're reading raw data
      // Backend normalizes "auto-approved" to "approved", but Firestore has raw "auto-approved"
      const rawIsVerified = data?.isVerified || false;
      const verificationStatus = data?.verificationStatus || null;
      const isVerified = rawIsVerified || verificationStatus === 'auto-approved' || verificationStatus === 'approved';
      const verificationDeadline = data?.verificationDeadline;
      
      console.log('[setupVerificationListener] Firestore update:', { 
        rawIsVerified, 
        verificationStatus, 
        computedIsVerified: isVerified 
      });
      
      // Calculate deadline if it exists
      let deadlineDate: Date | null = null;
      let daysRemaining: number | null = null;
      
      if (verificationDeadline) {
        if (verificationDeadline instanceof Timestamp) {
          deadlineDate = verificationDeadline.toDate();
        } else if (typeof verificationDeadline === 'string') {
          deadlineDate = new Date(verificationDeadline);
        }
        
        if (deadlineDate) {
          const now = new Date();
          const diffTime = deadlineDate.getTime() - now.getTime();
          daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
      }

      // Update store
      useVerificationStore.getState().setVerificationData({
        isVerified,
        verificationStatus,
        verificationDeadline: deadlineDate,
        blocked: daysRemaining !== null && daysRemaining <= 0 && !isVerified,
        daysRemaining,
      });

      // Show success toast when verification changes from false to true
      if (previousIsVerified === false && isVerified === true) {
        showToast('✓ Your student status has been verified!');
      }

      previousIsVerified = isVerified;
    },
    (error) => {
      console.error('Error listening to verification status:', error);
    }
  );
}

/**
 * Clean up the Firestore listener
 */
export function cleanupVerificationListener(): void {
  if (unsubscribeVerificationListener) {
    unsubscribeVerificationListener();
    unsubscribeVerificationListener = null;
  }
}

/**
 * Check if user can request rides (verified or within grace period)
 * Returns true if allowed, false otherwise with an alert shown
 * Matches web app logic: 7-day grace period from account creation
 */
export function checkCanRequestRide(): boolean {
  const state = useVerificationStore.getState();
  
  // If isVerified is true, always allow (backend sets this for auto-approved/approved users)
  if (state.isVerified) {
    return true;
  }

  // If blocked (past deadline), show alert and prevent
  if (state.blocked) {
    Alert.alert(
      'Student Verification Required',
      'Your 7-day grace period has ended. Please verify your student status to continue requesting rides.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Verify Now',
          onPress: () => router.push('/(rider)/settings/student-verification' as any),
        },
      ]
    );
    return false;
  }

  // If not verified but still within grace period, allow without blocking
  // This matches the web app behavior where users get 7 days to verify
  return true;
}
