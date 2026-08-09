import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Star, X } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (stars: number, comment?: string) => Promise<void> | void;
  title?: string;
  subtitle?: string;
  submitting?: boolean;
  errorText?: string | null;
};

export function RatingModal({ visible, onClose, onSubmit, title, subtitle, submitting, errorText }: Props) {
  const [stars, setStars] = useState<number>(0);
  const [comment, setComment] = useState<string>('');

  const canSubmit = useMemo(() => stars >= 1 && stars <= 5 && !submitting, [stars, submitting]);

  const handleSelect = (val: number) => {
    if (submitting) return;
    setStars(val);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit(stars, comment.trim() ? comment.trim() : undefined);
    // Reset local state after submit path completes (parent will close modal on success)
    setStars(0);
    setComment('');
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 32 : 0}
            style={styles.avoiding}
          >
            <TouchableWithoutFeedback onPress={() => {}} accessible={false}>
              <View style={styles.card}>
                <View style={styles.header}>
                  <View style={styles.headerIcon}>
                    <Ionicons name="star" size={16} color="#DE5D20" />
                  </View>
                  <Text style={styles.title}>{title || 'Rate your ride'}</Text>
                  <TouchableOpacity onPress={onClose} style={styles.closeBtn} disabled={!!submitting}>
                    <X size={22} color="#64748B" />
                  </TouchableOpacity>
                </View>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <TouchableOpacity key={i} onPress={() => handleSelect(i)} disabled={!!submitting}>
                      <Star
                        size={34}
                        color={i <= stars ? '#F59E0B' : '#CBD5E1'}
                        fill={i <= stars ? '#F59E0B' : 'none'}
                        style={{ marginHorizontal: 6 }}
                      />
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput
                  style={styles.input}
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Add a comment (optional)"
                  placeholderTextColor="#94A3B8"
                  editable={!submitting}
                  multiline
                />

                {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

                <TouchableOpacity
                  style={[styles.submitBtn, !canSubmit && styles.disabled]}
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitText}>Submit Rating</Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  avoiding: {
    flex: 1,
    justifyContent: 'flex-end',
    width: '100%',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  headerIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#FFF2E9', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  closeBtn: { padding: 4, marginLeft: 'auto' },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: '#0F172A' },
  subtitle: { color: '#475569', marginBottom: 12 },
  starsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 12 },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    textAlignVertical: 'top',
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
  },
  error: { color: '#B91C1C', marginTop: 8 },
  submitBtn: {
    marginTop: 14,
    backgroundColor: '#0B1220',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  submitText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
});

export default RatingModal;
