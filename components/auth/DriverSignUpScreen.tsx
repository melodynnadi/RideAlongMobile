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
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';

import { UniversitySearch } from '@/components/ui/UniversitySearch';
import { DatePickerModal } from '@/components/DateTimePickerModals';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
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

function validateEduEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim());
}

// Converts YYYY-MM-DD (from DatePickerModal) → MM/DD/YYYY for display and backend.
function isoToDisplay(ymd: string): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return '';
  return `${m}/${d}/${y}`;
}

// Converts YYYY-MM-DD → MM/YYYY for expiry backend fields.
function isoToMonthYear(ymd: string): string {
  if (!ymd) return '';
  const [y, m] = ymd.split('-');
  if (!y || !m) return '';
  return `${m}/${y}`;
}

function isAdult(isoDate: string): boolean {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return false;
  return (Date.now() - date.getTime()) / 86400000 >= 18 * 365.25;
}

function isNotExpired(isoDate: string): boolean {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  return !isNaN(date.getTime()) && date > new Date();
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

function DatePickerField({ label, value, placeholder = 'MM/DD/YYYY', onPress, s, colors }: {
  label: string;
  value: string;
  placeholder?: string;
  onPress: () => void;
  s: ReturnType<typeof makeStyles>;
  colors: AppColors;
}) {
  return (
    <Field label={label} s={s}>
      <TouchableOpacity
        style={[s.input, { flexDirection: 'row', alignItems: 'center' }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={{ flex: 1, fontSize: 15, color: value ? colors.textPrimary : colors.textSecondary }}>
          {value ? isoToDisplay(value) : placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
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
    flagsSoftHeader: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: 2 },
    flagRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    flagText: { flex: 1, fontSize: 13, color: colors.red, lineHeight: 19 },

    checklistCard: {
      marginTop: 20, backgroundColor: colors.bgSecondary,
      borderRadius: 14, padding: 16, width: '100%', gap: 8,
    },
    checklistTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
    checklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    checklistText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 19 },

    detailsToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 16 },
    detailsToggleText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    reasoningCard: {
      marginTop: 10, backgroundColor: colors.bgSecondary,
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
  const [checkingDriver, setCheckingDriver] = useState(true);
  const [processingStatus, setProcessingStatus] = useState<'idle' | 'uploading' | 'verifying' | 'done'>('idle');
  const [verificationResult, setVerificationResult] = useState<{
    decision: 'approved' | 'rejected' | 'requires_manual_review';
    flags: string[];
    reasoning: string;
    score: number;
  } | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Step 1 – Personal info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [university, setUniversity] = useState<SignupUniversity | null>(null);
  const [dob, setDob] = useState('');
  const [dobPickerOpen, setDobPickerOpen] = useState(false);

  // Fix 1: Redirect guard — if this user already has a drivers doc, they should not
  // be in the signup flow at all. Check once on mount before rendering the form.
  useEffect(() => {
    const user = firebaseAuth.currentUser;
    if (!user) { setCheckingDriver(false); return; }
    getDoc(doc(firestore, 'drivers', user.uid))
      .then((snap) => {
        if (snap.exists()) {
          router.replace('/(driver)' as any);
        } else {
          setCheckingDriver(false);
        }
      })
      .catch(() => setCheckingDriver(false));
  }, []);

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
  const [licenseExpiryPickerOpen, setLicenseExpiryPickerOpen] = useState(false);
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
  const [insuranceExpiryPickerOpen, setInsuranceExpiryPickerOpen] = useState(false);
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
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    // iOS photos are HEIC, which neither Google Vision nor OpenAI OCR can read —
    // convert to JPEG on-device so the license documents are actually verifiable.
    try {
      const jpegFormat = (ImageManipulator as any)?.SaveFormat?.JPEG || 'jpeg';
      const converted = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.85, format: jpegFormat as any },
      );
      setter({ ...asset, uri: converted.uri, mimeType: 'image/jpeg', fileName: 'license.jpg' } as ImagePicker.ImagePickerAsset);
    } catch {
      setter(asset);
    }
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
      if (!dob) return 'Select your date of birth.';
      if (!isAdult(dob)) return 'You must be at least 18 years old to drive.';
    }
    if (step === 2) {
      if (!licenseNumber.trim()) return 'Enter your license number.';
      if (!licenseExpiry) return 'Select your license expiry date.';
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
      if (!insuranceExpiry) return 'Select your insurance expiry date.';
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
      form.append('dateOfBirth', isoToDisplay(dob));
      form.append('licenseNumber', licenseNumber.trim());
      form.append('licenseState', licenseState);
      form.append('licenseExpiry', isoToMonthYear(licenseExpiry));
      form.append('insuranceCompany', insuranceCompany.trim());
      form.append('policyNumber', policyNumber.trim());
      form.append('insuranceExpiry', isoToMonthYear(insuranceExpiry));
      form.append('seats', seats);
      form.append('licenseFront', fileField(licenseFront!, `license_front.${(licenseFront!.mimeType ?? 'image/jpeg').split('/')[1]}`) as any);
      form.append('licenseBack', fileField(licenseBack!, `license_back.${(licenseBack!.mimeType ?? 'image/jpeg').split('/')[1]}`) as any);
      form.append('insurance', fileField(insuranceDoc!, `insurance.${(insuranceDoc!.mimeType ?? 'application/pdf').split('/')[1]}`) as any);

      // Fix 2: Detect stale driver records — a document in 'drivers' that matches
      // this email but belongs to a deleted Auth user (different UID). When found,
      // tell the backend which stale document to overwrite so it doesn't block
      // re-registration with "Already a driver".
      let staleDriverId: string | null = null;
      try {
        const staleSnap = await getDocs(
          query(collection(firestore, 'drivers'), where('email', '==', email.trim()))
        );
        const currentUid = firebaseAuth.currentUser?.uid;
        staleSnap.forEach((d) => {
          if (d.id !== currentUid) staleDriverId = d.id;
        });
      } catch { /* ignore — stale check is best-effort */ }

      if (staleDriverId) {
        form.append('staleDriverId', staleDriverId);
      }

      // Always send the auth token so the backend can verify the submitting user
      // and, in the stale case, confirm the UID mismatch and allow the overwrite.
      const submitHeaders: Record<string, string> = {};
      const idToken = await firebaseAuth.currentUser?.getIdToken();
      if (idToken) submitHeaders['Authorization'] = `Bearer ${idToken}`;

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
            const pollData = await pollRes.json() as { application?: { status?: string; processingStatus?: string; rejectionReason?: string; verification?: { decision: string; flags: string[]; reasoning: string; score: number } } };
            const app = pollData.application;
            const isDone = app?.processingStatus === 'complete'
              || app?.status === 'approved'
              || app?.status === 'rejected';
            if (isDone) {
              // Prefer the verification sub-object if present, otherwise derive from status field
              const decision: 'approved' | 'rejected' | 'requires_manual_review' =
                app?.verification?.decision as any
                ?? (app?.status === 'approved' ? 'approved'
                  : app?.status === 'rejected' ? 'rejected'
                  : 'requires_manual_review');
              setVerificationResult({
                decision,
                flags: app?.verification?.flags ?? (app?.rejectionReason ? [app.rejectionReason] : []),
                reasoning: app?.verification?.reasoning ?? app?.rejectionReason ?? '',
                score: app?.verification?.score ?? 0,
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
    const isReview = !isApproved && !isRejected;

    // Orange for approved/review, red only for outright rejection — so the two
    // states feel emotionally distinct.
    const accent = isApproved ? colors.green : isRejected ? colors.red : colors.primary;
    const accentDim = isApproved ? colors.greenDim : isRejected ? colors.redDim : colors.primaryDim;
    const iconName = isApproved ? 'checkmark-circle' : isRejected ? 'close-circle' : 'time';
    const title = isApproved ? 'You\'re approved!' : isRejected ? 'Application not approved' : 'Application received';
    const body = isApproved
      ? isUpgrade
        ? `You're now approved as a RideAlong driver! Tap below to switch to driver mode and start earning.`
        : `Congrats! Check your email at ${email} for a link to set up your password and start driving.`
      : isRejected
      ? `Your documents didn't pass our automated checks. Fix the issues below and reapply — it only takes a minute.`
      : `Thanks! Our team is reviewing your documents. We'll email you at ${email} within 24 hours.`;

    // Human, action-first messages — tell the user what to DO, not what our OCR thinks.
    const FLAG_LABELS: Record<string, string> = {
      expired_license: 'Your license looks expired — upload a current one',
      expired_insurance: 'Your insurance looks expired — upload a current policy',
      invalid_license_document: 'We couldn\'t read your license — upload a clearer, well-lit photo',
      invalid_insurance_document: 'We couldn\'t read your insurance — upload a clearer photo of the full card',
      name_mismatch: 'The name on your documents doesn\'t match your application',
      car_mismatch: 'Your vehicle details don\'t match your insurance',
      missing_license_fields: 'Retake your license photo with all four corners visible',
      missing_insurance_fields: 'Upload the full insurance document (policy number must show)',
      suspicious_document: 'A document couldn\'t be verified — please re-upload it',
      invalid_state: 'We couldn\'t verify your license state — upload a clearer photo',
    };

    const CHECKLIST = [
      'All four corners of your license are visible',
      'Good lighting, no glare or shadows',
      'Insurance card is current and shows the policy number',
    ];

    return (
      <SafeAreaView style={s.safe}>
        <StatusBar style="auto" />
        <ScrollView contentContainerStyle={s.submittedContainer}>
          <View style={[s.submittedIcon, { backgroundColor: accentDim }]}>
            <Ionicons name={iconName} size={56} color={accent} />
          </View>
          <Text style={s.submittedTitle}>{title}</Text>
          <Text style={s.submittedBody}>{body}</Text>

          {/* Issues — red + urgent for rejection, soft + optional for review */}
          {!isApproved && flags.length > 0 && (
            <View style={s.flagsList}>
              {isReview && (
                <Text style={s.flagsSoftHeader}>A couple of things may speed up your approval:</Text>
              )}
              {flags.map((flag) => (
                <View key={flag} style={s.flagRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={isRejected ? colors.red : colors.primary} style={{ marginTop: 1 }} />
                  <Text style={[s.flagText, { color: isRejected ? colors.red : colors.textSecondary }]}>{FLAG_LABELS[flag] ?? flag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Photo checklist — helps them not fail again */}
          {!isApproved && (
            <View style={s.checklistCard}>
              <Text style={s.checklistTitle}>For the fastest approval, check:</Text>
              {CHECKLIST.map((item) => (
                <View key={item} style={s.checklistRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.green} style={{ marginTop: 1 }} />
                  <Text style={s.checklistText}>{item}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Raw AI explanation — collapsed, for the curious only */}
          {reasoning && !isApproved && (
            <>
              <TouchableOpacity onPress={() => setShowDetails((v) => !v)} hitSlop={hitSlop} style={s.detailsToggle}>
                <Text style={s.detailsToggleText}>{showDetails ? 'Hide details' : 'Show details'}</Text>
                <Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
              </TouchableOpacity>
              {showDetails && (
                <View style={s.reasoningCard}>
                  <Text style={s.reasoningText}>{reasoning}</Text>
                </View>
              )}
            </>
          )}

          <TouchableOpacity
            style={[s.submittedBtn, loading && { opacity: 0.6 }]}
            disabled={loading}
            onPress={async () => {
              if (isRejected) {
                // Let them fix documents and resubmit without losing their info.
                setShowDetails(false);
                setVerificationResult(null);
                setProcessingStatus('idle');
                setStep(2);
                return;
              }
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
                  ? 'Fix & reapply'
                  : 'Got it'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Show a blank loading screen while we verify the user doesn't already have a
  // driver profile. This prevents the form from flashing before the redirect.
  if (checkingDriver) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar style="auto" />
        <View style={s.submittedContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
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
                <Input label="FIRST NAME" value={firstName} onChangeText={setFirstName} placeholder="First Name" autoCapitalize="words" textContentType="givenName" s={s} colors={colors} />
              </View>
              <View style={s.nameField}>
                <Input label="LAST NAME" value={lastName} onChangeText={setLastName} placeholder="Last Name" autoCapitalize="words" textContentType="familyName" s={s} colors={colors} />
              </View>
            </View>
            <Input label="SCHOOL EMAIL" value={email} onChangeText={isUpgrade ? undefined : setEmail} placeholder="yourname@school.edu" keyboardType="email-address" textContentType="emailAddress" autoCapitalize="none" editable={!isUpgrade} s={s} colors={colors} />
            <Input label="PHONE NUMBER" value={phone} onChangeText={setPhone} placeholder="(000) 000-0000" keyboardType="phone-pad" textContentType="telephoneNumber" s={s} colors={colors} />
            <Field label="UNIVERSITY" s={s}>
              <View style={s.universityWrap}>
                <UniversitySearch value={university?.name ?? ''} onSelect={setUniversity} placeholder="Search your university" allowCustom />
              </View>
            </Field>
            <DatePickerField label="DATE OF BIRTH" value={dob} onPress={() => setDobPickerOpen(true)} s={s} colors={colors} />
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
                <DatePickerField label="EXPIRY DATE" value={licenseExpiry} placeholder="MM/DD/YYYY" onPress={() => setLicenseExpiryPickerOpen(true)} s={s} colors={colors} />
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
            <DatePickerField label="POLICY EXPIRY" value={insuranceExpiry} placeholder="MM/DD/YYYY" onPress={() => setInsuranceExpiryPickerOpen(true)} s={s} colors={colors} />
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
              I agree to RideAlong&apos;s{' '}
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

      {/* Date pickers — rendered as modals outside the scroll view */}
      <DatePickerModal
        visible={dobPickerOpen}
        selectedDate={dob}
        maxDate={(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 18); return d.toISOString().split('T')[0]; })()}
        initialDisplayDate={(() => { const d = new Date(); d.setFullYear(d.getFullYear() - 25); return d.toISOString().split('T')[0]; })()}
        title="Date of birth"
        onClose={() => setDobPickerOpen(false)}
        onSelect={(v) => { setDob(v); setDobPickerOpen(false); }}
      />
      <DatePickerModal
        visible={licenseExpiryPickerOpen}
        selectedDate={licenseExpiry}
        minDate={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })()}
        title="License expiry"
        onClose={() => setLicenseExpiryPickerOpen(false)}
        onSelect={(v) => { setLicenseExpiry(v); setLicenseExpiryPickerOpen(false); }}
      />
      <DatePickerModal
        visible={insuranceExpiryPickerOpen}
        selectedDate={insuranceExpiry}
        minDate={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })()}
        title="Insurance expiry"
        onClose={() => setInsuranceExpiryPickerOpen(false)}
        onSelect={(v) => { setInsuranceExpiry(v); setInsuranceExpiryPickerOpen(false); }}
      />
    </SafeAreaView>
  );
}
