import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Dimensions, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { UniversitySearch } from '@/components/ui/UniversitySearch';
import { useTheme } from '@/hooks/useTheme';
import { router, useLocalSearchParams } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from '@/constants/services';

// ─── Driver sign-up (manual review) ───────────────────────────────────────────

function DriverSignUp() {
  const theme = useTheme();

  const onSubmit = () => {
    Alert.alert(
      'Driver Application',
      'Thank you for your interest! Driver applications are currently being reviewed manually. Please contact support to apply as a driver.',
      [{ text: 'OK', onPress: () => router.replace('/(auth)/sign-in') }],
    );
  };

  return (
    <SafeAreaView style={styles.driverContainer} edges={['top']}>
      <View style={styles.driverCenterWrap}>
        <TouchableOpacity onPress={() => router.back()} style={styles.driverBackButton}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.secondary} />
        </TouchableOpacity>

        <View style={styles.driverHeader}>
          <Text style={[styles.driverTitle, { color: theme.colors.secondary }]}>Apply to Drive</Text>
          <Text style={styles.driverSubtitle}>Join RideAlong as a verified university driver</Text>
        </View>

        <View style={styles.driverCard}>
          <Button onPress={onSubmit} fullWidth>
            <Text style={styles.driverButtonText}>Submit Application</Text>
          </Button>

          <View style={styles.legalLinksContainer}>
            <Text style={styles.legalText}>
              By applying, you agree to our{' '}
              <Text onPress={() => Linking.openURL('https://ridealongwebapp.onrender.com/terms')} style={[styles.legalLink, { color: theme.colors.primary }]}>
                Terms of Service
              </Text>
              {' '}and{' '}
              <Text onPress={() => Linking.openURL('https://ridealongwebapp.onrender.com/privacy')} style={[styles.legalLink, { color: theme.colors.primary }]}>
                Privacy Policy
              </Text>
            </Text>
          </View>
        </View>

        <TouchableOpacity onPress={() => router.replace('/(auth)/sign-in')} style={styles.driverAuthSwitch}>
          <Text style={styles.driverAuthSwitchText}>
            Already approved?{' '}
            <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Rider sign-up (4-step form) ──────────────────────────────────────────────

function RiderSignUp() {
  const theme = useTheme();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [university, setUniversity] = useState('');
  const [universityData, setUniversityData] = useState<any>(null);
  const [password, setPassword] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showVerifyPassword, setShowVerifyPassword] = useState(false);

  const stepErrors = useMemo(() => {
    const e: Record<string, string | undefined> = {};
    if (step === 1) {
      if (!email) e.email = 'Email is required';
      else if (!/^[^@\s]+@[^@\s]+\.edu$/i.test(email)) e.email = 'Must be a .edu email';
      if (!fullName) e.fullName = 'Full name is required';
    }
    if (step === 2) {
      if (!university) e.university = 'University is required';
    }
    if (step === 3) {
      if (!password) e.password = 'Password is required';
      else if (password.length < 8) e.password = 'At least 8 characters';
      else if (!/[A-Z]/.test(password)) e.password = 'Must include uppercase letter';
      else if (!/[a-z]/.test(password)) e.password = 'Must include lowercase letter';
      else if (!/[0-9]/.test(password)) e.password = 'Must include a number';
      else if (!/[^A-Za-z0-9]/.test(password)) e.password = 'Must include special character';
      if (!verifyPassword) e.verifyPassword = 'Please verify your password';
      else if (password !== verifyPassword) e.verifyPassword = 'Passwords do not match';
    }
    if (step === 4) {
      if (!accepted) e.accepted = 'Accept Terms & Privacy to continue';
    }
    return e;
  }, [step, email, fullName, university, password, verifyPassword, accepted]);

  const allErrors = useMemo(() => {
    const e: Record<string, string | undefined> = {};
    if (!email) e.email = 'Email is required';
    else if (!/^[^@\s]+@[^@\s]+\.edu$/i.test(email)) e.email = 'Must be a .edu email';
    if (!fullName) e.fullName = 'Full name is required';
    if (!university) e.university = 'University is required';
    if (!password) e.password = 'Password is required';
    else if (password.length < 8) e.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(password)) e.password = 'Must include uppercase letter';
    else if (!/[a-z]/.test(password)) e.password = 'Must include lowercase letter';
    else if (!/[0-9]/.test(password)) e.password = 'Must include a number';
    else if (!/[^A-Za-z0-9]/.test(password)) e.password = 'Must include special character';
    if (!verifyPassword) e.verifyPassword = 'Please verify your password';
    else if (password !== verifyPassword) e.verifyPassword = 'Passwords do not match';
    if (!accepted) e.accepted = 'Accept Terms & Privacy to continue';
    return e;
  }, [email, fullName, university, password, verifyPassword, accepted]);

  const canProceed = Object.keys(stepErrors).length === 0;

  const handleNext = () => {
    if (!canProceed) {
      setShowErrors(true);
      Alert.alert('Please complete this step', Object.values(stepErrors).filter(Boolean).join('\n'));
      return;
    }
    setShowErrors(false);
    if (step < 4) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setShowErrors(false);
    } else {
      router.back();
    }
  };

  const onSubmit = async () => {
    if (Object.keys(allErrors).length) {
      setShowErrors(true);
      Alert.alert('Check your info', Object.values(allErrors).filter(Boolean).join('\n'));
      return;
    }
    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
      const displayName = fullName.trim();
      if (cred.user) {
        try { await updateProfile(cred.user, { displayName }); } catch {}
        const uniData = universityData || { name: university, custom: true };
        await setDoc(doc(firestore, 'riders', cred.user.uid), {
          name: displayName,
          email: cred.user.email,
          university: uniData.name || university,
          universityData: {
            name: uniData.name || university,
            city: uniData.city || null,
            state: uniData.state || null,
            id: uniData.id || null,
            custom: uniData.custom || false,
          },
          isVerified: false,
          emailVerified: false,
          status: 'active',
          createdAt: new Date(),
        });

        await sendEmailVerification(cred.user);

        try {
          await fetch('https://ridealongwebapp.onrender.com/api/send-welcome-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cred.user.email, name: displayName }),
          });
        } catch {}

        Alert.alert(
          '✅ Account Created Successfully!',
          `A verification link and welcome email have been sent to:\n\n${email}\n\nPlease check your inbox and click the verification link to activate your account.\n\n📧 Check your spam folder if you don't see it.`,
          [{ text: 'Continue to Sign In', onPress: () => router.replace('/(auth)/sign-in') }],
        );
      }
    } catch (err: any) {
      let msg = 'Sign up failed';
      if (err?.code === 'auth/email-already-in-use') msg = 'This email is already registered. Please sign in or use a different email.';
      else if (err?.code === 'auth/invalid-email') msg = 'Invalid email address format';
      else if (err?.code === 'auth/weak-password') msg = 'Password is too weak. Please use a stronger password.';
      else if (err?.code === 'auth/network-request-failed') msg = 'Network error. Please check your connection and try again.';
      Alert.alert('❌ Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient colors={['#F8FAFC', '#EFF6FF']} style={styles.gradient}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color="#1E293B" />
            </TouchableOpacity>

            <View style={styles.progressContainer}>
              {[1, 2, 3, 4].map((s) => (
                <View
                  key={s}
                  style={[
                    styles.progressDot,
                    s <= step ? { backgroundColor: '#E05E1A' } : { backgroundColor: '#E2E8F0' },
                  ]}
                />
              ))}
            </View>

            <View style={styles.titleContainer}>
              <Text style={[styles.title, { color: '#1E293B' }]}>
                {step === 1 && 'Your Information'}
                {step === 2 && 'Select University'}
                {step === 3 && 'Create Password'}
                {step === 4 && 'Review & Accept'}
              </Text>
              <Text style={styles.subtitle}>
                {step === 1 && 'Enter your email and name'}
                {step === 2 && 'Choose your university'}
                {step === 3 && 'Create a strong password'}
                {step === 4 && 'Review and accept terms'}
              </Text>
            </View>
          </View>

          <View style={styles.formCard}>
            <View style={styles.form}>
              {step === 1 && (
                <>
                  <Input
                    label="University Email (.edu)"
                    placeholder="you@university.edu"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    error={showErrors ? (stepErrors.email as string) : undefined}
                  />
                  <Input
                    label="Full Name"
                    placeholder="Jane Doe"
                    value={fullName}
                    onChangeText={setFullName}
                    error={showErrors ? (stepErrors.fullName as string) : undefined}
                  />
                </>
              )}

              {step === 2 && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>University</Text>
                  <UniversitySearch
                    value={university}
                    onSelect={(uni) => {
                      if (uni) {
                        setUniversity(uni.displayName || uni.name);
                        setUniversityData(uni);
                      } else {
                        setUniversity('');
                        setUniversityData(null);
                      }
                    }}
                    placeholder="Search any U.S. university..."
                  />
                  {showErrors && stepErrors.university && (
                    <Text style={styles.errorText}>{stepErrors.university}</Text>
                  )}
                </View>
              )}

              {step === 3 && (
                <>
                  <View style={styles.passwordContainer}>
                    <Input
                      label="Password"
                      placeholder="Enter a strong password"
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={setPassword}
                      error={showErrors ? (stepErrors.password as string) : undefined}
                      style={styles.passwordInput}
                    />
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                      <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={24} color="#64748B" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.passwordContainer}>
                    <Input
                      label="Verify Password"
                      placeholder="Re-enter your password"
                      secureTextEntry={!showVerifyPassword}
                      value={verifyPassword}
                      onChangeText={setVerifyPassword}
                      error={showErrors ? (stepErrors.verifyPassword as string) : undefined}
                      style={styles.passwordInput}
                    />
                    <TouchableOpacity onPress={() => setShowVerifyPassword(!showVerifyPassword)} style={styles.eyeIcon}>
                      <Ionicons name={showVerifyPassword ? 'eye-off-outline' : 'eye-outline'} size={24} color="#64748B" />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.passwordRequirements}>
                    <Text style={styles.requirementsTitle}>Password must include:</Text>
                    {[
                      { test: password.length >= 8, label: 'At least 8 characters' },
                      { test: /[A-Z]/.test(password), label: 'One uppercase letter' },
                      { test: /[a-z]/.test(password), label: 'One lowercase letter' },
                      { test: /[0-9]/.test(password), label: 'One number' },
                      { test: /[^A-Za-z0-9]/.test(password), label: 'One special character' },
                    ].map(({ test, label }) => (
                      <View key={label} style={styles.requirementItem}>
                        <Ionicons
                          name={test ? 'checkmark-circle' : 'ellipse-outline'}
                          size={16}
                          color={test ? '#10B981' : '#94A3B8'}
                        />
                        <Text style={styles.requirementText}>{label}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {step === 4 && (
                <>
                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewTitle}>Review Your Information</Text>
                    <View style={styles.reviewItem}>
                      <Ionicons name="mail-outline" size={20} color="#64748B" />
                      <View style={styles.reviewItemContent}>
                        <Text style={styles.reviewItemLabel}>Email</Text>
                        <Text style={styles.reviewItemValue}>{email}</Text>
                      </View>
                    </View>
                    <View style={styles.reviewItem}>
                      <Ionicons name="person-outline" size={20} color="#64748B" />
                      <View style={styles.reviewItemContent}>
                        <Text style={styles.reviewItemLabel}>Name</Text>
                        <Text style={styles.reviewItemValue}>{fullName}</Text>
                      </View>
                    </View>
                    <View style={styles.reviewItem}>
                      <Ionicons name="school-outline" size={20} color="#64748B" />
                      <View style={styles.reviewItemContent}>
                        <Text style={styles.reviewItemLabel}>University</Text>
                        <Text style={styles.reviewItemValue}>{university}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.termsSection}>
                    <TouchableOpacity
                      onPress={() => setAccepted((v) => !v)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: accepted }}
                      style={styles.checkboxContainer}
                    >
                      <View style={[
                        styles.checkbox,
                        {
                          borderColor: accepted ? '#E05E1A' : '#CBD5E1',
                          backgroundColor: accepted ? '#E05E1A' : 'transparent',
                        },
                      ]}>
                        {accepted && <Ionicons name="checkmark" size={14} color="white" />}
                      </View>
                      <Text style={styles.checkboxText}>
                        I agree to the{' '}
                        <Text onPress={() => Linking.openURL('https://ridealongwebapp.onrender.com/terms')} style={styles.checkboxLink}>
                          Terms of Service
                        </Text>
                        {' '}and{' '}
                        <Text onPress={() => Linking.openURL('https://ridealongwebapp.onrender.com/privacy')} style={styles.checkboxLink}>
                          Privacy Policy
                        </Text>
                      </Text>
                    </TouchableOpacity>
                    {showErrors && stepErrors.accepted && (
                      <Text style={styles.errorText}>{stepErrors.accepted}</Text>
                    )}
                  </View>
                </>
              )}

              <View style={styles.navigationButtons}>
                {step < 4 ? (
                  <Button onPress={handleNext} fullWidth size="lg" style={styles.nextButton}>
                    <Text style={styles.buttonText}>Continue</Text>
                  </Button>
                ) : (
                  <Button onPress={onSubmit} loading={loading} fullWidth size="lg" style={styles.signUpButton}>
                    <Text style={styles.signUpButtonText}>Create Account</Text>
                  </Button>
                )}
              </View>
            </View>
          </View>

          <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} style={styles.signInContainer}>
            <Text style={styles.signInText}>
              Already have an account?{' '}
              <Text style={[styles.signInLink, { color: '#E05E1A' }]}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      </LinearGradient>
    </ScrollView>
  );
}

