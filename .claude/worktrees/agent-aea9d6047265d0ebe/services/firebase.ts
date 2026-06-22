import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID!,
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

export const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyDWOpCIVn_oPxn4qWYE4eG3teKtn0c5G-w';

export const getApiBaseUrl = (): string => {
  let base = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

  if (
    base.startsWith('https://') ||
    (base.startsWith('http://') && !base.includes('localhost') && !base.includes('127.0.0.1'))
  ) {
    return base.replace(/\/+$/, '');
  }

  try {
    const url = new URL(base);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (isLocalhost) {
      const hostUri =
        (Constants.expoConfig as any)?.hostUri ||
        (Constants as any)?.manifest?.debuggerHost ||
        '';
      const host = typeof hostUri === 'string' ? hostUri.split(':')[0] : '';
      if (host && /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        url.hostname = host;
        base = url.toString();
      }
    }
  } catch {}

  return base.replace(/\/+$/, '');
};
