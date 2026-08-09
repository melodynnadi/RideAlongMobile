import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Star, X } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';

export type DriverRatingModalProps = {
  visible: boolean;               // ✅ visible={ratingModalVisible}
  riderName?: string | null;      // ✅ riderName={ratingQueue[ratingIdx]?.riderName ...}
  onClose: () => void;            // ✅ onClose={() => { setRatingModalVisible(false)... }}
  onSubmit: (args: { stars: number; comment?: string }) => Promise<void> | void;  // ✅ matches
  submitting?: boolean;           // ✅ submitting={ratingSubmitting}
  errorText?: string | null;      // ✅ errorText={ratingError}
};;

export function DriverRatingModal({ visible, riderName, onClose, onSubmit, submitting, errorText }: DriverRatingModalProps) {
  // Start with no selection so stars render empty until user interacts
  const [stars, setStars] = useState<number>(0);
  const [selected, setSelected] = useState<boolean>(false);
  const [comment, setComment] = useState<string>('');

  const starArray = useMemo(() => [1, 2, 3, 4, 5], []);
  const canSubmit = useMemo(() => selected && Number.isFinite(stars) && stars >= 1 && stars <= 5 && !submitting, [selected, stars, submitting]);

  const handleSelect = (v: number) => {
    setStars(v);
    setSelected(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit({ stars, comment: comment?.trim() ? comment.trim() : undefined });
    setComment('');
    setStars(0);
    setSelected(false);
  };

  // Reset to initial state whenever the modal becomes visible
  useEffect(() => {
    if (visible) {
      setStars(0);
      setSelected(false);
      setComment('');
    }
  }, [visible]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoid}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.card}>
              <View style={styles.header}>
                <View style={styles.headerIcon}>
                  <Ionicons name="star" size={16} color="#DE5D20" />
                </View>
                <Text style={styles.title}>Rate your rider</Text>
                <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close rating modal">
                  <X size={22} color="#64748B" />
                </TouchableOpacity>
              </View>
              <Text style={styles.subtitle}>
                {riderName ? `How was your ride with ${riderName}?` : 'How was your rider?'}
              </Text>
              <View style={styles.starsRow}>
                {starArray.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={styles.starBtn}
                    onPress={() => handleSelect(s)}
                    accessibilityRole="button"
                    accessibilityLabel={`${s} star${s > 1 ? 's' : ''}`}
                  >
                    <Star
                      size={28}
                      color={s <= stars && selected ? '#F59E0B' : '#D1D5DB'}
                      fill={s <= stars && selected ? '#F59E0B' : 'none'}
                    />
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={comment}
                onChangeText={setComment}
                placeholder="Optional comment"
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={Platform.OS === 'ios' ? 4 : 3}
                editable={!submitting}
                textAlignVertical="top"
              />
              {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={[styles.submitBtn, { opacity: canSubmit ? 1 : 0.6 }]}
              >
                <Text style={styles.submitText}>{submitting ? 'Submitting…' : 'Submit rating'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  keyboardAvoid: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  headerIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#FFF2E9', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#111827' },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  subtitle: { color: '#6B7280', marginBottom: 12 },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 12, justifyContent: 'center', alignItems: 'center' },
  starBtn: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  errorText: { color: '#DC2626', marginTop: 8 },
  submitBtn: {
    backgroundColor: '#0B1220',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  submitText: { color: '#FFFFFF', fontWeight: '700' },
});

export default DriverRatingModal;
