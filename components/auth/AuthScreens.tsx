import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

const COLORS = {
  navy: '#15233A',
  orange: '#DE5D20',
  background: '#FBFAF7',
  white: '#FFFFFF',
  border: '#DDD9D2',
  muted: '#6F7888',
  softOrange: '#FFF0E7',
  error: '#B42318',
};

type Role = 'rider' | 'driver' | 'both';

function AuthShell({ children, back = false, showLogo = false }: { children: React.ReactNode; back?: boolean; showLogo?: boolean }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {back ? (
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" hitSlop={hitSlop}>
              <Ionicons name="arrow-back" size={20} color={COLORS.navy} />
            </TouchableOpacity>
          ) : null}
          {showLogo ? <Image source={require('../../assets/logo+text - Edited.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="RideAlong" /> : null}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Heading({ title, accent, subtitle }: { title: string; accent?: string; subtitle: string }) {
  return (
    <View style={styles.heading}>
      <Text style={styles.title}>{title}{accent ? <Text style={styles.titleAccent}> {accent}</Text> : null}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

function StepProgress({ current }: { current: number }) {
  return (
    <View style={styles.progressRow}>
      <Text style={styles.progressLabel}>STEP {current} OF 3</Text>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${current * 33.333}%` }]} /></View>
    </View>
  );
}

type AuthInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  icon: keyof typeof Ionicons.glyphMap;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  textContentType?: React.ComponentProps<typeof TextInput>['textContentType'];
  autoCapitalize?: React.ComponentProps<typeof TextInput>['autoCapitalize'];
  secure?: boolean;
  error?: string;
};

function AuthInput({ label, value, onChangeText, placeholder, icon, keyboardType, textContentType, autoCapitalize = 'none', secure, error }: AuthInputProps) {
  const [hidden, setHidden] = useState(Boolean(secure));
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error ? styles.inputError : null]}>
        <Ionicons name={icon} size={18} color={error ? COLORS.error : '#7C8491'} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9AA1AD"
          keyboardType={keyboardType}
          textContentType={textContentType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          secureTextEntry={secure ? hidden : false}
        />
        {secure ? (
          <TouchableOpacity onPress={() => setHidden((current) => !current)} accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'} hitSlop={hitSlop}>
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={19} color="#7C8491" />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

function PrimaryButton({ label, onPress, loading = false, disabled = false }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.primaryButton, (disabled || loading) && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function InlineLink({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  return (
    <View style={styles.inlineLinkRow}>
      <Text style={styles.inlinePrompt}>{prompt}</Text>
      <TouchableOpacity onPress={onPress} hitSlop={hitSlop}><Text style={styles.inlineAction}>{action}</Text></TouchableOpacity>
    </View>
  );
}

function validateEduEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.edu$/i.test(email.trim());
}

function passwordError(password: string) {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.';
  return '';
}

const ROLE_SIGN_IN_CONTENT = {
  rider: {
    title: 'Welcome back to',
    accent: 'RideAlong!',
    subtitle: 'Sign in with your verified .edu email to book rides.',
  },
  driver: {
    title: 'Welcome back,',
    accent: 'driver.',
    subtitle: 'Sign in to manage your trips and earnings.',
  },
};

export function SignInScreen() {
  const { signIn } = useAuthStore();
  const params = useLocalSearchParams<{ role?: string }>();
  const [role, setRole] = useState<'rider' | 'driver'>(
    params.role === 'driver' ? 'driver' : 'rider',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const copy = ROLE_SIGN_IN_CONTENT[role];

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
    <AuthShell showLogo>
      {/* Role toggle */}
      <View style={styles.roleToggle}>
        <TouchableOpacity
          style={[styles.roleToggleOption, role === 'rider' && styles.roleToggleOptionActive]}
          onPress={() => { setRole('rider'); setError(''); }}
          accessibilityRole="button"
          accessibilityLabel="Sign in as rider"
        >
          <Ionicons name="people-outline" size={16} color={role === 'rider' ? COLORS.white : COLORS.muted} />
          <Text style={[styles.roleToggleText, role === 'rider' && styles.roleToggleTextActive]}>Rider</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.roleToggleOption, role === 'driver' && styles.roleToggleOptionActive]}
          onPress={() => { setRole('driver'); setError(''); }}
          accessibilityRole="button"
          accessibilityLabel="Sign in as driver"
        >
          <Ionicons name="car-sport-outline" size={16} color={role === 'driver' ? COLORS.white : COLORS.muted} />
          <Text style={[styles.roleToggleText, role === 'driver' && styles.roleToggleTextActive]}>Driver</Text>
        </TouchableOpacity>
      </View>

      <Heading title={copy.title} accent={copy.accent} subtitle={copy.subtitle} />
      {error ? <View style={styles.errorBanner}><Ionicons name="alert-circle" size={18} color={COLORS.error} /><Text style={styles.errorBannerText}>{error}</Text></View> : null}
      <AuthInput label="EMAIL" value={email} onChangeText={setEmail} placeholder="you@university.edu" icon="mail-outline" keyboardType="email-address" textContentType="emailAddress" />
      <AuthInput label="PASSWORD" value={password} onChangeText={setPassword} placeholder="Enter your password" icon="lock-closed-outline" textContentType="password" secure />
      <TouchableOpacity style={styles.forgotLink} onPress={() => router.push('/(auth)/forgot-password')} hitSlop={hitSlop}>
        <Text style={styles.inlineAction}>Forgot password?</Text>
      </TouchableOpacity>
      <PrimaryButton label="Sign in" onPress={() => void submit()} loading={loading} />
      <View style={styles.signInFooter}>
        {role === 'driver' ? (
          <InlineLink prompt="No driver account?" action="Sign up as driver" onPress={() => router.push('/(auth)/driver-signup')} />
        ) : (
          <InlineLink prompt="New here?" action="Sign up" onPress={() => router.push('/(auth)/select-role')} />
        )}
      </View>
    </AuthShell>
  );
}

const ROLE_CONTENT: Record<Role, { title: string; accent?: string; subtitle: string }> = {
  rider: { title: 'Pull', accent: 'up.', subtitle: '.edu email required. We verify everyone to keep rides safe.' },
  driver: { title: 'Create your driver account', subtitle: 'Start your driver profile now. Vehicle and document review continues after email verification.' },
  both: { title: 'Create one account for both', subtitle: 'Request rides and offer seats from the same verified student account.' },
};

export function SignUpScreen({ forcedRole }: { forcedRole?: Role }) {
  const params = useLocalSearchParams<{ role?: string }>();
  const requestedRole = Array.isArray(params.role) ? params.role[0] : params.role;
  const role: Role = forcedRole || (requestedRole === 'driver' || requestedRole === 'both' ? requestedRole : 'rider');
  const { signUp } = useAuthStore();
  const copy = ROLE_CONTENT[role];
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

  const validation = useMemo(() => {
    if (!firstName.trim() || !lastName.trim()) return 'Enter your first and last name.';
    if (!validateEduEmail(email)) return 'Use a valid .edu student email.';
    if (!university?.name) return 'Select your university.';
    const invalidPassword = passwordError(password);
    if (invalidPassword) return invalidPassword;
    if (password !== confirmPassword) return 'Passwords do not match.';
    if (!accepted) return 'Accept the Terms and Privacy Policy to continue.';
    return '';
  }, [accepted, confirmPassword, email, firstName, lastName, password, university]);

  const submit = async () => {
    if (validation) {
      setFormError(validation);
      return;
    }
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

  return (
    <AuthShell back>
      <StepProgress current={1} />
      <Heading title={copy.title} accent={copy.accent} subtitle={copy.subtitle} />
      {formError ? <View style={styles.errorBanner}><Ionicons name="alert-circle" size={18} color={COLORS.error} /><Text style={styles.errorBannerText}>{formError}</Text></View> : null}
      <View style={styles.nameRow}>
        <View style={styles.nameField}><AuthInput label="FIRST NAME" value={firstName} onChangeText={setFirstName} placeholder="Melody" icon="person-outline" autoCapitalize="words" textContentType="givenName" /></View>
        <View style={styles.nameField}><AuthInput label="LAST NAME" value={lastName} onChangeText={setLastName} placeholder="Adeyemi" icon="person-outline" autoCapitalize="words" textContentType="familyName" /></View>
      </View>
      <AuthInput label="SCHOOL EMAIL" value={email} onChangeText={setEmail} placeholder="you@university.edu" icon="mail-outline" keyboardType="email-address" textContentType="emailAddress" />
      <AuthInput label="PHONE (OPTIONAL)" value={phone} onChangeText={setPhone} placeholder="(512) 555-0123" icon="call-outline" keyboardType="phone-pad" textContentType="telephoneNumber" />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>UNIVERSITY</Text>
        <View style={styles.universityWrap}>
          <UniversitySearch value={university?.name || ''} onSelect={(selected) => setUniversity(selected)} placeholder="Search your university" allowCustom />
        </View>
      </View>
      <AuthInput label="PASSWORD" value={password} onChangeText={setPassword} placeholder="8+ characters, letter and number" icon="lock-closed-outline" textContentType="newPassword" secure />
      <AuthInput label="CONFIRM PASSWORD" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter it again" icon="checkmark-circle-outline" textContentType="newPassword" secure />
      <TouchableOpacity style={styles.termsRow} onPress={() => setAccepted((current) => !current)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
        <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>{accepted ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}</View>
        <Text style={styles.termsText}>I agree to RideAlong&apos;s Terms of Service and Privacy Policy.</Text>
      </TouchableOpacity>
      <PrimaryButton label="Create account" onPress={() => void submit()} loading={loading} />
      <InlineLink prompt="Already have an account?" action="Sign in" onPress={() => router.replace('/(auth)/sign-in')} />
    </AuthShell>
  );
}

export function DriverSignUpScreen() {
  return <SignUpScreen forcedRole="driver" />;
}

const ROLE_OPTIONS: { role: Role; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { role: 'rider', title: 'I need a ride', subtitle: 'Request or book rides with verified students.', icon: 'people-outline' },
  { role: 'driver', title: "I'm driving", subtitle: 'Offer open seats and split the cost of your trip.', icon: 'car-sport-outline' },
  { role: 'both', title: 'I do both', subtitle: 'Use one account for rider and driver mode.', icon: 'swap-horizontal-outline' },
];

export function SelectRoleScreen() {
  const choose = (role: Role) => {
    if (role === 'driver') router.push('/(auth)/driver-signup');
    else router.push({ pathname: '/(auth)/sign-up', params: { role } });
  };

  return (
    <AuthShell back>
      <Heading title="How are you" accent="riding along?" subtitle="You can switch later — same account, two modes." />
      <View style={styles.roleList}>
        {ROLE_OPTIONS.map((option) => (
          <TouchableOpacity key={option.role} style={styles.roleCard} onPress={() => choose(option.role)} accessibilityRole="button">
            <View style={styles.roleIcon}><Ionicons name={option.icon} size={24} color={COLORS.orange} /></View>
            <View style={styles.roleCopy}><Text style={styles.roleTitle}>{option.title}</Text><Text style={styles.roleSubtitle}>{option.subtitle}</Text></View>
            <Ionicons name="chevron-forward" size={21} color="#9AA1AD" />
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.infoNote}><Ionicons name="shield-checkmark-outline" size={18} color={COLORS.orange} /><Text style={styles.infoNoteText}>Every RideAlong account uses a verified .edu email. Driver accounts complete additional review inside the app.</Text></View>
      <View style={styles.bottomLink}><InlineLink prompt="Already registered?" action="Sign in" onPress={() => router.replace('/(auth)/sign-in')} /></View>
    </AuthShell>
  );
}

export function VerifyEmailScreen() {
  const { email, checkEmailVerification, sendVerificationEmail, signOut } = useAuthStore();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const check = async () => {
    try {
      setChecking(true);
      const verified = await checkEmailVerification();
      if (!verified) Alert.alert('Email not verified yet', 'Open the verification link in your inbox, then come back and try again.');
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
      Alert.alert('Verification email sent', 'Check your inbox and spam folder.');
    } catch (error) {
      Alert.alert('Could not resend email', getAuthErrorMessage(error, 'sign-up'));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell>
      <StepProgress current={2} />
      <Heading title="Check your" accent="inbox." subtitle={`We sent a verification link to ${email || 'your school email'}. Tap that link, then return here.`} />
      <View style={styles.verificationSteps}>
        {['Open the email from RideAlong', 'Tap the verification link', 'Return here and continue'].map((step, index) => (
          <View key={step} style={styles.verificationStep}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View><Text style={styles.verificationStepText}>{step}</Text></View>
        ))}
      </View>
      <PrimaryButton label="I verified my email" onPress={() => void check()} loading={checking} />
      <TouchableOpacity style={styles.secondaryButton} onPress={() => void resend()} disabled={resending || cooldown > 0} accessibilityRole="button">
        {resending ? <ActivityIndicator color={COLORS.navy} /> : <Text style={styles.secondaryButtonText}>{cooldown ? `Resend available in ${cooldown}s` : 'Resend verification email'}</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => Linking.openURL('mailto:')} style={styles.openMailButton}><Ionicons name="open-outline" size={16} color={COLORS.orange} /><Text style={styles.inlineAction}>Open mail app</Text></TouchableOpacity>
      <View style={styles.bottomLink}><InlineLink prompt="Wrong email?" action="Start over" onPress={() => void signOut()} /></View>
    </AuthShell>
  );
}

export function ForgotPasswordScreen() {
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
    <AuthShell back>
      <Heading title="Forgot" accent="it?" subtitle="Happens. Drop your school email and we’ll send a reset link." />
      {sent ? (
        <View style={styles.successCard}><Ionicons name="checkmark-circle" size={25} color="#168A5B" /><View style={styles.flex}><Text style={styles.successTitle}>Check your inbox</Text><Text style={styles.successText}>A password reset link was sent to {email.trim()}.</Text></View></View>
      ) : null}
      {error ? <View style={styles.errorBanner}><Ionicons name="alert-circle" size={18} color={COLORS.error} /><Text style={styles.errorBannerText}>{error}</Text></View> : null}
      <AuthInput label="EMAIL" value={email} onChangeText={setEmail} placeholder="you@university.edu" icon="mail-outline" keyboardType="email-address" textContentType="emailAddress" />
      <PrimaryButton label={sent ? 'Send another reset link' : 'Send reset link'} onPress={() => void submit()} loading={loading} />
      <View style={styles.bottomLink}><InlineLink prompt="Remembered it?" action="Back to login" onPress={() => router.replace('/(auth)/sign-in')} /></View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, flexGrow: 1 },
  backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  logo: { width: 158, height: 53, alignSelf: 'center', marginBottom: 22 },
  heading: { marginBottom: 28 },
  title: { color: COLORS.navy, fontSize: 32, lineHeight: 38, fontWeight: '600', letterSpacing: -0.75 },
  titleAccent: { color: COLORS.orange, fontStyle: 'italic' },
  subtitle: { color: COLORS.muted, fontSize: 15, lineHeight: 22, marginTop: 11 },
  field: { marginBottom: 17 },
  fieldLabel: { color: '#7B8493', fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
  inputWrap: { minHeight: 57, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15 },
  inputError: { borderColor: COLORS.error },
  input: { flex: 1, color: COLORS.navy, fontSize: 16, paddingVertical: 0 },
  errorText: { color: COLORS.error, fontSize: 12, lineHeight: 17, marginTop: 5 },
  primaryButton: { minHeight: 57, borderRadius: 29, backgroundColor: COLORS.orange, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  primaryButtonText: { color: COLORS.white, fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.58 },
  secondaryButton: { minHeight: 54, borderRadius: 27, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  secondaryButtonText: { color: COLORS.navy, fontSize: 14, fontWeight: '600' },
  inlineLinkRow: { minHeight: 40, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 9 },
  inlinePrompt: { color: COLORS.muted, fontSize: 13 },
  inlineAction: { color: COLORS.orange, fontSize: 13, fontWeight: '700' },
  bottomLink: { marginTop: 'auto', paddingTop: 30 },
  signInFooter: { marginTop: 20 },
  roleToggle: { flexDirection: 'row', backgroundColor: '#EDEAE4', borderRadius: 13, padding: 3, marginBottom: 26 },
  roleToggleOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 10 },
  roleToggleOptionActive: { backgroundColor: COLORS.navy, shadowColor: COLORS.navy, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 3 },
  roleToggleText: { color: COLORS.muted, fontSize: 14, fontWeight: '700' },
  roleToggleTextActive: { color: COLORS.white },
  forgotLink: { alignSelf: 'flex-end', minHeight: 40, justifyContent: 'center', marginTop: -8, marginBottom: 2 },
  errorBanner: { borderRadius: 13, backgroundColor: '#FFF0EF', flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 13, marginBottom: 18 },
  errorBannerText: { flex: 1, color: COLORS.error, fontSize: 13, lineHeight: 19 },
  nameRow: { flexDirection: 'row', gap: 10 },
  nameField: { flex: 1 },
  universityWrap: { borderRadius: 14, overflow: 'hidden' },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4, marginBottom: 14 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.25, borderColor: '#B6BDC8', backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { borderColor: COLORS.orange, backgroundColor: COLORS.orange },
  termsText: { flex: 1, color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  roleList: { gap: 13 },
  roleCard: { minHeight: 92, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 15 },
  roleIcon: { width: 50, height: 50, borderRadius: 14, backgroundColor: COLORS.softOrange, alignItems: 'center', justifyContent: 'center' },
  roleCopy: { flex: 1 },
  roleTitle: { color: COLORS.navy, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  roleSubtitle: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  infoNote: { borderRadius: 13, backgroundColor: '#F8E8DB', flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 13, marginTop: 28 },
  infoNoteText: { flex: 1, color: '#9A4A19', fontSize: 12, lineHeight: 18 },
  verificationSteps: { borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.white, padding: 16, gap: 15, marginBottom: 22 },
  verificationStep: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.softOrange, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: COLORS.orange, fontSize: 12, fontWeight: '800' },
  verificationStepText: { flex: 1, color: COLORS.navy, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  openMailButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 5 },
  successCard: { borderRadius: 13, backgroundColor: '#ECF8F2', flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 13, marginBottom: 18 },
  successTitle: { color: '#136C49', fontSize: 14, fontWeight: '700' },
  successText: { color: '#3D6E5B', fontSize: 12, lineHeight: 18, marginTop: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22 },
  progressLabel: { color: '#7B8493', fontSize: 9, fontWeight: '700', letterSpacing: 1.5 },
  progressTrack: { flex: 1, height: 2, backgroundColor: '#C8CDD4' },
  progressFill: { height: 2, backgroundColor: COLORS.orange },
});
