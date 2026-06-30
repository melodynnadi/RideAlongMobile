import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ref } from 'firebase/storage';
import { doc, getDoc, setDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { firebaseAuth, firestore, storage, firebaseApp, firebaseConfig } from '@/constants/services';
import { logActivity } from '@/src/services/activity';

export type PickUploadResult =
  | { canceled: true }
  | { canceled: false; photoURL: string; photoPath: string };

export async function pickAndUploadProfilePhoto(): Promise<PickUploadResult> {
  // 1) Request permission
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Media library permission is required to select a profile photo.');
  }

  // 2) Pick an image
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
  if (!user) throw new Error('Must be signed in to upload a profile photo.');

  // 3) Get old avatar info to delete after successful upload
  // Skip this pre-fetch - backend will handle old photo deletion
  const userDocRef = doc(firestore, 'drivers', user.uid);
  const oldPhotoPath = undefined; // Backend retrieves this

  // 4) Resize/compress to keep uploads light (square, max 512)
  // Guard against undefined SaveFormat on some Expo SDKs
  // Expo SDK 53 ships SaveFormat as a string union; keep fallback
  const jpegFormat = (ImageManipulator as any)?.SaveFormat?.JPEG ?? (ImageManipulator as any)?.SaveFormat?.JPG ?? 'jpeg';
  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: 512 } }],
    { compress: 0.8, format: jpegFormat as any, base64: true }
  );

  // 5) Upload to a stable path (overwrite) – align with storage rule: avatars/{userId}/{allPaths=**}
  if (!manipulated.base64) {
    throw new Error('Base64 data not available from image manipulation');
  }

  // Send to backend for upload (avoids client storage SDK Blob usage)
  const apiBase = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4001';
  const idToken = await user.getIdToken();
  const resp = await fetch(`${apiBase}/api/upload-avatar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ base64: manipulated.base64, oldPhotoPath, role: 'driver' }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Avatar upload failed: ${resp.status} ${txt}`);
  }
  const json = await resp.json();
  if (!json.success) {
    throw new Error(`Avatar upload failed: ${json.error || 'unknown error'}`);
  }
  const photoURL = json.photoURL;
  const photoPath = json.photoPath;
  console.log('[avatar-upload] Backend returned URL:', photoURL);

  // 6) We already resolved photoURL above

  // 7) Delete old avatar if it exists and is different from new one
  // Old avatar deletion handled server-side

  // 8) Update Firestore users/{uid}
  await setDoc(
    userDocRef,
    {
      avatarUrl: photoURL,
      avatarUrl1: photoURL,
      photoURL,
      photoPath,
      updatedAt: serverTimestamp(),
      role: 'driver',
    },
    { merge: true }
  );

  // Skip verification in production - slows down UX
  // Activity logging combined into single call to reduce latency
  await logActivity({
    type: 'profile_updated',
    entityType: 'driver_profile',
    entityId: user.uid,
    metadata: { 
      fields: ['photoURL'], 
      photoURL,
      photoPath,
      document: 'profile_photo'
    },
  });

  // Do NOT call updateProfile(user, { photoURL }) — that sets auth.currentUser.photoURL
  // which bleeds into the rider account's profile picture fallback.
  // Each role's photo is stored only in its own Firestore collection.

  return { canceled: false, photoURL, photoPath };
}

export async function removeProfilePhoto(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Must be signed in to remove a profile photo.');

  const userRef = doc(firestore, 'drivers', user.uid);
  const snap = await getDoc(userRef);
  const data = snap.exists() ? (snap.data() as any) : null;
  const photoPath: string | undefined = data?.photoPath;

  // Delete file if tracked
  if (photoPath) {
    const storageRef = ref(storage, photoPath);
    try {
      await deleteObject(storageRef);
    } catch {
      // ignore not-found
    }
  }

  // Clear fields in Firestore
  await setDoc(
    userRef,
    {
      photoURL: deleteField(),
      photoPath: deleteField(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await logActivity({
    type: 'profile_updated',
    entityType: 'driver_profile',
    entityId: user.uid,
    metadata: { fields: ['photoURL'], action: 'photo_removed' },
  });

  // Optional: clear Auth photoURL (non-fatal)
  try {
    await updateProfile(user, { photoURL: null });
  } catch {
    // ignore
  }
}

function extractStoragePathFromUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/o\/(.+?)(?:\?|$)/);
    if (!match) return undefined;
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/*
Security rules (FYI):
Storage:
  match /profilePhotos/{uid}.jpg {
    allow read: if true; // or request.auth != null
    allow write: if request.auth != null && request.auth.uid == uid;
  }
Firestore:
  match /users/{uid} {
    allow read: if request.auth != null; // or true
    allow create, update, delete: if request.auth != null && request.auth.uid == uid;
  }
*/
