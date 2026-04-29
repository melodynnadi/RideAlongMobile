import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyB1LC4HJ25GCBEMMcg3R6p4mgeJnSgc-T0',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'ridealong-33528.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'ridealong-33528',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ridealong-33528.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '1836920755',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:1836920755:web:207beed73fdcdb934925c6',
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth = (() => {
  if (Platform.OS === 'web') return getAuth(firebaseApp);
  const { getReactNativePersistence } = require('firebase/auth');
  return initializeAuth(firebaseApp, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
})();

let _firestore: ReturnType<typeof getFirestore>;
try {
  _firestore = initializeFirestore(firebaseApp, { experimentalAutoDetectLongPolling: true });
} catch {
  _firestore = getFirestore(firebaseApp);
}
export const firestore = _firestore;
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, 'us-central1');

export const GOOGLE_MAPS_API_KEY = 'AIzaSyDWOpCIVn_oPxn4qWYE4eG3teKtn0c5G-w';

let _stripeKey: string | null = null;
let _stripeKeyPromise: Promise<string> | null = null;

export async function getStripePublishableKey(): Promise<string> {
  if (_stripeKey) return _stripeKey;
  if (_stripeKeyPromise) return _stripeKeyPromise;

  _stripeKeyPromise = (async () => {
    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/payments/config`);
      if (!response.ok) throw new Error('Failed to fetch payment config');
      const config = await response.json();
      _stripeKey = config.publishableKey || '';
      return _stripeKey!;
    } catch {
      _stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
      return _stripeKey!;
    } finally {
      _stripeKeyPromise = null;
    }
  })();

  return _stripeKeyPromise;
}

export const getApiBaseUrl = (): string => {
  let base = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

  if (base.startsWith('https://') || (base.startsWith('http://') && !base.includes('localhost') && !base.includes('127.0.0.1'))) {
    return base.replace(/\/+$/, '');
  }

  try {
    const url = new URL(base);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (isLocalhost) {
      const hostUri = (Constants.expoConfig as any)?.hostUri || (Constants as any)?.manifest?.debuggerHost || '';
      const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : '';
      if (host && /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        url.hostname = host;
        base = url.toString();
      }
    }
  } catch {}

  return base.replace(/\/+$/, '');
};
