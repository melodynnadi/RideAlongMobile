import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Switch, Platform, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { firebaseAuth, firestore, getApiBaseUrl } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { doc, getDoc } from 'firebase/firestore';
import { useAppTheme } from '@/hooks/ThemeContext';
import type { AppColors } from '@/constants/theme';

export type FlagRideModalProps = {
  visible: boolean;
  onClose: () => void;
  rideId: string | null;
  role?: 'driver' | 'rider';
  onFlagged?: (rideId: string) => void;
};

const REASONS = [
  { value: 'safety',            label: 'Safety' },
  { value: 'behavior',          label: 'Behavior' },
  { value: 'fare_route_dispute',label: 'Fare / Route dispute' },
  { value: 'vehicle_accident',  label: 'Vehicle / Accident' },
  { value: 'no_show',           label: 'No-show' },
  { value: 'lost_and_found',    label: 'Lost & found' },
  { value: 'other',             label: 'Other' },
] as const;

export function FlagRideModal({ visible, onClose, rideId, role = 'rider', onFlagged }: FlagRideModalProps) {
  const { colors } = useAppTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [reason, setReason]             = useState<string>('');
  const [details, setDetails]           = useState<string>('');
  const [severityHigh, setSeverityHigh] = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadExisting() {
      if (!visible || !rideId) return;
      setLoadingExisting(true);
      try {
        const snap = await getDoc(doc(firestore, 'rideFlags', `${rideId}_${role}`));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          if (data.reviewStatus === 'open') {
            setReason(data.reason || '');
            setDetails(data.details || '');
            setSeverityHigh((data.severity || 'normal') === 'high');
          }
        }
      } catch {}
      finally { if (active) setLoadingExisting(false); }
    }
    loadExisting();
    return () => { active = false; };
  }, [visible, rideId, role]);

  const valid = details.trim().length >= 20 && !!reason && REASONS.some((r) => r.value === reason) && !!rideId;
  const [isGroupRide, setIsGroupRide] = useState(false);
  const [groupPassengerCount, setGroupPassengerCount] = useState(1);

  // Detect group ride so we can show a warning
  useEffect(() => {
    if (!visible || !rideId) return;
    getDoc(doc(firestore, 'confirmedRides', rideId)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as any;
      if (d?.ridePostingId) {
        setIsGroupRide(true);
        // Best-effort count from totalSeats
        setGroupPassengerCount(Number(d?.totalSeats) || 2);
      }
    }).catch(() => {});
  }, [visible, rideId]);

  const doSubmitFlag = async () => {
    const user = firebaseAuth.currentUser;
    if (!user || !rideId) return;
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/rides/${encodeURIComponent(rideId)}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason, details: details.trim(), flaggedByRole: role, severity: severityHigh ? 'high' : 'normal' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Server error ${res.status}`);

      try { onFlagged?.(rideId); } catch {}
      void logActivity({ type: 'ride_flagged', entityType: 'ride', entityId: rideId, metadata: { rideId, reason, severity: severityHigh ? 'high' : 'normal', flaggedRides: body.flaggedRides, isGroupRide: body.isGroupRide } });

      Alert.alert(
        body.isGroupRide ? 'Group ride flagged' : 'Ride flagged',
        body.isGroupRide
          ? `All ${body.flaggedRides} rides have been frozen for admin review.`
          : 'Your report has been submitted. The ride is frozen until an admin resolves it.',
        [{ text: 'OK', onPress: () => onClose() }],
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not submit flag');
      setSubmitting(false);
    }
  };

  const submitFlag = () => {
    if (submitting || !valid) return;
    const user = firebaseAuth.currentUser;
    if (!user) { Alert.alert('Sign in required', 'You need to sign in to flag a ride.'); return; }

    // Group ride warning — flagging freezes ALL passengers, not just one
    if (isGroupRide) {
      Alert.alert(
        'Flag group ride?',
        `This will freeze the ride for all ${groupPassengerCount} passengers and require admin resolution before anyone can continue.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Flag all seats', style: 'destructive', onPress: doSubmitFlag },
        ],
      );
    } else {
      doSubmitFlag();
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={() => { if (!submitting) onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.overlay}>
        <View style={s.sheet}>

          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerIcon}>
              <Ionicons name="flag" size={18} color={colors.red} />
            </View>
            <Text style={s.title}>Flag Ride</Text>
            <TouchableOpacity onPress={() => { if (!submitting) onClose(); }} style={s.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {loadingExisting ? (
              <ActivityIndicator color={colors.primary} style={{ marginBottom: 16 }} />
            ) : null}

            {/* Reason */}
            <Text style={s.label}>What happened?</Text>
            <View style={s.pillRow}>
              {REASONS.map((r) => (
                <TouchableOpacity
                  key={r.value}
                  style={[s.pill, reason === r.value && s.pillSelected]}
                  onPress={() => setReason(r.value)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.pillText, reason === r.value && s.pillTextSelected]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Details */}
            <Text style={[s.label, { marginTop: 20 }]}>Details</Text>
            <TextInput
              style={s.textarea}
              multiline
              editable={!submitting}
              value={details}
              onChangeText={(t) => setDetails(t.slice(0, 1000))}
              placeholder="Describe what happened (min 20 characters)..."
              placeholderTextColor={colors.textSecondary}
              textAlignVertical="top"
            />
            <Text style={s.charCount}>{details.trim().length} / 1000</Text>

            {/* Severity */}
            <View style={s.severityRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>High severity</Text>
                <Text style={s.severityHint}>Safety risk or emergency situation</Text>
              </View>
              <Switch
                value={severityHigh}
                onValueChange={setSeverityHigh}
                disabled={submitting}
                trackColor={{ false: colors.border, true: colors.redBorder }}
                thumbColor={severityHigh ? colors.red : colors.bgCard}
              />
            </View>

            {/* Actions */}
            <View style={s.actions}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => { if (!submitting) onClose(); }}
                disabled={submitting}
                activeOpacity={0.75}
              >
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.submitBtn, (!valid || submitting) && s.submitBtnDisabled]}
                onPress={submitFlag}
                disabled={!valid || submitting}
                activeOpacity={0.85}
              >
                {submitting
                  ? <ActivityIndicator size="small" color={colors.textInverse} />
                  : <Text style={s.submitBtnText}>Submit</Text>}
              </TouchableOpacity>
            </View>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: AppColors) {
  return StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36, maxHeight: '90%' },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },

  header:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
  headerIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.redDim, alignItems: 'center', justifyContent: 'center' },
  title:      { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  closeBtn:   { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },

  body:       { padding: 20, paddingBottom: 8 },

  label:      { color: colors.textPrimary, fontSize: 13, fontWeight: '700', marginBottom: 10, letterSpacing: 0.1 },

  pillRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:       { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard },
  pillSelected:     { backgroundColor: colors.redDim, borderColor: colors.red },
  pillText:         { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  pillTextSelected: { color: colors.red, fontWeight: '700' },

  textarea:   { minHeight: 110, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, fontSize: 14, color: colors.textPrimary, backgroundColor: colors.bgCard, lineHeight: 20 },
  charCount:  { color: colors.textSecondary, fontSize: 11, fontWeight: '500', marginTop: 6, textAlign: 'right' },

  severityRow:  { flexDirection: 'row', alignItems: 'center', marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border },
  severityHint: { color: colors.textSecondary, fontSize: 12, fontWeight: '500', marginTop: 2 },

  actions:    { flexDirection: 'row', gap: 10, marginTop: 24 },
  cancelBtn:  { flex: 1, paddingVertical: 14, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard, alignItems: 'center' },
  cancelBtnText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  submitBtn:  { flex: 1, paddingVertical: 14, borderRadius: 24, backgroundColor: colors.red, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  });
}

