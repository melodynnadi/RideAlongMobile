import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
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
import { sendPasswordResetEmail } from 'firebase/auth';
import { StatusBar } from 'expo-status-bar';

import { UniversitySearch } from '@/components/ui/UniversitySearch';
import { firebaseAuth } from '@/constants/services';
import { getAuthErrorMessage, type SignupUniversity } from '@/services/authSignup';
import { useAuthStore } from '@/stores/authStore';
import { hitSlop } from '@/theme/designSystem';
import { WebView } from 'react-native-webview';
import { useAppTheme } from '@/hooks/ThemeContext';
import { AppColors } from '@/constants/theme';

type Role = 'rider' | 'driver' | 'both';

// ─── Styles factory ───────────────────────────────────────────────────────────

function useStyles(colors: AppColors) {
  return useMemo(
    () =>
      StyleSheet.create({
        flex: { flex: 1 },
        safe: { flex: 1, backgroundColor: colors.bg },
        scrollContent: {
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
          paddingHorizontal: 24,
          paddingTop: 100,
          paddingBottom: 40,
          flexGrow: 1,
        },

        // Brand mark
        brandMark: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
        brandMarkText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

        backButton: {
          width: 40,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        },

        // Heading
        heading: { marginBottom: 28 },
        title: { color: colors.textPrimary, fontSize: 38, lineHeight: 46, fontWeight: '600', letterSpacing: -0.75 },
        titleAccent: { color: colors.primary, fontStyle: 'italic' },
        subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 10 },

        // Segmented control (sign-in rider/driver toggle)
        segmentedControl: {
          flexDirection: 'row',
          backgroundColor: colors.bgSecondary,
          borderRadius: 28,
          padding: 4,
          marginBottom: 24,
        },
        segmentOption: {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          paddingVertical: 11,
          borderRadius: 24,
        },
        segmentOptionActive: {
          backgroundColor: colors.bgCard,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.08,
          shadowRadius: 4,
          elevation: 2,
        },
        segmentText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
        segmentTextActive: { color: colors.textPrimary, fontWeight: '700' },

        // Progress
        progressRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
        progressLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
        progressTrack: { flex: 1, height: 2, backgroundColor: colors.border, borderRadius: 1 },
        progressFill: { height: 2, backgroundColor: colors.primary, borderRadius: 1 },

        // Inputs
        field: { marginBottom: 16 },
        fieldLabel: {
          color: colors.textSecondary,
          fontSize: 10,
          lineHeight: 14,
          fontWeight: '700',
          letterSpacing: 1.5,
          marginBottom: 8,
        },
        inputWrap: {
          minHeight: 56,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          gap: 8,
        },
        inputError: { borderColor: colors.red },
        input: { flex: 1, minWidth: 0, color: colors.textPrimary, fontSize: 16, paddingVertical: 0, textAlignVertical: 'center' },
        errorText: { color: colors.red, fontSize: 12, lineHeight: 17, marginTop: 5 },

        // Buttons
        primaryButton: {
          minHeight: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 6,
        },
        primaryButtonText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
        secondaryButton: {
          minHeight: 54,
          borderRadius: 27,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 12,
        },
        secondaryButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
        buttonDisabled: { opacity: 0.55 },

        // Remember me row
        rememberRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: -4,
          marginBottom: 20,
        },
        rememberLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        rememberText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
        forgotText: { color: colors.primary, fontSize: 13, fontWeight: '700' },

        // Checkbox
        checkbox: {
          width: 20,
          height: 20,
          borderRadius: 5,
          borderWidth: 1.25,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          alignItems: 'center',
          justifyContent: 'center',
        },
        checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },

        // Footer / inline links
        signInFooter: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          marginTop: 24,
        },
        footerPrompt: { color: colors.textSecondary, fontSize: 13 },
        footerAction: { color: colors.primary, fontSize: 13, fontWeight: '700' },
        footerDot: { color: colors.textSecondary, fontSize: 13 },

        // Sign up
        signupStepHeader: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          marginBottom: 24,
        },
        stepBackBtn: {
          width: 38,
          height: 38,
          borderRadius: 19,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
        nameRow: { flexDirection: 'row', gap: 10 },
        nameField: { flex: 1 },
        universityWrap: { borderRadius: 14, overflow: 'hidden' },
        termsRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          paddingVertical: 4,
          marginBottom: 14,
        },
        termsText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
        termsLink: { color: colors.primary, fontWeight: '700' },

        // Error / success
        errorBanner: {
          borderRadius: 12,
          backgroundColor: colors.redDim,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 9,
          padding: 13,
          marginBottom: 16,
        },
        errorBannerText: { flex: 1, color: colors.red, fontSize: 13, lineHeight: 19 },
        successCard: {
          borderRadius: 12,
          backgroundColor: colors.greenDim,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          padding: 13,
          marginBottom: 16,
        },
        successTitle: { color: colors.green, fontSize: 14, fontWeight: '700' },
        successText: { color: colors.green, fontSize: 12, lineHeight: 18, marginTop: 2 },

        // Select role
        roleList: { gap: 12 },
        roleCard: {
          minHeight: 80,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          padding: 16,
          overflow: 'hidden',
        },
        roleCardRecommended: {
          borderColor: colors.primary,
          borderWidth: 1.5,
          backgroundColor: colors.primaryDim,
        },
        recommendedBadge: {
          position: 'absolute',
          top: 0,
          right: 0,
          backgroundColor: colors.primary,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderBottomLeftRadius: 10,
        },
        recommendedBadgeText: {
          color: colors.textInverse,
          fontSize: 9,
          fontWeight: '800',
          letterSpacing: 0.6,
        },
        roleIcon: {
          width: 46,
          height: 46,
          borderRadius: 12,
          backgroundColor: colors.primaryDim,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
        roleIconRecommended: { backgroundColor: colors.primaryDim },
        roleCopy: { flex: 1 },
        roleTitle: { color: colors.textPrimary, fontSize: 16, lineHeight: 22, fontWeight: '700' },
        roleSubtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 2 },
        infoNote: {
          borderRadius: 12,
          backgroundColor: colors.primaryDim,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 8,
          padding: 13,
          marginTop: 20,
        },
        infoNoteText: { flex: 1, color: colors.primary, fontSize: 12, lineHeight: 18 },

        // Verify email
        verifyCard: {
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          padding: 18,
          gap: 16,
          marginBottom: 24,
        },
        verifyStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
        stepNumber: {
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: colors.primaryDim,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
        stepNumberText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
        verifyStepText: { flex: 1, color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '600' },
        openMailRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginTop: 14,
        },
        openMailText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
        verifyFooter: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          marginTop: 24,
        },

        // Forgot password
        spamNote: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          marginTop: 20,
          padding: 13,
          borderRadius: 12,
          backgroundColor: colors.primaryDim,
        },
        spamNoteText: { flex: 1, color: colors.primary, fontSize: 12, lineHeight: 18 },

        // Legal screen shell
        legalSafe: { flex: 1, backgroundColor: colors.bg },
        legalHeader: {
          flexDirection: 'row', alignItems: 'center', gap: 14,
          paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14,
          borderBottomWidth: 1, borderBottomColor: colors.border,
          backgroundColor: colors.bgCard,
        },
        legalBackBtn: {
          width: 38, height: 38, borderRadius: 19,
          borderWidth: 1, borderColor: colors.border,
          backgroundColor: colors.bg,
          alignItems: 'center', justifyContent: 'center',
        },
        legalHeaderTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, lineHeight: 20 },
        legalHeaderSub: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
        legalScroll: { flex: 1 },
        legalContent: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 48 },
        legalEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
        legalEmptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
        legalEmptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center' },

        // Markdown renderer
        mdH1: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.5, lineHeight: 32, marginBottom: 6 },
        mdH2Wrap: { marginTop: 28, marginBottom: 10 },
        mdH2: { fontSize: 15, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
        mdH2Line: { height: 1, backgroundColor: colors.border },
        mdH3: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: 16, marginBottom: 6 },
        mdBullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6, paddingLeft: 4 },
        mdBulletDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary, marginTop: 8, flexShrink: 0 },
        mdBulletText: { flex: 1, fontSize: 14, lineHeight: 22, color: colors.textPrimary },
        mdParagraph: { fontSize: 14, lineHeight: 22, color: colors.textSecondary, marginBottom: 12 },
        legalLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
        legalWebView: { flex: 1 },
      }),
    [colors],
  );
}

