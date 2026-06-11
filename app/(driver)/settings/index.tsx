// RideAlongDriverMobile — Settings (theme-aware)
// Dark + Light mode. Reads from ThemeContext.
// All business logic identical to original.

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Linking,
  Animated,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import {
  Bell,
  Shield,
  CreditCard,
  Users,
  Volume2,
  History,
  Car,
  Moon,
  LucideIcon,
} from 'lucide-react-native';
import { router } from 'expo-router';
import { signOut, deleteUser } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/constants/services';
import { removeProfilePhoto } from '@/src/services/profilePhoto';
import { settingsService } from '@/src/services/settingsService';
import { notificationService } from '@/src/services/notificationService';
import { useVerificationStore } from '@/stores/verificationStore';
import { useAppTheme } from '@/hooks/ThemeContext';
import { iconPalette, SemanticColor, AppColors, BRAND } from '@/constants/theme';

type GradientStops = readonly [string, string, ...string[]];

const asGradientStops = (colors: string[]): GradientStops => {
  return colors as unknown as GradientStops;
};

interface BaseItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: LucideIcon | string;
  semantic: SemanticColor;
  isIonicon?: boolean;
}

interface NavItem extends BaseItem {
  kind: 'nav';
  route: string;
  badge?: string | number;
}

interface TogItem extends BaseItem {
  kind: 'toggle';
  value: boolean;
  onToggle: (v: boolean) => void;
}

type RowItem = NavItem | TogItem;

interface Section {
  id: string;
  title: string;
  rows: RowItem[];
}

