/**
 * Notification Service for RideAlong Driver App
 * Handles push notifications using Expo Notifications
 * Manages registration, permissions, and notification handlers
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, AppState } from 'react-native';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { showToast, rideToasts } from '../utils/showToast';
import { buildToastKey, shouldShowToastEvent } from '../utils/toastDeduper';
import { settingsService } from './settingsService';
import { useAuthStore } from '@/stores/authStore';

// ============================================================================
// NOTIFICATION DEDUPLICATION
// ============================================================================
// Store recent notifications to prevent duplicates within a time window
const recentNotifications = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000; // 5 seconds

// Clean up old notification entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentNotifications.entries()) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      recentNotifications.delete(key);
    }
  }
}, 10000); // Clean up every 10 seconds

/**
 * Generate a unique key for a notification to detect duplicates
 */
function generateNotificationKey(notification: Notifications.Notification): string {
  const { title, body, data } = notification.request.content;
  const notificationData = data as any;
  const type = notificationData?.type || '';
  const rideId = notificationData?.rideId || notificationData?.confirmedRideId || '';
  const riderId = notificationData?.riderId || '';
  
  // Create key from multiple fields to ensure uniqueness
  return `${type}_${rideId}_${riderId}_${title}`;
}

/**
 * Check if a notification is a duplicate
 */
function isDuplicateNotification(notification: Notifications.Notification): boolean {
  const key = generateNotificationKey(notification);
  const now = Date.now();
  const lastSeen = recentNotifications.get(key);
  
  if (lastSeen && (now - lastSeen) < DEDUP_WINDOW_MS) {
    console.log(`[notification] 🚫 Blocking duplicate: ${key}`);
    return true;
  }
  
  // Mark this notification as seen
  recentNotifications.set(key, now);
  return false;
}

// ============================================================================
// NOTIFICATION HANDLER CONFIGURATION
// ============================================================================
// Configure how notifications are displayed when app is in foreground
// This will be dynamically updated based on user settings
const updateNotificationHandler = async () => {
  const pushEnabled = await settingsService.isPushNotificationsEnabled();
  
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // Check for duplicates FIRST before showing anything
      if (isDuplicateNotification(notification)) {
        return {
          shouldShowAlert: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
          // @ts-ignore
          shouldShowBanner: false,
          // @ts-ignore
          shouldShowList: false,
        };
      }

      // Not a duplicate - show based on user settings
      return {
        shouldShowAlert: pushEnabled, // Show push notifications only if enabled
        shouldPlaySound: false, // We handle sound through toast haptics
        shouldSetBadge: true,
        // Newer expo-notifications may require these fields
        // @ts-ignore
        shouldShowBanner: pushEnabled,
        // @ts-ignore
        shouldShowList: pushEnabled,
      };
    },
  });
};

// Initialize with default handler
updateNotificationHandler();

export interface NotificationData {
  type?: string;
  rideId?: string;
  riderId?: string;
  riderName?: string;
  pickup?: string;
  dropoff?: string;
  earnings?: string;
  amount?: string;
  reason?: string;
  [key: string]: any;
}

export interface PushNotificationToken {
  token: string;
  type: 'expo' | 'apns' | 'fcm';
}

class NotificationService {
  private notificationListener: any = null;
  private responseListener: any = null;
  private expoPushToken: string | null = null;
  private onNotificationReceived: ((data: NotificationData) => void) | null = null;
  private onNotificationTapped: ((data: NotificationData) => void) | null = null;

  /**
   * Update notification handler based on current settings
   * Call this when push notification settings change
   */
  async updateNotificationHandler(): Promise<void> {
    await updateNotificationHandler();
  }