// ─── Brand mark ──────────────────────────────────────────────────────────────

// ─── Shell ───────────────────────────────────────────────────────────────────

function BrandMark() {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  return (
    <View style={styles.brandMark}>
      <Ionicons name="location" size={20} color={colors.primary} />
      <Text style={styles.brandMarkText}>RideAlong</Text>
    </View>
  );
}

function AuthShell({ children, back = false, showBrand = false }: { children: React.ReactNode; back?: boolean; showBrand?: boolean }) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {showBrand ? <BrandMark /> : null}
          {back ? (
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={hitSlop}
            >
              <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function Heading({ title, accent, subtitle }: { title: string; accent?: string; subtitle: string }) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  return (
    <View style={styles.heading}>
      <Text style={styles.title}>
        {title}
        {accent ? <Text style={styles.titleAccent}> {accent}</Text> : null}
      </Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

function StepProgress({ current, style }: { current: number; style?: object }) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  return (
    <View style={[styles.progressRow, style]}>
      <Text style={styles.progressLabel}>STEP {current} OF 3</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${current * 33.333}%` }]} />
      </View>
    </View>
  );
}

type AuthInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  textContentType?: React.ComponentProps<typeof TextInput>['textContentType'];
  autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize'];
  secure?: boolean;
  error?: string;
};

function AuthInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  textContentType,
  autoCapitalize = 'none',
  secure,
  error,
}: AuthInputProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  const [hidden, setHidden] = useState(Boolean(secure));
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error ? styles.inputError : null]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={keyboardType}
          textContentType={textContentType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          secureTextEntry={secure ? hidden : false}
        />
        {secure ? (
          <TouchableOpacity
            onPress={() => setHidden((c) => !c)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={hitSlop}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={19} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  return (
    <TouchableOpacity
      style={[styles.primaryButton, (disabled || loading) && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
    >
      {loading ? (
        <ActivityIndicator color={colors.textInverse} />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function SecondaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  return (
    <TouchableOpacity
      style={[styles.secondaryButton, (disabled || loading) && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator color={colors.textPrimary} />
      ) : (
        <Text style={styles.secondaryButtonText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateEduEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim());
}

function passwordError(password: string) {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    return 'Include at least one letter and one number.';
  return '';
}

// ─── Sign In ─────────────────────────────────────────────────────────────────

export function SignInScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  const { signIn } = useAuthStore();
  const params = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<'rider' | 'driver'>(
    params.role === 'driver' ? 'driver' : 'rider',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      await signIn(email, password, role);
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <Heading
        title="Welcome"
        accent="back."
        subtitle={role === 'driver' ? 'Sign in to manage your routes and earnings.' : 'Sign in with your verified .edu email.'}
      />

      {/* Segmented Rider / Driver toggle */}
      <View style={styles.segmentedControl}>
        {(['rider', 'driver'] as const).map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.segmentOption, role === r && styles.segmentOptionActive]}
            onPress={() => { setRole(r); setError(''); }}
            accessibilityRole="button"
            accessibilityState={{ selected: role === r }}
          >
            <Ionicons
              name={r === 'rider' ? 'person-outline' : 'car-outline'}
              size={15}
              color={role === r ? colors.primary : colors.textSecondary}
            />
            <Text style={[styles.segmentText, role === r && styles.segmentTextActive]}>
              {r === 'rider' ? 'Rider' : 'Driver'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={18} color={colors.red} />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      <AuthInput
        label="SCHOOL EMAIL"
        value={email}
        onChangeText={setEmail}
        placeholder="name@school.edu"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <AuthInput
        label="PASSWORD"
        value={password}
        onChangeText={setPassword}
        placeholder="Enter your password"
        textContentType="password"
        secure
      />

      <View style={styles.rememberRow}>
        <TouchableOpacity
          style={styles.rememberLeft}
          onPress={() => setRememberMe((c) => !c)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rememberMe }}
        >
          <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
            {rememberMe ? <Ionicons name="checkmark" size={13} color={colors.textInverse} /> : null}
          </View>
          <Text style={styles.rememberText}>Remember me</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')} hitSlop={hitSlop}>
          <Text style={styles.forgotText}>Forgot password?</Text>
        </TouchableOpacity>
      </View>

      <PrimaryButton label="Log in →" onPress={() => void submit()} loading={loading} />

      <View style={styles.signInFooter}>
        <Text style={styles.footerPrompt}>New here?</Text>
        <TouchableOpacity onPress={() => router.push('/(auth)/select-role')} hitSlop={hitSlop}>
          <Text style={styles.footerAction}>Sign up</Text>
        </TouchableOpacity>
        <Text style={styles.footerDot}>·</Text>
        {role === 'driver' ? (
          <TouchableOpacity onPress={() => { setRole('rider'); setError(''); }} hitSlop={hitSlop}>
            <Text style={styles.footerAction}>Just riding?</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => router.push('/(auth)/driver-signup')} hitSlop={hitSlop}>
            <Text style={styles.footerAction}>Want to drive?</Text>
          </TouchableOpacity>
        )}
      </View>
    </AuthShell>
  );
}

// ─── Sign Up ─────────────────────────────────────────────────────────────────


const SIGNUP_STEPS = [
  { step: 1, title: 'Create your', accent: 'account.', subtitle: '.edu email required. We verify everyone — keeps the rides safe.' },
  { step: 2, title: 'Your', accent: 'school.', subtitle: 'Tell us where you study so we can match you with students nearby.' },
  { step: 3, title: 'Lock', accent: 'it in.', subtitle: 'Create a secure password to protect your account.' },
];

export function SignUpScreen({ forcedRole }: { forcedRole?: Role }) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  const params = useLocalSearchParams<{ role?: string }>();
  const requestedRole = Array.isArray(params.role) ? params.role[0] : params.role;
  const role: Role = forcedRole || (requestedRole === 'driver' || requestedRole === 'both' ? requestedRole : 'rider');
  const { signUp } = useAuthStore();

  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [university, setUniversity] = useState<SignupUniversity | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const { title, accent, subtitle } = SIGNUP_STEPS[step - 1];

  const advanceStep = () => {
    setFormError('');
    if (step === 1) {
      if (!firstName.trim() || !lastName.trim()) { setFormError('Enter your first and last name.'); return; }
      if (!validateEduEmail(email)) { setFormError('Use a valid .edu student email.'); return; }
      setStep(2);
    } else if (step === 2) {
      if (!university?.name) { setFormError('Select your university.'); return; }
      setStep(3);
    }
  };

  const submit = async () => {
    const pwErr = passwordError(password);
    if (pwErr) { setFormError(pwErr); return; }
    if (password !== confirmPassword) { setFormError('Passwords do not match.'); return; }
    if (!accepted) { setFormError('Accept the Terms and Privacy Policy to continue.'); return; }
    try {
      setLoading(true);
      setFormError('');
      await signUp({
        email,
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        university: university!.name,
        universityData: university!,
        role,
      });
      router.replace('/(auth)/verify-email');
    } catch (submitError) {
      setFormError(getAuthErrorMessage(submitError, 'sign-up'));
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setFormError('');
    if (step > 1) setStep((s) => s - 1);
    else router.back();
  };

  return (
    <AuthShell>
      {/* Step header */}
      <View style={styles.signupStepHeader}>
        <TouchableOpacity style={styles.stepBackBtn} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={hitSlop}>
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <StepProgress current={step} style={{ flex: 1, marginBottom: 0 }} />
      </View>

      <Heading title={title} accent={accent} subtitle={subtitle} />

      {formError ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={18} color={colors.red} />
          <Text style={styles.errorBannerText}>{formError}</Text>
        </View>
      ) : null}

      {/* ── Step 1: name + email ── */}
      {step === 1 ? (
        <>
          <View style={styles.nameRow}>
            <View style={styles.nameField}>
              <AuthInput label="FIRST NAME" value={firstName} onChangeText={setFirstName} placeholder="Melody" autoCapitalize="words" textContentType="givenName" />
            </View>
            <View style={styles.nameField}>
              <AuthInput label="LAST NAME" value={lastName} onChangeText={setLastName} placeholder="Adeyemi" autoCapitalize="words" textContentType="familyName" />
            </View>
          </View>
          <AuthInput label="SCHOOL EMAIL" value={email} onChangeText={setEmail} placeholder="yourname@school.edu" keyboardType="email-address" textContentType="emailAddress" />
          <PrimaryButton label="Continue →" onPress={advanceStep} />
        </>
      ) : null}

      {/* ── Step 2: university + phone ── */}
      {step === 2 ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>UNIVERSITY</Text>
            <View style={styles.universityWrap}>
              <UniversitySearch value={university?.name || ''} onSelect={(s) => setUniversity(s)} placeholder="Search your university" allowCustom />
            </View>
          </View>
          <AuthInput label="PHONE (OPTIONAL)" value={phone} onChangeText={setPhone} placeholder="(512) 555-0123" keyboardType="phone-pad" textContentType="telephoneNumber" />
          <PrimaryButton label="Continue →" onPress={advanceStep} />
        </>
      ) : null}

      {/* ── Step 3: password + terms ── */}
      {step === 3 ? (
        <>
          <AuthInput label="CREATE A PASSWORD" value={password} onChangeText={setPassword} placeholder="8+ characters" textContentType="newPassword" secure />
          <AuthInput label="CONFIRM PASSWORD" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter it again" textContentType="newPassword" secure />
          <View style={styles.termsRow}>
            <TouchableOpacity onPress={() => setAccepted((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
              <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
                {accepted ? <Ionicons name="checkmark" size={13} color={colors.textInverse} /> : null}
              </View>
            </TouchableOpacity>
            <Text style={styles.termsText}>
              I agree to RideAlong&apos;s{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/(auth)/terms' as any)}>Terms</Text>
              {' '}&amp;{' '}
              <Text style={styles.termsLink} onPress={() => router.push('/(auth)/privacy' as any)}>Privacy</Text>.
            </Text>
          </View>
          <PrimaryButton label="Create account →" onPress={() => void submit()} loading={loading} />
        </>
      ) : null}

      <View style={styles.signInFooter}>
        <Text style={styles.footerPrompt}>Already have an account?</Text>
        <TouchableOpacity onPress={() => router.replace('/(auth)/sign-in')} hitSlop={hitSlop}>
          <Text style={styles.footerAction}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </AuthShell>
  );
}

export { DriverSignUpScreen } from './DriverSignUpScreen';

// ─── Select role ─────────────────────────────────────────────────────────────

const ROLE_OPTIONS: {
  role: Role;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  recommended?: boolean;
}[] = [
  { role: 'rider', title: 'I need a ride', subtitle: 'Find verified students heading your way.', icon: 'people-outline' },
  { role: 'driver', title: "I'm driving", subtitle: 'Fill empty seats, split gas.', icon: 'car-outline' },
];

export function SelectRoleScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  const choose = (role: Role) => {
    if (role === 'driver') router.push('/(auth)/driver-signup');
    else router.push({ pathname: '/(auth)/sign-up', params: { role } });
  };

  return (
    <AuthShell>
      <Heading
        title="How are you"
        accent="riding along?"
        subtitle="You can switch later — same account, two modes."
      />

      <View style={styles.roleList}>
        {ROLE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.role}
            style={styles.roleCard}
            onPress={() => choose(option.role)}
            accessibilityRole="button"
          >
            <View style={styles.roleIcon}>
              <Ionicons name={option.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.roleCopy}>
              <Text style={styles.roleTitle}>{option.title}</Text>
              <Text style={styles.roleSubtitle}>{option.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.infoNote}>
        <Ionicons name="information-circle-outline" size={17} color={colors.primary} />
        <Text style={styles.infoNoteText}>
          Both modes require .edu verification. Takes &lt; 24 hours.
        </Text>
      </View>

      <View style={styles.signInFooter}>
        <Text style={styles.footerPrompt}>Already registered?</Text>
        <TouchableOpacity onPress={() => router.replace('/(auth)/sign-in')} hitSlop={hitSlop}>
          <Text style={styles.footerAction}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </AuthShell>
  );
}

// ─── Verify email ─────────────────────────────────────────────────────────────

export function VerifyEmailScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  const { email, checkEmailVerification, sendVerificationEmail, signOut } = useAuthStore();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const check = async () => {
    try {
      setChecking(true);
      const verified = await checkEmailVerification();
      if (!verified)
        Alert.alert(
          'Not verified yet',
          'Open the link we sent to your inbox, then come back and try again.',
        );
    } finally {
      setChecking(false);
    }
  };

  const resend = async () => {
    if (cooldown) return;
    try {
      setResending(true);
      await sendVerificationEmail();
      setCooldown(45);
      Alert.alert('Email sent', 'Check your inbox and spam folder.');
    } catch (resendError) {
      Alert.alert('Could not resend', getAuthErrorMessage(resendError, 'sign-up'));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell>
      <Heading
        title="Check your"
        accent="inbox."
        subtitle={`We sent a verification link to ${email || 'your school email'}. Drop it in below.`}
      />

      <View style={styles.verifyCard}>
        {[
          { icon: 'mail-open-outline' as const, text: 'Open the email from RideAlong' },
          { icon: 'link-outline' as const, text: 'Tap the verification link' },
          { icon: 'checkmark-circle-outline' as const, text: 'Return here and confirm' },
        ].map((step, index) => (
          <View key={step.text} style={styles.verifyStep}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{index + 1}</Text>
            </View>
            <Text style={styles.verifyStepText}>{step.text}</Text>
          </View>
        ))}
      </View>

      <PrimaryButton
        label="Confirm →"
        onPress={() => void check()}
        loading={checking}
      />

      <SecondaryButton
        label={cooldown ? `Resend link (${cooldown}s)` : 'Resend link'}
        onPress={() => void resend()}
        loading={resending}
        disabled={cooldown > 0}
      />

      <TouchableOpacity
        style={styles.openMailRow}
        onPress={() => Linking.openURL('mailto:')}
      >
        <Ionicons name="open-outline" size={15} color={colors.primary} />
        <Text style={styles.openMailText}>Open mail app</Text>
      </TouchableOpacity>

      <View style={styles.verifyFooter}>
        <Text style={styles.footerPrompt}>Wrong email?</Text>
        <TouchableOpacity onPress={async () => { await signOut(); router.replace('/(auth)/sign-in'); }} hitSlop={hitSlop}>
          <Text style={styles.footerAction}>Start over.</Text>
        </TouchableOpacity>
      </View>
    </AuthShell>
  );
}

// ─── Forgot password ──────────────────────────────────────────────────────────

export function ForgotPasswordScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!email.trim()) {
      setError('Enter the email associated with your account.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
      setSent(true);
    } catch (submitError) {
      setError(getAuthErrorMessage(submitError, 'reset'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <Heading
        title="Forgot your"
        accent="password?"
        subtitle="Happens. Drop your school email and we'll send a reset link."
      />

      {sent ? (
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={22} color={colors.green} />
          <View style={styles.flex}>
            <Text style={styles.successTitle}>Check your inbox</Text>
            <Text style={styles.successText}>
              A password reset link was sent to {email.trim()}.
            </Text>
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={18} color={colors.red} />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      ) : null}

      <AuthInput
        label="SCHOOL EMAIL"
        value={email}
        onChangeText={setEmail}
        placeholder="you@university.edu"
        keyboardType="email-address"
        textContentType="emailAddress"
      />

      <PrimaryButton
        label={sent ? 'Send another reset link →' : 'Send reset link →'}
        onPress={() => void submit()}
        loading={loading}
      />

      <SecondaryButton
        label="Back to login"
        onPress={() => router.replace('/(auth)/sign-in')}
      />

      <View style={styles.spamNote}>
        <Ionicons name="alert-circle-outline" size={15} color={colors.primary} />
        <Text style={styles.spamNoteText}>
          {"Check spam if it doesn't arrive in 60 seconds."}
        </Text>
      </View>
    </AuthShell>
  );
}

// ─── Legal screens ────────────────────────────────────────────────────────────

function LegalDocScreen({ url, title }: { url: string; title: string }) {
  const { colors } = useAppTheme();
  const styles = useStyles(colors);
  const [loading, setLoading] = useState(true);

  return (
    <SafeAreaView style={styles.legalSafe}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <View style={styles.legalHeader}>
        <TouchableOpacity style={styles.legalBackBtn} onPress={() => router.back()} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.legalHeaderTitle}>{title}</Text>
      </View>
      {loading ? (
        <View style={styles.legalLoading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}
      <WebView
        source={{ uri: url }}
        style={[styles.legalWebView, loading && { opacity: 0 }]}
        onLoadEnd={() => setLoading(false)}
      />
    </SafeAreaView>
  );
}

export function TermsScreen() {
  return <LegalDocScreen url="https://ridealongapp.com/pages/terms" title="Terms of service" />;
}
export function PrivacyScreen() {
  return <LegalDocScreen url="https://ridealongapp.com/pages/privacy" title="Privacy policy" />;
}
