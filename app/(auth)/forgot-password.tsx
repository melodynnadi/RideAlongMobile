import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Animated, Easing,
  Image, TextInput, KeyboardAvoidingView, Platform, ScrollView,
  useColorScheme, StatusBar, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { sendPasswordResetEmail } from 'firebase/auth';
import { firebaseAuth } from '@/constants/services';

const { width, height } = Dimensions.get('window');

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  orange:       '#F4621F',
  orangeLight:  '#FF8C4A',
  orangeGlow:   'rgba(244,98,31,0.15)',
  orangeBorder: 'rgba(244,98,31,0.45)',
  navy:         '#0D1B2A',
  green:        '#10B981',
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
    bg:          dark ? COLORS.darkBg          : COLORS.lightBg,
    card:        dark ? COLORS.darkCard        : COLORS.lightCard,
    border:      dark ? COLORS.darkBorder      : COLORS.lightBorder,
    text:        dark ? COLORS.darkText        : COLORS.lightText,
    sub:         dark ? COLORS.darkSub         : COLORS.lightSub,
    input:       dark ? COLORS.darkInput       : COLORS.lightInput,
    inputBorder: dark ? COLORS.darkInputBorder : COLORS.lightInputBorder,
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

// ─── Success state icon ───────────────────────────────────────────────────────
function SuccessIcon() {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale,   { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[styles.successIconWrap, { transform: [{ scale }], opacity }]}>
      <LinearGradient colors={[COLORS.green, '#34D399']} style={styles.successIconGradient}>
        <Ionicons name="checkmark" size={40} color="white" />
      </LinearGradient>
    </Animated.View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ForgotPasswordScreen() {
  const theme = useAppTheme();
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);

  // entrance animations
  const fadeTop   = useRef(new Animated.Value(0)).current;
  const slideTop  = useRef(new Animated.Value(30)).current;
  const fadeCard  = useRef(new Animated.Value(0)).current;
  const slideCard = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeTop,  { toValue: 1, duration: 480, useNativeDriver: true }),
        Animated.spring(slideTop, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeCard,  { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.spring(slideCard, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  // input focus glow
  const focused = useRef(new Animated.Value(0)).current;
  const borderColor = focused.interpolate({
    inputRange:  [0, 1],
    outputRange: [theme.inputBorder, COLORS.orangeBorder],
  });

  const handleSend = async () => {
    if (!email.trim()) {
      Alert.alert('Reset Password', 'Enter your email address first.');
      return;
    }
    try {
      setLoading(true);
      await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
      setSent(true);
    } catch {
      Alert.alert('Error', 'Could not send reset email. Check the address and try again.');
    } finally {
      setLoading(false);
    }
  };

  const bgGradient: [string, string, string] = theme.dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F5F7FB', '#FFFFFF'];

  return (
    <View style={styles.root}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />

      {/* Orbs */}
      <FloatingOrb startX={-40}          startY={height * 0.08} size={260} color={COLORS.orange} opacity={theme.dark ? 0.11 : 0.07} driftX={22}  driftY={18}  duration={5510} />
      <FloatingOrb startX={width + 40}   startY={height * 0.42} size={220} color={COLORS.navy}   opacity={theme.dark ? 0.32 : 0.06} driftX={-20} driftY={26}  duration={6840} />
      <FloatingOrb startX={width * 0.3}  startY={height * 0.78} size={160} color={COLORS.orange} opacity={theme.dark ? 0.08 : 0.05} driftX={16}  driftY={-20} duration={6175} />
      <FloatingOrb startX={width * 0.82} startY={height * 0.22} size={100} color={COLORS.orangeLight} opacity={theme.dark ? 0.09 : 0.06} driftX={-12} driftY={18} duration={7600} />

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── Top bar ── */}
            <Animated.View style={[styles.topBar, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={[styles.backBtn, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)' }]}
              >
                <Ionicons name="arrow-back" size={20} color={theme.text} />
              </TouchableOpacity>
              <Image source={require('@/assets/images/logo.png')} style={styles.logoImage} resizeMode="contain" />
            </Animated.View>

            {/* ── Hero ── */}
            <Animated.View style={[styles.hero, { opacity: fadeTop, transform: [{ translateY: slideTop }] }]}>
              {sent ? (
                <>
                  <Text style={[styles.heroTitle, { color: theme.text }]}>Email</Text>
                  <Text style={[styles.heroTitle, { color: theme.text }]}>
                    sent<Text style={styles.heroAccent}>!</Text>
                  </Text>
                  <Text style={[styles.heroSub, { color: theme.sub }]}>
                    Check your inbox for the reset link
                  </Text>
                </>
              ) : (
                <>
                  <Text style={[styles.heroTitle, { color: theme.text }]}>Reset your</Text>
                  <Text style={[styles.heroTitle, { color: theme.text }]}>
                    password<Text style={styles.heroAccent}>.</Text>
                  </Text>
                  <Text style={[styles.heroSub, { color: theme.sub }]}>
                    Enter your email and we'll send you a reset link.
                  </Text>
                </>
              )}
            </Animated.View>

            {/* ── Glass card ── */}
            <Animated.View style={[styles.card, {
              backgroundColor: theme.card, borderColor: theme.border,
              opacity: fadeCard, transform: [{ translateY: slideCard }],
            }]}>
              <BlurView intensity={theme.dark ? 30 : 60} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              <View style={styles.cardInner}>

                {!sent ? (
                  <>
                    {/* Email input */}
                    <Text style={[styles.inputLabel, { color: theme.sub }]}>Email Address</Text>
                    <Animated.View style={[styles.inputWrap, { backgroundColor: theme.input, borderColor }]}>
                      <BlurView intensity={theme.dark ? 20 : 40} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
                      <Ionicons name="mail-outline" size={18} color={theme.sub} style={{ marginLeft: 16 }} />
                      <TextInput
                        style={[styles.textInput, { color: theme.text }]}
                        placeholder="you@university.edu"
                        placeholderTextColor={theme.dark ? '#3A5570' : '#A0B0C0'}
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        onFocus={() => Animated.timing(focused, { toValue: 1, duration: 180, useNativeDriver: false }).start()}
                        onBlur={()  => Animated.timing(focused, { toValue: 0, duration: 180, useNativeDriver: false }).start()}
                      />
                    </Animated.View>

                    {/* Info row */}
                    <View style={[styles.infoRow, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: theme.border }]}>
                      <Ionicons name="shield-checkmark-outline" size={15} color={COLORS.orange} />
                      <Text style={[styles.infoText, { color: theme.sub }]}>
                        We'll only send a reset link if this email is registered.
                      </Text>
                    </View>

                    {/* CTA */}
                    <TouchableOpacity onPress={handleSend} disabled={loading} activeOpacity={0.86} style={{ marginTop: 20 }}>
                      <LinearGradient
                        colors={[COLORS.orange, COLORS.orangeLight]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={styles.ctaBtn}
                      >
                        {loading
                          ? <Ionicons name="sync" size={20} color="white" />
                          : <>
                              <Text style={styles.ctaBtnText}>Send Reset Link</Text>
                              <View style={styles.ctaArrow}>
                                <Ionicons name="arrow-forward" size={16} color="white" />
                              </View>
                            </>
                        }
                      </LinearGradient>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Success state */}
                    <SuccessIcon />

                    <Text style={[styles.successMsg, { color: theme.sub }]}>
                      A reset link has been sent to
                    </Text>
                    <View style={styles.emailChip}>
                      <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.emailChipGradient}>
                        <Ionicons name="mail-outline" size={13} color="white" />
                        <Text style={styles.emailChipText} numberOfLines={1}>{email}</Text>
                      </LinearGradient>
                    </View>

                    <View style={[styles.infoRow, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: theme.border, marginTop: 20 }]}>
                      <Ionicons name="bulb-outline" size={15} color={COLORS.orange} />
                      <Text style={[styles.infoText, { color: theme.sub }]}>
                        Check your spam folder if you don't see it within a minute.
                      </Text>
                    </View>

                    <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} activeOpacity={0.86} style={{ marginTop: 20 }}>
                      <LinearGradient
                        colors={[COLORS.orange, COLORS.orangeLight]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={styles.ctaBtn}
                      >
                        <Text style={styles.ctaBtnText}>Back to Sign In</Text>
                        <View style={styles.ctaArrow}>
                          <Ionicons name="arrow-forward" size={16} color="white" />
                        </View>
                      </LinearGradient>
                    </TouchableOpacity>
                  </>
                )}

              </View>
            </Animated.View>

            {/* ── Footer ── */}
            {!sent && (
              <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} style={styles.footer}>
                <Text style={[styles.footerText, { color: theme.sub }]}>
                  Remember your password?{'  '}
                  <Text style={styles.footerLink}>Sign In</Text>
                </Text>
              </TouchableOpacity>
            )}

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
  scroll: { paddingHorizontal: 22, paddingBottom: 48, flexGrow: 1 },

  topBar:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4 },
  backBtn:   { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  logoImage: { height: 52, width: 52, borderRadius: 14 },

  hero:       { paddingTop: 28, paddingBottom: 24 },
  heroTitle:  { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, lineHeight: 48 },
  heroAccent: { color: COLORS.orange },
  heroSub:    { fontSize: 15, fontWeight: '400', marginTop: 10, lineHeight: 22 },

  card: {
    borderRadius: 26, borderWidth: 1.5, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.10, shadowRadius: 24, elevation: 12,
  },
  cardInner: { padding: 24 },

  inputLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  inputWrap:  {
    borderRadius: 14, borderWidth: 1.5, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', height: 52,
  },
  textInput:  { flex: 1, paddingHorizontal: 12, fontSize: 15, fontWeight: '400', height: '100%' },

  infoRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  infoText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '400' },

  ctaBtn: {
    borderRadius: 50, paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10,
    shadowColor: COLORS.orange, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  ctaBtnText: { fontSize: 17, fontWeight: '700', color: 'white', letterSpacing: 0.2 },
  ctaArrow:   { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },

  // Success state
  successIconWrap:     { alignSelf: 'center', marginBottom: 20 },
  successIconGradient: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  successMsg:          { fontSize: 15, textAlign: 'center', fontWeight: '400', marginBottom: 12 },
  emailChip:           { alignSelf: 'center', borderRadius: 50, overflow: 'hidden' },
  emailChipGradient:   { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7 },
  emailChipText:       { fontSize: 13, fontWeight: '600', color: 'white', maxWidth: width * 0.65 },

  footer:     { alignItems: 'center', paddingTop: 28 },
  footerText: { fontSize: 14, fontWeight: '400' },
  footerLink: { color: COLORS.orange, fontWeight: '700' },
});