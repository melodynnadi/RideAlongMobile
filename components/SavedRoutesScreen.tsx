import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CityAutocomplete } from '@/components/CityAutocomplete';
import KeyboardAwareModalView from '@/components/KeyboardAwareModalView';
import { GOOGLE_MAPS_API_KEY } from '@/constants/services';
import { PreferredRoute, usePreferredRoutesStore } from '@/stores/preferredRoutesStore';
import { useReturnNavigation } from '@/src/hooks/useReturnNavigation';
import { hitSlop, layout } from '@/theme/designSystem';
import { useAppTheme } from '@/hooks/ThemeContext';

function displayLocation(value: string) {
  return value.replace(/(^|[\s,-])([a-z])/g, (_, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

function locationParts(value: string) {
  const segments = value.split(',').map((part) => part.trim()).filter(Boolean);
  const last = segments.at(-1)?.toLowerCase();
  if (last === 'usa' || last === 'united states') segments.pop();

  const state = segments.at(-1) || '';
  const city = segments.at(-2) || '';
  const hasCityState = segments.length >= 3 && /^[a-z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i.test(state);

  if (!hasCityState) return { primary: displayLocation(value), secondary: null };

  const stateParts = state.split(/\s+/);
  const stateCode = stateParts.shift()?.toUpperCase() || '';
  return {
    primary: displayLocation(segments.slice(0, -2).join(', ')),
    secondary: `${displayLocation(city)}, ${stateCode}${stateParts.length ? ` ${stateParts.join(' ')}` : ''}`,
  };
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    root: { flex: 1, alignItems: 'center', backgroundColor: colors.bg },
    safe: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, backgroundColor: colors.bg },
    content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingBottom: 36 },
    flex: { flex: 1 },
    header: { position: 'relative', minHeight: 64, flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center'},
    headerTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.25, flex: 1, marginLeft: 12 },
    introCard: { borderRadius: 18, backgroundColor: colors.primaryDim, flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, marginBottom: 24 },
    introIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    introTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 3 },
    introText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
    sectionHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    sectionTitle: { color: colors.textPrimary, fontSize: 19, lineHeight: 25, fontWeight: '700' },
    routeCount: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    addButton: { minHeight: 42, borderRadius: 21, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 15 },
    addButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
    stateCard: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10 },
    stateText: { color: colors.textSecondary, fontSize: 13 },
    emptyState: { minHeight: 250, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
    emptyIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
    emptyTitle: { color: colors.textPrimary, fontSize: 18, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
    emptyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, maxWidth: 290 },
    emptyButton: { minHeight: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, marginTop: 18 },
    emptyButtonText: { color: colors.textInverse, fontSize: 13, fontWeight: '700' },
    routeList: { gap: 12 },
    routeCard: { minHeight: 154, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, flexDirection: 'row', padding: 16 },
    routeCardDuplicate: { borderColor: colors.primary },
    routeRail: { width: 18, alignItems: 'center', paddingTop: 8, paddingBottom: 9, marginRight: 10 },
    originDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.textPrimary },
    routeLine: { flex: 1, width: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: colors.border, marginVertical: 5 },
    destinationDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
    routeCopy: { flex: 1, paddingRight: 8 },
    locationLabel: { color: colors.textSecondary, fontSize: 9, lineHeight: 13, letterSpacing: 1.2, fontWeight: '700' },
    destinationLabel: { marginTop: 12 },
    locationText: { color: colors.textPrimary, fontSize: 14, lineHeight: 19, fontWeight: '600', marginTop: 2 },
    locationSecondary: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
    routeActions: { justifyContent: 'space-between', marginLeft: 4 },
    iconButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center' },
    deleteIconButton: { backgroundColor: colors.redDim },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(21,35,58,0.35)', justifyContent: 'flex-end' },
    modalSheet: { maxHeight: '92%' as any, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: colors.bg, paddingTop: 10, overflow: 'hidden' },
    modalContent: { paddingHorizontal: 20, paddingBottom: 30 },
    modalHandle: { width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 18 },
    modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 22 },
    modalTitle: { color: colors.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '700' },
    modalSubtitle: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
    modalClose: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
    fieldLabel: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, letterSpacing: 1.3, fontWeight: '700', marginBottom: 7 },
    autocompleteTop: { minHeight: 48, zIndex: 20, marginBottom: 16 },
    autocompleteBottom: { minHeight: 48, zIndex: 10, marginBottom: 24 },
    saveButton: { minHeight: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
    buttonDisabled: { opacity: 0.5 },
    saveButtonText: { color: colors.textInverse, fontSize: 15, fontWeight: '700' },
  });
}

