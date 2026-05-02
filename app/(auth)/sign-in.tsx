import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  Animated,
  Easing,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  useColorScheme,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { firebaseAuth } from '@/constants/services';
import { useAuthStore } from '@/stores/authStore';

const { width, height } = Dimensions.get('window');

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  orange:       '#F4621F',
  orangeLight:  '#FF8C4A',
  orangeGlow:   'rgba(244,98,31,0.15)',
  orangeBorder: 'rgba(244,98,31,0.45)',
  navy:         '#0D1B2A',
  darkBg:       '#080E17',
  darkCard:     'rgba(255,255,255,0.06)',
  darkBorder:   'rgba(255,255,255,0.11)',
  darkText:     '#F0F4FF',
  darkSub:      '#7A8FA8',
  darkInput:    'rgba(255,255,255,0.07)',
  darkInputBorder: 'rgba(255,255,255,0.13)',
  lightBg:      '#EEF1F7',
  lightCard:    'rgba(255,255,255,0.75)',
  lightBorder:  'rgba(255,255,255,0.9)',
  lightText:    '#0D1B2A',
  lightSub:     '#5A6A7E',
  lightInput:   'rgba(255,255,255,0.9)',
  lightInputBorder: 'rgba(200,210,225,0.8)',
};

function useAppTheme() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  return {
    dark,
    bg:           dark ? COLORS.darkBg          : COLORS.lightBg,
    card:         dark ? COLORS.darkCard        : COLORS.lightCard,
    border:       dark ? COLORS.darkBorder      : COLORS.lightBorder,
    text:         dark ? COLORS.darkText        : COLORS.lightText,
    sub:          dark ? COLORS.darkSub         : COLORS.lightSub,
    input:        dark ? COLORS.darkInput       : COLORS.lightInput,
    inputBorder:  dark ? COLORS.darkInputBorder : COLORS.lightInputBorder,
  };
}

// ─── Floating Orb ─────────────────────────────────────────────────────────────
function FloatingOrb({ startX, startY, size, color, opacity, driftX, driftY, duration }: {
  startX: number; startY: number; size: number; color: string;
  opacity: number; driftX: number; driftY: number; duration: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, driftX] });
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, driftY] });
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute',
      left: startX - size / 2, top: startY - size / 2,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color, opacity,
      transform: [{ translateX }, { translateY }],
      shadowColor: color, shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.8, shadowRadius: size / 3,
    }} />
  );
}

