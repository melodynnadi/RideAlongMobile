import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Dimensions,
  Linking,
  Animated,
  Easing,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  useColorScheme,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { UniversitySearch } from '@/components/ui/UniversitySearch';
import { useAuthStore } from '@/stores/authStore';

const { width, height } = Dimensions.get('window');

type SignupRole = 'rider';

const COLORS = {
  orange: '#F4621F',
  orangeLight: '#FF8C4A',
  orangeGlow: 'rgba(244,98,31,0.15)',
  orangeBorder: 'rgba(244,98,31,0.45)',
  navy: '#0D1B2A',
  green: '#10B981',
  red: '#EF4444',
  darkBg: '#080E17',
  darkCard: 'rgba(255,255,255,0.06)',
  darkBorder: 'rgba(255,255,255,0.11)',
  darkText: '#F0F4FF',
  darkSub: '#7A8FA8',
  darkInput: 'rgba(255,255,255,0.07)',
  darkInputBorder: 'rgba(255,255,255,0.13)',
  lightBg: '#EEF1F7',
  lightCard: 'rgba(255,255,255,0.75)',
  lightBorder: 'rgba(255,255,255,0.9)',
  lightText: '#0D1B2A',
  lightSub: '#5A6A7E',
  lightInput: 'rgba(255,255,255,0.9)',
  lightInputBorder: 'rgba(200,210,225,0.8)',
};

function useScreenTheme() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';

  return {
    dark,
    bg: dark ? COLORS.darkBg : COLORS.lightBg,
    card: dark ? COLORS.darkCard : COLORS.lightCard,
    border: dark ? COLORS.darkBorder : COLORS.lightBorder,
    text: dark ? COLORS.darkText : COLORS.lightText,
    sub: dark ? COLORS.darkSub : COLORS.lightSub,
    input: dark ? COLORS.darkInput : COLORS.lightInput,
    inputBorder: dark ? COLORS.darkInputBorder : COLORS.lightInputBorder,
  };
}

function FloatingOrb({
  startX,
  startY,
  size,
  color,
  opacity,
  driftX,
  driftY,
  duration,
}: {
  startX: number;
  startY: number;
  size: number;
  color: string;
  opacity: number;
  driftX: number;
  driftY: number;
  duration: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [anim, duration]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, driftX] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, driftY] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: startX - size / 2,
        top: startY - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateX }, { translateY }],
        shadowColor: color,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: size / 3,
      }}
    />
  );
}

function StyledInput({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  error,
  rightElement,
  theme,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: any;
  autoCapitalize?: any;
  error?: string;
  rightElement?: React.ReactNode;
  theme: ReturnType<typeof useScreenTheme>;
}) {
  const focused = useRef(new Animated.Value(0)).current;

  const borderColor = focused.interpolate({
    inputRange: [0, 1],
    outputRange: [error ? 'rgba(239,68,68,0.6)' : theme.inputBorder, COLORS.orangeBorder],
  });

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[s.inputLabel, { color: theme.sub }]}>{label}</Text>

      <Animated.View style={[s.inputWrap, { backgroundColor: theme.input, borderColor }]}>
        <BlurView
          intensity={theme.dark ? 20 : 40}
          tint={theme.dark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFillObject}
        />

        <TextInput
          style={[s.textInput, { color: theme.text }]}
          placeholder={placeholder}
          placeholderTextColor={theme.dark ? '#3A5570' : '#A0B0C0'}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize || 'none'}
          onFocus={() =>
            Animated.timing(focused, {
              toValue: 1,
              duration: 180,
              useNativeDriver: false,
            }).start()
          }
          onBlur={() =>
            Animated.timing(focused, {
              toValue: 0,
              duration: 180,
              useNativeDriver: false,
            }).start()
          }
        />

        {rightElement}
      </Animated.View>

      {error ? <Text style={s.errorText}>{error}</Text> : null}
    </View>
  );
}

function StepBar({ current, total }: { current: number; total: number }) {
  return (
    <View style={s.stepBar}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            s.stepSegment,
            { backgroundColor: i < current ? COLORS.orange : 'rgba(150,170,190,0.25)' },
            i < total - 1 && { marginRight: 6 },
          ]}
        />
      ))}
    </View>
  );
}

