import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '@/hooks/ThemeContext';
import type { ThemeMode } from '@/src/services/settingsService';

const OPTIONS: { mode: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { mode: 'light', label: 'Light', icon: 'sunny-outline' },
  { mode: 'dark', label: 'Dark', icon: 'moon-outline' },
];

/**
 * Settings row for light/dark appearance. "System" follows the phone's setting.
 * `onChange` lets a screen also persist the choice to the user's profile.
 */
export function AppearanceSelector({ onChange }: { onChange?: (mode: ThemeMode) => void }) {
  const { colors, themeMode, setThemeMode, isDark } = useAppTheme();

  const sub = themeMode === 'system'
    ? `Matches your phone · ${isDark ? 'Dark' : 'Light'} now`
    : themeMode === 'dark' ? 'Always dark' : 'Always light';

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.primaryDim }]}>
          <Ionicons name="contrast-outline" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Appearance</Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>{sub}</Text>
        </View>
      </View>
      <View style={[styles.segment, { backgroundColor: colors.bgSecondary }]}>
        {OPTIONS.map((o) => {
          const active = themeMode === o.mode;
          return (
            <TouchableOpacity
              key={o.mode}
              style={[styles.option, active && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() => {
                if (active) return;
                setThemeMode(o.mode);
                onChange?.(o.mode);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${o.label} appearance`}
            >
              <Ionicons name={o.icon} size={15} color={active ? colors.primary : colors.textSecondary} />
              <Text style={[styles.optionText, { color: active ? colors.textPrimary : colors.textSecondary }, active && styles.optionTextActive]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2 },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3 },
  option: {
    flex: 1,
    minHeight: 38,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  optionText: { fontSize: 13, fontWeight: '600' },
  optionTextActive: { fontWeight: '700' },
});