export default function SavedRoutesScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { goBack } = useReturnNavigation('/(rider)/profile');
  const { routes, loading, isSaving, error, duplicateRouteId, loadRoutes, addRoute, updateRoute, deleteRoute, clearError } = usePreferredRoutesStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PreferredRoute | null>(null);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');

  useEffect(() => { void loadRoutes(); }, [loadRoutes]);

  useEffect(() => {
    if (!error) return;
    Alert.alert('Saved routes', error, [{ text: 'OK', onPress: clearError }]);
  }, [clearError, error]);

  const closeModal = () => {
    if (isSaving) return;
    setModalOpen(false);
    setEditing(null);
    setOrigin('');
    setDestination('');
  };

  const openAdd = () => {
    setEditing(null);
    setOrigin('');
    setDestination('');
    setModalOpen(true);
  };

  const openEdit = (route: PreferredRoute) => {
    setEditing(route);
    setOrigin(route.origin);
    setDestination(route.destination);
    setModalOpen(true);
  };

  const save = async () => {
    if (!origin.trim() || !destination.trim()) {
      Alert.alert('Missing route', 'Enter both a starting point and destination.');
      return;
    }
    if (origin.trim().toLowerCase() === destination.trim().toLowerCase()) {
      Alert.alert('Choose two locations', 'Your starting point and destination must be different.');
      return;
    }

    if (editing) {
      await updateRoute(editing.id, origin, destination);
      if (!usePreferredRoutesStore.getState().error) closeModal();
      return;
    }

    const created = await addRoute(origin, destination);
    const state = usePreferredRoutesStore.getState();
    if (created?.duplicate || state.duplicateRouteId) {
      Alert.alert('Route already saved', 'You already receive alerts for this route.');
      return;
    }
    if (created && !state.error) closeModal();
  };

  const confirmDelete = (route: PreferredRoute) => {
    Alert.alert('Delete saved route?', `${displayLocation(route.origin)} to ${displayLocation(route.destination)} will no longer trigger matching ride alerts.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteRoute(route.id) },
    ]);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadRoutes()} tintColor={colors.primary} />}
        >
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to profile" hitSlop={hitSlop}>
              <Ionicons name="arrow-back" size={19} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Saved routes</Text>
          </View>

          <View style={styles.introCard}>
            <View style={styles.introIcon}><Ionicons name="notifications-outline" size={21} color={colors.primary} /></View>
            <View style={styles.flex}>
              <Text style={styles.introTitle}>Never miss a matching ride</Text>
              <Text style={styles.introText}>We use these routes to notify you when a rider or driver posts a matching trip.</Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <View style={styles.flex}><Text style={styles.sectionTitle}>Your routes</Text><Text style={styles.routeCount}>{routes.length} saved</Text></View>
            <TouchableOpacity style={styles.addButton} onPress={openAdd} accessibilityRole="button">
              <Ionicons name="add" size={18} color={colors.textInverse} />
              <Text style={styles.addButtonText}>Add route</Text>
            </TouchableOpacity>
          </View>

          {loading && routes.length === 0 ? (
            <View style={styles.stateCard}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>Loading saved routes...</Text></View>
          ) : routes.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}><Ionicons name="git-branch-outline" size={27} color={colors.primary} /></View>
              <Text style={styles.emptyTitle}>No saved routes yet</Text>
              <Text style={styles.emptyText}>Add a route you travel often and we'll let you know when a matching ride appears.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={openAdd}><Text style={styles.emptyButtonText}>Add your first route</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={styles.routeList}>
              {routes.map((route) => {
                const from = locationParts(route.origin);
                const to = locationParts(route.destination);
                return <View key={route.id} style={[styles.routeCard, duplicateRouteId === route.id && styles.routeCardDuplicate]}>
                  <View style={styles.routeRail}><View style={styles.originDot} /><View style={styles.routeLine} /><View style={styles.destinationDot} /></View>
                  <View style={styles.routeCopy}>
                    <Text style={styles.locationLabel}>FROM</Text>
                    <Text style={styles.locationText} numberOfLines={2}>{from.primary}</Text>
                    {from.secondary ? <Text style={styles.locationSecondary} numberOfLines={1}>{from.secondary}</Text> : null}
                    <Text style={[styles.locationLabel, styles.destinationLabel]}>TO</Text>
                    <Text style={styles.locationText} numberOfLines={2}>{to.primary}</Text>
                    {to.secondary ? <Text style={styles.locationSecondary} numberOfLines={1}>{to.secondary}</Text> : null}
                  </View>
                  <View style={styles.routeActions}>
                    <TouchableOpacity style={styles.iconButton} onPress={() => openEdit(route)} accessibilityLabel="Edit saved route"><Ionicons name="pencil-outline" size={18} color={colors.textPrimary} /></TouchableOpacity>
                    <TouchableOpacity style={[styles.iconButton, styles.deleteIconButton]} onPress={() => confirmDelete(route)} accessibilityLabel="Delete saved route"><Ionicons name="trash-outline" size={18} color={colors.red} /></TouchableOpacity>
                  </View>
                </View>;
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAwareModalView style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.modalHeader}>
                <View style={styles.flex}><Text style={styles.modalTitle}>{editing ? 'Edit saved route' : 'Add saved route'}</Text><Text style={styles.modalSubtitle}>Choose the route you want RideAlong to watch.</Text></View>
                <TouchableOpacity style={styles.modalClose} onPress={closeModal} hitSlop={hitSlop}><Ionicons name="close" size={20} color={colors.textPrimary} /></TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>STARTING POINT</Text>
              <View style={styles.autocompleteTop}><CityAutocomplete placeholder="City or address" value={origin} onChangeText={setOrigin} onSelected={setOrigin} apiKey={GOOGLE_MAPS_API_KEY} /></View>
              <Text style={styles.fieldLabel}>DESTINATION</Text>
              <View style={styles.autocompleteBottom}><CityAutocomplete placeholder="City or address" value={destination} onChangeText={setDestination} onSelected={setDestination} apiKey={GOOGLE_MAPS_API_KEY} /></View>

              <TouchableOpacity style={[styles.saveButton, isSaving && styles.buttonDisabled]} onPress={() => void save()} disabled={isSaving}>
                {isSaving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveButtonText}>{editing ? 'Update route' : 'Save route'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAwareModalView>
      </Modal>
    </View>
  );
}
