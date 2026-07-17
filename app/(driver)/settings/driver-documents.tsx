import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef } from 'firebase/storage';
import { firebaseAuth, firebaseConfig, firestore, storage } from '@/constants/services';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const BG = '#FBFAF7';
const BORDER = '#E5E0D8';
const MUTED = '#8B94A6';
const GREEN = '#10B981';

type DocKey = 'driverLicense' | 'insurance';

interface DocMeta {
  url: string;
  fileName: string;
  uploadedAt: string;
}

interface DocState {
  driverLicense: DocMeta | null;
  insurance: DocMeta | null;
}

const DOC_LABELS: Record<DocKey, { label: string; sub: string; icon: keyof typeof Ionicons.glyphMap }> = {
  driverLicense: { label: "Driver's license", sub: 'Photo or scan of your valid license', icon: 'card-outline' },
  insurance:     { label: 'Auto insurance',   sub: 'Current insurance card or declaration page', icon: 'shield-checkmark-outline' },
};

async function uploadDocToStorage(uri: string, uid: string, docKey: DocKey, ext: string): Promise<string> {
  const idToken = await firebaseAuth.currentUser!.getIdToken();
  const bucket = firebaseConfig.storageBucket;
  if (!bucket) throw new Error('Firebase Storage is not configured.');

  const path = `driverDocuments/${uid}/${docKey}_${Date.now()}.${ext}`;
  const uploadUrl =
    'https://firebasestorage.googleapis.com/v0/b/' +
    encodeURIComponent(bucket) +
    '/o?name=' +
    encodeURIComponent(path);

  const response = await FileSystem.uploadAsync(uploadUrl, uri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: 'Firebase ' + idToken,
      'Content-Type': ext === 'pdf' ? 'application/pdf' : 'image/jpeg',
    },
  });

  if (response.status < 200 || response.status >= 300) {
    let message = 'Upload failed.';
    try { const body = JSON.parse(response.body); message = body?.error?.message || body?.error || message; } catch {}
    throw new Error(message);
  }

  return getDownloadURL(storageRef(storage, path));
}

