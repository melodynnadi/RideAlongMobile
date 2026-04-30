
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, Bell, Shield, CreditCard, Users, HelpCircle, LogOut, Moon, Volume2, History, LucideIcon, Trash2 } from 'lucide-react-native';
import { Card } from '@/components/ui/Card';
import { useTheme } from '@/hooks/useTheme';
import { router } from 'expo-router';
import { signOut, deleteUser, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { firebaseAuth } from '@/constants/services';
import { doc, deleteDoc, addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { getApiBaseUrl } from '@/constants/services';
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
  const [deletingAccount, setDeletingAccount] = useState(false);

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
      
      // Sync to Firestore so server can check this setting
      const uid = firebaseAuth.currentUser?.uid;
      if (uid) {
        await updateDoc(doc(firestore, 'riders', uid), {
          pushNotificationsEnabled: value,
          updatedAt: serverTimestamp()
        });
        console.log('Push notifications setting synced to Firestore:', value);
      }
      
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

  // Test function to check if server is accessible
  const testServerConnection = async () => {
    try {
      console.log('Testing server connection...');
      const response = await fetch(`${getApiBaseUrl()}/api/send-deletion-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userEmail: 'test@example.com',
          userName: 'Test User',
          deletionDate: new Date().toISOString(),
        }),
      });
      console.log('Server test response:', response.status, response.statusText);
      return response.ok;
    } catch (error) {
      console.error('Server connection test failed:', error);
      return false;
    }
  };

  const settingSections: SettingSection[] = [
    {
      title: 'Account',
      items: [
        { label: 'Account Settings', icon: Users, route: '/settings/account-settings' },
        { label: 'Ride History', icon: History, route: '/settings/ride-history' },
        { label: 'Payment Methods', icon: CreditCard, route: '/settings/payment-methods' },
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

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone and will permanently remove all your data.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingAccount(true);
              console.log('Starting account deletion process...');
              
              const currentUser = firebaseAuth.currentUser;
              
              if (!currentUser) {
                throw new Error('No user logged in');
              }

              console.log('Current user:', currentUser.email, 'UID:', currentUser.uid);

              // Step 1: Store deletion email record in Firestore (this will work even if server is down)
              try {
                console.log('Step 1: Storing deletion email record...');
                await addDoc(collection(firestore, 'mail'), {
                  to: currentUser.email,
                  message: {
                    subject: 'Account Deletion Confirmation',
                    text: `Dear ${currentUser.displayName || 'User'},

Your RideAlong account has been successfully deleted as requested.

Account Details:
- Email: ${currentUser.email}
- Deletion Date: ${new Date().toLocaleDateString()}
- Deletion Time: ${new Date().toLocaleTimeString()}

Important Information:
• All your personal data has been permanently removed from our systems
• Your ride history, payment methods, and preferences have been deleted
• This action cannot be undone
• If you did not request this deletion, please contact our support team immediately

If you have any questions or concerns, please don't hesitate to reach out to our support team.

Thank you for using RideAlong.

Best regards,
The RideAlong Team`,
                  },
                  type: 'account_deletion',
                  userId: currentUser.uid,
                  createdAt: serverTimestamp(),
                });
                console.log('Email record stored in Firestore successfully');
              } catch (emailError) {
                console.warn('Error storing email record:', emailError);
                // Continue with account deletion even if email storage fails
              }

              // Step 2: Try to send email via server (optional)
              try {
                console.log('Step 2: Attempting to send email via server...');
                const response = await fetch(`${getApiBaseUrl()}/api/send-deletion-email`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    userEmail: currentUser.email,
                    userName: currentUser.displayName || `${currentUser.email?.split('@')[0]}`,
                    deletionDate: new Date().toISOString(),
                  }),
                });

                if (response.ok) {
                  console.log('Deletion confirmation email sent successfully');
                } else {
                  console.warn('Server email sending failed, but continuing with deletion');
                }
              } catch (serverError) {
                console.warn('Server email sending failed:', serverError);
                // Continue with account deletion even if server email fails
              }

              // Step 3: Delete user data from Firestore
              console.log('Step 3: Deleting user data from Firestore...');
              try {
                await deleteDoc(doc(firestore, 'riders', currentUser.uid));
                console.log('User data deleted from Firestore successfully');
              } catch (firestoreError) {
                console.error('Error deleting Firestore data:', firestoreError);
                // Continue with account deletion even if Firestore deletion fails
              }
              
              // Step 4: Delete the user account from Firebase Auth
              console.log('Step 4: Deleting Firebase Auth account...');
              try {
                await deleteUser(currentUser);
                console.log('Firebase Auth account deleted successfully');
              } catch (authError: any) {
                console.error('Error deleting Firebase Auth account:', authError);
                
                if (authError.code === 'auth/requires-recent-login') {
                  Alert.alert(
                    'Re-authentication Required',
                    'For security reasons, you need to sign in again before deleting your account. Please sign out and sign back in, then try again.',
                    [
                      {
                        text: 'OK',
                        onPress: () => {
                          // Sign out the user so they can sign back in
                          signOut(firebaseAuth).then(() => {
                            router.replace('/(auth)/sign-in');
                          });
                        }
                      }
                    ]
                  );
                  return;
                } else {
                  throw authError;
                }
              }
              
              // Step 5: Navigate to welcome screen
              console.log('Step 5: Navigating to welcome screen...');
              router.replace('/(auth)/sign-in');
              
            } catch (error: any) {
              console.error('Error in account deletion process:', error);
              console.error('Error code:', error.code);
              console.error('Error message:', error.message);
              
              let errorMessage = 'Failed to delete account. Please try again.';
              
              if (error.code === 'auth/user-token-expired') {
                errorMessage = 'Your session has expired. Please sign out and sign back in, then try again.';
              } else if (error.message) {
                errorMessage = error.message;
              }
              
              Alert.alert(
                'Error',
                errorMessage,
                [{ text: 'OK' }]
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
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
          style={[styles.deleteAccountButton, deletingAccount && { opacity: 0.6 }]}
          disabled={deletingAccount}
          onPress={handleDeleteAccount}
        >
          <Trash2 size={20} color="#EF4444" />
          <Text style={styles.deleteAccountText}>
            {deletingAccount ? 'Deleting Account…' : 'Delete Account'}
          </Text>
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
    marginBottom: 16,
    gap: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 2,
    borderColor: '#EF4444',
    padding: 16,
    borderRadius: 12,
    marginBottom: 32,
    gap: 8,
  },
  deleteAccountText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
});