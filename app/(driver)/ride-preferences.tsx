
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Music, Volume2, MessageCircle, Cigarette, User, Users } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { 
  getDriverPreferences, 
  updateDriverPreferences, 
  mapFormToDriverPreferences, 
  mapDriverPreferencesToForm,
  DriverPreferences 
} from '@/src/services/driverService';
import DriverPreferredRoutesManager from '@/components/DriverPreferredRoutesManager';

interface RidePreferences {
  musicTaste: string[];
  soundEnvironment: string;
  conversationLevel: string;
  smokingPreference: string;
  driverGenderPreference: string;
  passengerTypePreference: string;
}

export default function RidePreferencesScreen() {
  const theme = useTheme();
  
  const [preferences, setPreferences] = useState<RidePreferences>({
    musicTaste: [],
    soundEnvironment: '',
    conversationLevel: '',
    smokingPreference: '',
    driverGenderPreference: 'No preference',
    passengerTypePreference: '',
  });
  const [original, setOriginal] = useState<RidePreferences | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const musicGenres = [
    'Pop', 'Hip-Hop', 'R&B', 'Rock', 'Alternative', 'Country',
    'Jazz', 'Classical', 'Electronic', 'Reggae', 'Folk', 'Blues'
  ];

  const soundEnvironmentOptions = [
    'Quiet environment',
    'Background music',
    'Moderate volume',
    'Lively atmosphere'
  ];

  const conversationLevelOptions = [
    'Quiet/No conversation',
    'Light conversation',
    'Moderate conversation',
    'Chatty/Social'
  ];

  const smokingPreferenceOptions = [
    'Non-smoking only',
    'Smoking allowed',
    'No preference'
  ];

  const driverGenderOptions = [
    'No preference',
    'Male driver',
    'Female driver'
  ];

  const passengerTypeOptions = [
    'Students only',
    'Professionals only',
    'Mixed groups',
    'No preference'
  ];

  const toggleMusicGenre = (genre: string) => {
    setPreferences(prev => ({
      ...prev,
      musicTaste: prev.musicTaste.includes(genre)
        ? prev.musicTaste.filter(g => g !== genre)
        : [...prev.musicTaste, genre]
    }));
  };

  const updatePreference = (key: keyof RidePreferences, value: string) => {
    setPreferences(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const isDirty = useMemo(() => {
    if (!original) return true;
    const a = preferences;
    const b = original;
    const arrEq = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
    return !(
      arrEq([...a.musicTaste].sort(), [...b.musicTaste].sort()) &&
      a.soundEnvironment === b.soundEnvironment &&
      a.conversationLevel === b.conversationLevel &&
      a.smokingPreference === b.smokingPreference &&
      a.driverGenderPreference === b.driverGenderPreference &&
      a.passengerTypePreference === b.passengerTypePreference
    );
  }, [preferences, original]);

  useEffect(() => {
    const loadDriverPreferences = async () => {
      try {
        setLoading(true);
        const driverPrefs = await getDriverPreferences();
        
        if (driverPrefs) {
          // Map driver preferences to form format
          const formData = mapDriverPreferencesToForm(driverPrefs);
          setPreferences(formData);
          setOriginal(formData);
        } else {
          // No driver data found, use defaults
          console.warn('No driver preferences found, using defaults');
        }
      } catch (error) {
        console.error('Error loading driver preferences:', error);
        Alert.alert(
          'Error Loading Preferences', 
          'Could not load your preferences. Please try again.'
        );
      } finally {
        setLoading(false);
      }
    };

    loadDriverPreferences();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      
      // Map form data to driver preferences format
      const driverPrefsUpdate = mapFormToDriverPreferences(preferences);
      
      // Update driver preferences in the drivers collection
      await updateDriverPreferences(driverPrefsUpdate);
      
      setOriginal(preferences);
      Alert.alert('Success', 'Your ride preferences have been saved!');
      router.back();
    } catch (error) {
      console.error('Error saving preferences:', error);
      Alert.alert(
        'Save Failed', 
        error instanceof Error ? error.message : 'Could not save your preferences. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
            Ride Preferences
          </Text>
          <Text style={styles.headerSubtitle}>
            Customize your ride experience
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.secondary }]}>
            Loading your preferences...
          </Text>
        </View>
      ) : (
        <>
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom: 24 }}>
          <DriverPreferredRoutesManager />
        </View>
        {/* Music Taste */}
  <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Music size={20} color={theme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              Music Taste
            </Text>
          </View>
          
          <View style={styles.musicGrid}>
            {musicGenres.map((genre) => (
              <TouchableOpacity
                key={genre}
                style={[
                  styles.musicGenreItem,
                  preferences.musicTaste.includes(genre) && {
                    backgroundColor: theme.colors.primary + '20',
                    borderColor: theme.colors.primary
                  }
                ]}
                onPress={() => toggleMusicGenre(genre)}
              >
                <View style={[
                  styles.checkbox,
                  preferences.musicTaste.includes(genre) && {
                    backgroundColor: theme.colors.primary
                  }
                ]}>
                  {preferences.musicTaste.includes(genre) && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={[
                  styles.genreText,
                  { color: theme.colors.secondary }
                ]}>
                  {genre}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {/* Sound Environment */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Volume2 size={20} color={theme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              Sound Environment
            </Text>
          </View>
          <View style={styles.chipsRow}>
            {soundEnvironmentOptions.map((option) => {
              const active = preferences.soundEnvironment === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updatePreference('soundEnvironment', option)}
                >
                  <Text style={[styles.chipText, { color: active ? theme.colors.secondary : '#64748B' }]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Conversation Level */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <MessageCircle size={20} color={theme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              Conversation Level
            </Text>
          </View>
          <View style={styles.chipsRow}>
            {conversationLevelOptions.map((option) => {
              const active = preferences.conversationLevel === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updatePreference('conversationLevel', option)}
                >
                  <Text style={[styles.chipText, { color: active ? theme.colors.secondary : '#64748B' }]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Smoking Preference */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Cigarette size={20} color={theme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              Smoking Preference
            </Text>
          </View>
          <View style={styles.chipsRow}>
            {smokingPreferenceOptions.map((option) => {
              const active = preferences.smokingPreference === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updatePreference('smokingPreference', option)}
                >
                  <Text style={[styles.chipText, { color: active ? theme.colors.secondary : '#64748B' }]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Driver Gender Preference */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <User size={20} color={theme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              Driver Gender Preference
            </Text>
          </View>
          <View style={styles.chipsRow}>
            {driverGenderOptions.map((option) => {
              const active = preferences.driverGenderPreference === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updatePreference('driverGenderPreference', option)}
                >
                  <Text style={[styles.chipText, { color: active ? theme.colors.secondary : '#64748B' }]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Passenger Type Preference */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Users size={20} color={theme.colors.primary} />
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              Passenger Type Preference
            </Text>
          </View>
          <View style={styles.chipsRow}>
            {passengerTypeOptions.map((option) => {
              const active = preferences.passengerTypePreference === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updatePreference('passengerTypePreference', option)}
                >
                  <Text style={[styles.chipText, { color: active ? theme.colors.secondary : '#64748B' }]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity 
          style={styles.cancelButton}
          onPress={handleCancel}
        >
          <Text style={[styles.cancelButtonText, { color: theme.colors.secondary }]}>
            Cancel
          </Text>
        </TouchableOpacity>
        
        <Button
          variant="primary"
          style={[styles.saveButton, { backgroundColor: saving || !isDirty ? '#F5B392' : '#E97539', opacity: saving || !isDirty ? 0.8 : 1 }]}
          onPress={() => { if (!saving && isDirty) handleSave(); }}
        >
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving...' : 'Save Preferences'}
          </Text>
        </Button>
      </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  // Preferred routes manager styles are encapsulated separately
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
  sectionCard: {
  backgroundColor: 'white',
  padding: 16,
  marginBottom: 16,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E2E8F0',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  musicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  musicGenreItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  genreText: {
    fontSize: 14,
    fontWeight: '500',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