export default function DriverDocumentsScreen() {
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const [docs, setDocs] = useState<DocState>({ driverLicense: null, insurance: null });
  const [uploading, setUploading] = useState<DocKey | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }
    getDoc(doc(firestore, 'drivers', uid)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data() as any;
        setDocs({
          driverLicense: d?.documents?.driverLicense || null,
          insurance: d?.documents?.insurance || null,
        });
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const pickAndUpload = async (docKey: DocKey, source: 'camera' | 'library' | 'file') => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;

    let uri: string | null = null;
    let fileName = '';
    let ext = 'jpg';

    try {
      if (source === 'file') {
        const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        uri = asset.uri;
        fileName = asset.name || `${docKey}.pdf`;
        ext = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'jpg';
      } else {
        const perm = source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission required', source === 'camera' ? 'Camera access is needed.' : 'Photo library access is needed.');
          return;
        }
        const result = source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        const jpegFormat = (ImageManipulator as any)?.SaveFormat?.JPEG || 'jpeg';
        const resized = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: 1600 } }],
          { compress: 0.82, format: jpegFormat as any },
        );
        uri = resized.uri;
        fileName = `${docKey}.jpg`;
        ext = 'jpg';
      }

      setUploading(docKey);
      const url = await uploadDocToStorage(uri, uid, docKey, ext);
      const meta: DocMeta = { url, fileName, uploadedAt: new Date().toISOString() };

      await setDoc(doc(firestore, 'drivers', uid), {
        documents: { [docKey]: meta },
        updatedAt: serverTimestamp(),
      }, { merge: true });

      setDocs((prev) => ({ ...prev, [docKey]: meta }));
      Alert.alert('Uploaded', `${DOC_LABELS[docKey].label} saved successfully.`);
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message || 'Could not upload the document. Please try again.');
    } finally {
      setUploading(null);
    }
  };

  const promptUpload = (docKey: DocKey) => {
    Alert.alert(
      `Upload ${DOC_LABELS[docKey].label}`,
      'Choose a source',
      [
        { text: 'Take photo',        onPress: () => pickAndUpload(docKey, 'camera') },
        { text: 'Choose from library', onPress: () => pickAndUpload(docKey, 'library') },
        { text: 'Choose file (PDF)', onPress: () => pickAndUpload(docKey, 'file') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.loadingWrap}><ActivityIndicator size="large" color={ORANGE} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>

          <View style={s.hdr}>
            <TouchableOpacity style={s.backBtn} onPress={goBack} activeOpacity={0.75}>
              <Ionicons name="chevron-back" size={22} color={NAVY} />
            </TouchableOpacity>
            <Text style={s.hdrTitle}>Documents</Text>
            <View style={{ width: 40 }} />
          </View>

          <Text style={s.intro}>
            Upload your driver&apos;s license and auto insurance. These are kept private and used only for safety verification.
          </Text>

          <Text style={s.sectionLabel}>REQUIRED DOCUMENTS</Text>
          <View style={s.card}>
            {(Object.keys(DOC_LABELS) as DocKey[]).map((key, idx, arr) => {
              const info = DOC_LABELS[key];
              const meta = docs[key];
              const isUploading = uploading === key;
              const isLast = idx === arr.length - 1;
              return (
                <View key={key} style={[s.row, !isLast && s.rowBorder]}>
                  <View style={s.rowIconWrap}>
                    <Ionicons name={info.icon} size={22} color={meta ? GREEN : MUTED} />
                  </View>
                  <View style={s.rowBody}>
                    <Text style={s.rowLabel}>{info.label}</Text>
                    {meta
                      ? <Text style={[s.rowSub, { color: GREEN }]} numberOfLines={1}>
                          Uploaded · {new Date(meta.uploadedAt).toLocaleDateString()}
                        </Text>
                      : <Text style={s.rowSub}>{info.sub}</Text>
                    }
                  </View>
                  <TouchableOpacity
                    style={[s.uploadBtn, meta && s.uploadBtnDone]}
                    onPress={() => promptUpload(key)}
                    disabled={isUploading}
                    activeOpacity={0.75}
                  >
                    {isUploading
                      ? <ActivityIndicator size="small" color={meta ? GREEN : ORANGE} />
                      : <Ionicons name={meta ? 'checkmark-circle' : 'cloud-upload-outline'} size={20} color={meta ? GREEN : ORANGE} />
                    }
                    <Text style={[s.uploadBtnText, meta && { color: GREEN }]}>
                      {meta ? 'Update' : 'Upload'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>

          <View style={s.noteCard}>
            <Ionicons name="lock-closed-outline" size={16} color={MUTED} style={{ marginTop: 1 }} />
            <Text style={s.noteText}>
              Documents are encrypted and stored securely. They are never shared with riders.
            </Text>
          </View>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  safe:        { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content:     { paddingBottom: 48 },

  hdr:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, minHeight: 64 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  hdrTitle:{ color: NAVY, fontSize: 24, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

  intro: { marginHorizontal: 20, marginBottom: 20, color: MUTED, fontSize: 14, lineHeight: 20 },

  sectionLabel: { marginHorizontal: 20, marginBottom: 8, color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },

  card: { marginHorizontal: 20, borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFF', overflow: 'hidden' },

  row:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  rowIconWrap:{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#F3EFE8', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowBody:   { flex: 1, minWidth: 0 },
  rowLabel:  { color: NAVY, fontSize: 15, fontWeight: '600' },
  rowSub:    { color: MUTED, fontSize: 12, marginTop: 2 },

  uploadBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: ORANGE, backgroundColor: '#FFF7F3' },
  uploadBtnDone: { borderColor: GREEN, backgroundColor: '#EFFDF7' },
  uploadBtnText: { color: ORANGE, fontSize: 13, fontWeight: '700' },

  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 20, marginTop: 20, padding: 14, borderRadius: 14, backgroundColor: '#F3EFE8', borderWidth: 1, borderColor: BORDER },
  noteText:  { flex: 1, color: MUTED, fontSize: 13, lineHeight: 18 },
});
