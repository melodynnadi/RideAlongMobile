import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Linking,
  RefreshControl, ScrollView, Animated, Easing, Image,
  useColorScheme, StatusBar, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { sendEmailVerification, onAuthStateChanged } from 'firebase/auth';
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
  lightBg:      '#EEF1F7',
  lightCard:    'rgba(255,255,255,0.75)',
  lightBorder:  'rgba(255,255,255,0.9)',
  lightText:    '#0D1B2A',
  lightSub:     '#5A6A7E',
};

function useAppTheme() {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  return {
    dark,
    bg:     dark ? COLORS.darkBg     : COLORS.lightBg,
    card:   dark ? COLORS.darkCard   : COLORS.lightCard,
    border: dark ? COLORS.darkBorder : COLORS.lightBorder,
    text:   dark ? COLORS.darkText   : COLORS.lightText,
    sub:    dark ? COLORS.darkSub    : COLORS.lightSub,
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

// ─── Pulse animation for envelope icon ───────────────────────────────────────
function PulsingEnvelope({ dark }: { dark: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const glow  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse, { toValue: 1.08, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glow,  { toValue: 1,    duration: 900, useNativeDriver: false }),
        ]),
        Animated.parallel([
          Animated.timing(pulse, { toValue: 1,    duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glow,  { toValue: 0,    duration: 900, useNativeDriver: false }),
        ]),
      ])
    ).start();
  }, []);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <View style={styles.envelopeWrap}>
      {/* Outer glow ring */}
      <Animated.View style={[styles.envelopeGlow, { opacity: glowOpacity }]} />
      {/* Icon circle */}
      <Animated.View style={[
        styles.envelopeCircle,
        { backgroundColor: dark ? 'rgba(244,98,31,0.12)' : 'rgba(244,98,31,0.08)', transform: [{ scale: pulse }] },
      ]}>
        <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} style={styles.envelopeGradient}>
          <Ionicons name="mail" size={36} color="white" />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function VerifyEmailScreen() {
  const theme = useAppTheme();
  const [loading,    setLoading]    = useState(false);
  const [checking,   setChecking]   = useState(false);
  const [userEmail,  setUserEmail]  = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { checkEmailVerification, signOut } = useAuthStore();

  // entrance animations
  const fadeIn  = useRef(new Animated.Value(0)).current;
  const slideIn = useRef(new Animated.Value(32)).current;
  const fadeCard  = useRef(new Animated.Value(0)).current;
  const slideCard = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeIn,  { toValue: 1, duration: 480, useNativeDriver: true }),
        Animated.spring(slideIn, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeCard,  { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.spring(slideCard, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (user) setUserEmail(user.email || '');
      else router.replace('/(auth)/sign-in');
    });
    return unsubscribe;
  }, []);

  const handleResendEmail = async () => {
    try {
      setLoading(true);
      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) {
        Alert.alert('Error', 'No user found. Please sign in again.');
        router.replace('/(auth)/sign-in');
        return;
      }
      await sendEmailVerification(currentUser);
      Alert.alert('Email Sent', 'Verification email has been sent to your inbox.');
    } catch {
      Alert.alert('Error', 'Could not send verification email. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    try {
      setChecking(true);
      const isVerified = await checkEmailVerification();
      if (isVerified) {
        Alert.alert(
          'Email Verified!',
          'Your email has been verified. You can now sign in.',
          [{ text: 'Sign In', onPress: () => router.replace('/(auth)/sign-in') }],
        );
      } else {
        Alert.alert(
          'Not Verified Yet',
          'Your email has not been verified yet. If the link expired, request a new one.',
          [
            { text: 'Resend Email', onPress: handleResendEmail },
            { text: 'Try Again',    onPress: handleCheckVerification },
            { text: 'OK', style: 'cancel' },
          ],
        );
      }
    } catch {
      Alert.alert(
        'Verification Error',
        'There was an issue checking your status. Please request a new verification email.',
        [
          { text: 'Resend Email', onPress: handleResendEmail },
          { text: 'Try Again',    onPress: handleCheckVerification },
          { text: 'OK', style: 'cancel' },
        ],
      );
    } finally {
      setChecking(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await handleCheckVerification();
    setRefreshing(false);
  };

  const bgGradient: [string, string, string] = theme.dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F5F7FB', '#FFFFFF'];

  return (
    <View style={styles.root}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />

      {/* Orbs */}
      <FloatingOrb startX={-40}         startY={height * 0.08} size={260} color={COLORS.orange} opacity={theme.dark ? 0.11 : 0.07} driftX={22} driftY={18} duration={5510} />
      <FloatingOrb startX={width + 40}  startY={height * 0.42} size={220} color={COLORS.navy}   opacity={theme.dark ? 0.32 : 0.06} driftX={-20} driftY={26} duration={6840} />
      <FloatingOrb startX={width * 0.3} startY={height * 0.78} size={160} color={COLORS.orange} opacity={theme.dark ? 0.08 : 0.05} driftX={16} driftY={-20} duration={6175} />
      <FloatingOrb startX={width * 0.82} startY={height * 0.22} size={100} color={COLORS.orangeLight} opacity={theme.dark ? 0.09 : 0.06} driftX={-12} driftY={18} duration={7600} />

      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={COLORS.orange}
              colors={[COLORS.orange]}
            />
          }
        >
          {/* ── Top bar ── */}
          <Animated.View style={[styles.topBar, { opacity: fadeIn, transform: [{ translateY: slideIn }] }]}>
            <Image source={require('@/assets/images/logo.png')} style={styles.logoImage} resizeMode="contain" />
          </Animated.View>

          {/* ── Hero ── */}
          <Animated.View style={[styles.hero, { opacity: fadeIn, transform: [{ translateY: slideIn }] }]}>
            <Text style={[styles.heroTitle, { color: theme.text }]}>Check your</Text>
            <Text style={[styles.heroTitle, { color: theme.text }]}>
              inbox<Text style={styles.heroAccent}>.</Text>
            </Text>
            <Text style={[styles.heroSub, { color: theme.sub }]}>
              We sent a verification link to
            </Text>
            <View style={styles.emailChip}>
              <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.emailChipGradient}>
                <Ionicons name="mail-outline" size={14} color="white" />
                <Text style={styles.emailChipText} numberOfLines={1}>{userEmail}</Text>
              </LinearGradient>
            </View>
          </Animated.View>

          {/* ── Glass card ── */}
          <Animated.View style={[styles.card, {
            backgroundColor: theme.card, borderColor: theme.border,
            opacity: fadeCard, transform: [{ translateY: slideCard }],
          }]}>
            <BlurView intensity={theme.dark ? 30 : 60} tint={theme.dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
            <View style={styles.cardInner}>

              {/* Pulsing envelope */}
              <PulsingEnvelope dark={theme.dark} />

              <Text style={[styles.instructions, { color: theme.sub }]}>
                Click the link in your email to activate your account. Pull down to refresh once verified.
              </Text>

              {/* Tip row */}
              <View style={[styles.tipRow, { backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderColor: theme.border }]}>
                <Ionicons name="bulb-outline" size={16} color={COLORS.orange} />
                <Text style={[styles.tipText, { color: theme.sub }]}>
                  Check your spam folder if you don't see it.
                </Text>
              </View>

              {/* Primary CTA */}
              <TouchableOpacity onPress={handleCheckVerification} disabled={checking} activeOpacity={0.86} style={{ marginTop: 20 }}>
                <LinearGradient
                  colors={[COLORS.orange, COLORS.orangeLight]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={styles.primaryBtn}
                >
                  {checking
                    ? <Ionicons name="sync" size={20} color="white" />
                    : <>
                        <Text style={styles.primaryBtnText}>I've Verified My Email</Text>
                        <View style={styles.btnArrow}><Ionicons name="checkmark" size={16} color="white" /></View>
                      </>
                  }
                </LinearGradient>
              </TouchableOpacity>

              {/* Secondary actions */}
              <View style={styles.secondaryRow}>
                <TouchableOpacity
                  onPress={handleResendEmail}
                  disabled={loading}
                  activeOpacity={0.7}
                  style={[styles.secondaryBtn, { borderColor: theme.dark ? COLORS.darkBorder : 'rgba(200,210,225,0.8)', backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.8)' }]}
                >
                  <Ionicons name="refresh-outline" size={16} color={COLORS.orange} />
                  <Text style={[styles.secondaryBtnText, { color: theme.text }]}>
                    {loading ? 'Sending…' : 'Resend Email'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => Linking.openURL('mailto:')}
                  activeOpacity={0.7}
                  style={[styles.secondaryBtn, { borderColor: theme.dark ? COLORS.darkBorder : 'rgba(200,210,225,0.8)', backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.8)' }]}
                >
                  <Ionicons name="open-outline" size={16} color={COLORS.orange} />
                  <Text style={[styles.secondaryBtnText, { color: theme.text }]}>Open Mail</Text>
                </TouchableOpacity>
              </View>

            </View>
          </Animated.View>

          {/* ── Sign out ── */}
          <TouchableOpacity onPress={() => signOut()} style={styles.footer}>
            <Text style={[styles.footerText, { color: theme.sub }]}>
              Wrong account?{'  '}
              <Text style={styles.footerLink}>Sign Out</Text>
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingBottom: 48, flexGrow: 1 },

  topBar:    { paddingTop: 8, paddingBottom: 4 },
  logoImage: { height: 52, width: 52, borderRadius: 14 },

  hero:       { paddingTop: 28, paddingBottom: 24 },
  heroTitle:  { fontSize: 40, fontWeight: '800', letterSpacing: -1.2, lineHeight: 48 },
  heroAccent: { color: COLORS.orange },
  heroSub:    { fontSize: 15, fontWeight: '400', marginTop: 10, lineHeight: 22 },

  emailChip: { marginTop: 12, alignSelf: 'flex-start', borderRadius: 50, overflow: 'hidden' },
  emailChipGradient: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7 },
  emailChipText: { fontSize: 13, fontWeight: '600', color: 'white', maxWidth: width * 0.65 },

  card: {
    borderRadius: 26, borderWidth: 1.5, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.10, shadowRadius: 24, elevation: 12,
  },
  cardInner: { padding: 24, alignItems: 'center' },

  // Envelope
  envelopeWrap:     { alignItems: 'center', justifyContent: 'center', marginBottom: 24, width: 120, height: 120 },
  envelopeGlow:     { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: COLORS.orange },
  envelopeCircle:   { width: 88, height: 88, borderRadius: 28, overflow: 'hidden' },
  envelopeGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  instructions: { fontSize: 15, textAlign: 'center', lineHeight: 24, fontWeight: '400', marginBottom: 16 },

  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 12, width: '100%' },
  tipText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '400' },

  primaryBtn: {
    borderRadius: 50, paddingVertical: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%',
    shadowColor: COLORS.orange, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  primaryBtnText: { fontSize: 17, fontWeight: '700', color: 'white', letterSpacing: 0.2 },
  btnArrow: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },

  secondaryRow: { flexDirection: 'row', gap: 12, marginTop: 14, width: '100%' },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderRadius: 14, paddingVertical: 13,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },

  footer:     { alignItems: 'center', paddingTop: 28 },
  footerText: { fontSize: 14, fontWeight: '400' },
  footerLink: { color: COLORS.orange, fontWeight: '700' },
});