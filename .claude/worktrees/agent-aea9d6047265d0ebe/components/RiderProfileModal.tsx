import React from 'react';
import { View, Text, Image, Modal, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { X, Star, User, Phone, Music, Thermometer, MessageCircle, Cigarette, Heart } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { RidePreferences } from '@/types';

interface RiderProfileModalProps {
  visible: boolean;
  onClose: () => void;
  rider: {
    name?: string;
    rating?: number | null;
    phone?: string | null;
    avatarUrl?: string | null;
    preferences?: RidePreferences;
  } | null;
}

export default function RiderProfileModal({ visible, onClose, rider }: RiderProfileModalProps) {
  const theme = useTheme();

  if (!rider) return null;

  const renderPreferenceIcon = (preference: string, value: any) => {
    switch (preference) {
      case 'musicPreference':
        return <Music size={16} color={theme.colors.muted} />;
      case 'temperaturePreference':
        return <Thermometer size={16} color={theme.colors.muted} />;
      case 'conversationLevel':
        return <MessageCircle size={16} color={theme.colors.muted} />;
      case 'allowSmoking':
        return <Cigarette size={16} color={theme.colors.muted} />;
      case 'allowPets':
        return <Heart size={16} color={theme.colors.muted} />;
      default:
        return <User size={16} color={theme.colors.muted} />;
    }
  };

  const formatPreferenceValue = (preference: string, value: any) => {
    switch (preference) {
      case 'musicPreference':
        return value === 'none' ? 'No music' : 
               value === 'quiet' ? 'Quiet music' :
               value === 'normal' ? 'Normal volume' : 'Loud music';
      case 'temperaturePreference':
        return value === 'cold' ? 'Cool' : 
               value === 'normal' ? 'Normal' : 'Warm';
      case 'conversationLevel':
        return value === 'quiet' ? 'Quiet ride' : 
               value === 'normal' ? 'Normal conversation' : 'Chatty';
      case 'allowSmoking':
        return value ? 'Smoking allowed' : 'No smoking';
      case 'allowPets':
        return value ? 'Pets welcome' : 'No pets';
      default:
        return String(value);
    }
  };

  const getPreferenceLabel = (preference: string) => {
    switch (preference) {
      case 'musicPreference':
        return 'Music';
      case 'temperaturePreference':
        return 'Temperature';
      case 'conversationLevel':
        return 'Conversation';
      case 'allowSmoking':
        return 'Smoking';
      case 'allowPets':
        return 'Pets';
      default:
        return preference;
    }
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.lg,
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    modal: {
      backgroundColor: theme.colors.card,
      borderRadius: theme.borderRadius['2xl'],
      width: '100%',
      maxWidth: 400,
      maxHeight: '80%',
      ...theme.shadows.lg,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: theme.spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.muted + '20',
    },
    title: {
      fontSize: 20,
      fontWeight: '600',
      color: theme.colors.text,
    },
    closeButton: {
      padding: theme.spacing.sm,
    },
    content: {
      padding: theme.spacing.lg,
    },
    profileSection: {
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    avatarContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.colors.muted + '20',
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
    },
    name: {
      fontSize: 24,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: theme.spacing.sm,
    },
    ratingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.sm,
    },
    rating: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text,
      marginLeft: theme.spacing.xs,
    },
    phoneContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.muted + '10',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.borderRadius.lg,
    },
    phone: {
      fontSize: 14,
      color: theme.colors.muted,
      marginLeft: theme.spacing.sm,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
    },
    preferencesContainer: {
      gap: theme.spacing.md,
    },
    preferenceItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.muted + '10',
      padding: theme.spacing.md,
      borderRadius: theme.borderRadius.lg,
    },
    preferenceIcon: {
      marginRight: theme.spacing.md,
    },
    preferenceContent: {
      flex: 1,
    },
    preferenceLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.text,
      marginBottom: 2,
    },
    preferenceValue: {
      fontSize: 14,
      color: theme.colors.muted,
    },
    noPreferences: {
      textAlign: 'center',
      color: theme.colors.muted,
      fontSize: 14,
      fontStyle: 'italic',
    },
  });

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>Rider Profile</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={24} color={theme.colors.muted} />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {/* Profile Section */}
            <View style={styles.profileSection}>
              {rider.avatarUrl ? (
                <Image source={{ uri: rider.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarContainer}>
                  <User size={32} color={theme.colors.muted} />
                </View>
              )}
              
              <Text style={styles.name}>{rider.name || 'Unknown Rider'}</Text>
              
              <View style={styles.ratingContainer}>
                <Star size={20} color="#F59E0B" fill="#F59E0B" />
                <Text style={styles.rating}>
                  {typeof rider.rating === 'number' ? rider.rating.toFixed(1) : '4.9'}
                </Text>
              </View>
              
              {((rider as any).phone || (rider as any).phoneNumber) && (
                <View style={styles.phoneContainer}>
                  <Phone size={16} color={theme.colors.secondary} />
                  <Text style={styles.phone}>{(rider as any).phone || (rider as any).phoneNumber}</Text>
                </View>
              )}
            </View>

            {/* Preferences Section */}
            <View>
              <Text style={styles.sectionTitle}>Ride Preferences</Text>
              {rider.preferences ? (
                <View style={styles.preferencesContainer}>
                  {Object.entries(rider.preferences).map(([key, value]) => (
                    <View key={key} style={styles.preferenceItem}>
                      <View style={styles.preferenceIcon}>
                        {renderPreferenceIcon(key, value)}
                      </View>
                      <View style={styles.preferenceContent}>
                        <Text style={styles.preferenceLabel}>
                          {getPreferenceLabel(key)}
                        </Text>
                        <Text style={styles.preferenceValue}>
                          {formatPreferenceValue(key, value)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.noPreferences}>
                  No preferences specified
                </Text>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
