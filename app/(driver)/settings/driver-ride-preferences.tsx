import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

import {
  getDriverPreferences,
  updateDriverPreferences,
  mapFormToDriverPreferences,
  mapDriverPreferencesToForm,
} from '@/src/services/driverService';
import DriverPreferredRoutesManager from '@/components/DriverPreferredRoutesManager';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';
import { layout } from '@/theme/designSystem';

interface RidePreferences {
  musicTaste: string[];
  soundEnvironment: string;
  conversationLevel: string;
  smokingPreference: string;
  driverGenderPreference: string;
  passengerTypePreference: string;
}

const MUSIC_GENRES = ['Pop', 'Hip-Hop', 'R&B', 'Rock', 'Alternative', 'Country', 'Jazz', 'Classical', 'Electronic', 'Reggae', 'Folk', 'Blues'];
const SOUND_OPTIONS = ['Quiet environment', 'Background music', 'Moderate volume', 'Lively atmosphere'];
const CONVO_OPTIONS = ['Quiet/No conversation', 'Light conversation', 'Moderate conversation', 'Chatty/Social'];
const SMOKING_OPTIONS = ['Non-smoking only', 'Smoking allowed', 'No preference'];
const GENDER_OPTIONS = ['No preference', 'Male driver', 'Female driver'];
const PASSENGER_OPTIONS = ['Students only', 'Professionals only', 'Mixed groups', 'No preference'];

