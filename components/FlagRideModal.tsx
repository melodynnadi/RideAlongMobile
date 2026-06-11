import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Alert, Switch, Platform, KeyboardAvoidingView, ScrollView } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmergencyButton } from '@/components/EmergencyButton';
import { firebaseAuth, firestore } from '@/constants/services';
import { logActivity } from '@/utils/activityLogger';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, query, where, getDocs, addDoc } from 'firebase/firestore';

export type FlagRideModalProps = {
  visible: boolean;
  onClose: () => void;
  rideId: string | null;
  onFlagged?: (rideId: string) => void; // optimistic update callback
};

const REASONS = [
  { value: 'safety', label: 'Safety' },
  { value: 'behavior', label: 'Behavior' },
  { value: 'fare_route_dispute', label: 'Fare/Route dispute' },
  { value: 'vehicle_accident', label: 'Vehicle/Accident' },
  { value: 'no_show', label: 'No-show' },
  { value: 'lost_and_found', label: 'Lost & found' },
  { value: 'other', label: 'Other' },
] as const;

export function FlagRideModal({ visible, onClose, rideId, onFlagged }: FlagRideModalProps) {
  const theme = useTheme();
  // prefer a light, neutral modal background to avoid the dark-blue card color
 const modalContentStyle = [styles.modalContent, { backgroundColor: (theme?.colors?.bg || '#FFFFFF') }];
  const cardBodyStyle = [styles.body, { backgroundColor: (theme?.colors?.bg || '#FFFFFF') }];
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState<string>('');
  const [severityHigh, setSeverityHigh] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingLoaded, setExistingLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadExisting() {
      if (!visible || !rideId) return;
      setExistingLoaded(false);
      setLoadingExisting(true);
      try {
        const id = `${rideId}_rider`;
        const snap = await getDoc(doc(firestore, 'rideFlags', id));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          if (data.reviewStatus === 'open') {
            setReason(data.reason || '');
            setDetails(data.details || '');
            setSeverityHigh((data.severity || 'normal') === 'high');
          }
        }
      } catch (e) {
        // ignore load errors, keep form empty
      } finally {
        if (active) {
          setLoadingExisting(false);
          setExistingLoaded(true);
        }
      }
    }
    loadExisting();
    return () => { active = false; };
  }, [visible, rideId]);

  const valid = details.trim().length >= 20 && !!reason && REASONS.some((r) => r.value === reason) && !!rideId;

  const showSignInPrompt = () => {
    Alert.alert('Sign in required', 'You need to sign in to flag a ride.');
  };

  const submitFlag = async () => {
    if (submitting) return;
    const user = firebaseAuth.currentUser;
    if (!user) { showSignInPrompt(); return; }
    if (!rideId) { Alert.alert('Ride not found', 'No ride selected.'); return; }
    setSubmitting(true);
    try {
      const rideSnap = await getDoc(doc(firestore, 'confirmedRides', rideId));
      if (!rideSnap.exists()) throw new Error('Ride not found');
      const ride = rideSnap.data() as any;

      const postingId = ride?.ridePostingId;
      let allRideIds = [rideId];
      let allRiderIds = [ride?.riderId ?? ride?.userId ?? null];
      let allRiderNames = [ride?.riderName ?? 'Passenger'];

      if (postingId) {
        try {
          const groupQuery = query(
            collection(firestore, 'confirmedRides'),
            where('ridePostingId', '==', postingId),
            where('driverId', '==', ride.driverId)
          );
          const groupSnap = await getDocs(groupQuery);
          allRideIds = []; allRiderIds = []; allRiderNames = [];
          groupSnap.forEach((d) => {
            allRideIds.push(d.id);
            const data = d.data();
            allRiderIds.push(data?.riderId ?? data?.userId ?? null);
            allRiderNames.push(data?.riderName ?? 'Passenger');
          });
        } catch (e) {
          console.warn('Could not fetch group rides for flagging', e);
        }
      }

      for (let i = 0; i < allRideIds.length; i++) {
        const rid = allRideIds[i];
        const flagDocId = `${rid}_rider`;
        const thisRideSnap = await getDoc(doc(firestore, 'confirmedRides', rid));
        const thisRide = thisRideSnap.exists() ? thisRideSnap.data() : ride;
        const payload = {
          rideId: rid, ridePostingId: postingId ?? null, isGroupRide: !!postingId,
          totalPassengers: allRideIds.length,
          riderId: thisRide?.riderId ?? thisRide?.userId ?? null,
          riderName: thisRide?.riderName ?? 'Passenger',
          driverId: thisRide?.driverId ?? null, driverName: thisRide?.driverName ?? 'Driver',
          statusAtFlag: thisRide?.status ?? null,
          pickup: thisRide?.pickup ?? null, dropoff: thisRide?.dropoff ?? null,
          date: thisRide?.date ?? null, time: thisRide?.time ?? null,
          reason, details: details.trim(),
          severity: severityHigh ? 'high' : 'normal',
          attachments: [], flaggedByRole: 'rider', reviewStatus: 'open',
          updatedAt: serverTimestamp(), createdAt: serverTimestamp(),
        } as any;
        await setDoc(doc(firestore, 'rideFlags', flagDocId), payload, { merge: true });
        await updateDoc(doc(firestore, 'confirmedRides', rid), {
          status: 'FLAGGED', statusAtFlag: thisRide?.status ?? 'IN_PROGRESS', updatedAt: serverTimestamp(),
        });
      }

      // Notify driver
      try {
        if (ride?.driverId) {
          await addDoc(collection(firestore, 'notifications'), {
            userId: ride.driverId, type: 'ride_flagged',
            title: postingId ? 'Group Ride Flagged' : 'Ride Flagged',
            message: postingId
              ? `Your group ride with ${allRiderNames.join(', ')} has been flagged and requires admin review.`
              : `Your ride with ${allRiderNames[0]} has been flagged and requires admin review.`,
            rideId: allRideIds[0], ridePostingId: postingId ?? null,
            severity: 'high', read: false, createdAt: serverTimestamp(),
          });
        }
      } catch (e) { console.warn('Failed to send driver notification', e); }

      // Notify admin
      try {
        await addDoc(collection(firestore, 'adminNotifications'), {
          type: 'ride_flag',
          title: postingId ? 'Group Ride Flagged' : 'Ride Flagged',
          message: `A ${postingId ? 'group ride' : 'ride'} has been flagged by rider. Reason: ${reason}`,
          rideIds: allRideIds, ridePostingId: postingId ?? null,
          flaggedByRole: 'rider', flaggedById: user.uid,
          reason, details: details.trim(),
          driverId: ride?.driverId ?? null, driverName: ride?.driverName ?? 'Driver',
          riderIds: allRiderIds.filter(Boolean), riderNames: allRiderNames,
          severity: 'high', status: 'pending', read: false, createdAt: serverTimestamp(),
        });
      } catch (e) { console.warn('Failed to send admin notification', e); }

      // Notify other passengers in group
      if (postingId && allRiderIds.length > 1) {
        for (let i = 0; i < allRiderIds.length; i++) {
          const riderId = allRiderIds[i];
          if (!riderId || riderId === user.uid) continue;
          try {
            await addDoc(collection(firestore, 'notifications'), {
              userId: riderId, type: 'ride_flagged', title: 'Group Ride Flagged',
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

      if (postingId) {
        Alert.alert('Group Ride Flagged',
          `All ${allRideIds.length} passengers have been flagged. Admin will review this case.`,
          [{ text: 'OK', onPress: () => onClose() }]
        );
      } else {
        Alert.alert('Flag submitted', 'Thank you — the ride has been flagged for review.',
          [{ text: 'OK', onPress: () => onClose() }]
        );
      }
    } catch (err: any) {
      const msg = err?.message ?? 'Could not submit flag';
      Alert.alert('Error', msg);
      setSubmitting(false);
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={() => { if (!submitting) onClose(); }}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={modalContentStyle}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Flag Ride</Text>
            <TouchableOpacity onPress={() => { if (!submitting) onClose(); }} style={styles.closeButton} accessibilityLabel="Close flag modal">
              <X size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
            <Card style={cardBodyStyle}>
            {/* Emergency Call Button */}
            <EmergencyButton />
            
            {loadingExisting && <ActivityIndicator />}
            <Text style={styles.label}>Reason</Text>
            <View style={styles.reasonRow}>
              {REASONS.map((r) => (
                <TouchableOpacity key={r.value} style={[styles.reasonPill, reason === r.value && styles.reasonPillSelected]} onPress={() => setReason(r.value)} accessibilityRole="button" accessibilityLabel={`Reason: ${r.label}`}>
                  <Text style={[styles.reasonText, reason === r.value && styles.reasonTextSelected]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Details</Text>
            <TextInput
              style={styles.textArea}
              multiline
              editable={!submitting}
              value={details}
              onChangeText={setDetails}
              placeholder="Describe what happened (min 20 characters)"
              accessibilityLabel="Flag details"
            />
            <Text style={styles.hint}>{details.trim().length} / 1000</Text>

            <View style={styles.rowBetweenAlign}>
              <Text style={styles.label}>Emergency (high severity)</Text>
              <Switch value={severityHigh} onValueChange={setSeverityHigh} disabled={submitting} />
            </View>

            <View style={styles.actionsRow}>
              <Button variant="outline" style={styles.btn} onPress={() => { if (!submitting) onClose(); }} disabled={submitting}>Cancel</Button>
              <Button variant="error" style={styles.btn} onPress={submitFlag} disabled={!valid || submitting} loading={submitting}>
                {submitting ? 'Submitting...' : 'Submit'}
              </Button>
            </View>
          </Card>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'white', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' },
  scrollView: { flexGrow: 0 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  closeButton: { padding: 8 },
  body: { padding: 16 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  reasonPill: { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#F3F4F6', borderRadius: 999, marginRight: 8, marginTop: 8 },
  reasonPillSelected: { backgroundColor: '#FEE2E2' },
  reasonText: { color: '#0F172A', textTransform: 'capitalize' },
  reasonTextSelected: { color: '#881337' },
  textArea: { minHeight: 100, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB', borderRadius: 8, padding: 10, marginTop: 8, textAlignVertical: 'top' },
  hint: { color: '#6B7280', fontSize: 12, marginTop: 6 },
  rowBetweenAlign: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  actionsRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1 },
});

export default FlagRideModal;
