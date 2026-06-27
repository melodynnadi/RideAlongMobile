import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Switch, Platform, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { firebaseAuth, firestore } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { roleKey } from '@/src/utils/roleIdentity';
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

  const submitFlag = async () => {
    if (submitting) return;
    const user = firebaseAuth.currentUser;
    if (!user) { Alert.alert('Sign in required', 'You need to sign in to flag a ride.'); return; }
    if (!rideId) { Alert.alert('Ride not found', 'No ride selected.'); return; }
    setSubmitting(true);
    try {
      const rideSnap = await getDoc(doc(firestore, 'confirmedRides', rideId));
      if (!rideSnap.exists()) throw new Error('Ride not found');
      const ride = rideSnap.data() as any;

      const postingId = ride?.ridePostingId;
      let allRideIds   = [rideId];
      let allRiderIds  = [ride?.riderId ?? ride?.userId ?? null];
      let allRiderNames = [ride?.riderName ?? 'Passenger'];

      if (postingId) {
        try {
          const groupSnap = await getDocs(query(
            collection(firestore, 'confirmedRides'),
            where('ridePostingId', '==', postingId),
            where('driverId', '==', ride.driverId)
          ));
          allRideIds = []; allRiderIds = []; allRiderNames = [];
          groupSnap.forEach((d) => {
            allRideIds.push(d.id);
            const data = d.data();
            allRiderIds.push(data?.riderId ?? data?.userId ?? null);
            allRiderNames.push(data?.riderName ?? 'Passenger');
          });
        } catch (e) { console.warn('Could not fetch group rides for flagging', e); }
      }

      for (let i = 0; i < allRideIds.length; i++) {
        const rid = allRideIds[i];
        const flagDocId = `${rid}_${role}`;
        const thisRideSnap = await getDoc(doc(firestore, 'confirmedRides', rid));
        const thisRide = thisRideSnap.exists() ? thisRideSnap.data() : ride;
        const statusBeforeFlag = String(thisRide?.status || '').toUpperCase();
        const completedAtValue = thisRide?.completedAt;
        const completedAt = completedAtValue?.toDate
          ? completedAtValue.toDate()
          : completedAtValue
            ? new Date(completedAtValue)
            : null;
        const payoutHold = role === 'rider' && (
          statusBeforeFlag !== 'COMPLETED' ||
          (!!completedAt && !Number.isNaN(completedAt.getTime()) && Date.now() - completedAt.getTime() <= 24 * 60 * 60 * 1000)
        );
        await setDoc(doc(firestore, 'rideFlags', flagDocId), {
          rideId: rid, ridePostingId: postingId ?? null, isGroupRide: !!postingId,
          totalPassengers: allRideIds.length,
          riderId: thisRide?.riderId ?? thisRide?.userId ?? null,
          riderName: thisRide?.riderName ?? 'Passenger',
          driverId: thisRide?.driverId ?? null, driverName: thisRide?.driverName ?? 'Driver',
          statusBeforeFlag: thisRide?.status ?? null,
          statusAtFlag: thisRide?.status ?? null,
          pickup: thisRide?.pickup ?? null, dropoff: thisRide?.dropoff ?? null,
          date: thisRide?.date ?? null, time: thisRide?.time ?? null,
          reason, details: details.trim(),
          severity: severityHigh ? 'high' : 'normal',
          attachments: [], flaggedByRole: role, reviewStatus: 'open',
          updatedAt: serverTimestamp(), createdAt: serverTimestamp(),
        } as any, { merge: true });
        await updateDoc(doc(firestore, 'confirmedRides', rid), {
          status: 'FLAGGED',
          statusBeforeFlag: thisRide?.status ?? 'IN_PROGRESS',
          statusAtFlag: thisRide?.status ?? 'IN_PROGRESS',
          ...(payoutHold ? { payoutHold: true } : {}),
          updatedAt: serverTimestamp(),
        });
      }

      try {
        if (ride?.driverId) {
          await addDoc(collection(firestore, 'notifications'), {
            userId: ride.driverId, type: 'ride_flagged',
            recipientId: ride.driverId,
            recipientRole: 'driver',
            recipientKeys: [roleKey('driver', ride.driverId)],
            driverId: ride.driverId,
            title: postingId ? 'Group Ride Flagged' : 'Ride Flagged',
            message: postingId
              ? `Your group ride with ${allRiderNames.join(', ')} has been flagged and requires admin review.`
              : `Your ride with ${allRiderNames[0]} has been flagged and requires admin review.`,
            rideId: allRideIds[0], ridePostingId: postingId ?? null,
            severity: 'high', read: false, createdAt: serverTimestamp(),
          });
        }
      } catch (e) { console.warn('Failed to send driver notification', e); }

      try {
        await addDoc(collection(firestore, 'adminNotifications'), {
          type: 'ride_flag',
          title: postingId ? 'Group Ride Flagged' : 'Ride Flagged',
          message: `A ${postingId ? 'group ride' : 'ride'} has been flagged by ${role}. Reason: ${reason}`,
          rideIds: allRideIds, ridePostingId: postingId ?? null,
          flaggedByRole: role, flaggedById: user.uid,
          reason, details: details.trim(),
          driverId: ride?.driverId ?? null, driverName: ride?.driverName ?? 'Driver',
          riderIds: allRiderIds.filter(Boolean), riderNames: allRiderNames,
          severity: 'high', status: 'pending', read: false, createdAt: serverTimestamp(),
        });
      } catch (e) { console.warn('Failed to send admin notification', e); }

      if (postingId && allRiderIds.length > 1) {
        for (let i = 0; i < allRiderIds.length; i++) {
          const riderId = allRiderIds[i];
          if (!riderId || riderId === user.uid) continue;
          try {
            await addDoc(collection(firestore, 'notifications'), {
              userId: riderId, type: 'ride_flagged', title: 'Group Ride Flagged',
              recipientId: riderId,
              recipientRole: 'rider',
              recipientKeys: [roleKey('rider', riderId)],
              riderId,
              message: 'Your group ride has been flagged and requires admin review.',
              rideId: allRideIds[i], ridePostingId: postingId,
              severity: 'high', read: false, createdAt: serverTimestamp(),
            });
          } catch (e) { console.warn(`Failed to notify rider ${riderId}`, e); }
        }
      }

      try { onFlagged?.(rideId); } catch {}
      void logActivity({
        type: 'ride_flagged', entityType: 'ride', entityId: rideId,
        metadata: { rideId, reason, severity: severityHigh ? 'high' : 'normal', flaggedRides: allRideIds.length, isGroupRide: !!postingId },
      });

      Alert.alert(
        postingId ? 'Group ride flagged' : 'Ride flagged',
        postingId
          ? `All ${allRideIds.length} rides have been flagged for review.`
          : 'Thank you — the ride has been flagged for admin review.',
        [{ text: 'OK', onPress: () => onClose() }]
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not submit flag');
      setSubmitting(false);
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

export default FlagRideModal;
