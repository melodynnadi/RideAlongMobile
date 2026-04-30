
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, Bell, Shield, CreditCard, Users, HelpCircle, LogOut, Moon, Volume2, History, Car, LucideIcon } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { signOut, deleteUser } from 'firebase/auth';
import { firebaseAuth, firestore } from '@/constants/services';
import { doc, deleteDoc } from 'firebase/firestore';
import { removeProfilePhoto } from '@/src/services/profilePhoto';
import { settingsService } from '@/src/services/settingsService';
import { notificationService } from '@/src/services/notificationService';

interface SettingItemBase {
  label: string;
  icon: LucideIcon;
}

interface NavigationSettingItem extends SettingItemBase {
  route: string;
  toggle?: false;
}

interface ToggleSettingItem extends SettingItemBase {
  toggle: true;
  value: boolean;
  onToggle: (value: boolean) => void;
}

type SettingItem = NavigationSettingItem | ToggleSettingItem;

interface SettingSection {
  title: string;
  items: SettingItem[];
}

export default function SettingsScreen() {
  const theme = useTheme();
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingsService.getSettings();
        setNotifications(settings.pushNotificationsEnabled);
        setSoundEnabled(settings.soundEffectsEnabled);
        setDarkMode(settings.darkModeEnabled);
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    };
    loadSettings();
  }, []);

  // Handle push notifications toggle
  const handleNotificationsToggle = async (value: boolean) => {
    setNotifications(value);
    try {
      await settingsService.updateSettings({ pushNotificationsEnabled: value });
      await notificationService.updateNotificationHandler();
      console.log('Push notifications', value ? 'enabled' : 'disabled');
    } catch (error) {
      console.error('Error updating push notifications setting:', error);
    }
  };

  // Handle sound effects toggle
  const handleSoundToggle = async (value: boolean) => {
    setSoundEnabled(value);
    try {
      await settingsService.updateSettings({ soundEffectsEnabled: value });
      console.log('Sound effects', value ? 'enabled' : 'disabled');
    } catch (error) {
      console.error('Error updating sound effects setting:', error);
    }
  };

  // Handle dark mode toggle
  const handleDarkModeToggle = async (value: boolean) => {
    // Temporarily disabled - coming soon
    Alert.alert(
      'Coming Soon',
      'Dark mode is currently under development and will be available in a future update.',
      [{ text: 'OK' }]
    );
    // setDarkMode(value);
    // try {
    //   await settingsService.updateSettings({ darkModeEnabled: value });
    //   console.log('Dark mode', value ? 'enabled' : 'disabled');
    // } catch (error) {
    //   console.error('Error updating dark mode setting:', error);
    // }
  };

  const settingSections: SettingSection[] = [
    {
      title: 'Account',
      items: [
        { label: 'Account Settings', icon: Users, route: '/settings/account-settings' },
        { label: 'Vehicle Information', icon: Car, route: '/settings/vehicle-info' },
        { label: 'Ride History', icon: History, route: '/settings/ride-history' },
        { label: 'Earnings', icon: CreditCard, route: '/earnings' },
        { label: 'Emergency Contacts', icon: Shield, route: '/settings/emergency-contacts' },
        { label: 'Ride Preferences', icon: Users, route: '/settings/ride-preferences' },
      ]
    },
    {
      title: 'Notifications',
      items: [
        { 
          label: 'Push Notifications', 
          icon: Bell, 
          toggle: true,
          value: notifications,
          onToggle: handleNotificationsToggle
        },
        { 
          label: 'Sound Effects', 
          icon: Volume2, 
          toggle: true,
          value: soundEnabled,
          onToggle: handleSoundToggle
        },
      ]
    },
    {
      title: 'Appearance',
      items: [
        { 
          label: 'Dark Mode (Coming Soon)', 
          icon: Moon, 
          toggle: true,
          value: false,
          onToggle: handleDarkModeToggle
        },
      ]
    },
    {
      title: 'Support',
      items: [
        { label: 'Help Center', icon: HelpCircle, route: 'https://ridealongapp.com/pages/help' },
        { label: 'Contact Support', icon: Users, route: 'mailto:support@ridealongapp.com' },
      ]
    }
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={24} color={theme.colors.secondary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.secondary }]}>
          Settings
        </Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {settingSections.map((section, sectionIndex) => (
          <View key={sectionIndex} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.secondary }]}>
              {section.title}
            </Text>
            
            <Card style={styles.sectionCard}>
              {section.items.map((item, itemIndex) => (
                <TouchableOpacity
                  key={itemIndex}
                  style={[
                    styles.settingItem,
                    itemIndex < section.items.length - 1 && styles.settingItemBorder
                  ]}
                  onPress={async () => {
                    if ('route' in item && item.route) {
                      // Check if it's an external URL (http, https, or mailto)
                      if (item.route.startsWith('http') || item.route.startsWith('mailto:')) {
                        try {
                          const supported = await Linking.canOpenURL(item.route);
                          if (supported) {
                            await Linking.openURL(item.route);
                          } else {
                            Alert.alert('Error', 'Unable to open this link');
                          }
                        } catch (error) {
                          console.error('Error opening URL:', error);
                          Alert.alert('Error', 'Failed to open the link');
                        }
                      } else {
                        // Internal route - use router navigation
                        router.push(item.route as any);
                      }
                    }
                  }}
                  disabled={item.toggle === true}
                >
                  <View style={styles.settingLeft}>
                    <View style={[styles.settingIcon, { backgroundColor: theme.colors.primary + '20' }]}>
                      <item.icon size={20} color={theme.colors.primary} />
                    </View>
                    <Text style={[styles.settingLabel, { color: theme.colors.secondary }]}>
                      {item.label}
                    </Text>
                  </View>
                  
                  {item.toggle ? (
                    <Switch
                      value={(item as ToggleSettingItem).value}
                      onValueChange={(item as ToggleSettingItem).onToggle}
                      trackColor={{ false: '#E2E8F0', true: theme.colors.primary + '40' }}
                      thumbColor={(item as ToggleSettingItem).value ? theme.colors.primary : '#F1F5F9'}
                    />
                  ) : (
                    <ChevronRight size={20} color="#64748B" />
                  )}
                </TouchableOpacity>
              ))}
            </Card>
          </View>
        ))}

        {/* Sign Out */}
        <TouchableOpacity 
          style={[styles.signOutButton, signingOut && { opacity: 0.6 }]}
          disabled={signingOut}
          onPress={async () => {
            try {
              setSigningOut(true);
              await signOut(firebaseAuth);
            } catch {
              // ignore; still take user to welcome
            } finally {
              setSigningOut(false);
              router.replace('/(auth)/sign-in');
            }
          }}
        >
          <LogOut size={20} color="#EF4444" />
          <Text style={styles.signOutText}>{signingOut ? 'Signing Out…' : 'Sign Out'}</Text>
        </TouchableOpacity>

        {/* Delete Account */}
        <TouchableOpacity
          style={[styles.deleteButton, deleting && { opacity: 0.65 }]}
          disabled={deleting}
          onPress={() => {
            const user = firebaseAuth.currentUser;
            if (!user) {
              Alert.alert('Not signed in', 'Please sign in first.');
              return;
            }
            Alert.alert(
              'Delete account?',
              'This will permanently delete your account and profile data. This action cannot be undone.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      setDeleting(true);
                      // Best-effort cleanup: remove photo and user doc
                      try { await removeProfilePhoto(); } catch {}
                      try { await deleteDoc(doc(firestore, 'drivers', user.uid)); } catch {}
                      await deleteUser(user);
                      Alert.alert('Account deleted', 'Your account has been deleted.');
                      router.replace('/(auth)/sign-in');
                    } catch (e: any) {
                      if (e?.code === 'auth/requires-recent-login') {
                        Alert.alert('Re-authentication required', 'Please sign out and sign back in, then try deleting your account again.');
                      } else {
                        Alert.alert('Delete failed', e?.message || 'Could not delete your account.');
                      }
                    } finally {
                      setDeleting(false);
                    }
                  },
                },
              ]
            );
          }}
        >
          <Text style={styles.deleteText}>{deleting ? 'Deleting…' : 'Delete Account'}</Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingBottom: 8,
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
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionCard: {
    backgroundColor: 'white',
    padding: 0,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    marginBottom: 32,
    gap: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
  deleteButton: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#B91C1C',
  },
});