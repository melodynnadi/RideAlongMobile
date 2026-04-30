import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

export async function registerDriverPushToken(userId: string) {
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      if (req.status !== 'granted') {
        console.log('[registerDriverPushToken] Permission denied');
        return;
      }
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const pushToken = tokenData.data;

    const response = await fetch('https://ridealongwebapp.onrender.com/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, pushToken, role: 'driver' }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('[registerDriverPushToken] Failed:', result);
    } else {
      console.log('[registerDriverPushToken] Success:', pushToken.substring(0, 30) + '...');
    }
  } catch (e) {
    console.error('[registerDriverPushToken] Error:', e);
  }
}
