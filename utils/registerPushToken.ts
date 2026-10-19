import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Alert, Linking, Platform } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { firestore, getApiBaseUrl, firebaseAuth } from '@/constants/services';

export async function setupAndroidChannels() {
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

  // Android 13+ only shows the permission prompt once a channel exists, so
  // create channels first (Expo's documented order).
  await setupAndroidChannels();

  const perms = await Notifications.getPermissionsAsync();
  if (perms.status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenData.data;
}

/** Returns true when this device's token was saved for the account. */
export async function registerRiderPushToken(userId: string): Promise<boolean> {
  try {
    const pushToken = await getExpoPushToken();
    if (!pushToken) return false;
    // The user may have logged out or switched accounts while we waited for
    // permission/token — never write this phone's token to an old account.
    if (firebaseAuth.currentUser?.uid !== userId) return false;

    // Write to riders collection. Also write to drivers if this is a dual-role account
    // so server-side getUserPushToken('rider') can find the token either way.
    try {
      await updateDoc(doc(firestore, 'riders', userId), { pushToken });
    } catch {}
    try {
      await updateDoc(doc(firestore, 'drivers', userId), { pushToken });
    } catch {} // silently skip if no driver doc exists

    const idToken = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
    const response = await fetch(`${getApiBaseUrl()}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ userId, pushToken, role: 'rider' }),
    });
    if (!response.ok) console.warn('[registerRiderPushToken] Server rejected token');
    return true;
  } catch (e) {
    console.warn('[registerRiderPushToken] Error:', e);
    return false;
  }
}

/** Returns true when this device's token was saved for the account. */
export async function registerDriverPushToken(userId: string): Promise<boolean> {
  try {
    const pushToken = await getExpoPushToken();
    if (!pushToken) return false;
    if (firebaseAuth.currentUser?.uid !== userId) return false; // logged out/switched meanwhile

    // Write to drivers collection. Also write to riders if this is a dual-role account.
    try {
      await updateDoc(doc(firestore, 'drivers', userId), { pushToken });
    } catch {}
    try {
      await updateDoc(doc(firestore, 'riders', userId), { pushToken });
    } catch {} // silently skip if no rider doc exists

    const idToken = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
    const response = await fetch(`${getApiBaseUrl()}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify({ userId, pushToken, role: 'driver' }),
    });
    if (!response.ok) console.warn('[registerDriverPushToken] Server rejected token');
    return true;
  } catch (e) {
    console.warn('[registerDriverPushToken] Error:', e);
    return false;
  }
}

/**
 * Logout: ask the server to remove this phone's token from the signed-in
 * account and from any other account still holding it. Must run before
 * Firebase sign-out (the request is authenticated). Doesn't prompt for
 * permission — it only reads the token if permission is already granted.
 */
export async function unregisterPushToken(): Promise<void> {
  let pushToken: string | null = null;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const perms = await Notifications.getPermissionsAsync();
    if (projectId && perms.status === 'granted') {
      pushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    }
  } catch {}
  const idToken = await firebaseAuth.currentUser?.getIdToken().catch(() => null);
  if (!idToken) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000); // don't hold up logout
  try {
    await fetch(`${getApiBaseUrl()}/api/push/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ pushToken }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Called when a user turns push notifications on in settings: make sure this
 * device is actually registered. If iOS/Android permission is off, offer to
 * open system settings (the in-app toggle alone can't deliver anything).
 */
export async function ensurePushRegistered(userId: string, role: 'rider' | 'driver'): Promise<boolean> {
  const ok = role === 'driver' ? await registerDriverPushToken(userId) : await registerRiderPushToken(userId);
  if (ok) return true;
  const perms = await Notifications.getPermissionsAsync().catch(() => null);
  if (perms && perms.status !== 'granted') {
    Alert.alert(
      'Notifications are off for RideAlong',
      'Turn on notifications for RideAlong in your phone’s Settings so you don’t miss ride requests and messages.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
      ],
    );
  }
  return false;
}
