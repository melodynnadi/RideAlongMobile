import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { MapPin, Navigation, Plus, Pencil, Trash2, ArrowRight, X } from 'lucide-react-native';
import { useDriverPreferredRoutesStore, usePreferredRoutesStore } from '@/stores/preferredRoutesStore';
import { CityAutocomplete } from './CityAutocomplete';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';

type PreferredRoutesManagerProps = {
  role?: 'driver' | 'rider';
};

export const DriverPreferredRoutesManager: React.FC<PreferredRoutesManagerProps> = ({ role = 'driver' }) => {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const driverRoutes = useDriverPreferredRoutesStore();
  const riderRoutes = usePreferredRoutesStore();
  const routes = role === 'driver' ? driverRoutes.routes : riderRoutes.routes;
  const load = role === 'driver' ? driverRoutes.load : riderRoutes.loadRoutes;
  const add = role === 'driver' ? driverRoutes.add : riderRoutes.addRoute;
  const update = role === 'driver' ? driverRoutes.update : riderRoutes.updateRoute;
  const remove = role === 'driver' ? driverRoutes.remove : riderRoutes.deleteRoute;
  const loading = role === 'driver' ? driverRoutes.loading : riderRoutes.loading;
  const saving = role === 'driver' ? driverRoutes.saving : riderRoutes.isSaving;
  const error = role === 'driver' ? driverRoutes.error : riderRoutes.error;
  const clearError = role === 'driver' ? driverRoutes.clearError : riderRoutes.clearError;
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { if (error) Alert.alert('Preferred Routes', error, [{ text: 'OK', onPress: () => clearError() }]); }, [error, clearError]);

  const resetForm = () => { setOrigin(''); setDestination(''); setEditingId(null); };

  const onSave = async () => {
    if (!origin.trim() || !destination.trim()) { Alert.alert('Validation', 'Origin and destination required'); return; }
    if (editingId) { await update(editingId, origin, destination); if (!error) resetForm(); } else { await add(origin, destination); if (!error) resetForm(); }
  };

  const editRoute = (id: string) => {
    const r = routes.find(r => r.id === id); if (!r) return; setEditingId(id); setOrigin(r.origin); setDestination(r.destination);
  };

  const deleteRoute = (id: string) => {
    Alert.alert('Delete Route', 'Remove this preferred route?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await remove(id); if (!error && editingId === id) resetForm(); } }
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Preferred Routes</Text>
      <Text style={styles.subheading}>{role === 'driver' ? 'We notify you when riders request matching routes.' : 'We notify you when drivers post matching routes.'}</Text>

      {/* Origin input */}
      <View style={styles.inputGroup}>
        <View style={styles.inputLabel}>
          <MapPin size={16} color={colors.primary} />
          <Text style={styles.inputLabelText}>Pickup</Text>
        </View>
        <View style={{ zIndex: 2 }}>
          <CityAutocomplete
            placeholder="City or address"
            value={origin}
            onChangeText={setOrigin}
            onSelected={setOrigin}
            apiKey={GOOGLE_MAPS_API_KEY}
          />
        </View>
      </View>

      {/* Destination input */}
      <View style={[styles.inputGroup, { zIndex: 1 }]}>
        <View style={styles.inputLabel}>
          <Navigation size={16} color={colors.primary} />
          <Text style={styles.inputLabelText}>Dropoff</Text>
        </View>
        <CityAutocomplete
          placeholder="City or address"
          value={destination}
          onChangeText={setDestination}
          onSelected={setDestination}
          apiKey={GOOGLE_MAPS_API_KEY}
        />
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {editingId && (
          <TouchableOpacity style={styles.cancelBtn} onPress={resetForm}>
            <X size={16} color={colors.textSecondary} />
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={onSave}
          disabled={saving}
        >
          {editingId ? (
            <Pencil size={16} color={colors.textInverse} />
          ) : (
            <Plus size={16} color={colors.textInverse} />
          )}
          <Text style={styles.saveBtnText}>
            {editingId ? (saving ? 'Updating...' : 'Update Route') : (saving ? 'Adding...' : 'Add Route')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Saved routes */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} />
      ) : routes.length === 0 ? (
        <Text style={styles.empty}>No preferred routes yet.</Text>
      ) : (
        <View style={styles.routesList}>
          {routes.map(item => (
            <View key={item.id} style={styles.routeCard}>
              <View style={styles.routeInfo}>
                <Text style={styles.routeOrigin} numberOfLines={1}>{item.origin}</Text>
                <ArrowRight size={14} color={colors.textSecondary} style={{ marginHorizontal: 6 }} />
                <Text style={styles.routeDest} numberOfLines={1}>{item.destination}</Text>
              </View>
              <View style={styles.routeActions}>
                <TouchableOpacity style={styles.iconBtn} onPress={() => editRoute(item.id)} hitSlop={8}>
                  <Pencil size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={() => deleteRoute(item.id)} hitSlop={8}>
                  <Trash2 size={16} color="#DC2626" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: colors.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subheading: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 12,
  },
  inputLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  inputLabelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  saveBtnText: {
    color: colors.textInverse,
    fontWeight: '600',
    fontSize: 14,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: colors.bgSecondary,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  routesList: {
    marginTop: 16,
    gap: 8,
  },
  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.bgSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  routeInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  routeOrigin: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  routeDest: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  routeActions: {
    flexDirection: 'row',
    gap: 12,
    marginLeft: 10,
  },
  iconBtn: {
    padding: 6,
  },
  empty: {
    textAlign: 'center',
    marginTop: 20,
    color: colors.textSecondary,
    fontSize: 14,
  },
  });
}

export default DriverPreferredRoutesManager;
