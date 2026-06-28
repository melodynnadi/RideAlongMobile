import React, { useState, useMemo, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import { UniversitySearch } from '@/components/ui/UniversitySearch';
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { type SignupUniversity } from '@/services/authSignup';
import { hitSlop } from '@/theme/designSystem';
import { useAppTheme } from '@/hooks/ThemeContext';
import { useAuthStore } from '@/stores/authStore';
import type { AppColors } from '@/constants/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const SEAT_OPTIONS = ['2', '4', '6'] as const;

const STEPS = [
  { title: "Let's", accent: 'drive.', subtitle: 'Tell us about yourself. All drivers are verified students.' },
  { title: 'Your', accent: 'license.', subtitle: 'A valid driver\'s license is required to drive on RideAlong.' },
  { title: 'Your', accent: 'vehicle.', subtitle: 'The car you\'ll be driving students around in.' },
  { title: 'Your', accent: 'insurance.', subtitle: 'Active insurance is required. We verify every document.' },
  { title: 'Almost', accent: 'there.', subtitle: 'Review your info and agree to the driver terms.' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Auto-inserts slashes as the user types: MM/DD/YYYY
function formatDobInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

// Auto-inserts slash as the user types: MM/YYYY
function formatMonthYearInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function validateEduEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim());
}

function parseDob(str: string): Date | null {
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  if (!m || !d || !y || y < 1900 || y > new Date().getFullYear()) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null;
  return date;
}

function isAdult(dob: string): boolean {
  const date = parseDob(dob);
  if (!date) return false;
  const ageDays = (Date.now() - date.getTime()) / 86400000;
  return ageDays >= 18 * 365.25;
}

function parseExpiry(str: string): Date | null {
  const parts = str.split('/');
  if (parts.length !== 2) return null;
  const [m, y] = parts.map(Number);
  if (!m || m < 1 || m > 12 || !y || y < 2020) return null;
  return new Date(y, m, 0); // last day of that month
}

function isNotExpired(str: string): boolean {
  const date = parseExpiry(str);
  return date ? date > new Date() : false;
}

function fileField(asset: { uri: string; mimeType?: string }, name: string) {
  return {
    uri: asset.uri,
    name,
    type: asset.mimeType ?? 'image/jpeg',
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({ label, s }: { label: string; s: ReturnType<typeof makeStyles> }) {
  return <Text style={s.label}>{label}</Text>;
}

function Field({ label, children, s }: { label: string; children: React.ReactNode; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.field}>
      <FieldLabel label={label} s={s} />
      {children}
    </View>
  );
}

function Input(props: React.ComponentProps<typeof TextInput> & { label: string; s: ReturnType<typeof makeStyles>; colors: AppColors }) {
  const { label, s, colors, ...rest } = props;
  return (
    <Field label={label} s={s}>
      <TextInput style={s.input} placeholderTextColor={colors.textSecondary} {...rest} />
    </Field>
  );
}

function ImageUploadField({ label, asset, onPick, s, colors }: {
  label: string;
  asset: ImagePicker.ImagePickerAsset | null;
  onPick: () => void;
  s: ReturnType<typeof makeStyles>;
  colors: AppColors;
}) {
  return (
    <Field label={label} s={s}>
      <TouchableOpacity style={[s.uploadBox, asset && s.uploadBoxDone]} onPress={onPick} accessibilityRole="button">
        {asset ? (
          <View style={s.uploadedRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            <Text style={s.uploadedText} numberOfLines={1}>{asset.fileName ?? 'Image selected'}</Text>
            <Text style={s.uploadChangeTap}>Change</Text>
          </View>
        ) : (
          <View style={s.uploadPrompt}>
            <Ionicons name="cloud-upload-outline" size={22} color={colors.textSecondary} />
            <Text style={s.uploadPromptText}>Tap to upload photo</Text>
            <Text style={s.uploadHint}>JPG or PNG · max 5MB</Text>
          </View>
        )}
      </TouchableOpacity>
    </Field>
  );
}

type DocAsset = { name: string; uri: string; mimeType?: string };

function DocumentUploadField({ label, asset, onPick, s, colors }: {
  label: string;
  asset: DocAsset | null;
  onPick: () => void;
  s: ReturnType<typeof makeStyles>;
  colors: AppColors;
}) {
  return (
    <Field label={label} s={s}>
      <TouchableOpacity style={[s.uploadBox, asset && s.uploadBoxDone]} onPress={onPick} accessibilityRole="button">
        {asset ? (
          <View style={s.uploadedRow}>
            <Ionicons name="document-text" size={20} color={colors.primary} />
            <Text style={s.uploadedText} numberOfLines={1}>{asset.name}</Text>
            <Text style={s.uploadChangeTap}>Change</Text>
          </View>
        ) : (
          <View style={s.uploadPrompt}>
            <Ionicons name="document-attach-outline" size={22} color={colors.textSecondary} />
            <Text style={s.uploadPromptText}>Tap to upload document</Text>
            <Text style={s.uploadHint}>PDF, JPG or PNG · max 5MB</Text>
          </View>
        )}
      </TouchableOpacity>
    </Field>
  );
}

function ErrorBanner({ message, s, colors }: { message: string; s: ReturnType<typeof makeStyles>; colors: AppColors }) {
  if (!message) return null;
  return (
    <View style={s.errorBanner}>
      <Ionicons name="alert-circle" size={18} color={colors.red} />
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

function AgreementRow({ checked, onToggle, children, s }: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  s: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity style={s.agreeRow} onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[s.checkbox, checked && s.checkboxChecked]}>
        {checked ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
      </View>
      <Text style={s.agreeText}>{children}</Text>
    </TouchableOpacity>
  );
}

// ─── Style factory ────────────────────────────────────────────────────────────

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    // Step header
    stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
    backBtn: {
      width: 38, height: 38, borderRadius: 19,
      borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.bgCard,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    progressWrap: { flex: 1, gap: 6 },
    progressLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.8, textTransform: 'uppercase' },
    progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
    progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },

    scroll: { flex: 1 },
    content: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 48 },

    // Heading
    headingWrap: { marginBottom: 28 },
    headingTitle: { fontSize: 38, fontWeight: '600', color: colors.textPrimary, letterSpacing: -0.75, lineHeight: 46 },
    headingAccent: { color: colors.primary, fontStyle: 'italic' },
    headingSubtitle: { fontSize: 15, color: colors.textSecondary, lineHeight: 22, marginTop: 10 },

    // Error
    errorBanner: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: colors.redDim, borderRadius: 10, padding: 12, marginBottom: 16,
    },
    errorText: { flex: 1, color: colors.red, fontSize: 13, lineHeight: 18 },

    // Fields
    field: { marginBottom: 16 },
    label: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 7 },
    input: {
      height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.bgCard, paddingHorizontal: 14,
      fontSize: 15, color: colors.textPrimary,
    },
    universityWrap: { borderRadius: 12, overflow: 'hidden' },
    nameRow: { flexDirection: 'row', gap: 10 },
    nameField: { flex: 1 },

    // Seat selector
    seatRow: { flexDirection: 'row', gap: 10 },
    seatOption: {
      flex: 1, height: 48, borderRadius: 12, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.bgCard,
      alignItems: 'center', justifyContent: 'center',
    },
    seatOptionActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
    seatText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    seatTextActive: { color: colors.textInverse },

    // Image upload
    uploadBox: {
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border,
      borderRadius: 12, padding: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.bgSecondary, minHeight: 80,
    },
    uploadBoxDone: { borderStyle: 'solid', borderColor: colors.primary, backgroundColor: colors.primaryDim },
    uploadPrompt: { alignItems: 'center', gap: 4 },
    uploadPromptText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
    uploadHint: { fontSize: 11, color: colors.textSecondary },
    uploadedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
    uploadedText: { flex: 1, fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
    uploadChangeTap: { fontSize: 12, color: colors.primary, fontWeight: '700' },

    // Agreements
    agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
    checkbox: {
      width: 22, height: 22, borderRadius: 6,
      borderWidth: 1.5, borderColor: colors.border,
      backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
    },
    checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    agreeText: { flex: 1, fontSize: 13, color: colors.textPrimary, lineHeight: 20 },
    link: { color: colors.primary, fontWeight: '700' },

    // Review card
    reviewCard: {
      backgroundColor: colors.bgCard, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 20, gap: 6,
    },
    reviewCardTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
    reviewRow: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
    reviewKey: { fontWeight: '600', color: colors.textPrimary },

    // Primary button
    primaryBtn: {
      minHeight: 56, borderRadius: 28, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', marginTop: 6,
    },
    primaryBtnText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },

    // Footer
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20 },
    footerPrompt: { fontSize: 13, color: colors.textSecondary },
    footerAction: { fontSize: 13, fontWeight: '700', color: colors.primary },

    // Submitted
    submittedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    submittedIcon: {
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 24,
    },
    submittedTitle: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 12 },
    submittedBody: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 23 },
    submittedBtn: {
      marginTop: 32, backgroundColor: colors.primary, borderRadius: 28,
      paddingHorizontal: 32, paddingVertical: 16,
    },
    submittedBtnText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },

    flagsList: { width: '100%', gap: 8, marginTop: 20 },
    flagRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    flagText: { flex: 1, fontSize: 13, color: colors.red, lineHeight: 19 },
    reasoningCard: {
      marginTop: 16, backgroundColor: colors.bgSecondary,
      borderRadius: 12, padding: 14, width: '100%',
    },
    reasoningText: { fontSize: 13, color: colors.textSecondary, lineHeight: 20 },
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DriverSignUpScreen() {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const { upgrade } = useLocalSearchParams<{ upgrade?: string }>();
  const isUpgrade = upgrade === '1';
  const { riderProfile, refreshProfiles, switchRole } = useAuthStore();

  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<'idle' | 'uploading' | 'verifying' | 'done'>('idle');
  const [verificationResult, setVerificationResult] = useState<{
    decision: 'approved' | 'rejected' | 'requires_manual_review';
    flags: string[];
    reasoning: string;
    score: number;
  } | null>(null);

  // Step 1 – Personal info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [university, setUniversity] = useState<SignupUniversity | null>(null);
  const [dob, setDob] = useState('');

  // Pre-fill from rider profile when upgrading
  useEffect(() => {
    if (!isUpgrade) return;
    const user = firebaseAuth.currentUser;
    if (user?.email) setEmail(user.email);
    if (riderProfile) {
      if (riderProfile.firstName) setFirstName(riderProfile.firstName);
      if (riderProfile.lastName) setLastName(riderProfile.lastName);
      if (riderProfile.phone) setPhone(riderProfile.phone);
      if (riderProfile.university) setUniversity({ name: riderProfile.university, custom: true });
    }
  }, [isUpgrade, riderProfile]);

  // Step 2 – License
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseState, setLicenseState] = useState('TX');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [licenseFront, setLicenseFront] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [licenseBack, setLicenseBack] = useState<ImagePicker.ImagePickerAsset | null>(null);

  // Step 3 – Vehicle
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [seats, setSeats] = useState<'2' | '4' | '6'>('4');

  // Step 4 – Insurance
  const [insuranceCompany, setInsuranceCompany] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');
  const [insuranceDoc, setInsuranceDoc] = useState<DocAsset | null>(null);

  // Step 5 – Agreements
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedDriver, setAgreedDriver] = useState(false);
  const [agreedBackground, setAgreedBackground] = useState(false);
  const [confirmedStudent, setConfirmedStudent] = useState(false);

  const pickImage = async (setter: (a: ImagePicker.ImagePickerAsset) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access to upload documents.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled && result.assets[0]) setter(result.assets[0]);
  };

  const pickDocument = async (setter: (a: DocAsset) => void) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setter({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType ?? undefined });
    }
  };

  const validate = (): string => {
    if (step === 1) {
      if (!firstName.trim() || !lastName.trim()) return 'Enter your first and last name.';
      if (!validateEduEmail(email)) return 'Use a valid .edu student email.';
      if (!phone.trim()) return 'Enter your phone number.';
      if (!university?.name) return 'Select your university.';
      if (!parseDob(dob)) return 'Enter your date of birth as MM/DD/YYYY.';
      if (!isAdult(dob)) return 'You must be at least 18 years old to drive.';
    }
    if (step === 2) {
      if (!licenseNumber.trim()) return 'Enter your license number.';
      if (!licenseExpiry.trim()) return 'Enter your license expiry as MM/YYYY.';
      if (!isNotExpired(licenseExpiry)) return 'Your license must not be expired.';
      if (!licenseFront) return 'Upload the front of your driver\'s license.';
      if (!licenseBack) return 'Upload the back of your driver\'s license.';
    }
    if (step === 3) {
      if (!vehicleYear.trim() || isNaN(Number(vehicleYear))) return 'Enter a valid vehicle year.';
      if (!vehicleMake.trim()) return 'Enter your vehicle make.';
      if (!vehicleModel.trim()) return 'Enter your vehicle model.';
      if (!vehicleColor.trim()) return 'Enter your vehicle color.';
      if (!licensePlate.trim()) return 'Enter your license plate number.';
    }
    if (step === 4) {
      if (!insuranceCompany.trim()) return 'Enter your insurance company.';
      if (!policyNumber.trim()) return 'Enter your policy number.';
      if (!insuranceExpiry.trim()) return 'Enter your insurance expiry as MM/YYYY.';
      if (!isNotExpired(insuranceExpiry)) return 'Your insurance must not be expired.';
      if (!insuranceDoc) return 'Upload your insurance document.';
    }
    if (step === 5) {
      if (!agreedTerms) return 'You must agree to the Terms of Service and Privacy Policy.';
      if (!agreedDriver) return 'You must agree to the Driver Agreement.';
      if (!agreedBackground) return 'You must consent to document verification.';
      if (!confirmedStudent) return 'You must confirm your active student status.';
    }
    return '';
  };

  const advance = () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setStep((s) => s + 1);
  };

  const goBack = () => {
    setError('');
    if (step > 1) setStep((s) => s - 1);
    else router.back();
  };

  const submit = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setLoading(true);
    try {
      setProcessingStatus('uploading');
      const base = getApiBaseUrl();

      // Build multipart form — backend handles Storage upload via Admin SDK
      const form = new FormData();
      form.append('fullName', `${firstName.trim()} ${lastName.trim()}`);
      form.append('email', email.trim());
      form.append('phone', phone.trim());
      form.append('carMake', vehicleMake.trim());
      form.append('carModel', vehicleModel.trim());
      form.append('carYear', vehicleYear.trim());
      form.append('licensePlate', licensePlate.trim());
      form.append('carColor', vehicleColor.trim());
      form.append('university', university!.name);
      form.append('dateOfBirth', dob.trim());
      form.append('licenseNumber', licenseNumber.trim());
      form.append('licenseState', licenseState);
      form.append('licenseExpiry', licenseExpiry.trim());
      form.append('insuranceCompany', insuranceCompany.trim());
      form.append('policyNumber', policyNumber.trim());
      form.append('insuranceExpiry', insuranceExpiry.trim());
      form.append('seats', seats);
      form.append('licenseFront', fileField(licenseFront!, `license_front.${(licenseFront!.mimeType ?? 'image/jpeg').split('/')[1]}`) as any);
      form.append('licenseBack', fileField(licenseBack!, `license_back.${(licenseBack!.mimeType ?? 'image/jpeg').split('/')[1]}`) as any);
      form.append('insurance', fileField(insuranceDoc!, `insurance.${(insuranceDoc!.mimeType ?? 'application/pdf').split('/')[1]}`) as any);

      const submitHeaders: Record<string, string> = {};
      if (isUpgrade) {
        const idToken = await firebaseAuth.currentUser?.getIdToken();
        if (idToken) submitHeaders['Authorization'] = `Bearer ${idToken}`;
      }

      const submitRes = await fetch(`${base}/api/driver-applications/submit`, {
        method: 'POST',
        headers: submitHeaders,
        body: form,
      });

      const submitData = await submitRes.json() as { success?: boolean; applicationId?: string; error?: string };
      if (!submitRes.ok || !submitData.applicationId) {
        throw new Error(submitData.error ?? `Server error ${submitRes.status}`);
      }

      const applicationId = submitData.applicationId;

      // Backend triggers verification async — poll for result
      setProcessingStatus('verifying');
      let attempts = 0;
      const poll = async (): Promise<void> => {
        if (attempts >= 12) {
          setVerificationResult({ decision: 'requires_manual_review', flags: [], reasoning: '', score: 0 });
          setProcessingStatus('done');
          return;
        }
        attempts++;
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const pollRes = await fetch(`${base}/api/driver-applications/${applicationId}`);
          if (pollRes.ok) {
            const pollData = await pollRes.json() as { application?: { processingStatus?: string; verification?: { decision: string; flags: string[]; reasoning: string; score: number } } };
            const app = pollData.application;
            if (app?.processingStatus === 'complete' && app.verification) {
              setVerificationResult({
                decision: app.verification.decision as 'approved' | 'rejected' | 'requires_manual_review',
                flags: app.verification.flags ?? [],
                reasoning: app.verification.reasoning ?? '',
                score: app.verification.score ?? 0,
              });
              setProcessingStatus('done');
              return;
            }
          }
        } catch {}
        return poll();
      };
      await poll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Submission failed: ${msg}`);
      setProcessingStatus('idle');
    } finally {
      setLoading(false);
    }
  };

  // ── Processing overlay ───────────────────────────────────────────────────────
  if (processingStatus === 'uploading' || processingStatus === 'verifying') {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar style="auto" />
        <View style={s.submittedContainer}>
          <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 24 }} />
          <Text style={s.submittedTitle}>
            {processingStatus === 'uploading' ? 'Uploading documents…' : 'Verifying your application…'}
          </Text>
          <Text style={s.submittedBody}>
            {processingStatus === 'uploading'
              ? 'Securely uploading your license and insurance.'
              : 'Our system is reviewing your documents. This takes about 10–30 seconds.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Verification result ───────────────────────────────────────────────────────
  if (processingStatus === 'done' && verificationResult) {
    const { decision, flags, reasoning } = verificationResult;

    const isApproved = decision === 'approved';
    const isRejected = decision === 'rejected';

    const iconName = isApproved ? 'checkmark-circle' : isRejected ? 'close-circle' : 'time';
    const iconColor = isApproved ? colors.green : isRejected ? colors.red : colors.primary;
    const title = isApproved
      ? 'You\'re approved!'
      : isRejected
      ? 'Application not approved'
      : 'Under review';
    const body = isApproved
      ? isUpgrade
        ? `You're now approved as a RideAlong driver! Tap below to switch to driver mode and start earning.`
        : `Congrats! Check your email at ${email} for a link to set up your password and start driving.`
      : isRejected
      ? `Your application didn't pass our verification check. You can fix the issues below and reapply.`
      : isUpgrade
      ? `Your application is being reviewed by our team. We'll email you at ${email} within 24 hours.`
      : `Your application is being reviewed by our team. We'll email you at ${email} within 24 hours.`;

    const FLAG_LABELS: Record<string, string> = {
      expired_license: 'Driver\'s license appears to be expired',
      expired_insurance: 'Insurance policy appears to be expired',
      invalid_license_document: 'License document couldn\'t be read — try a clearer photo',
      invalid_insurance_document: 'Insurance document couldn\'t be read — try a clearer photo',
      name_mismatch: 'Name on documents doesn\'t match your application',
      car_mismatch: 'Vehicle details don\'t match your insurance document',
      missing_license_fields: 'License missing required information',
      missing_insurance_fields: 'Insurance missing required information',
      suspicious_document: 'Document flagged as potentially invalid',
      invalid_state: 'License state could not be verified',
    };

    return (
      <SafeAreaView style={s.safe}>
        <StatusBar style="auto" />
        <ScrollView contentContainerStyle={s.submittedContainer}>
          <View style={[s.submittedIcon, { backgroundColor: isApproved ? colors.greenDim : isRejected ? colors.redDim : colors.primaryDim }]}>
            <Ionicons name={iconName} size={56} color={iconColor} />
          </View>
          <Text style={s.submittedTitle}>{title}</Text>
          <Text style={s.submittedBody}>{body}</Text>

          {flags.length > 0 && (
            <View style={s.flagsList}>
              {flags.map((flag) => (
                <View key={flag} style={s.flagRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.red} />
                  <Text style={s.flagText}>{FLAG_LABELS[flag] ?? flag}</Text>
                </View>
              ))}
            </View>
          )}

          {reasoning && !isApproved && (
            <View style={s.reasoningCard}>
              <Text style={s.reasoningText}>{reasoning}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[s.submittedBtn, loading && { opacity: 0.6 }]}
            disabled={loading}
            onPress={async () => {
              if (isUpgrade && isApproved) {
                setLoading(true);
                try {
                  await refreshProfiles();
                  await switchRole('driver');
                  router.replace('/(driver)' as any);
                } catch {
                  router.replace('/(rider)' as any);
                } finally {
                  setLoading(false);
                }
              } else if (isUpgrade) {
                router.replace('/(rider)' as any);
              } else {
                router.replace('/(auth)/sign-in');
              }
            }}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.submittedBtnText}>
                {isApproved
                  ? isUpgrade ? 'Start driving →' : 'Go to sign in →'
                  : isRejected
                  ? isUpgrade ? 'Back to my profile' : 'Back to sign in'
                  : 'Got it'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const { title, accent } = STEPS[step - 1];
  const subtitle = isUpgrade && step === 1
    ? 'Your info is pre-filled from your rider account. Add your date of birth to continue.'
    : STEPS[step - 1].subtitle;
  const isLastStep = step === 5;

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="auto" />

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Step header */}
        <View style={s.stepHeader}>
          <TouchableOpacity style={s.backBtn} onPress={goBack} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={s.progressWrap}>
            <Text style={s.progressLabel}>STEP {step} OF 5</Text>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${step * 20}%` }]} />
            </View>
          </View>
        </View>

        {/* Heading */}
        <View style={s.headingWrap}>
          <Text style={s.headingTitle}>
            {title} <Text style={s.headingAccent}>{accent}</Text>
          </Text>
          <Text style={s.headingSubtitle}>{subtitle}</Text>
        </View>

        <ErrorBanner message={error} s={s} colors={colors} />

        {/* ── Step 1: Personal info ── */}
        {step === 1 && (
          <>
            <View style={s.nameRow}>
              <View style={s.nameField}>
                <Input label="FIRST NAME" value={firstName} onChangeText={setFirstName} placeholder="Melody" autoCapitalize="words" textContentType="givenName" s={s} colors={colors} />
              </View>
              <View style={s.nameField}>
                <Input label="LAST NAME" value={lastName} onChangeText={setLastName} placeholder="Adeyemi" autoCapitalize="words" textContentType="familyName" s={s} colors={colors} />
              </View>
            </View>
            <Input label="SCHOOL EMAIL" value={email} onChangeText={isUpgrade ? undefined : setEmail} placeholder="yourname@school.edu" keyboardType="email-address" textContentType="emailAddress" autoCapitalize="none" editable={!isUpgrade} s={s} colors={colors} />
            <Input label="PHONE NUMBER" value={phone} onChangeText={setPhone} placeholder="(512) 555-0123" keyboardType="phone-pad" textContentType="telephoneNumber" s={s} colors={colors} />
            <Field label="UNIVERSITY" s={s}>
              <View style={s.universityWrap}>
                <UniversitySearch value={university?.name ?? ''} onSelect={setUniversity} placeholder="Search your university" allowCustom />
              </View>
            </Field>
            <Input label="DATE OF BIRTH" value={dob} onChangeText={(v) => setDob(formatDobInput(v))} placeholder="MM/DD/YYYY" keyboardType="number-pad" s={s} colors={colors} />
          </>
        )}

        {/* ── Step 2: License ── */}
        {step === 2 && (
          <>
            <Input label="LICENSE NUMBER" value={licenseNumber} onChangeText={setLicenseNumber} placeholder="DL12345678" autoCapitalize="characters" s={s} colors={colors} />
            <View style={s.nameRow}>
              <View style={s.nameField}>
                <Input label="STATE ISSUED" value={licenseState} onChangeText={(v) => setLicenseState(v.toUpperCase())} placeholder="TX" autoCapitalize="characters" maxLength={2} s={s} colors={colors} />
              </View>
              <View style={[s.nameField, { flex: 2 }]}>
                <Input label="EXPIRY DATE" value={licenseExpiry} onChangeText={(v) => setLicenseExpiry(formatMonthYearInput(v))} placeholder="MM/YYYY" keyboardType="number-pad" s={s} colors={colors} />
              </View>
            </View>
            <ImageUploadField label="FRONT OF LICENSE" asset={licenseFront} onPick={() => pickImage(setLicenseFront)} s={s} colors={colors} />
            <ImageUploadField label="BACK OF LICENSE" asset={licenseBack} onPick={() => pickImage(setLicenseBack)} s={s} colors={colors} />
          </>
        )}

        {/* ── Step 3: Vehicle ── */}
        {step === 3 && (
          <>
            <View style={s.nameRow}>
              <View style={s.nameField}>
                <Input label="YEAR" value={vehicleYear} onChangeText={setVehicleYear} placeholder="2020" keyboardType="number-pad" maxLength={4} s={s} colors={colors} />
              </View>
              <View style={[s.nameField, { flex: 2 }]}>
                <Input label="MAKE" value={vehicleMake} onChangeText={setVehicleMake} placeholder="Honda" autoCapitalize="words" s={s} colors={colors} />
              </View>
            </View>
            <View style={s.nameRow}>
              <View style={[s.nameField, { flex: 2 }]}>
                <Input label="MODEL" value={vehicleModel} onChangeText={setVehicleModel} placeholder="Civic" autoCapitalize="words" s={s} colors={colors} />
              </View>
              <View style={s.nameField}>
                <Input label="COLOR" value={vehicleColor} onChangeText={setVehicleColor} placeholder="White" autoCapitalize="words" s={s} colors={colors} />
              </View>
            </View>
            <Input label="LICENSE PLATE" value={licensePlate} onChangeText={setLicensePlate} placeholder="ABC 1234" autoCapitalize="characters" s={s} colors={colors} />
            <Field label="AVAILABLE PASSENGER SEATS" s={s}>
              <View style={s.seatRow}>
                {SEAT_OPTIONS.map((opt) => (
                  <TouchableOpacity key={opt} style={[s.seatOption, seats === opt && s.seatOptionActive]} onPress={() => setSeats(opt)}>
                    <Text style={[s.seatText, seats === opt && s.seatTextActive]}>{opt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>
          </>
        )}

        {/* ── Step 4: Insurance ── */}
        {step === 4 && (
          <>
            <Input label="INSURANCE COMPANY" value={insuranceCompany} onChangeText={setInsuranceCompany} placeholder="State Farm" autoCapitalize="words" s={s} colors={colors} />
            <Input label="POLICY NUMBER" value={policyNumber} onChangeText={setPolicyNumber} placeholder="POL-123456789" autoCapitalize="characters" s={s} colors={colors} />
            <Input label="POLICY EXPIRY" value={insuranceExpiry} onChangeText={(v) => setInsuranceExpiry(formatMonthYearInput(v))} placeholder="MM/YYYY" keyboardType="number-pad" s={s} colors={colors} />
            <DocumentUploadField label="INSURANCE DOCUMENT" asset={insuranceDoc} onPick={() => pickDocument(setInsuranceDoc)} s={s} colors={colors} />
          </>
        )}

        {/* ── Step 5: Agreements ── */}
        {step === 5 && (
          <>
            <View style={s.reviewCard}>
              <Text style={s.reviewCardTitle}>Review your info</Text>
              <Text style={s.reviewRow}><Text style={s.reviewKey}>Name  </Text>{firstName} {lastName}</Text>
              <Text style={s.reviewRow}><Text style={s.reviewKey}>Email  </Text>{email}</Text>
              <Text style={s.reviewRow}><Text style={s.reviewKey}>School  </Text>{university?.name ?? '—'}</Text>
              <Text style={s.reviewRow}><Text style={s.reviewKey}>Vehicle  </Text>{vehicleYear} {vehicleMake} {vehicleModel} · {vehicleColor}</Text>
              <Text style={s.reviewRow}><Text style={s.reviewKey}>Plate  </Text>{licensePlate}</Text>
              <Text style={s.reviewRow}><Text style={s.reviewKey}>Insurance  </Text>{insuranceCompany}</Text>
            </View>

            <AgreementRow checked={agreedTerms} onToggle={() => setAgreedTerms((v) => !v)} s={s}>
              I agree to RideAlong's{' '}
              <Text style={s.link} onPress={() => router.push('/(auth)/terms' as any)}>Terms of Service</Text>
              {' '}&amp;{' '}
              <Text style={s.link} onPress={() => router.push('/(auth)/privacy' as any)}>Privacy Policy</Text>.
            </AgreementRow>
            <AgreementRow checked={agreedDriver} onToggle={() => setAgreedDriver((v) => !v)} s={s}>
              I agree to the RideAlong Driver Agreement and understand my responsibilities as a driver.
            </AgreementRow>
            <AgreementRow checked={agreedBackground} onToggle={() => setAgreedBackground((v) => !v)} s={s}>
              I consent to document verification and background review by the RideAlong team.
            </AgreementRow>
            <AgreementRow checked={confirmedStudent} onToggle={() => setConfirmedStudent((v) => !v)} s={s}>
              I confirm that I am an active student at the university listed above.
            </AgreementRow>
          </>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[s.primaryBtn, loading && { opacity: 0.6 }]}
          onPress={isLastStep ? () => void submit() : advance}
          disabled={loading}
          accessibilityRole="button"
        >
          {loading ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={s.primaryBtnText}>{isLastStep ? 'Submit application →' : 'Continue →'}</Text>
          )}
        </TouchableOpacity>

        {step === 1 && (
          <View style={s.footer}>
            <Text style={s.footerPrompt}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.replace('/(auth)/sign-in')} hitSlop={hitSlop}>
              <Text style={s.footerAction}>Sign in</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
