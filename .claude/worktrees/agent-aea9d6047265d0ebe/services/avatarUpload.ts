import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { firebaseAuth, firestore } from '@/constants/services';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export type AvatarUploadResult = { canceled: true } | { canceled: false; avatarUrl: string; photoPath: string };

export async function pickAndUploadAvatar(): Promise<AvatarUploadResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Media library permission required');

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (picked.canceled) return { canceled: true };
  const asset = picked.assets?.[0];
  if (!asset?.uri) return { canceled: true };

  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Must be signed in');

  const userRef = doc(firestore, 'riders', user.uid);
  const snap = await getDoc(userRef);
  const data = snap.exists() ? (snap.data() as any) : null;
  const oldAvatarUrl = data?.avatarUrl || data?.photoURL || null;
  const oldPhotoPath = data?.photoPath || extractPath(oldAvatarUrl);

  const jpegFormat = (ImageManipulator as any)?.SaveFormat?.JPEG || 'jpeg';
  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: 512 } }],
    { compress: 0.7, format: jpegFormat as any, base64: true }
  );
  if (!manipulated.base64) throw new Error('Missing base64');

  const apiBase = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4001';
  const idToken = await user.getIdToken();
  const resp = await fetch(`${apiBase}/api/upload-avatar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ base64: manipulated.base64, oldPhotoPath }),
  });
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  const json = await resp.json();
  if (!json.success) throw new Error(json.error || 'Upload failed');

  await setDoc(
    userRef,
    { avatarUrl: json.photoURL, photoPath: json.photoPath, updatedAt: serverTimestamp() },
    { merge: true }
  );

  return { canceled: false, avatarUrl: json.photoURL, photoPath: json.photoPath };
}

function extractPath(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/o\/(.+?)(?:\?|$)/);
    return m ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}