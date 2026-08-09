import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp } from '@/constants/services';

// Initialize Functions in the specified region
export const functions = getFunctions(firebaseApp, 'us-central1');

// Callable for ride status updates
export const updateRideStatus = httpsCallable<
  { rideId: string; action: 'driver_pickup' | 'driver_complete' },
  { ok: boolean }
>(functions, 'updateRideStatus');

// Callable for submitting ratings
export const submitRating = httpsCallable<
  { rideId: string; stars: number; comment?: string },
  { ok: boolean }
>(functions, 'submitRating');
