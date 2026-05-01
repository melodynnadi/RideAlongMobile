import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';
import { pickAndUploadProfilePhoto, removeProfilePhoto } from '@/services/profilePhoto';

export default function ProfileScreen() {
  // Seed initial state from already-authenticated user for instant render
  const initialUser = firebaseAuth.currentUser;
  const [uid, setUid] = useState<string | null>(initialUser?.uid ?? null);
  const [photoURL, setPhotoURL] = useState<string | null>(initialUser?.photoURL ?? null);
  // If we already have a user, we can skip the spinner; otherwise wait for auth
  const [loading, setLoading] = useState<boolean>(!initialUser);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const sub = onAuthStateChanged(firebaseAuth, (user) => {
      setUid(user?.uid ?? null);
      if (user) {
        // Immediate UI update from auth - no waiting needed
        setPhotoURL(user.photoURL ?? null);
        setLoading(false);
      } else {
        setLoading(false);
      }
    });
    return sub;
  }, []);

  // Fetch Firestore user doc ONCE on mount (not continuous listening)
  // This provides a fallback if auth photoURL is stale
  useEffect(() => {
    if (!uid) return;
    
    let mounted = true;
    const currentPhotoURL = photoURL;
    
    const fetchUserPhoto = async () => {
      try {
        const ref = doc(firestore, 'drivers', uid);
        const snap = await getDoc(ref);
        if (mounted && snap.exists()) {
          const data = snap.data();
          const firestorePhoto = (data?.photoURL || data?.avatarUrl) as string | null;
          // Only update if Firestore has a different/newer photo than auth
          if (firestorePhoto && firestorePhoto !== currentPhotoURL) {
            setPhotoURL(firestorePhoto);
          }
        }
      } catch (err) {
        console.warn('[ProfileScreen] Failed to fetch user photo from Firestore:', err);
        // Non-fatal - we already have auth photoURL
      }
    };
    
    fetchUserPhoto();
    
    return () => {
      mounted = false;
    };
  }, [uid]);

  const onChangePhoto = async () => {
    try {
      if (!firebaseAuth.currentUser) {
        Alert.alert('Not signed in', 'Please sign in to change your photo.');
        return;
      }
      setSaving(true);
      const res = await pickAndUploadProfilePhoto();
      if (!res.canceled) {
        setPhotoURL(res.photoURL);
      }
    } catch (e: any) {
      Alert.alert('Failed to update photo', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const onRemovePhoto = async () => {
    try {
      if (!firebaseAuth.currentUser) {
        Alert.alert('Not signed in', 'Please sign in to remove your photo.');
        return;
      }
      setSaving(true);
      await removeProfilePhoto();
      setPhotoURL(null);
    } catch (e: any) {
      Alert.alert('Failed to remove photo', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Driver Profile</Text>

      <View style={styles.avatarWrap}>
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.placeholder]}>
            <Text style={{ color: '#64748B' }}>No Photo</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: '#0EA5E9' }]}
        onPress={onChangePhoto}
        disabled={saving || !uid}
      >
        <Text style={styles.btnText}>{saving ? 'Updating...' : 'Change Photo'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: '#EF4444' }]}
        onPress={onRemovePhoto}
        disabled={saving || !photoURL || !uid}
      >
        <Text style={styles.btnText}>Remove Photo</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: 16, gap: 16, backgroundColor: '#F8FAFC' },
  title: { fontSize: 22, fontWeight: '800' },
  avatarWrap: { alignItems: 'center', marginTop: 8, marginBottom: 16 },
  avatar: { width: 128, height: 128, borderRadius: 64, backgroundColor: '#fff' },
  placeholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  btn: { paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
