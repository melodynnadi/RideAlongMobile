// RideAlong Mobile - Messaging Service for FCM Push Notifications
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { firestore, firebaseAuth } from '@/constants/services';
import { useAuthStore } from '@/stores/authStore';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and save FCM token to Firestore
 */
export async function registerForPushNotifications() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E05E1A',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push notification permissions');
      return;
    }

    // Get Expo push token
    token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log('Expo Push Token:', token);

    // Save token to Firestore
    await saveFCMToken(token);
  } else {
    console.log('Must use physical device for push notifications');
  }

  return token;
}

/**
 * Save FCM token to user's Firestore document
 */
async function saveFCMToken(token: string) {
  if (!firebaseAuth.currentUser) return;

  try {
    // Determine user collection (driver or rider)
    let userCollection = 'users';

    // Check if user is a driver
    const driverDocRef = doc(firestore, 'drivers', firebaseAuth.currentUser.uid);
    try {
      await updateDoc(driverDocRef, {
        fcmToken: token,
        fcmTokenUpdatedAt: new Date(),
      });
      console.log('FCM token saved to drivers collection');
      return;
    } catch (error) {
      // Not a driver, try users collection
    }

    // Save to role-specific collection
    const activeRole = useAuthStore.getState().activeRole;
    const collection = activeRole === 'driver' ? 'drivers' : 'riders';
    const userDocRef = doc(firestore, collection, firebaseAuth.currentUser.uid);
    await updateDoc(userDocRef, {
      fcmToken: token,
      fcmTokenUpdatedAt: new Date(),
    });
    console.log(`FCM token saved to ${collection} collection`);
  } catch (error) {
    console.error('Error saving FCM token:', error);
  }
}

/**
 * Listen for notification responses (when user taps notification)
 */
export function setupNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationTapped?: (response: Notifications.NotificationResponse) => void
) {
  // Handle notifications received while app is foregrounded
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    console.log('Notification received:', notification);
    if (onNotificationReceived) {
      onNotificationReceived(notification);
    }
  });

  // Handle notification taps
  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('Notification tapped:', response);
    if (onNotificationTapped) {
      onNotificationTapped(response);
    }
  });

  return {
    notificationListener,
    responseListener,
  };
}

/**
 * Show local notification (for in-app notifications)
 */
export async function showLocalNotification(title: string, body: string, data?: any) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: true,
    },
    trigger: null, // Show immediately
  });
}

/**
 * Get badge count
 */
export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

/**
 * Set badge count
 */
export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
}

/**
 * Clear all notifications
 */
export async function clearAllNotifications() {
  await Notifications.dismissAllNotificationsAsync();
}
