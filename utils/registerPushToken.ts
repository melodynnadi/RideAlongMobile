import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { firestore, getApiBaseUrl } from '@/constants/services';

async function setupAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Promise.all([
    Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#DE5D20',
      sound: 'default',
    }),
    Notifications.setNotificationChannelAsync('rides', {
      name: 'Ride Requests',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#DE5D20',
      sound: 'default',
      description: 'Notifications about ride requests and updates',
    }),
    Notifications.setNotificationChannelAsync('earnings', {
      name: 'Earnings',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250],
      lightColor: '#10B981',
      sound: 'default',
      description: 'Notifications about your earnings',
    }),
    Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#3B82F6',
      sound: 'default',
      description: 'Chat message notifications',
    }),
  ]);
}

async function getExpoPushToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.log('[registerPushToken] No EAS projectId configured — skipping push token registration');
    return null;
  }

  const perms = await Notifications.getPermissionsAsync();
  if (perms.status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') return null;
  }

  await setupAndroidChannels();

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenData.data;
}

export async function registerRiderPushToken(userId: string) {
  try {
    const pushToken = await getExpoPushToken();
    if (!pushToken) return;

    // Write as 'pushToken' (consistent field name the backend reads)
    try {
      await updateDoc(doc(firestore, 'riders', userId), { pushToken });
    } catch {}

    const response = await fetch(`${getApiBaseUrl()}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pushToken, role: 'rider' }),
    });
    if (!response.ok) console.warn('[registerRiderPushToken] Server rejected token');
  } catch (e) {
    console.warn('[registerRiderPushToken] Error:', e);
  }
}

export async function registerDriverPushToken(userId: string) {
  try {
    const pushToken = await getExpoPushToken();
    if (!pushToken) return;

    // Also write directly to Firestore so token is available even if API call fails
    try {
      await updateDoc(doc(firestore, 'drivers', userId), { pushToken });
    } catch {}

    const response = await fetch(`${getApiBaseUrl()}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pushToken, role: 'driver' }),
    });
    if (!response.ok) console.warn('[registerDriverPushToken] Server rejected token');
  } catch (e) {
    console.warn('[registerDriverPushToken] Error:', e);
  }
}
