import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getStudentVerificationStatus,
  StudentDocumentType,
  StudentVerificationStatusResponse,
  submitStudentVerification,
  VerificationUploadFile,
} from '@/services/studentVerification';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useVerificationStore } from '@/stores/verificationStore';
import { hitSlop, layout } from '@/theme/designSystem';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const BG = '#FBFAF7';
const PAPER = '#F6F3ED';
const BORDER = '#E5E0D8';
const MUTED = '#7D8698';

const DOCUMENT_TYPES: { value: StudentDocumentType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'enrollment_letter', label: 'Enrollment letter', icon: 'document-text-outline' },
  { value: 'class_schedule', label: 'Class schedule', icon: 'calendar-outline' },
  { value: 'transcript', label: 'Transcript', icon: 'school-outline' },
  { value: 'portal_screenshot', label: 'Portal screenshot', icon: 'phone-portrait-outline' },
  { value: 'student_id', label: 'Student ID', icon: 'card-outline' },
];

function formatBytes(size?: number | null) {
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function inferMimeType(name: string, provided?: string | null) {
  if (provided && provided !== 'application/octet-stream') return provided;
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

function statusDetails(status?: string | null) {
  switch (status) {
    case 'approved':
    case 'auto-approved':
      return { label: 'Verified', icon: 'checkmark-circle' as const, color: '#168454', bg: '#E9F7F0' };
    case 'manual-review':
    case 'submitted':
    case 'pending':
      return { label: 'Under review', icon: 'time' as const, color: '#A76500', bg: '#FFF2D8' };
    case 'rejected':
      return { label: 'Needs attention', icon: 'alert-circle' as const, color: '#C94747', bg: '#FDECEC' };
    default:
      return { label: 'Not submitted', icon: 'shield-outline' as const, color: NAVY, bg: PAPER };
  }
}

type StudentVerificationScreenProps = {
  fallbackRoute?: string;
};

export default function StudentVerificationScreen({
  fallbackRoute = '/(rider)/settings',
}: StudentVerificationScreenProps) {
  const { goBack } = useReturnNavigation(fallbackRoute);
  const [docType, setDocType] = useState<StudentDocumentType>('enrollment_letter');
  const [file, setFile] = useState<VerificationUploadFile | null>(null);
  const [status, setStatus] = useState<StudentVerificationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const nextStatus = await getStudentVerificationStatus();
      setStatus(nextStatus);
      useVerificationStore.getState().setVerificationData({
        isVerified: nextStatus.user.isVerified,
        verificationStatus: nextStatus.user.verificationStatus === 'none' || nextStatus.user.verificationStatus === 'submitted'
          ? null
          : nextStatus.user.verificationStatus,
        blocked: nextStatus.user.blocked,
        daysRemaining: nextStatus.user.daysLeft,
        verificationDeadline: nextStatus.user.deadline ? new Date(nextStatus.user.deadline) : null,
      });
    } catch (error: any) {
      Alert.alert('Unable to load verification', error?.message || 'Please check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.name, mimeType: inferMimeType(asset.name, asset.mimeType), size: asset.size });
  };

  const chooseImage = async (camera: boolean) => {
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(`${camera ? 'Camera' : 'Photo'} permission needed`, `Allow ${camera ? 'camera' : 'photo'} access to add your student document.`);
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const extension = asset.mimeType === 'image/png' ? 'png' : 'jpg';
    setFile({
      uri: asset.uri,
      name: asset.fileName || `student-proof-${Date.now()}.${extension}`,
      mimeType: asset.mimeType || `image/${extension === 'jpg' ? 'jpeg' : extension}`,
      size: asset.fileSize,
    });
  };

  const showPicker = () => {
    Alert.alert('Add student document', 'Use a clear, uncropped document showing your name and school.', [
      { text: 'Take photo', onPress: () => void chooseImage(true) },
      { text: 'Choose photo', onPress: () => void chooseImage(false) },
      { text: 'Choose PDF or file', onPress: () => void chooseDocument() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submit = async () => {
    if (!file || submitting) return;
    if (file.size && file.size > 15 * 1024 * 1024) {
      Alert.alert('File is too large', 'Choose a PDF, JPG, or PNG smaller than 15 MB.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitStudentVerification(docType, file);
      setFile(null);
      await load(true);
      Alert.alert(statusDetails(result.status).label, result.decisionReason || 'Your document was submitted successfully.');
    } catch (error: any) {
      Alert.alert('Upload failed', error?.message || 'Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const rawStatus = status?.user.verificationStatus;
  const isAlreadyVerified = !!status?.user.isVerified || rawStatus === 'approved' || rawStatus === 'auto-approved';
  const current = statusDetails(isAlreadyVerified ? 'approved' : rawStatus);
  const latest = status?.latestSubmission;
  const score = latest?.matchScores?.aggregate;
  const scorePercent = typeof score === 'number' ? Math.round(score * 100) : null;
  const deadlineCopy = useMemo(() => {
    if (!status?.user || status.user.isVerified) return null;
    if (status.user.pastDue) return `Verification is past due by ${status.user.daysPastDue || 1} day${status.user.daysPastDue === 1 ? '' : 's'}.`;
    if (status.user.daysLeft != null) return `${status.user.daysLeft} day${status.user.daysLeft === 1 ? '' : 's'} left to verify.`;
    return null;
  }, [status]);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={ORANGE} />}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to settings" hitSlop={hitSlop}>
              <Ionicons name="arrow-back" size={19} color={NAVY} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Student verification</Text>
          </View>

          {loading ? (
            <View style={styles.loading}><ActivityIndicator color={ORANGE} /><Text style={styles.muted}>Loading verification status...</Text></View>
          ) : (
            <>
              <View style={[styles.statusCard, { backgroundColor: current.bg }]}>
                <View style={[styles.statusIcon, { backgroundColor: current.color }]}><Ionicons name={current.icon} size={22} color="#FFFFFF" /></View>
                <View style={styles.flex}>
                  <Text style={styles.eyebrow}>CURRENT STATUS</Text>
                  <Text style={[styles.statusTitle, { color: current.color }]}>{current.label}</Text>
                  <Text style={styles.statusBody}>
                    {isAlreadyVerified ? "You're verified. No additional student proof is needed." : latest?.decisionReason || 'Upload proof that you are currently enrolled.'}
                  </Text>
                  {deadlineCopy ? <Text style={styles.deadline}>{deadlineCopy}</Text> : null}
                </View>
              </View>

              {!isAlreadyVerified ? (
                <>
              {latest?.matchScores ? (
                <View style={styles.card}>
                  <View style={styles.sectionHeadingRow}>
                    <View><Text style={styles.eyebrow}>OCR ANALYSIS</Text><Text style={styles.sectionTitle}>What we detected</Text></View>
                    {scorePercent != null ? <View style={styles.scoreBadge}><Text style={styles.scoreText}>{scorePercent}</Text><Text style={styles.scoreSmall}>/100</Text></View> : null}
                  </View>
                  <View style={styles.scoreGrid}>
                    {(['name', 'school', 'term', 'status'] as const).map((key) => (
                      <View key={key} style={styles.scoreItem}>
                        <Text style={styles.scoreLabel}>{key === 'status' ? 'Enrollment' : key}</Text>
                        <Text style={styles.scoreValue}>{Math.round((latest.matchScores?.[key] || 0) * 100)}%</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Choose your proof</Text></View>
              <View style={styles.typeGrid}>
                {DOCUMENT_TYPES.map((item) => {
                  const selected = docType === item.value;
                  return (
                    <TouchableOpacity key={item.value} style={[styles.typeChip, selected && styles.typeChipSelected]} onPress={() => setDocType(item.value)} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                      <Ionicons name={item.icon} size={18} color={selected ? ORANGE : MUTED} />
                      <Text style={[styles.typeText, selected && styles.typeTextSelected]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity style={[styles.uploadCard, file && styles.uploadCardSelected]} onPress={showPicker} accessibilityRole="button">
                <View style={styles.uploadIcon}><Ionicons name={file ? 'document-attach' : 'cloud-upload-outline'} size={25} color={ORANGE} /></View>
                <View style={styles.flex}>
                  <Text style={styles.uploadTitle}>{file ? file.name : 'Add your document'}</Text>
                  <Text style={styles.uploadBody}>{file ? `${file.mimeType}${file.size ? ` · ${formatBytes(file.size)}` : ''}` : 'Take a photo or choose a PDF, JPG, or PNG up to 15 MB.'}</Text>
                </View>
                <Ionicons name={file ? 'swap-horizontal' : 'chevron-forward'} size={19} color={MUTED} />
              </TouchableOpacity>

              <View style={styles.tipCard}><Ionicons name="sparkles-outline" size={18} color={ORANGE} /><Text style={styles.tipText}>For the best OCR score, include your full name, school name, and a current semester or enrollment status.</Text></View>

              <TouchableOpacity style={[styles.submitButton, (!file || submitting) && styles.submitDisabled]} onPress={() => void submit()} disabled={!file || submitting} accessibilityRole="button">
                {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitText}>Submit for verification</Text>}
              </TouchableOpacity>
                </>
              ) : null}

            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: BG },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: 36 },
  header: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  headerTitle: { color: NAVY, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
  loading: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: MUTED, fontSize: 14 },
  flex: { flex: 1 },
  statusCard: { borderRadius: 20, padding: 18, flexDirection: 'row', gap: 14, marginBottom: 18 },
  statusIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#929BAB', fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 5 },
  statusTitle: { fontSize: 20, fontWeight: '700', marginBottom: 5 },
  statusBody: { color: NAVY, fontSize: 13, lineHeight: 19 },
  deadline: { color: ORANGE, fontSize: 12, fontWeight: '700', marginTop: 7 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', padding: 17, marginBottom: 22 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  sectionHeader: { marginTop: 6, marginBottom: 12 },
  sectionTitle: { color: NAVY, fontSize: 18, fontWeight: '700' },
  scoreBadge: { flexDirection: 'row', alignItems: 'baseline', marginLeft: 'auto', backgroundColor: PAPER, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  scoreText: { color: ORANGE, fontSize: 22, fontWeight: '700' },
  scoreSmall: { color: MUTED, fontSize: 11 },
  scoreGrid: { flexDirection: 'row', gap: 8 },
  scoreItem: { flex: 1, borderRadius: 12, backgroundColor: PAPER, paddingVertical: 11, alignItems: 'center' },
  scoreLabel: { color: MUTED, fontSize: 10, textTransform: 'capitalize' },
  scoreValue: { color: NAVY, fontSize: 15, fontWeight: '700', marginTop: 3 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeChip: { minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#FFFFFF', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  typeChipSelected: { borderColor: ORANGE, backgroundColor: '#FFF3EA' },
  typeText: { color: MUTED, fontSize: 12, fontWeight: '600' },
  typeTextSelected: { color: ORANGE },
  uploadCard: { minHeight: 84, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: '#C8CED8', backgroundColor: '#FFFFFF', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  uploadCardSelected: { borderStyle: 'solid', borderColor: ORANGE },
  uploadIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#F9E8DB', alignItems: 'center', justifyContent: 'center' },
  uploadTitle: { color: NAVY, fontSize: 15, fontWeight: '700' },
  uploadBody: { color: MUTED, fontSize: 11, lineHeight: 16, marginTop: 3 },
  tipCard: { flexDirection: 'row', gap: 9, backgroundColor: PAPER, borderRadius: 14, padding: 13, marginTop: 10 },
  tipText: { flex: 1, color: '#5F6878', fontSize: 11, lineHeight: 17 },
  submitButton: { height: 54, borderRadius: 27, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginTop: 16, marginBottom: 28 },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
