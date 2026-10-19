import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';
import {
  DEFAULT_RADIUS_MILES,
  RADIUS_OPTIONS,
  getRideAlertPrefs,
  updateRideAlertPrefs,
  type AlertRole,
} from '@/src/services/rideAlerts';

/**
 * "Nearby ride alerts" setting rows for a settings card: an on/off switch and,
 * when on, a radius picker. Riders hear about rides starting near them; drivers
 * hear about ride requests near them.
 */
export function NearbyAlertsSetting({ role, isLast = false }: { role: AlertRole; isLast?: boolean }) {
  const { colors } = useAppTheme();
  // Rider and driver settings cards use slightly different row metrics.
  const s = useMemo(() => makeStyles(colors, role), [colors, role]);
  const riderLook = role === 'rider';
  const [enabled, setEnabled] = useState(true);
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS_MILES);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getRideAlertPrefs(role).then((prefs) => {
      if (!alive) return;
      setEnabled(prefs.nearbyEnabled);
      setRadius(prefs.radiusMiles);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [role]);

  const sub = role === 'driver'
    ? 'Get notified when riders near you request a ride'
    : 'Get notified when a ride starts near you';

  const toggle = async (value: boolean) => {
    const previous = enabled;
    setEnabled(value);
    setSaving(true);
    try {
      const ok = await updateRideAlertPrefs(role, { nearbyEnabled: value });
      if (!ok) {
        setEnabled(previous);
        Alert.alert(
          'Location needed',
          'Nearby alerts use your approximate location. Turn on location access for RideAlong in Settings to use them.',
          [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }],
        );
      }
    } catch {
      setEnabled(previous);
      Alert.alert('Settings not saved', 'We could not update nearby alerts. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const pickRadius = async (miles: number) => {
    if (miles === radius) return;
    const previous = radius;
    setRadius(miles);
    try {
      await updateRideAlertPrefs(role, { radiusMiles: miles });
    } catch {
      setRadius(previous);
      Alert.alert('Settings not saved', 'We could not update your alert distance. Please try again.');
    }
  };

  return (
    <View style={[!isLast && s.rowBorder]}>
      <View style={s.row}>
        <View style={s.rowIconWrap}>
          <Ionicons name={riderLook ? 'location' : 'location-outline'} size={riderLook ? 18 : 19} color={colors.primary} />
        </View>
        <View style={s.rowMid}>
          <Text style={s.rowLabel}>Nearby ride alerts</Text>
          <Text style={s.rowSub}>{sub}</Text>
        </View>
        <View style={s.switchWrap}>
          <Switch
            value={enabled}
            onValueChange={toggle}
            disabled={saving}
            trackColor={riderLook
              ? { false: colors.border, true: colors.primary }
              : { false: colors.switchTrackOff, true: colors.switchTrackOn }}
            thumbColor={riderLook ? colors.bgCard : (enabled ? colors.switchThumbOn : colors.switchThumbOff)}
            ios_backgroundColor={riderLook ? colors.border : colors.switchIosBg}
            style={{ transform: [{ scaleX: 0.88 }, { scaleY: 0.88 }] }}
          />
        </View>
      </View>
      {enabled ? (
        <View style={s.radiusRow}>
          <Text style={s.radiusLabel}>Within</Text>
          <View style={s.chips}>
            {RADIUS_OPTIONS.map((miles) => {
              const active = miles === radius;
              return (
                <TouchableOpacity
                  key={miles}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => pickRadius(miles)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.chipText, active && s.chipTextActive]}>{miles} mi</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(colors: AppColors, role: AlertRole) {
  const rider = role === 'rider';
  const iconSize = rider ? 34 : 36;
  return StyleSheet.create({
    row: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 18,
      paddingVertical: 13,
    },
    rowBorder: { borderBottomWidth: rider ? 1 : StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowIconWrap: { width: iconSize, height: iconSize, borderRadius: rider ? 10 : 11, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    rowMid: { flex: 1, minWidth: 0 },
    rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    rowSub: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
    switchWrap: rider ? { width: 46, height: 32, marginRight: 4, alignItems: 'center', justifyContent: 'center' } : {},
    radiusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 18 + iconSize + 14, paddingRight: 18, paddingBottom: 14, marginTop: -4 },
    radiusLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    chips: { flexDirection: 'row', gap: 8 },
    chip: {
      height: 30,
      paddingHorizontal: 12,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: colors.textInverse },
  });
}

export default NearbyAlertsSetting;
