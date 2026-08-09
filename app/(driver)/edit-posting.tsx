import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from '@/constants/services';
import { useAppTheme } from '@/hooks/ThemeContext';

export default function EditPostingScreen() {
  const { colors } = useAppTheme();
  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    safe: { flex: 1 },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 20, paddingBottom: 24 },
    loadingScreen: {
      flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
    },
    header: {
      minHeight: 64, flexDirection: 'row', alignItems: 'center',
      paddingTop: 8, paddingBottom: 10,
    },
    backBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    },
    headerTitle: {
      flex: 1, marginLeft: 12, color: colors.textPrimary,
      fontSize: 24, lineHeight: 30, fontWeight: '700',
    },
    intro: {
      marginTop: 2, marginBottom: 18, color: colors.textSecondary,
      fontSize: 14, lineHeight: 20,
    },
    section: {
      width: '100%', marginBottom: 14, padding: 16, gap: 14,
      backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
      borderRadius: 18, shadowColor: colors.textPrimary, shadowOpacity: 0.04,
      shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1,
    },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    sectionHeadingText: { flex: 1, minWidth: 0, justifyContent: 'center' },
    sectionIcon: {
      width: 38, height: 38, borderRadius: 19,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.primaryDim,
    },
    sectionTitle: { color: colors.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: '700' },
    sectionSubtitle: { marginTop: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
    field: { gap: 7 },
    fieldLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
    inputShell: {
      minHeight: 50, flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.bgCard, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border,
    },
    inputShellMultiline: { minHeight: 106, alignItems: 'flex-start' },
    inputIcon: { marginLeft: 13 },
    inputIconMultiline: { marginTop: 15 },
    prefix: { marginLeft: 9, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    input: {
      flex: 1, minWidth: 0, paddingHorizontal: 11, paddingVertical: 12,
      color: colors.textPrimary, fontSize: 15, lineHeight: 20,
    },
    inputMultiline: {
      minHeight: 104, paddingTop: 13, paddingBottom: 13, textAlignVertical: 'top',
    },
    footer: {
      paddingHorizontal: 20, paddingTop: 10,
      backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
    },
    saveBtn: {
      minHeight: 52, flexDirection: 'row', alignItems: 'center',
      justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 26,
    },
    saveBtnText: { color: colors.textInverse, fontSize: 16, fontWeight: '700' },
    buttonDisabled: { opacity: 0.65 },
  }), [colors]);
  const { postingId } = useLocalSearchParams<{ postingId: string }>();
  // navigate, not replace or dismissTo: avoids leaving a stale duplicate
  // screen mounted, without dismissTo's silent no-op when crossing into a
  // different tab navigator (same issue as the settings-tab back navigation
  // bug — see useReturnNavigation.ts).
  const handleBack = () => router.navigate('/(driver)/my-postings' as any);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [seats, setSeats] = useState('1');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!postingId) {
      setFetching(false);
      return;
    }

    getDoc(doc(firestore, 'ridePostings', postingId))
      .then((snap) => {
        if (snap.exists()) {
          const ride = snap.data() as any;
          setDate(ride.date || '');
          setTime(ride.time || '');
          setSeats(String(ride.availableSeats ?? ride.seats ?? 1));
          setPrice(String(ride.pricePerSeat ?? ride.contributionAmount ?? ''));
          setNotes(ride.notes || '');
        }
      })
      .catch(() => {
        Alert.alert('Ride unavailable', 'The ride details could not be loaded.');
      })
      .finally(() => setFetching(false));
  }, [postingId]);

  const save = async () => {
    if (!postingId) return;

    const priceNum = Number.parseFloat(price);
    const seatsNum = Number.parseInt(seats, 10);

    if (!Number.isFinite(seatsNum) || seatsNum < 1) {
      Alert.alert('Invalid seats', 'Enter at least one available seat.');
      return;
    }
    if (seatsNum > 2) {
      Alert.alert('Too many seats', 'Maximum 2 seats per ride.');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      Alert.alert('Invalid price', 'Enter a valid price per seat.');
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(firestore, 'ridePostings', postingId), {
        date: date.trim() || null,
        time: time.trim() || null,
        availableSeats: seatsNum,
        seats: seatsNum,
        pricePerSeat: priceNum,
        contributionAmount: priceNum,
        notes: notes.trim() || null,
        updatedAt: serverTimestamp(),
      });
      Alert.alert('Ride updated', 'Your changes have been saved.', [
        { text: 'Done', onPress: handleBack },
      ]);
    } catch {
      Alert.alert('Error', 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (fetching) {
    return (
      <SafeAreaView style={s.loadingScreen} edges={['top', 'left', 'right']}>
        <StatusBar style={colors.statusBar === 'dark-content' ? 'dark' : 'light'} />
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style={colors.statusBar === 'dark-content' ? 'dark' : 'light'} />
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={s.header}>
            <TouchableOpacity
              style={s.backBtn}
              onPress={handleBack}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Edit Ride</Text>
          </View>

          <Text style={s.intro}>
            Update the details riders will see for this posting.
          </Text>

          <View style={s.section}>
            <View style={s.sectionHeading}>
              <View style={s.sectionIcon}>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              </View>
              <View style={s.sectionHeadingText}>
                <Text style={s.sectionTitle}>Schedule</Text>
                <Text style={s.sectionSubtitle}>When the ride will leave</Text>
              </View>
            </View>
            <Field
              label="Date"
              icon="calendar-clear-outline"
              value={date}
              onChangeText={setDate}
              placeholder="June 25, 2026"
            />
            <Field
              label="Time"
              icon="time-outline"
              value={time}
              onChangeText={setTime}
              placeholder="9:00 AM"
            />
          </View>

          <View style={s.section}>
            <View style={s.sectionHeading}>
              <View style={s.sectionIcon}>
                <Ionicons name="people-outline" size={18} color={colors.primary} />
              </View>
              <View style={s.sectionHeadingText}>
                <Text style={s.sectionTitle}>Seats and price</Text>
                <Text style={s.sectionSubtitle}>Availability for each rider</Text>
              </View>
            </View>
            <Field
              label="Seats available (max 2)"
              icon="people-outline"
              value={seats}
              onChangeText={(v) => {
                const n = Number.parseInt(v, 10);
                if (v === '' || (Number.isFinite(n) && n <= 2)) setSeats(v);
              }}
              placeholder="1"
              keyboardType="number-pad"
            />
            <Field
              label="Price per seat"
              icon="cash-outline"
              value={price}
              onChangeText={setPrice}
              placeholder="0.00"
              keyboardType="decimal-pad"
              prefix="$"
            />
          </View>

          <View style={s.section}>
            <View style={s.sectionHeading}>
              <View style={s.sectionIcon}>
                <Ionicons name="document-text-outline" size={18} color={colors.primary} />
              </View>
              <View style={s.sectionHeadingText}>
                <Text style={s.sectionTitle}>Ride notes</Text>
                <Text style={s.sectionSubtitle}>Optional details for riders</Text>
              </View>
            </View>
            <Field
              label="Notes"
              icon="create-outline"
              value={notes}
              onChangeText={setNotes}
              placeholder="Add pickup details or anything riders should know"
              multiline
            />
          </View>
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={s.footer}>
          <TouchableOpacity
            style={[s.saveBtn, saving && s.buttonDisabled]}
            onPress={save}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                <Text style={s.saveBtnText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  prefix,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  multiline?: boolean;
  prefix?: string;
}) {
  const { colors } = useAppTheme();
  const fs = useMemo(() => StyleSheet.create({
    field: { gap: 7 },
    fieldLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
    inputShell: {
      minHeight: 50, flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.bgCard, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border,
    },
    inputShellMultiline: { minHeight: 106, alignItems: 'flex-start' },
    inputIcon: { marginLeft: 13 },
    inputIconMultiline: { marginTop: 15 },
    prefix: { marginLeft: 9, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
    input: {
      flex: 1, minWidth: 0, paddingHorizontal: 11, paddingVertical: 12,
      color: colors.textPrimary, fontSize: 15, lineHeight: 20,
    },
    inputMultiline: {
      minHeight: 104, paddingTop: 13, paddingBottom: 13, textAlignVertical: 'top',
    },
  }), [colors]);
  return (
    <View style={fs.field}>
      <Text style={fs.fieldLabel}>{label}</Text>
      <View style={[fs.inputShell, multiline && fs.inputShellMultiline]}>
        <Ionicons
          name={icon}
          size={18}
          color={colors.textSecondary}
          style={[fs.inputIcon, multiline && fs.inputIconMultiline]}
        />
        {prefix ? <Text style={fs.prefix}>{prefix}</Text> : null}
        <TextInput
          style={[fs.input, multiline && fs.inputMultiline]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={keyboardType}
          multiline={multiline}
          selectionColor={colors.primary}
          autoCapitalize={keyboardType ? 'none' : 'sentences'}
        />
      </View>
    </View>
  );
}