export default function RidePreferencesScreen() {
  const { goBack } = useReturnNavigation('/(driver)/settings');
  const { colors } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const [preferences, setPreferences] = useState<RidePreferences>({
    musicTaste: [], soundEnvironment: '', conversationLevel: '',
    smokingPreference: '', driverGenderPreference: 'No preference', passengerTypePreference: '',
  });
  const [original, setOriginal] = useState<RidePreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isDirty = useMemo(() => {
    if (!original) return true;
    const a = preferences;
    const b = original;
    const arrEq = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
    return !(arrEq([...a.musicTaste].sort(), [...b.musicTaste].sort()) && a.soundEnvironment === b.soundEnvironment && a.conversationLevel === b.conversationLevel && a.smokingPreference === b.smokingPreference && a.driverGenderPreference === b.driverGenderPreference && a.passengerTypePreference === b.passengerTypePreference);
  }, [preferences, original]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const driverPrefs = await getDriverPreferences();
        if (driverPrefs) { const form = mapDriverPreferencesToForm(driverPrefs); setPreferences(form); setOriginal(form); }
      } catch { Alert.alert('Error Loading Preferences', 'Could not load your preferences. Please try again.'); }
      finally { setLoading(false); }
    })();
  }, []);

  const toggleMusic = (g: string) =>
    setPreferences((prev) => ({ ...prev, musicTaste: prev.musicTaste.includes(g) ? prev.musicTaste.filter((x) => x !== g) : [...prev.musicTaste, g] }));

  const updatePref = (key: keyof RidePreferences, value: string) =>
    setPreferences((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateDriverPreferences(mapFormToDriverPreferences(preferences));
      setOriginal(preferences);
      Alert.alert('Saved', 'Your ride preferences have been saved!');
      goBack();
    } catch (e) {
      Alert.alert('Save Failed', e instanceof Error ? e.message : 'Could not save your preferences.');
    } finally { setSaving(false); }
  };

  return (
    <View style={s.root}>
      <StatusBar style={colors.statusBar === 'light-content' ? 'light' : 'dark'} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
              <View style={s.hdr}>
                <TouchableOpacity style={s.backBtn} onPress={goBack}>
                  <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={s.hdrTitle}>Ride Preferences</Text>
                <View style={{ width: 40 }} />
              </View>

              <View style={{ marginBottom: 24 }}>
                <DriverPreferredRoutesManager />
              </View>

              <Section title="Music Taste" icon="musical-notes-outline" colors={colors} s={s}>
                <View style={s.musicGrid}>
                  {MUSIC_GENRES.map((genre) => {
                    const active = preferences.musicTaste.includes(genre);
                    return (
                      <TouchableOpacity key={genre} style={[s.musicItem, active && s.musicItemActive]} onPress={() => toggleMusic(genre)}>
                        <View style={[s.checkbox, active && s.checkboxActive]}>
                          {active && <Text style={s.checkmark}>✓</Text>}
                        </View>
                        <Text style={[s.genreText, active && s.genreTextActive]}>{genre}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>

              <Section title="Sound Environment" icon="volume-medium-outline" colors={colors} s={s}>
                <View style={s.chipsRow}>
                  {SOUND_OPTIONS.map((opt) => {
                    const active = preferences.soundEnvironment === opt;
                    return <TouchableOpacity key={opt} style={[s.chip, active && s.chipActive]} onPress={() => updatePref('soundEnvironment', opt)}><Text style={[s.chipText, active && s.chipTextActive]}>{opt}</Text></TouchableOpacity>;
                  })}
                </View>
              </Section>

              <Section title="Conversation Level" icon="chatbubble-outline" colors={colors} s={s}>
                <View style={s.chipsRow}>
                  {CONVO_OPTIONS.map((opt) => {
                    const active = preferences.conversationLevel === opt;
                    return <TouchableOpacity key={opt} style={[s.chip, active && s.chipActive]} onPress={() => updatePref('conversationLevel', opt)}><Text style={[s.chipText, active && s.chipTextActive]}>{opt}</Text></TouchableOpacity>;
                  })}
                </View>
              </Section>

              <Section title="Smoking Preference" icon="ban-outline" colors={colors} s={s}>
                <View style={s.chipsRow}>
                  {SMOKING_OPTIONS.map((opt) => {
                    const active = preferences.smokingPreference === opt;
                    return <TouchableOpacity key={opt} style={[s.chip, active && s.chipActive]} onPress={() => updatePref('smokingPreference', opt)}><Text style={[s.chipText, active && s.chipTextActive]}>{opt}</Text></TouchableOpacity>;
                  })}
                </View>
              </Section>

              <Section title="Driver Gender Preference" icon="person-outline" colors={colors} s={s}>
                <View style={s.chipsRow}>
                  {GENDER_OPTIONS.map((opt) => {
                    const active = preferences.driverGenderPreference === opt;
                    return <TouchableOpacity key={opt} style={[s.chip, active && s.chipActive]} onPress={() => updatePref('driverGenderPreference', opt)}><Text style={[s.chipText, active && s.chipTextActive]}>{opt}</Text></TouchableOpacity>;
                  })}
                </View>
              </Section>

              <Section title="Passenger Type" icon="people-outline" colors={colors} s={s}>
                <View style={s.chipsRow}>
                  {PASSENGER_OPTIONS.map((opt) => {
                    const active = preferences.passengerTypePreference === opt;
                    return <TouchableOpacity key={opt} style={[s.chip, active && s.chipActive]} onPress={() => updatePref('passengerTypePreference', opt)}><Text style={[s.chipText, active && s.chipTextActive]}>{opt}</Text></TouchableOpacity>;
                  })}
                </View>
              </Section>

              <View style={{ height: 100 }} />
            </ScrollView>

            <View style={s.actionBar}>
              <TouchableOpacity style={s.cancelBtn} onPress={goBack}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, (!isDirty || saving) && { opacity: 0.55 }]}
                onPress={() => { if (!saving && isDirty) handleSave(); }}
                disabled={saving || !isDirty}
              >
                {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={s.saveBtnText}>Save Preferences</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

function Section({ title, icon, children, colors, s }: { title: string; icon: string; children: React.ReactNode; colors: AppColors; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.sectionCard}>
      <View style={s.sectionHdr}>
        <View style={s.sectionIconWrap}><Ionicons name={icon as any} size={16} color={colors.primary} /></View>
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
    root:        { flex: 1, backgroundColor: colors.bg },
    safe:        { flex: 1 },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    hdr:      { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 10 },
    backBtn:  { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    hdrTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },

    content: { paddingHorizontal: layout.screenPadding, paddingTop: 4 },

    sectionCard: {
      borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
      marginBottom: 16, padding: 16,
    },
    sectionHdr:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
    sectionIconWrap: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
    sectionTitle:    { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },

    musicGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    musicItem:       { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bgSecondary, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
    musicItemActive: { backgroundColor: colors.primaryDim, borderColor: colors.primary },
    checkbox:        { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.border, marginRight: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard },
    checkboxActive:  { backgroundColor: colors.primary, borderColor: colors.primary },
    checkmark:       { color: colors.textInverse, fontSize: 10, fontWeight: '800' },
    genreText:       { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    genreTextActive: { color: colors.textPrimary, fontWeight: '700' },

    chipsRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:           { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.bgSecondary, borderWidth: 1, borderColor: colors.border },
    chipActive:     { backgroundColor: colors.primaryDim, borderColor: colors.primary },
    chipText:       { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    chipTextActive: { color: colors.textPrimary, fontWeight: '700' },

    actionBar:     { flexDirection: 'row', gap: 12, paddingHorizontal: layout.screenPadding, paddingBottom: 30, paddingTop: 14, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
    cancelBtn:     { flex: 1, height: 50, borderRadius: 25, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgCard },
    cancelBtnText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    saveBtn:       { flex: 2, height: 50, borderRadius: 25, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    saveBtnText:   { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  });
}