  /**
   * Register device for push notifications and get Expo push token
   * @returns Push token object or null if registration failed
   */
  async registerForPushNotifications(): Promise<PushNotificationToken | null> {
    try {
      // Check if push notifications are enabled in settings
      const pushEnabled = await settingsService.isPushNotificationsEnabled();
      if (!pushEnabled) {
        console.log('Push notifications are disabled in settings');
        return null;
      }

      // Only works on physical devices
      if (!Device.isDevice) {
        console.warn('Push notifications only work on physical devices');
        showToast('warning', 'Notifications Unavailable', 'Push notifications require a physical device');
        return null;
      }

      // Request notification permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('Failed to get push notification permissions');
        showToast('warning', 'Notifications Disabled', 'Please enable notifications in settings');
        return null;
      }

      // Get Expo push token
      // Note: For development, projectId is optional. For production, configure in app.json
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      
      let token;
      try {
        if (projectId) {
          token = await Notifications.getExpoPushTokenAsync({ projectId });
        } else {
          // Development mode - use default project ID
          console.log('No EAS projectId found, using development mode');
          token = await Notifications.getExpoPushTokenAsync();
        }
      } catch (error: any) {
        if (error.message?.includes('projectId')) {
          console.warn('Push notifications require EAS project configuration for production use');
          console.warn('For development, you can test with local notifications');
          return null;
        }
        throw error;
      }

      this.expoPushToken = token.data;
      console.log('Expo Push Token:', token.data);

      // Configure notification channel for Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#E05E1A',
          sound: 'default',
        });

        // Create ride-specific channel
        await Notifications.setNotificationChannelAsync('rides', {
          name: 'Ride Requests',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#E05E1A',
          sound: 'default',
          description: 'Notifications about ride requests and updates',
        });

        // Create earnings channel
        await Notifications.setNotificationChannelAsync('earnings', {
          name: 'Earnings',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 250],
          lightColor: '#10B981',
          sound: 'default',
          description: 'Notifications about your earnings',
        });
      }

      return {
        token: token.data,
        type: 'expo',
      };
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      showToast('error', 'Notification Setup Failed', 'Could not register for notifications');
      return null;
    }
  }

  /**
   * Set up notification listeners for foreground and background
   * @param onReceived - Callback when notification is received (foreground)
   * @param onTapped - Callback when notification is tapped
   */
  setupNotificationListeners(
    onReceived?: (data: NotificationData) => void,
    onTapped?: (data: NotificationData) => void
  ): void {
    this.onNotificationReceived = onReceived || null;
    this.onNotificationTapped = onTapped || null;

    // Handle notifications received while app is in foreground
    this.notificationListener = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('Notification received in foreground:', notification);
        const data = notification.request.content.data as NotificationData;
        
        // Show toast for foreground notifications
        this.handleForegroundNotification(notification);

        // Call custom callback if provided
        if (this.onNotificationReceived) {
          this.onNotificationReceived(data);
        }
      }
    );

    // Handle notification tap (when user taps notification)
    this.responseListener = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log('Notification tapped:', response);
        const data = response.notification.request.content.data as NotificationData;
        
        // Handle navigation based on notification type
        this.handleNotificationTap(data);

        // Call custom callback if provided
        if (this.onNotificationTapped) {
          this.onNotificationTapped(data);
        }
      }
    );
  }

  /**
   * Handle notifications received in foreground - show as toast
   */
  private handleForegroundNotification(notification: Notifications.Notification): void {
    const { title, body, data } = notification.request.content;
    const notificationData = data as NotificationData;

    // Build a dedupe key and suppress if recently shown (avoids double toasts from Firestore + push)
    const key = buildToastKey(notificationData.type, notificationData.rideId || null, [
      // include locations to reduce accidental collisions across different rides/events
      typeof notificationData.pickup === 'string' ? notificationData.pickup : undefined,
      typeof notificationData.dropoff === 'string' ? notificationData.dropoff : undefined,
    ]);
    if (!shouldShowToastEvent(key)) return;

    // Helpers to resolve pickup/dropoff strings from various shapes
    const resolveAddr = (obj: any): string | undefined => {
      try {
        if (!obj) return undefined;
        if (typeof obj === 'string') return obj;
        return obj.address || obj.formatted || obj.label || obj.name || undefined;
      } catch { return undefined; }
    };
    const from = notificationData.pickupAddress
      || resolveAddr((notificationData as any).pickup)
      || (typeof notificationData.pickup === 'string' ? notificationData.pickup : undefined)
      || 'Pickup location';
    const to = notificationData.dropoffAddress
      || resolveAddr((notificationData as any).dropoff)
      || (typeof notificationData.dropoff === 'string' ? notificationData.dropoff : undefined)
      || 'Dropoff location';

    // Map notification types to appropriate toast types
    switch (notificationData.type) {
      case 'new_ride_request':
        rideToasts.newRideRequest({
          riderName: notificationData.riderName || 'A rider',
          from,
          to,
        });
        break;
      case 'ride_accepted':
        rideToasts.rideAccepted();
        break;
      case 'ride_started':
        rideToasts.rideStarted(notificationData.riderName || 'Rider');
        break;
      case 'ride_completed':
        rideToasts.rideCompleted();
        break;
      case 'ride_cancelled':
        rideToasts.rideCancelled(notificationData.reason);
        break;
      case 'rider_cancelled':
        rideToasts.riderCancelled(notificationData.riderName || 'Rider');
        break;
      case 'payment_received':
        rideToasts.paymentReceived(notificationData.amount || '0.00');
        break;
      // Backend sends 'ride_status_change' with a status sub-field
      case 'ride_status_change': {
        const status = String(notificationData.status || '').toUpperCase();
        if (status === 'IN_PROGRESS') rideToasts.rideStarted('');
        else if (status === 'COMPLETED') rideToasts.rideCompleted();
        else showToast('info', title || 'Ride update', body || undefined);
        break;
      }
      case 'new_message':
        showToast('info', title || 'New message', body || undefined);
        break;
      default:
        showToast('info', title || 'Notification', body || undefined);
    }
  }

  /**
   * Handle notification tap - navigate to appropriate screen
   */
  handleNotificationTap(data: NotificationData): void {
    const activeRole = useAuthStore.getState().activeRole;
    const isDriver = activeRole === 'driver';

    try {
      switch (data.type) {
        case 'new_ride_request':
          router.replace(isDriver ? '/(driver)' : '/(rider)');
          break;

        case 'ride_accepted':
        case 'ride_started':
        case 'ride_status_change':
          router.replace(isDriver ? '/(driver)' : '/(rider)');
          break;

        case 'ride_completed':
          router.replace(isDriver ? '/(driver)/earnings' : '/(rider)');
          break;

        case 'ride_cancelled':
        case 'rider_cancelled':
          router.replace(isDriver ? '/(driver)' : '/(rider)');
          break;

        case 'payment_received':
          router.replace('/(driver)/earnings');
          break;

        case 'new_message': {
          const chatId = (data as any).chatId;
          if (chatId) {
            router.replace(isDriver
              ? { pathname: '/(driver)/messages/[chatId]', params: { chatId } } as any
              : { pathname: '/(rider)/messages/[chatId]', params: { chatId } } as any
            );
          } else {
            router.replace(isDriver ? '/(driver)/messages' : '/(rider)/messages');
          }
          break;
        }

        default:
          router.replace(isDriver ? '/(driver)' : '/(rider)');
      }
    } catch (e) {
      console.warn('[handleNotificationTap] Navigation error:', e);
    }
  }

  /**
   * Get the current Expo push token
   */
  getExpoPushToken(): string | null {
    return this.expoPushToken;
  }

  /**
   * Save push token to backend
   * @param userId - User ID to associate with the token
   * @param token - Push token to save
   */
  async savePushTokenToBackend(userId: string, token: string): Promise<boolean> {
    try {
      const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4001';
      
      const response = await fetch(`${API_URL}/api/drivers/${userId}/push-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          platform: Platform.OS,
          deviceId: Constants.deviceId,
        }),
      });

      if (!response.ok) {
        console.warn('Backend endpoint not available for push token storage');
        console.log('Push token (save this for testing):', token);
        return false;
      }

      console.log('Push token saved to backend successfully');
      return true;
    } catch (error) {
      console.warn('Backend not available - push token not saved (this is normal in development)');
      console.log('Push token (save this for testing):', token);
      return false;
    }
  }

  /**
   * Clean up notification listeners
   */
  cleanup(): void {
    if (this.notificationListener) {
      this.notificationListener.remove();
      this.notificationListener = null;
    }
    if (this.responseListener) {
      this.responseListener.remove();
      this.responseListener = null;
    }
  }

  /**
   * Schedule a local notification (for testing)
   */
  async scheduleLocalNotification(
    title: string,
    body: string,
    data?: NotificationData,
    seconds: number = 2
  ): Promise<string> {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
  }

  /**
   * Cancel all scheduled notifications
   */
  async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  /**
   * Get notification permissions status
   */
  async getPermissionStatus(): Promise<Notifications.NotificationPermissionsStatus> {
    return await Notifications.getPermissionsAsync();
  }

  /**
   * Request notification permissions
   */
  async requestPermissions(): Promise<Notifications.NotificationPermissionsStatus> {
    return await Notifications.requestPermissionsAsync();
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

// Export notification types for use in other parts of the app
export const NotificationTypes = {
  NEW_RIDE_REQUEST: 'new_ride_request',
  RIDE_ACCEPTED: 'ride_accepted',
  RIDE_STARTED: 'ride_started',
  RIDE_COMPLETED: 'ride_completed',
  RIDE_CANCELLED: 'ride_cancelled',
  RIDER_CANCELLED: 'rider_cancelled',
  PAYMENT_RECEIVED: 'payment_received',
} as const;