// ─── Entry point (selects rider or driver) ────────────────────────────────────

export default function SignUpScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role = params.role === 'driver' ? 'driver' : 'rider';
  return role === 'driver' ? <DriverSignUp /> : <RiderSignUp />;
}

const { height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  gradient: { flex: 1, minHeight: height },
  safeArea: { flex: 1, paddingHorizontal: 24 },
  header: { paddingTop: 20, marginBottom: 30 },
  backButton: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'white', justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  progressContainer: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 },
  progressDot: { width: 10, height: 10, borderRadius: 5 },
  titleContainer: { alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748B', textAlign: 'center', fontWeight: '400' },
  formCard: {
    backgroundColor: 'white', borderRadius: 24,
    borderWidth: 1, borderColor: '#F1F5F9', padding: 24, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 8,
  },
  form: { gap: 16 },
  passwordContainer: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  eyeIcon: { position: 'absolute', right: 16, top: '50%', transform: [{ translateY: -12 }], zIndex: 1 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 15, fontWeight: '600', color: '#1E293B', marginBottom: 8 },
  errorText: { color: '#EF4444', fontSize: 13, marginTop: 6, marginLeft: 34 },
  passwordRequirements: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 16, gap: 8 },
  requirementsTitle: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 4 },
  requirementItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  requirementText: { fontSize: 14, color: '#64748B' },
  reviewCard: { backgroundColor: '#F8FAFC', borderRadius: 16, padding: 20, gap: 16 },
  reviewTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B', marginBottom: 4 },
  reviewItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  reviewItemContent: { flex: 1 },
  reviewItemLabel: { fontSize: 13, color: '#64748B', fontWeight: '500', marginBottom: 2 },
  reviewItemValue: { fontSize: 16, color: '#1E293B', fontWeight: '600' },
  termsSection: { marginTop: 4 },
  checkboxContainer: { flexDirection: 'row', alignItems: 'flex-start' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    marginRight: 12, marginTop: 2, justifyContent: 'center', alignItems: 'center',
  },
  checkboxText: { flex: 1, color: '#334155', fontSize: 15, lineHeight: 22, fontWeight: '400' },
  checkboxLink: { color: '#E05E1A', textDecorationLine: 'underline', fontWeight: '600' },
  navigationButtons: { marginTop: 8 },
  nextButton: {
    backgroundColor: '#E05E1A', borderRadius: 28, paddingVertical: 14,
    shadowColor: '#E05E1A', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  signUpButton: {
    backgroundColor: '#E05E1A', borderRadius: 28, paddingVertical: 14, marginTop: 8,
    shadowColor: '#E05E1A', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  buttonText: { fontSize: 18, fontWeight: '700', color: 'white', textAlign: 'center' },
  signUpButtonText: { fontSize: 18, fontWeight: '700', color: 'white', textAlign: 'center' },
  signInContainer: { alignItems: 'center', paddingVertical: 20, paddingBottom: 40 },
  signInText: { fontSize: 16, color: '#64748B', textAlign: 'center', fontWeight: '500' },
  signInLink: { fontWeight: '700', textDecorationLine: 'underline' },
  // Driver styles
  driverContainer: { flex: 1, backgroundColor: '#F8FAFC' },
  driverCenterWrap: { flex: 1, justifyContent: 'center', padding: 24 },
  driverBackButton: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: 'white',
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  driverHeader: { paddingHorizontal: 8, marginBottom: 24 },
  driverTitle: { fontSize: 35, fontWeight: '800', textAlign: 'center' },
  driverSubtitle: { fontSize: 14, color: '#64748B', marginTop: 6, textAlign: 'center' },
  driverCard: {
    backgroundColor: 'white', borderRadius: 12, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  driverButtonText: { fontSize: 16, fontWeight: '700', color: 'white' },
  legalLinksContainer: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  legalText: { fontSize: 12, color: '#64748B', textAlign: 'center', lineHeight: 18 },
  legalLink: { fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  driverAuthSwitch: { marginTop: 24, alignItems: 'center' },
  driverAuthSwitchText: { color: '#334155' },
});
