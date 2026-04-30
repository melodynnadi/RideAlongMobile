
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Music, Volume2, MessageCircle, Cigarette, User, Users } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { UserPreferences } from '@/types';
import PreferredRoutesManager from '@/components/PreferredRoutesManager';

export default function RidePreferencesScreen() {
  const theme = useTheme();
  const { 
    preferences, 
    isLoading, 
    isDirty, 
    loadPreferences, 
    savePreferences,
    setDirty 
  } = usePreferencesStore();
  
  const [localPreferences, setLocalPreferences] = useState<UserPreferences>({
    musicPreference: [],
    soundEnvironment: '',
    conversationLevel: '',
    smokingPreference: '',
    driverGender: '',
    passengerType: '',
  });

  const musicGenres = [
    'Pop', 'Hip-Hop', 'R&B', 'Rock', 'Alternative', 'Country',
    'Jazz', 'Classical', 'Electronic', 'Reggae', 'Folk', 'Blues'
  ];

  // Updated options to match the images
  const soundEnvironmentOptions = [
    'Music Preferred',
    'Silent/Quiet',
    'Conversation'
  ];

  const conversationLevelOptions = [
    'Chatty',
    'Moderate',
    'Quiet'
  ];

  const smokingPreferenceOptions = [
    'No Smoking',
    'Smoking OK'
  ];

  const driverGenderOptions = [
    'Any',
    'Female Only',
    'Male Only'
  ];

  const passengerTypeOptions = [
    'Single Passenger',
    'Multiple Passengers OK'
  ];

  const toggleMusicGenre = (genre: string) => {
    const currentMusic = localPreferences.musicPreference;
    const updatedMusic = currentMusic.includes(genre)
      ? currentMusic.filter(g => g !== genre)
      : [...currentMusic, genre];
    
    setLocalPreferences(prev => ({
      ...prev,
      musicPreference: updatedMusic
    }));
    setDirty(true);
  };

  const updateLocalPreference = (key: keyof UserPreferences, value: string) => {
    setLocalPreferences(prev => ({
      ...prev,
      [key]: value
    }));
    setDirty(true);
  };

  useEffect(() => {
    loadPreferences().catch(error => {
      console.error('Failed to load preferences:', error);
      Alert.alert('Error', 'Failed to load your preferences. Please try again.');
    });
  }, [loadPreferences]);

  useEffect(() => {
    if (preferences) {
      setLocalPreferences(preferences);
    }
  }, [preferences]);

  const handleSave = async () => {
    try {
      await savePreferences(localPreferences);
      Alert.alert('Success', 'Your ride preferences have been saved!');
      router.canGoBack() ? router.back() : router.push('/settings');
    } catch (error) {
      console.error('Failed to save preferences:', error);
      Alert.alert('Error', 'Failed to save your preferences. Please try again.');
    }
  };

  const handleCancel = () => {
    router.canGoBack() ? router.back() : router.push('/settings');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.canGoBack() ? router.back() : router.push('/settings')}
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

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom: 24 }}>
          <PreferredRoutesManager />
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
                  localPreferences.musicPreference.includes(genre) && {
                    backgroundColor: theme.colors.primary + '20',
                    borderColor: theme.colors.primary
                  }
                ]}
                onPress={() => toggleMusicGenre(genre)}
              >
                <View style={[
                  styles.checkbox,
                  localPreferences.musicPreference.includes(genre) && {
                    backgroundColor: theme.colors.primary
                  }
                ]}>
                  {localPreferences.musicPreference.includes(genre) && (
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
              const active = localPreferences.soundEnvironment === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updateLocalPreference('soundEnvironment', option)}
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
              const active = localPreferences.conversationLevel === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updateLocalPreference('conversationLevel', option)}
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
              const active = localPreferences.smokingPreference === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updateLocalPreference('smokingPreference', option)}
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
              const active = localPreferences.driverGender === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updateLocalPreference('driverGender', option)}
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
              const active = localPreferences.passengerType === option;
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.chip, active && { backgroundColor: theme.colors.primary + '20', borderColor: theme.colors.primary }]}
                  onPress={() => updateLocalPreference('passengerType', option)}
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
          style={[styles.saveButton, { backgroundColor: isLoading || !isDirty ? '#F5B392' : '#E97539', opacity: isLoading || !isDirty ? 0.8 : 1 }]}
          onPress={() => { if (!isLoading && isDirty) handleSave(); }}
        >
          <Text style={styles.saveButtonText}>
            {isLoading ? 'Saving...' : 'Save Preferences'}
          </Text>
        </Button>
      </View>
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
