/**
 * DynamicLegalDocument — Glassmorphic redesign
 * Covers: Terms of Service + Privacy Policy (rider + driver)
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Text, StyleSheet, ScrollView, View, TouchableOpacity,
  ActivityIndicator, Alert, Animated, Easing, Image,
  useColorScheme, StatusBar, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  fetchTermsOfService,
  fetchPrivacyPolicy,
  getFallbackContent,
} from '@/utils/legalDocumentsService';
import type { LegalDocument } from '@/types';

const { width, height } = Dimensions.get('window');

const COLORS = {
  orange:       '#F4621F',
  orangeLight:  '#FF8C4A',
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
    card:   dark ? COLORS.darkCard   : COLORS.lightCard,
    border: dark ? COLORS.darkBorder : COLORS.lightBorder,
    text:   dark ? COLORS.darkText   : COLORS.lightText,
    sub:    dark ? COLORS.darkSub    : COLORS.lightSub,
  };
}

function formatDate(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) {
    return value.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  // Firestore Timestamp
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as any).toDate === 'function') {
    return (value as any).toDate().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return String(value);
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

// ─── Markdown renderer ────────────────────────────────────────────────────────
function ContentRenderer({ content, theme }: { content: string; theme: ReturnType<typeof useAppTheme> }) {
  const parseBold = (text: string, baseStyle: any): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.*?)\*\*/g;
    let last = 0; let match; let k = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) parts.push(<Text key={k++} style={baseStyle}>{text.slice(last, match.index)}</Text>);
      parts.push(<Text key={k++} style={[baseStyle, { fontWeight: '700' }]}>{match[1]}</Text>);
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(<Text key={k++} style={baseStyle}>{text.slice(last)}</Text>);
    return parts.length ? parts : [<Text key={0} style={baseStyle}>{text}</Text>];
  };

  const elements: React.ReactNode[] = content.split('\n').map((line, i) => {
    const t = line.trim();
    if (!t) return <View key={i} style={{ height: 8 }} />;
    if (t.startsWith('# '))   return <Text key={i} style={[s.h1, { color: COLORS.orange }]}>{parseBold(t.slice(2), [s.h1, { color: COLORS.orange }])}</Text>;
    if (t.startsWith('## '))  return <Text key={i} style={[s.h2, { color: theme.text }]}>{parseBold(t.slice(3), [s.h2, { color: theme.text }])}</Text>;
    if (t.startsWith('### ')) return <Text key={i} style={[s.h3, { color: theme.text }]}>{parseBold(t.slice(4), [s.h3, { color: theme.text }])}</Text>;
    if (t.startsWith('- '))   return (
      <View key={i} style={s.listItem}>
        <View style={s.bulletDot} />
        <Text style={[s.listText, { color: theme.sub }]}>{parseBold(t.slice(2), [s.listText, { color: theme.sub }])}</Text>
      </View>
    );
    return <Text key={i} style={[s.paragraph, { color: theme.sub }]}>{parseBold(t, [s.paragraph, { color: theme.sub }])}</Text>;
  });

  return <View style={{ gap: 4 }}>{elements}</View>;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface DynamicLegalDocumentProps {
  documentType: 'terms' | 'privacy';
  onBack?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function DynamicLegalDocument({ documentType, onBack }: DynamicLegalDocumentProps) {
  const theme = useAppTheme();
  const [doc,          setDoc]          = useState<LegalDocument | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fadeIn  = useRef(new Animated.Value(0)).current;
  const slideIn = useRef(new Animated.Value(24)).current;

  const handleBack = () => { if (onBack) onBack(); else router.back(); };

  const fetchDoc = async (showRefresh = false) => {
    try {
      if (showRefresh) setIsRefreshing(true); else setLoading(true);
      setError(null);
      const result = documentType === 'terms' ? await fetchTermsOfService() : await fetchPrivacyPolicy();
      if (result.success && result.document) {
        setDoc(result.document);
      } else {
        throw new Error(result.error || 'Failed to load');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setDoc(getFallbackContent(documentType) as LegalDocument);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      Animated.parallel([
        Animated.timing(fadeIn,  { toValue: 1, duration: 480, useNativeDriver: true }),
        Animated.spring(slideIn, { toValue: 0, friction: 8,   useNativeDriver: true }),
      ]).start();
    }
  };

  useEffect(() => { fetchDoc(); }, [documentType]);

  const handleRefresh = () => fetchDoc(true);
  const handleRetry   = () => Alert.alert('Retry', 'Load the document again?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Retry',  onPress: () => fetchDoc() },
  ]);

  const title = doc?.title || (documentType === 'terms' ? 'Terms of Service' : 'Privacy Policy');
  const icon  = documentType === 'terms' ? 'document-text' : 'shield-checkmark';
  const dark  = theme.dark;

  const bgGradient: [string, string, string] = dark
    ? ['#080E17', '#0D1620', '#111E2C']
    : ['#EEF1F7', '#F5F7FB', '#FFFFFF'];

  const backBtnBg = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)';

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />
        <FloatingOrb startX={-40} startY={height * 0.1} size={240} color={COLORS.orange} opacity={dark ? 0.10 : 0.06} driftX={20} driftY={16} duration={5510} />
        <SafeAreaView style={s.safe}>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.topBar}>
            <TouchableOpacity onPress={handleBack} style={[s.iconBtn, { backgroundColor: backBtnBg }]}>
              <Ionicons name="arrow-back" size={20} color={theme.text} />
            </TouchableOpacity>
            <Image source={require('@/assets/images/logo.png')} style={s.logoImage} resizeMode="contain" />
          </View>
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={COLORS.orange} />
            <Text style={[s.loadingText, { color: theme.sub }]}>Loading {title}…</Text>
          </View>
                  </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={bgGradient} style={StyleSheet.absoluteFillObject} />
      <FloatingOrb startX={-40}          startY={height * 0.08} size={260} color={COLORS.orange}      opacity={dark ? 0.10 : 0.06} driftX={22}  driftY={18}  duration={5510} />
      <FloatingOrb startX={width + 40}   startY={height * 0.45} size={200} color={COLORS.navy}        opacity={dark ? 0.28 : 0.05} driftX={-18} driftY={24}  duration={6840} />
      <FloatingOrb startX={width * 0.82} startY={height * 0.22} size={100} color={COLORS.orangeLight} opacity={dark ? 0.08 : 0.05} driftX={-10} driftY={16}  duration={7600} />

      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Animated.View style={[s.topBar, { opacity: fadeIn, transform: [{ translateY: slideIn }] }]}>
          <TouchableOpacity onPress={handleBack} style={[s.iconBtn, { backgroundColor: backBtnBg }]}>
            <Ionicons name="arrow-back" size={20} color={theme.text} />
          </TouchableOpacity>
          <Image source={require('@/assets/images/logo.png')} style={s.logoImage} resizeMode="contain" />
          <TouchableOpacity onPress={handleRefresh} disabled={isRefreshing} style={[s.iconBtn, { backgroundColor: backBtnBg }]}>
            <Ionicons name="refresh" size={18} color={isRefreshing ? theme.sub : theme.text} />
          </TouchableOpacity>
        </Animated.View>

          {/* Hero */}
          <Animated.View style={[s.hero, { opacity: fadeIn, transform: [{ translateY: slideIn }] }]}>
            <LinearGradient colors={[COLORS.orange, COLORS.orangeLight]} style={s.docIcon}>
              <Ionicons name={icon as any} size={28} color="white" />
            </LinearGradient>
            <Text style={[s.heroTitle, { color: theme.text }]}>{title}</Text>
            {doc?.lastUpdated ? (
              <Text style={[s.heroSub, { color: theme.sub }]}>
                Last updated {formatDate(doc.lastUpdated)}
              </Text>
            ) : null}
          </Animated.View>

          {/* Error banner */}
          {error ? (
            <Animated.View style={[s.errorBanner, { opacity: fadeIn }]}>
              <BlurView intensity={dark ? 20 : 40} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              <View style={s.errorInner}>
                <Ionicons name="wifi-outline" size={16} color="#EF4444" />
                <Text style={s.errorText}>Content may be outdated.</Text>
                <TouchableOpacity onPress={handleRetry} style={s.retryBtn}>
                  <Text style={s.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          ) : null}

          {/* Content card */}
          {doc?.content ? (
            <Animated.View style={[s.card, { backgroundColor: theme.card, borderColor: theme.border, opacity: fadeIn, transform: [{ translateY: slideIn }] }]}>
              <BlurView intensity={dark ? 28 : 55} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFillObject} />
              <View style={s.cardInner}>
                <ContentRenderer content={doc.content} theme={theme} />
              </View>
            </Animated.View>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  topBar:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4 },
  iconBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  logoImage:   { height: 52, width: 52, borderRadius: 14, marginRight: 'auto' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 15, fontWeight: '500' },
  scroll:      { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 48 },
  hero:        { paddingTop: 24, paddingBottom: 24 },
  docIcon:     { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroTitle:   { fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 42, marginBottom: 6 },
  heroSub:     { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  errorBanner: { borderRadius: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', overflow: 'hidden', marginBottom: 16 },
  errorInner:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  errorText:   { flex: 1, fontSize: 13, color: '#EF4444', fontWeight: '500' },
  retryBtn:    { backgroundColor: '#EF4444', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  retryText:   { color: 'white', fontSize: 12, fontWeight: '600' },
  card:        { borderRadius: 22, borderWidth: 1.5, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 8 },
  cardInner:   { padding: 22 },
  h1:          { fontSize: 26, fontWeight: '800', marginBottom: 8, marginTop: 16, letterSpacing: -0.5 },
  h2:          { fontSize: 20, fontWeight: '700', marginBottom: 6, marginTop: 20, letterSpacing: -0.3 },
  h3:          { fontSize: 16, fontWeight: '600', marginBottom: 4, marginTop: 12 },
  paragraph:   { fontSize: 14, lineHeight: 23, marginBottom: 6, fontWeight: '400' },
  listItem:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 5, paddingLeft: 4 },
  bulletDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.orange, marginTop: 8, flexShrink: 0 },
  listText:    { flex: 1, fontSize: 14, lineHeight: 23, fontWeight: '400' },
});

export default DynamicLegalDocument;