// ─── Post-flag banner shown on ride cards when status=FLAGGED ─────────────────
type FlaggedBannerProps = {
  rideId: string;
  role: 'driver' | 'rider';
  colors: AppColors;
  onUnflagged?: () => void;
};

export function FlaggedRideBanner({ rideId, role, colors, onUnflagged }: FlaggedBannerProps) {
  const [canUnflag, setCanUnflag] = useState(false);
  const [unflagging, setUnflagging] = useState(false);

  useEffect(() => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    // Check if current user is the flagger and within the 5-min window
    getDoc(doc(firestore, 'rideFlags', `${rideId}_${role}`)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data() as any;
      if (d?.flaggedById === uid && d?.reviewStatus === 'open') {
        const flaggedAtMs = d?.flaggedAtMs || 0;
        setCanUnflag(Date.now() - flaggedAtMs < 5 * 60 * 1000);
      }
    }).catch(() => {});
  }, [rideId, role]);

  const handleUnflag = async () => {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    Alert.alert('Retract flag?', 'This will remove your flag and unfreeze the ride.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Retract', style: 'destructive', onPress: async () => {
        setUnflagging(true);
        try {
          const token = await user.getIdToken();
          const base = getApiBaseUrl();
          const res = await fetch(`${base}/api/rides/${encodeURIComponent(rideId)}/unflag`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ flaggedByRole: role }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || 'Failed to retract flag');
          setCanUnflag(false);
          onUnflagged?.();
        } catch (e: any) {
          Alert.alert('Error', e?.message || 'Could not retract flag');
        } finally {
          setUnflagging(false);
        }
      }},
    ]);
  };

  return (
    <View style={{ backgroundColor: colors.redDim, borderRadius: 12, padding: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ionicons name="flag" size={16} color={colors.red} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.red, fontWeight: '700', fontSize: 13 }}>Under admin review</Text>
        <Text style={{ color: colors.red, fontSize: 12, marginTop: 2, opacity: 0.85 }}>
          No ride actions can be taken until an admin resolves this flag.
        </Text>
      </View>
      {canUnflag && (
        <TouchableOpacity onPress={handleUnflag} disabled={unflagging} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.red }}>
          {unflagging
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Retract</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default FlagRideModal;
