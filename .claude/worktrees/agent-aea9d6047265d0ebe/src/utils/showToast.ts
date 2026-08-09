/**
 * Toast notification utility for RideAlong Driver App
 * Provides a simple interface for showing in-app toast notifications
 * Uses RideAlong brand colors
 */

import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { settingsService } from '../services/settingsService';

// RideAlong brand colors
const COLORS = {
  primary: '#E05E1A',
  navy: '#1A2942',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  white: '#F8FAFC',
  dark: '#0B1220',
};

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Trigger haptic feedback for notification
 * Only triggers if sound effects are enabled in settings
 */
const triggerNotificationFeedback = async (): Promise<void> => {
  try {
    const soundEnabled = await settingsService.isSoundEffectsEnabled();
    if (soundEnabled) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  } catch (error) {
    // Silently fail if haptics not supported
    console.log('Could not trigger haptic feedback:', error);
  }
};

/**
 * Show a toast notification
 * @param type - Type of toast (success, error, info, warning)
 * @param title - Title text for the toast
 * @param message - Optional message body
 * @param duration - Duration in milliseconds (default: 4000)
 */
export const showToast = (
  type: ToastType,
  title: string,
  message?: string,
  duration: number = 4000
): void => {
  // Trigger haptic feedback (respects sound effects setting)
  triggerNotificationFeedback();
  
  Toast.show({
    type,
    text1: title,
    text2: message,
    visibilityTime: duration,
    position: 'top',
    topOffset: 50,
  });
};

/**
 * Show a success toast
 */
export const showSuccessToast = (title: string, message?: string): void => {
  showToast('success', title, message);
};

/**
 * Show an error toast
 */
export const showErrorToast = (title: string, message?: string): void => {
  showToast('error', title, message);
};

/**
 * Show an info toast
 */
export const showInfoToast = (title: string, message?: string): void => {
  showToast('info', title, message);
};

/**
 * Show a warning toast
 */
export const showWarningToast = (title: string, message?: string): void => {
  showToast('warning', title, message);
};

/**
 * Custom toast configuration for RideAlong styling
 * Note: Pass this as the config prop to <Toast />
 */
export const toastConfig = {
  // You can customize the default toast components here if needed
  // For now, we'll use the default components with inline styling via the show() method
};

// Ride-specific toast helpers for drivers
export const rideToasts = {
  newRideRequest: (params: { from: string; to: string; riderName: string }) =>
    showInfoToast('New Ride Request!', `${params.riderName} requested your ride posting from ${params.from} to ${params.to}`),
  
  rideAccepted: () =>
    showSuccessToast('Ride Accepted!', 'You accepted the ride request'),
  
  rideRejected: () =>
    showInfoToast('Ride Rejected', 'The ride request has been declined'),
  
  rideConfirmed: (params: { from: string; to: string }) =>
    showSuccessToast('Ride Confirmed!', `From ${params.from} to ${params.to}`),
  
  rideStarted: (riderName: string) =>
    showInfoToast('Ride Started', `Journey with ${riderName} has begun`),
  
  rideCompleted: () =>
    showSuccessToast('Ride Completed!', 'Great job on completing the ride'),
  
  rideCancelled: (reason?: string) =>
    showWarningToast('Ride Cancelled', reason || 'The ride has been cancelled'),
  
  paymentReceived: (amount: string) =>
    showSuccessToast('Payment Received', `$${amount} has been added to your earnings`),
  
  arrivedAtPickup: () =>
    showInfoToast('Arrived at Pickup', 'Let the rider know you\'re here'),
  
  riderCancelled: (riderName: string) =>
    showWarningToast('Rider Cancelled', `${riderName} cancelled the ride`),
  
  connectionLost: () =>
    showErrorToast('Connection Lost', 'Trying to reconnect...'),
  
  backOnline: () =>
    showSuccessToast('Back Online', 'Connection restored'),
};
