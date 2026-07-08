import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, ScrollView, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { firebaseAuth, getApiBaseUrl } from '@/constants/services';
import { useAppTheme } from '@/hooks/ThemeContext';

const ISSUE_TYPES = [
  { key: 'safety',        label: 'Safety concern',         icon: 'shield-outline' as const },
  { key: 'wrong_route',   label: 'Wrong route / detour',   icon: 'navigate-outline' as const },
  { key: 'uncomfortable', label: 'Uncomfortable situation', icon: 'alert-circle-outline' as const },
  { key: 'no_show',       label: 'Driver / rider no-show',  icon: 'person-remove-outline' as const },
  { key: 'payment',       label: 'Payment issue',           icon: 'card-outline' as const },
  { key: 'other',         label: 'Other',                   icon: 'ellipsis-horizontal-circle-outline' as const },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  confirmedRideId: string;
  reportedDuringRide?: boolean;
};

export function ReportIssueModal({ visible, onClose, confirmedRideId, reportedDuringRide = true }: Props) {
  const { colors } = useAppTheme();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const s = styles(colors);

  const handleSubmit = async () => {
    if (!selectedType) {
      Alert.alert('Select issue type', 'Please select what kind of issue you experienced.');
      return;
    }
    setSubmitting(true);
    try {
      const token = await firebaseAuth.currentUser?.getIdToken();
      const res = await fetch(`${getApiBaseUrl()}/api/ride-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ confirmedRideId, issueType: selectedType, description, reportedDuringRide }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to submit report');
      Alert.alert(
        'Report submitted',
        'Thanks for letting us know. Our team will review this and follow up if needed.',
        [{ text: 'OK', onPress: () => { setSelectedType(null); setDescription(''); onClose(); } }],
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Drag handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerIcon}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Report an Issue</Text>
              <Text style={s.subtitle}>Help us keep RideAlong safe</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.75}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
            {/* Issue type grid */}
            <Text style={s.sectionLabel}>What happened?</Text>
            <View style={s.typeGrid}>
              {ISSUE_TYPES.map((t) => {
                const active = selectedType === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    style={[s.typeCard, active && s.typeCardActive]}
                    onPress={() => setSelectedType(t.key)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={t.icon} size={20} color={active ? colors.primary : colors.textSecondary} />
                    <Text style={[s.typeLabel, active && s.typeLabelActive]}>{t.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Description */}
            <Text style={[s.sectionLabel, { marginTop: 18 }]}>
              Details <Text style={s.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={s.input}
              placeholder="Describe what happened..."
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
              textAlignVertical="top"
            />

            {selectedType === 'safety' && (
              <View style={s.safetyBanner}>
                <Ionicons name="warning-outline" size={16} color="#DC2626" />
                <Text style={s.safetyText}>If you're in immediate danger, call 911.</Text>
              </View>
            )}
          </ScrollView>

          {/* Submit */}
          <View style={s.footer}>
            <TouchableOpacity
              style={[s.submitBtn, (!selectedType || submitting) && s.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!selectedType || submitting}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={s.submitText}>Submit Report</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = (colors: any) => StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: 'rgba(15,23,42,0.48)', justifyContent: 'flex-end' },
  sheet:         { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', overflow: 'hidden' },
  handle:        { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 10 },
  header:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 },
  headerIcon:    { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title:         { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  subtitle:      { color: colors.textSecondary, fontSize: 12, fontWeight: '500', marginTop: 1 },
  closeBtn:      { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center' },
  body:          { paddingHorizontal: 20, paddingBottom: 12, gap: 0 },
  sectionLabel:  { fontSize: 13, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  optional:      { fontSize: 12, fontWeight: '500', color: colors.textSecondary, textTransform: 'none', letterSpacing: 0 },
  typeGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard:      { width: '48%', borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bgCard, padding: 14, gap: 8 },
  typeCardActive:{ borderColor: colors.primary, backgroundColor: colors.primaryDim },
  typeLabel:     { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  typeLabelActive:{ color: colors.primary },
  input:         { backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, fontSize: 15, color: colors.textPrimary, minHeight: 90, marginBottom: 12 },
  safetyBanner:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.08)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', padding: 12 },
  safetyText:    { flex: 1, fontSize: 13, color: '#DC2626' },
  footer:        { paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 30 : 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bg },
  submitBtn:     { minHeight: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  submitBtnDisabled: { opacity: 0.5 },
  submitText:    { color: '#FFF', fontSize: 15, fontWeight: '700' },
});
