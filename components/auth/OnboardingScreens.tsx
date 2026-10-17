import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { DatePickerModal } from '@/components/DateTimePickerModals';
import { firebaseAuth, firestore } from '@/constants/services';
import { MAJORS } from '@/constants/universities';
import { AppColors } from '@/constants/theme';
import { useAppTheme } from '@/hooks/ThemeContext';
import { pickAndUploadAvatar } from '@/services/avatarUpload';
import { useAuthStore } from '@/stores/authStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { hitSlop } from '@/theme/designSystem';

type IconName = keyof typeof Ionicons.glyphMap;

const WELCOME_IMAGE = require('@/assets/images/onboarding-welcome.jpg');

function tapFeedback() {
  Haptics.selectionAsync().catch(() => {});
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function useStyles(colors: AppColors) {
  return useMemo(
    () =>
      StyleSheet.create({
        flex: { flex: 1 },
        safe: { flex: 1, backgroundColor: colors.bg },

        // Welcome
        welcomeRoot: { flex: 1, backgroundColor: colors.bg },
        welcomeBrand: {
          position: 'absolute',
          left: 24,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 20,
          backgroundColor: 'rgba(0,0,0,0.35)',
        },
        welcomeBrandText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
        welcomeBody: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 24 },
        welcomeEyebrow: {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 14,
          backgroundColor: colors.primaryDim,
          marginBottom: 14,
        },
        welcomeEyebrowText: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
        welcomeTitle: { color: colors.textPrimary, fontSize: 42, lineHeight: 48, fontWeight: '600', letterSpacing: -1 },
        welcomeSubtitle: { color: colors.textSecondary, fontSize: 16, lineHeight: 23, marginTop: 12, marginBottom: 28 },
        textButton: { alignItems: 'center', justifyContent: 'center', minHeight: 50, marginTop: 6 },
        textButtonLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },

        // Shell
        content: {
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: 40,
          flexGrow: 1,
        },
        header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 28, minHeight: 38 },
        backBtn: {
          width: 38,
          height: 38,
          borderRadius: 19,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          alignItems: 'center',
          justifyContent: 'center',
        },
        progressWrap: { flex: 1, gap: 7 },
        progressLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
        progressTrack: { height: 3, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' },
        progressFill: { height: 3, backgroundColor: colors.primary, borderRadius: 2 },
        skipText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },

        heading: { marginBottom: 26 },
        title: { color: colors.textPrimary, fontSize: 36, lineHeight: 43, fontWeight: '600', letterSpacing: -0.75 },
        titleAccent: { color: colors.primary, fontStyle: 'italic' },
        subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 10 },

        // Buttons
        primaryButton: {
          minHeight: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          flexDirection: 'row',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
        },
        primaryButtonText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
        secondaryButton: {
          minHeight: 54,
          borderRadius: 27,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          flexDirection: 'row',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 12,
        },
        secondaryButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
        buttonDisabled: { opacity: 0.55 },
        footerNote: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 16 },

        // Photo
        avatarWrap: { alignItems: 'center', marginBottom: 28 },
        avatarCircle: {
          width: 156,
          height: 156,
          borderRadius: 78,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: colors.primary,
          backgroundColor: colors.primaryDim,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        avatarCircleFilled: { borderStyle: 'solid', borderWidth: 3 },
        avatarImage: { width: '100%', height: '100%' },
        avatarOverlay: {
          ...StyleSheet.absoluteFillObject,
          backgroundColor: 'rgba(0,0,0,0.45)',
          alignItems: 'center',
          justifyContent: 'center',
        },
        avatarBadge: {
          position: 'absolute',
          bottom: 4,
          right: 4,
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: colors.primary,
          borderWidth: 3,
          borderColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        tipBox: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          padding: 14,
          borderRadius: 14,
          backgroundColor: colors.bgSecondary,
          marginTop: 20,
        },
        tipText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
        tipStrong: { color: colors.textPrimary, fontWeight: '700' },

        // Fields
        field: { marginBottom: 20 },
        fieldLabel: { color: colors.textSecondary, fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
        inputWrap: {
          minHeight: 54,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          gap: 10,
        },
        inputWrapFocused: { borderColor: colors.primary },
        input: { flex: 1, minWidth: 0, alignSelf: 'stretch', color: colors.textPrimary, fontSize: 16, paddingVertical: 0 },
        inputValue: { flex: 1, color: colors.textPrimary, fontSize: 16 },
        inputPlaceholder: { flex: 1, color: colors.textSecondary, fontSize: 16 },
        suggestions: {
          marginTop: 6,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          overflow: 'hidden',
        },
        suggestionRow: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
        suggestionText: { color: colors.textPrimary, fontSize: 15 },

        // Chips
        chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        chip: {
          minHeight: 42,
          paddingHorizontal: 16,
          borderRadius: 21,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          alignItems: 'center',
          justifyContent: 'center',
        },
        chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
        chipText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
        chipTextActive: { color: colors.primary, fontWeight: '700' },

        // Preferences
        questionMeta: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
        segments: { flexDirection: 'row', gap: 6, marginBottom: 22 },
        segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
        segmentActive: { backgroundColor: colors.primary },
        questionTitle: { color: colors.textPrimary, fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.5, marginBottom: 22 },
        grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
        gridTile: {
          width: '31%',
          flexGrow: 1,
          minHeight: 86,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 6,
        },
        tileActive: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.primaryDim },
        tileText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
        tileTextActive: { color: colors.primary, fontWeight: '700' },
        optionList: { gap: 10, marginBottom: 24 },
        optionRow: {
          minHeight: 72,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
        optionIcon: {
          width: 42,
          height: 42,
          borderRadius: 12,
          backgroundColor: colors.bgSecondary,
          alignItems: 'center',
          justifyContent: 'center',
        },
        optionIconActive: { backgroundColor: colors.primary },
        optionCopy: { flex: 1 },
        optionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
        optionSub: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
        radio: {
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: 1.5,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        },
        radioActive: { borderColor: colors.primary, backgroundColor: colors.primary },

        // Done
        doneIcon: {
          width: 84,
          height: 84,
          borderRadius: 42,
          backgroundColor: colors.greenDim,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 24,
          marginBottom: 22,
        },
        summaryCard: {
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bgCard,
          marginBottom: 20,
        },
        summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
        summaryDivider: { height: 1, backgroundColor: colors.border, marginLeft: 72 },
        summaryThumb: {
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: colors.bgSecondary,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        summaryTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
        summaryDetail: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
        summaryEdit: { color: colors.primary, fontSize: 13, fontWeight: '700' },
        infoNote: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 8,
          padding: 13,
          borderRadius: 12,
          backgroundColor: colors.primaryDim,
          marginBottom: 20,
        },
        infoNoteText: { flex: 1, color: colors.primary, fontSize: 13, lineHeight: 19 },
      }),
    [colors],
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  icon,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { colors } = useAppTheme();
  const s = useStyles(colors);
  return (
    <TouchableOpacity
      style={[s.primaryButton, (disabled || loading) && s.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator color={colors.textInverse} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={19} color={colors.textInverse} /> : null}
          <Text style={s.primaryButtonText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress, icon, disabled }: { label: string; onPress: () => void; icon?: IconName; disabled?: boolean }) {
  const { colors } = useAppTheme();
  const s = useStyles(colors);
  return (
    <TouchableOpacity
      style={[s.secondaryButton, disabled && s.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      {icon ? <Ionicons name={icon} size={19} color={colors.textPrimary} /> : null}
      <Text style={s.secondaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function Heading({ title, accent, subtitle }: { title: string; accent: string; subtitle?: string }) {
  const { colors } = useAppTheme();
  const s = useStyles(colors);
  return (
    <View style={s.heading}>
      <Text style={s.title}>
        {title} <Text style={s.titleAccent}>{accent}</Text>
      </Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

// ─── Welcome ─────────────────────────────────────────────────────────────────

export function WelcomeScreen() {
  const { colors } = useAppTheme();
  const s = useStyles(colors);
  const { height } = useWindowDimensions();
  const photoHeight = Math.round(height * 0.6);

  return (
    <View style={s.welcomeRoot}>
      <StatusBar style="light" />
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: photoHeight }}>
        <Image source={WELCOME_IMAGE} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="center" transition={250} />
        <LinearGradient
          colors={['rgba(0,0,0,0.35)', 'transparent']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 140 }}
        />
        <LinearGradient
          colors={['transparent', colors.bg]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: photoHeight * 0.45 }}
        />
      </View>

      <SafeAreaView style={s.flex} edges={['top', 'bottom', 'left', 'right']}>
        <View style={[s.welcomeBrand, { top: 12 }]}>
          <Ionicons name="location" size={16} color={colors.primary} />
          <Text style={s.welcomeBrandText}>RideAlong</Text>
        </View>

        <View style={[s.welcomeBody, { paddingBottom: 12 }]}>
          <View style={s.welcomeEyebrow}>
            <Ionicons name="school-outline" size={13} color={colors.primary} />
            <Text style={s.welcomeEyebrowText}>.EDU STUDENTS ONLY</Text>
          </View>
          <Text style={s.welcomeTitle}>
            Your campus,{'\n'}
            <Text style={s.titleAccent}>one ride away.</Text>
          </Text>
          <Text style={s.welcomeSubtitle}>
            Share rides with verified students heading your way — to class, home, or the airport.
          </Text>

          <PrimaryButton label="Get started →" onPress={() => router.push('/(auth)/select-role')} />
          <TouchableOpacity style={s.textButton} onPress={() => router.push('/(auth)/sign-in')} accessibilityRole="button">
            <Text style={s.textButtonLabel}>I already have an account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

// ─── Complete profile ────────────────────────────────────────────────────────

type Stage = 'photo' | 'about' | 'prefs' | 'done';
const STAGE_NUMBER: Record<Exclude<Stage, 'done'>, number> = { photo: 1, about: 2, prefs: 3 };

const PRONOUNS = ['she/her', 'he/him', 'they/them', 'Prefer not to say'];

type PrefKey = 'musicPreference' | 'conversationLevel' | 'soundEnvironment' | 'smokingPreference' | 'driverGender';
type PrefOption = { value: string; icon: IconName; sub?: string };
type PrefQuestion = { key: PrefKey; title: string; multi: boolean; options: PrefOption[] };

// Values match the options in Settings → Ride preferences so both screens stay in sync.
const PREF_QUESTIONS: PrefQuestion[] = [
  {
    key: 'musicPreference',
    title: 'What do you like to listen to?',
    multi: true,
    options: [
      { value: 'Pop', icon: 'musical-notes-outline' },
      { value: 'Hip-Hop', icon: 'mic-outline' },
      { value: 'R&B', icon: 'heart-outline' },
      { value: 'Rock', icon: 'flash-outline' },
      { value: 'Alternative', icon: 'planet-outline' },
      { value: 'Country', icon: 'leaf-outline' },
      { value: 'Jazz', icon: 'cafe-outline' },
      { value: 'Classical', icon: 'musical-note-outline' },
      { value: 'Electronic', icon: 'pulse-outline' },
      { value: 'Reggae', icon: 'sunny-outline' },
      { value: 'Folk', icon: 'flower-outline' },
      { value: 'Blues', icon: 'rainy-outline' },
    ],
  },
  {
    key: 'conversationLevel',
    title: 'How chatty are you on a ride?',
    multi: false,
    options: [
      { value: 'Chatty', icon: 'chatbubbles-outline', sub: 'Love a good conversation' },
      { value: 'Moderate', icon: 'chatbubble-ellipses-outline', sub: 'Depends on the vibe' },
      { value: 'Quiet', icon: 'moon-outline', sub: 'Happy to keep to myself' },
    ],
  },
  {
    key: 'soundEnvironment',
    title: "What's the ideal ride soundtrack?",
    multi: false,
    options: [
      { value: 'Music', icon: 'musical-notes-outline', sub: 'Aux cord, please' },
      { value: 'Conversation', icon: 'people-outline', sub: 'Talking over the tunes' },
      { value: 'Silent', icon: 'volume-mute-outline', sub: 'Peace and quiet' },
    ],
  },
  {
    key: 'smokingPreference',
    title: 'Smoking in the car?',
    multi: false,
    options: [
      { value: 'No Smoking', icon: 'ban-outline', sub: 'Smoke-free rides only' },
      { value: 'Smoking OK', icon: 'flame-outline', sub: "Doesn't bother me" },
    ],
  },
  {
    key: 'driverGender',
    title: 'Any driver preference?',
    multi: false,
    options: [
      { value: 'Any', icon: 'people-outline', sub: 'No preference' },
      { value: 'Female', icon: 'woman-outline', sub: 'Prefer a female driver' },
      { value: 'Male', icon: 'man-outline', sub: 'Prefer a male driver' },
    ],
  },
];

type PrefAnswers = { musicPreference: string[] } & Record<Exclude<PrefKey, 'musicPreference'>, string>;
const EMPTY_ANSWERS: PrefAnswers = {
  musicPreference: [],
  conversationLevel: '',
  soundEnvironment: '',
  smokingPreference: '',
  driverGender: '',
};

function formatBirthday(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function yearsAgo(years: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split('T')[0];
}

export function CompleteProfileScreen() {
  const { colors } = useAppTheme();
  const s = useStyles(colors);
  const { isEmailVerified, finishOnboarding, refreshProfiles } = useAuthStore();
  const savePreferences = usePreferencesStore((st) => st.savePreferences);

  const [stage, setStage] = useState<Stage>('photo');
  const scrollRef = useRef<ScrollView>(null);

  // Photo
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // About
  const [major, setMajor] = useState('');
  const [majorFocused, setMajorFocused] = useState(false);
  const [classYear, setClassYear] = useState('');
  const [dob, setDob] = useState('');
  const [dobOpen, setDobOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [savingAbout, setSavingAbout] = useState(false);
  const [aboutSaved, setAboutSaved] = useState(false);

  // Preferences
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState<PrefAnswers>(EMPTY_ANSWERS);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  // Each step starts at the top, not wherever the previous one was scrolled to.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [stage, question]);

  const firstName = (firebaseAuth.currentUser?.displayName || '').split(' ')[0];
  const classYears = useMemo(() => {
    const y = new Date().getFullYear();
    return [String(y), String(y + 1), String(y + 2), String(y + 3), 'Grad'];
  }, []);

  const majorSuggestions = useMemo(() => {
    const q = major.trim().toLowerCase();
    if (!majorFocused || !q) return [];
    if (MAJORS.some((m) => m.toLowerCase() === q)) return [];
    return MAJORS.filter((m) => m.toLowerCase().includes(q)).slice(0, 4);
  }, [major, majorFocused]);

  // ── Actions ──

  const uploadPhoto = async (source: 'library' | 'camera') => {
    try {
      setUploading(true);
      const result = await pickAndUploadAvatar(source);
      if (!result.canceled) {
        setAvatarUrl(result.avatarUrl);
        refreshProfiles().catch(() => {});
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      Alert.alert(
        'Could not add photo',
        msg.includes('permission')
          ? `Allow ${source === 'camera' ? 'camera' : 'photo library'} access in Settings to add a profile photo.`
          : 'Something went wrong uploading your photo. Try again or skip for now.',
      );
    } finally {
      setUploading(false);
    }
  };

  const saveAbout = async () => {
    const uid = firebaseAuth.currentUser?.uid;
    const update: Record<string, unknown> = {};
    if (major.trim()) update.major = major.trim();
    if (classYear) update.classYear = classYear;
    if (dob) update.dateOfBirth = dob;
    if (phone.trim()) update.phone = phone.trim();
    if (pronouns) update.pronouns = pronouns;

    if (!uid || Object.keys(update).length === 0) {
      setStage('prefs');
      return;
    }
    try {
      setSavingAbout(true);
      await setDoc(doc(firestore, 'riders', uid), { ...update, updatedAt: serverTimestamp() }, { merge: true });
      setAboutSaved(true);
      refreshProfiles().catch(() => {});
      setStage('prefs');
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again, or skip for now.');
    } finally {
      setSavingAbout(false);
    }
  };

  const answeredCount = PREF_QUESTIONS.filter((q) =>
    q.multi ? answers.musicPreference.length > 0 : !!answers[q.key as Exclude<PrefKey, 'musicPreference'>],
  ).length;

  const savePrefs = async () => {
    if (answeredCount === 0) {
      setStage('done');
      return;
    }
    try {
      setSavingPrefs(true);
      await savePreferences({ ...answers, passengerType: '' });
      setPrefsSaved(true);
      setStage('done');
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again, or skip for now.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const toggleAnswer = (q: PrefQuestion, value: string) => {
    tapFeedback();
    setAnswers((prev) => {
      if (q.multi) {
        const list = prev.musicPreference;
        return {
          ...prev,
          musicPreference: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
        };
      }
      const key = q.key as Exclude<PrefKey, 'musicPreference'>;
      return { ...prev, [key]: prev[key] === value ? '' : value };
    });
  };

  const skip = () => {
    if (stage === 'photo') setStage('about');
    else if (stage === 'about') setStage('prefs');
    else if (stage === 'prefs') setStage('done');
  };

  const goBack = () => {
    if (stage === 'about') setStage('photo');
    else if (stage === 'prefs') {
      if (question > 0) setQuestion((q) => q - 1);
      else setStage('about');
    }
  };

  // ── Header ──

  const header = stage !== 'done' ? (
    <View style={s.header}>
      {stage !== 'photo' ? (
        <TouchableOpacity style={s.backBtn} onPress={goBack} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      ) : null}
      <View style={s.progressWrap}>
        <Text style={s.progressLabel}>PROFILE {STAGE_NUMBER[stage]} OF 3</Text>
        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${(STAGE_NUMBER[stage] / 3) * 100}%` }]} />
        </View>
      </View>
      <TouchableOpacity onPress={skip} hitSlop={hitSlop} accessibilityRole="button">
        <Text style={s.skipText}>Skip</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  // ── Stages ──

  let body: React.ReactNode = null;

  if (stage === 'photo') {
    body = (
      <>
        <Heading
          title="Put a face"
          accent="to the name."
          subtitle="Riders and drivers feel safer when they can see who they're sharing the ride with."
        />
        <View style={s.avatarWrap}>
          <View>
            <View style={[s.avatarCircle, avatarUrl ? s.avatarCircleFilled : null]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={s.avatarImage} contentFit="cover" transition={200} />
              ) : (
                <Ionicons name="person" size={64} color={colors.primary} />
              )}
              {uploading ? (
                <View style={s.avatarOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </View>
            {avatarUrl && !uploading ? (
              <View style={s.avatarBadge}>
                <Ionicons name="checkmark" size={20} color={colors.textInverse} />
              </View>
            ) : null}
          </View>
        </View>

        {avatarUrl ? (
          <>
            <PrimaryButton label="Looks good →" onPress={() => setStage('about')} disabled={uploading} />
            <SecondaryButton label="Choose a different photo" icon="images-outline" onPress={() => void uploadPhoto('library')} disabled={uploading} />
          </>
        ) : (
          <>
            <PrimaryButton label="Choose from library" icon="images-outline" onPress={() => void uploadPhoto('library')} loading={uploading} />
            <SecondaryButton label="Take a photo" icon="camera-outline" onPress={() => void uploadPhoto('camera')} disabled={uploading} />
          </>
        )}

        <View style={s.tipBox}>
          <Ionicons name="bulb-outline" size={18} color={colors.primary} />
          <Text style={s.tipText}>
            <Text style={s.tipStrong}>Tip: </Text>
            A clear, well-lit photo of just you works best — no sunglasses or group shots.
          </Text>
        </View>
      </>
    );
  } else if (stage === 'about') {
    body = (
      <>
        <Heading title="A little" accent="about you." subtitle="Helps you match with students who get it. Everything here is optional." />

        <View style={s.field}>
          <Text style={s.fieldLabel}>MAJOR</Text>
          <View style={[s.inputWrap, majorFocused && s.inputWrapFocused]}>
            <Ionicons name="school-outline" size={19} color={colors.textSecondary} />
            <TextInput
              style={s.input}
              value={major}
              onChangeText={setMajor}
              onFocus={() => setMajorFocused(true)}
              onBlur={() => setMajorFocused(false)}
              placeholder="e.g. Computer Science"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>
          {majorSuggestions.length ? (
            <View style={s.suggestions}>
              {majorSuggestions.map((m, i) => (
                <TouchableOpacity
                  key={m}
                  style={[s.suggestionRow, i === majorSuggestions.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => { setMajor(m); setMajorFocused(false); }}
                >
                  <Text style={s.suggestionText}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        <View style={s.field}>
          <Text style={s.fieldLabel}>CLASS YEAR</Text>
          <View style={s.chipRow}>
            {classYears.map((y) => (
              <TouchableOpacity
                key={y}
                style={[s.chip, classYear === y && s.chipActive]}
                onPress={() => { tapFeedback(); setClassYear(classYear === y ? '' : y); }}
                accessibilityRole="button"
                accessibilityState={{ selected: classYear === y }}
              >
                <Text style={[s.chipText, classYear === y && s.chipTextActive]}>{y}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.fieldLabel}>BIRTHDAY</Text>
          <TouchableOpacity style={s.inputWrap} onPress={() => setDobOpen(true)} accessibilityRole="button">
            <Ionicons name="calendar-outline" size={19} color={colors.textSecondary} />
            <Text style={dob ? s.inputValue : s.inputPlaceholder}>{dob ? formatBirthday(dob) : 'Select your birthday'}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={s.field}>
          <Text style={s.fieldLabel}>PHONE</Text>
          <View style={s.inputWrap}>
            <Ionicons name="call-outline" size={19} color={colors.textSecondary} />
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="(512) 555-0123"
              placeholderTextColor={colors.textSecondary}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
            />
          </View>
        </View>

        <View style={s.field}>
          <Text style={s.fieldLabel}>PRONOUNS</Text>
          <View style={s.chipRow}>
            {PRONOUNS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[s.chip, pronouns === p && s.chipActive]}
                onPress={() => { tapFeedback(); setPronouns(pronouns === p ? '' : p); }}
                accessibilityRole="button"
                accessibilityState={{ selected: pronouns === p }}
              >
                <Text style={[s.chipText, pronouns === p && s.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <PrimaryButton label="Continue →" onPress={() => void saveAbout()} loading={savingAbout} />

        <DatePickerModal
          visible={dobOpen}
          selectedDate={dob}
          maxDate={yearsAgo(16)}
          initialDisplayDate={dob || yearsAgo(20)}
          title="Your birthday"
          onClose={() => setDobOpen(false)}
          onSelect={(v) => { setDob(v); setDobOpen(false); }}
        />
      </>
    );
  } else if (stage === 'prefs') {
    const q = PREF_QUESTIONS[question];
    const isLast = question === PREF_QUESTIONS.length - 1;
    const isSelected = (value: string) =>
      q.multi ? answers.musicPreference.includes(value) : answers[q.key as Exclude<PrefKey, 'musicPreference'>] === value;

    body = (
      <>
        {question === 0 ? <Heading title="Ride" accent="your way." /> : null}
        <Text style={s.questionMeta}>
          QUESTION {question + 1} OF {PREF_QUESTIONS.length} · {q.multi ? 'PICK ANY' : 'PICK ONE'}
        </Text>
        <View style={s.segments}>
          {PREF_QUESTIONS.map((_, i) => (
            <View key={i} style={[s.segment, i <= question && s.segmentActive]} />
          ))}
        </View>
        <Text style={s.questionTitle}>{q.title}</Text>

        {q.multi ? (
          <View style={s.grid}>
            {q.options.map((o) => {
              const active = isSelected(o.value);
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[s.gridTile, active && s.tileActive]}
                  onPress={() => toggleAnswer(q, o.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons name={o.icon} size={22} color={active ? colors.primary : colors.textSecondary} />
                  <Text style={[s.tileText, active && s.tileTextActive]}>{o.value}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={s.optionList}>
            {q.options.map((o) => {
              const active = isSelected(o.value);
              return (
                <TouchableOpacity
                  key={o.value}
                  style={[s.optionRow, active && s.tileActive]}
                  onPress={() => toggleAnswer(q, o.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <View style={[s.optionIcon, active && s.optionIconActive]}>
                    <Ionicons name={o.icon} size={20} color={active ? colors.textInverse : colors.textSecondary} />
                  </View>
                  <View style={s.optionCopy}>
                    <Text style={s.optionTitle}>{o.value}</Text>
                    {o.sub ? <Text style={s.optionSub}>{o.sub}</Text> : null}
                  </View>
                  <View style={[s.radio, active && s.radioActive]}>
                    {active ? <Ionicons name="checkmark" size={14} color={colors.textInverse} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <PrimaryButton
          label={isLast ? 'Finish →' : 'Next →'}
          onPress={() => (isLast ? void savePrefs() : setQuestion((n) => n + 1))}
          loading={savingPrefs}
        />
        <Text style={s.footerNote}>You can change these anytime in Settings.</Text>
      </>
    );
  } else {
    const aboutBits = [major.trim(), classYear ? (classYear === 'Grad' ? 'Grad student' : `Class of ${classYear}`) : '']
      .filter(Boolean)
      .join(' · ');
    const rows: { title: string; detail: string; done: boolean; thumb: React.ReactNode; onEdit: () => void }[] = [
      {
        title: 'Profile photo',
        detail: avatarUrl ? 'Looking good' : 'Not added yet',
        done: !!avatarUrl,
        thumb: avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={s.avatarImage} contentFit="cover" />
        ) : (
          <Ionicons name="camera-outline" size={20} color={colors.textSecondary} />
        ),
        onEdit: () => setStage('photo'),
      },
      {
        title: 'About you',
        detail: aboutSaved ? aboutBits || 'Saved' : 'Not added yet',
        done: aboutSaved,
        thumb: <Ionicons name="person-outline" size={20} color={aboutSaved ? colors.primary : colors.textSecondary} />,
        onEdit: () => setStage('about'),
      },
      {
        title: 'Ride preferences',
        detail: prefsSaved ? `${answeredCount} of ${PREF_QUESTIONS.length} answered` : 'Not set yet',
        done: prefsSaved,
        thumb: <Ionicons name="options-outline" size={20} color={prefsSaved ? colors.primary : colors.textSecondary} />,
        onEdit: () => { setQuestion(0); setStage('prefs'); },
      },
    ];

    body = (
      <>
        <View style={s.doneIcon}>
          <Ionicons name="checkmark" size={44} color={colors.green} />
        </View>
        <Heading
          title="You're"
          accent="all set."
          subtitle={`Welcome to RideAlong${firstName ? `, ${firstName}` : ''}. Here's how your profile looks.`}
        />

        <View style={s.summaryCard}>
          {rows.map((r, i) => (
            <React.Fragment key={r.title}>
              {i > 0 ? <View style={s.summaryDivider} /> : null}
              <View style={s.summaryRow}>
                <View style={s.summaryThumb}>{r.thumb}</View>
                <View style={s.flex}>
                  <Text style={s.summaryTitle}>{r.title}</Text>
                  <Text style={s.summaryDetail} numberOfLines={1}>{r.detail}</Text>
                </View>
                {r.done ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.green} />
                ) : (
                  <TouchableOpacity onPress={r.onEdit} hitSlop={hitSlop}>
                    <Text style={s.summaryEdit}>Add</Text>
                  </TouchableOpacity>
                )}
              </View>
            </React.Fragment>
          ))}
        </View>

        {!isEmailVerified ? (
          <View style={s.infoNote}>
            <Ionicons name="mail-unread-outline" size={17} color={colors.primary} />
            <Text style={s.infoNoteText}>One last thing — confirm your .edu email so you can start booking rides.</Text>
          </View>
        ) : null}

        <PrimaryButton label="Find a ride →" onPress={finishOnboarding} />
      </>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {header}
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
