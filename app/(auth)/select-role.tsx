import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  Animated, Easing, Image, useColorScheme, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

const { width, height } = Dimensions.get('window');

// ─── Design Tokens ────────────────────────────────────────────────────────────
const COLORS = {
  orange:       '#F4621F',
  orangeLight:  '#FF8C4A',
  orangeGlow:   'rgba(244,98,31,0.18)',
  orangeBorder: 'rgba(244,98,31,0.45)',
  navy:         '#0D1B2A',
  darkBg:       '#080E17',
  darkCard:     'rgba(255,255,255,0.06)',
  darkBorder:   'rgba(255,255,255,0.12)',
  darkText:     '#F0F4FF',
  darkSub:      '#7A8FA8',
  lightBg:      '#EEF1F7',
  lightCard:    'rgba(255,255,255,0.72)',
  lightBorder:  'rgba(255,255,255,0.9)',
  lightText:    '#0D1B2A',
  lightSub:     '#5A6A7E',
};

function useAppTheme() {
  const dark = useColorScheme() === 'dark';
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

// ─── Glass Card ───────────────────────────────────────────────────────────────
function GlassCard({ children, selected, onPress, dark }: {
  children: React.ReactNode; selected: boolean;
  onPress: () => void; dark: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: selected ? 1.025 : 1, useNativeDriver: true, friction: 7 }),
      Animated.timing(glow,  { toValue: selected ? 1 : 0, duration: 220, useNativeDriver: false }),
    ]).start();
  }, [selected]);

  const borderColor = glow.interpolate({
    inputRange:  [0, 1],
    outputRange: [dark ? COLORS.darkBorder : 'rgba(200,210,220,0.6)', COLORS.orangeBorder],
  });
  const bgColor = glow.interpolate({
    inputRange:  [0, 1],
    outputRange: [
      dark ? COLORS.darkCard : 'rgba(255,255,255,0.72)',
      dark ? 'rgba(244,98,31,0.10)' : 'rgba(244,98,31,0.06)',
    ],
  });

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Animated.View style={[s.glassCard, { backgroundColor: bgColor, borderColor, shadowColor: selected ? COLORS.orange : 'transparent' }]}>
          <BlurView intensity={dark ? 28 : 55} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
          <View style={s.glassCardInner}>{children}</View>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function SelectRoleScreen() {
  const theme = useAppTheme();
  const [selected, setSelected] = useState<'rider' | 'driver' | 'both' | null>(null);

  const fadeTitle  = useRef(new Animated.Value(0)).current;
  const slideTitle = useRef(new Animated.Value(28)).current;
  const fadeCards  = useRef(new Animated.Value(0)).current;
  const slideCards = useRef(new Animated.Value(40)).current;
  const fadeBottom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeTitle,  { toValue: 1, duration: 520, useNativeDriver: true }),
        Animated.spring(slideTitle, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(fadeCards,  { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.spring(slideCards, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]),
      Animated.timing(fadeBottom, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();
  }, []);

  const toggle = (role: 'rider' | 'driver') => {
    if (selected === 'both')        { setSelected(role === 'rider' ? 'driver' : 'rider'); return; }
    if (selected === role)          { setSelected(null); return; }
    if (selected !== null)          { setSelected('both'); return; }
    setSelected(role);
  };

  const handleContinue = () => {
    if (!selected) return;
    if (selected === 'driver') {
      router.push('/(auth)/driver-signup');
    } else {
      router.push({ pathname: '/(auth)/sign-up', params: { role: selected } });
    }
  };

  const riderSelected  = selected === 'rider'  || selected === 'both';
  const driverSelected = selected === 'driver' || selected === 'both';
  const bothSelected   = selected === 'both';
  const canContinue    = selected !== null;

  const bgGradient: [string, string, string] = theme.dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F5F7FB', '#FFFFFF'];

  return (
    <View style={s.root}>
      <StatusBar barStyle={theme.dark ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />

      <FloatingOrb startX={-30}        startY={height * 0.10} size={280} color={COLORS.orange}      opacity={theme.dark ? 0.11 : 0.07} driftX={24}  driftY={18}  duration={5510} />
      <FloatingOrb startX={width + 40} startY={height * 0.35} size={240} color={COLORS.navy}        opacity={theme.dark ? 0.35 : 0.07} driftX={-20} driftY={28}  duration={6840} />
      <FloatingOrb startX={width * 0.25} startY={height * 0.72} size={160} color={COLORS.orange}    opacity={theme.dark ? 0.08 : 0.05} driftX={16}  driftY={-22} duration={6175} />
      <FloatingOrb startX={width * 0.80} startY={height * 0.18} size={110} color={COLORS.orangeLight} opacity={theme.dark ? 0.09 : 0.06} driftX={-14} driftY={20} duration={7600} />

      <SafeAreaView style={s.safe}>

        {/* Logo */}
        <Animated.View style={[s.logoRow, { opacity: fadeTitle, transform: [{ translateY: slideTitle }] }]}>
          <Image source={require('@/assets/images/logo.png')} style={s.logoImage} resizeMode="contain" />
        </Animated.View>

        {/* Hero */}
        <Animated.View style={[s.hero, { opacity: fadeTitle, transform: [{ translateY: slideTitle }] }]}>
          <Text style={[s.heroTitle, { color: theme.text }]}>What do you</Text>
          <Text style={[s.heroTitle, { color: theme.text }]}>
            want to <Text style={s.heroAccent}>do?</Text>
          </Text>
          <Text style={[s.heroSub, { color: theme.sub }]}>You can choose one or both.</Text>
        </Animated.View>

        {/* Cards */}
        <Animated.View style={[s.cards, { opacity: fadeCards, transform: [{ translateY: slideCards }] }]}>

          <GlassCard selected={riderSelected} onPress={() => toggle('rider')} dark={theme.dark}>
            <View style={s.cardRow}>
              <View style={s.cardLeft}>
                <Text style={[s.cardLabel, { color: riderSelected ? COLORS.orange : theme.sub }]}>I want to</Text>
                <Text style={[s.cardName,  { color: riderSelected ? theme.text  : theme.sub }]}>Ride</Text>
                <Text style={[s.cardDesc,  { color: theme.sub }]}>Book affordable rides with{'\n'}verified student drivers</Text>
              </View>
              <View style={[s.cardIconWrap, riderSelected && s.cardIconWrapActive]}>
                <Ionicons name="car-sport" size={36} color={riderSelected ? COLORS.orange : (theme.dark ? '#3A5068' : '#BCC8D6')} />
              </View>
            </View>
            {riderSelected && (
              <View style={s.selectedBadge}>
                <Ionicons name="checkmark-circle" size={17} color={COLORS.orange} />
                <Text style={s.selectedBadgeText}>Selected</Text>
              </View>
            )}
          </GlassCard>

          <GlassCard selected={driverSelected} onPress={() => toggle('driver')} dark={theme.dark}>
            <View style={s.cardRow}>
              <View style={s.cardLeft}>
                <Text style={[s.cardLabel, { color: driverSelected ? COLORS.orange : theme.sub }]}>I want to</Text>
                <Text style={[s.cardName,  { color: driverSelected ? theme.text  : theme.sub }]}>Drive</Text>
                <Text style={[s.cardDesc,  { color: theme.sub }]}>Earn money giving rides{'\n'}on your own schedule</Text>
              </View>
              <View style={[s.cardIconWrap, driverSelected && s.cardIconWrapActive]}>
                <Ionicons name="car" size={36} color={driverSelected ? COLORS.orange : (theme.dark ? '#3A5068' : '#BCC8D6')} />
              </View>
            </View>
            {driverSelected && (
              <View style={s.selectedBadge}>
                <Ionicons name="checkmark-circle" size={17} color={COLORS.orange} />
                <Text style={s.selectedBadgeText}>Selected</Text>
              </View>
            )}
          </GlassCard>

          <TouchableOpacity style={s.bothRow} onPress={() => setSelected(bothSelected ? null : 'both')} activeOpacity={0.7}>
            <View style={[s.checkbox, bothSelected && s.checkboxActive]}>
              {bothSelected && <Ionicons name="checkmark" size={13} color="white" />}
            </View>
            <Text style={[s.bothText, { color: theme.sub }]}>
              I want to do <Text style={{ color: theme.text, fontWeight: '600' }}>both</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* CTA */}
        <Animated.View style={[s.bottom, { opacity: fadeBottom }]}>
          <TouchableOpacity onPress={handleContinue} disabled={!canContinue} activeOpacity={0.86}>
            <LinearGradient
              colors={canContinue
                ? [COLORS.orange, COLORS.orangeLight]
                : (theme.dark ? ['#1C2A38', '#1C2A38'] : ['#D8DFE8', '#D8DFE8'])}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.ctaButton}
            >
              <Text style={[s.ctaText, !canContinue && { color: theme.dark ? '#3A5068' : '#9CAABB' }]}>
                Continue
              </Text>
              {canContinue && (
                <View style={s.ctaArrow}>
                  <Ionicons name="arrow-forward" size={18} color="white" />
                </View>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(auth)/sign-in')} style={s.signInRow}>
            <Text style={[s.signInText, { color: theme.sub }]}>
              Already have an account?{'  '}
              <Text style={s.signInLink}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>

      </SafeAreaView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: 22 },

  logoRow:   { paddingTop: 10, paddingBottom: 4 },
  logoImage: { height: 52, width: 52, borderRadius: 14 },

  hero:       { paddingTop: 32, paddingBottom: 28 },
  heroTitle:  { fontSize: 38, fontWeight: '800', letterSpacing: -1, lineHeight: 46 },
  heroAccent: { color: COLORS.orange },
  heroSub:    { fontSize: 15, fontWeight: '400', marginTop: 10, lineHeight: 22 },

  cards: { gap: 14 },
  glassCard: {
    borderRadius: 22, borderWidth: 1.5, overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10,
  },
  glassCardInner:    { padding: 20 },
  cardRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft:          { flex: 1 },
  cardLabel:         { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 },
  cardName:          { fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginBottom: 6 },
  cardDesc:          { fontSize: 13, lineHeight: 19, fontWeight: '400' },
  cardIconWrap:      { width: 68, height: 68, borderRadius: 18, backgroundColor: 'rgba(180,200,220,0.10)', alignItems: 'center', justifyContent: 'center' },
  cardIconWrapActive:{ backgroundColor: COLORS.orangeGlow },
  selectedBadge:     { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.orangeBorder },
  selectedBadgeText: { fontSize: 13, color: COLORS.orange, fontWeight: '600' },

  bothRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 2 },
  checkbox:       { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: 'rgba(150,170,190,0.5)', alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: COLORS.orange, borderColor: COLORS.orange },
  bothText:       { fontSize: 14, fontWeight: '400' },

  bottom:    { flex: 1, justifyContent: 'flex-end', paddingBottom: 28, gap: 16 },
  ctaButton: { borderRadius: 50, paddingVertical: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  ctaText:   { fontSize: 17, fontWeight: '700', color: 'white', letterSpacing: 0.2 },
  ctaArrow:  { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  signInRow: { alignItems: 'center' },
  signInText:{ fontSize: 14, fontWeight: '400' },
  signInLink:{ color: COLORS.orange, fontWeight: '700' },
});