function SettingRow({
  item,
  isLast,
  colors,
}: {
  item: RowItem;
  isLast: boolean;
  colors: AppColors;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const { color, bg } = iconPalette(colors, item.semantic);

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.975,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  };

  const IconComp = item.isIonicon ? null : (item.icon as LucideIcon);
  const ionName = item.isIonicon ? (item.icon as string) : null;

  const handlePress = async () => {
    if (item.kind !== 'nav') return;

    const route = item.route;

    if (route.startsWith('http') || route.startsWith('mailto:')) {
      try {
        if (await Linking.canOpenURL(route)) {
          await Linking.openURL(route);
        } else {
          Alert.alert('Cannot open', 'This link could not be opened.');
        }
      } catch {
        Alert.alert('Error', 'Failed to open the link.');
      }

      return;
    }

    router.push(route as any);
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          styles.row,
          !isLast && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.divider,
          },
        ]}
        onPress={() => {
          if (item.kind === 'toggle') {
            item.onToggle(!item.value);
            return;
          }

          handlePress();
        }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        activeOpacity={1}
      >
        <View style={[styles.iconBadge, { backgroundColor: bg }]}>
          {IconComp ? (
            <IconComp size={17} color={color} strokeWidth={2.2} />
          ) : (
            <Ionicons name={ionName as any} size={17} color={color} />
          )}
        </View>

        <View style={styles.rowMid}>
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
            {item.label}
          </Text>

          {item.sublabel ? (
            <Text style={[styles.rowSublabel, { color: colors.textTertiary }]}>
              {item.sublabel}
            </Text>
          ) : null}
        </View>

        <View style={styles.rowRight}>
          {item.kind === 'toggle' && (
            <Switch
              value={item.value}
              onValueChange={item.onToggle}
              trackColor={{
                false: colors.switchTrackOff,
                true: colors.switchTrackOn,
              }}
              thumbColor={item.value ? colors.switchThumbOn : colors.switchThumbOff}
              ios_backgroundColor={colors.switchIosBg}
              style={{ transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] }}
            />
          )}

          {item.kind === 'nav' && (
            <>
              {item.badge !== undefined && (
                <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.badgeText}>{item.badge}</Text>
                </View>
              )}

              <Ionicons
                name="chevron-forward"
                size={14}
                color={colors.textTertiary}
                style={{ marginLeft: 2 }}
              />
            </>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

function SettingGroup({
  section,
  colors,
  isDark,
}: {
  section: Section;
  colors: AppColors;
  isDark: boolean;
}) {
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, { color: colors.textTertiary }]}>
        {section.title.toUpperCase()}
      </Text>

      <View
        style={[
          styles.groupCard,
          {
            borderColor: colors.borderMid,
            backgroundColor: isDark ? colors.glassBg : colors.bgCard,
          },
          !isDark && {
            shadowColor: BRAND.navyText,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.07,
            shadowRadius: 12,
            elevation: 3,
          },
        ]}
      >
        {isDark && (
          <BlurView
            intensity={colors.glassIntensity}
            tint={colors.glassTint}
            style={StyleSheet.absoluteFillObject}
          />
        )}

        {section.rows.map((row, index) => (
          <SettingRow
            key={row.id}
            item={row}
            isLast={index === section.rows.length - 1}
            colors={colors}
          />
        ))}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { colors, isDark, setDark } = useAppTheme();
  const { isVerified, verificationStatus } = useVerificationStore();
  const user = firebaseAuth.currentUser;

  const [notifications, setNotifications] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const glowOpacity = useRef(new Animated.Value(0.4)).current;
  const slideY = useRef(new Animated.Value(20)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, {
        toValue: 0,
        duration: 380,
        useNativeDriver: true,
      }),
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: isDark ? 0.85 : 0.4,
          duration: 2800,
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: isDark ? 0.25 : 0.12,
          duration: 2800,
          useNativeDriver: true,
        }),
      ])
    ).start();

    settingsService
      .getSettings()
      .then((settings) => {
        setNotifications(settings.pushNotificationsEnabled);
        setSoundEnabled(settings.soundEffectsEnabled);
      })
      .catch(() => {});
  }, []);

  const toggleNotifications = async (value: boolean) => {
    setNotifications(value);

    try {
      await settingsService.updateSettings({ pushNotificationsEnabled: value });
      await notificationService.updateNotificationHandler();
    } catch (error) {
      console.warn(error);
    }
  };

  const toggleSound = async (value: boolean) => {
    setSoundEnabled(value);

    try {
      await settingsService.updateSettings({ soundEffectsEnabled: value });
    } catch (error) {
      console.warn(error);
    }
  };

  const handleDarkModeToggle = (value: boolean) => {
    setDark(value);
  };

  const isVerifiedFinal = isVerified || verificationStatus === 'approved';
  const isPending =
    verificationStatus === 'pending' || verificationStatus === 'manual-review';

  const verLabel = isVerifiedFinal
    ? 'Verified Student'
    : isPending
      ? 'Pending'
      : verificationStatus === 'rejected'
        ? 'Not Verified'
        : 'Unverified';

  const verColor = isVerifiedFinal
    ? colors.green
    : isPending
      ? colors.amber
      : verificationStatus === 'rejected'
        ? colors.red
        : colors.textTertiary;

  const sections: Section[] = [
    {
      id: 'account',
      title: 'Account',
      rows: [
        {
          id: 'account-s',
          kind: 'nav',
          label: 'Account Settings',
          sublabel: 'Name, email & password',
          icon: 'person-circle',
          isIonicon: true,
          semantic: 'blue',
          route: '/settings/account-settings',
        },
        {
          id: 'vehicle',
          kind: 'nav',
          label: 'Vehicle Information',
          sublabel: 'Car make, model & plate',
          icon: Car,
          semantic: 'orange',
          route: '/settings/vehicle-info',
        },
        {
          id: 'history',
          kind: 'nav',
          label: 'Ride History',
          sublabel: 'Past trips & ratings',
          icon: History,
          semantic: 'purple',
          route: '/settings/ride-history',
        },
        {
          id: 'earnings',
          kind: 'nav',
          label: 'Earnings & Payouts',
          sublabel: 'Lifetime & pending cash',
          icon: CreditCard,
          semantic: 'green',
          route: '/earnings',
        },
        {
          id: 'emergency',
          kind: 'nav',
          label: 'Emergency Contacts',
          sublabel: 'Safety & trusted contacts',
          icon: Shield,
          semantic: 'red',
          route: '/settings/emergency-contacts',
        },
        {
          id: 'prefs',
          kind: 'nav',
          label: 'Ride Preferences',
          sublabel: 'Music, chat & vibe',
          icon: Users,
          semantic: 'teal',
          route: '/settings/ride-preferences',
        },
      ],
    },
    {
      id: 'notifs',
      title: 'Notifications',
      rows: [
        {
          id: 'push',
          kind: 'toggle',
          label: 'Push Notifications',
          sublabel: 'Ride offers & alerts',
          icon: Bell,
          semantic: 'orange',
          value: notifications,
          onToggle: toggleNotifications,
        },
        {
          id: 'sound',
          kind: 'toggle',
          label: 'Sound Effects',
          sublabel: 'In-app audio feedback',
          icon: Volume2,
          semantic: 'purple',
          value: soundEnabled,
          onToggle: toggleSound,
        },
      ],
    },
    {
      id: 'appearance',
      title: 'Appearance',
      rows: [
        {
          id: 'dark',
          kind: 'toggle',
          label: 'Dark Mode',
          sublabel: isDark ? 'Currently dark' : 'Currently light',
          icon: Moon,
          semantic: 'muted',
          value: isDark,
          onToggle: handleDarkModeToggle,
        },
      ],
    },
    {
      id: 'support',
      title: 'Help & Legal',
      rows: [
        {
          id: 'help',
          kind: 'nav',
          label: 'Help Center',
          sublabel: 'FAQs & how-to guides',
          icon: 'help-buoy',
          isIonicon: true,
          semantic: 'green',
          route: 'https://ridealongapp.com/pages/help',
        },
        {
          id: 'contact',
          kind: 'nav',
          label: 'Contact Support',
          sublabel: 'Response within 24h',
          icon: 'mail',
          isIonicon: true,
          semantic: 'blue',
          route: 'mailto:support@ridealongapp.com',
        },
        {
          id: 'privacy',
          kind: 'nav',
          label: 'Privacy Policy',
          sublabel: 'How we protect your data',
          icon: 'shield-checkmark',
          isIonicon: true,
          semantic: 'teal',
          route: 'https://ridealongapp.com/privacy',
        },
        {
          id: 'terms',
          kind: 'nav',
          label: 'Terms of Service',
          sublabel: 'User agreement',
          icon: 'document-text',
          isIonicon: true,
          semantic: 'amber',
          route: 'https://ridealongapp.com/terms',
        },
      ],
    },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle={colors.statusBar} />

      <LinearGradient
        colors={asGradientStops(colors.gradientBg)}
        locations={[0, 0.6, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <Animated.View
        style={[
          styles.ambientGlow,
          {
            opacity: glowOpacity,
            backgroundColor: BRAND.orange,
          },
        ]}
      />

      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Animated.View
          style={[
            styles.navBar,
            {
              opacity: fadeIn,
              transform: [{ translateY: slideY }],
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.navBack,
              {
                backgroundColor: isDark
                  ? 'rgba(255,255,255,0.07)'
                  : 'rgba(13,27,72,0.07)',
              },
            ]}
            onPress={() =>
              router.canGoBack() ? router.back() : router.push('/(driver)' as any)
            }
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          <Text style={[styles.navTitle, { color: colors.textPrimary }]}>
            Settings
          </Text>

          <View
            style={[
              styles.navVersionPill,
              {
                backgroundColor: colors.primaryDim,
                borderColor: colors.primaryBorder,
              },
            ]}
          >
            <Text style={[styles.navVersionText, { color: colors.primary }]}>
              v2.0
            </Text>
          </View>
        </Animated.View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.identityCard,
              {
                opacity: fadeIn,
                transform: [{ translateY: slideY }],
                borderColor: colors.borderMid,
              },
              !isDark && {
                shadowColor: BRAND.navyText,
                shadowOffset: { width: 0, height: 3 },
                shadowOpacity: 0.08,
                shadowRadius: 16,
                elevation: 4,
              },
            ]}
          >
            <LinearGradient
              colors={asGradientStops(colors.gradientCard)}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

            <View
              style={[
                styles.identityAccentBar,
                { backgroundColor: colors.primary },
              ]}
            />

            <LinearGradient
              colors={[BRAND.orange, BRAND.orangeDeep]}
              style={styles.identityAvatar}
            >
              <Text style={styles.identityAvatarText}>
                {user?.displayName?.[0]?.toUpperCase() ||
                  user?.email?.[0]?.toUpperCase() ||
                  'D'}
              </Text>
            </LinearGradient>

            <View style={styles.identityInfo}>
              <Text
                style={[styles.identityName, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {user?.displayName || user?.email?.split('@')[0] || 'Driver'}
              </Text>

              <Text
                style={[styles.identityEmail, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {user?.email ?? '-'}
              </Text>

              <View
                style={[
                  styles.verBadge,
                  {
                    backgroundColor: `${verColor}18`,
                    borderColor: `${verColor}38`,
                  },
                ]}
              >
                <Text style={[styles.verBadgeText, { color: verColor }]}>
                  {verLabel}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.editBtn,
                {
                  backgroundColor: colors.primaryDim,
                  borderColor: colors.primaryBorder,
                },
              ]}
              onPress={() => router.push('/settings/account-settings' as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="pencil" size={14} color={colors.primary} />
            </TouchableOpacity>
          </Animated.View>

          {sections.map((section) => (
            <SettingGroup
              key={section.id}
              section={section}
              colors={colors}
              isDark={isDark}
            />
          ))}

          <View style={styles.group}>
            <TouchableOpacity
              style={[
                styles.actionCard,
                {
                  borderColor: colors.redBorder,
                  backgroundColor: colors.redDim,
                },
                !isDark && {
                  shadowColor: '#DC2626',
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.08,
                  shadowRadius: 8,
                  elevation: 2,
                },
                signingOut && { opacity: 0.55 },
              ]}
              onPress={async () => {
                if (signingOut) return;

                setSigningOut(true);

                try {
                  await signOut(firebaseAuth);
                } catch {
                } finally {
                  setSigningOut(false);
                  router.replace('/(auth)/sign-in' as any);
                }
              }}
              activeOpacity={0.8}
            >
              {isDark && (
                <BlurView
                  intensity={12}
                  tint="dark"
                  style={StyleSheet.absoluteFillObject}
                />
              )}

              <View style={[styles.iconBadge, { backgroundColor: colors.redDim }]}>
                <Ionicons name="log-out-outline" size={17} color={colors.redDeep} />
              </View>

              <Text style={[styles.actionLabel, { color: colors.redDeep }]}>
                {signingOut ? 'Signing out...' : 'Sign Out'}
              </Text>

              <Ionicons
                name="chevron-forward"
                size={14}
                color={`${colors.redDeep}55`}
                style={{ marginLeft: 'auto' }}
              />
            </TouchableOpacity>
          </View>

          <View style={[styles.group, { marginTop: 0 }]}>
            <TouchableOpacity
              style={[
                styles.deleteCard,
                {
                  borderColor: isDark
                    ? 'rgba(185,28,28,0.18)'
                    : 'rgba(185,28,28,0.22)',
                  backgroundColor: 'rgba(185,28,28,0.04)',
                },
                deleting && { opacity: 0.55 },
              ]}
              onPress={() => {
                const currentUser = firebaseAuth.currentUser;

                if (!currentUser) {
                  Alert.alert('Not signed in');
                  return;
                }

                Alert.alert(
                  'Delete Account?',
                  'This permanently removes your account, profile, and all data. This cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete Forever',
                      style: 'destructive',
                      onPress: async () => {
                        setDeleting(true);

                        try {
                          try {
                            await removeProfilePhoto();
                          } catch {}

                          try {
                            await deleteDoc(doc(firestore, 'drivers', currentUser.uid));
                          } catch {}

                          await deleteUser(currentUser);
                          router.replace('/(auth)/sign-in' as any);
                        } catch (error: any) {
                          Alert.alert(
                            error?.code === 'auth/requires-recent-login'
                              ? 'Re-authentication Required'
                              : 'Delete Failed',
                            error?.code === 'auth/requires-recent-login'
                              ? 'Please sign out and sign back in, then try again.'
                              : error?.message || 'Could not delete your account.'
                          );
                        } finally {
                          setDeleting(false);
                        }
                      },
                    },
                  ]
                );
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.deleteText}>
                {deleting ? 'Deleting account...' : 'Delete Account'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerBrand, { color: colors.textSecondary }]}>
              RideAlong
            </Text>
            <Text style={[styles.footerSub, { color: colors.textTertiary }]}>
              Version 2.0.0 · Built for campus life
            </Text>
            <Text style={[styles.footerLegal, { color: `${colors.textTertiary}88` }]}>
              © 2025 RideAlong. All rights reserved.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: { paddingTop: 6, paddingBottom: 60 },
  ambientGlow: {
    position: 'absolute',
    top: -160,
    alignSelf: 'center',
    width: 400,
    height: 400,
    borderRadius: 200,
    transform: [{ scaleY: 0.32 }],
  },

  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 14,
  },
  navBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  navVersionPill: {
    width: 40,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  navVersionText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  identityCard: {
    marginHorizontal: 16,
    marginBottom: 26,
    borderRadius: 22,
    overflow: 'hidden',
    padding: 18,
    paddingTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
  },
  identityAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  identityAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  identityAvatarText: {
    fontSize: 23,
    fontWeight: '800',
    color: '#fff',
  },
  identityInfo: { flex: 1 },
  identityName: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  identityEmail: {
    fontSize: 13,
    marginBottom: 8,
  },
  verBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  verBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  editBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },

  group: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  groupTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
    paddingLeft: 4,
  },
  groupCard: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowMid: {
    flex: 1,
    marginLeft: 12,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  rowSublabel: {
    fontSize: 12,
    marginTop: 1,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  badge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },

  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },

  deleteCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B91C1C',
  },

  footer: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 5,
  },
  footerBrand: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  footerSub: {
    fontSize: 12,
  },
  footerLegal: {
    fontSize: 11,
  },
});