import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

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

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenData.data;
}

export async function registerRiderPushToken(userId: string) {
  try {
    const pushToken = await getExpoPushToken();
    if (!pushToken) return;

    const response = await fetch('https://ridealongwebapp.onrender.com/api/push/register', {
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

    const response = await fetch('https://ridealongwebapp.onrender.com/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pushToken, role: 'driver' }),
    });
    if (!response.ok) console.warn('[registerDriverPushToken] Server rejected token');
    else console.log('[registerDriverPushToken] Success');
  } catch (e) {
    console.warn('[registerDriverPushToken] Error:', e);
  }
}