// ─── Styled Input ─────────────────────────────────────────────────────────────
interface StyledInputProps {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: any;
  autoCapitalize?: any;
  error?: string;
  rightElement?: React.ReactNode;
  dark: boolean;
  theme: ReturnType<typeof useAppTheme>;
}
function StyledInput({ label, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, error, rightElement, dark, theme }: StyledInputProps) {
  const focused = useRef(new Animated.Value(0)).current;
  const borderColor = focused.interpolate({
    inputRange: [0, 1],
    outputRange: [error ? 'rgba(239,68,68,0.6)' : theme.inputBorder, COLORS.orangeBorder],
  });
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={[styles.inputLabel, { color: theme.sub }]}>{label}</Text>
      <Animated.View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor }]}>
        <BlurView intensity={dark ? 20 : 40} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
        <TextInput
          style={[styles.textInput, { color: theme.text }]}
          placeholder={placeholder}
          placeholderTextColor={dark ? '#3A5570' : '#A0B0C0'}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize || 'none'}
          onFocus={() => Animated.timing(focused, { toValue: 1, duration: 180, useNativeDriver: false }).start()}
          onBlur={()  => Animated.timing(focused, { toValue: 0, duration: 180, useNativeDriver: false }).start()}
        />
        {rightElement}
      </Animated.View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SignInScreen() {
  const theme = useAppTheme();
  const { signIn } = useAuthStore();

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [showErrors,   setShowErrors]   = useState(false);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!email)    e.email    = 'Email is required';
    if (!password) e.password = 'Password is required';
    return e;
  }, [email, password]);

  const onSubmit = async () => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      Alert.alert('Check your info', Object.values(errors).join('\n'));
      return;
    }
    try {
      setLoading(true);
      await signIn(email.trim().toLowerCase(), password);
    } catch (err: any) {
      let msg = 'Sign in failed';
      if (err?.code === 'auth/invalid-credential')  msg = 'Invalid email or password';
      if (err?.code === 'auth/user-not-found')       msg = 'No account found with this email';
      if (err?.code === 'auth/wrong-password')       msg = 'Incorrect password';
      if (err?.code === 'auth/too-many-requests')    msg = 'Too many attempts. Try again later.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const onForgot = async () => {
    if (!email) { Alert.alert('Reset Password', 'Enter your email first.'); return; }
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
      Alert.alert('Reset Email Sent', 'Check your inbox for a reset link.');
    } catch {
      Alert.alert('Error', 'Could not send reset email.');
    }
  };

  // entrance animations
  const fadeTop    = useRef(new Animated.Value(0)).current;
  const slideTop   = useRef(new Animated.Value(30)).current;
  const fadeCard   = useRef(new Animated.Value(0)).current;
  const slideCard  = useRef(new Animated.Value(40)).current;
  const fadeBottom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeTop,  { toValue: 1, duration: 480, useNativeDriver: true }),
        Animated.spring(slideTop, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeCard,  { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(slideCard, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
      Animated.timing(fadeBottom, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  const bgGradient: [string, string, string] = theme.dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F5F7FB', '#FFFFFF'];

  return (
    <View style={styles.root}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />

      {/* Orbs */}
      <FloatingOrb startX={-40}        startY={height * 0.08} size={260} color={COLORS.orange} opacity={theme.dark ? 0.11 : 0.07} driftX={22} driftY={18} duration={5510} />
      <FloatingOrb startX={width + 40} startY={height * 0.40} size={220} color={COLORS.navy}   opacity={theme.dark ? 0.32 : 0.06} driftX={-20} driftY={26} duration={6840} />
      <FloatingOrb startX={width * 0.3} startY={height * 0.75} size={160} color={COLORS.orange} opacity={theme.dark ? 0.08 : 0.05} driftX={16} driftY={-20} duration={6175} />
      <FloatingOrb startX={width * 0.82} startY={height * 0.20} size={100} color={COLORS.orangeLight} opacity={theme.dark ? 0.09 : 0.06} driftX={-12} driftY={18} duration={7600} />

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── Top bar ── */}
            <Animated.View style={[styles.topBar, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }]}>
                <Ionicons name="arrow-back" size={20} color={theme.text} />
              </TouchableOpacity>
              <Image source={require('@/assets/images/logo.png')} style={styles.logoImage} resizeMode="contain" />
            </Animated.View>

            {/* ── Hero ── */}
            <Animated.View style={[styles.hero, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              <Text style={[styles.heroTitle, { color: theme.text }]}>Welcome</Text>
              <Text style={[styles.heroTitle, { color: theme.text }]}>
                back<Text style={styles.heroAccent}>!</Text>
              </Text>
              <Text style={[styles.heroSub, { color: theme.sub }]}>
                Sign in to continue your ride
              </Text>
            </Animated.View>

            {/* ── Glass form card ── */}
            <Animated.View style={[styles.card, {
              backgroundColor: theme.card,
              borderColor: theme.border,
              opacity: fadeCard,
              transform: [{ translateY: slideCard }],
            }]}>
              <BlurView intensity={theme.dark ? 30 : 60} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              <View style={styles.cardInner}>

                <StyledInput
                  label="Email"
                  placeholder="you@university.edu"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  error={showErrors ? errors.email : undefined}
                  dark={theme.dark}
                  theme={theme}
                />

                <StyledInput
                  label="Password"
                  placeholder="Your password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  error={showErrors ? errors.password : undefined}
                  dark={theme.dark}
                  theme={theme}
                  rightElement={
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                      <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.sub} />
                    </TouchableOpacity>
                  }
                />

                {/* Forgot */}
                <TouchableOpacity onPress={onForgot} style={styles.forgotRow}>
                  <Text style={styles.forgotText}>Forgot password?</Text>
                </TouchableOpacity>

                {/* Sign In Button */}
                <TouchableOpacity onPress={onSubmit} disabled={loading} activeOpacity={0.86} style={{ marginTop: 8 }}>
                  <LinearGradient
                    colors={[COLORS.orange, COLORS.orangeLight]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.signInBtn}
                  >
                    {loading
                      ? <Ionicons name="sync" size={22} color="white" />
                      : <Text style={styles.signInBtnText}>Sign In</Text>
                    }
                  </LinearGradient>
                </TouchableOpacity>

                {/* Divider */}
                <View style={styles.divider}>
                  <View style={[styles.dividerLine, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                  <Text style={[styles.dividerText, { color: theme.sub }]}>or continue with</Text>
                  <View style={[styles.dividerLine, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }]} />
                </View>

                {/* Social buttons */}
                <View style={styles.socialRow}>
                  {(['logo-google', 'logo-apple', 'mail'] as const).map((icon) => (
                    <TouchableOpacity key={icon} style={[styles.socialBtn, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.9)', borderColor: theme.inputBorder }]} activeOpacity={0.7}>
                      <Ionicons name={icon} size={22} color={theme.text} />
                    </TouchableOpacity>
                  ))}
                </View>

              </View>
            </Animated.View>

            {/* ── Footer ── */}
            <Animated.View style={[styles.footer, { opacity: fadeBottom }]}>
              <TouchableOpacity onPress={() => router.replace('/(auth)/select-role')}>
                <Text style={[styles.footerText, { color: theme.sub }]}>
                  New to RideAlong?{'  '}
                  <Text style={styles.footerLink}>Create Account</Text>
                </Text>
              </TouchableOpacity>
            </Animated.View>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingBottom: 40, flexGrow: 1 },

  // Top bar
 topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12, paddingTop: 8, paddingBottom: 4 },
logoImage: { height: 52, width: 52, borderRadius: 14 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  // Hero
  hero: { paddingTop: 28, paddingBottom: 28 },
  heroTitle:  { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, lineHeight: 48, color: '#0D1B2A' },
  heroAccent: { color: COLORS.orange },
  heroSub:    { fontSize: 15, fontWeight: '400', marginTop: 10, lineHeight: 22 },

  // Card
  card: {
    borderRadius: 26, borderWidth: 1.5, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12, shadowRadius: 24, elevation: 12,
  },
  cardInner: { padding: 24 },

  // Input
  inputLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  inputWrap: {
    borderRadius: 14, borderWidth: 1.5, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', height: 52,
  },
  textInput: { flex: 1, paddingHorizontal: 16, fontSize: 15, fontWeight: '400', height: '100%' },
  errorText: { fontSize: 12, color: '#EF4444', marginTop: 5, marginLeft: 2 },
  eyeBtn: { paddingHorizontal: 14, height: '100%', justifyContent: 'center' },

  // Forgot
  forgotRow: { alignItems: 'flex-end', marginTop: -4, marginBottom: 4 },
  forgotText: { fontSize: 13, color: COLORS.orange, fontWeight: '600' },

  // Sign in button
  signInBtn: { borderRadius: 50, paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.orange, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 8 },
  signInBtnText: { fontSize: 17, fontWeight: '700', color: 'white', letterSpacing: 0.2 },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 22 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: '500' },

  // Social
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  socialBtn: {
    width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6,
  },

  // Footer
  footer: { alignItems: 'center', paddingTop: 28 },
  footerText: { fontSize: 14, fontWeight: '400' },
  footerLink: { color: COLORS.orange, fontWeight: '700' },
});