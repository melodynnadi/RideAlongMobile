import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useDriverUnreadCounts } from '@/hooks/useRiderUnreadCounts';
import { hitSlop } from '@/theme/designSystem';
import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';

export type DriverTab = 'home' | 'offer' | 'requests' | 'inbox';

function badgeLabel(n: number) {
  return n > 9 ? '9+' : String(n);
}

export function DriverBottomNav({ activeTab }: { activeTab: DriverTab }) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { messageCount: totalUnread } = useDriverUnreadCounts();

  const tabs: { key: DriverTab; label: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] = [
    { key: 'home', label: 'Home', icon: 'home', href: '/(driver)' },
    { key: 'offer', label: 'Offer', icon: 'add-circle-outline', href: '/(driver)/book' },
    { key: 'requests', label: 'Requests', icon: 'ticket-outline', href: '/(driver)/requests' },
    { key: 'inbox', label: 'Inbox', icon: 'chatbubble', href: '/(driver)/messages' },
  ];

  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const selected = tab.key === activeTab;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.navItem, selected && styles.navItemActive]}
            onPress={() => router.push(tab.href as any)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            hitSlop={hitSlop}
          >
            <View style={styles.navIconWrap}>
              <Ionicons name={tab.icon} size={23} color={selected ? colors.primary : colors.textSecondary} />
              {tab.key === 'inbox' && totalUnread > 0 ? (
                <View style={styles.iconBadge}>
                  <Text style={styles.iconBadgeText}>{badgeLabel(totalUnread)}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.navText, selected && styles.navTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
  bottomNav: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 14,
    zIndex: 50,
    height: 58,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 29,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 5,
    ...Platform.select({
      ios: {
        shadowColor: colors.textPrimary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.14,
        shadowRadius: 16,
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  navItem: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    gap: 1,
  },
  navItemActive: {
    backgroundColor: colors.bgSecondary,
  },
  navIconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  navTextActive: {
    color: colors.primary,
  },
  iconBadge: {
    position: 'absolute',
    top: -7,
    right: -11,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  iconBadgeText: {
    color: colors.textInverse,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '800',
  },
  });
}
