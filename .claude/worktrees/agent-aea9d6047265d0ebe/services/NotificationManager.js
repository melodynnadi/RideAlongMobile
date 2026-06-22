/**
 * NotificationManager.js - Driver App
 * 
 * Central notification manager for the RideAlong Driver app.
 * Handles push notifications, in-app notifications, and Firestore listeners.
 * 
 * Features:
 * - Firebase Cloud Messaging (FCM) setup
 * - Real-time Firestore notification listeners
 * - Unread notification badge counts
 * - Notification click handling with deep linking
 * - Driver-specific notification channels and sounds
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { getFirestore, collection, query, where, onSnapshot, orderBy, updateDoc, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configure how notifications are displayed when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

class NotificationManager {
  constructor() {
    this.db = getFirestore();
    this.auth = getAuth();
    this.listeners = [];
    this.unsubscribes = [];
    this.unreadCount = 0;
    this.notificationCallbacks = [];
    this.expoPushToken = null;
  }

  /**
   * Initialize the notification system
   * Call this after driver authentication
   */
  async initialize() {
    try {
      console.log('[NotificationManager] Initializing driver notifications...');
      
      // Request notification permissions
      await this.requestPermissions();
      
      // Register for push notifications
      await this.registerForPushNotifications();
      
      // Set up notification listeners
      this.setupNotificationListeners();
      
      // Listen to Firestore notifications collection
      this.startFirestoreListener();
      
      console.log('[NotificationManager] Driver notifications initialized successfully');
    } catch (error) {
      console.error('[NotificationManager] Initialization error:', error);
    }
  }

  /**
   * Request notification permissions from the user
   */
  async requestPermissions() {
    try {
      if (!Device.isDevice) {
        console.warn('[NotificationManager] Push notifications require physical device');
        return false;
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('[NotificationManager] Notification permissions not granted');
        return false;
      }

      console.log('[NotificationManager] Notification permissions granted');
      return true;
    } catch (error) {
      console.error('[NotificationManager] Permission request error:', error);
      return false;
    }
  }

  /**
   * Register for push notifications and get Expo push token
   */
  async registerForPushNotifications() {
    try {
      if (!Device.isDevice) {
        console.warn('[NotificationManager] Push tokens require physical device');
        return null;
      }

      // Get Expo push token
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId,
      });

      this.expoPushToken = token.data;
      console.log('[NotificationManager] Driver Expo Push Token:', this.expoPushToken);

      // Save token to driver profile in Firestore
      await this.saveTokenToFirestore(this.expoPushToken);

      // Configure Android notification channels (driver-specific)
      if (Platform.OS === 'android') {
        // High priority channel for ride requests
        await Notifications.setNotificationChannelAsync('ride-requests', {
          name: 'Ride Requests',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'ride_request.wav', // Custom sound for new requests
          vibrationPattern: [0, 500, 250, 500],
          lightColor: '#E05E1A',
          enableVibrate: true,
          enableLights: true,
        });

        // Ride status updates
        await Notifications.setNotificationChannelAsync('ride-status', {
          name: 'Ride Status Updates',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
          vibrationPattern: [0, 250, 250, 250],
        });

        // Earnings and payouts
        await Notifications.setNotificationChannelAsync('earnings', {
          name: 'Earnings & Payouts',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
        });

        // Default channel
        await Notifications.setNotificationChannelAsync('default', {
          name: 'General Notifications',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#E05E1A',
        });
      }

      return this.expoPushToken;
    } catch (error) {
      console.error('[NotificationManager] Push registration error:', error);
      return null;
    }
  }

  /**
   * Save push token to Firestore driver profile
   */
  async saveTokenToFirestore(token) {
    try {
      const user = this.auth.currentUser;
      if (!user || !token) return;

      const driverRef = doc(this.db, 'drivers', user.uid);
      
      // Store token with device info for multi-device support
      const tokenData = {
        expoPushToken: token,
        pushTokens: [
          {
            token,
            platform: Platform.OS,
            deviceName: Device.deviceName || 'Unknown Device',
            updatedAt: new Date().toISOString(),
          }
        ],
        notificationsEnabled: true,
      };

      await updateDoc(driverRef, tokenData);
      console.log('[NotificationManager] Driver token saved to Firestore');
    } catch (error) {
      console.error('[NotificationManager] Error saving token:', error);
    }
  }

  /**
   * Set up notification event listeners
   */
  setupNotificationListeners() {
    // Listen for notifications received while app is foregrounded
    this.listeners.push(
      Notifications.addNotificationReceivedListener((notification) => {
        console.log('[NotificationManager] Notification received:', notification);
        this.handleNotificationReceived(notification);
      })
    );

    // Listen for notification taps/clicks
    this.listeners.push(
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log('[NotificationManager] Notification tapped:', response);
        this.handleNotificationTapped(response);
      })
    );
  }

  /**
   * Handle notification received while app is in foreground
   */
  handleNotificationReceived(notification) {
    const { title, body, data } = notification.request.content;
    
    // Update unread count
    this.incrementUnreadCount();
    
    // Trigger callbacks for UI updates
    this.triggerNotificationCallbacks({
      type: 'received',
      notification,
      data,
    });
  }

  /**
   * Handle notification tap/click
   */
  handleNotificationTapped(response) {
    const { data } = response.notification.request.content;
    
    console.log('[NotificationManager] Handling tap with data:', data);
    
    // Trigger callbacks for navigation
    this.triggerNotificationCallbacks({
      type: 'tapped',
      response,
      data,
    });

    // Handle deep linking based on actionType
    this.handleDeepLink(data);
  }

  /**
   * Handle deep linking from notification - Driver specific routes
   */
  handleDeepLink(data) {
    if (!data || !data.actionType) return;

    const { actionType, actionData } = data;

    // Driver-specific deep link mapping
    const deepLinkMap = {
      view_dashboard: { screen: 'DriverDashboard' },
      view_my_rides: { screen: 'MyRides' },
      view_requests: { screen: 'RideRequests', params: actionData },
      view_ride_details: { screen: 'RideDetails', params: actionData },
      view_earnings: { screen: 'Earnings' },
      update_bank: { screen: 'BankAccountSettings' },
      view_payouts: { screen: 'PayoutSettings' },
      rate_riders: { screen: 'RateRiders', params: actionData },
      view_profile: { screen: 'DriverProfile' },
      view_tips: { screen: 'DrivingTips' },
      view_stats: { screen: 'Statistics' },
      track_ride: { screen: 'ActiveRide', params: actionData },
      reapply: { screen: 'DriverApplication' },
    };

    const deepLink = deepLinkMap[actionType];
    if (deepLink) {
      // Store deep link for navigation handling
      AsyncStorage.setItem('pendingDeepLink', JSON.stringify(deepLink));
      
      // Trigger navigation callback
      this.triggerNotificationCallbacks({
        type: 'deepLink',
        deepLink,
      });
    }
  }

  /**
   * Start listening to Firestore notifications collection
   */
  startFirestoreListener() {
    const user = this.auth.currentUser;
    if (!user) {
      console.warn('[NotificationManager] No authenticated driver for Firestore listener');
      return;
    }

    try {
      // Query for driver's notifications, ordered by timestamp
      const notificationsRef = collection(this.db, 'notifications');
      const q = query(
        notificationsRef,
        where('recipientId', '==', user.uid),
        orderBy('timestamp', 'desc')
      );

      // Set up real-time listener
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          console.log('[NotificationManager] Firestore update:', snapshot.size, 'notifications');
          
          const notifications = [];
          let unreadCount = 0;

          snapshot.forEach((doc) => {
            const notification = {
              id: doc.id,
              ...doc.data(),
            };
            notifications.push(notification);
            
            if (notification.unread) {
              unreadCount++;
            }
          });

          // Update unread count
          this.unreadCount = unreadCount;
          
          // Trigger callbacks with new data
          this.triggerNotificationCallbacks({
            type: 'firestoreUpdate',
            notifications,
            unreadCount,
          });
        },
        (error) => {
          console.error('[NotificationManager] Firestore listener error:', error);
        }
      );

      this.unsubscribes.push(unsubscribe);
      console.log('[NotificationManager] Firestore listener started for driver');
    } catch (error) {
      console.error('[NotificationManager] Error starting Firestore listener:', error);
    }
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId) {
    try {
      const notificationRef = doc(this.db, 'notifications', notificationId);
      await updateDoc(notificationRef, {
        unread: false,
        readAt: new Date().toISOString(),
      });
      
      console.log('[NotificationManager] Notification marked as read:', notificationId);
      
      // Decrement unread count locally
      this.decrementUnreadCount();
    } catch (error) {
      console.error('[NotificationManager] Error marking notification as read:', error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead() {
    try {
      const user = this.auth.currentUser;
      if (!user) return;

      const notificationsRef = collection(this.db, 'notifications');
      const q = query(
        notificationsRef,
        where('recipientId', '==', user.uid),
        where('unread', '==', true)
      );

      const snapshot = await getDocs(q);
      const batch = writeBatch(this.db);

      snapshot.forEach((doc) => {
        batch.update(doc.ref, {
          unread: false,
          readAt: new Date().toISOString(),
        });
      });

      await batch.commit();
      
      console.log('[NotificationManager] All driver notifications marked as read');
      
      this.unreadCount = 0;
      this.triggerNotificationCallbacks({
        type: 'allRead',
        unreadCount: 0,
      });
    } catch (error) {
      console.error('[NotificationManager] Error marking all as read:', error);
    }
  }

  /**
   * Get unread notification count
   */
  getUnreadCount() {
    return this.unreadCount;
  }

  /**
   * Increment unread count
   */
  incrementUnreadCount() {
    this.unreadCount++;
    this.updateBadgeCount();
  }

  /**
   * Decrement unread count
   */
  decrementUnreadCount() {
    this.unreadCount = Math.max(0, this.unreadCount - 1);
    this.updateBadgeCount();
  }

  /**
   * Update app badge count
   */
  async updateBadgeCount() {
    try {
      await Notifications.setBadgeCountAsync(this.unreadCount);
    } catch (error) {
      console.error('[NotificationManager] Error updating badge count:', error);
    }
  }

  /**
   * Register a callback for notification events
   */
  onNotificationEvent(callback) {
    this.notificationCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      this.notificationCallbacks = this.notificationCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Trigger all registered callbacks
   */
  triggerNotificationCallbacks(event) {
    this.notificationCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error('[NotificationManager] Callback error:', error);
      }
    });
  }

  /**
   * Clean up listeners
   */
  cleanup() {
    console.log('[NotificationManager] Cleaning up driver notifications...');
    
    // Remove notification listeners
    this.listeners.forEach((listener) => {
      listener.remove();
    });
    this.listeners = [];
    
    // Unsubscribe from Firestore listeners
    this.unsubscribes.forEach((unsubscribe) => {
      unsubscribe();
    });
    this.unsubscribes = [];
    
    // Clear callbacks
    this.notificationCallbacks = [];
    
    console.log('[NotificationManager] Cleanup complete');
  }

  /**
   * Send a local notification (for testing or in-app events)
   */
  async sendLocalNotification(title, body, data = {}, channelId = 'default') {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: channelId === 'ride-requests' ? 'ride_request.wav' : true,
          priority: Notifications.AndroidNotificationPriority.HIGH,
          categoryIdentifier: channelId,
        },
        trigger: null, // null means show immediately
      });
    } catch (error) {
      console.error('[NotificationManager] Error sending local notification:', error);
    }
  }

  /**
   * Schedule a notification for later
   */
  async scheduleNotification(title, body, triggerDate, data = {}) {
    try {
      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: true,
        },
        trigger: {
          date: triggerDate,
        },
      });
      
      console.log('[NotificationManager] Notification scheduled:', identifier);
      return identifier;
    } catch (error) {
      console.error('[NotificationManager] Error scheduling notification:', error);
      return null;
    }
  }

  /**
   * Cancel a scheduled notification
   */
  async cancelScheduledNotification(identifier) {
    try {
      await Notifications.cancelScheduledNotificationAsync(identifier);
      console.log('[NotificationManager] Notification canceled:', identifier);
    } catch (error) {
      console.error('[NotificationManager] Error canceling notification:', error);
    }
  }

  /**
   * Cancel all scheduled notifications
   */
  async cancelAllScheduledNotifications() {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      console.log('[NotificationManager] All scheduled notifications canceled');
    } catch (error) {
      console.error('[NotificationManager] Error canceling all notifications:', error);
    }
  }
}

// Export singleton instance
export default new NotificationManager();
