import React from 'react';
import { Image, Platform, StyleSheet, Text as RNText, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { hitSlop } from '@/theme/designSystem';
import { badgeLabel, useRiderUnreadCounts } from '@/hooks/useRiderUnreadCounts';

const NAVY = '#15233A';
const ORANGE = '#DE5D20';
const BORDER = '#E5E0D8';
const FONT_SANS = Platform.OS === 'web' ? '"Plus Jakarta Sans", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' : undefined;

function Text({ style, ...props }: React.ComponentProps<typeof RNText>) {
  return <RNText {...props} style={[styles.text, style]} />;
}

export function DriverHomeUtilityBar({
  university,
  initial,
  avatarUrl,
}: {
  university?: string;
  initial: string;
  avatarUrl?: string | null;
}) {
  const { notificationCount } = useRiderUnreadCounts();

  return (
    <View style={styles.homeUtilityBar}>
      <View style={styles.homeBrandMark}>
        <Image source={require('../../assets/ridealonglogo.png')} style={styles.homeBrandLogo} resizeMode="contain" />
      </View>
      <View style={styles.campusChip}>
        <Ionicons name="school-outline" size={15} color={NAVY} />
        <Text style={styles.campusText} numberOfLines={1}>{university || 'Your campus'}</Text>
      </View>
      <TouchableOpacity
        style={styles.utilityButton}
        onPress={() => router.push({ pathname: '/(driver)/notifications', params: { returnTo: '/(driver)' } } as any)}
        accessibilityRole="button"
        accessibilityLabel="Open notifications"
        hitSlop={hitSlop}
      >
        <Ionicons name="notifications-outline" size={21} color={NAVY} />
        {notificationCount > 0 ? (
          <View style={styles.utilityBadge}><Text style={styles.iconBadgeText}>{badgeLabel(notificationCount)}</Text></View>
        ) : null}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.homeAvatar}
        onPress={() => router.push('/(driver)/profile' as any)}
        accessibilityRole="button"
        accessibilityLabel="Open profile"
        hitSlop={hitSlop}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.homeAvatarImage} resizeMode="cover" />
        ) : (
          <Text style={styles.homeAvatarText}>{initial}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

export function DriverSectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} disabled={!onAction} hitSlop={hitSlop}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function DriverRouteDots({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.routeRail, compact && { paddingVertical: 4 }]}>
      <View style={styles.navyDot} />
      <View style={styles.dashedLine} />
      <View style={styles.orangeDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: FONT_SANS },
  homeUtilityBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 0, marginBottom: 24, paddingTop: 14, paddingHorizontal: 20 },
  homeBrandMark: { width: 36, height: 36, borderRadius: 12, overflow: 'hidden' },
  homeBrandLogo: { width: '100%', height: '100%' },
  campusChip: { flex: 1, minWidth: 0, height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 19, backgroundColor: '#F3EFE8' },
  campusText: { flex: 1, color: NAVY, fontSize: 13, fontWeight: '700' },
  utilityButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: BORDER },
  utilityBadge: { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#FFFFFF' },
  iconBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  homeAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9E8DB', borderWidth: 1, borderColor: '#F3D7C6', overflow: 'hidden' },
  homeAvatarImage: { width: '100%', height: '100%', borderRadius: 20 },
  homeAvatarText: { color: ORANGE, fontSize: 15, fontWeight: '800' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontFamily: FONT_SANS, flex: 1, color: NAVY, fontSize: 17, fontWeight: '700' },
  sectionAction: { fontFamily: Platform.OS === 'web' ? '"JetBrains Mono", monospace' : undefined, color: ORANGE, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  routeRail: { width: 28, alignItems: 'center', paddingTop: 16, paddingBottom: 16 },
  navyDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: NAVY },
  orangeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  dashedLine: { flex: 1, width: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', marginVertical: 7 },
});
