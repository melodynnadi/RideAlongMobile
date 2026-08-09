// RideAlong Mobile - shared local-notification helpers.
// Push token registration and the notification handler itself are owned by
// src/services/notificationService.ts — don't duplicate either here, since
// two competing `Notifications.setNotificationHandler` calls at module scope
// silently fight over which one wins based on import order.
import * as Notifications from 'expo-notifications';

/**
 * Show a local (in-process) notification immediately.
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

export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

export async function setBadgeCount(count: number) {
  await Notifications.setBadgeCountAsync(count);
}

export async function clearAllNotifications() {
  await Notifications.dismissAllNotificationsAsync();
}