function OrbsBackdrop({ theme }: { theme: ReturnType<typeof useScreenTheme> }) {
  return (
    <>
      <FloatingOrb
        startX={-40}
        startY={height * 0.08}
        size={260}
        color={COLORS.orange}
        opacity={theme.dark ? 0.11 : 0.07}
        driftX={22}
        driftY={18}
        duration={5510}
      />
      <FloatingOrb
        startX={width + 40}
        startY={height * 0.42}
        size={220}
        color={COLORS.navy}
        opacity={theme.dark ? 0.32 : 0.06}
        driftX={-20}
        driftY={26}
        duration={6840}
      />
      <FloatingOrb
        startX={width * 0.3}
        startY={height * 0.76}
        size={160}
        color={COLORS.orange}
        opacity={theme.dark ? 0.08 : 0.05}
        driftX={16}
        driftY={-20}
        duration={6175}
      />
      <FloatingOrb
        startX={width * 0.82}
        startY={height * 0.22}
        size={100}
        color={COLORS.orangeLight}
        opacity={theme.dark ? 0.09 : 0.06}
        driftX={-12}
        driftY={18}
        duration={7600}
      />
    </>
  );
}

function HybridSignUp({ role }: { role: SignupRole }) {
  const theme = useScreenTheme();
  const signUp = useAuthStore((state) => state.signUp);

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
  const [showVerify, setShowVerify] = useState(false);

  const fadeTop = useRef(new Animated.Value(0)).current;
  const slideTop = useRef(new Animated.Value(30)).current;
  const fadeCard = useRef(new Animated.Value(0)).current;
  const slideCard = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeTop, { toValue: 1, duration: 460, useNativeDriver: true }),
        Animated.spring(slideTop, { toValue: 0, friction: 8, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeCard, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.spring(slideCard, { toValue: 0, friction: 8, useNativeDriver: true }),
      ]),
    ]).start();
  }, [fadeTop, slideTop, fadeCard, slideCard]);

  const stepErrors = useMemo(() => {
    const errors: Record<string, string> = {};

    if (step === 1) {
      if (!email) errors.email = 'Email is required';
      else if (!/^[^@\s]+@[^@\s]+\.edu$/i.test(email)) errors.email = 'Must be a .edu email';

      if (!fullName.trim()) errors.fullName = 'Full name is required';
    }

    if (step === 2) {
      if (!university) errors.university = 'University is required';
    }

    if (step === 3) {
      if (!password) errors.password = 'Password is required';
      else if (password.length < 8) errors.password = 'At least 8 characters';
      else if (!/[A-Z]/.test(password)) errors.password = 'Must include uppercase letter';
      else if (!/[a-z]/.test(password)) errors.password = 'Must include lowercase letter';
      else if (!/[0-9]/.test(password)) errors.password = 'Must include a number';
      else if (!/[^A-Za-z0-9]/.test(password)) errors.password = 'Must include special character';

      if (!verifyPassword) errors.verifyPassword = 'Please verify your password';
      else if (password !== verifyPassword) errors.verifyPassword = 'Passwords do not match';
    }

    if (step === 4) {
      if (!accepted) errors.accepted = 'You must accept the Terms & Privacy Policy';
    }

    return errors;
  }, [step, email, fullName, university, password, verifyPassword, accepted]);

  const allErrors = useMemo(() => {
    const errors: Record<string, string> = {};

    if (!email) errors.email = 'Email is required';
    else if (!/^[^@\s]+@[^@\s]+\.edu$/i.test(email)) errors.email = 'Must be a .edu email';

    if (!fullName.trim()) errors.fullName = 'Full name is required';
    if (!university) errors.university = 'University is required';

    if (!password) errors.password = 'Password is required';
    else if (password.length < 8) errors.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(password)) errors.password = 'Must include uppercase letter';
    else if (!/[a-z]/.test(password)) errors.password = 'Must include lowercase letter';
    else if (!/[0-9]/.test(password)) errors.password = 'Must include a number';
    else if (!/[^A-Za-z0-9]/.test(password)) errors.password = 'Must include special character';

    if (!verifyPassword) errors.verifyPassword = 'Please verify your password';
    else if (password !== verifyPassword) errors.verifyPassword = 'Passwords do not match';

    if (!accepted) errors.accepted = 'Accept Terms & Privacy to continue';

    return errors;
  }, [email, fullName, university, password, verifyPassword, accepted]);

  const roleLabel =
    role === 'both' ? 'Rider + Driver' :
    role === 'driver' ? 'Driver' :
    'Rider';

  const stepTitles = ['Your Info', 'University', 'Password', 'Review'];
  const stepSubs = [
    'Enter your email and name',
    'Choose your university',
    'Create a strong password',
    'Review and accept terms',
  ];

  const handleNext = () => {
    if (Object.keys(stepErrors).length) {
      setShowErrors(true);
      Alert.alert('Please complete this step', Object.values(stepErrors).join('\n'));
      return;
    }

    setShowErrors(false);
    if (step < 4) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setShowErrors(false);
      return;
    }

    router.back();
  };

  const onSubmit = async () => {
    if (Object.keys(allErrors).length) {
      setShowErrors(true);
      Alert.alert('Check your info', Object.values(allErrors).join('\n'));
      return;
    }

    try {
      setLoading(true);

      const trimmedName = fullName.trim();
      const [firstNamePart, ...lastNameParts] = trimmedName.split(/\s+/);
      const firstName = firstNamePart || trimmedName;
      const lastName = lastNameParts.join(' ');
      const normalizedEmail = email.trim().toLowerCase();
      const selectedUniversity = universityData?.name || university;

      await signUp({
        email: normalizedEmail,
        password,
        firstName,
        lastName,
        role,
        university: selectedUniversity,
      });

      try {
        await fetch('https://ridealongwebapp.onrender.com/api/send-welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: normalizedEmail,
            name: trimmedName,
          }),
        });
      } catch {}

      const createdLabel =
        role === 'both' ? 'rider and driver' :
        role === 'driver' ? 'driver' :
        'rider';

      Alert.alert(
        'Account Created!',
        `Your ${createdLabel} account has been created. A verification link has been sent to:\n\n${normalizedEmail}\n\nCheck your inbox to activate your account.`,
        [{ text: 'Continue to Sign In', onPress: () => router.replace('/(auth)/sign-in') }],
      );
    } catch (err: any) {
      let message = 'Sign up failed';

      if (err?.code === 'auth/email-already-in-use') message = 'This email is already registered.';
      else if (err?.code === 'auth/invalid-email') message = 'Invalid email address format.';
      else if (err?.code === 'auth/weak-password') message = 'Password is too weak.';
      else if (err?.code === 'auth/network-request-failed') message = 'Network error. Check your connection.';

      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const passwordChecks = [
    { test: password.length >= 8, label: 'At least 8 characters' },
    { test: /[A-Z]/.test(password), label: 'One uppercase letter' },
    { test: /[a-z]/.test(password), label: 'One lowercase letter' },
    { test: /[0-9]/.test(password), label: 'One number' },
    { test: /[^A-Za-z0-9]/.test(password), label: 'One special character' },
  ];

  const bgGradient: [string, string, string] = theme.dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F5F7FB', '#FFFFFF'];

  return (
    <View style={s.root}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />
      <OrbsBackdrop theme={theme} />

      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: 48 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View style={[s.topBar, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              <TouchableOpacity
                onPress={handleBack}
                style={[
                  s.backBtn,
                  { backgroundColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' },
                ]}
              >
                <Ionicons name="arrow-back" size={20} color={theme.text} />
              </TouchableOpacity>

              <Image source={require('@/assets/images/logo.png')} style={s.logoImage} resizeMode="contain" />
              <View style={{ width: 40 }} />
            </Animated.View>

            <Animated.View style={{ opacity: fadeTop, transform: [{ translateY: slideTop }] }}>
              <StepBar current={step} total={4} />
            </Animated.View>

            <Animated.View style={[s.hero, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              <Text style={[s.stepChip, { color: COLORS.orange }]}>
                {roleLabel} signup - Step {step} of 4
              </Text>
              <Text style={[s.heroTitle, { color: theme.text }]}>{stepTitles[step - 1]}</Text>
              <Text style={[s.heroSub, { color: theme.sub }]}>{stepSubs[step - 1]}</Text>
            </Animated.View>

            <Animated.View
              style={[
                s.card,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  opacity: fadeCard,
                  transform: [{ translateY: slideCard }],
                },
              ]}
            >
              <BlurView
                intensity={theme.dark ? 30 : 60}
                tint={theme.dark ? 'dark' : 'light'}
                style={StyleSheet.absoluteFillObject}
              />

              <View style={s.cardInner}>
                {step === 1 && (
                  <>
                    <StyledInput
                      label="University Email (.edu)"
                      placeholder="you@university.edu"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      error={showErrors ? stepErrors.email : undefined}
                      theme={theme}
                    />

                    <StyledInput
                      label="Full Name"
                      placeholder="Jane Doe"
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                      error={showErrors ? stepErrors.fullName : undefined}
                      theme={theme}
                    />
                  </>
                )}

                {step === 2 && (
                  <View>
                    <Text style={[s.inputLabel, { color: theme.sub }]}>University</Text>
                    <View
                      style={[
                        s.uniWrap,
                        {
                          borderColor:
                            showErrors && stepErrors.university
                              ? 'rgba(239,68,68,0.6)'
                              : theme.inputBorder,
                          backgroundColor: theme.input,
                        },
                      ]}
                    >
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
                    </View>
                    {showErrors && stepErrors.university ? (
                      <Text style={s.errorText}>{stepErrors.university}</Text>
                    ) : null}
                  </View>
                )}

                {step === 3 && (
                  <>
                    <StyledInput
                      label="Password"
                      placeholder="Enter a strong password"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      error={showErrors ? stepErrors.password : undefined}
                      theme={theme}
                      rightElement={
                        <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={s.eyeBtn}>
                          <Ionicons
                            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                            color={theme.sub}
                          />
                        </TouchableOpacity>
                      }
                    />

                    <StyledInput
                      label="Verify Password"
                      placeholder="Re-enter your password"
                      value={verifyPassword}
                      onChangeText={setVerifyPassword}
                      secureTextEntry={!showVerify}
                      error={showErrors ? stepErrors.verifyPassword : undefined}
                      theme={theme}
                      rightElement={
                        <TouchableOpacity onPress={() => setShowVerify(!showVerify)} style={s.eyeBtn}>
                          <Ionicons
                            name={showVerify ? 'eye-off-outline' : 'eye-outline'}
                            size={20}
                            color={theme.sub}
                          />
                        </TouchableOpacity>
                      }
                    />

                    <View
                      style={[
                        s.strengthBox,
                        {
                          backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                          borderColor: theme.inputBorder,
                        },
                      ]}
                    >
                      <Text style={[s.strengthTitle, { color: theme.sub }]}>Password requirements</Text>

                      {passwordChecks.map(({ test, label }) => (
                        <View key={label} style={s.strengthRow}>
                          <Ionicons
                            name={test ? 'checkmark-circle' : 'ellipse-outline'}
                            size={15}
                            color={test ? COLORS.green : theme.dark ? '#3A5068' : '#CBD5E1'}
                          />
                          <Text style={[s.strengthText, { color: test ? COLORS.green : theme.sub }]}>
                            {label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {step === 4 && (
                  <>
                    <View
                      style={[
                        s.reviewBox,
                        {
                          backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)',
                          borderColor: theme.inputBorder,
                        },
                      ]}
                    >
                      <Text style={[s.reviewTitle, { color: theme.text }]}>Review your info</Text>

                      {[
                        { icon: 'person-circle-outline' as const, label: 'Account', value: roleLabel },
                        { icon: 'mail-outline' as const, label: 'Email', value: email },
                        { icon: 'person-outline' as const, label: 'Name', value: fullName },
                        { icon: 'school-outline' as const, label: 'University', value: university },
                      ].map(({ icon, label, value }) => (
                        <View key={label} style={s.reviewRow}>
                          <View
                            style={[
                              s.reviewIcon,
                              { backgroundColor: theme.dark ? 'rgba(244,98,31,0.10)' : COLORS.orangeGlow },
                            ]}
                          >
                            <Ionicons name={icon} size={16} color={COLORS.orange} />
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text style={[s.reviewLabel, { color: theme.sub }]}>{label}</Text>
                            <Text style={[s.reviewValue, { color: theme.text }]} numberOfLines={1}>
                              {value}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>

                    <TouchableOpacity
                      onPress={() => setAccepted((value) => !value)}
                      style={s.termsRow}
                      activeOpacity={0.7}
                    >
                      <View style={[s.checkbox, accepted && s.checkboxActive]}>
                        {accepted && <Ionicons name="checkmark" size={13} color="white" />}
                      </View>

                      <Text style={[s.termsText, { color: theme.sub }]}>
                        I agree to the{' '}
                        <Text
                          onPress={() => Linking.openURL('https://ridealongwebapp.onrender.com/terms')}
                          style={s.termsLink}
                        >
                          Terms of Service
                        </Text>
                        {' '}and{' '}
                        <Text
                          onPress={() => Linking.openURL('https://ridealongwebapp.onrender.com/privacy')}
                          style={s.termsLink}
                        >
                          Privacy Policy
                        </Text>
                      </Text>
                    </TouchableOpacity>

                    {showErrors && stepErrors.accepted ? (
                      <Text style={s.errorText}>{stepErrors.accepted}</Text>
                    ) : null}
                  </>
                )}

                <TouchableOpacity
                  onPress={step < 4 ? handleNext : onSubmit}
                  disabled={loading}
                  activeOpacity={0.86}
                  style={{ marginTop: 20 }}
                >
                  <LinearGradient
                    colors={[COLORS.orange, COLORS.orangeLight]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={s.ctaBtn}
                  >
                    <Text style={s.ctaBtnText}>
                      {step < 4 ? 'Continue' : loading ? 'Creating account...' : 'Create Account'}
                    </Text>

                    {!loading && (
                      <View style={s.ctaArrow}>
                        <Ionicons name="arrow-forward" size={18} color="white" />
                      </View>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </Animated.View>

            <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} style={s.footer}>
              <Text style={[s.footerText, { color: theme.sub }]}>
                Already have an account?{'  '}
                <Text style={s.footerLink}>Sign In</Text>
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

export default function SignUpScreen() {
  return <HybridSignUp role="rider" />;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 22, flexGrow: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    height: 52,
    width: 52,
    borderRadius: 14,
  },

  stepBar: {
    flexDirection: 'row',
    marginTop: 16,
    marginBottom: 4,
  },
  stepSegment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },

  hero: {
    paddingTop: 20,
    paddingBottom: 22,
  },
  stepChip: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 42,
  },
  heroAccent: {
    color: COLORS.orange,
  },
  heroSub: {
    fontSize: 15,
    fontWeight: '400',
    marginTop: 8,
    lineHeight: 22,
  },

  card: {
    borderRadius: 26,
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 12,
  },
  cardInner: {
    padding: 24,
  },

  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  inputWrap: {
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
  },
  textInput: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '400',
    height: '100%',
  },
  errorText: {
    fontSize: 12,
    color: COLORS.red,
    marginTop: 5,
    marginLeft: 2,
  },
  eyeBtn: {
    paddingHorizontal: 14,
    height: '100%',
    justifyContent: 'center',
  },

  uniWrap: {
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
    minHeight: 52,
  },

  strengthBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    marginTop: 4,
  },
  strengthTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  strengthText: {
    fontSize: 13,
    fontWeight: '400',
  },

  reviewBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    marginBottom: 18,
  },
  reviewTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reviewIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  reviewValue: {
    fontSize: 15,
    fontWeight: '600',
  },

  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(150,170,190,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: COLORS.orange,
    borderColor: COLORS.orange,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '400',
  },
  termsLink: {
    color: COLORS.orange,
    fontWeight: '600',
  },

  ctaBtn: {
    borderRadius: 50,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: COLORS.orange,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: 'white',
    letterSpacing: 0.2,
  },
  ctaArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    alignItems: 'center',
    paddingTop: 24,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '400',
  },
  footerLink: {
    color: COLORS.orange,
    fontWeight: '700',
  },
});